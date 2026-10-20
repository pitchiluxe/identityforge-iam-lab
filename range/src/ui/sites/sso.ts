/**
 * Single sign-on screens: the enterprise-app pages of the Entra admin center
 * (Users and groups, Single sign-on for SAML, Authentication and Certificates &
 * secrets for OIDC, Test single sign-on), and the applications' own SSO
 * settings (the service-provider side): ShiftWise's admin site and CareChart's
 * SSO page in the SaaS admin console.
 */
import type { EntraApp } from '../../core/types.ts';
import { fmt, fmtDate, nowIso } from '../../core/time.ts';
import {
  type SsoResult, CARECHART, SHIFTWISE, activateCert, clientIdOf, deleteClientSecret, ensureFederation, entraAssignUser, getFedApp, newClientSecret, newSamlCert,
  setNameId, setRedirectUris, setSamlBasic, setSpSettings, simulateSso, tenantId,
} from '../../world/federation.ts';
import { badge, button, field, h, table, toast } from '../dom.ts';
import { act, store } from '../store.ts';
import { type Site, type SiteCtx, kv, link, shell } from './common.ts';

let appTab: 'overview' | 'users' | 'sso' | 'test' = 'overview';
let lastResult: { app: string; r: SsoResult } | null = null;
let lastSecret: { app: string; id: string; value: string } | null = null;
let testUpn = '';

const expired = (iso: string): boolean => Date.parse(iso) <= Date.parse(nowIso());

export function ssoResultView(r: SsoResult): HTMLElement {
  return h('div', { class: `sso-result ${r.ok ? 'ok' : 'bad'}` },
    h('div', { class: 'sso-head' }, r.ok ? badge('Success', 'ok') : badge(r.failedAt === 'application' ? 'Failed in the application' : 'Failed in Entra ID', 'bad'), h('strong', null, r.ok ? r.message : r.code)),
    r.ok ? null : h('p', null, r.message),
    h('ol', { class: 'sso-steps' }, ...r.steps.map((s) => h('li', { class: s.ok ? 'ok' : 'bad' }, s.text))),
    r.evidence ? h('div', null, h('h4', null, r.evidenceKind), h('pre', { class: 'sso-evidence' }, r.evidence)) : null);
}

function testForm(appId: string, rerender: () => void): HTMLElement {
  const upn = h('input', { class: 'input', placeholder: 'user@meridianhealth.test', value: testUpn, 'aria-label': 'Test as user', style: 'width:300px' });
  return h('div', null,
    h('p', { class: 'muted' }, 'Sign in as a user to reproduce the problem. The result shows each step, where it stopped, and the decoded request, response or token.'),
    h('div', { class: 'row' }, upn, button('Test sign in', () => { testUpn = upn.value.trim(); act((x) => { lastResult = { app: appId, r: simulateSso(x, appId, testUpn) }; }); rerender(); }, 'btn primary')),
    lastResult?.app === appId ? ssoResultView(lastResult.r) : null);
}

function metadataXml(w: typeof store.world, appId: string): string {
  const s = getFedApp(w, appId).fed.saml!;
  const c = s.certs.find((x) => x.active);
  const tid = tenantId(w);
  return `<EntityDescriptor entityID="https://sts.windows.test/${tid}/">\n  <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">\n    <KeyDescriptor use="signing">\n      <X509Certificate Thumbprint="${c?.thumbprint ?? ''}" NotAfter="${c?.expires ?? ''}">MIIC8DCCAdigAwIBAgIQ…</X509Certificate>\n    </KeyDescriptor>\n    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://login.microsoftonline.test/${tid}/saml2" />\n  </IDPSSODescriptor>\n</EntityDescriptor>`;
}

