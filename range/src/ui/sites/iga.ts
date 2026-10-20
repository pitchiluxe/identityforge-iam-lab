/**
 * Identity Governance console (simulated; modelled on SailPoint Identity
 * Security Cloud, with Saviynt's names for the same things in brackets):
 * identities, sources and aggregation, uncorrelated accounts, certification
 * campaigns with filters and bulk decisions, access exceptions, SoD policies.
 */
import type { Campaign, CertItem, IgaAccount } from '../../core/types.ts';
import { fmt, fmtDate } from '../../core/time.ts';
import { eventsFor } from '../../world/audit.ts';
import { SAVIYNT_TERMS, aggregate, correlate, decide, disableAccount, ensureIga, identities, identityOf, isNonHuman, reassign, signOff, uncorrelatedAccounts, undo } from '../../world/iga.ts';
import { badge, button, h, table, toast } from '../dom.ts';
import { act, store } from '../store.ts';
import { type Site, type SiteCtx, empty, kv, link, shell } from './common.ts';

let idQuery = '';
let certFilter: { decision: string; flag: string; text: string } = { decision: 'pending', flag: '', text: '' };
const selected = new Set<string>();
let comment = '';

const term = (sp: string): HTMLElement => h('span', { class: 'muted', title: `Saviynt: ${SAVIYNT_TERMS[sp] ?? sp}` }, ` [${SAVIYNT_TERMS[sp] ?? sp}]`);
const statusBadge = (s: string): HTMLElement => badge(s, s === 'Active' ? 'ok' : s === 'Terminated' ? 'bad' : 'warn');
const flagBadge = (f: string): HTMLElement => badge(f, f === 'Terminated' || f.startsWith('SoD') ? 'bad' : f === 'Outside role' || f === 'Privileged' || f.startsWith('Dormant') ? 'warn' : f.startsWith('Exception') ? 'info' : '');

function identityLabel(employeeId: string | null): Node {
  const w = store.world;
  if (employeeId === null) return badge('Uncorrelated', 'warn');
  if (employeeId === '') return badge('No identity (orphan)', 'bad');
  const x = w.hr.workers.find((v) => v.employeeId === employeeId);
  return h('span', null, x ? `${x.first} ${x.last} ` : '', h('span', { class: 'muted' }, `(${employeeId})`), x && x.status !== 'Active' ? statusBadge(x.status) : null);
}

function correlateControls(a: IgaAccount): HTMLElement {
  const w = store.world;
  const list = h('datalist', { id: `ids-${a.source}-${a.nativeId}` }, ...w.hr.workers.map((x) => h('option', { value: x.employeeId }, `${x.first} ${x.last}, ${x.title} (${x.status})`)));
  const input = h('input', { class: 'input slim', placeholder: 'Employee ID, e.g. E100412', list: `ids-${a.source}-${a.nativeId}`, 'aria-label': `Identity for ${a.nativeId}`, style: 'width:190px' });
  return h('div', { class: 'row wrap' }, input, list,
    button('Correlate', () => act((x) => correlate(x, a.source, a.nativeId, input.value.trim()), `${a.nativeId} correlated`), 'btn slim primary'),
    button('No identity', () => act((x) => correlate(x, a.source, a.nativeId, ''), `${a.nativeId} marked as belonging to no identity`), 'btn slim'),
    a.disabled ? badge('Disabled', 'bad') : button('Disable account', () => act((x) => disableAccount(x, a.source, a.nativeId), `${a.nativeId} disabled`), 'btn slim danger'));
}

function sources(ctx: SiteCtx): HTMLElement {
  const w = store.world;
  const iga = ensureIga(w);
  return h('div', null, h('h2', null, 'Sources', term('Source')),
    h('p', { class: 'muted' }, 'The platform shows what it last aggregated. Aggregate after any change in a source.'),
    table(['Source', 'Type', 'Owner', 'Accounts', 'Last aggregation', ''], iga.sources.map((s) => [
      link(s.name, () => ctx.go(`/sources/${s.id}`)), s.type, s.owner ?? '—', String(iga.accounts.filter((a) => a.source === s.id).length), fmt(s.lastAggregation),
      button('Aggregate', () => act((x) => { aggregate(x, s.id); }, `${s.name} aggregated`), 'btn slim'),
    ])));
}

