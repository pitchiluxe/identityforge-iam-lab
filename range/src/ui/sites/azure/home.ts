import { nowMs, fmt } from '../../../core/time.ts';
import { favoriteResources, homeResources, recentResources, rememberResource, toggleFavorite, type HomePreferences, type HomeResource } from '../../../core/azureHome.ts';
import { ensureAzure, LIGHT_SERVICES } from '../../../world/azure.ts';
import { h } from '../../dom.ts';
import { store, persist } from '../../store.ts';
import { serviceIcon, type ServiceIcon } from './serviceIcons.ts';
import { blade, type Portal } from './frame.ts';
import type { Route } from './routes.ts';

let resourcesTab: 'recent' | 'favorite' = 'recent';
export function homePreferences(domain: string): HomePreferences {
  const all = (store.settings.azureHome ??= {});
  return (all[domain] ??= { recent: [], favorites: [] });
}
const resourceRoute = (r: HomeResource): Route => r.kind === 'group' ? { k: 'resourcegroup', sub: r.subscription, rg: r.rg, blade: 'overview' } : { k: 'resource', id: r.id, blade: 'overview' };
export function recordResourceView(p: Portal, r: Route): void {
  if (r.k !== 'resource' && r.k !== 'resourcegroup') return;
  const id = r.k === 'resource' ? r.id : `rg:${r.sub}/${r.rg}`;
  if (!homeResources(p.w).some((x) => x.id === id)) return;
  rememberResource(homePreferences(p.domain), id); persist();
}
function viewedLabel(iso: string | undefined): string {
  if (!iso) return '—';
  const minutes = Math.max(0, Math.floor((nowMs() - Date.parse(iso)) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24); return `${days} day${days === 1 ? '' : 's'} ago`;
}
function shortcut(p: Portal, label: string, icon: ServiceIcon, route: Route, cls = 'az-home-shortcut'): HTMLElement {
  return h('button', { class: cls, type: 'button', onClick: () => p.go(route) }, serviceIcon(icon), h('span', null, label));
}
function resourceTable(p: Portal, items: HomeResource[], prefs: HomePreferences): HTMLElement {
  return h('table', { class: 'az-home-resources' },
    h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Type'), h('th', null, 'Last Viewed'), h('th', { 'aria-label': 'Favorite' }))),
    h('tbody', null, ...items.map((r) => {
      const time = prefs.recent.find((v) => v.id === r.id)?.time;
      const saved = prefs.favorites.includes(r.id);
      return h('tr', null, h('td', null, h('a', { href: '#', onClick: (e: Event) => { e.preventDefault(); p.go(resourceRoute(r)); } }, serviceIcon(r.kind === 'group' ? 'rg' : 'resources'), r.name)),
        h('td', null, r.type), h('td', { title: time ? fmt(time) : '' }, viewedLabel(time)),
        h('td', null, h('button', { class: 'az-favorite', type: 'button', 'aria-label': `${saved ? 'Remove' : 'Add'} favorite ${r.name}`, 'aria-pressed': String(saved), onClick: () => { toggleFavorite(prefs, r.id); persist(); p.ctx.go(p.ctx.path); } }, saved ? '★' : '☆')));
    })));
}
export function azureHome(p: Portal): HTMLElement {
  ensureAzure(p.w);
  const prefs = homePreferences(p.domain);
  const items = resourcesTab === 'recent' ? recentResources(p.w, prefs) : favoriteResources(p.w, prefs);
  const svc = (name: string): Route => ({ k: 'service', name });
  const tools: [string, string, ServiceIcon, () => void][] = [
    ['Microsoft Learn ↗', 'Learn Azure with free online training from Microsoft', 'learn', () => p.ctx.open('https://learn.microsoft.com/training/')],
    ['Azure Monitor', 'Monitor your apps and infrastructure', 'monitor', () => p.go(svc('Azure Monitor'))],
    ['Microsoft Defender for Cloud', 'Secure your apps and infrastructure', 'defender', () => p.go(svc('Microsoft Defender for Cloud'))],
    ['Cost Management', 'Analyze and optimize your cloud spend for free', 'cost', () => p.go(svc('Cost Management + Billing'))],
  ];
  return h('div', { class: 'az-home' },
    h('section', { class: 'az-home-section' }, h('h2', null, 'Azure services'), h('div', { class: 'az-home-services' },
      shortcut(p, 'Create a resource', 'create', svc('Create a resource')), shortcut(p, 'Microsoft Entra ID', 'entra', { k: 'entra', page: 'overview' }),
      shortcut(p, 'Virtual machines', 'vm', { k: 'resources', type: 'Microsoft.Compute/virtualMachines' }), shortcut(p, 'Resource groups', 'rg', { k: 'resourcegroups' }),
      shortcut(p, 'Monitor', 'monitor', svc('Azure Monitor')), shortcut(p, 'Quickstart Center', 'rocket', svc('Quickstart Center')),
      shortcut(p, 'Foundry', 'foundry', svc('Microsoft Foundry')), shortcut(p, 'Kubernetes services', 'kubernetes', svc('Azure Kubernetes Service')),
      shortcut(p, 'App Services', 'app', { k: 'resources', type: 'Microsoft.Web/sites' }), shortcut(p, 'More services', 'arrow', { k: 'allservices' }))),
    h('section', { class: 'az-home-section az-home-history' }, h('h2', null, 'Resources'),
      h('div', { class: 'az-home-tabs', role: 'tablist', 'aria-label': 'Resources' }, (['recent', 'favorite'] as const).map((tab) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(resourcesTab === tab), class: resourcesTab === tab ? 'on' : '', onClick: () => { resourcesTab = tab; p.ctx.go(p.ctx.path); } }, tab === 'recent' ? 'Recent' : 'Favorite'))),
      resourceTable(p, items, prefs), items.length ? null : h('p', { class: 'az-home-empty' }, resourcesTab === 'recent' ? 'No recent resources. Open a resource to see it here.' : 'No favorites yet. Use the star beside a recent resource to add one.'),
      h('a', { href: '#', class: 'az-home-seeall', onClick: (e: Event) => { e.preventDefault(); p.go({ k: 'resources' }); } }, 'See all')),
    h('section', { class: 'az-home-section' }, h('h2', null, 'Navigate'), h('div', { class: 'az-home-navigation' },
      shortcut(p, 'Subscriptions', 'key', { k: 'subscriptions' }, 'az-home-navlink'), shortcut(p, 'Resource groups', 'rg', { k: 'resourcegroups' }, 'az-home-navlink'),
      shortcut(p, 'All resources', 'resources', { k: 'resources' }, 'az-home-navlink'), shortcut(p, 'Dashboard', 'dashboard', svc('Dashboard'), 'az-home-navlink'))),
    h('section', { class: 'az-home-section az-home-tools-section' }, h('h2', null, 'Tools'), h('div', { class: 'az-home-tools' }, tools.map(([title, text, icon, run]) =>
      h('button', { class: 'az-home-tool', type: 'button', onClick: run }, serviceIcon(icon), h('span', null, h('span', { class: 'az-home-tool-title' }, title), h('span', { class: 'az-home-tool-text' }, text)))))));
}
export function homeServicePage(p: Portal, name: string): HTMLElement | null {
  if (name === 'Create a resource') return blade(name, 'Choose a lab service', [], h('div', { class: 'az-cards' }, LIGHT_SERVICES.map((s) =>
    h('button', { class: 'az-card az-create-card', type: 'button', onClick: () => p.go({ k: 'create', type: s.type }) }, serviceIcon(s.type === 'Microsoft.Compute/virtualMachines' ? 'vm' : s.type === 'Microsoft.Web/sites' ? 'app' : 'resources'), h('strong', null, s.label), h('span', null, 'Create')))));
  if (name === 'Quickstart Center') return blade(name, 'Get started with your lab tenant', [], h('div', { class: 'az-cards' },
    shortcut(p, 'Manage identities with Microsoft Entra ID', 'entra', { k: 'entra', page: 'overview' }), shortcut(p, 'Organize resources', 'rg', { k: 'resourcegroups' }), shortcut(p, 'Create your first resource', 'create', { k: 'service', name: 'Create a resource' })));
  if (name === 'Dashboard') {
    const estate = ensureAzure(p.w); const prefs = homePreferences(p.domain);
    return blade(name, p.w.company.name, [], h('div', { class: 'az-cards' },
      h('section', { class: 'az-card' }, h('h3', null, 'Subscriptions'), String(estate.subscriptions.length)), h('section', { class: 'az-card' }, h('h3', null, 'Resource groups'), String(estate.resourceGroups.length)),
      h('section', { class: 'az-card' }, h('h3', null, 'Resources'), String(estate.resources.length))), h('h2', null, 'Favorite resources'), resourceTable(p, favoriteResources(p.w, prefs), prefs));
  }
  return null;
}
