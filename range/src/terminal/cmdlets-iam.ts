/**
 * terminal/cmdlets-iam.ts — the rest of the everyday IAM toolkit, as the real
 * modules ship it: more of ActiveDirectory (password policy, domain
 * controllers, OUs, token groups), Microsoft Graph (groups, roles and PIM,
 * licences, Conditional Access, risky users, directory audits) and ADSync
 * connectors.
 *
 * Output uses the real property names. Graph membership cmdlets return
 * directory objects with only an Id, as Graph does, and synced users refuse
 * cloud edits with Graph's own error.
 */
import type { AdUser, EntraUser, World } from '../core/types.ts';
import { nowIso } from '../core/time.ts';
import { createOu, dcHostOf, deleteGroup, deleteOu, dnOf, domainDn, findGroup, getGroup, getUser, ouInfo, ouToDn, parseOu, principalGroups, setPasswordFlags, LOCKOUT_THRESHOLD } from '../world/directory.ts';
import { portalAdminUpn } from '../world/azure.ts';
import { setAccountEnabledAs, updateCloudUser } from '../world/entraAdmin.ts';
import { setUserRisk } from '../world/identityExtras.ts';
import { asGraph } from './graphAuth.ts';
import { activeRole, objectIdFor, setCloudAccountEnabled, setCloudUserProps, setRisk } from '../world/cloud.ts';
import { type CmdletCtx, type CmdletDef, MissingParamError, PsError, refOf, toStr, truthy, withRef } from './shell.ts';

export interface IamHelpers {
  userObject(w: World, u: AdUser, props?: string[] | '*'): Record<string, unknown>;
  groupObject(w: World, g: ReturnType<typeof getGroup>, props?: string[] | '*'): Record<string, unknown>;
  identity(c: CmdletCtx, param?: string): string;
  idList(v: unknown): string[];
  whatIf(c: CmdletCtx, op: string, target: string): boolean;
  requireGraph(c: CmdletCtx): void;
  guidOf(seed: string): string;
}


/** Template ids of Microsoft Entra built-in roles (the same in every tenant). */
export const ROLE_TEMPLATES: Record<string, string> = {
  'Global Administrator': '62e90394-69f5-4237-9190-012177145e10',
  'Privileged Role Administrator': 'e8611ab8-c189-46e8-94e1-60213ab1f814',
  'User Administrator': 'fe930be7-5e62-47db-91af-98c3a49a38b1',
  'Helpdesk Administrator': '729827e3-9c14-49f7-bb1b-9608f156bbb8',
  'Security Administrator': '194ae4cb-b126-40b2-bd5b-6091b380977d',
  'Security Reader': '5d6b6bb7-de71-4623-b4af-96380a352509',
  'Global Reader': 'f2ef992c-3afb-46b9-b7cf-a126ee74c451',
  'Authentication Administrator': 'c4e39bd9-1100-46d3-8c65-fb160da0071f',
  'Privileged Authentication Administrator': '7be44c8a-adaf-4e2a-84d6-ab2649e08a13',
  'Application Administrator': '9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3',
  'Cloud Application Administrator': '158c047a-c907-4556-b7ef-446551a6b5f7',
  'Conditional Access Administrator': 'b1be1c3e-b65d-4f19-8427-f6fa0d97feb9',
  'Exchange Administrator': '29232cdf-9323-42fd-ade2-1d097af3e4de',
  'Hybrid Identity Administrator': '8ac3fc64-6eca-42ea-9e69-59f4c7b60eb2',
  'Groups Administrator': 'fdd7a751-b60b-444a-984c-02652fe8fa1c',
  'License Administrator': '4d6ac14f-3453-41d0-bef9-a3e0c569773a',
};
const ROLE_DESCRIPTIONS: Record<string, string> = {
  'Global Administrator': 'Can manage all aspects of Microsoft Entra ID and Microsoft services that use Microsoft Entra identities.',
  'User Administrator': 'Can manage all aspects of users and groups, including resetting passwords for limited admins.',
  'Helpdesk Administrator': 'Can reset passwords for non-administrators and Helpdesk Administrators.',
  'Privileged Role Administrator': 'Can manage role assignments in Microsoft Entra ID, and all aspects of Privileged Identity Management.',
  'Security Administrator': 'Can read security information and reports, and manage configuration in Microsoft Entra ID and Office 365.',
};