function sourceDetail(ctx: SiteCtx, id: string): HTMLElement {
  const w = store.world;
  const iga = ensureIga(w);
  const s = iga.sources.find((x) => x.id === id);
  if (!s) return empty('Source not found.');
  const accts = iga.accounts.filter((a) => a.source === id).sort((a, b) => a.nativeId.localeCompare(b.nativeId));
  return h('div', null, link('← Sources', () => ctx.go('/sources')),
    h('div', { class: 'row-between' }, h('h2', null, s.name), button('Aggregate now', () => act((x) => aggregate(x, s.id), `${s.name} aggregated`), 'btn primary')),
    kv([['Type', s.type], ['Owner', s.owner ?? '—'], ['Last aggregation', fmt(s.lastAggregation)], ['Correlation rule', id === 'ad' ? 'employeeID = identity employee ID' : id === 'peoplehub' ? 'Authoritative: creates identities' : 'login = Active Directory UPN']]),
    h('h3', null, `Accounts (${accts.length})`),
    table(['Account', 'Display name', 'Employee ID (stored)', 'Identity', 'Entitlements', 'Status'], accts.map((a) => [
      a.nativeId, a.displayName, a.employeeId ?? '—', isNonHuman(w, a) ? badge('Service account', 'info') : identityLabel(identityOf(w, a)), a.entitlements.join(', ') || '—', a.disabled ? badge('Disabled', 'bad') : badge('Active', 'ok'),
    ])));
}

function uncorrelated(): HTMLElement {
  const w = store.world;
  const list = uncorrelatedAccounts(w);
  return h('div', null, h('h2', null, 'Uncorrelated accounts', term('Correlation')),
    h('p', { class: 'muted' }, 'Accounts the correlation rule could not link to an identity. Decide each on the employee ID, never on the display name (IAM-SOP-006).'),
    list.length ? table(['Source', 'Account', 'Display name', 'Employee ID stored by the app', 'Decision'], list.map((a) => [a.source, a.nativeId, a.displayName, a.employeeId ?? '—', correlateControls(a)]))
      : empty('No uncorrelated accounts in the last aggregation of each source.'));
}

function identityList(ctx: SiteCtx): HTMLElement {
  const w = store.world;
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Search by name, employee ID or department', value: idQuery, 'aria-label': 'Search identities' });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { idQuery = q.value; ctx.go('/identities'); } });
  const list = identities(w).filter((i) => `${i.name} ${i.employeeId} ${i.department} ${i.title}`.toLowerCase().includes(idQuery.toLowerCase()));
  return h('div', null, h('h2', null, 'Identities'), h('div', { class: 'row' }, q, button('Search', () => { idQuery = q.value; ctx.go('/identities'); })),
    table(['Name', 'Employee ID', 'Status', 'Department', 'Title', 'Manager', 'Accounts'], list.map((i) => [i.name, i.employeeId, statusBadge(i.status), i.department, i.title, i.manager ?? '—', String(i.accounts.length)]),
      (n) => ctx.go(`/identities/${list[n]!.employeeId}`)));
}

function identityDetail(ctx: SiteCtx, id: string): HTMLElement {
  const i = identities(store.world).find((x) => x.employeeId === id);
  if (!i) return empty('Identity not found.');
  return h('div', null, link('← Identities', () => ctx.go('/identities')),
    h('div', { class: 'row-between' }, h('h2', null, i.name), statusBadge(i.status)),
    kv([['Employee ID', i.employeeId], ['Department', i.department], ['Title', i.title], ['Manager', i.manager ?? '—']]),
    h('h3', null, 'Accounts and access'),
    i.accounts.length ? table(['Source', 'Account', 'Entitlements', 'Status'], i.accounts.map((a) => [a.source, a.nativeId, a.entitlements.join(', ') || '—', a.disabled ? badge('Disabled', 'bad') : badge('Active', 'ok')])) : empty('No correlated accounts.'));
}

