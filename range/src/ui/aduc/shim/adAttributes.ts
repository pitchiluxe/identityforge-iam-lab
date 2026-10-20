/**
 * services/adAttributes.ts — the attributes behind the ADUC Properties sheet.
 *
 * One table, read by three surfaces: Set-ADUser's named parameters (-Office,
 * -City...), the Properties sheet's text boxes, and the Attribute Editor tab.
 * The PowerShell name and the LDAP name are both real, and learning that
 * "Office" in the cmdlet is physicalDeliveryOfficeName in the directory is
 * exactly what the Attribute Editor is for.
 */

/** Set-ADUser named parameter -> LDAP attribute. */
export const USER_ATTR_PARAMS: Readonly<Record<string, string>> = {
  GivenName: 'givenName',
  Surname: 'sn',
  Initials: 'initials',
  Description: 'description',
  Office: 'physicalDeliveryOfficeName',
  OfficePhone: 'telephoneNumber',
  HomePage: 'wWWHomePage',
  StreetAddress: 'streetAddress',
  POBox: 'postOfficeBox',
  City: 'l',
  State: 'st',
  PostalCode: 'postalCode',
  Country: 'c',
  Company: 'company',
  Manager: 'manager',
  MobilePhone: 'mobile',
  HomePhone: 'homePhone',
  Fax: 'facsimileTelephoneNumber',
  ProfilePath: 'profilePath',
  ScriptPath: 'scriptPath',
  HomeDirectory: 'homeDirectory',
  HomeDrive: 'homeDrive',
  LogonWorkstations: 'userWorkstations',
  AccountExpirationDate: 'accountExpires',
};

/**
 * Account options (the Account tab's scrolling list). Stored under their
 * PowerShell names; the Attribute Editor folds them into userAccountControl.
 */
export const USER_FLAG_PARAMS = [
  'CannotChangePassword',
  'PasswordNeverExpires',
  'AllowReversiblePasswordEncryption',
  'SmartcardLogonRequired',
  'AccountNotDelegated',
  'UseDESKeyOnly',
  'DoesNotRequirePreAuth',
] as const;
export type UserFlag = (typeof USER_FLAG_PARAMS)[number];

/** The Account tab's wording for each flag, in the order the real list shows them. */
export const USER_FLAG_LABELS: Readonly<Record<UserFlag, string>> = {
  CannotChangePassword: 'User cannot change password',
  PasswordNeverExpires: 'Password never expires',
  AllowReversiblePasswordEncryption: 'Store password using reversible encryption',
  SmartcardLogonRequired: 'Smart card is required for interactive logon',
  AccountNotDelegated: 'Account is sensitive and cannot be delegated',
  UseDESKeyOnly: 'Use only Kerberos DES encryption types for this account',
  DoesNotRequirePreAuth: 'Do not require Kerberos preauthentication',
};

/** userAccountControl bits, as documented for the attribute. */
const UAC_BITS: Readonly<Record<string, number>> = {
  ACCOUNTDISABLE: 0x2,
  LOCKOUT: 0x10,
  PASSWD_CANT_CHANGE: 0x40,
  ENCRYPTED_TEXT_PWD_ALLOWED: 0x80,
  NORMAL_ACCOUNT: 0x200,
  DONT_EXPIRE_PASSWORD: 0x10000,
  SMARTCARD_REQUIRED: 0x40000,
  NOT_DELEGATED: 0x100000,
  USE_DES_KEY_ONLY: 0x200000,
  DONT_REQ_PREAUTH: 0x400000,
};

const FLAG_BIT: Readonly<Record<UserFlag, number>> = {
  CannotChangePassword: UAC_BITS.PASSWD_CANT_CHANGE!,
  PasswordNeverExpires: UAC_BITS.DONT_EXPIRE_PASSWORD!,
  AllowReversiblePasswordEncryption: UAC_BITS.ENCRYPTED_TEXT_PWD_ALLOWED!,
  SmartcardLogonRequired: UAC_BITS.SMARTCARD_REQUIRED!,
  AccountNotDelegated: UAC_BITS.NOT_DELEGATED!,
  UseDESKeyOnly: UAC_BITS.USE_DES_KEY_ONLY!,
  DoesNotRequirePreAuth: UAC_BITS.DONT_REQ_PREAUTH!,
};

/** The userAccountControl value a real DC would hold for this account. */
export function userAccountControl(
  attrs: Record<string, string> | undefined,
  status: string,
): { value: number; names: string[] } {
  let v = UAC_BITS.NORMAL_ACCOUNT!;
  if (status === 'disabled') v |= UAC_BITS.ACCOUNTDISABLE!;
  if (status === 'locked') v |= UAC_BITS.LOCKOUT!;
  for (const f of USER_FLAG_PARAMS) if (isTrue(attrs?.[f])) v |= FLAG_BIT[f];
  const names = Object.entries(UAC_BITS)
    .filter(([, bit]) => (v & bit) !== 0)
    .map(([n]) => n);
  return { value: v, names };
}

export function isTrue(v: string | undefined): boolean {
  return v !== undefined && /^(\$?true|1|yes)$/i.test(v.trim());
}

/**
 * Parse -Replace's hashtable: @{office='B12'; l="Paris"} or office=B12;l=Paris.
 * Returns null when it cannot be read, so the caller can say so.
 */
export function parseHashtable(raw: string): Record<string, string> | null {
  let body = raw.trim();
  const m = /^@\{([\s\S]*)\}$/.exec(body);
  if (m) body = m[1]!;
  const out: Record<string, string> = {};
  for (const part of body.split(/[;\n]/)) {
    const t = part.trim();
    if (!t) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) return null;
    const key = t.slice(0, eq).trim().replace(/^["']|["']$/g, '');
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!/^[A-Za-z][\w-]*$/.test(key)) return null;
    out[key] = val;
  }
  return out;
}