function samlPane(appId: string, rerender: () => void, open: (url: string) => void): HTMLElement {
  const w = store.world;
  const s = getFedApp(w, appId).fed.saml!;
  const ident = h('input', { class: 'input', value: s.entityId, 'aria-label': 'Identifier (Entity ID)', style: 'width:100%' });
  const reply = h('textarea', { class: 'input sso-area', 'aria-label': 'Reply URLs, one per line' }, s.replyUrls.join('\n'));
  const signOn = h('input', { class: 'input', value: s.signOnUrl, 'aria-label': 'Sign on URL', style: 'width:100%' });
  const nameId = h('select', { class: 'input', 'aria-label': 'Unique User Identifier (Name ID)' }, ...['user.userprincipalname', 'user.mail', 'user.objectid', 'user.employeeid'].map((v) => h('option', { value: v, selected: v === s.nameIdSource }, v)));
  return h('div', null,
    h('div', { class: 'sso-card' }, h('h3', null, '1. Basic SAML Configuration'),
      field('Identifier (Entity ID)', ident), field('Reply URL (Assertion Consumer Service URL), one per line', reply), field('Sign on URL', signOn),
      button('Save', () => act((x) => setSamlBasic(x, appId, { entityId: ident.value, replyUrls: reply.value.split('\n'), signOnUrl: signOn.value }), 'Basic SAML Configuration saved'), 'btn primary')),
    h('div', { class: 'sso-card' }, h('h3', null, '2. Attributes & Claims'),
      field('Unique User Identifier (Name ID)', nameId), h('p', { class: 'muted' }, `Name identifier format: ${s.nameIdFormat}`),
      button('Save', () => act((x) => setNameId(x, appId, nameId.value as 'user.mail'), 'Name ID saved'), 'btn primary'),
      table(['Claim name', 'Value'], s.claims.map((c) => [c.name, c.source]))),
    h('div', { class: 'sso-card' }, h('h3', null, '3. SAML Certificates'),
      table(['Thumbprint', 'Created', 'Expires', 'Status', ''], s.certs.map((c) => [h('code', null, c.thumbprint), fmtDate(c.created), fmtDate(c.expires),
        c.active ? (expired(c.expires) ? badge('Active, EXPIRED', 'bad') : badge('Active', 'ok')) : expired(c.expires) ? badge('Expired', 'bad') : badge('Inactive'),
        c.active ? '' : button('Make certificate active', () => act((x) => activateCert(x, appId, c.thumbprint), 'Certificate active. Give the new thumbprint to the application.'), 'btn slim')])),
      h('div', { class: 'row' }, button('New certificate', () => { act((x) => { newSamlCert(x, appId); }, 'New certificate created (inactive)'); rerender(); }, 'btn')),
      h('h4', null, 'Federation Metadata XML'), h('pre', { class: 'sso-evidence' }, metadataXml(w, appId)),
      button('Copy metadata', () => { void navigator.clipboard?.writeText(metadataXml(store.world, appId)).then(() => toast('Federation metadata copied', 'ok'), () => toast('Clipboard not available', 'err')); }, 'btn slim')),
    h('div', { class: 'sso-card' }, h('h3', null, '4. Set up the application'),
      kv([['Login URL', `https://login.microsoftonline.test/${tenantId(w)}/saml2`], ['Microsoft Entra Identifier', `https://sts.windows.test/${tenantId(w)}/`]]),
      appId === SHIFTWISE ? h('p', null, 'ShiftWise SSO settings: ', link('shiftwise.meridianhealth.test', () => open('https://shiftwise.meridianhealth.test/'))) : null));
}

function oidcPane(appId: string, rerender: () => void, open: (url: string) => void): HTMLElement {
  const w = store.world;
  const o = getFedApp(w, appId).fed.oidc!;
  const uris = h('textarea', { class: 'input sso-area', 'aria-label': 'Redirect URIs, one per line' }, o.redirectUris.join('\n'));
  const months = h('select', { class: 'input slim', 'aria-label': 'Expires' }, ...[['6', '6 months'], ['12', '12 months (recommended)'], ['24', '24 months']].map(([v, l]) => h('option', { value: v, selected: v === '12' }, l)));
  return h('div', null,
    h('div', { class: 'sso-card' }, h('h3', null, 'Overview'), kv([['Application (client) ID', o.clientId], ['Directory (tenant) ID', tenantId(w)], ['Supported account types', 'This organization only'], ['ID token claims', o.groupsClaim ? 'name, preferred_username, oid, tid, groups' : 'name, preferred_username, oid, tid']])),
    h('div', { class: 'sso-card' }, h('h3', null, 'Authentication: Redirect URIs'), field('Web redirect URIs, one per line', uris),
      button('Save', () => act((x) => setRedirectUris(x, appId, uris.value.split('\n')), 'Redirect URIs saved'), 'btn primary')),
    h('div', { class: 'sso-card' }, h('h3', null, 'Certificates & secrets'),
      table(['Secret ID', 'Value', 'Created', 'Expires', 'Status', ''], o.secrets.map((sec) => [sec.id, `${sec.hint}${'*'.repeat(12)}`, fmtDate(sec.created), fmtDate(sec.expires), expired(sec.expires) ? badge('Expired', 'bad') : badge('Valid', 'ok'),
        button('Delete', () => act((x) => deleteClientSecret(x, appId, sec.id), 'Secret deleted'), 'btn slim danger')])),
      h('div', { class: 'row' }, months, button('New client secret', () => { act((x) => { const r = newClientSecret(x, appId, Number(months.value)); lastSecret = { app: appId, ...r }; }, 'Secret created. Copy the value now: it is shown once.'); rerender(); }, 'btn')),
      lastSecret?.app === appId ? h('div', { class: 'vault-secret' }, h('strong', null, `${lastSecret.id} value: `), h('code', null, lastSecret.value), h('span', { class: 'muted' }, ' Copy it into the application now. You will not see it again.')) : null),
    appId === CARECHART ? h('p', null, 'CareChart SSO settings: ', link('SaaS apps > CareChart EHR', () => open('https://apps.meridianhealth.test/carechart'))) : null);
}

