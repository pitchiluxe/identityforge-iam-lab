/**
 * Active Directory Users and Computers: IAM Range's MMC replica, ported
 * unchanged (src/ui/aduc) and connected to this range's world through the
 * adapter in src/ui/aduc/shim/session.ts.
 */
import type { World } from '../../core/types.ts';
import { renderActiveDirectoryWindow } from '../aduc/window';
import { Dir, type VmServices, validatePassword } from '../aduc/shim/session';
import { setComputers } from '../aduc/model';
import { notify, persist, store, subscribe } from '../store.ts';
import type { AppDef } from '../wm.ts';

function syncComputers(w: World): void {
  setComputers(w.ad.computers.map((c) => ({
    name: c.name,
    description: c.primaryUser ? `Assigned to ${c.primaryUser}` : '',
    os: c.os.replace(/ \(.*\)$/, ''),
    osVersion: /Server/.test(c.os) ? '10.0 (20348)' : /Windows 10/.test(c.os) ? '10.0 (19045)' : '10.0 (22631)',
    role: c.name === 'MHS-DC01' ? 'Domain controller' : 'Workstation or server',
    container: c.name === 'MHS-DC01' ? 'dcs' : `ou:${c.ou}`,
  })));
}

export function aducServices(): VmServices {
  return {
    dir: new Dir(() => store.world),
    idp: { validatePassword },
    audit: null,
    cloud: null,
    pim: null,
    tickets: null,
    changed: () => { persist(); notify(); },
    onWorldChange: (fn) => subscribe(() => { syncComputers(store.world); fn(); }),
    world: () => store.world,
  };
}

export const aducApp: AppDef = {
  id: 'aduc',
  title: 'Active Directory Users and Computers',
  icon: 'aduc',
  width: 1120,
  height: 680,
  mount(host) {
    syncComputers(store.world);
    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex-direction:column;height:100%;';
    host.appendChild(body);
    renderActiveDirectoryWindow(body, aducServices());
  },
};
