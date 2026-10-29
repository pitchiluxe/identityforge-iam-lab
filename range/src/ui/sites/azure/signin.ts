/**
 * ui/sites/azure/signin.ts — the lab portal's sign-in and "create account" pages.
 *
 * Only accounts in the eleven lab tenants work. The page says so on its face:
 * it is a training simulation and must never receive a real Microsoft password.
 */
import { h } from '../../dom.ts';
import { act, persist, store } from '../../store.ts';
import { allDomains, worldByDomain } from '../../companies.ts';
import { signInPassword } from '../../system.ts';
import { authenticate, labTenants, tenantForUpn } from '../../azureSession.ts';
import { createLabAccount } from '../../../world/portalAccounts.ts';
import { portalAdminUpn } from '../../../world/azure.ts';
import { addSignIn } from '../../../world/cloud.ts';
import { redeemTap } from '../../../world/authMethods.ts';
import { caOutcome } from '../../../world/tenantSettings.ts';
import { nowIso } from '../../../core/time.ts';
import { MARKER, portalState, type Portal } from './frame.ts';

let step: 'email' | 'password' = 'email';
let typed = '';
let message = '';

function tenants(): { domain: string; tenant: string }[] {
  return labTenants({ domain: store.world.ad.domain, tenant: store.world.entra.primaryDomain });
}

function card(...children: (HTMLElement | null)[]): HTMLElement {
  return h('div', { class: 'az-login' },
    h('div', { class: 'az-login-card' }, h('div', { class: 'az-login-brand' }, 'Microsoft Azure', h('span', null, 'lab')), children),
    h('p', { class: 'az-login-marker' }, MARKER));
}

export function signInPage(p: Portal): HTMLElement {
  const hint = portalAdminUpn(p.w);
  if (step === 'email') {
    const email = h('input', { class: 'input', type: 'email', placeholder: 'Email, phone, or Skype', value: typed || '', 'aria-label': 'Email', autocomplete: 'off' });
    const next = (): void => {
      typed = email.value.trim();
      const domain = tenantForUpn(typed, tenants());
      if (!domain) { message = "We couldn't find an account with that username. This lab portal only knows accounts in its own lab tenants."; p.ctx.go('/signin'); return; }
      portalState().current = domain;
      persist();
      message = '';
      step = 'password';
      p.ctx.go('/signin');
    };
    email.addEventListener('keydown', (e) => { if (e.key === 'Enter') next(); });
    setTimeout(() => email.focus(), 30);
    return card(
      h('h2', null, 'Sign in'), h('p', { class: 'az-login-to' }, `to ${p.w.company.name}`),
      email,
      message ? h('p', { class: 'az-login-err' }, message) : null,
      h('p', { class: 'az-login-small' }, 'No account? ', h('a', { href: '#', onClick: (e: Event) => { e.preventDefault(); message = ''; p.ctx.go('/signup'); } }, 'Create one!')),
      h('div', { class: 'az-login-actions' }, h('button', { class: 'btn primary', type: 'button', onClick: next }, 'Next')),
      h('p', { class: 'az-login-hint' }, `Your MSP admin account here is ${hint}. Its password is your workstation sign-in password.`));
  }
  const pw = h('input', { class: 'input', type: 'password', placeholder: 'Password', 'aria-label': 'Password' });
  const signIn = (): void => {
    const w = worldByDomain(portalState().current) ?? p.w;
    let r = authenticate(w, typed, pw.value, signInPassword());
    // A Temporary Access Pass works in place of the password (and a one-time pass is spent).
    let usedTap = false;
    const holder = w.entra.users.find((e) => e.upn.toLowerCase() === typed.toLowerCase());
    if (!r.ok && !/locked/.test(r.message) && holder?.tap) {
      act((x) => { usedTap = redeemTap(x, typed, pw.value); }, undefined, w);
      if (usedTap) r = { ok: true, upn: holder.upn };
    }
    // Then Conditional Access, as Entra evaluates it after the credential check.
    const ip = '198.51.100.24';
    const ca = r.ok ? caOutcome(w, r.upn, { ip, legacyAuth: false, usedTap }) : null;
    if (r.ok && ca && !ca.allowed) r = { ok: false, message: `${ca.message} (policy: ${ca.policy})` };
    // Every outcome lands in the tenant's sign-in logs.
    if (holder) act((x) => { addSignIn(x, { time: nowIso(), upn: holder.upn, app: 'Azure Portal', ip, location: 'MSP office, US', device: 'Windows 11 · Edge', result: r.ok ? 'Success' : 'Failure', failureReason: r.ok ? '' : r.message, mfa: ca?.mfa ?? 'Not required', ca: ca?.ca ?? 'Not applied', risk: holder.riskLevel }); }, undefined, w);
    if (!r.ok) { message = r.message; p.ctx.go('/signin'); return; }
    const st = portalState();
    st.sessions[st.current] = { upn: r.upn, since: nowIso() };
    persist();
    step = 'email';
    typed = '';
    message = '';
    p.ctx.go('/');
  };
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') signIn(); });
  setTimeout(() => pw.focus(), 30);
  return card(
    h('button', { class: 'az-login-back', type: 'button', onClick: () => { step = 'email'; message = ''; p.ctx.go('/signin'); } }, `← ${typed}`),
    h('h2', null, 'Enter password'),
    pw,
    message ? h('p', { class: 'az-login-err' }, message) : null,
    h('div', { class: 'az-login-actions' }, h('button', { class: 'btn primary', type: 'button', onClick: signIn }, 'Sign in')));
}

