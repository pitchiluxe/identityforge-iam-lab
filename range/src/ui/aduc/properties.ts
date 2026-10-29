/**
 * ui/consoles/aduc/properties.ts — the Properties sheets.
 *
 * The user sheet is the one every IAM interview walks through: General,
 * Address, Account (logon names, Unlock account, the account options list,
 * Account expires), Profile, Telephones, Organization (manager and direct
 * reports), Member Of (with Domain Users as the primary group). With View >
 * Advanced Features the Object, Security and Attribute Editor tabs appear, and
 * the Attribute Editor shows the LDAP names behind the boxes --
 * physicalDeliveryOfficeName, userAccountControl, memberOf.
 *
 * Edits are collected and written on OK or Apply, through the same
 * capabilities the terminal uses (Set-ADUser, Set-ADGroup,
 * Set-ADOrganizationalUnit, Add-ADGroupMember...), so an edit here is visible
 * to Get-ADUser at once and appears in the audit log.
 *
 * The tabs a lab never uses (Dial-in, Sessions, Remote control...) are still
 * here and still save: they are part of what the real sheet looks like, and
 * their values land in the Attribute Editor like any other.
 */
import type { Group, OrganizationalUnit, OuId, User } from './shim/domain';
import { USER_FLAG_LABELS, USER_FLAG_PARAMS, isTrue, userAccountControl, type UserFlag } from './shim/adAttributes';
import { scopeChangeAllowed } from './shim/config';
import { groupDn, guidFor, ouDn, sidFor, userDn } from './shim/adObjects';
import type { Aduc } from './context';
import { icon } from './icons';
import { materializeGroup } from './actions';
import {
  DOMAIN,
  DOMAIN_DN,
  NETBIOS,
  canonicalOf,
  groupTypeLabel,
  homeOf,
  type AdObj,
} from './model';
import { selectObjects } from './pickers';
import {
  button,
  checkbox,
  el,
  fieldset,
  grid,
  hr,
  listBox,
  messageBox,
  openDialog,
  propertySheet,
  radio,
  select,
  textbox,
  type Dialog,
  type SheetTab,
} from './ui';

// ---------------------------------------------------------------------------
// Shared sheet plumbing
// ---------------------------------------------------------------------------

/** One open sheet per object, as MMC does: opening it again brings it forward. */
const openSheets = new Map<string, Dialog>();

interface Sheet {
  dlg: Dialog;
  dirty(): void;
  /** Called on OK / Apply, in registration order. Return false to stop. */
  onApply(fn: () => boolean | void): void;
}

function openSheet(aduc: Aduc, key: string, title: string, rows: SheetTab[][], initial: string, width = 440, readOnly = false): Sheet | null {
  const existing = openSheets.get(key);
  if (existing?.root.isConnected) {
    existing.root.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return null;
  }
  const appliers: (() => boolean | void)[] = [];
  let applyBtn: HTMLButtonElement | null = null;
  const apply = (): boolean => {
    for (const fn of appliers) if (fn() === false) return false;
    if (applyBtn) applyBtn.disabled = true;
    aduc.refresh();
    return true;
  };
  const dlg = openDialog({
    title,
    width,
    height: 560,
    owner: aduc.owner,
    buttons: readOnly
      ? [{ label: 'OK', primary: true }, { label: 'Cancel', cancel: true }, { label: 'Apply', disabled: true }, { label: 'Help', onClick: () => false }]
      : [
          { label: 'OK', primary: true, onClick: () => (apply() ? undefined : false) },
          { label: 'Cancel', cancel: true },
          { label: 'Apply', disabled: true, onClick: () => void apply() },
          { label: 'Help', onClick: () => false },
        ],
  });
  applyBtn = dlg.buttons[2] ?? null;
  dlg.body.style.padding = '8px 9px 10px';
  dlg.body.style.overflow = 'hidden';
  openSheets.set(key, dlg);
  dlg.onClose = () => openSheets.delete(key);
  propertySheet(dlg.body, rows, initial);
  return {
    dlg,
    dirty: () => {
      if (applyBtn && !readOnly) applyBtn.disabled = false;
    },
    onApply: (fn) => appliers.push(fn),
  };
}

/** A text box that marks the sheet dirty and records its value under `key`. */
/**
 * `sheet` is a getter, not the sheet: the first tab is built while the sheet
 * is still being opened, before it exists, and a captured null meant edits on
 * the General tab never enabled Apply and OK saved nothing.
 */
function bound(sheet: () => Sheet | null, pending: Record<string, string>, key: string, value: string, opts: { width?: string; readOnly?: boolean } = {}): HTMLInputElement {
  const t = textbox(value, { width: opts.width, readOnly: opts.readOnly });
  t.style.width = opts.width ?? '100%';
  t.addEventListener('input', () => {
    pending[key] = t.value;
    sheet()?.dirty();
  });
  return t;
}

function area(sheet: () => Sheet | null, onChange: (v: string) => void, value: string, rows = 3): HTMLTextAreaElement {
  const a = document.createElement('textarea');
  a.value = value;
  a.rows = rows;
  a.style.width = '100%';
  a.addEventListener('input', () => {
    onChange(a.value);
    sheet()?.dirty();
  });
  return a;
}

const nameHeader = (iconName: Parameters<typeof icon>[0], name: string): HTMLElement => {
  const h = el('div');
  h.style.cssText = 'display:flex;align-items:center;gap:26px;padding:2px 0 10px;';
  h.append(icon(iconName, 32), el('span', undefined, name));
  return h;
};

/** "Other..." for multi-valued phone and web-page attributes. */
function otherValues(aduc: Aduc, title: string, current: string, onOk: (v: string) => void): void {
  const values = current ? current.split(';').map((s) => s.trim()).filter(Boolean) : [];
  const d = openDialog({ title, width: 360, modal: true, owner: aduc.owner, buttons: [{ label: 'OK', primary: true, onClick: () => onOk(values.join('; ')) }, { label: 'Cancel', cancel: true }] });
  const lb = listBox<string>([{ label: 'Values', render: (v) => v }], { height: '130px' });
  lb.setRows(values);
  const input = textbox('');
  const add = button('Add', () => {
    if (!input.value.trim()) return;
    values.push(input.value.trim());
    input.value = '';
    lb.setRows([...values]);
  });
  const rm = button('Remove', () => {
    for (const s of lb.selected()) values.splice(values.indexOf(s), 1);
    lb.setRows([...values]);
  });
  const row = el('div');
  row.style.cssText = 'display:flex;gap:6px;margin-top:6px;';
  row.append(input, add, rm);
  input.style.flex = '1';
  d.body.append(el('div', undefined, 'New value:'), row, el('div', undefined, 'Values:'), lb.el);
}

const COUNTRIES = ['', 'United States', 'Canada', 'Mexico', 'United Kingdom', 'France', 'Germany', 'Spain', 'Italy', 'Netherlands', 'Ireland', 'India', 'Japan', 'China', 'Singapore', 'Australia', 'Brazil', 'South Africa', 'Nigeria', 'Kenya', 'Ghana', 'Philippines', 'Haiti'];

// ---------------------------------------------------------------------------
// Security / Object / Attribute Editor (advanced tabs, shared)
// ---------------------------------------------------------------------------

/** Who is delegated what on the containers above `home` (the Security tab's extra entries). */
function delegationsOver(aduc: Aduc, home: string): { trustee: string; tasks: string[] }[] {
  const chain = new Set<string>(['domain']);
  for (let k: string | undefined = home; k?.startsWith('ou:'); ) {
    chain.add(k);
    const p: OuId | undefined = aduc.dir.getOu(k.slice(3) as OuId)?.parentId;
    k = p ? `ou:${p}` : undefined;
  }
  const out = new Map<string, Set<string>>();
  for (const d of aduc.dir.listDelegations()) {
    if (!chain.has(d.ouId ? `ou:${d.ouId}` : 'domain')) continue;
    const s = out.get(d.trustee) ?? new Set<string>();
    for (const t of d.tasks) s.add(t);
    out.set(d.trustee, s);
  }
  return [...out].map(([trustee, s]) => ({ trustee, tasks: [...s] }));
}

