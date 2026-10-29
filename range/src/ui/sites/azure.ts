/**
 * Lab Azure portal (simulated), at https://portal.azure.range.
 *
 * Signs in to any of the eleven lab tenants (Meridian and the ten MSP
 * customers), with a directory switcher like the real portal. Microsoft Entra
 * ID is modelled in depth; Azure resources lightly, with full Access control
 * (IAM) on every scope. Every page carries the simulation marker: it is a
 * training copy, never a place for a real Microsoft password.
 */
import { h } from '../dom.ts';
import { store } from '../store.ts';
import { allDomains } from '../companies.ts';
import { ensureAzure, LIGHT_SERVICES } from '../../world/azure.ts';
import type { Site, SiteCtx } from './common.ts';
import { MARKER, portal, portalState, signOut, switchDirectory, type Portal } from './azure/frame.ts';
import { ALL_SERVICES, parseRoute, portalSearch, routePath, type Route } from './azure/routes.ts';
import { signInPage, signUpPage } from './azure/signin.ts';
import { entraGroupPage, entraPage, entraRolePage, entraUserPage } from './azure/entra.ts';
import { appRegPage, entAppPage } from './azure/apps.ts';
import { cloudShellPanel, toggleCloudShell } from './azure/cloudshell.ts';
import { createPage, resourceGroupPage, resourceGroupsPage, resourcePage, resourcesPage, servicePage, subscriptionPage, subscriptionsPage } from './azure/arm.ts';

let searchText = '';
let menuOpen: 'directory' | 'account' | 'notifications' | null = null;

const ENTRA_NAV: [string, Route][] = [
  ['Overview', { k: 'entra', page: 'overview' }], ['Users', { k: 'entra', page: 'users' }], ['Groups', { k: 'entra', page: 'groups' }],
  ['Devices', { k: 'entra', page: 'devices' }], ['Roles and administrators', { k: 'entra', page: 'roles' }], ['Licenses', { k: 'entra', page: 'licenses' }],
  ['App registrations', { k: 'entra', page: 'apps' }], ['Enterprise applications', { k: 'entra', page: 'enterprise' }], ['Privileged Identity Management', { k: 'entra', page: 'pim' }], ['Authentication methods', { k: 'entra', page: 'authmethods' }], ['Conditional Access', { k: 'entra', page: 'ca' }], ['Identity Protection', { k: 'entra', page: 'idprotection' }], ['Administrative units', { k: 'entra', page: 'adminunits' }], ['External Identities', { k: 'entra', page: 'external' }],
  ['Sign-in logs', { k: 'entra', page: 'signins' }], ['Audit logs', { k: 'entra', page: 'audit' }], ['Microsoft Entra Connect', { k: 'entra', page: 'connect' }],
];

function tile(p: Portal, label: string, glyph: string, r: Route): HTMLElement {
  return h('button', { class: 'az-tile', type: 'button', onClick: () => p.go(r) }, h('span', { class: 'az-tile-ic', 'aria-hidden': 'true' }, glyph), h('span', null, label));
}

function home(p: Portal): HTMLElement {
  ensureAzure(p.w);
  return h('div', { class: 'az-home' },
    h('h2', null, 'Azure services'),
    h('div', { class: 'az-tiles' },
      tile(p, 'Microsoft Entra ID', '\u{1F6E1}', { k: 'entra', page: 'overview' }), tile(p, 'Users', '\u{1F464}', { k: 'entra', page: 'users' }),
      tile(p, 'Groups', '\u{1F465}', { k: 'entra', page: 'groups' }), tile(p, 'Subscriptions', '\u{1F511}', { k: 'subscriptions' }),
      tile(p, 'Resource groups', '\u{1F4E6}', { k: 'resourcegroups' }), tile(p, 'All resources', '▦', { k: 'resources' }),
      tile(p, 'Virtual machines', '\u{1F5A5}', { k: 'resources', type: 'Microsoft.Compute/virtualMachines' }), tile(p, 'More services', '→', { k: 'allservices' })),
    h('h2', null, 'Navigate'),
    h('div', { class: 'az-tiles small' }, tile(p, 'Subscriptions', '\u{1F511}', { k: 'subscriptions' }), tile(p, 'Resource groups', '\u{1F4E6}', { k: 'resourcegroups' }), tile(p, 'All resources', '▦', { k: 'resources' })));
}

