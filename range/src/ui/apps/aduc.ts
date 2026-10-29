/**
 * Active Directory Users and Computers: IAM Range's MMC replica, ported
 * unchanged (src/ui/aduc) and connected to this range's world through the
 * adapter in src/ui/aduc/shim/session.ts.
 */
import type { World } from '../../core/types.ts';
import { renderActiveDirectoryWindow } from '../aduc/window';
import { Dir, type VmServices, validatePassword } from '../aduc/shim/session';
import { setAducDomain, setComputers } from '../aduc/model';
import { notify, persist, store, subscribe } from '../store.ts';
import { allDomains, worldByDomain } from '../companies.ts';
import { profileById } from '../../world/profiles.ts';
import type { AppDef } from '../wm.ts';

function syncComputers(w: World): void {
  setComputers(w.ad.computers.map((c) => ({
    name: c.name,
    description: c.primaryUser ? `Assigned to ${c.primaryUser}` : '',
    os: c.os.replace(/ \(.*\)$/, ''),
    osVersion: /Server/.test(c.os) ? '10.0 (20348)' : /Windows 10/.test(c.os) ? '10.0 (19045)' : '10.0 (22631)',
    role: c.name.endsWith('-DC01') ? 'Domain controller' : 'Workstation or server',
    container: c.name.endsWith('-DC01') || c.ou === 'Domain Controllers' ? 'dcs' : c.ou === 'Computers' ? 'computers' : `ou:${c.ou}`,
  })));
}

/** The domain controller a console connected to this world talks to (MHS-DC01, KMF-DC01, ...). */
function dcHost(w: World): string {
  return `${(w.profileId && profileById(w.profileId)?.prefix) || 'MHS'}-DC01`;
}

/**
 * Services for one console window. It starts on Meridian; Change Domain moves
 * it to another company's domain, and every read and write follows.
 */
export function aducServices(alive: () => boolean = () => true): VmServices {
  let current: World | null = null;
  const world = (): World => current ?? store.world;
  const connect = (w: World): void => { setAducDomain(w.ad.domain, w.ad.netbios, dcHost(w)); syncComputers(w); };
  connect(world());
  return {
    dir: new Dir(world),
    idp: { validatePassword },
    audit: null,
    cloud: null,
    pim: null,
    tickets: null,
    changed: () => { persist(); notify(); },
    // A closed console must not keep re-pointing the shared domain bindings (ui/aduc/model.ts).
    onWorldChange: (fn) => subscribe(() => { if (alive()) { connect(world()); fn(); } }),
    world,
    domains: () => allDomains().map((d) => d.domain),
    changeDomain: (domain) => {
      const w = worldByDomain(domain);
      if (!w) throw new Error(`The specified domain either does not exist or could not be contacted.`);
      current = w === store.world ? null : w;
      connect(w);
      notify();
    },
  };
}

export const aducApp: AppDef = {
  id: 'aduc',
  title: 'Active Directory Users and Computers',
  icon: 'aduc',
  width: 1120,
  height: 680,
  mount(host) {
    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex-direction:column;height:100%;';
    host.appendChild(body);
    renderActiveDirectoryWindow(body, aducServices(() => body.isConnected));
  },
};
