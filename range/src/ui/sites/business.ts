/**
 * PeopleHub (HR), webmail, the policy wiki and the SaaS admin consoles.
 */
import { careChartSsoPanel } from './sso.ts';
import { fmt, fmtDate } from '../../core/time.ts';
import type { Worker } from '../../core/types.ts';
import { workerName } from '../../world/itsm.ts';
import { setSaasAccount, setSaasRole } from '../../world/cloud.ts';
import { homeDir } from '../../world/docs.ts';
import { badge, button, h, markdown, table } from '../dom.ts';
import { act, store } from '../store.ts';
import { type Site, empty, kv, link, shell } from './common.ts';

// ------------------------------------------------------------------- PeopleHub

let hrQuery = '';

function statusBadge(x: Worker): HTMLElement {
  return badge(x.status, x.status === 'Active' ? 'ok' : x.status === 'Terminated' ? 'bad' : 'warn');
}

export const peopleHub: Site = {
  host: 'peoplehub.meridianhealth.test',
  name: 'PeopleHub',
  short: 'PeopleHub',
  color: '#a3561c',
  render(ctx) {
    const w = store.world;
    const nav: [string, string][] = [['Workers', '/'], ['Recent HR transactions', '/transactions']];
    let content: HTMLElement;
    const m = /^\/worker\/(.+)$/.exec(ctx.path);
    if (m) {
      const x = w.hr.workers.find((y) => y.employeeId === m[1]);
      if (!x) content = empty('Worker not found.');
      else {
        const reports = w.hr.workers.filter((y) => y.managerId === x.employeeId);
        content = h('div', null,
          link('← Workers', () => ctx.go('/')),
          h('div', { class: 'row-between' }, h('h2', null, `${x.first} ${x.last}`), statusBadge(x)),
          kv([
            ['Employee ID', x.employeeId], ['Worker type', x.workerType], ['Job title', x.title], ['Department', x.department],
            ['Manager', x.managerId ? link(workerName(w, x.managerId), () => ctx.go(`/worker/${x.managerId}`)) : '—'], ['Location', x.location],
            ['Hire / start date', fmtDate(x.hireDate)], ['Termination date', fmtDate(x.termDate)], ['Termination type', x.termType ?? '—'],
            ['Phone on file', `••• ••• ${x.phoneLast4}`],
          ]),
          h('p', { class: 'muted' }, 'Use the phone on file only for verification callbacks (IAM-SOP-002). Never call back a number a requester gives you.'),
          reports.length ? [h('h3', null, 'Direct reports'), h('ul', null, reports.map((r) => h('li', null, link(`${r.first} ${r.last}`, () => ctx.go(`/worker/${r.employeeId}`)), ` (${r.title})`)))] : null,
          h('h3', null, 'History'),
          table(['When', 'Type', 'Detail', 'Effective'], w.hr.transactions.filter((t) => t.employeeId === x.employeeId).map((t) => [fmt(t.time), t.type, t.detail, fmtDate(t.effective)])));
      }
    } else if (ctx.path === '/transactions') {
      const tx = [...w.hr.transactions].sort((a, b) => b.time.localeCompare(a.time));
      content = h('div', null, h('h2', null, 'Recent HR transactions'), tx.length
        ? table(['When', 'Worker', 'Type', 'Detail', 'Effective'], tx.map((t) => [fmt(t.time), workerName(w, t.employeeId), t.type, t.detail, fmtDate(t.effective)]), (i) => ctx.go(`/worker/${tx[i]!.employeeId}`))
        : empty('No hires, transfers or terminations yet today.'));
    } else {
      const q = h('input', { class: 'input', type: 'search', placeholder: 'Search by name, employee ID or department', value: hrQuery, 'aria-label': 'Search workers' });
      const rows = w.hr.workers.filter((x) => `${x.first} ${x.last} ${x.employeeId} ${x.department} ${x.title}`.toLowerCase().includes(hrQuery.toLowerCase()))
        .sort((a, b) => a.last.localeCompare(b.last));
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { hrQuery = q.value; ctx.go('/'); } });
      content = h('div', null, h('h2', null, 'Workers'), h('div', { class: 'row' }, q, button('Search', () => { hrQuery = q.value; ctx.go('/'); })),
        table(['Name', 'Employee ID', 'Title', 'Department', 'Manager', 'Status'], rows.map((x) => [`${x.first} ${x.last}`, x.employeeId, x.title, x.department, workerName(w, x.managerId), statusBadge(x)]), (i) => ctx.go(`/worker/${rows[i]!.employeeId}`)));
    }
    return shell(this, nav, ctx, content, 'System of record for every worker');
  },
};