function securityTab(aduc: Aduc, objName: string, objectClass: 'user' | 'group' | 'ou', home: string): SheetTab {
  return {
    label: 'Security',
    build: (p) => {
      const delegated = delegationsOver(aduc, home);
      const principals = [
        { name: 'Everyone', perms: [] as string[] },
        ...(objectClass === 'user' ? [{ name: 'SELF', perms: ['Read', 'Change password'] }] : []),
        { name: 'Authenticated Users', perms: ['Read'] },
        { name: 'SYSTEM', perms: ['Full control'] },
        { name: `Domain Admins (${NETBIOS}\\Domain Admins)`, perms: ['Full control'] },
        { name: `Enterprise Admins (${NETBIOS}\\Enterprise Admins)`, perms: ['Full control'] },
        ...(objectClass === 'user' ? [{ name: `Account Operators (${NETBIOS}\\Account Operators)`, perms: ['Full control'] }] : []),
        { name: `Administrators (${NETBIOS}\\Administrators)`, perms: ['Read', 'Write', 'Create all child objects', 'Special permissions'] },
        ...delegated.map((d) => ({
          name: `${d.trustee} (${NETBIOS}\\${d.trustee})`,
          perms: [
            ...(d.tasks.some((t) => /manage user accounts|manage groups/.test(t)) ? ['Create all child objects', 'Delete all child objects'] : []),
            ...(d.tasks.some((t) => t.startsWith('Reset user passwords')) ? ['Reset password'] : []),
            ...(d.tasks.some((t) => t.startsWith('Read all user')) ? ['Read'] : []),
            ...(d.tasks.some((t) => t.startsWith('Modify the membership')) ? ['Write'] : []),
            'Special permissions',
          ],
        })),
      ];
      const lb = listBox<(typeof principals)[number]>([{ label: 'Group or user names:', render: (x) => x.name, iconOf: (x) => (x.name.startsWith('SELF') ? 'user' : 'group') }], { height: '120px' });
      lb.setRows(principals);
      const permsHost = el('div');
      const perms = objectClass === 'user'
        ? ['Full control', 'Read', 'Write', 'Create all child objects', 'Delete all child objects', 'Allowed to authenticate', 'Change password', 'Receive as', 'Reset password', 'Send as', 'Special permissions']
        : ['Full control', 'Read', 'Write', 'Create all child objects', 'Delete all child objects', 'Special permissions'];
      const paint = (sel?: (typeof principals)[number]): void => {
        permsHost.textContent = '';
        const t = el('table');
        t.style.cssText = 'width:100%;border-collapse:collapse;';
        const head = el('tr');
        head.append(el('td', undefined, `Permissions for ${sel?.name.split(' (')[0] ?? ''}`), css(el('td', undefined, 'Allow'), 'width:50px;text-align:center;'), css(el('td', undefined, 'Deny'), 'width:50px;text-align:center;'));
        t.appendChild(head);
        for (const perm of perms) {
          const tr = el('tr');
          const a = document.createElement('input');
          a.type = 'checkbox';
          a.disabled = true;
          a.checked = !!sel && (sel.perms.includes('Full control') || sel.perms.includes(perm));
          const dny = document.createElement('input');
          dny.type = 'checkbox';
          dny.disabled = true;
          const ca = css(el('td'), 'text-align:center;');
          ca.appendChild(a);
          const cd = css(el('td'), 'text-align:center;');
          cd.appendChild(dny);
          tr.append(el('td', undefined, perm), ca, cd);
          t.appendChild(tr);
        }
        const box = el('div', 'ad-lb');
        box.style.cssText += 'height:175px;padding:2px 4px;';
        box.appendChild(t);
        permsHost.appendChild(box);
      };
      lb.onSelect = (rows) => paint(rows[0]);
      paint();
      const adv = el('div');
      adv.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-top:8px;';
      adv.append(el('span', 'ad-note', 'For special permissions or advanced settings, click Advanced.'), button('Advanced', () => messageBox(
        delegated.length
          ? `Delegated on ${objName}'s location:\n\n` + delegated.map((d) => `${d.trustee}:\n  - ${d.tasks.join('\n  - ')}`).join('\n\n')
          : 'No delegations apply to this object. Use Delegate Control... on an OU to add some.',
        { title: `Advanced Security Settings for ${objName}`, kind: 'info' },
      )));
      const addRm = el('div');
      addRm.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin:6px 0;';
      addRm.append(button('Add...', () => messageBox('Use Delegate Control... on the OU to grant permissions in this lab.', { kind: 'info' })), button('Remove', () => undefined, { disabled: true }));
      p.append(lb.el, addRm, permsHost, adv);
    },
  };
}

function objectTab(aduc: Aduc, sheet: () => Sheet | null, info: { canonical: string; cls: string; created?: number; id: string; protectedNow: boolean; onProtect: (v: boolean) => void }): SheetTab {
  return {
    label: 'Object',
    build: (p) => {
      const created = info.created ? new Date(info.created).toLocaleString() : new Date().toLocaleString();
      const usn = String(12000 + (parseInt(guidFor(info.id).slice(0, 4), 16) % 9000));
      const prot = checkbox('Protect object from accidental deletion', info.protectedNow, (v) => {
        info.onProtect(v);
        sheet()?.dirty();
      });
      prot.el.style.marginTop = '14px';
      p.append(
        el('div', undefined, 'Canonical name of object:'),
        css(textbox(info.canonical, { readOnly: true }), 'width:100%;margin:3px 0 10px;'),
        grid('150px 1fr', 'Object class:', textbox(info.cls, { readOnly: true }), 'Created:', textbox(created, { readOnly: true }), 'Modified:', textbox(new Date().toLocaleString(), { readOnly: true })),
        css(el('div', undefined, 'Update Sequence Numbers (USNs):'), 'margin-top:12px;'),
        grid('150px 1fr', 'Current:', textbox(String(Number(usn) + 7), { readOnly: true }), 'Original:', textbox(usn, { readOnly: true })),
        prot.el,
      );
      void aduc;
    },
  };
}

type AttrRow = { name: string; value: string; editable?: boolean };

function attributeEditorTab(aduc: Aduc, rows: () => AttrRow[], onEdit: (name: string, value: string | undefined) => void, sheet: () => Sheet | null): SheetTab {
  return {
    label: 'Attribute Editor',
    build: (p) => {
      let onlyValues = true;
      const lb = listBox<AttrRow>(
        [
          { label: 'Attribute', render: (r) => r.name, width: '42%' },
          { label: 'Value', render: (r) => r.value || '<not set>' },
        ],
        { height: '290px', onOpen: (r) => edit(r) },
      );
      const repaint = (): void => lb.setRows(rows().filter((r) => !onlyValues || r.value).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })));
      const edit = (r?: AttrRow): void => {
        if (!r) return;
        if (!r.editable) {
          messageBox(`${r.name} is maintained by the directory or by another tab and cannot be edited here.`, { kind: 'info' });
          return;
        }
        const v = textbox(r.value);
        v.style.width = '100%';
        const d = openDialog({
          title: 'String Attribute Editor',
          width: 400,
          modal: true,
          owner: aduc.owner,
          buttons: [
            { label: 'OK', primary: true, onClick: () => { onEdit(r.name, v.value.trim() || undefined); sheet()?.dirty(); repaint(); } },
            { label: 'Cancel', cancel: true },
          ],
        });
        d.body.append(el('div', undefined, 'Attribute:  ' + r.name), css(el('div', undefined, 'Value:'), 'margin:8px 0 3px;'), v, css(button('Clear', () => (v.value = '')), 'margin-top:10px;'));
      };
      const only = checkbox('Show only attributes that have values', true, (v) => {
        onlyValues = v;
        repaint();
      });
      const bar = el('div');
      bar.style.cssText = 'display:flex;justify-content:space-between;margin-top:8px;';
      bar.append(button('Edit', () => edit(lb.selected()[0])), button('Filter', () => undefined, { disabled: true }));
      p.append(el('div', undefined, 'Attributes:'), lb.el, only.el, bar);
      repaint();
    },
  };
}

function css<T extends HTMLElement>(e: T, s: string): T {
  e.style.cssText += s;
  return e;
}