/** Licences as Microsoft names the SKUs. */
const SKUS: Record<string, { part: string; id: string }> = {
  'Microsoft 365 E3': { part: 'SPE_E3', id: '05e9a617-0261-4cee-bb44-138d3ef5d965' },
  'Microsoft 365 E5': { part: 'SPE_E5', id: '06ebc4ee-1bb5-47dd-8120-11324bc54e06' },
  'Microsoft Entra ID P2': { part: 'AAD_PREMIUM_P2', id: 'eec0eb4f-6444-4f95-aba0-50c24d67f998' },
};
const sku = (name: string): { part: string; id: string } => SKUS[name] ?? { part: name.toUpperCase().replace(/\W+/g, '_'), id: objectIdFor(0, `sku:${name}`) };

const notFoundGraph = (id: string): PsError => new PsError(`Resource '${id}' does not exist or one of its queried reference-property objects are not present.\nStatus: 404 (NotFound)\nErrorCode: Request_ResourceNotFound`, 'ObjectNotFound', { exception: 'HttpResponseException', errorId: 'Request_ResourceNotFound' });

function liveUsers(w: World): EntraUser[] {
  return w.entra.users.filter((e) => !e.deleted);
}

function cloudGroups(w: World): string[] {
  return [...new Set([...w.entra.groups, ...liveUsers(w).flatMap((e) => e.groups)])].sort();
}

const groupId = (w: World, name: string): string => objectIdFor(w.seed, `group:${name}`);
const roleObjectId = (w: World, role: string): string => objectIdFor(w.seed, `role:${role}`);

function graphUser(w: World, idOrUpn: string): EntraUser {
  const e = liveUsers(w).find((x) => x.id === idOrUpn || x.upn.toLowerCase() === idOrUpn.toLowerCase());
  if (!e) throw notFoundGraph(idOrUpn);
  return e;
}

function graphGroup(w: World, id: string): string {
  const g = cloudGroups(w).find((n) => groupId(w, n) === id);
  if (!g) throw notFoundGraph(id);
  return g;
}

/** A directoryObject as Graph returns it from a membership query: the Id and nothing else. */
const dirObject = (id: string): Record<string, unknown> => ({ Id: id, DeletedDateTime: null });

/** `displayName eq 'x'`, `startswith(displayName,'x')`, `principalId eq 'x'`: the OData filters admins actually type. */
function odata(filter: string): (o: Record<string, unknown>) => boolean {
  const f = filter.trim();
  if (!f) return () => true;
  const eq = /^(\w+)\s+eq\s+'([^']*)'$/i.exec(f);
  if (eq) return (o) => toStr(o[Object.keys(o).find((k) => k.toLowerCase() === eq[1]!.toLowerCase()) ?? '']).toLowerCase() === eq[2]!.toLowerCase();
  const sw = /^startswith\((\w+),\s*'([^']*)'\)$/i.exec(f);
  if (sw) return (o) => toStr(o[Object.keys(o).find((k) => k.toLowerCase() === sw[1]!.toLowerCase()) ?? '']).toLowerCase().startsWith(sw[2]!.toLowerCase());
  throw new PsError(`Invalid filter clause: ${f}\nStatus: 400 (BadRequest)\nErrorCode: Request_UnsupportedQuery`, 'InvalidArgument', { exception: 'HttpResponseException', errorId: 'Request_UnsupportedQuery' });
}

const top = <T>(c: CmdletCtx, list: T[]): T[] => (c.named.Top !== undefined ? list.slice(0, Number(c.named.Top)) : list);

