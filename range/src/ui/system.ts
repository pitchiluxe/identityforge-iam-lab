/**
 * ui/system.ts — the workstation-wide behaviour behind Settings and the
 * taskbar: the clock (time zone, region format, seconds), sound (volume,
 * mute, notification sounds), brightness and night light, contrast, the
 * account picture, the sign-in password, idle lock, airplane mode,
 * notification history, and default apps. Every setting here changes
 * something you can see or hear.
 */
import { h, setToastHook } from './dom.ts';
import { persist, store } from './store.ts';

export interface SystemSettings {
  volume: number;
  muted: boolean;
  notificationSounds: boolean;
  brightness: number;
  contrast: boolean;
  timeZone: string;
  region: string;
  clockSeconds: boolean;
  longDate: boolean;
  bluetooth: boolean;
  airplane: boolean;
  doNotDisturb: boolean;
  gameMode: boolean;
  idleLockMinutes: number;
  signInPassword: string | null;
  localAi: boolean;
  vpn: { name: string; server: string; connected: boolean }[];
  proxy: string;
  ps1Action: 'run' | 'edit' | 'notepad';
  batAction: 'run' | 'edit';
  startupApps: string[];
}

export const DEFAULT_SIGN_IN_PASSWORD = 'Meridian!2026';
export const AVATAR_KEY = 'identityforge-range-avatar';

const DEFAULTS: SystemSettings = {
  volume: 60, muted: false, notificationSounds: true, brightness: 100, contrast: false,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, region: navigator.language || 'en-US',
  clockSeconds: false, longDate: false, bluetooth: false, airplane: false, doNotDisturb: false, gameMode: false,
  idleLockMinutes: 0, signInPassword: null, localAi: true, vpn: [], proxy: '',
  ps1Action: 'run', batAction: 'run', startupApps: ['coach'],
};

export function sys(): SystemSettings {
  return { ...DEFAULTS, ...(store.settings.system ?? {}) };
}

export function setSys(patch: Partial<SystemSettings>): void {
  store.settings.system = { ...(store.settings.system ?? {}), ...patch };
  persist();
  applySystem();
  for (const fn of listeners) fn();
}

const listeners = new Set<() => void>();
export function onSysChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function signInPassword(): string {
  return sys().signInPassword ?? DEFAULT_SIGN_IN_PASSWORD;
}

// ---------------------------------------------------------------- clock

export const TIME_ZONES = ['Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Halifax', 'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Africa/Lagos', 'Africa/Nairobi', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];
export const REGIONS: [string, string][] = [['en-US', 'English (United States)'], ['en-GB', 'English (United Kingdom)'], ['en-CA', 'English (Canada)'], ['fr-FR', 'Français (France)'], ['de-DE', 'Deutsch (Deutschland)'], ['es-ES', 'Español (España)'], ['pt-BR', 'Português (Brasil)'], ['sw-KE', 'Kiswahili (Kenya)']];

function zone(): string {
  const z = sys().timeZone;
  try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return z; } catch { return DEFAULTS.timeZone; }
}

export function fmtTime(d: Date, opts: { seconds?: boolean; h24?: boolean } = {}): string {
  const s = sys();
  return d.toLocaleTimeString(s.region, { hour: 'numeric', minute: '2-digit', second: (opts.seconds ?? s.clockSeconds) ? '2-digit' : undefined, hour12: opts.h24 === undefined ? undefined : !opts.h24, timeZone: zone() });
}

export function fmtDate(d: Date, style: 'short' | 'long' | 'full' = sys().longDate ? 'long' : 'short'): string {
  const s = sys();
  return style === 'full'
    ? d.toLocaleDateString(s.region, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: zone() })
    : d.toLocaleDateString(s.region, { dateStyle: style === 'long' ? 'medium' : 'short', timeZone: zone() });
}