export function signUpPage(p: Portal): HTMLElement {
  const directory = h('select', { class: 'input', 'aria-label': 'Directory' }, allDomains().map((d) => h('option', { value: d.domain, selected: d.domain === p.domain }, `${d.name} (${d.domain})`)));
  const name = h('input', { class: 'input', placeholder: 'Your name', 'aria-label': 'Name' });
  const nick = h('input', { class: 'input', placeholder: 'user name', 'aria-label': 'User name', autocomplete: 'off' });
  const suffix = h('span', { class: 'az-suffix' }, `@${p.w.entra.primaryDomain}`);
  directory.addEventListener('change', () => { suffix.textContent = `@${worldByDomain(directory.value)?.entra.primaryDomain ?? ''}`; });
  const pw = h('input', { class: 'input', type: 'password', placeholder: 'Create password', 'aria-label': 'Password' });
  const pw2 = h('input', { class: 'input', type: 'password', placeholder: 'Confirm password', 'aria-label': 'Confirm password' });
  const create = (): void => {
    if (pw.value !== pw2.value) { message = "The passwords don't match."; p.ctx.go('/signup'); return; }
    const w = worldByDomain(directory.value);
    if (!w) return;
    let upn = '';
    if (!act((x) => { upn = createLabAccount(x, { displayName: name.value, nickname: nick.value, password: pw.value }).upn; }, undefined, w)) return;
    const st = portalState();
    st.current = directory.value;
    st.sessions[directory.value] = { upn, since: nowIso() };
    persist();
    message = '';
    p.ctx.go('/');
  };
  return card(
    h('h2', null, 'Create a lab account'),
    h('p', { class: 'az-login-to' }, 'A delegated admin account in one lab tenant: User and Groups Administrator in Entra, Contributor and User Access Administrator on its subscriptions. Never Global Administrator.'),
    directory, name, h('div', { class: 'az-upn-row' }, nick, suffix), pw, pw2,
    message ? h('p', { class: 'az-login-err' }, message) : null,
    h('div', { class: 'az-login-actions' },
      h('button', { class: 'btn', type: 'button', onClick: () => { message = ''; p.ctx.go('/signin'); } }, 'Back'),
      h('button', { class: 'btn primary', type: 'button', onClick: create }, 'Create account')));
}
