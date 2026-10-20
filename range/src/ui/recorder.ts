/**
 * ui/recorder.ts — screenshots and narrated recordings for Screen Pen.
 *
 * Ported from IAM Range (util/screenCapture.ts, util/screenRecorder.ts).
 *
 * Screenshot: the desktop app photographs its own window silently through
 * Electron's capturePage (it can only ever contain the workstation); the
 * browser edition asks for a screen with getDisplayMedia, keeps one frame and
 * stops every track.
 *
 * Recording: the screen the user picks, the webcam drawn into a corner as a
 * round bubble, and the microphone mixed with system audio when offered. The
 * frames are composed on a canvas because MediaRecorder cannot overlay two
 * video tracks. Nothing starts without a click and the browser's own consent
 * prompt, and every track is stopped when the recording ends.
 */

export type CameraCorner = 'bottom-right' | 'bottom-left' | 'top-left' | 'top-right';

export interface RecorderHandle {
  stop(): Promise<Blob | null>;
  elapsed(): number;
  hasAudio(): boolean;
  hasCamera(): boolean;
  hasSystemAudio(): boolean;
  setCameraCorner(corner: CameraCorner): void;
}

interface DesktopBridge {
  captureWindow?: () => Promise<string | null>;
  saveCapture?: (name: string, bytes: ArrayBuffer) => Promise<string | null>;
}
const bridge = (): DesktopBridge | null => (globalThis as unknown as { meridianDesktop?: DesktopBridge }).meridianDesktop ?? null;

export const canRecord = (): boolean =>
  typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function' && !!navigator.mediaDevices?.getDisplayMedia;
export const canRecordCamera = (): boolean => !!navigator.mediaDevices?.getUserMedia;

async function videoFor(stream: MediaStream): Promise<HTMLVideoElement> {
  const el = document.createElement('video');
  el.srcObject = stream;
  el.muted = true;
  el.playsInline = true;
  await el.play();
  // Dimensions arrive a frame or two after play() resolves.
  await new Promise<void>((resolve) => {
    let tries = 0;
    const check = (): void => { if ((el.videoWidth > 0 && tries > 2) || tries > 60) resolve(); else { tries++; requestAnimationFrame(check); } };
    check();
  });
  return el;
}

/** A PNG data URL of the workstation (desktop app) or of a screen the user picks (browser). */
export async function captureScreen(): Promise<string | null> {
  try {
    const silent = await bridge()?.captureWindow?.();
    if (silent && silent.startsWith('data:image/')) return silent;
  } catch { /* fall back to the picker */ }
  if (!navigator.mediaDevices?.getDisplayMedia) return null;
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }); } catch { return null; }
  try {
    const v = await videoFor(stream);
    if (!v.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0);
    v.srcObject = null;
    return c.toDataURL('image/png');
  } catch { return null; } finally { for (const t of stream.getTracks()) t.stop(); }
}

/**
 * Keep a capture. The desktop app writes it to Documents\Meridian IAM Range\Captures
 * and returns the path; the browser downloads it.
 */