function allServices(p: Portal): HTMLElement {
  const group = (title: string, items: [string, Route][]): HTMLElement => h('section', { class: 'az-card' }, h('h3', null, title),
    h('div', { class: 'az-svc-list' }, items.map(([label, r]) => h('a', { href: '#', onClick: (e: Event) => { e.preventDefault(); p.go(r); } }, label))));
  return h('div', { class: 'az-blade' }, h('div', { class: 'az-blade-head' }, h('h1', null, 'All services')),
    group('Identity', [['Microsoft Entra ID', { k: 'entra', page: 'overview' }], ...ENTRA_NAV.slice(1)]),
    group('General', [['Subscriptions', { k: 'subscriptions' }], ['Resource groups', { k: 'resourcegroups' }], ['All resources', { k: 'resources' }]]),
    group('Lab services', LIGHT_SERVICES.map((s): [string, Route] => [s.plural, { k: 'resources', type: s.type }])),
    group('Other Azure services (not modelled in the lab)', ALL_SERVICES.map((n): [string, Route] => [n, { k: 'service', name: n }])));
}

function crumbs(r: Route, p: Portal): [string, Route | null][] {
  const homeC: [string, Route] = ['Home', { k: 'home' }];
  const entraC: [string, Route] = [p.w.company.name, { k: 'entra', page: 'overview' }];
  switch (r.k) {
    case 'entra': return r.page === 'overview' ? [homeC] : [homeC, entraC];
    case 'entraUser': return [homeC, entraC, ['Users', { k: 'entra', page: 'users' }]];
    case 'entraGroup': return [homeC, entraC, ['Groups', { k: 'entra', page: 'groups' }]];
    case 'entraRole': return [homeC, entraC, ['Roles and administrators', { k: 'entra', page: 'roles' }]];
    case 'appReg': return [homeC, entraC, ['App registrations', { k: 'entra', page: 'apps' }]];
    case 'entApp': return [homeC, entraC, ['Enterprise applications', { k: 'entra', page: 'enterprise' }]];
    case 'subscription': return [homeC, ['Subscriptions', { k: 'subscriptions' }]];
    case 'resourcegroup': return [homeC, ['Resource groups', { k: 'resourcegroups' }]];
    case 'resource': return [homeC, ['All resources', { k: 'resources' }]];
    default: return r.k === 'home' ? [] : [homeC];
  }
}

function content(p: Portal, r: Route): HTMLElement {
  switch (r.k) {
    case 'home': return home(p);
    case 'allservices': return allServices(p);
    case 'entra': return entraPage(p, r.page);
    case 'entraUser': return entraUserPage(p, r.upn, r.tab);
    case 'entraGroup': return entraGroupPage(p, r.name);
    case 'entraRole': return entraRolePage(p, r.role);
    case 'appReg': return appRegPage(p, r.appId);
    case 'entApp': return entAppPage(p, r.id);
    case 'subscriptions': return subscriptionsPage(p);
    case 'subscription': return subscriptionPage(p, r.id, r.blade);
    case 'resourcegroups': return resourceGroupsPage(p);
    case 'resourcegroup': return resourceGroupPage(p, r.sub, r.rg, r.blade);
    case 'resources': return resourcesPage(p, r.type);
    case 'resource': return resourcePage(p, r.id, r.blade);
    case 'create': return createPage(p, r.type);
    case 'service': return servicePage(p, r.name);
    default: return h('div', { class: 'az-blade' }, h('h1', null, '404 - Not found'), h('p', null, "The page you're looking for doesn't exist."));
  }
}

