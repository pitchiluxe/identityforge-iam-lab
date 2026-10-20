/**
 * ui/consoles/aduc/actions.ts — the verbs on the right-click menus.
 *
 * Each one says what the real console says: "Object Alex Rivera has been
 * disabled.", "The password for Alex Rivera has been changed.", "Are you sure
 * you want to delete the User named 'Alex Rivera'?". Those messages are part
 * of the muscle memory, and they are also how you know the action happened.
 */
import type { Group, OuId, User } from './shim/domain';
import type { Aduc } from './context';
import { browseContainer, selectObjects } from './pickers';
import { BUILTIN_OBJECTS, DOMAIN, NETBIOS, homeOf, type AdObj } from './model';
import { checkbox, el, grid, messageBox, openDialog, textbox, hr } from './ui';

/**
 * Make a default CN=Users group (Domain Admins...) a real directory object the
 * first time someone adds a member, so its membership is kept like any other.
 * Builtin-container groups stay display-only: this directory has no Builtin.
 */
export function materializeGroup(aduc: Aduc, o: AdObj): Group | null {
  if (o.group) return o.group;
  const b = o.builtin;
  if (!b || b.kind !== 'group') return null;
  const existing = aduc.dir.getGroupByName(b.name);
  if (existing) return existing;
  if (b.container === 'builtin') {
    messageBox(
      `${b.name} is a built-in local group of the domain controllers. This lab directory does not manage its membership. ` +
        'Use a group from the Users container or one you created.',
      { kind: 'warning' },
    );
    return null;
  }
  const r = aduc.run('group.create', { Name: b.name, Description: b.description, GroupScope: b.scope ?? 'Global', GroupCategory: 'Security' });
  return r.ok ? aduc.dir.getGroupByName(b.name) ?? null : null;
}

/** Add accounts to groups: "The Add to Group operation was successfully completed." */
export function addUsersToGroups(aduc: Aduc, users: User[], groups: AdObj[]): void {
  let done = 0;
  for (const go of groups) {
    const g = materializeGroup(aduc, go);
    if (!g) continue;
    for (const u of users) {
      if (g.memberIds.includes(u.id)) continue;
      const r = aduc.run('group.addMember', { Identity: u.username, Group: g.name });
      if (!r.ok) return;
      done++;
    }
  }
  if (done > 0 || groups.length) messageBox('The Add to Group operation was successfully completed.', { kind: 'info' });
}

export function addToGroupDialog(aduc: Aduc, users: User[]): void {
  selectObjects(aduc, {
    title: 'Select Groups',
    kinds: ['group'],
    multi: true,
    onOk: (groups) => addUsersToGroups(aduc, users, groups),
  });
}

export function setEnabled(aduc: Aduc, users: User[], enable: boolean): void {
  for (const u of users) {
    const r = aduc.run(enable ? 'user.enable' : 'user.disable', { Identity: u.username });
    if (!r.ok) return;
  }
  const what = users.length === 1 ? `Object ${users[0]!.displayName} has been ${enable ? 'enabled' : 'disabled'}.` : `The selected objects have been ${enable ? 'enabled' : 'disabled'}.`;
  messageBox(what, { kind: 'info' });
}

/** Reset Password, with the lockout status panel the real dialog has. */
export function resetPasswordDialog(aduc: Aduc, u: User): void {
  const pwd = textbox('', { type: 'password' });
  const confirm = textbox('', { type: 'password' });
  const must = checkbox('User must change password at next logon', true);
  const unlock = checkbox("Unlock the user's account", false);
  const locked = u.status === 'locked';
  if (!locked) unlock.setDisabled(true);

  const d = openDialog({
    title: 'Reset Password',
    width: 400,
    modal: true,
    owner: aduc.owner,
    buttons: [
      {
        label: 'OK',
        primary: true,
        onClick: () => {
          if (pwd.value !== confirm.value) {
            messageBox('The New and Confirm passwords must match. Please re-type them.', { kind: 'error' });
            return false;
          }
          const v = aduc.conductor.idp.validatePassword(pwd.value);
          if (!v.ok) {
            messageBox(
              `Windows cannot complete the password change for ${u.displayName} because:\n\n` +
                'The password does not meet the password policy requirements. Check the minimum password length, ' +
                `password complexity and password history requirements.\n\n(${v.reason})`,
              { kind: 'error' },
            );
            return false;
          }
          const r = aduc.run('password.reset', {
            Identity: u.username,
            NewPassword: pwd.value,
            ChangePasswordAtLogon: must.checked ? 'true' : 'false',
          });
          if (!r.ok) return false;
          if (unlock.checked) aduc.run('account.unlock', { Identity: u.username });
          messageBox(`The password for ${u.displayName} has been changed.`, { kind: 'info' });
        },
      },
      { label: 'Cancel', cancel: true },
    ],
  });
  d.body.append(
    grid('130px 1fr', 'New password:', pwd, 'Confirm password:', confirm),
    el('div'),
  );
  const opts = el('div');
  opts.style.cssText = 'margin:10px 0 4px;';
  opts.append(must.el, el('div', 'ad-note', 'The user must logoff and then logon again for the change to take effect.'));
  d.body.appendChild(opts);
  d.body.appendChild(hr());
  const status = el('div');
  status.append(
    el('div', undefined, 'Account Lockout Status on this Domain Controller: ' + (locked ? 'Locked' : 'Unlocked')),
    unlock.el,
  );
  d.body.appendChild(status);
}

