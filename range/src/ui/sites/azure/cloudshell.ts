/**
 * ui/sites/azure/cloudshell.ts — Cloud Shell: a PowerShell pane docked under
 * the portal, running in the current tenant's world and already connected to
 * Microsoft Graph, so AD and Graph cmdlets act on that company without -Server.
 * The pane is kept across portal navigation and rebuilt when the tenant or the
 * signed-in account changes.
 */
import { h } from '../../dom.ts';
import { mountPowerShell } from '../../apps/tools.ts';
import type { Portal } from './frame.ts';
import type { World } from '../../../core/types.ts';

let open = false;
let panel: { world: World; upn: string; el: HTMLElement; dispose: () => void } | null = null;

export function toggleCloudShell(): void {
  open = !open;
  if (!open) close();
}

function close(): void {
  open = false;
  panel?.dispose();
  panel?.el.remove();
  panel = null;
}

export function cloudShellPanel(p: Portal): HTMLElement | null {
  if (!open || !p.upn) return null;
  // Rebuilt when the tenant's world object changes (directory switch or a reset) or the account does.
  if (!panel || panel.world !== p.w || panel.upn !== p.upn) {
    panel?.dispose();
    const w = p.w;
    const term = h('div', { class: 'az-cloudshell-term' });
    const { dispose } = mountPowerShell(term, {
      compact: true,
      world: () => w,
      setup: (sh) => { sh.graphConnected = true; sh.graphScopes = ['openid', 'profile', 'email', 'User.ReadWrite.All', 'Group.ReadWrite.All', 'Directory.Read.All']; },
    });
    const el = h('section', { class: 'az-cloudshell', 'aria-label': 'Cloud Shell' },
      h('div', { class: 'az-cloudshell-bar' }, h('strong', null, 'PowerShell'), h('span', null, ` Cloud Shell · ${w.company.name} (${w.ad.domain}) · connected to Microsoft Graph as ${p.upn}`),
        h('button', { class: 'az-top-btn', type: 'button', title: 'Close Cloud Shell', onClick: () => close() }, '✕')),
      term);
    panel = { world: w, upn: p.upn, el, dispose };
  }
  return panel.el;
}