function topBar(p: Portal): HTMLElement {
  const q = h('input', { class: 'az-search', type: 'search', placeholder: 'Search resources, services, and docs (G+/)', value: searchText, 'aria-label': 'Search' });
  q.addEventListener('input', () => { searchText = q.value; });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') p.ctx.go(p.ctx.path); if (e.key === 'Escape') { searchText = ''; p.ctx.go(p.ctx.path); } });
  const hits = portalSearch(p.w, searchText);
  const st = portalState();
  const toggle = (m: typeof menuOpen): void => { menuOpen = menuOpen === m ? null : m; p.ctx.go(p.ctx.path); };
  const mine = p.upn ? p.w.audit.filter((e) => e.actor === p.upn).slice(-5).reverse() : [];
  return h('header', { class: 'az-top' },
    h('a', { href: '#', class: 'az-brand', onClick: (e: Event) => { e.preventDefault(); p.go({ k: 'home' }); } }, 'Microsoft Azure', h('span', { class: 'az-lab' }, 'lab')),
    h('div', { class: 'az-search-wrap' }, q, searchText.trim().length >= 2 ? h('div', { class: 'az-search-results', role: 'listbox' },
      hits.length ? hits.map((x) => h('a', { href: '#', onClick: (e: Event) => { e.preventDefault(); searchText = ''; p.ctx.go(x.path); } }, h('span', null, x.label), h('small', null, x.kind)))
        : h('div', { class: 'empty' }, `No results for "${searchText}".`)) : null),
    h('span', { class: 'az-marker', title: MARKER }, 'Training simulation'),
    h('div', { class: 'az-top-actions' },
      h('button', { class: 'az-top-btn', type: 'button', title: 'Cloud Shell', onClick: () => { toggleCloudShell(); p.ctx.go(p.ctx.path); } }, '>_'),
      h('button', { class: 'az-top-btn', type: 'button', title: 'Notifications', onClick: () => toggle('notifications') }, '\u{1F514}'),
      h('button', { class: 'az-top-btn', type: 'button', title: 'Directories + subscriptions', onClick: () => toggle('directory') }, '⇄'),
      h('button', { class: 'az-account', type: 'button', onClick: () => toggle('account') }, h('span', null, p.upn ?? 'Not signed in'), h('small', null, p.w.company.name.toUpperCase()))),
    menuOpen === 'notifications' ? h('div', { class: 'az-pop' }, h('h3', null, 'Notifications'), mine.length ? mine.map((e) => h('div', { class: 'az-note' }, h('strong', null, e.action), h('span', null, e.target))) : h('p', { class: 'empty' }, 'No new notifications.')) : null,
    menuOpen === 'directory' ? h('div', { class: 'az-pop' }, h('h3', null, 'Directories + subscriptions'),
      allDomains().map((d) => h('button', { class: `az-dir ${d.domain === p.domain ? 'on' : ''}`, type: 'button', onClick: () => { menuOpen = null; switchDirectory(d.domain); p.go({ k: 'home' }); } },
        h('strong', null, d.name), h('span', null, d.domain), st.sessions[d.domain] ? h('small', null, st.sessions[d.domain]!.upn) : h('small', null, 'Sign-in required')))) : null,
    menuOpen === 'account' ? h('div', { class: 'az-pop' }, h('h3', null, p.upn ?? ''), h('p', { class: 'muted' }, p.w.company.name),
      h('button', { class: 'btn', type: 'button', onClick: () => { menuOpen = null; signOut(p.domain); p.ctx.go('/signin'); } }, 'Sign out')) : null);
}

function leftNav(p: Portal, r: Route): HTMLElement | null {
  const inEntra = r.k === 'entra' || r.k === 'entraUser' || r.k === 'entraGroup' || r.k === 'entraRole' || r.k === 'appReg' || r.k === 'entApp';
  const items: [string, Route][] = inEntra ? ENTRA_NAV : [['Home', { k: 'home' }], ['All services', { k: 'allservices' }], ['Microsoft Entra ID', { k: 'entra', page: 'overview' }], ['Subscriptions', { k: 'subscriptions' }], ['Resource groups', { k: 'resourcegroups' }], ['All resources', { k: 'resources' }]];
  const here = routePath(r);
  return h('nav', { class: 'az-nav', 'aria-label': 'Portal menu' }, items.map(([label, to]) => {
    const path = routePath(to);
    const on = here === path || (path !== '/' && path !== '/entra' && here.startsWith(`${path}/`));
    return h('a', { href: '#', class: on ? 'on' : '', onClick: (e: Event) => { e.preventDefault(); p.go(to); } }, label);
  }));
}

export const azurePortal: Site = {
  host: 'portal.azure.range',
  name: 'Microsoft Azure',
  short: 'Azure',
  color: '#0078d4',
  render(ctx: SiteCtx) {
    const p = portal(ctx);
    const r = parseRoute(ctx.path);
    if (r.k === 'signup') return h('div', { class: 'az' }, signUpPage(p));
    if (!p.upn || r.k === 'signin') return h('div', { class: 'az' }, signInPage(p));
    const trail = crumbs(r, p);
    return h('div', { class: 'az' },
      topBar(p),
      h('div', { class: 'az-body' },
        leftNav(p, r),
        h('main', { class: 'az-main', 'data-keep-scroll': '' },
          trail.length ? h('div', { class: 'az-crumbs' }, trail.map(([label, to]) => h('span', null, to ? h('a', { href: '#', onClick: (e: Event) => { e.preventDefault(); p.go(to); } }, label) : label, ' › '))) : null,
          content(p, r))),
      cloudShellPanel(p),
      h('footer', { class: 'az-foot' }, MARKER, ` Workstation: ${store.world.ad.netbios}.`));
  },
};
