/**
 * ui/wallpapers.ts — desktop and lock screen backgrounds, the same set as IAM
 * Range (../IAM_virtual-machine/src/util/wallpapers.ts): solid gradients, the
 * hospital wordmark, bundled artwork, and an unbounded generated queue.
 *
 * Each entry is a complete CSS `background` value, so the desktop, the lock
 * screen and the Settings thumbnails all paint the same thing.
 */
import { generateWallpaper, idToSeed } from './wallpaperGenerator.ts';

export interface Wallpaper {
  id: string;
  label: string;
  gradient: string;
}

/** Solid background with a large, quiet wordmark in the middle. */
function wordmark(bg: string, word: string, ink: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1920' height='1080'>
    <rect width='100%' height='100%' fill='${bg}'/>
    <text x='50%' y='50%' font-family='Segoe UI, -apple-system, sans-serif' font-size='200'
      font-weight='800' fill='${ink}' fill-opacity='0.32' text-anchor='middle'
      dominant-baseline='middle' letter-spacing='6'>${word}</text>
  </svg>`;
  return `${bg} url("data:image/svg+xml,${encodeURIComponent(svg)}") center/cover no-repeat`;
}

const COLOURS: Wallpaper[] = [
  { id: 'deep-blue', label: 'Deep Blue', gradient: 'linear-gradient(150deg,#0b3a5e 0%,#123f63 40%,#0e2438 100%)' },
  { id: 'slate', label: 'Slate', gradient: 'linear-gradient(150deg,#141a21 0%,#1e262f 45%,#0d1117 100%)' },
  { id: 'dusk', label: 'Dusk', gradient: 'linear-gradient(160deg,#2a1b3d 0%,#44318d 45%,#1b1032 100%)' },
  { id: 'forest', label: 'Forest', gradient: 'linear-gradient(150deg,#0d2818 0%,#14432a 45%,#08170f 100%)' },
  { id: 'magenta', label: 'Magenta', gradient: 'linear-gradient(160deg,#2a0d1e 0%,#5a1e42 45%,#2a0d1e 100%)' },
  { id: 'obsidian', label: 'Obsidian', gradient: 'linear-gradient(150deg,#0c0c0c 0%,#1f1f1f 45%,#0c0c0c 100%)' },
  { id: 'copper', label: 'Copper', gradient: 'linear-gradient(160deg,#2a1b0e 0%,#5a3a1e 45%,#2a1b0e 100%)' },
  { id: 'midnight-blue', label: 'Midnight Blue', gradient: 'linear-gradient(145deg,#0a1128 0%,#1a2456 60%,#0a1128 100%)' },
  { id: 'warm-amber', label: 'Warm Amber', gradient: 'linear-gradient(145deg,#241a0d 0%,#3d2e10 60%,#1a1000 100%)' },
  { id: 'purple-haze', label: 'Purple Haze', gradient: 'linear-gradient(160deg,#1a1029 0%,#3a2468 50%,#1a1029 100%)' },
  { id: 'rose-gold', label: 'Rose Gold', gradient: 'linear-gradient(150deg,#2b181c 0%,#5a333e 50%,#2b181c 100%)' },
  { id: 'windows-blue', label: 'Windows Blue', gradient: 'linear-gradient(135deg,#0b3d91 0%,#1e5fbf 35%,#5b8def 70%,#a7c7f2 100%)' },
];

const MARKS: Wallpaper[] = [
  { id: 'meridian-dark', label: 'Meridian Dark', gradient: wordmark('#0a0c10', 'MERIDIAN', '#5a6570') },
  { id: 'meridian-navy', label: 'Meridian Navy', gradient: wordmark('#08101a', 'MERIDIAN', '#3a5a7a') },
  { id: 'meridian-teal', label: 'Meridian Teal', gradient: wordmark('#07151a', 'MERIDIAN', '#3a8a8a') },
  { id: 'meridian-forest', label: 'Meridian Forest', gradient: wordmark('#09180f', 'MERIDIAN', '#3a7a4a') },
  { id: 'meridian-purple', label: 'Meridian Purple', gradient: wordmark('#120a1c', 'MERIDIAN', '#6a4a8a') },
  { id: 'meridian-crimson', label: 'Meridian Crimson', gradient: wordmark('#1a0a0e', 'MERIDIAN', '#8a3a45') },
  { id: 'meridian-gold', label: 'Meridian Gold', gradient: wordmark('#141008', 'MERIDIAN', '#8a6a2a') },
  { id: 'iam-slate', label: 'IAM Slate', gradient: wordmark('#10151c', 'IAM', '#4a5a6a') },
];

/** Vite's base path: '/' in dev and the desktop app, '/lab/' on the website. */
const ROOT = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

const ART: Wallpaper[] = [
  { id: 'blue-shield', label: 'Blue Glass Shield', gradient: `#07121f url("${ROOT}wallpapers/blue-shield.webp") center/cover no-repeat` },
  { id: 'network-constellation', label: 'Network Constellation', gradient: `#06121a url("${ROOT}wallpapers/network-constellation.webp") center/cover no-repeat` },
  { id: 'emerald-core', label: 'Emerald Secure Core', gradient: `#061411 url("${ROOT}wallpapers/emerald-core.webp") center/cover no-repeat` },
];

export const WALLPAPERS: Wallpaper[] = [...MARKS, ...COLOURS, ...ART];
export const LOCK_SCREENS: Wallpaper[] = [...COLOURS, ...MARKS, ...ART];

export const DEFAULT_WALLPAPER_ID = 'meridian-dark';
export const DEFAULT_LOCK_SCREEN_ID = 'deep-blue';
export const CUSTOM_WALLPAPER_KEY = 'identityforge-range-custom-wallpaper';

function custom(): string | null {
  try {
    const data = localStorage.getItem(CUSTOM_WALLPAPER_KEY);
    return data ? `#0b1a2c url("${data}") center/cover no-repeat` : null;
  } catch {
    return null;
  }
}

/** Resolve an id (built-in, generated or 'custom') to a CSS background. Unknown ids fall back. */
export function backgroundFor(id: string | undefined, kind: 'wall' | 'lock'): string {
  const table = kind === 'wall' ? WALLPAPERS : LOCK_SCREENS;
  const fallback = kind === 'wall' ? DEFAULT_WALLPAPER_ID : DEFAULT_LOCK_SCREEN_ID;
  if (id === 'custom') return custom() ?? backgroundFor(fallback, kind);
  const hit = table.find((w) => w.id === id) ?? WALLPAPERS.find((w) => w.id === id);
  if (hit) return hit.gradient;
  const seed = id ? idToSeed(id) : null;
  if (seed) return generateWallpaper(seed.seed, seed.kind).gradient;
  return table.find((w) => w.id === fallback)!.gradient;
}

/** Built-in plus the learner's generated wallpapers, as a picker shows them. */
export function allWallpapers(generated: readonly string[], kind: 'wall' | 'lock'): Wallpaper[] {
  const gen = generated.map((id) => idToSeed(id)).filter((x): x is { seed: number; kind: 'wall' | 'lock' } => !!x).map((x) => generateWallpaper(x.seed, x.kind));
  return [...(kind === 'wall' ? WALLPAPERS : LOCK_SCREENS), ...gen];
}