/** The Entra enterprise-application page. */
export function entraAppPage(ctx: SiteCtx, app: EntraApp): HTMLElement {
  const w = store.world;
  ensureFederation(w);
  const rerender = (): void => ctx.go(`/apps/${app.id}`);
  const tabs: [typeof appTab, string][] = [['overview', 'Overview'], ['users', 'Users and groups'], ...(app.fed ? [['sso', app.fed.protocol === 'SAML' ? 'Single sign-on' : 'Authentication & secrets'] as [typeof appTab, string], ['test', 'Test single sign-on'] as [typeof appTab, string]] : [])];
  if (!tabs.some(([t]) => t === appTab)) appTab = 'overview';
  let body: HTMLElement;
  if (appTab === 'users') {
    const who = h('input', { class: 'input', placeholder: 'user@meridianhealth.test', 'aria-label': 'Assign user', style: 'width:280px' });
    body = h('div', null,
      h('p', { class: 'muted' }, 'IAM-POL-004: grant access through groups mastered in AD. Direct user assignments are invisible to access reviews and survive leavers.'),
      table(['Assigned', 'Type', ''], [...app.assignedGroups.map((g) => [g, 'Group (from AD)', '']), ...app.assignedUsers.map((u) => [u, badge('User (direct)', 'warn'), button('Remove', () => act((x) => entraAssignUser(x, app.id, u, false), 'Direct assignment removed'), 'btn slim')])]),
      h('div', { class: 'row' }, who, button('Add user assignment', () => act((x) => entraAssignUser(x, app.id, who.value, true), 'User assigned'), 'btn')));
  } else if (appTab === 'sso' && app.fed) body = app.fed.protocol === 'SAML' ? samlPane(app.id, rerender, ctx.open) : oidcPane(app.id, rerender, ctx.open);
  else if (appTab === 'test' && app.fed) body = testForm(app.id, rerender);
  else {
    body = h('div', null, kv([['Single sign-on', app.fed?.protocol ?? app.sso], ['Application ID', clientIdOf(w, app.id)], ['Assignment required', app.assignmentRequired ? 'Yes' : 'No'], ['Provisioning', app.provisioning === 'SCIM' ? 'Automatic (SCIM), runs after each sync' : 'None'], ['Assigned groups', app.assignedGroups.join(', ') || '—'], ['Direct user assignments', app.assignedUsers.join(', ') || '—']]),
      app.saasId ? h('p', { class: 'muted' }, 'Provisioning logs are in SaaS apps > ', link(app.name, () => ctx.open(`https://apps.meridianhealth.test/${app.saasId}`))) : null);
  }
  return h('div', null, link('← Enterprise applications', () => ctx.go('/apps')), h('h2', null, app.name),
    h('div', { class: 'tabs' }, ...tabs.map(([id, label]) => h('button', { class: `tab ${appTab === id ? 'on' : ''}`, type: 'button', onClick: () => { appTab = id; rerender(); } }, label))),
    body);
}

// ---------------------------------------------------------------- service-provider side

