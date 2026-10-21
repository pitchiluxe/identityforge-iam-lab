/**
 * ui/taskbarPrefs.ts — Settings > Personalization > Taskbar, stored with the
 * other settings and applied to the shell. The options themselves are in
 * core/taskbar.ts.
 */
import { type TaskbarPrefs, resolveTaskbar } from '../core/taskbar.ts';
import { notify, persist, store } from './store.ts';

export function taskbarPrefs(): TaskbarPrefs {
  return resolveTaskbar(store.settings.taskbar, store.settings.taskbarSearch);
}

export function setTaskbar(patch: Partial<TaskbarPrefs>): void {
  const cur = taskbarPrefs();
  store.settings.taskbar = { ...cur, ...patch, trayIcons: { ...cur.trayIcons, ...(patch.trayIcons ?? {}) } };
  persist();
  applyTaskbar();
  notify();
}

/** Behaviour the stylesheet carries (auto-hide). */
export function applyTaskbar(): void {
  document.documentElement.dataset.tbAutohide = taskbarPrefs().autoHide ? 'on' : 'off';
}