const fileTime = (ms: number): string => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14) + '.0Z';

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export function userProperties(aduc: Aduc, u: User, initialTab = 'General'): void {
  const advanced = aduc.advanced();
  const pending: Record<string, string> = {};
  const replace: Record<string, string | undefined> = {};
  let enable: boolean | undefined;
  let doUnlock = false;
  let dept: string | undefined;
  const addGroups: AdObj[] = [];
  const removeGroups = new Set<string>();
  let sheet: Sheet | null = null;
  const S = (): Sheet | null => sheet;
  const attrs = u.attrs ?? {};
  const gap = u.displayName.indexOf(' ');
  const firstIn = attrs.givenName ?? (gap === -1 ? u.displayName : u.displayName.slice(0, gap));
  const lastIn = attrs.sn ?? (gap === -1 ? '' : u.displayName.slice(gap + 1));
  const setReplace = (k: string, v: string | undefined): void => {
    replace[k] = v;
    sheet?.dirty();
  };

  const general: SheetTab = {
    label: 'General',
    build: (p) => {
      const phone = bound(S, pending, 'OfficePhone', attrs.telephoneNumber ?? '');
      const web = bound(S, pending, 'HomePage', attrs.wWWHomePage ?? '');
      p.append(
        nameHeader('user', u.displayName),
        hr(),
        grid('110px 1fr 50px 70px', 'First name:', bound(S, pending, 'GivenName', firstIn), 'Initials:', bound(S, pending, 'Initials', attrs.initials ?? '', { width: '70px' })),
        css(grid('110px 1fr', 'Last name:', bound(S, pending, 'Surname', lastIn), 'Display name:', bound(S, pending, 'DisplayName', u.displayName), 'Description:', bound(S, pending, 'Description', attrs.description ?? ''), 'Office:', bound(S, pending, 'Office', attrs.physicalDeliveryOfficeName ?? '')), 'margin-top:7px;'),
        hr(),
        grid('110px 1fr 80px', 'Telephone number:', phone, button('Other...', () => otherValues(aduc, 'Phone Number (Others)', replace.otherTelephone ?? attrs.otherTelephone ?? '', (v) => setReplace('otherTelephone', v))), 'E-mail:', bound(S, pending, 'EmailAddress', u.email), el('span'), 'Web page:', web, button('Other...', () => otherValues(aduc, 'Web Page Address (Others)', replace.url ?? attrs.url ?? '', (v) => setReplace('url', v)))),
      );
    },
  };

  const address: SheetTab = {
    label: 'Address',
    build: (p) => {
      const street = area(S, (v) => (pending.StreetAddress = v), attrs.streetAddress ?? '', 3);
      const country = select(COUNTRIES, attrs.c ?? '');
      country.style.width = '100%';
      country.addEventListener('change', () => {
        pending.Country = country.value;
        S()?.dirty();
      });
      p.append(grid('110px 1fr', 'Street:', street, 'P.O. Box:', bound(S, pending, 'POBox', attrs.postOfficeBox ?? ''), 'City:', bound(S, pending, 'City', attrs.l ?? ''), 'State/province:', bound(S, pending, 'State', attrs.st ?? ''), 'Zip/Postal Code:', bound(S, pending, 'PostalCode', attrs.postalCode ?? ''), 'Country/region:', country));
    },
  };

  const account: SheetTab = {
    label: 'Account',
    build: (p) => {
      const logon = bound(S, pending, 'SamAccountName', u.username);
      const suffix = select([`@${DOMAIN}`]);
      const pre = textbox(`${NETBIOS}\\`, { readOnly: true });
      const sam = textbox(u.username);
      logon.addEventListener('input', () => (sam.value = logon.value.slice(0, 20)));
      sam.addEventListener('input', () => {
        pending.SamAccountName = sam.value;
        S()?.dirty();
      });
      const hours = button('Logon Hours...', () => logonHoursDialog(aduc, replace.logonHours ?? attrs.logonHours, (v) => setReplace('logonHours', v)));
      const logonTo = button('Log On To...', () => logOnToDialog(aduc, pending.LogonWorkstations ?? attrs.userWorkstations ?? '', (v) => { pending.LogonWorkstations = v; S()?.dirty(); }));
      const btns = el('div');
      btns.style.cssText = 'display:flex;gap:10px;margin:10px 0 8px;';
      btns.append(hours, logonTo);

      const locked = u.status === 'locked';
      const unlock = checkbox(locked ? 'Unlock account. This account is currently locked out on this Active Directory Domain Controller.' : 'Unlock account', false, (v) => {
        doUnlock = v;
        S()?.dirty();
      });
      if (!locked) unlock.setDisabled(true);

      // The scrolling account-options list, in the server's order.
      const optBox = el('div', 'ad-lb');
      optBox.style.cssText += 'height:84px;padding:2px 4px;';
      const must = checkbox('User must change password at next logon', !!u.mustChangePassword);
      const flagChecks = new Map<UserFlag, ReturnType<typeof checkbox>>();
      const disabledChk = checkbox('Account is disabled', u.status === 'disabled', (v) => {
        enable = !v;
        S()?.dirty();
      });
      must.input.addEventListener('change', () => {
        if (must.checked && flagChecks.get('CannotChangePassword')?.checked) {
          messageBox('You cannot check both User must change password at next logon and User cannot change password for the same user.', { kind: 'warning' });
          must.checked = false;
          return;
        }
        if (must.checked && flagChecks.get('PasswordNeverExpires')?.checked) {
          messageBox('You specified that the password should never expire. The user will not be required to change the password at next logon.', { kind: 'info' });
          must.checked = false;
          return;
        }
        pending.ChangePasswordAtLogon = String(must.checked);
        S()?.dirty();
      });
      optBox.appendChild(must.el);
      const order: UserFlag[] = ['CannotChangePassword', 'PasswordNeverExpires', 'AllowReversiblePasswordEncryption'];
      for (const f of [...order, ...USER_FLAG_PARAMS.filter((x) => !order.includes(x))]) {
        const c = checkbox(USER_FLAG_LABELS[f], isTrue(attrs[f]), (v) => {
          if (f === 'PasswordNeverExpires' && v && must.checked) {
            messageBox('You specified that the password should never expire. The user will not be required to change the password at next logon.', { kind: 'info' });
            must.checked = false;
            pending.ChangePasswordAtLogon = 'false';
          }
          if (f === 'CannotChangePassword' && v && must.checked) {
            messageBox('You cannot check both User must change password at next logon and User cannot change password for the same user.', { kind: 'warning' });
            c.checked = false;
            return;
          }
          pending[f] = String(v);
          S()?.dirty();
        });
        flagChecks.set(f, c);
        optBox.appendChild(c.el);
        if (f === 'AllowReversiblePasswordEncryption') optBox.appendChild(disabledChk.el);
      }

      const expFs = fieldset('Account expires');
      const expIn = attrs.accountExpires ?? '';
      const date = textbox(expIn, { type: 'date' });
      const never = radio(`exp-${u.id}`, 'Never', !expIn, () => {
        date.disabled = true;
        pending.AccountExpirationDate = '';
        S()?.dirty();
      });
      const endOf = radio(`exp-${u.id}`, 'End of:', !!expIn, () => {
        date.disabled = false;
        if (!date.value) date.value = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
        pending.AccountExpirationDate = date.value;
        S()?.dirty();
      });
      date.disabled = !expIn;
      date.addEventListener('change', () => {
        pending.AccountExpirationDate = date.value;
        S()?.dirty();
      });
      const endRow = el('div');
      endRow.style.cssText = 'display:flex;align-items:center;gap:12px;';
      endRow.append(endOf.el, date);
      expFs.append(never.el, endRow);

      p.append(
        el('div', undefined, 'User logon name:'),
        css(grid('1fr 170px', logon, suffix), 'margin:3px 0 8px;'),
        el('div', undefined, 'User logon name (pre-Windows 2000):'),
        css(grid('1fr 1fr', pre, sam), 'margin-top:3px;'),
        btns,
        unlock.el,
        css(el('div', undefined, 'Account options:'), 'margin:8px 0 3px;'),
        optBox,
        css(expFs, 'margin-top:10px;'),
      );
    },
  };

  const profile: SheetTab = {
    label: 'Profile',
    build: (p) => {
      const upFs = fieldset('User profile');
      upFs.appendChild(grid('100px 1fr', 'Profile path:', bound(S, pending, 'ProfilePath', attrs.profilePath ?? ''), 'Logon script:', bound(S, pending, 'ScriptPath', attrs.scriptPath ?? '')));
      const hfFs = fieldset('Home folder');
      const local = textbox(attrs.homeDrive ? '' : attrs.homeDirectory ?? '');
      const drive = select(['Z:', 'Y:', 'X:', 'W:', 'V:', 'U:', 'H:'], attrs.homeDrive ?? 'Z:', '70px');
      const to = textbox(attrs.homeDrive ? attrs.homeDirectory ?? '' : '');
      const useLocal = radio(`hf-${u.id}`, 'Local path:', !attrs.homeDrive, () => {
        local.disabled = false;
        drive.disabled = to.disabled = true;
        pending.HomeDrive = '';
        pending.HomeDirectory = local.value;
        S()?.dirty();
      });
      const connect = radio(`hf-${u.id}`, 'Connect:', !!attrs.homeDrive, () => {
        local.disabled = true;
        drive.disabled = to.disabled = false;
        pending.HomeDrive = drive.value;
        pending.HomeDirectory = to.value;
        S()?.dirty();
      });
      local.disabled = !!attrs.homeDrive;
      drive.disabled = to.disabled = !attrs.homeDrive;
      local.addEventListener('input', () => { pending.HomeDirectory = local.value; S()?.dirty(); });
      to.addEventListener('input', () => { pending.HomeDirectory = to.value; pending.HomeDrive = drive.value; S()?.dirty(); });
      drive.addEventListener('change', () => { pending.HomeDrive = drive.value; S()?.dirty(); });
      to.placeholder = '\\\\server\\share\\%username%';
      const r1 = el('div');
      r1.style.cssText = 'display:grid;grid-template-columns:100px 1fr;gap:8px;align-items:center;';
      r1.append(useLocal.el, local);
      const r2 = el('div');
      r2.style.cssText = 'display:grid;grid-template-columns:100px 70px 26px 1fr;gap:8px;align-items:center;margin-top:7px;';
      r2.append(connect.el, drive, el('span', undefined, 'To:'), to);
      hfFs.append(r1, r2);
      p.append(upFs, css(hfFs, 'margin-top:12px;'));
    },
  };

  const telephones: SheetTab = {
    label: 'Telephones',
    build: (p) => {
      const other = (label: string, attr: string): HTMLButtonElement =>
        button('Other...', () => otherValues(aduc, `${label} (Others)`, replace[attr] ?? attrs[attr] ?? '', (v) => setReplace(attr, v)));
      const pager = textbox(attrs.pager ?? '');
      pager.addEventListener('input', () => setReplace('pager', pager.value));
      const ip = textbox(attrs.ipPhone ?? '');
      ip.addEventListener('input', () => setReplace('ipPhone', ip.value));
      const fs = fieldset('Telephone numbers');
      fs.appendChild(grid('80px 1fr 80px',
        'Home:', bound(S, pending, 'HomePhone', attrs.homePhone ?? ''), other('Home Phone', 'otherHomePhone'),
        'Pager:', pager, other('Pager', 'otherPager'),
        'Mobile:', bound(S, pending, 'MobilePhone', attrs.mobile ?? ''), other('Mobile', 'otherMobile'),
        'Fax:', bound(S, pending, 'Fax', attrs.facsimileTelephoneNumber ?? ''), other('Fax', 'otherFacsimileTelephoneNumber'),
        'IP phone:', ip, other('IP Phone', 'otherIpPhone')));
      p.append(fs, css(el('div', undefined, 'Notes:'), 'margin:12px 0 3px;'), area(S, (v) => (replace.info = v), attrs.info ?? '', 7));
    },
  };

  const organization: SheetTab = {
    label: 'Organization',
    build: (p) => {
      const deptBox = textbox(u.department);
      deptBox.style.width = '100%';
      deptBox.addEventListener('input', () => {
        dept = deptBox.value;
        S()?.dirty();
      });
      const mgrName = (): string => {
        const m = pending.Manager ?? attrs.manager ?? (u.managerId ? aduc.dir.getUser(u.managerId)?.username : '') ?? '';
        return m ? aduc.dir.getUserByUsername(m)?.displayName ?? m : '';
      };
      const mgr = textbox(mgrName(), { readOnly: true });
      mgr.style.width = '100%';
      const mfs = fieldset('Manager');
      const mbtns = el('div');
      mbtns.style.cssText = 'display:flex;gap:8px;margin-top:6px;';
      mbtns.append(
        button('Change...', () => selectObjects(aduc, {
          title: 'Select User or Contact',
          kinds: ['user'],
          multi: false,
          exclude: new Set([`user:${u.id}`]),
          onOk: (picked) => {
            const m = picked[0]?.user;
            if (!m) return;
            pending.Manager = m.username;
            mgr.value = m.displayName;
            S()?.dirty();
          },
        })),
        button('Properties', () => {
          const m = aduc.dir.getUserByUsername(pending.Manager ?? attrs.manager ?? '') ?? (u.managerId ? aduc.dir.getUser(u.managerId) : undefined);
          if (m) userProperties(aduc, m);
        }),
        button('Clear', () => {
          pending.Manager = '';
          mgr.value = '';
          S()?.dirty();
        }),
      );
      mfs.append(grid('50px 1fr', 'Name:', mgr), mbtns);
      const reports = listBox<User>([{ label: 'Direct reports:', render: (x) => x.displayName, iconOf: () => 'user' }], { height: '90px', onOpen: (x) => userProperties(aduc, x) });
      reports.setRows(aduc.dir.listUsers().filter((x) => x.attrs?.manager === u.username || (!x.attrs?.manager && x.managerId === u.id)));
      p.append(
        grid('90px 1fr', 'Job Title:', bound(S, pending, 'Title', u.title), 'Department:', deptBox, 'Company:', bound(S, pending, 'Company', attrs.company ?? '')),
        css(mfs, 'margin-top:12px;'),
        css(el('div', undefined, 'Direct reports:'), 'margin:10px 0 3px;'),
        reports.el,
      );
    },
  };

  const memberOf: SheetTab = {
    label: 'Member Of',
    build: (p) => {
      type Row = { key: string; name: string; folder: string; obj?: AdObj };
      const rows = (): Row[] => {
        const out: Row[] = [{ key: 'primary', name: 'Domain Users', folder: `${DOMAIN}/Users` }];
        for (const g of aduc.dir.listGroups()) {
          if (g.name === 'Domain Users' || !g.memberIds.includes(u.id) || removeGroups.has(g.id)) continue; // the primary group is listed once, above
          out.push({ key: g.id, name: g.name, folder: canonicalOf(homeOf(g), aduc.dir) });
        }
        for (const a of addGroups) out.push({ key: a.key, name: a.name, folder: a.group ? canonicalOf(homeOf(a.group), aduc.dir) : `${DOMAIN}/Users`, obj: a });
        return out;
      };
      const lb = listBox<Row>([
        { label: 'Name', render: (r) => r.name, width: '40%', iconOf: () => 'group' },
        { label: 'Active Directory Domain Services Folder', render: (r) => r.folder },
      ], { height: '230px', multi: true });
      lb.setRows(rows());
      const add = button('Add...', () => selectObjects(aduc, {
        title: 'Select Groups',
        kinds: ['group'],
        multi: true,
        exclude: new Set(rows().map((r) => (r.obj ? r.obj.key : `group:${r.key}`))),
        onOk: (picked) => {
          for (const g of picked) {
            if (g.group && removeGroups.has(g.group.id)) removeGroups.delete(g.group.id);
            else if (!addGroups.some((a) => a.key === g.key)) addGroups.push(g);
          }
          lb.setRows(rows());
          S()?.dirty();
        },
      }));
      const rm = button('Remove', () => {
        const sel = lb.selected();
        if (!sel.length) return;
        if (sel.some((r) => r.key === 'primary')) {
          messageBox('The primary group cannot be removed. Set another group as primary if you want to remove this one.', { kind: 'error' });
          return;
        }
        messageBox(`Do you want to remove ${u.displayName} from the selected group(s)?`, {
          kind: 'question',
          yesNo: true,
          onYes: () => {
            for (const r of sel) {
              const i = addGroups.findIndex((a) => a.key === r.key);
              if (i >= 0) addGroups.splice(i, 1);
              else removeGroups.add(r.key);
            }
            lb.setRows(rows());
            S()?.dirty();
          },
        });
      });
      const btns = el('div');
      btns.style.cssText = 'display:flex;gap:8px;margin:8px 0;';
      btns.append(add, rm);
      const primary = el('div');
      primary.style.cssText = 'display:grid;grid-template-columns:110px 1fr;row-gap:8px;align-items:center;';
      primary.append(el('span', undefined, 'Primary group:'), el('span', undefined, 'Domain Users'), button('Set Primary Group', () => undefined, { disabled: true }), css(el('span', 'ad-note', 'There is no need to change Primary group unless you have Macintosh clients or POSIX-compliant applications.'), 'padding-left:10px;'));
      p.append(el('div', undefined, 'Member of:'), lb.el, btns, hr(), primary);
    },
  };

  // The tabs few labs touch, reproduced so the sheet looks as it does on a server.
  const dialIn: SheetTab = {
    label: 'Dial-in',
    build: (p) => {
      const cur = attrs.msNPAllowDialin;
      const fs = fieldset('Network Access Permission');
      fs.append(
        radio(`nap-${u.id}`, 'Allow access', cur === 'TRUE', () => setReplace('msNPAllowDialin', 'TRUE')).el,
        radio(`nap-${u.id}`, 'Deny access', cur === 'FALSE', () => setReplace('msNPAllowDialin', 'FALSE')).el,
        radio(`nap-${u.id}`, 'Control access through NPS Network Policy', !cur, () => setReplace('msNPAllowDialin', undefined)).el,
      );
      const verify = checkbox('Verify Caller-ID:', false);
      const cb = fieldset('Callback Options');
      const cbv = attrs.msRADIUSServiceType ?? '';
      cb.append(
        radio(`cb-${u.id}`, 'No Callback', !cbv, () => setReplace('msRADIUSServiceType', undefined)).el,
        radio(`cb-${u.id}`, 'Set by Caller (Routing and Remote Access Service only)', cbv === '4', () => setReplace('msRADIUSServiceType', '4')).el,
        radio(`cb-${u.id}`, 'Always Callback to:', cbv === '3', () => setReplace('msRADIUSServiceType', '3')).el,
      );
      const ip = checkbox('Assign Static IP Addresses', false);
      const routes = checkbox('Apply Static Routes', false);
      p.append(fs, css(verify.el, 'margin:8px 0;'), cb, css(ip.el, 'margin-top:8px;'), routes.el, css(el('div', 'ad-note', 'Define routes to enable for this Dial-in connection.'), 'margin-left:18px;'));
    },
  };
  const environment: SheetTab = {
    label: 'Environment',
    build: (p) => {
      p.appendChild(el('div', 'ad-note', 'Use this tab to configure the Remote Desktop Services startup environment. These settings override client-specified settings.'));
      const sp = fieldset('Starting program');
      const start = checkbox('Start the following program at logon:', !!attrs.msTSInitialProgram);
      const prog = textbox(attrs.msTSInitialProgram ?? '');
      const dir_ = textbox(attrs.msTSWorkDirectory ?? '');
      prog.addEventListener('input', () => setReplace('msTSInitialProgram', prog.value));
      dir_.addEventListener('input', () => setReplace('msTSWorkDirectory', dir_.value));
      sp.append(start.el, grid('130px 1fr', 'Program file name:', prog, 'Start in:', dir_));
      const cd = fieldset('Client devices');
      cd.append(checkbox('Connect client drives at logon', true).el, checkbox('Connect client printers at logon', true).el, checkbox('Default to main client printer', true).el);
      p.append(css(sp, 'margin-top:10px;'), css(cd, 'margin-top:10px;'));
    },
  };
  const sessions: SheetTab = {
    label: 'Sessions',
    build: (p) => {
      const limits = ['Never', '1 minute', '5 minutes', '10 minutes', '15 minutes', '30 minutes', '1 hour', '2 hours', '1 day', '2 days'];
      const sel = (attr: string): HTMLSelectElement => {
        const s = select(limits, attrs[attr] ?? 'Never', '100%');
        s.addEventListener('change', () => setReplace(attr, s.value === 'Never' ? undefined : s.value));
        return s;
      };
      p.appendChild(el('div', 'ad-note', 'Use this tab to set Remote Desktop Services timeout and reconnection settings.'));
      p.appendChild(css(grid('170px 1fr', 'End a disconnected session:', sel('msTSMaxDisconnectionTime'), 'Active session limit:', sel('msTSMaxConnectionTime'), 'Idle session limit:', sel('msTSMaxIdleTime')), 'margin-top:12px;'));
      const lim = fieldset('When a session limit is reached or connection is broken:');
      lim.append(radio(`sl-${u.id}`, 'Disconnect from session', true).el, radio(`sl-${u.id}`, 'End session', false).el);
      const rec = fieldset('Allow reconnection:');
      rec.append(radio(`rc-${u.id}`, 'From any client', true).el, radio(`rc-${u.id}`, 'From originating client only', false).el);
      p.append(css(lim, 'margin-top:12px;'), css(rec, 'margin-top:10px;'));
    },
  };
  const remoteControl: SheetTab = {
    label: 'Remote control',
    build: (p) => {
      p.appendChild(el('div', 'ad-note', "Use this tab to configure Remote Desktop Services remote control settings. To remotely control or observe a user's session, select the following check box:"));
      const en = checkbox('Enable remote control', true);
      const req = checkbox("Require user's permission", true);
      const lvl = fieldset('Level of control');
      lvl.append(radio(`rcl-${u.id}`, "View the user's session", false).el, radio(`rcl-${u.id}`, "Interact with the session", true).el);
      p.append(css(en.el, 'margin-top:10px;'), css(req.el, 'margin-left:18px;'), css(lvl, 'margin:8px 0 0 18px;'));
    },
  };
  const rdsProfile: SheetTab = {
    label: 'Remote Desktop Services Profile',
    build: (p) => {
      p.appendChild(el('div', 'ad-note', 'Use this tab to configure the Remote Desktop Services user profile. Settings in this profile apply to Remote Desktop Services.'));
      const prof = fieldset('Remote Desktop Services User Profile');
      const pp = textbox(attrs.msTSProfilePath ?? '');
      pp.addEventListener('input', () => setReplace('msTSProfilePath', pp.value));
      prof.appendChild(grid('80px 1fr', 'Profile Path:', pp));
      const hf = fieldset('Remote Desktop Services Home Folder');
      const hp = textbox(attrs.msTSHomeDirectory ?? '');
      hp.addEventListener('input', () => setReplace('msTSHomeDirectory', hp.value));
      hf.append(radio(`rdh-${u.id}`, 'Local path:', true).el, hp);
      const deny = checkbox('Deny this user permissions to log on to Remote Desktop Session Host server', attrs.msTSAllowLogon === 'FALSE', (v) => setReplace('msTSAllowLogon', v ? 'FALSE' : undefined));
      p.append(css(prof, 'margin-top:10px;'), css(hf, 'margin-top:10px;'), css(deny.el, 'margin-top:10px;'));
    },
  };
  const complus: SheetTab = {
    label: 'COM+',
    build: (p) => {
      const s = select(['<none>'], '<none>', '100%');
      p.append(css(el('div', undefined, 'Make this user a member of the following COM+ partition set:'), 'margin-bottom:6px;'), grid('90px 1fr', 'Partition Set:', s));
    },
  };
  const pwdRepl: SheetTab = {
    label: 'Password Replication',
    build: (p) => {
      p.appendChild(el('div', 'ad-note', 'This is a Password Replication Policy for Read-only Domain Controllers (RODCs). An RODC stores user or computer passwords only if they are in the Allow group.'));
      const lb = listBox<[string, string]>([{ label: 'Groups, users and computers', render: (r) => r[0], iconOf: () => 'group' }, { label: 'Setting', render: (r) => r[1] }], { height: '200px' });
      lb.setRows([['Account Operators', 'Deny'], ['Administrators', 'Deny'], ['Allowed RODC Password Replication Group', 'Allow'], ['Backup Operators', 'Deny'], ['Denied RODC Password Replication Group', 'Deny'], ['Server Operators', 'Deny']]);
      p.append(css(lb.el, 'margin-top:8px;'));
    },
  };
  const certs: SheetTab = {
    label: 'Published Certificates',
    build: (p) => {
      const lb = listBox<string>([{ label: 'Issued To', render: (s) => s }, { label: 'Issued By', render: () => '' }, { label: 'Intended Purposes', render: () => '' }, { label: 'Expiration Date', render: () => '' }], { height: '220px' });
      lb.setRows([]);
      const b = el('div');
      b.style.cssText = 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;';
      b.append(button('Add from Store...', () => undefined, { disabled: true }), button('Add from File...', () => undefined, { disabled: true }), button('Remove', () => undefined, { disabled: true }), button('Copy to File...', () => undefined, { disabled: true }));
      p.append(el('div', undefined, 'List of X509 certificates published for the user account'), css(lb.el, 'margin-top:4px;'), b);
    },
  };

  let protect: boolean | undefined;
  const object = objectTab(aduc, S, {
    canonical: `${canonicalOf(homeOf(u), aduc.dir)}/${u.displayName}`,
    cls: 'User',
    created: u.createdAt,
    id: u.id,
    protectedNow: isTrue(attrs.ProtectedFromAccidentalDeletion),
    onProtect: (v) => (protect = v),
  });
  const security = securityTab(aduc, u.displayName, 'user', homeOf(u));
  // Read live: after Apply the sheet's opening snapshot is out of date.
  const attrEditor = attributeEditorTab(aduc, () => {
    const cur = aduc.dir.getUser(u.id) ?? u;
    return userAttributeRows(aduc, cur, { ...(cur.attrs ?? {}), ...Object.fromEntries(Object.entries(replace).map(([k, v]) => [k, v ?? ''])) });
  }, (k, v) => (replace[k] = v), S);

  const rows: SheetTab[][] = advanced
    ? [[certs, memberOf, pwdRepl, dialIn, object], [security, environment, sessions, remoteControl], [rdsProfile, complus, attrEditor], [general, address, account, profile, telephones, organization]]
    : [[memberOf, pwdRepl, dialIn, environment], [sessions, remoteControl, rdsProfile, complus], [general, address, account, profile, telephones, organization]];

  sheet = openSheet(aduc, `user:${u.id}`, `${u.displayName} Properties`, rows, initialTab, advanced ? 520 : 470);
  if (!sheet) return;

  sheet.onApply(() => {
    let identity = u.username;
    const args: Record<string, string> = { ...pending };
    const rep = Object.entries(replace).filter(([, v]) => v !== undefined && v !== '');
    const clr = Object.entries(replace).filter(([, v]) => v === undefined || v === '').map(([k]) => k);
    if (protect !== undefined) {
      if (protect) rep.push(['ProtectedFromAccidentalDeletion', 'TRUE']);
      else clr.push('ProtectedFromAccidentalDeletion');
    }
    if (rep.length) args.Replace = rep.map(([k, v]) => `${k}=${v!.replace(/;/g, ',')}`).join(';');
    if (clr.length) args.Clear = clr.join(',');
    // Set-ADUser -Manager takes an identity; an emptied manager is -Clear manager.
    if (args.Manager === '') {
      delete args.Manager;
      args.Clear = [args.Clear, 'manager'].filter(Boolean).join(',');
    }
    if (Object.keys(args).length) {
      const r = aduc.run('user.update', { Identity: identity, ...args });
      if (!r.ok) return false;
      identity = pending.SamAccountName?.trim() || identity;
    }
    if (dept !== undefined && dept.trim() && dept.trim() !== u.department) {
      if (!aduc.run('user.move', { Identity: identity, TargetDepartment: dept.trim() }).ok) return false;
    }
    if (enable !== undefined && enable !== (u.status !== 'disabled')) {
      if (!aduc.run(enable ? 'user.enable' : 'user.disable', { Identity: identity }).ok) return false;
    }
    if (doUnlock && u.status === 'locked') aduc.run('account.unlock', { Identity: identity });
    const cur = aduc.dir.getUserByUsername(identity);
    if (cur && addGroups.length) addUsersToGroupsQuiet(aduc, cur, addGroups);
    for (const gid of removeGroups) {
      const g = aduc.dir.getGroup(gid as Group['id']);
      if (g) aduc.run('group.removeMember', { Identity: identity, Group: g.name });
    }
    for (const k of Object.keys(pending)) delete pending[k];
    for (const k of Object.keys(replace)) delete replace[k];
    addGroups.length = 0;
    removeGroups.clear();
    dept = undefined;
    enable = undefined;
    doUnlock = false;
    protect = undefined;
    return true;
  });
}