/** Move... for accounts and groups (into an OU or CN=Users) and for OUs (into an OU or the domain). */
export function moveDialog(aduc: Aduc, objs: AdObj[]): void {
  const movingOus = objs.filter((o) => o.ou);
  const others = objs.filter((o) => o.user || o.group);
  if (!movingOus.length && !others.length) return;
  const first = objs[0]!;
  browseContainer(aduc, {
    title: 'Move',
    prompt: 'Move object into container:',
    allowDomain: movingOus.length > 0 && others.length === 0,
    initial: first.user ? homeOf(first.user) : first.group ? homeOf(first.group) : undefined,
    forbid: (key) => {
      if (movingOus.length && others.length === 0) {
        if (!(key === 'domain' || key.startsWith('ou:'))) return true;
        // Not into itself or below itself.
        for (const o of movingOus) {
          for (let k: string | undefined = key; k?.startsWith('ou:'); ) {
            if (k === `ou:${o.ou!.id}`) return true;
            const p: OuId | undefined = aduc.dir.getOu(k.slice(3) as OuId)?.parentId;
            k = p ? `ou:${p}` : undefined;
          }
        }
        return false;
      }
      return !(key === 'c:users' || key.startsWith('ou:'));
    },
    onOk: (key) => {
      const target = key === 'c:users' ? `CN=Users,${DOMAIN}` : key === 'domain' ? `DC=${DOMAIN}` : aduc.dir.ouPath(key.slice(3) as OuId);
      for (const o of objs) {
        const id = o.user ? o.user.username : o.group ? o.group.name : o.ou ? aduc.dir.ouPath(o.ou.id) : '';
        if (!id) continue;
        if (!aduc.run('user.move', { Identity: id, TargetPath: target }).ok) return;
      }
      aduc.reveal(key);
    },
  });
}

/**
 * Rename. For an account this is ADUC's Rename User dialog: the full name is
 * the object's name, and the logon names are separate attributes that do not
 * change unless you change them -- the source of many "I renamed her but she
 * still signs in as the old name" tickets.
 */
export function renameDialog(aduc: Aduc, o: AdObj, newName?: string): void {
  if (o.user) {
    const u = o.user;
    const gap = u.displayName.indexOf(' ');
    const full = textbox(newName ?? u.displayName);
    const first = textbox(u.attrs?.givenName ?? (gap === -1 ? u.displayName : u.displayName.slice(0, gap)));
    const last = textbox(u.attrs?.sn ?? (gap === -1 ? '' : u.displayName.slice(gap + 1)));
    const disp = textbox(newName ?? u.displayName);
    const upn = textbox(u.username);
    const suffix = el('select');
    suffix.appendChild(new Option(`@${DOMAIN}`, `@${DOMAIN}`));
    const pre = textbox(`${NETBIOS}\\`, { readOnly: true });
    const sam = textbox(u.username);
    upn.addEventListener('input', () => (sam.value = upn.value.slice(0, 20)));
    full.addEventListener('input', () => (disp.value = full.value));
    disp.readOnly = true;
    openDialog({
      title: 'Rename User',
      width: 440,
      modal: true,
      owner: aduc.owner,
      buttons: [
        {
          label: 'OK',
          primary: true,
          onClick: () => {
            if (!full.value.trim()) {
              messageBox('The full name cannot be empty.', { kind: 'error' });
              return false;
            }
            // This directory keeps one name per account, so Full name and
            // Display name travel together; the logon names are separate.
            const r = aduc.run('user.update', {
              Identity: u.username,
              SamAccountName: sam.value.trim() || upn.value.trim(),
              DisplayName: full.value.trim(),
              GivenName: first.value.trim(),
              Surname: last.value.trim(),
            });
            if (!r.ok) return false;
          },
        },
        { label: 'Cancel', cancel: true },
      ],
    }).body.append(
      grid('150px 1fr', 'Full name:', full, 'First name:', first, 'Last name:', last, 'Display name:', disp),
      hr(),
      el('div', undefined, 'User logon name:'),
      grid('1fr 150px', upn, suffix),
      el('div', undefined, 'User logon name (pre-Windows 2000):'),
      grid('150px 1fr', pre, sam),
    );
    return;
  }
  const current = o.group?.name ?? o.ou?.name ?? o.name;
  const box = textbox(newName ?? current);
  openDialog({
    title: 'Rename',
    width: 360,
    modal: true,
    owner: aduc.owner,
    buttons: [
      {
        label: 'OK',
        primary: true,
        onClick: () => {
          const name = box.value.trim();
          if (!name || name === current) return;
          const id = o.group ? o.group.name : o.ou ? aduc.dir.ouPath(o.ou.id) : current;
          if (!aduc.run('object.rename', { Identity: id, NewName: name }).ok) return false;
        },
      },
      { label: 'Cancel', cancel: true },
    ],
  }).body.append(grid('60px 1fr', 'Name:', box));
}