function progress(c: Campaign): { done: number; total: number; revoked: number; flagged: number } {
  return { done: c.items.filter((i) => i.decision !== 'pending').length, total: c.items.length, revoked: c.items.filter((i) => i.decision === 'revoke').length, flagged: c.items.filter((i) => i.flags.some((f) => !f.startsWith('Exception'))).length };
}

function campaigns(ctx: SiteCtx): HTMLElement {
  const list = ensureIga(store.world).campaigns;
  return h('div', null, h('h2', null, 'Certifications', term('Certification')),
    list.length ? table(['Campaign', 'Type', 'Status', 'Due', 'Progress', 'Items'], list.map((c) => {
      const p = progress(c);
      return [c.name, c.type, badge(c.status, c.status === 'Active' ? 'warn' : 'ok'), fmtDate(c.due), `${Math.round((p.done / Math.max(1, p.total)) * 100)}%`, String(p.total)];
    }), (n) => { selected.clear(); ctx.go(`/certifications/${list[n]!.id}`); }) : empty('No campaigns. Campaigns are launched by the governance team.'));
}

function matches(it: CertItem): boolean {
  const f = certFilter;
  if (f.decision !== 'all' && it.decision !== f.decision) return false;
  if (f.flag === 'any' && !it.flags.length) return false;
  if (f.flag && f.flag !== 'any' && !it.flags.some((x) => x.startsWith(f.flag))) return false;
  const t = f.text.trim().toLowerCase();
  return !t || `${it.identityName} ${it.account} ${it.entitlement} ${it.reviewer}`.toLowerCase().includes(t);
}