function addUsersToGroupsQuiet(aduc: Aduc, u: User, groups: AdObj[]): void {
  for (const go of groups) {
    const g = materializeGroup(aduc, go);
    if (g && !g.memberIds.includes(u.id)) aduc.run('group.addMember', { Identity: u.username, Group: g.name });
  }
}

/** The Attribute Editor's view of an account: the LDAP names, as a DC would list them. */
function userAttributeRows(aduc: Aduc, u: User, attrs: Record<string, string>): AttrRow[] {
  const dir = aduc.dir;
  const uac = userAccountControl(attrs, u.status);
  const groups = dir.listGroups().filter((g) => g.memberIds.includes(u.id));
  const mgr = attrs.manager ? dir.getUserByUsername(attrs.manager) : u.managerId ? dir.getUser(u.managerId) : undefined;
  const flagNames = new Set<string>([...USER_FLAG_PARAMS, 'ProtectedFromAccidentalDeletion']);
  const known: AttrRow[] = [
    { name: 'accountExpires', value: attrs.accountExpires ? `${attrs.accountExpires} 11:59:59 PM` : '(never)' },
    { name: 'badPwdCount', value: '0' },
    { name: 'cn', value: u.displayName },
    { name: 'department', value: u.department },
    { name: 'displayName', value: u.displayName },
    { name: 'distinguishedName', value: userDn(dir, u) },
    { name: 'instanceType', value: '0x4 = ( WRITE )' },
    { name: 'mail', value: u.email },
    { name: 'manager', value: mgr ? userDn(dir, mgr) : '' },
    { name: 'memberOf', value: groups.map((g) => groupDn(dir, g)).join('; ') },
    { name: 'name', value: u.displayName },
    { name: 'objectCategory', value: `CN=Person,CN=Schema,CN=Configuration,${DOMAIN_DN}` },
    { name: 'objectClass', value: 'top; person; organizationalPerson; user' },
    { name: 'objectGUID', value: guidFor(u.id) },
    { name: 'objectSid', value: sidFor(u.id, u.username, aduc.dir.domainName) },
    { name: 'primaryGroupID', value: '513 = ( GROUP_RID_USERS )' },
    { name: 'pwdLastSet', value: u.mustChangePassword ? '0' : new Date(u.createdAt).toLocaleString() },
    { name: 'sAMAccountName', value: u.username },
    { name: 'sAMAccountType', value: '805306368 = ( NORMAL_USER_ACCOUNT )' },
    { name: 'title', value: u.title },
    { name: 'userAccountControl', value: `0x${uac.value.toString(16)} = ( ${uac.names.join(' | ')} )` },
    { name: 'userPrincipalName', value: `${u.username}@${DOMAIN}` },
    { name: 'whenChanged', value: fileTime(Date.now()) },
    { name: 'whenCreated', value: fileTime(u.createdAt) },
  ];
  const seen = new Set(known.map((k) => k.name.toLowerCase()));
  const extra: AttrRow[] = Object.entries(attrs)
    .filter(([k]) => !flagNames.has(k) && !seen.has(k.toLowerCase()))
    .map(([k, v]) => ({ name: k, value: k === 'manager' ? '' : v, editable: true }));
  const editableEmpty = ['physicalDeliveryOfficeName', 'telephoneNumber', 'description', 'givenName', 'sn', 'initials', 'company', 'streetAddress', 'l', 'st', 'postalCode', 'wWWHomePage', 'info', 'employeeID', 'employeeNumber', 'employeeType', 'extensionAttribute1']
    .filter((k) => !attrs[k])
    .map((k) => ({ name: k, value: '', editable: true }));
  return [...known, ...extra, ...editableEmpty];
}