/**
 * Delete, with the real prompts: a single object by type and name, several as
 * "these objects", and an OU that still has objects in it with the
 * "contains other objects" warning -- after which its contents go first,
 * deepest first, exactly as the subtree delete does.
 */
export function deleteObjects(aduc: Aduc, objs: AdObj[]): void {
  const real = objs.filter((o) => o.user || o.group || o.ou);
  if (real.length !== objs.length) {
    messageBox('Built-in objects and system containers cannot be deleted from this console.', { kind: 'error' });
    return;
  }
  if (!real.length) return;
  const typeWord = (o: AdObj): string => (o.user ? 'User' : o.group ? 'Group' : 'Organizational Unit');
  const text = real.length === 1 ? `Are you sure you want to delete the ${typeWord(real[0]!)} named '${real[0]!.name}'?` : 'Are you sure you want to delete these objects?';
  messageBox(text, {
    kind: 'warning',
    yesNo: true,
    onYes: () => {
      for (const o of real) {
        if (o.user) {
          if (!aduc.run('user.delete', { Identity: o.user.username }).ok) return;
        } else if (o.group) {
          if (!aduc.run('group.delete', { Name: o.group.name }).ok) return;
        } else if (o.ou) {
          if (!deleteOu(aduc, o.ou.id)) return;
        }
      }
    },
  });
}

function deleteOu(aduc: Aduc, id: OuId): boolean {
  const ou = aduc.dir.getOu(id);
  if (!ou) return true;
  if (ou.protectedFromDeletion) {
    messageBox(
      `You do not have sufficient privileges to delete ${ou.name}, or this object is protected from accidental deletion.`,
      { kind: 'error' },
    );
    return false;
  }
  const hasContents =
    aduc.dir.childOus(id).length > 0 ||
    aduc.dir.listUsers().some((u) => u.ouId === id) ||
    aduc.dir.listGroups().some((g) => g.ouId === id);
  if (!hasContents) return aduc.run('ou.delete', { Name: aduc.dir.ouPath(id) }).ok;

  // The subtree delete: confirmed separately, because it is the one that hurts.
  messageBox(
    `Object ${ou.name} contains other objects. Are you sure you want to delete object ${ou.name} and all of the objects that it contains?`,
    {
      kind: 'warning',
      yesNo: true,
      onYes: () => {
        const protectedChild = descendants(aduc, id).find((o) => aduc.dir.getOu(o)?.protectedFromDeletion);
        if (protectedChild) {
          messageBox(
            `Windows cannot delete object ${ou.name} because: Access is denied.\n\n${aduc.dir.getOu(protectedChild)!.name} is protected from accidental deletion.`,
            { kind: 'error' },
          );
          return;
        }
        for (const oid of [...descendants(aduc, id), id].reverse()) {
          for (const u of aduc.dir.listUsers().filter((x) => x.ouId === oid)) aduc.run('user.delete', { Identity: u.username });
          for (const g of aduc.dir.listGroups().filter((x) => x.ouId === oid)) aduc.run('group.delete', { Name: g.name });
        }
        for (const oid of [...descendants(aduc, id)].reverse()) aduc.run('ou.delete', { Name: aduc.dir.ouPath(oid) });
        aduc.run('ou.delete', { Name: aduc.dir.ouPath(id) });
      },
    },
  );
  return false;
}

/** Every OU beneath `id`, parents before children. */
function descendants(aduc: Aduc, id: OuId): OuId[] {
  const out: OuId[] = [];
  const walk = (p: OuId): void => {
    for (const c of aduc.dir.childOus(p)) {
      out.push(c.id);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

/** "Default container for..." rows are system objects; only these have real properties. */
export const isBuiltinGroup = (o: AdObj): boolean => o.kind === 'builtin-group';
export const builtinByName = (n: string) => BUILTIN_OBJECTS.find((b) => b.name === n);