/** Year, month (0-11) and day as they are in the chosen time zone. */
export function zonedParts(d: Date): { y: number; m: number; day: number; weekday: number } {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: zone(), year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' }).formatToParts(d);
  const get = (t: string): string => p.find((x) => x.type === t)?.value ?? '';
  return { y: Number(get('year')), m: Number(get('month')) - 1, day: Number(get('day')), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')) };
}

// ---------------------------------------------------------------- sound

let audio: AudioContext | null = null;
export function playSound(kind: 'notify' | 'error' | 'logon' | 'test'): void {
  const s = sys();
  if (s.muted || s.volume <= 0) return;
  if ((kind === 'notify' || kind === 'error') && !s.notificationSounds) return;
  try {
    audio ??= new AudioContext();
    const notes = kind === 'error' ? [[330, 0.12], [262, 0.18]] : kind === 'logon' ? [[523, 0.12], [659, 0.12], [784, 0.22]] : [[784, 0.1], [988, 0.16]];
    let t = audio.currentTime;
    for (const [freq, dur] of notes) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine';
      o.frequency.value = freq!;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25 * (s.volume / 100), t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur!);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + dur! + 0.02);
      t += dur! * 0.9;
    }
  } catch {
    /* no audio device: stay silent */
  }
}

// ---------------------------------------------------------------- notifications

export interface Note { text: string; kind: 'ok' | 'err' | 'info'; time: string }
export const notifications: Note[] = [];
let unread = 0;
export function unreadNotifications(): number {
  return unread;
}
export function markNotificationsRead(): void {
  unread = 0;
  for (const fn of listeners) fn();
}

/** Toasts pass through here: Do not disturb and Game Mode hold them in the notification centre. */
function onToast(message: string, kind: 'ok' | 'err' | 'info'): boolean {
  const s = sys();
  notifications.unshift({ text: message, kind, time: new Date().toISOString() });
  notifications.splice(50);
  unread++;
  for (const fn of listeners) fn();
  const quiet = (s.doNotDisturb || s.gameMode || store.settings.notifications === false) && kind !== 'err';
  if (!quiet) playSound(kind === 'err' ? 'error' : 'notify');
  return !quiet;
}

// ---------------------------------------------------------------- account picture

export function avatarData(): string | null {
  try { return localStorage.getItem(AVATAR_KEY); } catch { return null; }
}

/** Resize to 256px and keep it, so a phone photo does not fill local storage. */
export function setAvatarFromFile(file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const size = 256;
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d')!;
      const side = Math.min(img.width, img.height);
      g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      try {
        localStorage.setItem(AVATAR_KEY, c.toDataURL('image/jpeg', 0.88));
      } catch {
        return reject(new Error('This browser could not store the picture.'));
      }
      for (const fn of listeners) fn();
      resolve();
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture this browser can read.')); };
    img.src = url;
  });
}

export function removeAvatar(): void {
  try { localStorage.removeItem(AVATAR_KEY); } catch { /* nothing stored */ }
  for (const fn of listeners) fn();
}

/** The account picture, or the initials when there is none. */
export function avatar(size: number, cls = 'avatar'): HTMLElement {
  const name = store.world.player.displayName;
  const initials = name.split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
  const data = avatarData();
  const el = h('span', { class: cls, style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px`, 'aria-hidden': 'true' });
  if (data) el.appendChild(h('img', { src: data, alt: '', width: size, height: size }));
  else el.textContent = initials;
  return el;
}

// ---------------------------------------------------------------- apply

let idleTimer = 0;
let lockHook: () => void = () => {};
export function setLockHook(fn: () => void): void {
  lockHook = fn;
}
export function lockNow(): void {
  lockHook();
}

function armIdle(): void {
  clearTimeout(idleTimer);
  const m = sys().idleLockMinutes;
  if (m > 0 && document.querySelector('.workstation')) idleTimer = window.setTimeout(() => lockHook(), m * 60_000);
}

export function applySystem(): void {
  const s = sys();
  const root = document.documentElement;
  root.style.setProperty('--dim', String(Math.max(0, (100 - s.brightness) / 100) * 0.7));
  root.dataset.night = store.settings.nightLight ? 'on' : 'off';
  root.dataset.contrast = s.contrast ? 'on' : 'off';
  root.dataset.airplane = s.airplane ? 'on' : 'off';
  root.style.filter = '';
  armIdle();
}

export function installSystem(): void {
  setToastHook(onToast);
  for (const ev of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(ev, armIdle, { passive: true, capture: true });
  applySystem();
}