// ---------------------------------------------------------------------------
// Logon Hours / Log On To
// ---------------------------------------------------------------------------

function logonHoursDialog(aduc: Aduc, current: string | undefined, onOk: (v: string) => void): void {
  // 168 cells, Sunday 00:00 first; '1' = permitted. Absent = always permitted.
  const cells = (current && current.length === 168 ? current : '1'.repeat(168)).split('').map((c) => c === '1');
  const d = openDialog({
    title: `Logon Hours`,
    width: 620,
    modal: true,
    owner: aduc.owner,
    buttons: [
      { label: 'OK', primary: true, onClick: () => onOk(cells.every(Boolean) ? '' : cells.map((c) => (c ? '1' : '0')).join('')) },
      { label: 'Cancel', cancel: true },
    ],
  });
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const wrap = el('div');
  wrap.style.cssText = 'display:grid;grid-template-columns:80px 1fr 120px;gap:10px;';
  const labels = el('div');
  labels.style.cssText = 'display:flex;flex-direction:column;gap:1px;padding-top:20px;';
  const g = el('div');
  g.style.cssText = 'display:grid;grid-template-columns:repeat(24,1fr);gap:1px;';
  const head = el('div');
  head.style.cssText = 'display:grid;grid-template-columns:repeat(24,1fr);font-size:10px;color:#444;height:18px;';
  for (let h = 0; h < 24; h++) head.appendChild(el('span', undefined, h % 6 === 0 ? `${h === 0 ? 12 : h > 12 ? h - 12 : h}${h < 12 ? 'AM' : 'PM'}` : ''));
  const cellEls: HTMLElement[] = [];
  let painting: boolean | null = null;
  const paint = (): void => cellEls.forEach((c, i) => c.classList.toggle('on', cells[i]!));
  for (let day = 0; day < 7; day++) {
    labels.appendChild(css(el('div', undefined, days[day]), 'height:18px;line-height:18px;'));
    for (let h = 0; h < 24; h++) {
      const i = day * 24 + h;
      const c = el('div', 'ad-hour');
      c.addEventListener('mousedown', (e) => {
        e.preventDefault();
        painting = !cells[i];
        cells[i] = painting;
        paint();
      });
      c.addEventListener('mouseenter', () => {
        if (painting === null) return;
        cells[i] = painting;
        paint();
      });
      cellEls.push(c);
      g.appendChild(c);
    }
  }
  document.addEventListener('mouseup', () => (painting = null));
  const gridWrap = el('div');
  gridWrap.append(head, g);
  const side = el('div');
  side.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding-top:20px;';
  side.append(
    radio('lh', 'Logon Permitted', true).el,
    radio('lh', 'Logon Denied', false).el,
    button('All permitted', () => { cells.fill(true); paint(); }),
    button('Weekdays 8-6', () => { cells.fill(false); for (let d_ = 1; d_ <= 5; d_++) for (let h = 8; h < 18; h++) cells[d_ * 24 + h] = true; paint(); }),
  );
  wrap.append(labels, gridWrap, side);
  d.body.appendChild(wrap);
  d.body.appendChild(css(el('div', 'ad-note', 'Drag across the grid to permit (blue) or deny (white) hours. Stored in the logonHours attribute.'), 'margin-top:10px;'));
  paint();
}

