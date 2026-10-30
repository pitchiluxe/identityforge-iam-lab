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
import { ensureLabPasswords } from '../world/labaccounts.ts';
import { ensureSamplePdfs } from '../world/docs.ts';
import { bindMeridian, exportHrFeeds, materialisedWorlds, persistCompanies, syncDue } from './companies.ts';
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
  markdown?: Partial<import('./apps/markdown.ts').MarkdownPrefs>;
  stickyNotes?: import('./apps/stickynotes.ts').StickyNote[];
  eventViewer?: import('./apps/eventviewer.ts').EventViewerState;
  office?: { recent?: string[] };
  notepad?: Partial<import('./apps/tools.ts').NotepadPrefs>;
  notepadpp?: import('./apps/notepadpp.ts').NppSettings;
  pdfxchange?: import('./apps/pdfxchange.ts').PdfxSettings;
  /** Seed ids of generated wallpapers, oldest first (see ui/wallpaperGenerator.ts). */
  generatedWallpapers?: string[];
  generatedLockScreens?: string[];
  appearance?: Partial<import('./theme.ts').Appearance>;
  pinned?: string[];
  scale?: number;
  nightLight?: boolean;
  notifications?: boolean;
  startRecommended?: boolean;
  /** Superseded by taskbar.search; read once for older saved settings. */
  taskbarSearch?: boolean;
  taskbar?: Partial<import('../core/taskbar.ts').TaskbarPrefs>;
  taskManager?: { speed?: 'high' | 'normal' | 'low' | 'paused'; startPage?: string };
  copilotNudges?: boolean;
  browser?: import('./apps/browser.ts').BrowserData;
  /** Lab Azure portal: signed-in account per tenant and the directory on screen. */
  azurePortal?: { sessions: Record<string, { upn: string; since: string }>; current: string };
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
  if (w && w.version === WORLD_VERSION) return ensureSamplePdfs(ensureLabPasswords(w));
  return createWorld(randomSeed());
}

export const store = {
  world: loadWorld(),
  career: load<Career>(CAREER_KEY) ?? { attempts: [] },
  settings: { model: null, rewordTickets: true, autoSync: true, ...(load<Settings>(SETTINGS_KEY) ?? {}) } as Settings,
  /** Answers typed in the interview drill, per scenario. */
  interviewAnswers: load<Record<string, string>>('identityforge-range-answers') ?? {},
};
bindMeridian(() => store.world);
exportHrFeeds(store.world);

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

let storageWarned = false;

export function persist(): void {
  save(WORLD_KEY, store.world);
  const { skipped } = persistCompanies();
  if (skipped.length && !storageWarned) {
    storageWarned = true;
    toast(`Browser storage is full: changes in ${skipped.length} MSP compan${skipped.length === 1 ? 'y' : 'ies'} are kept until you close the range, but not saved.`, 'err');
  }
  save(CAREER_KEY, store.career);
  save(SETTINGS_KEY, store.settings);
  save('identityforge-range-answers', store.interviewAnswers);
}

export function notify(): void {
  for (const fn of [...listeners]) {
    try { fn(); } catch (e) { console.error(e); }
  }
}

/**
 * Run an action against a world: Meridian unless another company's world is
 * given (ADUC Change Domain, -Server). Returns false (and shows the error) if it threw.
 */
export function act(fn: (w: World) => void, success?: string, target: World = store.world): boolean {
  try {
    fn(target);
    if (success) toast(success, 'ok');
    return true;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'err');
    return false;
  } finally {
    for (const s of target.scenarios) if (s.result) record(store.career, s);
    if (target !== store.world) exportHrFeeds(store.world);
    persist();
    notify();
  }
}

export function resetWorld(): void {
  store.world = createWorld(randomSeed());
  exportHrFeeds(store.world);
  persist();
  notify();
}

/** Background schedulers, like the real ones: Entra Connect every 30 minutes, Okta import hourly. */
export function startSchedulers(): void {
  setInterval(() => {
    if (!store.settings.autoSync) return;
    if (syncDue([store.world, ...materialisedWorlds()], Date.now()).length) { persist(); notify(); }
  }, 60_000);
}
