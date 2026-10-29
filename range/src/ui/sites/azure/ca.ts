/**
 * ui/sites/azure/ca.ts — Conditional Access: policies (with an editor for CA
 * administrators), named locations, and the What If tool.
 */
import type { CaPolicy } from '../../../core/types.ts';
import { badge, h, table } from '../../dom.ts';
import { addNamedLocation, deleteCaPolicyAs, saveCaPolicyAs, whatIf, type WhatIfResult } from '../../../world/tenantSettings.ts';
import { blade, form, info, input, select, type Portal } from './frame.ts';

let editing: string | null = null;
let lastWhatIf: WhatIfResult[] | null = null;

const STATES: [string, string][] = [['on', 'On'], ['report-only', 'Report-only'], ['off', 'Off']];
const CONDITIONS: [string, string][] = [['none', 'None'], ['legacy-auth', 'Client apps: legacy authentication'], ['sign-in-risk-high', 'Sign-in risk: high'], ['outside-trusted-locations', 'Locations: any except trusted']];
const GRANTS: [string, string][] = [['block', 'Block access'], ['require-mfa', 'Require multifactor authentication'], ['require-compliant-device', 'Require device to be marked as compliant']];

function editor(p: Portal, pol: CaPolicy | null): HTMLElement {
  const name = input({ value: pol?.name ?? '', placeholder: 'Policy name' });
  const users = input({ value: pol?.includeUsers ?? 'All users', list: 'az-ca-users', 'aria-label': 'Include' });
  const exclude = input({ value: pol?.excludeUsers.join(', ') ?? '', placeholder: 'UPNs or groups, comma separated', 'aria-label': 'Exclude' });
  const apps = input({ value: pol?.apps ?? 'All cloud apps', 'aria-label': 'Target resources' });
  const cond = select(CONDITIONS, pol?.condition ?? 'none');
  const grant = select(GRANTS, pol?.grant ?? 'require-mfa');
  const state = select(STATES, pol?.state ?? 'report-only');
  return h('section', { class: 'az-card' }, h('h3', null, pol ? `Edit ${pol.name}` : 'New policy'),
    form(['Name', name], ['Users: include', users], ['Users: exclude', exclude], ['Target resources', apps], ['Conditions', cond], ['Grant', grant], ['Enable policy', state]),
    info('Always exclude the emergency-access (break-glass) account. Start new policies in Report-only.'),
    h('div', { class: 'az-actions' },
      h('button', { class: 'btn primary', type: 'button', onClick: () => {
        const done = p.run((x, a) => {
          saveCaPolicyAs(x, a, { id: pol?.id, name: name.value, includeUsers: users.value.trim(), excludeUsers: exclude.value.split(',').map((v) => v.trim()).filter(Boolean), apps: apps.value.trim() || 'All cloud apps', condition: cond.value as CaPolicy['condition'], grant: grant.value as CaPolicy['grant'], state: state.value as CaPolicy['state'] });
        }, pol ? 'Policy saved' : 'Policy created');
        if (done) { editing = null; p.go({ k: 'entra', page: 'ca' }); }
      } }, pol ? 'Save' : 'Create'),
      h('button', { class: 'btn', type: 'button', onClick: () => { editing = null; p.go({ k: 'entra', page: 'ca' }); } }, 'Cancel')));
}

export function caPage(p: Portal): HTMLElement {
  const w = p.w;
  const pol = editing && editing !== 'new' ? w.entra.caPolicies.find((c) => c.id === editing) ?? null : null;
  const locName = input({ placeholder: 'Name' });
  const locIp = input({ placeholder: '203.0.113.0/28' });
  const wiUser = input({ placeholder: 'user@domain', list: 'az-ca-users', 'aria-label': 'What If user' });
  const wiIp = input({ value: '203.0.113.200', 'aria-label': 'IP address' });
  const wiRisk = select([['none', 'None'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]);
  const wiLegacy = h('input', { type: 'checkbox' });
  return blade('Conditional Access', 'Policies', [],
    h('datalist', { id: 'az-ca-users' }, ['All users', 'Directory roles', ...w.entra.users.filter((e) => !e.deleted).map((e) => e.upn)].map((x) => h('option', { value: x }))),
    editing ? editor(p, pol) : h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onClick: () => { editing = 'new'; p.go({ k: 'entra', page: 'ca' }); } }, '+ New policy')),
    table(['Policy name', 'State', 'Users', 'Excluded', 'Condition', 'Grant', ''], w.entra.caPolicies.map((c) => [c.name, badge(c.state, c.state === 'on' ? 'ok' : c.state === 'off' ? '' : 'warn'), c.includeUsers, c.excludeUsers.join(', ') || '—', c.condition, c.grant,
      h('span', { class: 'row' }, h('button', { class: 'btn slim', type: 'button', onClick: () => { editing = c.id; p.go({ k: 'entra', page: 'ca' }); } }, 'Edit'),
        h('button', { class: 'btn slim ghost', type: 'button', onClick: () => p.run((x, a) => deleteCaPolicyAs(x, a, c.id), 'Policy deleted') }, 'Delete'))])),
    h('section', { class: 'az-card' }, h('h3', null, 'Named locations'),
      table(['Name', 'IP ranges', 'Trusted'], (w.entra.namedLocations ?? []).map((n) => [n.name, n.ips.join(', '), n.trusted ? 'Yes' : 'No'])),
      h('div', { class: 'row' }, locName, locIp, h('button', { class: 'btn', type: 'button', onClick: () => p.run((x, a) => addNamedLocation(x, a, locName.value, [locIp.value.trim()], true), 'Named location added') }, '+ IP ranges location'))),
    h('section', { class: 'az-card' }, h('h3', null, 'What If'),
      form(['User', wiUser], ['IP address', wiIp], ['Sign-in risk', wiRisk], ['Legacy authentication client', wiLegacy]),
      h('div', { class: 'az-actions' }, h('button', { class: 'btn', type: 'button', onClick: () => { lastWhatIf = whatIf(w, { upn: wiUser.value.trim(), app: 'Office 365', ip: wiIp.value.trim(), risk: wiRisk.value as 'none', legacyAuth: wiLegacy.checked }); p.go({ k: 'entra', page: 'ca' }); } }, 'What If')),
      lastWhatIf ? table(['Policy', 'State', 'Applies', 'Grant', 'Reason'], lastWhatIf.map((r) => [r.policy, r.state, r.applies ? badge('Applies', r.state === 'on' ? 'warn' : '') : 'No', r.grant, r.reason])) : null),
    info('Creating or changing policies needs a Conditional Access Administrator or Security Administrator. An MSP admin escalates exclusion requests to the customer.'));
}