function logOnToDialog(aduc: Aduc, current: string, onOk: (v: string) => void): void {
  const list = current ? current.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const d = openDialog({ title: 'Logon Workstations', width: 420, modal: true, owner: aduc.owner, buttons: [{ label: 'OK', primary: true, onClick: () => onOk(all.checked ? '' : list.join(',')) }, { label: 'Cancel', cancel: true }] });
  d.body.appendChild(el('div', 'ad-note', 'In Computer name, type the computer\'s NetBIOS or Domain Name System (DNS) name.'));
  const fs = fieldset('This user can log on to:');
  const all = radio('lot', 'All computers', list.length === 0);
  const some = radio('lot', 'The following computers', list.length > 0);
  const name = textbox('');
  const lb = listBox<string>([{ label: 'Computers', render: (s) => s, iconOf: () => 'computer' }], { height: '100px' });
  lb.setRows(list);
  const add = button('Add', () => { if (name.value.trim()) { list.push(name.value.trim().toUpperCase()); name.value = ''; lb.setRows([...list]); some.checked = true; } });
  const rm = button('Remove', () => { for (const s of lb.selected()) list.splice(list.indexOf(s), 1); lb.setRows([...list]); });
  fs.append(all.el, some.el, grid('110px 1fr 70px', 'Computer name:', name, add), css(lb.el, 'margin-top:6px;'), css(rm, 'margin-top:6px;'));
  d.body.appendChild(css(fs, 'margin-top:8px;'));
}

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

