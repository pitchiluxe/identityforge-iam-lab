/**
 * SAML and OIDC troubleshooting: reproduce the failure with Test single
 * sign-on, read the error and the decoded response, and fix the side of the
 * trust that is wrong.
 */
import { daysAgo } from '../../core/time.ts';
import { addMember, removeMember } from '../../world/directory.ts';
import { runEntraSync } from '../../world/cloud.ts';
import { openTicket } from '../../world/itsm.ts';
import { ensurePolicyDocs } from '../../world/docs.ts';
import {
  CARECHART, SHIFTWISE, activateCert, deleteClientSecret, ensureFederation, entraAssignUser, getFedApp, newClientSecret, newSamlCert,
  setNameId, setRedirectUris, setSamlBasic, setSpSettings,
} from '../../world/federation.ts';
import { type Built, type Template, check, close, isLead, pickEmployee } from '../template.ts';

const SAML_TWISTS = ['saml-cert-expired', 'saml-reply-url', 'saml-entity-id', 'saml-nameid', 'saml-not-assigned'];

export const ssoTroubleshoot: Template = {
  id: 'sso-troubleshoot',
  title: 'SAML and OIDC sign-in failures',
  category: 'Federation & SSO',
  difficulty: 3,
  skills: ['SAML (Entity ID, ACS, NameID, signing certificates)', 'OIDC (redirect URIs, client secrets, ID tokens)', 'AADSTS error codes', 'Reading a SAML response and a JWT'],
  summary: 'Users cannot sign in to an app. Reproduce it with Test single sign-on, read the error and the token, and fix the side of the trust that is wrong.',
  twists: [
    { id: 'saml-cert-expired', label: 'SAML: signing certificate expired overnight', trap: true },
    { id: 'saml-reply-url', label: 'SAML: AADSTS50011 after a vendor upgrade' },
    { id: 'saml-entity-id', label: 'SAML: AADSTS700016 identifier not found' },
    { id: 'saml-nameid', label: 'SAML: "user not found" in the app' },
    { id: 'saml-not-assigned', label: 'SAML: AADSTS50105 for one nurse', trap: true },
    { id: 'oidc-redirect', label: 'OIDC: redirect URI mismatch on the new web client' },
    { id: 'oidc-secret-expired', label: 'OIDC: AADSTS7000222 client secret expired', trap: true },
  ],
  build(ctx): Built {
    const { w, twist } = ctx;
    ensureFederation(w);
    ensurePolicyDocs(w);
    const saml = SAML_TWISTS.includes(twist);
    const appId = saml ? SHIFTWISE : CARECHART;
    // Start from a known-good trust, so a fix from an earlier run cannot leave this one already solved.
    delete w.entra.apps.find((a) => a.id === appId)!.fed;
    ensureFederation(w);
    const app = getFedApp(w, appId);
    const u = pickEmployee({ ...ctx, department: 'Nursing' }, (x) => x.department === 'Nursing' && !isLead(x) && x.memberOf.includes('grp-nursing-clinical') && x.memberOf.includes('app-carechart'));
    app.assignedUsers = app.assignedUsers.filter((x) => x.toLowerCase() !== u.upn.toLowerCase());
    let symptom = '';
    let reported = '';
    const s = app.fed.saml;
    const o = app.fed.oidc;
    switch (twist) {
      case 'saml-cert-expired': {
        const c = s!.certs.find((x) => x.active)!;
        c.expires = daysAgo(1);
        c.created = daysAgo(3 * 365);
        symptom = 'Every nurse gets an error page from ShiftWise after signing in with Microsoft';
        reported = 'ShiftWise says "SAML response signed with an expired certificate". Started at midnight. Nobody can see the rota.';
        break;
      }
      case 'saml-reply-url':
        app.fed.sp.acsUrl = 'https://shiftwise.meridianhealth.test/saml2/acs';
        symptom = 'ShiftWise sign-in fails with AADSTS50011 since the vendor upgraded to v9 last night';
        reported = 'Microsoft sign-in page: "AADSTS50011: The reply URL specified in the request does not match..."';
        break;
      case 'saml-entity-id':
        app.fed.sp.entityId = 'https://shiftwise.meridianhealth.test/saml/meridianhealth';
        symptom = 'ShiftWise sign-in fails with AADSTS700016 after the vendor migrated our tenant';
        reported = 'Microsoft sign-in page: "AADSTS700016: Application with identifier ... was not found in the directory".';
        break;
      case 'saml-nameid':
        s!.nameIdSource = 'user.objectid';
        symptom = 'ShiftWise says "No user matches" for everyone, since a change to the app in Entra on Friday';
        reported = 'Sign-in with Microsoft works, then ShiftWise shows "No user matches NameID 8c1f...".';
        break;
      case 'saml-not-assigned':
        removeMember(w, 'grp-nursing-clinical', u.sam, 'MERIDIAN\\svc-provisioning');
        runEntraSync(w);
        symptom = `${u.displayName} cannot open ShiftWise; every other nurse on the unit can`;
        reported = '"AADSTS50105: Your administrator has configured the application ShiftWise Scheduling to block users unless they are specifically granted access".';
        break;
      case 'oidc-redirect':
        app.fed.sp.redirectUri = 'https://carechart.meridianhealth.test/auth/callback';
        symptom = 'The new CareChart web client fails at sign-in with AADSTS50011';
        reported = 'Microsoft sign-in page: "AADSTS50011: The redirect URI ... specified in the request does not match the redirect URIs configured for the application".';
        break;
      case 'oidc-secret-expired': {
        o!.secrets[0]!.expires = daysAgo(2);
        symptom = 'Nobody can sign in to CareChart; the app shows "Authentication failed (token endpoint)"';
        reported = 'CareChart server log: "AADSTS7000222: The provided client secret keys for app ... are expired".';
        break;
      }
    }
    const t = openTicket(w, {
      type: 'Incident', category: 'Application Access', priority: twist === 'saml-not-assigned' ? 3 : 1, caller: u.displayName, scenarioId: ctx.id, openedMinutesAgo: 35,
      short: `${app.name}: ${symptom}`,
      description: `${reported}\n\nAffected user to test with: ${u.upn}\n\nPlease use SSO-Troubleshooting-Runbook.md (Documents\\Policies) and the app's Single sign-on page in the Entra admin center (Test single sign-on).`,
    });
    const extra = twist === 'saml-not-assigned'
      ? [
          check(`${u.sam} back in grp-nursing-clinical (the group that grants ShiftWise)`, { k: 'adMember', sam: u.sam, group: 'grp-nursing-clinical', value: true } as const),
          check('No direct user assignment on the app', { k: 'entraDirectAssignment', app: appId, upn: u.upn, value: false } as const, true),
        ]
      : [];
    return {
      title: `${app.name} sign-in failure`,
      ticketIds: [t.id], mailIds: [], params: { sam: u.sam, upn: u.upn, app: appId },
      checks: [
        check(`${u.upn} can sign in to ${app.name} (Test single sign-on succeeds)`, { k: 'ssoWorks', app: appId, upn: u.upn }, true),
        ...extra,
        check('Root cause recorded on the incident', { k: 'ticketNote', ticket: t.id, anyOf: ['aadsts', 'certificate', 'thumbprint', 'reply url', 'redirect', 'identifier', 'entity id', 'nameid', 'name id', 'secret', 'group'] }),
        check('Incident resolved', { k: 'ticketResolved', ticket: t.id, codes: ['Solved (Fulfilled)', 'Solved (Workaround)'] }),
      ],
      hints: [
        `Entra admin center > Enterprise applications > ${app.name} > Single sign-on > Test single sign-on as ${u.upn}. Read where it fails: Entra, or the application.`,
        {
          'saml-cert-expired': 'The certificate in the decoded response expired. A new certificate fixes Entra; does the application trust it yet?',
          'saml-reply-url': 'Compare the AssertionConsumerServiceURL in the SAML request with the Reply URLs in Basic SAML Configuration.',
          'saml-entity-id': 'Compare the Issuer in the SAML request with the Identifier (Entity ID) in Basic SAML Configuration.',
          'saml-nameid': 'Look at the NameID in the decoded response. Is that something ShiftWise can look a user up by?',
          'saml-not-assigned': `Who grants ShiftWise: a group or individual users? Is ${u.sam} still in it?`,
          'oidc-redirect': 'Compare redirect_uri in the authorization request with the app registration\'s redirect URIs.',
          'oidc-secret-expired': 'Look at Certificates & secrets. A new secret only helps if the application is given it.',
        }[twist]!,
        {
          'saml-cert-expired': 'SAML Certificates > New certificate > Make active, then put the new thumbprint into ShiftWise\'s SSO settings (https://shiftwise.meridianhealth.test). Test again.',
          'saml-reply-url': 'Add https://shiftwise.meridianhealth.test/saml2/acs to the Reply URLs (keep the old one until the vendor confirms). Test again.',
          'saml-entity-id': 'Set the Identifier (Entity ID) to exactly what ShiftWise sends: https://shiftwise.meridianhealth.test/saml/meridianhealth. Test again.',
          'saml-nameid': 'Attributes & Claims > Unique User Identifier: user.userprincipalname. Test again.',
          'saml-not-assigned': `Add ${u.sam} back to grp-nursing-clinical in AD (Registered Nurse birthright) and run a delta sync. Do not assign the user directly.`,
          'oidc-redirect': 'Authentication > add https://carechart.meridianhealth.test/auth/callback as a redirect URI. Test again.',
          'oidc-secret-expired': 'New client secret (24 months at most), enter it in CareChart\'s SSO settings, test, then delete the expired one.',
        }[twist]!,
      ],
      debrief: {
        'saml-cert-expired': 'The signing certificate expired at midnight. Making a new one active in Entra is only half of a rotation: ShiftWise still trusted the old thumbprint, so signatures failed until the application was given the new certificate. Rotations are planned before expiry, with the app owner, ideally with both certificates trusted during the change.',
        'saml-reply-url': 'The vendor\'s upgrade moved the Assertion Consumer Service to /saml2/acs, and Entra only posts responses to Reply URLs it has been told about, which is what stops a response being sent to an attacker\'s endpoint. Adding the exact new URL fixed it.',
        'saml-entity-id': 'After the tenant migration ShiftWise identifies itself with a new Entity ID. Entra looks the app up by Identifier, so it could not find it. Both sides now use the same identifier.',
        'saml-nameid': 'Someone changed the Name ID to the Entra object ID, a GUID ShiftWise has never heard of. The app looks users up by email address, so the NameID must be the UPN (or mail). The decoded response showed it in one line.',
        'saml-not-assigned': `ShiftWise is granted by grp-nursing-clinical, and ${u.displayName} had been removed from it, so Entra correctly blocked the sign-in. Restoring the birthright group fixed it everywhere that group grants access; a direct assignment would have worked today and been invisible to reviews and leavers.`,
        'oidc-redirect': 'OIDC only returns codes and tokens to redirect URIs registered on the app, so a new client with a new callback path fails until it is registered. Exact matching is a security control, not a nuisance.',
        'oidc-secret-expired': 'The client secret expired. A new secret in Entra does nothing until the application uses it, so the fix has two halves: create it, then configure CareChart with it (and remove the expired one). Track secret expiry, or use certificate credentials or managed identities instead.',
      }[twist]!,
      interview: saml
        ? { question: 'A SAML app stopped working. How do you troubleshoot it?', modelAnswer: 'Reproduce it and capture the SAML request and response (Test SSO or a SAML tracer). Read the error: AADSTS700016 means the Entity ID does not match, AADSTS50011 the ACS/Reply URL, AADSTS50105 assignment. If Entra issued a response, check the signing certificate (expired, or a thumbprint the app does not trust), the Audience, the NameID value and format, the claims, and the time conditions. Fix the side that is wrong and test again.' }
        : { question: 'How do you troubleshoot an OIDC sign-in failure?', modelAnswer: 'Get the error code and the request: AADSTS50011 means the redirect_uri is not registered, AADSTS7000222 an expired client secret, AADSTS7000215 the wrong secret (often the secret ID instead of its value), AADSTS50105 assignment. If a token was issued, decode it and check iss (tenant), aud (the client ID), exp and the claims the app needs, such as groups. Rotate secrets before expiry, or move to certificates or managed identities.' },
    };
  },
  solve(w, s) {
    const app = s.params.app!;
    switch (s.twist) {
      case 'saml-cert-expired': {
        const c = newSamlCert(w, app);
        activateCert(w, app, c.thumbprint);
        setSpSettings(w, app, { idpCertThumbprint: c.thumbprint });
        break;
      }
      case 'saml-reply-url': setSamlBasic(w, app, { replyUrls: [...getFedApp(w, app).fed.saml!.replyUrls, 'https://shiftwise.meridianhealth.test/saml2/acs'] }); break;
      case 'saml-entity-id': setSamlBasic(w, app, { entityId: 'https://shiftwise.meridianhealth.test/saml/meridianhealth' }); break;
      case 'saml-nameid': setNameId(w, app, 'user.userprincipalname'); break;
      case 'saml-not-assigned': addMember(w, 'grp-nursing-clinical', s.params.sam!); runEntraSync(w); break;
      case 'oidc-redirect': setRedirectUris(w, app, [...getFedApp(w, app).fed.oidc!.redirectUris, 'https://carechart.meridianhealth.test/auth/callback']); break;
      case 'oidc-secret-expired': {
        const sec = newClientSecret(w, app, 12);
        setSpSettings(w, app, { clientSecretId: sec.id });
        deleteClientSecret(w, app, 'cs-1');
        break;
      }
    }
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', `Root cause for ${s.twist}: fixed the mismatched setting (see AADSTS error / certificate / NameID / group). Test single sign-on succeeds.`);
  },
  naive(w, s) {
    const app = s.params.app!;
    if (s.twist === 'saml-cert-expired') {
      const c = newSamlCert(w, app);
      activateCert(w, app, c.thumbprint);
    } else if (s.twist === 'saml-not-assigned') {
      entraAssignUser(w, app, s.params.upn!, true);
    } else if (s.twist === 'oidc-secret-expired') {
      newClientSecret(w, app, 12);
    }
    close(w, s.ticketIds[0]!, 'Solved (Fulfilled)', 'Fixed.');
  },
};
