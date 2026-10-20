/**
 * The IAM Range domain types the ported ADUC console expects. In this range
 * an OU id is its path ("Corp/Users/Finance"), a user id is its
 * sAMAccountName and a group id is its name.
 */
export type OuId = string;
export type UserId = string;
export type GroupId = string;
export type RoleId = string;
export type MfaMethod = string;

export interface User {
  id: UserId;
  username: string;
  displayName: string;
  email: string;
  department: string;
  title: string;
  managerId?: UserId;
  status: 'active' | 'disabled' | 'locked' | 'pending-creation';
  mfa: MfaMethod;
  groupIds: GroupId[];
  lastSignInAt?: number;
  createdAt: number;
  disabledAt?: number;
  mustChangePassword?: boolean;
  ouId?: OuId;
  directRoleIds?: RoleId[];
  attrs?: Record<string, string>;
}

export interface OrganizationalUnit {
  id: OuId;
  name: string;
  parentId?: OuId;
  description: string;
  createdAt: number;
  protectedFromDeletion?: boolean;
  attrs?: Record<string, string>;
}

export interface Delegation {
  ouId?: OuId;
  trustee: string;
  tasks: string[];
  at: number;
}

export interface Group {
  id: GroupId;
  name: string;
  description: string;
  memberIds: UserId[];
  ownerRoleId?: RoleId;
  ouId?: OuId;
  scope?: 'DomainLocal' | 'Global' | 'Universal';
  category?: 'Security' | 'Distribution';
  attrs?: Record<string, string>;
}
