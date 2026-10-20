/**
 * world/federation.ts — SAML and OIDC single sign-on, both sides of the trust.
 *
 * Entra ID is the identity provider. Each enterprise app has its IdP-side
 * configuration (SAML: Identifier, Reply URLs, NameID, claims, signing
 * certificates; OIDC: redirect URIs, client secrets) and the application has
 * its own, service-provider side (what it sends and what it trusts). SSO works
 * only when both agree, which is why most SSO tickets are a mismatch between
 * the two.
 *
 * simulateSso() walks one sign-in end to end and fails exactly where the real
 * one would, with the AADSTS code or the application's error, and returns the
 * decoded SAML response or JWT so the learner can read the evidence.
 */
import type { AppFederation, EntraApp, EntraUser, SamlCert, World } from '../core/types.ts';
import { daysAgo, daysFromNow, nowIso } from '../core/time.ts';
import { audit } from './audit.ts';
import { objectIdFor } from './cloud.ts';

export class FedError extends Error {}

export const SHIFTWISE = 'ent-shiftwise';
export const CARECHART = 'ent-carechart';

/** A stable 40-hex-digit "SHA-1 thumbprint". */
export function thumbprint(seed: number, label: string): string {
  return (objectIdFor(seed, label) + objectIdFor(seed + 1, label)).replace(/-/g, '').toUpperCase().slice(0, 40);
}

export function tenantId(w: World): string {
  return objectIdFor(w.seed, 'tenant');
}

export function clientIdOf(w: World, appId: string): string {
  return objectIdFor(w.seed, `app:${appId}`);
}

/** Add the SSO configuration to the tenant the first time it is needed. */
export function ensureFederation(w: World): void {
  let sw = w.entra.apps.find((a) => a.id === SHIFTWISE);
  if (!sw) {
    sw = { id: SHIFTWISE, name: 'ShiftWise Scheduling', sso: 'SAML', assignmentRequired: true, assignedGroups: ['grp-nursing-clinical'], assignedUsers: [], provisioning: 'None', saasId: null };
    w.entra.apps.push(sw);
  }
  if (!sw.fed) {
    const t = thumbprint(w.seed, 'shiftwise-cert-1');
    sw.fed = {
      protocol: 'SAML',
      saml: {
        entityId: 'https://shiftwise.meridianhealth.test/saml/sp',
        replyUrls: ['https://shiftwise.meridianhealth.test/saml/acs'],
        signOnUrl: 'https://shiftwise.meridianhealth.test/login',
        nameIdSource: 'user.userprincipalname',
        nameIdFormat: 'emailAddress',
        claims: [{ name: 'email', source: 'user.mail' }, { name: 'department', source: 'user.department' }, { name: 'jobtitle', source: 'user.jobtitle' }],
        certs: [{ thumbprint: t, created: daysAgo(700), expires: daysFromNow(395), active: true }],
      },
      sp: { entityId: 'https://shiftwise.meridianhealth.test/saml/sp', acsUrl: 'https://shiftwise.meridianhealth.test/saml/acs', expectsNameId: 'email', idpCertThumbprint: t },
    };
  }
  const cc = w.entra.apps.find((a) => a.id === CARECHART);
  if (cc && !cc.fed) {
    cc.fed = {
      protocol: 'OIDC',
      oidc: {
        clientId: clientIdOf(w, CARECHART),
        redirectUris: ['https://carechart.meridianhealth.test/signin-oidc'],
        secrets: [{ id: 'cs-1', hint: 'Qz8~', created: daysAgo(500), expires: daysFromNow(230) }],
        groupsClaim: true,
      },
      sp: { redirectUri: 'https://carechart.meridianhealth.test/signin-oidc', clientSecretId: 'cs-1' },
    };
  }
}

export function getFedApp(w: World, appId: string): EntraApp & { fed: AppFederation } {
  ensureFederation(w);
  const a = w.entra.apps.find((x) => x.id === appId);
  if (!a?.fed) throw new FedError('This application has no single sign-on configuration.');
  return a as EntraApp & { fed: AppFederation };
}

const isExpired = (iso: string): boolean => Date.parse(iso) <= Date.parse(nowIso());
const activeCert = (certs: SamlCert[]): SamlCert | undefined => certs.find((c) => c.active);

