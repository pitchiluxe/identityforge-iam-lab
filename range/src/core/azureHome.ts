import type { World } from './types.ts';
import { nowIso } from './time.ts';
export interface HomePreferences { recent: { id: string; time: string }[]; favorites: string[] }
export interface HomeResource { id: string; name: string; type: string; kind: 'group' | 'resource'; subscription: string; rg: string }
export function homeResources(w: World): HomeResource[] {
  return [
    ...(w.azure?.resourceGroups ?? []).map((g): HomeResource => ({ id: `rg:${g.subscription}/${g.name}`, name: g.name, type: 'Resource group', kind: 'group', subscription: g.subscription, rg: g.name })),
    ...(w.azure?.resources ?? []).map((r): HomeResource => ({ id: r.id, name: r.name, type: r.type.split('/').pop() ?? r.type, kind: 'resource', subscription: r.subscription, rg: r.rg })),
  ];
}
export function rememberResource(state: HomePreferences, id: string): void {
  state.recent = [{ id, time: nowIso() }, ...state.recent.filter((r) => r.id !== id)].slice(0, 20);
}
export function recentResources(w: World, state: HomePreferences): (HomeResource & { viewed: string })[] {
  const available = new Map(homeResources(w).map((r) => [r.id, r]));
  return state.recent.flatMap((v) => { const r = available.get(v.id); return r ? [{ ...r, viewed: v.time }] : []; });
}
export function favoriteResources(w: World, state: HomePreferences): HomeResource[] {
  return homeResources(w).filter((r) => state.favorites.includes(r.id));
}
export function toggleFavorite(state: HomePreferences, id: string): void {
  state.favorites = state.favorites.includes(id) ? state.favorites.filter((x) => x !== id) : [...state.favorites, id];
}