export function iamCmdlets(h: IamHelpers): CmdletDef[] {
  const adObjects = (w: World): Record<string, unknown>[] => [
    ...w.ad.ous.map((ou) => withRef({ DistinguishedName: ouToDn(ou, w), Name: ou.split('/').pop(), ObjectClass: 'organizationalUnit', ObjectGUID: h.guidOf(`ou:${ou}`) }, { type: 'ou', key: ou })),
    ...w.ad.users.map((u) => withRef({ DistinguishedName: dnOf(u, w), Name: u.displayName, ObjectClass: 'user', ObjectGUID: h.guidOf(u.sam) }, { type: 'user', key: u.sam })),
    ...w.ad.groups.map((g) => withRef({ DistinguishedName: `CN=${g.name},${ouToDn(g.ou, w)}`, Name: g.name, ObjectClass: 'group', ObjectGUID: h.guidOf(`g:${g.name}`) }, { type: 'group', key: g.name })),
    ...w.ad.computers.map((m) => withRef({ DistinguishedName: `CN=${m.name},${ouToDn(m.ou, w)}`, Name: m.name, ObjectClass: 'computer', ObjectGUID: h.guidOf(`c:${m.name}`) }, { type: 'computer', key: m.name })),
  ];
  const builtinGroup = (name: string, sid: string): Record<string, unknown> => ({ DistinguishedName: null, GroupCategory: 'Security', GroupScope: null, Name: name, ObjectClass: 'group', SamAccountName: name, SID: sid });

  return [
    // -------------------------------------------------------------- ActiveDirectory
    {
      name: 'Get-ADObject', module: 'ActiveDirectory', params: ['Identity', 'Filter', 'LDAPFilter', 'SearchBase', 'Properties'], positional: ['Identity'],
      synopsis: '', example: "Get-ADObject -Filter \"ObjectClass -eq 'organizationalUnit'\"",
      run(c) {
        const all = adObjects(c.w);
        if (c.named.Identity !== undefined) {
          const id = h.identity(c);
          const o = all.find((x) => toStr(x.DistinguishedName).toLowerCase() === id.toLowerCase() || toStr(x.ObjectGUID) === id || refOf(x)?.key.toLowerCase() === id.toLowerCase());
          if (!o) throw new PsError(`Cannot find an object with identity: '${id}' under: '${domainDn(c.w)}'.`, 'ObjectNotFound');
          return o;
        }
        const ldap = c.named.LDAPFilter === undefined ? null : /objectClass=(\w+)/i.exec(toStr(c.named.LDAPFilter))?.[1]?.toLowerCase();
        if (c.named.Filter === undefined && c.named.LDAPFilter === undefined) throw new MissingParamError('Filter');
        const base = c.named.SearchBase === undefined ? null : toStr(c.named.SearchBase).toLowerCase();
        return all.filter((o) => (!base || toStr(o.DistinguishedName).toLowerCase().endsWith(base)) && (ldap ? toStr(o.ObjectClass).toLowerCase() === ldap : c.shell.matches(c.named.Filter, o)));
      },
    },
    {
      name: 'Get-ADDefaultDomainPasswordPolicy', module: 'ActiveDirectory', params: ['Identity', 'Server'], positional: ['Identity'], synopsis: '', example: 'Get-ADDefaultDomainPasswordPolicy',
      run: (c) => ({
        ComplexityEnabled: true, DistinguishedName: domainDn(c.w), LockoutDuration: '00:30:00', LockoutObservationWindow: '00:30:00', LockoutThreshold: LOCKOUT_THRESHOLD,
        MaxPasswordAge: '90.00:00:00', MinPasswordAge: '1.00:00:00', MinPasswordLength: 12, objectClass: ['domainDNS'], objectGuid: h.guidOf(`domain:${c.w.ad.domain}`),
        PasswordHistoryCount: 24, ReversibleEncryptionEnabled: false,
      }),
    },
    {
      name: 'Get-ADFineGrainedPasswordPolicy', module: 'ActiveDirectory', params: ['Identity', 'Filter'], positional: ['Identity'], synopsis: '', example: 'Get-ADFineGrainedPasswordPolicy -Filter *',
      run(c) {
        if (c.named.Identity !== undefined) throw new PsError(`Cannot find an object with identity: '${h.identity(c)}' under: 'CN=Password Settings Container,CN=System,${domainDn(c.w)}'.`, 'ObjectNotFound');
        if (c.named.Filter === undefined) throw new MissingParamError('Filter');
        return [];
      },
    },
    {
      name: 'Get-ADUserResultantPasswordPolicy', module: 'ActiveDirectory', params: ['Identity'], positional: ['Identity'], pipe: 'each', pipeParam: 'Identity', synopsis: '', example: 'Get-ADUserResultantPasswordPolicy -Identity vhale',
      run(c) { getUser(c.w, h.identity(c)); return []; },
    },
    {
      name: 'Get-ADDomainController', module: 'ActiveDirectory', params: ['Identity', 'Filter', 'DomainName'], switches: ['Discover'], positional: ['Identity'], synopsis: '', example: 'Get-ADDomainController -Discover',
      run(c) {
        const dc = c.w.ad.computers.find((m) => m.name === dcHostOf(c.w));
        return {
          ComputerObjectDN: `CN=${dcHostOf(c.w)},OU=Domain Controllers,${domainDn(c.w)}`, DefaultPartition: domainDn(c.w), Domain: c.w.ad.domain, Enabled: true, Forest: c.w.ad.domain,
          HostName: `${dcHostOf(c.w)}.${c.w.ad.domain}`, IPv4Address: dc?.ip ?? '10.10.0.10', IsGlobalCatalog: true, IsReadOnly: false, LdapPort: 389, Name: dcHostOf(c.w),
          OperatingSystem: 'Windows Server 2022 Datacenter', OperationMasterRoles: ['SchemaMaster', 'DomainNamingMaster', 'PDCEmulator', 'RIDMaster', 'InfrastructureMaster'],
          Site: c.w.profileId ? 'Default-First-Site-Name' : 'Boston-Main', SslPort: 636,
        };
      },
    },
    {
      name: 'Get-ADForest', module: 'ActiveDirectory', params: ['Identity'], positional: ['Identity'], synopsis: '', example: 'Get-ADForest',
      run: (c) => ({
        Domains: [c.w.ad.domain], DomainNamingMaster: `${dcHostOf(c.w)}.${c.w.ad.domain}`, ForestMode: 'Windows2016Forest', GlobalCatalogs: [`${dcHostOf(c.w)}.${c.w.ad.domain}`],
        Name: c.w.ad.domain, RootDomain: c.w.ad.domain, SchemaMaster: `${dcHostOf(c.w)}.${c.w.ad.domain}`, Sites: [c.w.profileId ? 'Default-First-Site-Name' : 'Boston-Main'], UPNSuffixes: [],
      }),
    },
    {
      name: 'Get-ADAccountAuthorizationGroup', module: 'ActiveDirectory', params: ['Identity'], positional: ['Identity'], pipe: 'each', pipeParam: 'Identity', synopsis: '', example: 'Get-ADAccountAuthorizationGroup -Identity vhale | Select-Object Name',
      run(c) {
        const u = getUser(c.w, h.identity(c));
        const groups = principalGroups(u).map((n) => findGroup(c.w, n)).filter((g): g is NonNullable<typeof g> => !!g).map((g) => h.groupObject(c.w, g));
        return [builtinGroup('Everyone', 'S-1-1-0'), builtinGroup('Authenticated Users', 'S-1-5-11'), builtinGroup('This Organization', 'S-1-5-15'), ...groups];
      },
    },
    {
      name: 'Set-ADAccountControl', module: 'ActiveDirectory', mutates: true, params: ['Identity', 'PasswordNeverExpires'], positional: ['Identity'], pipe: 'each', pipeParam: 'Identity', synopsis: '',
      example: 'Set-ADAccountControl -Identity svc-backup -PasswordNeverExpires $false',
      run(c) {
        const u = getUser(c.w, h.identity(c));
        if (c.named.PasswordNeverExpires === undefined) return;
        if (h.whatIf(c, 'Set', dnOf(u, c.w))) return;
        setPasswordFlags(c.w, u.sam, { neverExpires: truthy(c.named.PasswordNeverExpires) });
      },
    },
    {
      name: 'Remove-ADGroup', module: 'ActiveDirectory', mutates: true, params: ['Identity'], positional: ['Identity'], pipe: 'each', pipeParam: 'Identity', synopsis: '', example: 'Remove-ADGroup -Identity grp-old-project -Confirm:$false',
      run(c) {
        const g = getGroup(c.w, h.identity(c));
        if (h.whatIf(c, 'Remove', `CN=${g.name},${ouToDn(g.ou, c.w)}`)) return;
        deleteGroup(c.w, g.name);
      },
    },
    {
      name: 'New-ADOrganizationalUnit', module: 'ActiveDirectory', mutates: true, params: ['Name', 'Path', 'Description', 'ProtectedFromAccidentalDeletion'], positional: ['Name'], synopsis: '',
      example: "New-ADOrganizationalUnit -Name Contractors -Path 'OU=Users,OU=Corp,DC=meridianhealth,DC=test'",
      run(c) {
        const name = c.str('Name', true);
        const path = c.named.Path === undefined ? '' : toStr(c.named.Path);
        const parent = !path || path.toLowerCase() === domainDn(c.w).toLowerCase() ? null : parseOu(c.w, path);
        if (h.whatIf(c, 'New', `OU=${name},${parent ? ouToDn(parent, c.w) : domainDn(c.w)}`)) return;
        createOu(c.w, name, parent, { description: c.str('Description'), protected: c.named.ProtectedFromAccidentalDeletion === undefined ? true : truthy(c.named.ProtectedFromAccidentalDeletion) });
      },
    },
    {
      name: 'Remove-ADOrganizationalUnit', module: 'ActiveDirectory', mutates: true, params: ['Identity'], switches: ['Recursive'], positional: ['Identity'], synopsis: '',
      example: "Remove-ADOrganizationalUnit -Identity 'OU=Contractors,OU=Users,OU=Corp,DC=meridianhealth,DC=test'",
      run(c) {
        const ou = parseOu(c.w, h.identity(c));
        if (h.whatIf(c, 'Remove', ouToDn(ou, c.w))) return;
        if (ouInfo(c.w, ou).protected) throw new PsError('Access is denied', 'PermissionDenied', { exception: 'UnauthorizedAccessException' });
        deleteOu(c.w, ou);
      },
    },
    // -------------------------------------------------------------- ADSync
    {
      name: 'Get-ADSyncConnector', module: 'ADSync', params: ['Name', 'Identifier'], positional: ['Name'], synopsis: '', example: 'Get-ADSyncConnector | Select-Object Name,Type',
      run(c) {
        const list = [
          { Name: c.w.ad.domain, Type: 'AD', Subtype: '', Identifier: 'b891884f-051e-4a83-95af-2544101c9083', Version: 412, LastModificationTime: new Date(c.w.created) },
          { Name: `${c.w.entra.tenantName} - AAD`, Type: 'Extensible2', Subtype: 'Windows Azure Active Directory (Microsoft)', Identifier: 'b891884f-051e-4a83-95af-2544101c9083'.replace('b891', '9f3c'), Version: 389, LastModificationTime: new Date(c.w.created) },
        ];
        const n = c.named.Name === undefined ? null : toStr(c.named.Name).toLowerCase();
        return n ? list.filter((x) => x.Name.toLowerCase() === n) : list;
      },
    },
    { name: 'Get-ADSyncConnectorRunStatus', module: 'ADSync', synopsis: '', example: 'Get-ADSyncConnectorRunStatus', run: () => [] },
    // -------------------------------------------------------------- Microsoft.Graph
    {
      name: 'Get-MgContext', module: 'Microsoft.Graph', synopsis: '', example: 'Get-MgContext | Select-Object Account,Scopes',
      run(c) {
        if (!c.shell.graphConnected) return [];
        return { ClientId: '14d82eec-204b-4c2f-b7e8-296a70dab67e', TenantId: objectIdFor(c.w.seed, `tenant:${c.w.entra.tenantName}`), Scopes: c.shell.graphScopes, AuthType: 'Delegated', TokenCredentialType: 'InteractiveBrowser', Account: portalAdminUpn(c.w), AppName: 'Microsoft Graph Command Line Tools', ContextScope: 'CurrentUser', Environment: 'Global' };
      },
    },
    {
      name: 'Disconnect-MgGraph', aliases: ['Disconnect-Graph'], module: 'Microsoft.Graph', synopsis: '', example: 'Disconnect-MgGraph',
      run(c) {
        if (!c.shell.graphConnected) throw new PsError('No application to sign out from.', 'InvalidOperation');
        c.shell.graphConnected = false;
        c.shell.graphWorld = null;
        c.shell.graphScopes = [];
      },
    },
    {
      name: 'Get-MgGroup', module: 'Microsoft.Graph', params: ['GroupId', 'Filter', 'Top', 'Property'], switches: ['All'], positional: ['GroupId'], synopsis: '', example: "Get-MgGroup -Filter \"displayName eq 'grp-all-staff'\"",
      run(c) {
        h.requireGraph(c);
        const shape = (n: string): Record<string, unknown> => {
          const g = findGroup(c.w, n);
          return { DisplayName: n, Id: groupId(c.w, n), MailNickname: n, Description: g?.description ?? null, GroupTypes: [], SecurityEnabled: true, OnPremisesSyncEnabled: !!g };
        };
        if (c.named.GroupId !== undefined) return shape(graphGroup(c.w, toStr(c.named.GroupId)));
        return top(c, cloudGroups(c.w).map(shape).filter(odata(c.str('Filter'))));
      },
    },
    {
      name: 'Get-MgGroupMember', module: 'Microsoft.Graph', params: ['GroupId', 'Top'], switches: ['All'], positional: ['GroupId'], synopsis: '', example: 'Get-MgGroupMember -GroupId (Get-MgGroup -Filter "displayName eq \'grp-all-staff\'").Id -All',
      run(c) {
        h.requireGraph(c);
        const name = graphGroup(c.w, c.str('GroupId', true));
        return top(c, liveUsers(c.w).filter((e) => e.groups.includes(name)).map((e) => dirObject(e.id)));
      },
    },
    {
      name: 'Get-MgUserMemberOf', module: 'Microsoft.Graph', params: ['UserId', 'Top'], switches: ['All'], positional: ['UserId'], synopsis: '', example: 'Get-MgUserMemberOf -UserId vhale@meridianhealth.test -All',
      run(c) {
        h.requireGraph(c);
        const e = graphUser(c.w, c.str('UserId', true));
        const roles = e.roles.filter((r) => activeRole(e, r.role) === 'active').map((r) => roleObjectId(c.w, r.role));
        return top(c, [...e.groups.map((g) => groupId(c.w, g)), ...roles].map(dirObject));
      },
    },
    {
      name: 'Update-MgUser', module: 'Microsoft.Graph', mutates: true, params: ['UserId', 'AccountEnabled', 'Department', 'JobTitle'], positional: ['UserId'], pipe: 'each', pipeParam: 'UserId', synopsis: '',
      example: 'Update-MgUser -UserId bg-emergency01@meridianhealth.onmicrosoft.test -AccountEnabled:$false',
      run(c) {
        h.requireGraph(c);
        const e = graphUser(c.w, h.identity(c, 'UserId'));
        if (e.source === 'synced') throw new PsError('Unable to update the specified properties for on-premises mastered Directory Sync objects or objects currently undergoing migration.\nStatus: 400 (BadRequest)\nErrorCode: Request_BadRequest', 'InvalidOperation', { exception: 'HttpResponseException', errorId: 'Request_BadRequest' });
        if (h.whatIf(c, 'Update-MgUser', e.upn)) return;
        // MSP company tenants: the signed-in admin's Entra roles decide, as Graph does.
        if (c.w.profileId) {
          const actor = portalAdminUpn(c.w);
          return asGraph(() => {
            if (c.named.AccountEnabled !== undefined) setAccountEnabledAs(c.w, actor, e.upn, truthy(c.named.AccountEnabled));
            if (c.named.Department !== undefined || c.named.JobTitle !== undefined) updateCloudUser(c.w, actor, e.upn, { department: c.named.Department === undefined ? undefined : toStr(c.named.Department), jobTitle: c.named.JobTitle === undefined ? undefined : toStr(c.named.JobTitle) });
          });
        }
        if (c.named.AccountEnabled !== undefined) setCloudAccountEnabled(c.w, e.upn, truthy(c.named.AccountEnabled));
        if (c.named.Department !== undefined || c.named.JobTitle !== undefined) setCloudUserProps(c.w, e.upn, { department: c.named.Department === undefined ? undefined : toStr(c.named.Department), jobTitle: c.named.JobTitle === undefined ? undefined : toStr(c.named.JobTitle) });
      },
    },
    {
      name: 'Get-MgUserLicenseDetail', module: 'Microsoft.Graph', params: ['UserId'], positional: ['UserId'], synopsis: '', example: 'Get-MgUserLicenseDetail -UserId vhale@meridianhealth.test',
      run(c) {
        h.requireGraph(c);
        const e = graphUser(c.w, c.str('UserId', true));
        return e.licenses.map((l) => ({ Id: objectIdFor(c.w.seed, `lic:${e.upn}:${l}`), SkuId: sku(l).id, SkuPartNumber: sku(l).part }));
      },
    },
    {
      name: 'Get-MgSubscribedSku', module: 'Microsoft.Graph', switches: ['All'], synopsis: '', example: 'Get-MgSubscribedSku | Select-Object SkuPartNumber,ConsumedUnits',
      run(c) {
        h.requireGraph(c);
        const counts = new Map<string, number>();
        for (const e of liveUsers(c.w)) for (const l of e.licenses) counts.set(l, (counts.get(l) ?? 0) + 1);
        return [...counts].map(([l, n]) => ({ SkuPartNumber: sku(l).part, SkuId: sku(l).id, ConsumedUnits: n, PrepaidUnitsEnabled: Math.ceil((n + 10) / 25) * 25, CapabilityStatus: 'Enabled', AppliesTo: 'User' }));
      },
    },
    {
      name: 'Get-MgDirectoryRole', module: 'Microsoft.Graph', params: ['DirectoryRoleId', 'Filter'], switches: ['All'], positional: ['DirectoryRoleId'], synopsis: '', example: "Get-MgDirectoryRole -Filter \"displayName eq 'Global Administrator'\"",
      run(c) {
        h.requireGraph(c);
        const names = [...new Set(liveUsers(c.w).flatMap((e) => e.roles.filter((r) => activeRole(e, r.role) === 'active').map((r) => r.role)))].sort();
        const list = names.map((n) => ({ DisplayName: n, Id: roleObjectId(c.w, n), Description: ROLE_DESCRIPTIONS[n] ?? null, RoleTemplateId: ROLE_TEMPLATES[n] ?? objectIdFor(0, `tpl:${n}`) }));
        if (c.named.DirectoryRoleId !== undefined) { const r = list.find((x) => x.Id === toStr(c.named.DirectoryRoleId)); if (!r) throw notFoundGraph(toStr(c.named.DirectoryRoleId)); return r; }
        return list.filter(odata(c.str('Filter')));
      },
    },
    {
      name: 'Get-MgDirectoryRoleMember', module: 'Microsoft.Graph', params: ['DirectoryRoleId'], switches: ['All'], positional: ['DirectoryRoleId'], synopsis: '', example: 'Get-MgDirectoryRoleMember -DirectoryRoleId (Get-MgDirectoryRole -Filter "displayName eq \'Global Administrator\'").Id',
      run(c) {
        h.requireGraph(c);
        const id = c.str('DirectoryRoleId', true);
        const role = [...new Set(liveUsers(c.w).flatMap((e) => e.roles.map((r) => r.role)))].find((r) => roleObjectId(c.w, r) === id);
        if (!role) throw notFoundGraph(id);
        return liveUsers(c.w).filter((e) => activeRole(e, role) === 'active').map((e) => dirObject(e.id));
      },
    },
    ...(['Assignment', 'EligibilitySchedule'] as const).map((kind): CmdletDef => ({
      name: `Get-MgRoleManagementDirectoryRole${kind}`, module: 'Microsoft.Graph', params: ['Filter', 'ExpandProperty'], switches: ['All'], synopsis: '',
      example: `Get-MgRoleManagementDirectoryRole${kind} -Filter "roleDefinitionId eq '62e90394-69f5-4237-9190-012177145e10'"`,
      run(c) {
        h.requireGraph(c);
        const want = kind === 'Assignment' ? 'active' : 'eligible';
        const rows = liveUsers(c.w).flatMap((e) => e.roles.filter((r) => r.assignment === want && (!r.expires || r.expires > nowIso())).map((r) => ({
          Id: objectIdFor(c.w.seed, `ra:${want}:${e.upn}:${r.role}`), PrincipalId: e.id, RoleDefinitionId: ROLE_TEMPLATES[r.role] ?? objectIdFor(0, `tpl:${r.role}`), DirectoryScopeId: '/',
          ...(kind === 'EligibilitySchedule' ? { MemberType: 'Direct', Status: 'Provisioned', ScheduleInfoEnd: r.expires ? new Date(r.expires) : null } : {}),
        })));
        return rows.filter(odata(c.str('Filter')));
      },
    })),
    {
      name: 'Get-MgAuditLogDirectoryAudit', module: 'Microsoft.Graph', params: ['Filter', 'Top'], switches: ['All'], synopsis: '', example: 'Get-MgAuditLogDirectoryAudit -Top 20 | Select-Object ActivityDateTime,ActivityDisplayName,InitiatedBy,TargetResources',
      run(c) {
        h.requireGraph(c);
        const cat = (a: string): string => (/role|pim/i.test(a) ? 'RoleManagement' : /policy/i.test(a) ? 'Policy' : /group/i.test(a) ? 'GroupManagement' : /application|app /i.test(a) ? 'ApplicationManagement' : 'UserManagement');
        const rows = c.w.audit.filter((e) => e.source === 'Entra ID').sort((a, b) => b.time.localeCompare(a.time)).map((e) => ({
          ActivityDateTime: new Date(e.time), ActivityDisplayName: e.action, Category: cat(e.action), Result: 'success', InitiatedBy: e.actor, TargetResources: e.target, LoggedByService: 'Core Directory',
        }));
        return top(c, rows.filter(odata(c.str('Filter'))));
      },
    },
    {
      name: 'Get-MgIdentityConditionalAccessPolicy', module: 'Microsoft.Graph', params: ['ConditionalAccessPolicyId', 'Filter'], switches: ['All'], positional: ['ConditionalAccessPolicyId'], synopsis: '', example: 'Get-MgIdentityConditionalAccessPolicy | Select-Object DisplayName,State',
      run(c) {
        h.requireGraph(c);
        const state = { on: 'enabled', off: 'disabled', 'report-only': 'enabledForReportingButNotEnforced' } as const;
        const rows = c.w.entra.caPolicies.map((p) => ({ CreatedDateTime: new Date(p.created), Description: null, DisplayName: p.name, Id: objectIdFor(c.w.seed, `ca:${p.id}`), ModifiedDateTime: null, State: state[p.state] }));
        if (c.named.ConditionalAccessPolicyId !== undefined) { const r = rows.find((x) => x.Id === toStr(c.named.ConditionalAccessPolicyId)); if (!r) throw notFoundGraph(toStr(c.named.ConditionalAccessPolicyId)); return r; }
        return rows.filter(odata(c.str('Filter')));
      },
    },
    {
      name: 'Get-MgRiskyUser', module: 'Microsoft.Graph', params: ['RiskyUserId', 'Filter'], switches: ['All'], positional: ['RiskyUserId'], synopsis: '', example: "Get-MgRiskyUser -Filter \"riskLevel eq 'high'\"",
      run(c) {
        h.requireGraph(c);
        const rows = liveUsers(c.w).filter((e) => e.riskLevel !== 'none').map((e) => ({ Id: e.id, IsDeleted: false, RiskDetail: 'none', RiskLastUpdatedDateTime: new Date(c.w.audit.filter((a) => a.target === e.upn).at(-1)?.time ?? c.w.created), RiskLevel: e.riskLevel, RiskState: 'atRisk', UserDisplayName: e.displayName, UserPrincipalName: e.upn }));
        return rows.filter(odata(c.str('Filter')));
      },
    },
    {
      name: 'Invoke-MgDismissRiskyUser', module: 'Microsoft.Graph', mutates: true, params: ['UserIds'], synopsis: '', example: 'Invoke-MgDismissRiskyUser -UserIds @((Get-MgUser -UserId vhale@meridianhealth.test).Id)',
      run(c) {
        h.requireGraph(c);
        const ids = h.idList(c.named.UserIds);
        if (!ids.length) throw new MissingParamError('UserIds');
        for (const id of ids) {
          const e = liveUsers(c.w).find((x) => x.id === id);
          if (!e) throw notFoundGraph(id);
          if (h.whatIf(c, 'Dismiss risk', e.upn)) continue;
          if (c.w.profileId) { const actor = portalAdminUpn(c.w); asGraph(() => setUserRisk(c.w, actor, e.upn, 'dismiss')); continue; }
          setRisk(c.w, e.upn, 'none');
        }
      },
    },
    {
      name: 'Get-MgServicePrincipal', module: 'Microsoft.Graph', params: ['ServicePrincipalId', 'Filter'], switches: ['All'], positional: ['ServicePrincipalId'], synopsis: '', example: "Get-MgServicePrincipal -Filter \"displayName eq 'CareChart EHR'\"",
      run(c) {
        h.requireGraph(c);
        const rows = c.w.entra.apps.map((a) => ({ DisplayName: a.name, Id: objectIdFor(c.w.seed, `sp:${a.id}`), AppId: objectIdFor(c.w.seed, `app:${a.id}`), SignInAudience: 'AzureADMyOrg', AppRoleAssignmentRequired: a.assignmentRequired, PreferredSingleSignOnMode: a.sso === 'SAML' ? 'saml' : 'oidc' }));
        if (c.named.ServicePrincipalId !== undefined) { const r = rows.find((x) => x.Id === toStr(c.named.ServicePrincipalId)); if (!r) throw notFoundGraph(toStr(c.named.ServicePrincipalId)); return r; }
        return rows.filter(odata(c.str('Filter')));
      },
    },
  ];
}