export function hasAssignment(w: World, app: EntraApp, e: EntraUser): 'group' | 'direct' | null {
  if (app.assignedGroups.some((g) => e.groups.includes(g))) return 'group';
  if (app.assignedUsers.some((u) => u.toLowerCase() === e.upn.toLowerCase())) return 'direct';
  return null;
}

export interface SsoResult {
  ok: boolean;
  /** Where it stopped: the IdP (Entra) or the application. */
  failedAt: 'identity provider' | 'application' | null;
  code: string;
  message: string;
  steps: { ok: boolean; text: string }[];
  /** The decoded SAML response, or the JWT, when one was issued. */
  evidence: string;
  evidenceKind: 'SAML response' | 'ID token (JWT)' | 'SAML request' | 'Authorization request' | '';
}

const b64url = (s: string): string => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function nameIdValue(w: World, e: EntraUser, source: string): string {
  if (source === 'user.objectid') return e.id;
  if (source === 'user.employeeid') return w.ad.users.find((u) => u.sam === e.onPremSam)?.employeeId ?? '';
  return e.upn; // userprincipalname and mail are the same address here
}

function claimValue(w: World, e: EntraUser, source: string): string {
  if (source === 'user.mail' || source === 'user.userprincipalname') return e.upn;
  if (source === 'user.department') return e.department;
  if (source === 'user.jobtitle') return e.jobTitle;
  if (source === 'user.objectid') return e.id;
  return nameIdValue(w, e, source);
}