export function groupProperties(aduc: Aduc, g: Group, initialTab = 'General'): void {
  const advanced = aduc.advanced();
  let sheet: Sheet | null = null;
  const S = (): Sheet | null => sheet;
  const attrs = g.attrs ?? {};
  let desc: string | undefined;
  let scope: Group['scope'];
  let category: Group['category'];
  const replace: Record<string, string | undefined> = {};
  const addMembers: User[] = [];
  const removeMembers = new Set<string>();
  let managedBy: string | undefined;
  let protect: boolean | undefined;

  const general: SheetTab = {
    label: 'General',
    build: (p) => {
      const pre = textbox(attrs.sAMAccountName ?? g.name);
      pre.style.width = '100%';
      pre.addEventListener('input', () => { replace.sAMAccountName = pre.value; S()?.dirty(); });
      const d_ = textbox(g.description);
      d_.style.width = '100%';
      d_.addEventListener('input', () => { desc = d_.value; S()?.dirty(); });
      const mail = textbox(attrs.mail ?? '');
      mail.style.width = '100%';
      mail.addEventListener('input', () => { replace.mail = mail.value; S()?.dirty(); });

      const cur = g.scope ?? 'Global';
      const scFs = fieldset('Group scope');
      const opt = (label: string, value: NonNullable<Group['scope']>): HTMLElement => {
        const r = radio(`gs-${g.id}`, label, cur === value, () => { scope = value; S()?.dirty(); });
        // AD's conversion rules, the way ADUC shows them: an option you cannot
        // convert to in one step is greyed out.
        if (!scopeChangeAllowed(cur, value)) r.setDisabled(true);
        return r.el;
      };
      scFs.append(opt('Domain local', 'DomainLocal'), opt('Global', 'Global'), opt('Universal', 'Universal'));
      const tyFs = fieldset('Group type');
      const ct = g.category ?? 'Security';
      tyFs.append(
        radio(`gt-${g.id}`, 'Security', ct === 'Security', () => { category = 'Security'; S()?.dirty(); }).el,
        radio(`gt-${g.id}`, 'Distribution', ct === 'Distribution', () => { category = 'Distribution'; S()?.dirty(); }).el,
      );
      const cols = el('div');
      cols.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:10px;';
      cols.append(scFs, tyFs);
      p.append(
        nameHeader('group', g.name),
        grid('150px 1fr', 'Group name (pre-Windows 2000):', pre),
        hr(),
        grid('90px 1fr', 'Description:', d_, 'E-mail:', mail),
        cols,
        css(el('div', undefined, 'Notes:'), 'margin:10px 0 3px;'),
        area(S, (v) => (replace.info = v), attrs.info ?? '', 4),
      );
    },
  };

  const members: SheetTab = {
    label: 'Members',
    build: (p) => {
      const rows = (): User[] => [
        ...g.memberIds.filter((id) => !removeMembers.has(id)).map((id) => aduc.dir.getUser(id)).filter((u): u is User => !!u),
        ...addMembers,
      ];
      const lb = listBox<User>([
        { label: 'Name', render: (u) => u.displayName, width: '40%', iconOf: (u) => (u.status === 'disabled' ? 'userDisabled' : 'user') },
        { label: 'Active Directory Domain Services Folder', render: (u) => canonicalOf(homeOf(u), aduc.dir) },
      ], { height: '300px', multi: true, onOpen: (u) => userProperties(aduc, u) });
      lb.setRows(rows());
      const add = button('Add...', () => selectObjects(aduc, {
        title: 'Select Users, Contacts, Computers, Service Accounts, or Groups',
        kinds: ['user'],
        multi: true,
        exclude: new Set(rows().map((u) => `user:${u.id}`)),
        onOk: (picked) => {
          for (const o of picked) {
            if (!o.user) continue;
            if (removeMembers.has(o.user.id)) removeMembers.delete(o.user.id);
            else if (!g.memberIds.includes(o.user.id)) addMembers.push(o.user);
          }
          lb.setRows(rows());
          S()?.dirty();
        },
      }));
      const rm = button('Remove', () => {
        const sel = lb.selected();
        if (!sel.length) return;
        messageBox('Do you want to remove the selected member(s) from the group?', {
          kind: 'question',
          yesNo: true,
          onYes: () => {
            for (const u of sel) {
              const i = addMembers.indexOf(u);
              if (i >= 0) addMembers.splice(i, 1);
              else removeMembers.add(u.id);
            }
            lb.setRows(rows());
            S()?.dirty();
          },
        });
      });
      const b = el('div');
      b.style.cssText = 'display:flex;gap:8px;margin-top:8px;';
      b.append(add, rm);
      p.append(el('div', undefined, 'Members:'), lb.el, b);
    },
  };

  const memberOf: SheetTab = {
    label: 'Member Of',
    build: (p) => {
      const lb = listBox<string>([{ label: 'Name', render: (s) => s, width: '40%' }, { label: 'Active Directory Domain Services Folder', render: () => '' }], { height: '300px' });
      lb.setRows([]);
      const b = el('div');
      b.style.cssText = 'display:flex;gap:8px;margin-top:8px;';
      b.append(
        button('Add...', () => messageBox('Group nesting (AGDLP: accounts into Global groups, Global groups into Domain Local groups) is not modelled in this lab directory. Grant access by adding accounts to the group that holds the permission.', { kind: 'info' })),
        button('Remove', () => undefined, { disabled: true }),
      );
      p.append(el('div', undefined, 'Member of:'), lb.el, b);
    },
  };

  const managed = managedByTab(aduc, S, attrs.managedBy, (v) => (managedBy = v));

  const object = objectTab(aduc, S, {
    canonical: `${canonicalOf(homeOf(g), aduc.dir)}/${g.name}`,
    cls: 'Group',
    id: g.id,
    protectedNow: isTrue(attrs.ProtectedFromAccidentalDeletion),
    onProtect: (v) => (protect = v),
  });
  const security = securityTab(aduc, g.name, 'group', homeOf(g));
  const attrEditor = attributeEditorTab(aduc, () => {
    const a = { ...(aduc.dir.getGroup(g.id)?.attrs ?? {}), ...Object.fromEntries(Object.entries(replace).map(([k, v]) => [k, v ?? ''])) };
    const scopeCode = { Global: '0x80000002 = ( GROUP_TYPE_ACCOUNT_GROUP | GROUP_TYPE_SECURITY_ENABLED )', DomainLocal: '0x80000004 = ( GROUP_TYPE_RESOURCE_GROUP | GROUP_TYPE_SECURITY_ENABLED )', Universal: '0x80000008 = ( GROUP_TYPE_UNIVERSAL_GROUP | GROUP_TYPE_SECURITY_ENABLED )' }[g.scope ?? 'Global'];
    const rows: AttrRow[] = [
      { name: 'cn', value: g.name },
      { name: 'description', value: g.description },
      { name: 'distinguishedName', value: groupDn(aduc.dir, g) },
      { name: 'groupType', value: g.category === 'Distribution' ? scopeCode.replace(' | GROUP_TYPE_SECURITY_ENABLED', '').replace('0x8000000', '0x') : scopeCode },
      { name: 'member', value: g.memberIds.map((id) => aduc.dir.getUser(id)).filter((u): u is User => !!u).map((u) => userDn(aduc.dir, u)).join('; ') },
      { name: 'name', value: g.name },
      { name: 'objectClass', value: 'top; group' },
      { name: 'objectGUID', value: guidFor(g.id) },
      { name: 'objectSid', value: sidFor(g.id, g.name, aduc.dir.domainName) },
      { name: 'sAMAccountName', value: a.sAMAccountName ?? g.name },
      { name: 'mail', value: a.mail ?? '', editable: true },
      { name: 'info', value: a.info ?? '', editable: true },
      { name: 'managedBy', value: a.managedBy ? (aduc.dir.getUserByUsername(a.managedBy) ? userDn(aduc.dir, aduc.dir.getUserByUsername(a.managedBy)!) : a.managedBy) : '' },
    ];
    return rows;
  }, (k, v) => (replace[k] = v), S);

  const rows: SheetTab[][] = advanced
    ? [[object, security, attrEditor], [general, members, memberOf, managed]]
    : [[general, members, memberOf, managed]];
  sheet = openSheet(aduc, `group:${g.id}`, `${g.name} Properties`, rows, initialTab, 460);
  if (!sheet) return;
  sheet.onApply(() => {
    const args: Record<string, string> = {};
    if (desc !== undefined) args.Description = desc;
    if (scope && scope !== (g.scope ?? 'Global')) args.GroupScope = scope;
    if (category && category !== (g.category ?? 'Security')) args.GroupCategory = category;
    if (managedBy !== undefined) args.ManagedBy = managedBy;
    const rep = Object.entries(replace).filter(([, v]) => v);
    const clr = Object.entries(replace).filter(([, v]) => !v).map(([k]) => k);
    if (protect !== undefined) {
      if (protect) rep.push(['ProtectedFromAccidentalDeletion', 'TRUE']);
      else clr.push('ProtectedFromAccidentalDeletion');
    }
    if (rep.length) args.Replace = rep.map(([k, v]) => `${k}=${v!.replace(/;/g, ',')}`).join(';');
    if (clr.length) args.Clear = clr.join(',');
    if (desc === '') {
      delete args.Description;
      args.Clear = [args.Clear, 'description'].filter(Boolean).join(',');
    }
    if (Object.keys(args).length && !aduc.run('group.update', { Identity: g.name, ...args }).ok) return false;
    for (const u of addMembers) aduc.run('group.addMember', { Identity: u.username, Group: g.name });
    for (const id of removeMembers) {
      const u = aduc.dir.getUser(id as User['id']);
      if (u) aduc.run('group.removeMember', { Identity: u.username, Group: g.name });
    }
    addMembers.length = 0;
    removeMembers.clear();
    for (const k of Object.keys(replace)) delete replace[k];
    desc = scope = category = managedBy = undefined;
    protect = undefined;
    return true;
  });
}

function managedByTab(aduc: Aduc, S: () => Sheet | null, current: string | undefined, set: (v: string) => void): SheetTab {
  return {
    label: 'Managed By',
    build: (p) => {
      const who = (): User | undefined => (cur ? aduc.dir.getUserByUsername(cur) : undefined);
      let cur = current;
      const name = textbox(who()?.displayName ?? '', { readOnly: true });
      name.style.width = '100%';
      const fields = {
        office: textbox('', { readOnly: true }), street: document.createElement('textarea'), city: textbox('', { readOnly: true }),
        state: textbox('', { readOnly: true }), country: textbox('', { readOnly: true }), phone: textbox('', { readOnly: true }), fax: textbox('', { readOnly: true }),
      };
      fields.street.readOnly = true;
      fields.street.rows = 2;
      const fill = (): void => {
        const u = who();
        const a = u?.attrs ?? {};
        name.value = u?.displayName ?? '';
        fields.office.value = a.physicalDeliveryOfficeName ?? '';
        fields.street.value = a.streetAddress ?? '';
        fields.city.value = a.l ?? '';
        fields.state.value = a.st ?? '';
        fields.country.value = a.c ?? '';
        fields.phone.value = a.telephoneNumber ?? '';
        fields.fax.value = a.facsimileTelephoneNumber ?? '';
      };
      const btns = el('div');
      btns.style.cssText = 'display:flex;gap:8px;margin:6px 0 10px 90px;';
      btns.append(
        button('Change...', () => selectObjects(aduc, {
          title: 'Select User, Contact, or Group',
          kinds: ['user'],
          multi: false,
          onOk: (picked) => {
            if (!picked[0]?.user) return;
            cur = picked[0].user.username;
            set(cur);
            fill();
            S()?.dirty();
          },
        })),
        button('Properties', () => { const u = who(); if (u) userProperties(aduc, u); }),
        button('Clear', () => { cur = undefined; set(''); fill(); S()?.dirty(); }),
      );
      const canUpdate = checkbox('Manager can update membership list', false);
      p.append(
        grid('90px 1fr', 'Name:', name),
        btns,
        canUpdate.el,
        css(grid('90px 1fr', 'Office:', fields.office, 'Street:', fields.street, 'City:', fields.city, 'State/province:', fields.state, 'Country/region:', fields.country, 'Telephone number:', fields.phone, 'Fax number:', fields.fax), 'margin-top:10px;'),
      );
      fill();
    },
  };
}

