/**
 * ui/store.ts — the running world, saved in this browser.
 *
 * Every UI action goes through act(): it runs against the world, turns
 * thrown errors into a toast (the same text an admin would see), saves, and
 * tells open windows to redraw. Storage can be unavailable (private window,
 * blocked site data); the range still works, it just will not remember.
 */
import type { World } from '../core/types.ts';
import type { Career } from '../core/career.ts';
import { record } from '../core/career.ts';
import { randomSeed } from '../core/rng.ts';
import { createWorld, WORLD_VERSION } from '../world/seed.ts';
import { runEntraSync, runOktaImport } from '../world/cloud.ts';
import { toast } from './dom.ts';

const WORLD_KEY = 'identityforge-range-world';
const CAREER_KEY = 'identityforge-range-career';
const SETTINGS_KEY = 'identityforge-range-settings';

export interface Settings {
  wallpaper?: string;
  lockScreen?: string;
  settingsV2?: boolean;
  system?: Partial<import('./system.ts').SystemSettings>;
  terminal?: Partial<import('./apps/terminal.ts').TerminalSettings>;
  security?: import('./apps/security.ts').SecurityState;
  notepad?: Partial<import('./apps/tools.ts').NotepadPrefs>;
  /** Seed ids of generated wallpapers, oldest first (see ui/wallpaperGenerator.ts). */
  generatedWallpapers?: string[];
  generatedLockScreens?: string[];
  appearance?: Partial<import('./theme.ts').Appearance>;
  pinned?: string[];
  scale?: number;
  nightLight?: boolean;
  notifications?: boolean;
  startRecommended?: boolean;
  taskbarSearch?: boolean;
  copilotNudges?: boolean;
  browser?: import('./apps/browser.ts').BrowserData;
  model: string | null;
  rewordTickets: boolean;
  autoSync: boolean;
}

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: keep working in memory.
  }
}

const listeners = new Set<() => void>();

function loadWorld(): World {
  const w = load<World>(WORLD_KEY);
  if (w && w.version === WORLD_VERSION) return w;
  return createWorld(randomSeed());
}

export const store = {
  world: loadWorld(),
  career: load<Career>(CAREER_KEY) ?? { attempts: [] },
  settings: { model: null, rewordTickets: true, autoSync: true, ...(load<Settings>(SETTINGS_KEY) ?? {}) } as Settings,
  /** Answers typed in the interview drill, per scenario. */
  interviewAnswers: load<Record<string, string>>('identityforge-range-answers') ?? {},
};

// The image wallpapers stopped being the default in settings v2. A choice saved
// before then was the old default, not a decision, so it moves to the new one.
if (!store.settings.settingsV2) {
  if (['blue-shield', 'network-constellation', 'emerald-core'].includes(store.settings.wallpaper ?? '')) delete store.settings.wallpaper;
  store.settings.settingsV2 = true;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function persist(): void {
  save(WORLD_KEY, store.world);
  save(CAREER_KEY, store.career);
  save(SETTINGS_KEY, store.settings);
  save('identityforge-range-answers', store.interviewAnswers);
}

export function notify(): void {
  for (const fn of [...listeners]) {
    try { fn(); } catch (e) { console.error(e); }
  }
}

/** Run an action against the world. Returns false (and shows the error) if it threw. */
export function act(fn: (w: World) => void, success?: string): boolean {
  try {
    fn(store.world);
    if (success) toast(success, 'ok');
    return true;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'err');
    return false;
  } finally {
    for (const s of store.world.scenarios) if (s.result) record(store.career, s);
    persist();
    notify();
  }
}

export function resetWorld(): void {
  store.world = createWorld(randomSeed());
  persist();
  notify();
}

/** Background schedulers, like the real ones: Entra Connect every 30 minutes, Okta import hourly. */
export function startSchedulers(): void {
  setInterval(() => {
    if (!store.settings.autoSync) return;
    const w = store.world;
    const now = Date.now();
    let changed = false;
    if (now - Date.parse(w.entra.lastSync) > 30 * 60_000) { runEntraSync(w, 'Microsoft Entra Connect (scheduler)'); changed = true; }
    if (now - Date.parse(w.okta.lastImport) > 60 * 60_000) { runOktaImport(w, 'Okta AD Agent (scheduled import)'); changed = true; }
    if (changed) { persist(); notify(); }
  }, 60_000);
}