/** One complete sign-in, as the browser, Entra ID and the application would see it. */
export function simulateSso(w: World, appId: string, upn: string): SsoResult {
  const app = getFedApp(w, appId);
  const fed = app.fed;
  const steps: SsoResult['steps'] = [];
  const fail = (failedAt: SsoResult['failedAt'], code: string, message: string, evidence = '', evidenceKind: SsoResult['evidenceKind'] = ''): SsoResult => {
    steps.push({ ok: false, text: `${code}: ${message}` });
    return { ok: false, failedAt, code, message, steps, evidence, evidenceKind };
  };
  const e = w.entra.users.find((x) => !x.deleted && x.upn.toLowerCase() === upn.toLowerCase());
  const tid = tenantId(w);

  if (fed.protocol === 'SAML') {
    const s = fed.saml!;
    const sp = fed.sp;
    const reqXml = `<samlp:AuthnRequest ID="_${objectIdFor(w.seed, upn).slice(0, 18)}" Version="2.0" IssueInstant="${nowIso()}"\n  Destination="https://login.microsoftonline.test/${tid}/saml2"\n  AssertionConsumerServiceURL="${sp.acsUrl}">\n  <saml:Issuer>${sp.entityId}</saml:Issuer>\n  <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:${s.nameIdFormat}" />\n</samlp:AuthnRequest>`;
    steps.push({ ok: true, text: `${app.name} sends a SAML AuthnRequest. Issuer: ${sp.entityId}; ACS: ${sp.acsUrl}` });
    if (s.entityId !== sp.entityId) return fail('identity provider', 'AADSTS700016', `Application with identifier '${sp.entityId}' was not found in the directory '${w.company.name}'. This can happen if the application has not been installed by the administrator of the tenant, or if the Identifier (Entity ID) in Entra does not match what the application sends.`, reqXml, 'SAML request');
    steps.push({ ok: true, text: `Entra finds the app by Identifier (Entity ID) ${s.entityId}` });
    if (!s.replyUrls.includes(sp.acsUrl ?? '')) return fail('identity provider', 'AADSTS50011', `The reply URL '${sp.acsUrl}' specified in the request does not match the reply URLs configured for the application '${clientIdOf(w, appId)}'. Make sure the reply URL sent in the request matches one added to your application in the Azure portal.`, reqXml, 'SAML request');
    steps.push({ ok: true, text: 'Reply URL (ACS) matches the configuration' });
    if (!e || !e.accountEnabled) return fail('identity provider', 'AADSTS50057', 'The user account is disabled or does not exist in Entra ID.', reqXml, 'SAML request');
    steps.push({ ok: true, text: `${e.upn} signs in` });
    if (app.assignmentRequired && !hasAssignment(w, app, e)) return fail('identity provider', 'AADSTS50105', `Your administrator has configured the application ${app.name} ('${clientIdOf(w, appId)}') to block users unless they are specifically granted ('assigned') access to the application. The signed in user '${e.upn}' is blocked because they are not a direct member of a group with access, nor had access directly assigned by an administrator.`, reqXml, 'SAML request');
    steps.push({ ok: true, text: 'User is assigned to the application' });
    const cert = activeCert(s.certs);
    const nameId = nameIdValue(w, e, s.nameIdSource);
    const now = Date.parse(nowIso());
    const resp = [
      `<samlp:Response ID="_resp${objectIdFor(w.seed, e.upn).slice(0, 12)}" Version="2.0" IssueInstant="${nowIso()}" Destination="${sp.acsUrl}">`,
      `  <Issuer>https://sts.windows.test/${tid}/</Issuer>`,
      '  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success" /></samlp:Status>',
      '  <Assertion>',
      `    <Issuer>https://sts.windows.test/${tid}/</Issuer>`,
      `    <Signature> SignatureMethod rsa-sha256; X509Certificate thumbprint ${cert?.thumbprint ?? '(none)'}${cert ? `, valid until ${cert.expires.slice(0, 10)}` : ''} </Signature>`,
      `    <Subject><NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:${s.nameIdFormat}">${nameId}</NameID></Subject>`,
      `    <Conditions NotBefore="${new Date(now - 300_000).toISOString()}" NotOnOrAfter="${new Date(now + 3_600_000).toISOString()}">`,
      `      <AudienceRestriction><Audience>${s.entityId}</Audience></AudienceRestriction>`,
      '    </Conditions>',
      '    <AttributeStatement>',
      ...s.claims.map((c) => `      <Attribute Name="${c.name}"><AttributeValue>${claimValue(w, e, c.source)}</AttributeValue></Attribute>`),
      '    </AttributeStatement>',
      '  </Assertion>',
      '</samlp:Response>',
    ].join('\n');
    if (!cert) return fail('identity provider', 'AADSTS500171', 'No active signing certificate. Make a certificate active in SAML Certificates.', reqXml, 'SAML request');
    steps.push({ ok: true, text: `Entra signs the response with certificate ${cert.thumbprint}` });
    if (isExpired(cert.expires)) return fail('application', 'SAML signature', `${app.name}: "The SAML response is signed with a certificate that expired on ${cert.expires.slice(0, 10)}. Sign-in refused." Create a new certificate in Entra, make it active, and give the new certificate (thumbprint) to the application.`, resp, 'SAML response');
    if (cert.thumbprint !== sp.idpCertThumbprint) return fail('application', 'SAML signature', `${app.name}: "Signature validation failed. The response is signed with ${cert.thumbprint}, but the identity provider certificate configured here is ${sp.idpCertThumbprint}." Update the IdP certificate in the application's SSO settings.`, resp, 'SAML response');
    steps.push({ ok: true, text: `${app.name} trusts the signing certificate` });
    const found = sp.expectsNameId === 'email' || sp.expectsNameId === 'upn' ? /@/.test(nameId) : true;
    if (!found) return fail('application', 'User not found', `${app.name}: "No user matches NameID '${nameId}'." The application looks users up by email address, but Entra sends ${s.nameIdSource}. Set the Unique User Identifier (Name ID) to user.userprincipalname or user.mail.`, resp, 'SAML response');
    steps.push({ ok: true, text: `${app.name} matches NameID ${nameId} to a user and signs them in` });
    return { ok: true, failedAt: null, code: '', message: `Signed in to ${app.name} as ${nameId}.`, steps, evidence: resp, evidenceKind: 'SAML response' };
  }

  // OIDC (authorization code flow)
  const o = fed.oidc!;
  const sp = fed.sp;
  const authReq = `GET https://login.microsoftonline.test/${tid}/oauth2/v2.0/authorize\n  ?client_id=${o.clientId}\n  &response_type=code\n  &redirect_uri=${sp.redirectUri}\n  &scope=openid profile email\n  &state=8f2a…&nonce=91c0…`;
  steps.push({ ok: true, text: `${app.name} redirects to Entra with client_id ${o.clientId} and redirect_uri ${sp.redirectUri}` });
  if (!o.redirectUris.includes(sp.redirectUri ?? '')) return fail('identity provider', 'AADSTS50011', `The redirect URI '${sp.redirectUri}' specified in the request does not match the redirect URIs configured for the application '${o.clientId}'. Make sure the redirect URI sent in the request matches one added to your application in the Azure portal.`, authReq, 'Authorization request');
  steps.push({ ok: true, text: 'Redirect URI is registered' });
  if (!e || !e.accountEnabled) return fail('identity provider', 'AADSTS50057', 'The user account is disabled or does not exist in Entra ID.', authReq, 'Authorization request');
  if (app.assignmentRequired && !hasAssignment(w, app, e)) return fail('identity provider', 'AADSTS50105', `The signed in user '${e.upn}' is not assigned to a role for the application '${o.clientId}' (${app.name}).`, authReq, 'Authorization request');
  steps.push({ ok: true, text: `${e.upn} signs in and Entra returns an authorization code` });
  const secret = o.secrets.find((s) => s.id === sp.clientSecretId);
  if (!secret) return fail('identity provider', 'AADSTS7000215', `Invalid client secret provided. Ensure the secret being sent in the request is the client secret value, not the client secret ID, for a secret added to app '${o.clientId}'.`, authReq, 'Authorization request');
  if (isExpired(secret.expires)) return fail('identity provider', 'AADSTS7000222', `The provided client secret keys for app '${o.clientId}' are expired. Visit the Azure portal to create new keys for your app, or consider using certificate credentials for added security.`, authReq, 'Authorization request');
  steps.push({ ok: true, text: `${app.name} redeems the code at the token endpoint with client secret ${secret.hint}…` });
  const now = Math.floor(Date.parse(nowIso()) / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: thumbprint(w.seed, 'oidc-signing').slice(0, 27) };
  const payload: Record<string, unknown> = {
    aud: o.clientId, iss: `https://login.microsoftonline.test/${tid}/v2.0`, iat: now, nbf: now, exp: now + 3600,
    name: e.displayName, oid: e.id, preferred_username: e.upn, tid, ver: '2.0',
    ...(o.groupsClaim ? { groups: e.groups } : {}),
  };
  const jwt = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}.signature`;
  const evidence = `${jwt}\n\nHeader\n${JSON.stringify(header, null, 2)}\n\nPayload\n${JSON.stringify(payload, null, 2)}`;
  steps.push({ ok: true, text: `${app.name} validates the ID token (iss, aud = client_id, exp) and signs the user in` });
  return { ok: true, failedAt: null, code: '', message: `Signed in to ${app.name} as ${e.upn}.`, steps, evidence, evidenceKind: 'ID token (JWT)' };
}

// ---------------------------------------------------------------- IdP-side changes (Entra admin center)

export function setSamlBasic(w: World, appId: string, changes: { entityId?: string; replyUrls?: string[]; signOnUrl?: string }, actor = w.player.adminSam): void {
  const s = getFedApp(w, appId).fed.saml;
  if (!s) throw new FedError('Not a SAML application.');
  if (changes.entityId !== undefined) {
    if (!/^(https?:\/\/|urn:)\S+$/.test(changes.entityId.trim())) throw new FedError('The Identifier must be a URI, for example https://app.example/saml or urn:app.');
    s.entityId = changes.entityId.trim();
  }
  if (changes.replyUrls) {
    const urls = changes.replyUrls.map((u) => u.trim()).filter(Boolean);
    if (!urls.length) throw new FedError('At least one Reply URL is required.');
    for (const u of urls) if (!/^https:\/\/\S+$/.test(u)) throw new FedError(`Reply URLs must use https: ${u}`);
    if (urls.some((u) => u.includes('*'))) throw new FedError('Wildcards are not allowed in SAML Reply URLs.');
    s.replyUrls = [...new Set(urls)];
  }
  if (changes.signOnUrl !== undefined) s.signOnUrl = changes.signOnUrl.trim();
  audit(w, { source: 'Entra ID', action: 'Update application: Basic SAML Configuration', target: appId, actor, detail: JSON.stringify(changes) });
}

export function setNameId(w: World, appId: string, source: NonNullable<AppFederation['saml']>['nameIdSource'], actor = w.player.adminSam): void {
  const s = getFedApp(w, appId).fed.saml;
  if (!s) throw new FedError('Not a SAML application.');
  s.nameIdSource = source;
  audit(w, { source: 'Entra ID', action: 'Update application: Unique User Identifier (Name ID)', target: appId, actor, detail: source });
}

export function newSamlCert(w: World, appId: string, actor = w.player.adminSam): SamlCert {
  const s = getFedApp(w, appId).fed.saml;
  if (!s) throw new FedError('Not a SAML application.');
  const c: SamlCert = { thumbprint: thumbprint(w.seed + s.certs.length * 97, `${appId}-cert-${s.certs.length + 1}-${nowIso()}`), created: nowIso(), expires: daysFromNow(3 * 365), active: false };
  s.certs.push(c);
  audit(w, { source: 'Entra ID', action: 'New SAML signing certificate', target: appId, actor, detail: `${c.thumbprint} (inactive)` });
  return c;
}

export function activateCert(w: World, appId: string, thumb: string, actor = w.player.adminSam): void {
  const s = getFedApp(w, appId).fed.saml;
  const c = s?.certs.find((x) => x.thumbprint === thumb);
  if (!s || !c) throw new FedError('Certificate not found.');
  if (isExpired(c.expires)) throw new FedError('An expired certificate cannot be made active.');
  for (const x of s.certs) x.active = x === c;
  audit(w, { source: 'Entra ID', action: 'Make SAML signing certificate active', target: appId, actor, detail: c.thumbprint });
}

export function setRedirectUris(w: World, appId: string, uris: string[], actor = w.player.adminSam): void {
  const o = getFedApp(w, appId).fed.oidc;
  if (!o) throw new FedError('Not an OIDC application.');
  const list = uris.map((u) => u.trim()).filter(Boolean);
  for (const u of list) if (!/^https:\/\/\S+$/.test(u) && !/^http:\/\/localhost(:\d+)?\//.test(u)) throw new FedError(`Redirect URIs must use https (or http://localhost): ${u}`);
  o.redirectUris = [...new Set(list)];
  audit(w, { source: 'Entra ID', action: 'Update application: Redirect URIs', target: appId, actor, detail: o.redirectUris.join(', ') });
}