// ---------------------------------------------------------------------------
// Organizational unit
// ---------------------------------------------------------------------------

export function ouProperties(aduc: Aduc, ou: OrganizationalUnit, initialTab = 'General'): void {
  const advanced = aduc.advanced();
  let sheet: Sheet | null = null;
  const S = (): Sheet | null => sheet;
  const pending: Record<string, string> = {};
  let protect: boolean | undefined;
  let managedBy: string | undefined;
  const a = ou.attrs ?? {};

  const general: SheetTab = {
    label: 'General',
    build: (p) => {
      const street = area(S, (v) => (pending.StreetAddress = v), a.street ?? '', 3);
      const country = select(COUNTRIES, a.c ?? '');
      country.style.width = '100%';
      country.addEventListener('change', () => { pending.Country = country.value; S()?.dirty(); });
      p.append(
        nameHeader('ou', ou.name),
        grid('110px 1fr', 'Description:', bound(S, pending, 'Description', ou.description)),
        hr(),
        grid('110px 1fr', 'Street:', street, 'City:', bound(S, pending, 'City', a.l ?? ''), 'State/province:', bound(S, pending, 'State', a.st ?? ''), 'Zip/Postal Code:', bound(S, pending, 'PostalCode', a.postalCode ?? ''), 'Country/region:', country),
      );
    },
  };
  const managed = managedByTab(aduc, S, a.managedBy, (v) => (managedBy = v));
  const complus: SheetTab = { label: 'COM+', build: (p) => p.append(css(el('div', undefined, 'Link this organizational unit to the following COM+ partition set:'), 'margin-bottom:6px;'), grid('90px 1fr', 'Partition Set:', select(['<none>'], '<none>', '100%'))) };
  const object = objectTab(aduc, S, {
    canonical: `${DOMAIN}/${aduc.dir.ouPath(ou.id)}`,
    cls: 'Organizational Unit',
    created: ou.createdAt,
    id: ou.id,
    protectedNow: !!ou.protectedFromDeletion,
    onProtect: (v) => (protect = v),
  });
  const security = securityTab(aduc, ou.name, 'ou', `ou:${ou.id}`);
  const attrEditor = attributeEditorTab(aduc, () => [
    { name: 'description', value: ou.description },
    { name: 'distinguishedName', value: ouDn(aduc.dir, ou.id) },
    { name: 'gPLink', value: '' },
    { name: 'instanceType', value: '0x4 = ( WRITE )' },
    { name: 'l', value: a.l ?? '' },
    { name: 'name', value: ou.name },
    { name: 'objectCategory', value: `CN=Organizational-Unit,CN=Schema,CN=Configuration,${DOMAIN_DN}` },
    { name: 'objectClass', value: 'top; organizationalUnit' },
    { name: 'objectGUID', value: guidFor(ou.id) },
    { name: 'ou', value: ou.name },
    { name: 'postalCode', value: a.postalCode ?? '' },
    { name: 'st', value: a.st ?? '' },
    { name: 'street', value: a.street ?? '' },
    { name: 'whenCreated', value: fileTime(ou.createdAt) },
  ], () => undefined, S);

  const rows: SheetTab[][] = advanced ? [[object, security, attrEditor], [general, managed, complus]] : [[general, managed, complus]];
  sheet = openSheet(aduc, `ou:${ou.id}`, `${ou.name} Properties`, rows, initialTab, 430);
  if (!sheet) return;
  sheet.onApply(() => {
    const args: Record<string, string> = { ...pending };
    if (protect !== undefined) args.ProtectedFromAccidentalDeletion = String(protect);
    if (managedBy !== undefined) args.ManagedBy = managedBy;
    if (args.Description === '') {
      delete args.Description;
      args.Clear = 'description';
    }
    if (Object.keys(args).length && !aduc.run('ou.update', { Identity: aduc.dir.ouPath(ou.id), ...args }).ok) return false;
    for (const k of Object.keys(pending)) delete pending[k];
    protect = undefined;
    managedBy = undefined;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Read-only sheets: computers, the domain, containers, built-in objects
// ---------------------------------------------------------------------------

export function readOnlyProperties(aduc: Aduc, o: AdObj): void {
  const ro = (v: string): HTMLInputElement => {
    const t = textbox(v, { readOnly: true });
    t.style.width = '100%';
    return t;
  };
  if (o.computer) {
    const c = o.computer;
    const general: SheetTab = {
      label: 'General',
      build: (p) => p.append(
        nameHeader('computer', c.name),
        grid('170px 1fr', 'Computer name (pre-Windows 2000):', ro(c.name), 'DNS name:', ro(`${c.name}.${DOMAIN}`.toLowerCase()), 'DC Type:', ro(c.role === 'Domain controller' ? 'GC' : 'Workstation or server'), 'Site:', ro(c.role === 'Domain controller' ? 'Default-First-Site-Name' : ''), 'Description:', ro(c.description)),
        css(checkbox('Trust computer for delegation', c.role === 'Domain controller').el, 'margin-top:12px;'),
      ),
    };
    const os: SheetTab = { label: 'Operating System', build: (p) => p.appendChild(grid('100px 1fr', 'Name:', ro(c.os), 'Version:', ro(c.osVersion), 'Service pack:', ro(''))) };
    const mo: SheetTab = {
      label: 'Member Of',
      build: (p) => {
        const lb = listBox<[string, string]>([{ label: 'Name', render: (r) => r[0], iconOf: () => 'group' }, { label: 'Active Directory Domain Services Folder', render: (r) => r[1] }], { height: '240px' });
        lb.setRows(c.role === 'Domain controller' ? [['Domain Controllers', `${DOMAIN}/Users`]] : [['Domain Computers', `${DOMAIN}/Users`]]);
        p.append(el('div', undefined, 'Member of:'), lb.el);
      },
    };
    const loc: SheetTab = { label: 'Location', build: (p) => p.appendChild(grid('70px 1fr', 'Location:', ro(''))) };
    const deleg: SheetTab = { label: 'Delegation', build: (p) => p.append(el('div', 'ad-note', 'Delegation is a security-sensitive operation, which allows services to act on behalf of another user.'), css(radio('dl', 'Do not trust this computer for delegation', c.role !== 'Domain controller').el, 'margin-top:10px;'), radio('dl', 'Trust this computer for delegation to any service (Kerberos only)', c.role === 'Domain controller').el) };
    openSheet(aduc, o.key, `${c.name} Properties`, [[general, os, mo, deleg, loc]], 'General', 440, true);
    return;
  }
  if (o.kind === 'domain') {
    const general: SheetTab = {
      label: 'General',
      build: (p) => p.append(
        nameHeader('domain', DOMAIN),
        grid('180px 1fr', 'Domain name (pre-Windows 2000):', ro(NETBIOS), 'Description:', ro(''), 'Domain functional level:', ro('Windows Server 2016'), 'Forest functional level:', ro('Windows Server 2016')),
      ),
    };
    openSheet(aduc, 'domain', `${DOMAIN} Properties`, [[general, managedByTab(aduc, () => null, undefined, () => undefined)]], 'General', 440, true);
    return;
  }
  if (o.builtin) {
    const b = o.builtin;
    const general: SheetTab = {
      label: 'General',
      build: (p) => {
        p.append(nameHeader(b.kind === 'user' ? 'user' : 'group', b.name));
        if (b.kind === 'group') {
          p.append(grid('150px 1fr', 'Group name (pre-Windows 2000):', ro(b.name)), hr(), grid('90px 1fr', 'Description:', ro(b.description), 'E-mail:', ro('')), css(grid('1fr 1fr', ro(`Group scope: ${groupTypeLabel(b.scope, 'Security').replace('Security Group - ', '')}`), ro('Group type: Security')), 'margin-top:10px;'));
        } else {
          p.append(hr(), grid('110px 1fr', 'Description:', ro(b.description), 'Account:', ro(b.disabled ? 'Disabled' : 'Enabled')));
        }
        p.append(css(el('div', 'ad-note', 'This is a default object created with the domain. It is shown so the console looks as it does on a new domain controller; this lab directory does not change it.'), 'margin-top:16px;color:#555;'));
      },
    };
    openSheet(aduc, o.key, `${b.name} Properties`, [[general]], 'General', 440, true);
    return;
  }
  const general: SheetTab = {
    label: 'General',
    build: (p) => p.append(nameHeader(o.icon, o.name), grid('90px 1fr', 'Description:', ro(o.description))),
  };
  openSheet(aduc, o.key, `${o.name} Properties`, [[general]], 'General', 400, true);
}

/** Open the right sheet for any object. */
export function openProperties(aduc: Aduc, o: AdObj, tab?: string): void {
  if (o.user) userProperties(aduc, aduc.dir.getUser(o.user.id) ?? o.user, tab);
  else if (o.group) groupProperties(aduc, aduc.dir.getGroup(o.group.id) ?? o.group, tab);
  else if (o.ou) ouProperties(aduc, aduc.dir.getOu(o.ou.id) ?? o.ou, tab);
  else readOnlyProperties(aduc, o);
}

