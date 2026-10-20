/**
 * ui/pen.ts — Screen Pen: drawing on the live workstation.
 *
 * Ported from IAM Range (ui/desktopAnnotator.ts). A transparent sheet over the
 * whole desktop with a floating toolbar you can drag out of your own way, so
 * you can circle a field in Active Directory while it is on screen: teaching,
 * walking a colleague through a change, or narrating a recording.
 *
 * What makes or breaks a tool like this is what happens to clicks, so the
 * sheet has two states and the toolbar always says which one it is in:
 *
 *   Drawing        the sheet takes the pointer; the desktop is frozen behind it
 *   Click-through  clicks reach the apps underneath; the marks stay visible
 *
 * It opens in Click-through (a pen that silently swallows every click looks
 * like a broken workstation), picking a tool switches to Drawing, and Esc
 * always hands the desktop back.
 */
import { h, toast } from './dom.ts';
import { type AppDef } from './wm.ts';
import { type CameraCorner, type RecorderHandle, canRecord, canRecordCamera, captureScreen, saveCapture, startRecording } from './recorder.ts';

type Tool = 'pen' | 'highlight' | 'arrow' | 'box' | 'eraser';
interface Point { x: number; y: number }
interface Stroke { tool: Tool; color: string; size: number; points: Point[] }

const TOOLS: { id: Tool; icon: string; title: string }[] = [
  { id: 'pen', icon: '', title: 'Pen' },
  { id: 'highlight', icon: '', title: 'Highlighter: translucent, so the text stays readable' },
  { id: 'arrow', icon: '', title: 'Arrow' },
  { id: 'box', icon: '', title: 'Box' },
  { id: 'eraser', icon: '', title: 'Eraser' },
];
const COLORS = ['#e81123', '#ffb900', '#16c60c', '#0078d4', '#ffffff', '#000000'];
const POS_KEY = 'meridian-pen-toolbar';
const CAM_KEY = 'meridian-pen-camera';

const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* lasts the session */ } };
const stamp = (): string => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const clock = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

let close: (() => void) | null = null;

export function screenPenActive(): boolean {
  return close !== null;
}