export async function saveCapture(blob: Blob, name: string): Promise<string> {
  const save = bridge()?.saveCapture;
  if (save) {
    try {
      const path = await save(name, await blob.arrayBuffer());
      if (path) return `Saved to ${path}`;
    } catch { /* fall back to a download */ }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return `Downloaded ${name}`;
}

export async function startRecording(opts: { camera: boolean; corner: CameraCorner; onEnded: () => void }): Promise<RecorderHandle | null> {
  if (!canRecord()) return null;
  // The screen first: a cancelled picker then costs no camera light.
  let screen: MediaStream;
  try { screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 60 } }, audio: true }); } catch { return null; }
  const open: MediaStream[] = [screen];
  const stopAll = (): void => { for (const s of open) for (const t of s.getTracks()) t.stop(); };
  let screenVideo: HTMLVideoElement;
  try { screenVideo = await videoFor(screen); } catch { stopAll(); return null; }

  // Camera and microphone are best effort and asked separately, so a refused camera keeps the narration.
  let cam: HTMLVideoElement | null = null;
  if (opts.camera && canRecordCamera()) {
    try { const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }); open.push(s); cam = await videoFor(s); } catch { cam = null; }
  }
  let mic: MediaStream | null = null;
  try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); open.push(mic); } catch { mic = null; }

  const canvas = document.createElement('canvas');
  canvas.width = screenVideo.videoWidth || 1280;
  canvas.height = screenVideo.videoHeight || 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) { stopAll(); return null; }
  const out = canvas.captureStream(30);

  // Microphone and system audio summed into one track, system audio under the voice.
  const system = screen.getAudioTracks();
  let audioCtx: AudioContext | null = null;
  let hasAudio = false;
  if (mic || system.length) {
    try {
      audioCtx = new AudioContext();
      const mix = audioCtx.createMediaStreamDestination();
      if (mic) audioCtx.createMediaStreamSource(mic).connect(mix);
      if (system.length) { const g = audioCtx.createGain(); g.gain.value = 0.6; audioCtx.createMediaStreamSource(new MediaStream(system)).connect(g); g.connect(mix); }
      for (const t of mix.stream.getAudioTracks()) out.addTrack(t);
      hasAudio = true;
    } catch {
      audioCtx = null;
      if (mic) { for (const t of mic.getAudioTracks()) out.addTrack(t); hasAudio = true; }
    }
  }

  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(out, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.start(1000);
  const started = performance.now();
  let corner = opts.corner;
  let running = true;
  let raf = 0;

  const paint = (): void => {
    if (!running) return;
    ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
    if (cam && cam.videoWidth) {
      const size = Math.round(Math.min(canvas.width, canvas.height) * 0.18);
      const m = Math.round(size * 0.16);
      const x = corner.endsWith('right') ? canvas.width - size - m : m;
      const y = corner.startsWith('bottom') ? canvas.height - size - m : m;
      const r = size / 2;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = Math.round(size * 0.08);
      ctx.beginPath(); ctx.arc(x + r, y + r, r, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill(); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.arc(x + r, y + r, r, 0, Math.PI * 2); ctx.clip();
      const side = Math.min(cam.videoWidth, cam.videoHeight);
      ctx.drawImage(cam, (cam.videoWidth - side) / 2, (cam.videoHeight - side) / 2, side, side, x, y, size, size); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.arc(x + r, y + r, r - 1, 0, Math.PI * 2); ctx.lineWidth = Math.max(2, Math.round(size * 0.02)); ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.stroke(); ctx.restore();
    }
    raf = requestAnimationFrame(paint);
  };
  raf = requestAnimationFrame(paint);

  let stopped: Promise<Blob | null> | null = null;
  const finish = (): Promise<Blob | null> => {
    stopped ??= new Promise((resolve) => {
      running = false;
      cancelAnimationFrame(raf);
      const done = (): void => {
        stopAll();
        for (const t of out.getTracks()) t.stop();
        void audioCtx?.close().catch(() => undefined);
        screenVideo.srcObject = null;
        if (cam) cam.srcObject = null;
        resolve(chunks.length ? new Blob(chunks, { type: mime ?? 'video/webm' }) : null);
      };
      if (rec.state === 'inactive') done(); else { rec.onstop = done; rec.stop(); }
    });
    return stopped;
  };
  // Ending the share from the browser's own bar is a stop, not a frozen frame.
  for (const t of screen.getVideoTracks()) t.addEventListener('ended', () => { if (running) void finish().then(opts.onEnded); });

  return {
    stop: finish,
    elapsed: () => Math.floor((performance.now() - started) / 1000),
    hasAudio: () => hasAudio,
    hasCamera: () => cam !== null,
    hasSystemAudio: () => system.length > 0,
    setCameraCorner: (c) => { corner = c; },
  };
}