/** A new client secret. The value is shown once, as in the portal. */
export function newClientSecret(w: World, appId: string, months: number, actor = w.player.adminSam): { id: string; value: string } {
  const o = getFedApp(w, appId).fed.oidc;
  if (!o) throw new FedError('Not an OIDC application.');
  if (months > 24) throw new FedError('Client secrets can be valid for at most 24 months.');
  const id = `cs-${o.secrets.length + 1}`;
  const value = `${thumbprint(w.seed, `${appId}-${id}-${nowIso()}`).slice(0, 4)}~${thumbprint(w.seed + 3, id).slice(0, 30)}`;
  o.secrets.push({ id, hint: value.slice(0, 4), created: nowIso(), expires: daysFromNow(Math.round(months * 30.4)) });
  audit(w, { source: 'Entra ID', action: 'Add client secret', target: appId, actor, detail: `${id}, expires in ${months} months` });
  return { id, value };
}

export function deleteClientSecret(w: World, appId: string, id: string, actor = w.player.adminSam): void {
  const o = getFedApp(w, appId).fed.oidc;
  if (!o) throw new FedError('Not an OIDC application.');
  o.secrets = o.secrets.filter((s) => s.id !== id);
  audit(w, { source: 'Entra ID', action: 'Remove client secret', target: appId, actor, detail: id });
}