// ------------------------------------------------------------------- Mail

/** Outlook on the web lives in ./outlook.ts. */
export { outlook as webMail } from './outlook.ts';

// ------------------------------------------------------------------- Wiki

export const wiki: Site = {
  host: 'wiki.meridianhealth.test',
  name: 'IAM Knowledge Base',
  short: 'Policies',
  color: '#4b5563',
  render(ctx) {
    const w = store.world;
    const docs = w.files.filter((f) => /\\Documents\\(Policies|Reference)\\/.test(f.path));
    const name = decodeURIComponent(ctx.path.replace(/^\/doc\//, ''));
    const doc = docs.find((f) => f.path.endsWith(`\\${name}`));
    const nav: [string, string][] = docs.map((f) => [f.path.split('\\').pop()!.replace(/\.(md|csv|txt)$/, '').replace(/-/g, ' '), `/doc/${encodeURIComponent(f.path.split('\\').pop()!)}`]);
    let content: HTMLElement;
    if (doc) {
      content = /\.csv$/.test(doc.path)
        ? (() => { const [head, ...rows] = doc.content.trim().split('\n').map((l) => l.match(/("([^"]|"")*"|[^,]+)/g)?.map((c) => c.replace(/^"|"$/g, '')) ?? []); return h('div', null, h('h2', null, name), table(head!, rows)); })()
        : markdown(doc.content);
    } else {
      content = h('div', null, h('h2', null, 'IAM Knowledge Base'), h('p', null, 'The policies and references the team works to. The same files are in ', h('code', null, `${homeDir(w)}\\Documents`), ' on your workstation.'),
        h('ul', null, docs.map((f) => h('li', null, link(f.path.split('\\').pop()!, () => ctx.go(`/doc/${encodeURIComponent(f.path.split('\\').pop()!)}`))))));
    }
    return shell(this, nav, ctx, content);
  },
};

// ------------------------------------------------------------------- SaaS admin

export const saasAdmin: Site = {
  host: 'apps.meridianhealth.test',
  name: 'SaaS application admin',
  short: 'SaaS apps',
  color: '#5b3f8c',
  render(ctx) {
    const w = store.world;
    const nav: [string, string][] = w.saas.map((a) => [a.name, `/${a.id}`]);
    const app = w.saas.find((a) => `/${a.id}` === ctx.path);
    let content: HTMLElement;
    if (!app) {
      content = h('div', null, h('h2', null, 'Applications'), table(['Application', 'Identity provider', 'Provisioning', 'Access group', 'Owner', 'Active accounts'],
        w.saas.map((a) => [a.name, a.idp, a.provisioning === 'Manual' ? badge('Manual', 'warn') : a.provisioning, a.accessGroup, a.owner, String(a.accounts.filter((x) => x.active).length)]), (i) => ctx.go(`/${w.saas[i]!.id}`)));
    } else {
      const accts = [...app.accounts].sort((a, b) => a.login.localeCompare(b.login));
      content = h('div', null,
        h('h2', null, `${app.name}: users`),
        h('p', { class: 'muted' }, app.description, ' ', app.provisioning === 'Manual' ? 'This app has no SCIM connector. Accounts are created and removed here by hand.' : `Accounts are managed by ${app.provisioning}; change access in the identity provider.`),
        table(['Login', 'Name', 'Role', 'Status', 'Last login', 'Managed by', ''], accts.map((a) => [
          a.login, a.displayName,
          app.provisioning === 'Manual' ? h('select', { class: 'input slim', 'aria-label': `Role for ${a.login}`, onChange: (e: Event) => act((x) => setSaasRole(x, app.id, a.login, (e.target as HTMLSelectElement).value), 'Role changed') }, app.roles.map((r) => h('option', { value: r, selected: r === a.role }, r))) : a.role,
          badge(a.active ? 'Active' : 'Deactivated', a.active ? 'ok' : 'bad'), fmt(a.lastLogin), a.managedBy,
          button(a.active ? 'Deactivate' : 'Reactivate', () => act((x) => setSaasAccount(x, app.id, a.login, !a.active), `${a.login} ${a.active ? 'deactivated' : 'reactivated'} in ${app.name}`), 'btn slim'),
        ])),
        app.id === 'carechart' ? careChartSsoPanel(() => ctx.go(ctx.path)) : null);
    }
    return shell(this, nav, ctx, content, 'Admin consoles for apps behind SSO');
  },
};