function campaignDetail(ctx: SiteCtx, id: string): HTMLElement {
  const w = store.world;
  const c = ensureIga(w).campaigns.find((x) => x.id === id);
  if (!c) return empty('Campaign not found.');
  const p = progress(c);
  const shown = c.items.filter(matches);
  const active = c.status === 'Active';
  const redraw = (): void => ctx.go(`/certifications/${c.id}`);
  const sel = (): string[] => [...selected].filter((x) => c.items.some((i) => i.id === x));
  const decisionSel = h('select', { class: 'input slim', 'aria-label': 'Decision filter', onChange: (e: Event) => { certFilter.decision = (e.target as HTMLSelectElement).value; selected.clear(); redraw(); } },
    ...[['pending', 'Pending'], ['all', 'All decisions'], ['approve', 'Approved'], ['revoke', 'Revoked']].map(([v, l]) => h('option', { value: v, selected: certFilter.decision === v }, l)));
  const flagSel = h('select', { class: 'input slim', 'aria-label': 'Flag filter', onChange: (e: Event) => { certFilter.flag = (e.target as HTMLSelectElement).value; selected.clear(); redraw(); } },
    ...[['', 'All items'], ['any', 'Any flag'], ['Terminated', 'Terminated identity'], ['SoD', 'SoD conflict'], ['Outside role', 'Outside role'], ['Exception', 'Approved exception'], ['Privileged', 'Privileged'], ['Dormant', 'Dormant 90 days']].map(([v, l]) => h('option', { value: v, selected: certFilter.flag === v }, l)));
  const text = h('input', { class: 'input slim', type: 'search', placeholder: 'Filter by person, account or entitlement', value: certFilter.text, 'aria-label': 'Text filter', style: 'width:240px' });
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter') { certFilter.text = text.value; selected.clear(); redraw(); } });
  const commentIn = h('input', { class: 'input slim', placeholder: 'Comment (recommended for revocations)', value: comment, 'aria-label': 'Decision comment', style: 'width:260px', onInput: (e: Event) => { comment = (e.target as HTMLInputElement).value; } });
  const who = h('input', { class: 'input slim', placeholder: 'Reviewer sam', 'aria-label': 'Reassign to', style: 'width:130px' });
  const allBox = h('input', { type: 'checkbox', 'aria-label': 'Select all shown', checked: shown.length > 0 && shown.every((i) => selected.has(i.id)), onChange: (e: Event) => { const on = (e.target as HTMLInputElement).checked; for (const i of shown) if (on) selected.add(i.id); else selected.delete(i.id); redraw(); } });
  const rows = shown.slice(0, 400).map((it) => [
    h('input', { type: 'checkbox', checked: selected.has(it.id), disabled: !active, 'aria-label': `Select ${it.identityName} ${it.entitlement}`, onChange: (e: Event) => { if ((e.target as HTMLInputElement).checked) selected.add(it.id); else selected.delete(it.id); } }),
    h('span', null, it.identityName, h('div', { class: 'muted' }, it.account)), it.entitlement,
    h('span', null, ...it.flags.map(flagBadge)),
    it.decision === 'pending' ? badge('Pending') : badge(it.decision === 'approve' ? 'Approved' : 'Revoked', it.decision === 'approve' ? 'ok' : 'bad'),
    it.reviewer,
    c.status === 'Signed off' ? (it.remediation === 'none' ? '—' : it.remediation === 'done' ? badge('Provisioned', 'ok') : badge('Manual work item', 'warn')) : (it.comment || ''),
  ]);
  const act2 = (decision: 'approve' | 'revoke'): void => {
    const ids = sel();
    if (!ids.length) { act(() => { throw new Error('Select one or more items first.'); }); return; }
    if (act((x) => decide(x, c.id, ids, decision, comment), `${ids.length} item(s) ${decision === 'approve' ? 'approved' : 'revoked'}`)) { selected.clear(); redraw(); }
  };
  return h('div', null, link('← Certifications', () => ctx.go('/certifications')),
    h('div', { class: 'row-between' }, h('h2', null, c.name), badge(c.status, c.status === 'Active' ? 'warn' : 'ok')),
    h('p', { class: 'muted' }, c.description),
    kv([['Campaign', `${c.id} (${c.type})`], ['Due', fmt(c.due)], ['Progress', `${p.done} of ${p.total} decided, ${p.revoked} revoked`], ['Items with risk flags', String(p.flagged)], ...(c.signedOffBy ? [['Signed off', `${c.signedOffBy}, ${fmt(c.signedOffAt)}`] as [string, string]] : [])]),
    h('div', { class: 'row wrap cert-bar' }, decisionSel, flagSel, text, button('Apply', () => { certFilter.text = text.value; selected.clear(); redraw(); }, 'btn slim')),
    active ? h('div', { class: 'row wrap cert-bar' }, commentIn,
      button('Approve selected', () => act2('approve'), 'btn slim'), button('Revoke selected', () => act2('revoke'), 'btn slim danger'),
      button('Undo selected', () => { act((x) => undo(x, c.id, sel()), 'Decisions cleared'); selected.clear(); redraw(); }, 'btn slim ghost'),
      who, button('Reassign selected', () => { if (act((x) => reassign(x, c.id, sel(), who.value.trim()), 'Reassigned')) { selected.clear(); redraw(); } }, 'btn slim'),
      h('span', { class: 'muted' }, `${shown.length} shown`),
      button('Sign off campaign', () => {
        let r: { revoked: number; manual: string[] } = { revoked: 0, manual: [] };
        if (act((x) => { r = signOff(x, c.id); })) toast(`Signed off. ${r.revoked} revocation(s) provisioned${r.manual.length ? `; manual work item(s) ${r.manual.join(', ')} raised in ServiceDesk` : ''}.`, 'ok');
      }, 'btn primary')) : null,
    h('div', { class: 'cert-table' }, table([' ', 'Identity', 'Entitlement', 'Flags', 'Decision', 'Reviewer', c.status === 'Signed off' ? 'Remediation' : 'Comment'], rows)),
    shown.length > 400 ? h('p', { class: 'muted' }, `Showing the first 400 of ${shown.length}. Narrow the filter.`) : null,
    h('div', { class: 'row' }, allBox, h('span', { class: 'muted' }, 'Select all items shown')));
}

