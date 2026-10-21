/**
 * core/taskbar.ts — the Windows 11 Settings > Personalization > Taskbar
 * options, as data. Pure, so the defaults, the migration from older saved
 * settings and the tray layout can be tested without a browser.
 */

export type SearchMode = 'hide' | 'icon' | 'iconLabel' | 'box';
export type CombineMode = 'always' | 'whenFull' | 'never';
export type TrayIconId = 'ai' | 'security' | 'vpn' | 'bluetooth' | 'update';

export interface TaskbarPrefs {
  /** Taskbar items. */
  search: SearchMode;
  copilot: boolean;
  taskView: boolean;
  /** System tray icons. */
  penMenu: boolean;
  /** Other system tray icons: on = always on the taskbar, off = in the hidden icons menu. */
  trayIcons: Record<TrayIconId, boolean>;
  hiddenIconMenu: boolean;
  /** Taskbar behaviours (alignment and clock seconds live with the appearance and clock settings). */
  autoHide: boolean;
  badges: boolean;
  flashing: boolean;
  showDesktopCorner: boolean;
  combine: CombineMode;
}

export const TRAY_ICONS: readonly { id: TrayIconId; label: string }[] = [
  { id: 'ai', label: 'IAM Copilot (Ollama)' },
  { id: 'security', label: 'Windows Security notification icon' },
  { id: 'vpn', label: 'VPN' },
  { id: 'bluetooth', label: 'Bluetooth Devices' },
  { id: 'update', label: 'Windows Update Status' },
];

export const DEFAULT_TASKBAR: TaskbarPrefs = {
  search: 'icon', copilot: true, taskView: true, penMenu: true,
  trayIcons: { ai: false, security: false, vpn: false, bluetooth: false, update: false },
  hiddenIconMenu: true, autoHide: false, badges: true, flashing: true, showDesktopCorner: true, combine: 'always',
};

/** Saved preferences over the defaults. `legacySearch` is the old on/off search switch. */
export function resolveTaskbar(saved: Partial<TaskbarPrefs> | undefined, legacySearch?: boolean): TaskbarPrefs {
  const p = { ...DEFAULT_TASKBAR, ...(saved ?? {}) };
  p.trayIcons = { ...DEFAULT_TASKBAR.trayIcons, ...(saved?.trayIcons ?? {}) };
  if (!saved?.search && legacySearch === false) p.search = 'hide';
  return p;
}

/** Which tray icons sit on the taskbar and which wait behind the ^ button. */
export function trayPlacement(p: TaskbarPrefs): { shown: TrayIconId[]; hidden: TrayIconId[]; chevron: boolean } {
  const ids = TRAY_ICONS.map((t) => t.id);
  // With the hidden icon menu off, Windows puts every icon on the taskbar.
  const shown = p.hiddenIconMenu ? ids.filter((id) => p.trayIcons[id]) : ids;
  const hidden = ids.filter((id) => !shown.includes(id));
  return { shown, hidden, chevron: p.hiddenIconMenu && hidden.length > 0 };
}

/** Whether taskbar buttons show their window titles (Combine taskbar buttons and hide labels). */
export function showLabels(mode: CombineMode, buttons: number, room = 8): boolean {
  return mode === 'never' || (mode === 'whenFull' && buttons <= room);
}