/** CareChart's own SSO settings (OIDC client), shown on its SaaS admin page. */
export function careChartSsoPanel(rerender: () => void): HTMLElement {
  const w = store.world;
  ensureFederation(w);
  const app = getFedApp(w, CARECHART);
  const sp = app.fed.sp;
  const o = app.fed.oidc!;
  const current = o.secrets.find((s) => s.id === sp.clientSecretId);
  const redirect = h('input', { class: 'input', value: sp.redirectUri ?? '', 'aria-label': 'Redirect URI sent by CareChart', style: 'width:100%' });
  const secret = h('input', { class: 'input', placeholder: 'Paste the client secret VALUE', 'aria-label': 'Client secret', style: 'width:100%' });
  return h('div', { class: 'sso-card' }, h('h3', null, 'Single sign-on (OpenID Connect)'),
    kv([['Authority', `https://login.microsoftonline.test/${tenantId(w)}/v2.0`], ['Client ID', o.clientId], ['Client secret in use', current ? `${current.hint}************ (${current.id})` : badge('Not recognised by Entra', 'bad')]]),
    field('Redirect URI this app sends', redirect), field('Client secret', secret),
    button('Save', () => {
      act((x) => {
        const v = secret.value.trim();
        const match = v && !/^cs-\d+$/i.test(v) ? o.secrets.find((s) => v.startsWith(s.hint)) : undefined;
        setSpSettings(x, CARECHART, { redirectUri: redirect.value, ...(v ? { clientSecretId: match ? match.id : `not-a-secret:${v.slice(0, 12)}` } : {}) });
      }, 'CareChart SSO settings saved');
      rerender();
    }, 'btn primary'),
    h('p', { class: 'muted' }, 'Paste the secret value shown once in Entra (Certificates & secrets), not the secret ID.'));
}

export const shiftwise: Site = {
  host: 'shiftwise.meridianhealth.test',
  name: 'ShiftWise Scheduling: Administration',
  short: 'ShiftWise',
  color: '#2d6a4f',
  render(ctx) {
    const w = store.world;
    ensureFederation(w);
    const app = getFedApp(w, SHIFTWISE);
    const sp = app.fed.sp;
    const rerender = (): void => ctx.go(ctx.path);
    const entity = h('input', { class: 'input', value: sp.entityId ?? '', 'aria-label': 'Service provider Entity ID', style: 'width:100%' });
    const acs = h('input', { class: 'input', value: sp.acsUrl ?? '', 'aria-label': 'ACS URL', style: 'width:100%' });
    const nameId = h('select', { class: 'input', 'aria-label': 'Match users by' }, ...[['email', 'Email address'], ['upn', 'User principal name']].map(([v, l]) => h('option', { value: v, selected: v === sp.expectsNameId }, l)));
    const thumb = h('input', { class: 'input', value: sp.idpCertThumbprint ?? '', 'aria-label': 'IdP signing certificate thumbprint', style: 'width:100%' });
    const meta = h('textarea', { class: 'input sso-area', placeholder: 'Paste Federation Metadata XML from Entra', 'aria-label': 'Federation metadata' });
    const upn = h('input', { class: 'input', placeholder: 'user@meridianhealth.test', 'aria-label': 'Sign in as', value: testUpn, style: 'width:280px' });
    const content = h('div', null,
      h('h2', null, 'Single sign-on (SAML 2.0)'),
      h('p', { class: 'muted' }, 'ShiftWise is the service provider. These settings must match the ShiftWise Scheduling enterprise application in Microsoft Entra ID.'),
      h('div', { class: 'sso-card' },
        field('Service provider Entity ID (sent as Issuer)', entity), field('Assertion Consumer Service URL (where Entra posts the response)', acs), field('Match users by (NameID)', nameId),
        field('Identity provider signing certificate thumbprint', thumb),
        button('Save', () => { act((x) => setSpSettings(x, SHIFTWISE, { entityId: entity.value, acsUrl: acs.value, expectsNameId: nameId.value as 'email', idpCertThumbprint: thumb.value.toUpperCase() }), 'ShiftWise SSO settings saved'); rerender(); }, 'btn primary')),
      h('div', { class: 'sso-card' }, h('h3', null, 'Import identity provider metadata'), meta,
        button('Import', () => {
          const t = /Thumbprint="([0-9A-F]{40})"/i.exec(meta.value)?.[1];
          if (!t) { toast('No signing certificate thumbprint found in that metadata.', 'err'); return; }
          act((x) => setSpSettings(x, SHIFTWISE, { idpCertThumbprint: t.toUpperCase() }), `Imported certificate ${t.slice(0, 8)}…`);
          rerender();
        }, 'btn')),
      h('div', { class: 'sso-card' }, h('h3', null, 'Test: Sign in with Microsoft'),
        h('div', { class: 'row' }, upn, button('Sign in', () => { testUpn = upn.value.trim(); act((x) => { lastResult = { app: SHIFTWISE, r: simulateSso(x, SHIFTWISE, testUpn) }; }); rerender(); }, 'btn')),
        lastResult?.app === SHIFTWISE ? ssoResultView(lastResult.r) : null),
      h('p', { class: 'muted' }, `Last change: ${fmt(w.audit.filter((e) => e.target === app.name).at(-1)?.time ?? null)}`));
    return shell(this, [['Single sign-on', '/']], ctx, content, 'Vendor admin console');
  },
};

