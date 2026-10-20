/**
 * ui/theme.ts — Personalization and Accessibility settings, applied to the
 * whole workstation: colour mode, accent, mouse pointer, taskbar, icons.
 */
import { store } from './store.ts';
import { backgroundFor } from './wallpapers.ts';

export type PointerStyle = 'white' | 'black' | 'inverted' | 'custom';

export interface Appearance {
  mode: 'light' | 'dark' | 'system';
  accent: string;
  transparency: boolean;
  animations: boolean;
  taskbarAlign: 'center' | 'left';
  iconSize: 'small' | 'medium' | 'large';
  showDesktopIcons: boolean;
  pointerStyle: PointerStyle;
  pointerColor: string;
  pointerSize: number;
  clock24: boolean;
  wallpaperFit: 'fill' | 'fit' | 'center';
  solidColor: string | null;
}

export const DEFAULT_APPEARANCE: Appearance = {
  mode: 'light', accent: '#005fb8', transparency: true, animations: true, taskbarAlign: 'center', iconSize: 'medium',
  showDesktopIcons: true, pointerStyle: 'white', pointerColor: '#7cfc00', pointerSize: 1, clock24: false, wallpaperFit: 'fill', solidColor: null,
};

export const ACCENTS = ['#005fb8', '#0063b1', '#8764b8', '#c239b3', '#e3008c', '#d13438', '#ca5010', '#ffb900', '#107c10', '#00b7c3', '#038387', '#486860', '#525e54', '#7a7574', '#5d5a58', '#68768a'];

export function appearance(): Appearance {
  return { ...DEFAULT_APPEARANCE, ...(store.settings.appearance ?? {}) };
}

function svg(body: string, size: number): string {
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 32 32'>${body}</svg>`)}")`;
}

function pointerColors(a: Appearance): { fill: string; stroke: string } {
  switch (a.pointerStyle) {
    case 'black': return { fill: '#000', stroke: '#fff' };
    case 'inverted': return { fill: document.documentElement.dataset.theme === 'dark' ? '#fff' : '#000', stroke: document.documentElement.dataset.theme === 'dark' ? '#000' : '#fff' };
    case 'custom': return { fill: a.pointerColor, stroke: '#000' };
    default: return { fill: '#fff', stroke: '#000' };
  }
}

function cursorCss(a: Appearance): string {
  const { fill, stroke } = pointerColors(a);
  const size = Math.round(32 * (0.75 + a.pointerSize * 0.25));
  const s = size / 32;
  const arrow = svg(`<path d='M2 1.5v23.5l6.2-6 3.9 9.2 3.8-1.6-3.9-9.1H21z' fill='${fill}' stroke='${stroke}' stroke-width='1.6' stroke-linejoin='round'/>`, size);
  const hand = svg(`<path d='M10.5 13V4.6a2 2 0 0 1 4 0V12l.2-1.4a2 2 0 0 1 3.8.4v1.7a2 2 0 0 1 3.8.5v1.4a2 2 0 0 1 3.7.9V22c0 4.4-3 8-7.6 8h-2.3c-2.6 0-4.4-1-6-3.3l-4.3-6.2a2 2 0 0 1 3.1-2.5L10.5 20z' fill='${fill}' stroke='${stroke}' stroke-width='1.5' stroke-linejoin='round'/>`, size);
  const beam = svg(`<path d='M12 3h3l1 1 1-1h3M16 4v24M12 29h3l1-1 1 1h3' fill='none' stroke='${stroke}' stroke-width='3.2' stroke-linecap='round'/><path d='M12 3h3l1 1 1-1h3M16 4v24M12 29h3l1-1 1 1h3' fill='none' stroke='${fill}' stroke-width='1.4' stroke-linecap='round'/>`, size);
  const move = svg(`<path d='M16 2l5 5h-3.5v7.5H25V11l5 5-5 5v-3.5h-7.5V25H21l-5 5-5-5h3.5v-7.5H7V21l-5-5 5-5v3.5h7.5V7H11z' fill='${fill}' stroke='${stroke}' stroke-width='1.2' stroke-linejoin='round'/>`, size);
  return `
*, *::before, *::after { cursor: ${arrow} ${Math.round(2 * s)} ${Math.round(1.5 * s)}, default !important; }
a, a *, .lk { cursor: ${hand} ${Math.round(12 * s)} ${Math.round(3 * s)}, pointer !important; }
input:not([type]), input[type=text], input[type=password], input[type=search], input[type=email], input[type=url], textarea, .ps, .ps *, [contenteditable] { cursor: ${beam} ${Math.round(16 * s)} ${Math.round(16 * s)}, text !important; }
.win-bar { cursor: ${arrow} ${Math.round(2 * s)} ${Math.round(1.5 * s)}, default !important; }
.win-bar.dragging, .win-bar.dragging * { cursor: ${move} ${Math.round(16 * s)} ${Math.round(16 * s)}, move !important; }
button:disabled, [disabled] { cursor: ${arrow} ${Math.round(2 * s)} ${Math.round(1.5 * s)}, not-allowed !important; }`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Apply every appearance setting to the document. Called at start-up and on change. */
export function applyAppearance(): void {
  const a = appearance();
  const root = document.documentElement;
  const dark = a.mode === 'dark' || (a.mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  const [r, g, b] = hexToRgb(a.accent);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  // Windows lightens the accent in dark mode so text on it stays readable.
  const mix = (c: number, t: number): number => Math.round(c + (255 - c) * t);
  const accent = dark ? `rgb(${mix(r, 0.45)}, ${mix(g, 0.45)}, ${mix(b, 0.45)})` : a.accent;
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-hover', dark ? `rgb(${mix(r, 0.35)}, ${mix(g, 0.35)}, ${mix(b, 0.35)})` : `rgb(${Math.round(r * 0.88)}, ${Math.round(g * 0.88)}, ${Math.round(b * 0.88)})`);
  root.style.setProperty('--accent-ink', dark || lum > 0.6 ? '#000000' : '#ffffff');
  root.dataset.taskbar = a.taskbarAlign;
  root.dataset.icons = a.iconSize;
  root.dataset.desktopIcons = a.showDesktopIcons ? 'on' : 'off';
  root.dataset.transparency = a.transparency ? 'on' : 'off';
  root.dataset.animations = a.animations ? 'on' : 'off';
  let style = document.getElementById('cursor-style');
  if (!style) { style = document.createElement('style'); style.id = 'cursor-style'; document.head.appendChild(style); }
  style.textContent = cursorCss(a);
  const desk = document.querySelector('.desk') as HTMLElement | null;
  if (desk) applyWallpaper(desk);
}

export function wallpaperCss(): string {
  const a = appearance();
  if (a.solidColor) return a.solidColor;
  return backgroundFor(store.settings.wallpaper, 'wall');
}

export function lockScreenCss(): string {
  return backgroundFor(store.settings.lockScreen, 'lock');
}

export function applyWallpaper(el: HTMLElement): void {
  const a = appearance();
  el.style.background = wallpaperCss();
  if (!a.solidColor) el.style.backgroundSize = a.wallpaperFit === 'fill' ? 'cover' : a.wallpaperFit === 'fit' ? 'contain' : 'auto';
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (appearance().mode === 'system') applyAppearance(); });