/** Assign or unassign one user directly (the Users and groups blade). Group assignment is the managed route. */
export function entraAssignUser(w: World, appId: string, upn: string, assign: boolean, actor = w.player.adminSam): void {
  ensureFederation(w);
  const app = w.entra.apps.find((a) => a.id === appId);
  if (!app) throw new FedError('Application not found.');
  const e = w.entra.users.find((x) => !x.deleted && x.upn.toLowerCase() === upn.trim().toLowerCase());
  if (!e) throw new FedError(`No user ${upn} in Entra ID.`);
  app.assignedUsers = assign ? [...new Set([...app.assignedUsers, e.upn])] : app.assignedUsers.filter((u) => u.toLowerCase() !== e.upn.toLowerCase());
  audit(w, { source: 'Entra ID', action: assign ? 'Add app role assignment to user' : 'Remove app role assignment from user', target: e.upn, actor, detail: app.name });
}

// ---------------------------------------------------------------- SP-side changes (the application's own SSO settings)

export function setSpSettings(w: World, appId: string, changes: Partial<AppFederation['sp']>, actor = w.player.sam): void {
  const app = getFedApp(w, appId);
  for (const [k, v] of Object.entries(changes)) if (typeof v === 'string') (app.fed.sp as Record<string, string>)[k] = v.trim();
  audit(w, { source: 'SaaS', action: `${app.name}: single sign-on settings changed`, target: app.name, actor, detail: Object.keys(changes).join(', ') });
}
