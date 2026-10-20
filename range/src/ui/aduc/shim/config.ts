/** Host identity and departments for the ported ADUC console. */
import { COMPANY, DEPARTMENTS as DEPTS } from '../../../world/company.ts';

export const VM_HOST = {
  name: 'MHS-IAM-WKS01',
  domain: COMPANY.domain,
  netbiosDomain: COMPANY.netbios,
  domainController: 'MHS-DC01',
  os: 'Microsoft Windows 11 Enterprise',
  osVersion: '10.0.22631',
} as const;

export const DEPARTMENTS = DEPTS;

export const DELEGATION_TASKS: readonly string[] = [
  'Create, delete, and manage user accounts',
  'Reset user passwords and force password change at next logon',
  'Read all user information',
  'Create, delete and manage groups',
  'Modify the membership of a group',
  'Manage Group Policy links',
  'Generate Resultant Set of Policy (Planning)',
  'Generate Resultant Set of Policy (Logging)',
  'Create, delete, and manage inetOrgPerson accounts',
  'Reset inetOrgPerson passwords and force password change at next logon',
  'Read all inetOrgPerson information',
];

type Scope = 'Global' | 'DomainLocal' | 'Universal';
export function scopeChangeAllowed(from: Scope, to: Scope): boolean {
  if (from === to) return true;
  return from === 'Universal' || to === 'Universal';
}