/** Open Screen Pen, or close it if it is already up (one entry point, one obvious way off). */
export function toggleScreenPen(): void {
  if (close) { close(); return; }

  let tool: Tool = 'pen';
  let color = COLORS[0]!;
  let size = 3;
  let drawing = false;
  let strokes: Stroke[] = [];
  const redo: Stroke[] = [];
  let current: Stroke | null = null;
  let recorder: RecorderHandle | null = null;
  let tick = 0;
  let camera = (read(CAM_KEY) ?? (canRecordCamera() ? '1' : '0')) === '1';
  let corner: CameraCorner = 'bottom-right';

  const canvas = h('canvas', { class: 'pen-canvas' });
  const overlay = h('div', { class: 'pen-sheet click-through', 'data-label': 'Drawing: clicks go to the pen. Press Esc to use the desktop.' }, canvas);
  const bar = h('div', { class: 'pen-bar', role: 'toolbar', 'aria-label': 'Screen Pen' });
  const saved = (() => { try { return JSON.parse(read(POS_KEY) ?? '') as Point; } catch { return null; } })();
  const place = (p: Point): void => {
    bar.style.left = `${Math.min(window.innerWidth - 120, Math.max(0, p.x))}px`;
    bar.style.top = `${Math.min(window.innerHeight - 50, Math.max(0, p.y))}px`;
  };
  place(saved && typeof saved.x === 'number' ? saved : { x: Math.round(window.innerWidth / 2 - 330), y: 16 });

  // ------------------------------------------------------------ drawing
  function sizeCanvas(): void {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
    canvas.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0);
    paint();
  }
  function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
    const first = s.points[0];
    const last = s.points[s.points.length - 1];
    if (!first || !last) return;
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = s.size;
    if (s.tool === 'highlight') { ctx.globalAlpha = 0.3; ctx.lineWidth = s.size * 5 + 4; ctx.lineCap = 'square'; }
    // The eraser cuts a hole in the annotation layer, so the desktop shows through exactly as before.
    if (s.tool === 'eraser') { ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = s.size * 6 + 12; }
    if (s.tool === 'box') ctx.strokeRect(first.x, first.y, last.x - first.x, last.y - first.y);
    else if (s.tool === 'arrow') {
      const a = Math.atan2(last.y - first.y, last.x - first.x);
      const head = 12 + s.size * 2;
      ctx.beginPath(); ctx.moveTo(first.x, first.y); ctx.lineTo(last.x - Math.cos(a) * head * 0.6, last.y - Math.sin(a) * head * 0.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(last.x, last.y);
      ctx.lineTo(last.x - head * Math.cos(a - Math.PI / 7), last.y - head * Math.sin(a - Math.PI / 7));
      ctx.lineTo(last.x - head * Math.cos(a + Math.PI / 7), last.y - head * Math.sin(a + Math.PI / 7));
      ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      // Midpoint curves, so fast strokes come out smooth rather than as polylines.
      for (let i = 1; i < s.points.length - 1; i++) {
        const p = s.points[i]!, n = s.points[i + 1]!;
        ctx.quadraticCurveTo(p.x, p.y, (p.x + n.x) / 2, (p.y + n.y) / 2);
      }
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
    ctx.restore();
  }
  function paint(): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore();
    for (const s of strokes) drawStroke(ctx, s);
    if (current) drawStroke(ctx, current);
  }
  const at = (e: PointerEvent): Point => ({ x: e.clientX, y: e.clientY });
  canvas.addEventListener('pointerdown', (e) => {
    if (!drawing || e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    current = { tool, color, size, points: [at(e)] };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!current) return;
    if (current.tool === 'arrow' || current.tool === 'box') current.points = [current.points[0]!, at(e)];
    else current.points.push(at(e));
    paint();
  });
  const finish = (): void => {
    if (!current) return;
    if (current.points.length > 1) { strokes.push(current); redo.length = 0; }
    current = null;
    paint();
    render();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });

  function setMode(next: boolean): void {
    drawing = next;
    overlay.className = `pen-sheet ${next ? 'draw' : 'click-through'}`;
    render();
  }
  const undo = (): void => { const s = strokes.pop(); if (s) { redo.push(s); paint(); render(); } };
  const redoOne = (): void => { const s = redo.pop(); if (s) { strokes.push(s); paint(); render(); } };

  // Esc hands the desktop back; Ctrl+Z / Ctrl+Y work while drawing. Capture
  // phase so the pen wins over an app's own keys only while it holds the screen.
  const onKey = (e: KeyboardEvent): void => {
    if (!drawing) return;
    const k = (e.key ?? '').toLowerCase();
    if (k === 'escape') { e.preventDefault(); e.stopPropagation(); setMode(false); toast('Click-through: the apps take clicks again.', 'info'); }
    else if (e.ctrlKey && k === 'z') { e.preventDefault(); e.stopPropagation(); undo(); }
    else if (e.ctrlKey && k === 'y') { e.preventDefault(); e.stopPropagation(); redoOne(); }
  };
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', sizeCanvas);

  // ------------------------------------------------------------ capture
  async function screenshot(): Promise<void> {
    // The toolbar and the "Drawing" frame are not part of the picture anybody wanted.
    bar.style.visibility = 'hidden';
    overlay.classList.add('capturing');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const url = await captureScreen();
    bar.style.visibility = '';
    overlay.classList.remove('capturing');
    if (!url) { toast('Nothing was captured.', 'info'); return; }
    // Decoded here rather than fetch(data:), which the app's CSP (connect-src) refuses.
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });
    toast(`Screenshot taken. ${await saveCapture(blob, `meridian-${stamp()}.png`)}`, 'ok');
  }
  async function deliver(handle: RecorderHandle): Promise<void> {
    const blob = await handle.stop();
    if (!blob) { toast('The recording produced nothing.', 'info'); return; }
    toast(`Recording saved. ${await saveCapture(blob, `meridian-${stamp()}.webm`)}`, 'ok');
  }
  async function toggleRecording(): Promise<void> {
    if (recorder) {
      const handle = recorder;
      recorder = null;
      clearInterval(tick);
      render();
      await deliver(handle);
      return;
    }
    if (!canRecord()) { toast('Recording is not available here.', 'err'); return; }
    toast('Choose what to share...', 'info');
    const handle = await startRecording({ camera, corner, onEnded: () => {
      // Stopped from the browser's own "Stop sharing" bar.
      if (!recorder) return;
      const ending = recorder;
      recorder = null;
      clearInterval(tick);
      render();
      void deliver(ending);
    } });
    if (!handle) { toast('No screen was shared, so nothing is being recorded.', 'info'); return; }
    recorder = handle;
    tick = window.setInterval(render, 1000);
    render();
    const parts = ['Recording the screen you picked'];
    if (handle.hasCamera()) parts.push('with your camera in the corner');
    if (handle.hasAudio()) parts.push(handle.hasSystemAudio() ? 'and microphone + system audio' : 'and your microphone');
    toast(handle.hasAudio() ? `${parts.join(' ')}.` : `${parts.join(' ')}, but with no audio: no microphone, or permission was declined.`, handle.hasAudio() ? 'ok' : 'info');
  }

  // ------------------------------------------------------------ toolbar
  const btn = (icon: string, title: string, on: boolean, fn: () => void, extra = ''): HTMLButtonElement =>
    h('button', { class: `pen-btn ${on ? 'on' : ''} ${extra}`, type: 'button', title, 'aria-label': title, 'aria-pressed': on ? 'true' : 'false', onClick: fn }, h('span', { class: 'mdl' }, icon));
  const sep = (): HTMLElement => h('span', { class: 'pen-sep' });

  const grip = h('span', { class: 'pen-grip', title: 'Drag to move', 'aria-hidden': 'true' }, h('span', { class: 'mdl' }, ''));
  let drag: Point | null = null;
  grip.addEventListener('pointerdown', (e) => {
    const r = bar.getBoundingClientRect();
    drag = { x: e.clientX - r.left, y: e.clientY - r.top };
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grip.addEventListener('pointermove', (e) => { if (drag) place({ x: e.clientX - drag.x, y: e.clientY - drag.y }); });
  grip.addEventListener('pointerup', () => { if (!drag) return; drag = null; write(POS_KEY, JSON.stringify({ x: parseInt(bar.style.left, 10), y: parseInt(bar.style.top, 10) })); });

  function render(): void {
    bar.replaceChildren(...[
      grip,
      ...TOOLS.map((t) => btn(t.icon, t.title, drawing && tool === t.id, () => { tool = t.id; if (!drawing) setMode(true); else render(); })),
      sep(),
      ...COLORS.map((c) => h('button', { class: `pen-swatch ${c === color ? 'on' : ''}`, type: 'button', title: c, 'aria-label': `Colour ${c}`, style: `background:${c}`, onClick: () => { color = c; if (tool === 'eraser') tool = 'pen'; if (!drawing) setMode(true); else render(); } })),
      sep(),
      ...[2, 3, 6].map((w) => h('button', { class: `pen-size ${size === w ? 'on' : ''}`, type: 'button', title: `${w === 2 ? 'Thin' : w === 3 ? 'Medium' : 'Thick'} line`, 'aria-label': `Line width ${w}`, onClick: () => { size = w; render(); } }, h('span', { style: `width:${w * 2 + 2}px;height:${w * 2 + 2}px` }))),
      sep(),
      btn('', 'Undo (Ctrl+Z)', false, undo, strokes.length ? '' : 'dim'),
      btn('', 'Redo (Ctrl+Y)', false, redoOne, redo.length ? '' : 'dim'),
      btn('', 'Clear every mark', false, () => { if (!strokes.length) return; redo.push(...strokes.reverse()); strokes = []; paint(); render(); }, strokes.length ? '' : 'dim'),
      sep(),
      btn('', 'Screenshot: the screen with your marks on it', false, () => { void screenshot(); }),
      recorder
        ? h('button', { class: 'pen-btn rec on', type: 'button', title: 'Stop recording and save', onClick: () => { void toggleRecording(); } }, h('span', { class: 'mdl' }, ''), clock(recorder.elapsed()))
        : btn('', 'Record a screen you pick, with your camera and narration', false, () => { void toggleRecording(); }, 'rec'),
      canRecordCamera() ? btn(camera ? '' : '', recorder ? 'The camera cannot be changed while recording' : camera ? 'Camera bubble on: click to record the screen alone' : 'Camera bubble off: click to include yourself', camera, () => {
        if (recorder) { toast('Stop the recording before changing the camera.', 'info'); return; }
        camera = !camera; write(CAM_KEY, camera ? '1' : '0'); render();
      }) : null,
      canRecordCamera() && camera ? btn('', `Camera bubble: ${corner.replace('-', ' ')}. Click to move it.`, false, () => {
        const order: CameraCorner[] = ['bottom-right', 'bottom-left', 'top-left', 'top-right'];
        corner = order[(order.indexOf(corner) + 1) % order.length]!;
        recorder?.setCameraCorner(corner);
        render();
        toast(`Camera bubble: ${corner.replace('-', ' ')}`, 'info');
      }) : null,
      // The mode switch is the control that keeps the desktop usable.
      h('button', { class: `pen-mode ${drawing ? 'drawing' : ''}`, type: 'button', title: drawing ? 'The pen is taking clicks. Switch to let them reach the desktop (Esc).' : 'Clicks reach the desktop. Switch to draw again.', onClick: () => setMode(!drawing) },
        h('span', { class: 'mdl' }, drawing ? '' : ''), drawing ? 'Drawing' : 'Click-through'),
      btn('', 'Close Screen Pen', false, () => close?.()),
    ].filter((x): x is HTMLElement => !!x));
  }

  close = (): void => {
    // A recording left running when the toolbar goes is a recording nobody can stop.
    if (recorder) void toggleRecording();
    clearInterval(tick);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', sizeCanvas);
    overlay.remove();
    bar.remove();
    close = null;
  };

  render();
  document.body.append(overlay, bar);
  sizeCanvas();
  toast('Screen Pen is ready in Click-through. Pick a tool to draw; Esc gives the desktop back.', 'info');
}

export const screenPenApp: AppDef = {
  id: 'pen',
  title: 'Screen Pen',
  icon: 'pen',
  launch: toggleScreenPen,
  mount() { /* never opened as a window: launch() handles it */ },
};
