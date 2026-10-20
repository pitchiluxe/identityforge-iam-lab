/**
 * ui/updates.ts — the installed edition's auto-update, as the page sees it.
 *
 * The desktop app (electron/main.cjs) checks GitHub Releases on start and every
 * six hours, downloads a new release in the background, and installs it when
 * the app closes. This module reports that state to Settings > Windows Update
 * and offers "Restart now" once a release has downloaded. In a plain browser
 * there is no updater, and the page says so instead of pretending.
 */
import { h } from './dom.ts';
import { PRODUCT_RELEASES_URL } from '../product.ts';

export interface UpdateStatus {
  state: 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
  info: { version?: string; progress?: number } | null;
  error: string | null;
  lastCheck: string | null;
  version: string;
}

interface DesktopBridge {
  desktop: true;
  version: string;
  updateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  installUpdate(): Promise<boolean>;
  onUpdateStatus(fn: (s: UpdateStatus) => void): () => void;
}

const bridge = (globalThis as unknown as { meridianDesktop?: DesktopBridge }).meridianDesktop;

export const isDesktop = !!bridge;
export const appVersion = bridge?.version ?? 'web';
export let updateStatus: UpdateStatus = { state: 'unsupported', info: null, error: null, lastCheck: null, version: appVersion };
const listeners = new Set<() => void>();

export function onUpdateChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set(s: UpdateStatus): void {
  const was = updateStatus.state;
  updateStatus = s;
  for (const fn of listeners) fn();
  if (s.state === 'downloaded' && was !== 'downloaded') showReadyBanner();
}

export function checkForUpdates(): void {
  if (!bridge) { window.open(PRODUCT_RELEASES_URL, '_blank', 'noopener,noreferrer'); return; }
  updateStatus = { ...updateStatus, state: 'checking' };
  for (const fn of listeners) fn();
  void bridge.checkForUpdates().then(set);
}

export function installUpdate(): void {
  void bridge?.installUpdate();
}

function showReadyBanner(): void {
  document.querySelector('.upd-banner')?.remove();
  const banner = h('div', { class: 'upd-banner', role: 'status' },
    h('span', { class: 'mdl' }, ''),
    h('div', null, h('strong', null, `Update ${updateStatus.info?.version ?? ''} is ready`), h('span', null, 'Restart to finish installing. Your saved work is kept.')),
    h('button', { class: 'upd-now', type: 'button', onClick: installUpdate }, 'Restart now'),
    h('button', { class: 'upd-later', type: 'button', onClick: () => banner.remove() }, 'Later'));
  document.body.appendChild(banner);
}

export function installUpdateWatcher(): void {
  if (!bridge) return;
  void bridge.updateStatus().then(set);
  bridge.onUpdateStatus(set);
}