export const iga: Site = {
  host: 'iga.meridianhealth.test',
  name: 'Identity Governance',
  short: 'Governance',
  color: '#0b5c6b',
  render(ctx) {
    const w = store.world;
    const g = ensureIga(w);
    const nav: [string, string][] = [['Home', '/'], ['Identities', '/identities'], ['Sources', '/sources'], ['Uncorrelated accounts', '/uncorrelated'], ['Certifications', '/certifications'], ['Access exceptions', '/exceptions'], ['SoD policies', '/sod'], ['Audit', '/audit']];
    const p = ctx.path;
    let content: HTMLElement;
    const sm = /^\/sources\/(.+)$/.exec(p);
    const im = /^\/identities\/(.+)$/.exec(p);
    const cm = /^\/certifications\/(.+)$/.exec(p);
    if (sm) content = sourceDetail(ctx, sm[1]!);
    else if (p === '/sources') content = sources(ctx);
    else if (im) content = identityDetail(ctx, decodeURIComponent(im[1]!));
    else if (p === '/identities') content = identityList(ctx);
    else if (p === '/uncorrelated') content = uncorrelated();
    else if (cm) content = campaignDetail(ctx, cm[1]!);
    else if (p === '/certifications') content = campaigns(ctx);
    else if (p === '/exceptions') {
      content = h('div', null, h('h2', null, 'Access exceptions'), h('p', { class: 'muted' }, 'Access outside the role that its owner approved, until a date. Reviewers approve these lines while the exception is in date.'),
        g.exceptions.length ? table(['Exception', 'Identity', 'Entitlement', 'Approved by', 'Expires', 'Reason'], g.exceptions.map((e) => [e.id, identityLabel(e.employeeId), e.entitlement, e.approvedBy, fmtDate(e.expires), e.reason])) : empty('No exceptions on file.'));
    } else if (p === '/sod') {
      const ad = g.accounts.filter((a) => a.source === 'ad');
      const violations = g.sodPolicies.flatMap((pol) => ad.filter((a) => a.entitlements.includes(pol.left) && a.entitlements.includes(pol.right)).map((a) => [pol.id, a.nativeId, identityLabel(identityOf(w, a)), `${pol.left} + ${pol.right}`]));
      content = h('div', null, h('h2', null, 'Separation of duties', term('SoD Policy')),
        table(['Policy', 'Name', 'Conflicting access'], g.sodPolicies.map((x) => [x.id, x.name, `${x.left} with ${x.right}`])),
        h('h3', null, 'Current violations (last aggregation)'),
        violations.length ? table(['Policy', 'Account', 'Identity', 'Holds'], violations) : empty('No violations in the last Active Directory aggregation.'));
    } else if (p === '/audit') {
      const ev = eventsFor(w, 'IGA').slice(0, 200);
      content = h('div', null, h('h2', null, 'Audit'), ev.length ? table(['Time', 'Action', 'Target', 'By', 'Detail'], ev.map((e) => [fmt(e.time), e.action, e.target, e.actor, e.detail])) : empty('No governance activity yet.'));
    } else {
      const mine = g.campaigns.filter((c) => c.status === 'Active').flatMap((c) => c.items.filter((i) => i.reviewer === w.player.sam && i.decision === 'pending'));
      content = h('div', null, h('h2', null, `${w.company.name}: identity governance`),
        kv([['Identities', String(w.hr.workers.length)], ['Sources', String(g.sources.length)], ['Uncorrelated accounts', String(uncorrelatedAccounts(w).length)], ['Active campaigns', String(g.campaigns.filter((c) => c.status === 'Active').length)], ['Items waiting for you', String(mine.length)]]),
        h('h3', null, 'SailPoint and Saviynt: the same ideas, different names'),
        table(['SailPoint', 'Saviynt'], Object.entries(SAVIYNT_TERMS).map(([a, b]) => [a, b])),
        h('p', { class: 'muted' }, 'Procedure: Documents\\Policies\\Identity-Governance-and-Certification-Procedure.md'));
    }
    return shell(this, nav, ctx, content, `Modelled on SailPoint Identity Security Cloud. Signed in as ${w.player.sam}`);
  },
};

