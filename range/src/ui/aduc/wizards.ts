/**
 * ui/consoles/aduc/wizards.ts — New Object dialogs and the Delegation wizard.
 *
 * New Object - User is three pages, as on the server: names and logon names,
 * then password and account options, then a summary and Finish. The page-two
 * rules are the real ones: "must change" and "cannot change" together are
 * refused, and "never expires" clears "must change" with the same warning the
 * server gives. Copy... is the same wizard, starting from a template account
 * whose groups, department and options come along -- the everyday way an
 * onboarding ticket is done.
 */
import { DEPARTMENTS } from './shim/config';
import type { OuId, User } from './shim/domain';
import { DELEGATION_TASKS } from './shim/config';
import { isTrue } from './shim/adAttributes';
import type { Aduc } from './context';
import { icon } from './icons';
import { canonicalOf, DOMAIN, NETBIOS, pathArgOf, type AdObj } from './model';
import { selectObjects } from './pickers';
import { materializeGroup } from './actions';
import { button, checkbox, el, grid, headerStrip, listBox, messageBox, openDialog, radio, select, textbox } from './ui';

/** The department an OU implies, when one of its ancestors is named like one. */
function departmentFor(aduc: Aduc, nodeKey: string): string | undefined {
  for (let k: string | undefined = nodeKey; k?.startsWith('ou:'); ) {
    const ou = aduc.dir.getOu(k.slice(3) as OuId);
    const hit = DEPARTMENTS.find((d) => d.toLowerCase() === ou?.name.toLowerCase());
    if (hit) return hit;
    k = ou?.parentId ? `ou:${ou.parentId}` : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// New Object - User / Copy Object - User
// ---------------------------------------------------------------------------

export function newUserWizard(aduc: Aduc, nodeKey: string, template?: User): void {
  const where = canonicalOf(nodeKey, aduc.dir);
  let page = 0;

  const first = textbox('');
  const initials = textbox('', { width: '70px' });
  initials.maxLength = 6;
  const last = textbox('');
  const full = textbox('');
  const logon = textbox('');
  const suffix = select([`@${DOMAIN}`]);
  const pre = textbox(`${NETBIOS}\\`, { readOnly: true });
  const sam = textbox('');
  sam.maxLength = 20;
  let fullTouched = false;
  let samTouched = false;

  const pwd = textbox('', { type: 'password' });
  const pwd2 = textbox('', { type: 'password' });
  const tflags = template?.attrs ?? {};
  const must = checkbox('User must change password at next logon', template ? !!template.mustChangePassword || !isTrue(tflags.PasswordNeverExpires) : true);
  const cannot = checkbox('User cannot change password', isTrue(tflags.CannotChangePassword));
  const never = checkbox('Password never expires', isTrue(tflags.PasswordNeverExpires));
  const disabled = checkbox('Account is disabled', template?.status === 'disabled');
  if (never.checked) must.checked = false;

  const syncFull = (): void => {
    if (fullTouched) return;
    const mid = initials.value.trim() ? ` ${initials.value.trim()}.` : '';
    full.value = `${first.value.trim()}${mid} ${last.value.trim()}`.trim();
  };
  first.addEventListener('input', () => { syncFull(); update(); });
  initials.addEventListener('input', () => { syncFull(); update(); });
  last.addEventListener('input', () => { syncFull(); update(); });
  full.addEventListener('input', () => { fullTouched = true; update(); });
  logon.addEventListener('input', () => {
    if (!samTouched) sam.value = logon.value.slice(0, 20);
    update();
  });
  sam.addEventListener('input', () => { samTouched = true; update(); });

  never.input.addEventListener('change', () => {
    if (never.checked && must.checked) {
      messageBox('You specified that the password should never expire. The user will not be required to change the password at next logon.', { kind: 'info' });
      must.checked = false;
    }
  });
  const conflict = (): void => {
    if (must.checked && cannot.checked) {
      messageBox('You cannot check both User must change password at next logon and User cannot change password for the same user.', { kind: 'warning' });
      cannot.checked = false;
    }
  };
  must.input.addEventListener('change', conflict);
  cannot.input.addEventListener('change', conflict);

  const d = openDialog({ title: template ? 'Copy Object - User' : 'New Object - User', width: 480, height: 440, modal: true, owner: aduc.owner });
  const pages = [el('div'), el('div'), el('div')];
  for (const p of pages) d.body.appendChild(p);

  // Page 1
  pages[0]!.append(
    headerStrip('user', where, 'Create in:'),
    grid('130px 1fr auto 70px', 'First name:', first, 'Initials:', initials),
    grid('130px 1fr', 'Last name:', last, 'Full name:', full),
  );
  (pages[0]!.children[1] as HTMLElement).style.marginBottom = '7px';
  const lab1 = el('div', undefined, 'User logon name:');
  lab1.style.margin = '14px 0 3px';
  const lab2 = el('div', undefined, 'User logon name (pre-Windows 2000):');
  lab2.style.margin = '8px 0 3px';
  pages[0]!.append(lab1, grid('1fr 170px', logon, suffix), lab2, grid('1fr 1fr', pre, sam));

  // Page 2
  const opts = el('div');
  opts.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:14px;';
  opts.append(must.el, cannot.el, never.el, disabled.el);
  pages[1]!.append(headerStrip('user', where, 'Create in:'), grid('130px 1fr', 'Password:', pwd, 'Confirm password:', pwd2), opts);

  // Page 3
  const summary = document.createElement('textarea');
  summary.readOnly = true;
  summary.style.cssText = 'width:100%;height:190px;';
  pages[2]!.append(headerStrip('user', where, 'Create in:'), el('div', undefined, 'When you click Finish, the following object will be created:'), summary);
  summary.style.marginTop = '6px';

  const back = button('< Back', () => go(page - 1));
  const next = button('Next >', () => void onNext(), { primary: true });
  const cancel = button('Cancel', () => d.close());
  d.foot.style.display = 'flex';
  d.foot.append(back, next, cancel);
  d.buttons.push(next, back, cancel);

  function update(): void {
    back.disabled = page === 0;
    if (page === 0) next.disabled = !full.value.trim() || !(logon.value.trim() || sam.value.trim());
    else next.disabled = false;
    next.textContent = page === 2 ? 'Finish' : 'Next >';
  }

  function go(p: number): void {
    page = Math.max(0, Math.min(2, p));
    pages.forEach((el_, i) => (el_.style.display = i === page ? '' : 'none'));
    if (page === 2) {
      const lines = [
        `Full name: ${full.value.trim()}`,
        '',
        `User logon name: ${(logon.value.trim() || sam.value.trim())}@${DOMAIN}`,
        '',
      ];
      if (must.checked) lines.push('The user must change the password at next logon.');
      if (cannot.checked) lines.push('The user cannot change the password.');
      if (never.checked) lines.push('The password never expires.');
      if (disabled.checked) lines.push('The account is disabled.');
      if (template) lines.push('', `Copied from: ${template.displayName} (groups, department, organization and account options)`);
      summary.value = lines.join('\n');
    }
    update();
    queueMicrotask(() => (page === 0 ? first : page === 1 ? pwd : next).focus());
  }

  async function onNext(): Promise<void> {
    if (page === 0) {
      const name = (logon.value.trim() || sam.value.trim());
      if (/[\s"/\\[\]:;|=,+*?<>]/.test(name)) {
        messageBox(`The user logon name "${name}" contains one or more illegal characters.`, { kind: 'error' });
        return;
      }
      if (aduc.dir.getUserByUsername(sam.value.trim() || name)) {
        messageBox(`The pre-Windows 2000 user logon name you have chosen is already in use in this domain. Choose another pre-Windows 2000 logon name, and then try again.`, { kind: 'error' });
        return;
      }
      go(1);
      return;
    }
    if (page === 1) {
      if (pwd.value !== pwd2.value) {
        messageBox('The passwords do not match. Type the new password in both text boxes.', { kind: 'error' });
        return;
      }
      const v = aduc.conductor.idp.validatePassword(pwd.value);
      if (!v.ok) {
        messageBox(
          `Windows cannot set the password for ${full.value.trim()} because: The password does not meet the password policy requirements. ` +
            `Check the minimum password length, password complexity and password history requirements.\n\n(${v.reason})`,
          { kind: 'error' },
        );
        return;
      }
      go(2);
      return;
    }
    finish();
  }

  function finish(): void {
    const username = sam.value.trim() || logon.value.trim();
    const dept = template?.department ?? departmentFor(aduc, nodeKey);
    const path = pathArgOf(nodeKey, aduc.dir);
    const r = aduc.run('user.create', {
      SamAccountName: username,
      Name: full.value.trim(),
      ...(dept ? { Department: dept } : {}),
      ...(template ? { Title: template.title } : {}),
      AccountPassword: pwd.value,
      ChangePasswordAtLogon: must.checked ? 'true' : 'false',
      ...(path ? { Path: path } : {}),
    });
    if (!r.ok) return;
    const attrs: Record<string, string> = {
      GivenName: first.value.trim(),
      Surname: last.value.trim(),
      Initials: initials.value.trim(),
      CannotChangePassword: cannot.checked ? 'true' : 'false',
      PasswordNeverExpires: never.checked ? 'true' : 'false',
    };
    if (template) {
      // What ADUC's Copy carries over: organization, address (not street),
      // profile paths, and the account options above.
      const t = template.attrs ?? {};
      const carry: Record<string, string> = {
        Company: t.company ?? '', City: t.l ?? '', State: t.st ?? '', PostalCode: t.postalCode ?? '', Country: t.c ?? '',
        POBox: t.postOfficeBox ?? '', Manager: t.manager ?? '',
        ProfilePath: (t.profilePath ?? '').replace(new RegExp(template.username, 'ig'), username),
        HomeDirectory: (t.homeDirectory ?? '').replace(new RegExp(template.username, 'ig'), username),
        HomeDrive: t.homeDrive ?? '', ScriptPath: t.scriptPath ?? '',
      };
      for (const [k, v] of Object.entries(carry)) if (v) attrs[k] = v;
    }
    aduc.run('user.update', { Identity: username, ...attrs });
    if (template) {
      for (const g of aduc.dir.listGroups().filter((x) => x.memberIds.includes(template.id))) {
        aduc.run('group.addMember', { Identity: username, Group: g.name });
      }
    }
    if (disabled.checked) aduc.run('user.disable', { Identity: username });
    d.close();
    const u = aduc.dir.getUserByUsername(username);
    if (u) aduc.reveal(nodeKey, `user:${u.id}`);
  }

  go(0);
}

// ---------------------------------------------------------------------------
// New Object - Group
// ---------------------------------------------------------------------------

export function newGroupDialog(aduc: Aduc, nodeKey: string): void {
  const name = textbox('');
  const pre = textbox('');
  let preTouched = false;
  name.addEventListener('input', () => {
    if (!preTouched) pre.value = name.value.slice(0, 256);
    ok.disabled = !name.value.trim();
  });
  pre.addEventListener('input', () => (preTouched = true));

  let scope: 'DomainLocal' | 'Global' | 'Universal' = 'Global';
  let type: 'Security' | 'Distribution' = 'Security';
  const scopeFs = el('fieldset', 'ad-fs');
  scopeFs.appendChild(el('legend', undefined, 'Group scope'));
  scopeFs.append(
    radio('ng-scope', 'Domain local', false, () => (scope = 'DomainLocal')).el,
    radio('ng-scope', 'Global', true, () => (scope = 'Global')).el,
    radio('ng-scope', 'Universal', false, () => (scope = 'Universal')).el,
  );
  const typeFs = el('fieldset', 'ad-fs');
  typeFs.appendChild(el('legend', undefined, 'Group type'));
  typeFs.append(
    radio('ng-type', 'Security', true, () => (type = 'Security')).el,
    radio('ng-type', 'Distribution', false, () => (type = 'Distribution')).el,
  );

  const d = openDialog({
    title: 'New Object - Group',
    width: 460,
    modal: true,
    owner: aduc.owner,
    buttons: [
      {
        label: 'OK',
        primary: true,
        disabled: true,
        onClick: () => {
          const path = pathArgOf(nodeKey, aduc.dir);
          const r = aduc.run('group.create', {
            Name: name.value.trim(),
            Description: '',
            GroupScope: scope,
            GroupCategory: type,
            ...(path ? { Path: path } : {}),
          });
          if (!r.ok) return false;
          if (pre.value.trim() && pre.value.trim() !== name.value.trim()) {
            aduc.run('group.update', { Identity: name.value.trim(), Replace: `sAMAccountName=${pre.value.trim()}` }, { quiet: true });
          }
          const g = aduc.dir.getGroupByName(name.value.trim());
          if (g) aduc.reveal(nodeKey, `group:${g.id}`);
        },
      },
      { label: 'Cancel', cancel: true },
    ],
  });
  const ok = d.buttons[0]!;
  const cols = el('div');
  cols.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:14px;';
  cols.append(scopeFs, typeFs);
  const l1 = el('div', undefined, 'Group name:');
  const l2 = el('div', undefined, 'Group name (pre-Windows 2000):');
  l2.style.marginTop = '10px';
  name.style.width = '100%';
  pre.style.width = '100%';
  d.body.append(headerStrip('group', canonicalOf(nodeKey, aduc.dir), 'Create in:'), l1, name, l2, pre, cols);
}

// ---------------------------------------------------------------------------
// New Object - Organizational Unit
// ---------------------------------------------------------------------------

export function newOuDialog(aduc: Aduc, nodeKey: string): void {
  const name = textbox('');
  name.style.width = '100%';
  const protect = checkbox('Protect container from accidental deletion', true);
  const d = openDialog({
    title: 'New Object - Organizational Unit',
    width: 460,
    modal: true,
    owner: aduc.owner,
    buttons: [
      {
        label: 'OK',
        primary: true,
        disabled: true,
        onClick: () => {
          const path = pathArgOf(nodeKey, aduc.dir);
          const r = aduc.run('ou.create', {
            Name: name.value.trim(),
            ProtectedFromAccidentalDeletion: protect.checked ? 'true' : 'false',
            ...(path ? { Path: path } : {}),
          });
          if (!r.ok) return false;
          const parent = path ? aduc.dir.resolveOuRef(path).ou?.id : undefined;
          const ou = aduc.dir.childOus(parent).find((o) => o.name.toLowerCase() === name.value.trim().toLowerCase());
          aduc.reveal(nodeKey, ou ? `ou:${ou.id}` : undefined);
        },
      },
      { label: 'Cancel', cancel: true },
      { label: 'Help', onClick: () => { messageBox('An organizational unit (OU) is a container you use to organize users, groups and computers, and to which you can delegate administration and link Group Policy. It is not a security principal: you cannot grant it permissions. Groups are how you grant access.', { title: 'Help', kind: 'info' }); return false; } },
    ],
  });
  const ok = d.buttons[0]!;
  name.addEventListener('input', () => (ok.disabled = !name.value.trim()));
  const l = el('div', undefined, 'Name:');
  l.style.marginBottom = '3px';
  protect.el.style.marginTop = '6px';
  d.body.append(headerStrip('ou', canonicalOf(nodeKey, aduc.dir), 'Create in:'), l, name, protect.el);
  d.body.style.minHeight = '230px';
}

// ---------------------------------------------------------------------------
// Delegation of Control Wizard
// ---------------------------------------------------------------------------

export function delegationWizard(aduc: Aduc, nodeKey: string): void {
  const where = canonicalOf(nodeKey, aduc.dir);
  let page = 0;
  const trustees: AdObj[] = [];
  const checks = DELEGATION_TASKS.map((t) => checkbox(t, false));

  const d = openDialog({ title: 'Delegation of Control Wizard', width: 520, height: 420, modal: true, owner: aduc.owner });
  d.body.style.padding = '0';
  const pages = [el('div'), el('div'), el('div'), el('div')];
  for (const p of pages) {
    p.style.cssText = 'height:100%;';
    d.body.appendChild(p);
  }

  const inner = (title: string, sub: string, content: HTMLElement[]): HTMLElement[] => {
    const head = el('div', 'ad-wiz-head');
    head.style.margin = '0';
    const b = el('b', undefined, title);
    const s = el('div', undefined, sub);
    s.style.paddingLeft = '14px';
    head.append(b, s);
    const body = el('div');
    body.style.cssText = 'padding:12px 20px;';
    body.append(...content);
    return [head, body];
  };

  // Welcome / completing pages use the blue side panel.
  const sidePage = (title: string, text: HTMLElement): HTMLElement => {
    const wrap = el('div');
    wrap.style.cssText = 'display:flex;height:100%;background:#fff;';
    const side = el('div', 'ad-wiz-side');
    side.style.cssText += 'width:150px;flex-shrink:0;display:flex;align-items:flex-start;justify-content:center;padding-top:22px;';
    side.appendChild(icon('ou', 48));
    const main = el('div');
    main.style.cssText = 'padding:18px 20px;flex:1;';
    const h = el('div', undefined, title);
    h.style.cssText = 'font-size:16px;margin-bottom:14px;';
    main.append(h, text);
    wrap.append(side, main);
    return wrap;
  };

  pages[0]!.appendChild(
    sidePage(
      'Welcome to the Delegation of Control Wizard',
      el('div', 'ad-note', 'This wizard helps you delegate control of Active Directory objects. You can grant users permission to manage users, groups, computers, organizational units, and other objects stored in Active Directory Domain Services.\n\nTo continue, click Next.'),
    ),
  );
  (pages[0]!.querySelector('.ad-note') as HTMLElement).style.whiteSpace = 'pre-wrap';

  const lb = listBox<AdObj>([{ label: 'Selected users and groups:', render: (o) => (o.user ? `${o.name} (${NETBIOS}\\${o.user.username})` : `${o.name} (${NETBIOS}\\${o.name})`), iconOf: (o) => o.icon }], { height: '170px', multi: true });
  const addBtn = button('Add...', () =>
    selectObjects(aduc, {
      title: 'Select Users, Computers, or Groups',
      kinds: ['user', 'group'],
      multi: true,
      onOk: (picked) => {
        for (const p of picked) if (!trustees.some((t) => t.key === p.key)) trustees.push(p);
        lb.setRows([...trustees]);
        update();
      },
    }),
  );
  const rmBtn = button('Remove', () => {
    for (const s of lb.selected()) trustees.splice(trustees.indexOf(s), 1);
    lb.setRows([...trustees]);
    update();
  });
  const btns = el('div');
  btns.style.cssText = 'display:flex;gap:8px;margin-top:8px;';
  btns.append(addBtn, rmBtn);
  pages[1]!.append(...inner('Users or Groups', 'Select one or more users or groups to whom you want to delegate control.', [lb.el, btns]));

  const taskList = el('div', 'ad-lb');
  taskList.style.cssText += 'height:170px;padding:3px 5px;margin-left:18px;';
  for (const c of checks) {
    taskList.appendChild(c.el);
    c.input.addEventListener('change', () => update());
  }
  const common = radio('dlg-task', 'Delegate the following common tasks:', true);
  const custom = radio('dlg-task', 'Create a custom task to delegate', false, () => {
    messageBox('Custom tasks write individual permissions (ACEs) on object types. On a real domain controller use this, or dsacls, for anything the common tasks do not cover. This lab records the common tasks only.', { kind: 'info' });
    common.checked = true;
  });
  pages[2]!.append(...inner('Tasks to Delegate', 'You can select common tasks or customize your own.', [common.el, taskList, custom.el]));

  const summary = document.createElement('textarea');
  summary.readOnly = true;
  summary.style.cssText = 'width:100%;height:170px;';
  pages[3]!.appendChild(sidePage('Completing the Delegation of Control Wizard', summary));

  const back = button('< Back', () => go(page - 1));
  const next = button('Next >', () => onNext(), { primary: true });
  const cancel = button('Cancel', () => d.close());
  const help = button('Help', () => messageBox('Delegation grants a group the right to perform specific tasks on the objects in one OU, without making it a domain administrator. The classic use is letting the help desk reset passwords in the user OUs.', { title: 'Help', kind: 'info' }));
  d.foot.style.display = 'flex';
  d.foot.style.paddingTop = '10px';
  d.foot.append(back, next, cancel, help);
  d.buttons.push(next, back, cancel);

  function update(): void {
    back.disabled = page === 0;
    if (page === 1) next.disabled = trustees.length === 0;
    else if (page === 2) next.disabled = !checks.some((c) => c.checked);
    else next.disabled = false;
    next.textContent = page === 3 ? 'Finish' : 'Next >';
  }
  function go(p: number): void {
    page = Math.max(0, Math.min(3, p));
    pages.forEach((x, i) => (x.style.display = i === page ? '' : 'none'));
    if (page === 3) {
      summary.value = [
        'You have successfully completed the Delegation of Control wizard.',
        '',
        'You chose to delegate control of objects in the following Active Directory folder:',
        `        ${where}`,
        '',
        'The groups, users, or computers to which you have given control are:',
        ...trustees.map((t) => `        ${t.name}`),
        '',
        'They have the following permissions:',
        ...DELEGATION_TASKS.filter((_, i) => checks[i]!.checked).map((t) => `        ${t}`),
        '',
        'To close this wizard, click Finish.',
      ].join('\n');
    }
    update();
  }
  function onNext(): void {
    if (page < 3) return go(page + 1);
    const tasks = DELEGATION_TASKS.map((_, i) => i + 1).filter((n) => checks[n - 1]!.checked).join(',');
    const path = pathArgOf(nodeKey, aduc.dir);
    for (const t of trustees) {
      // A default group (Domain Admins...) becomes a real object on first use.
      const g = t.builtin ? materializeGroup(aduc, t) : t.group;
      if (t.builtin && !g) return;
      const trustee = t.user?.username ?? g?.name ?? t.name;
      if (!aduc.run('ou.delegate', { ...(path ? { Path: path } : {}), Trustee: trustee, Tasks: tasks }).ok) return;
    }
    d.close();
  }
  go(0);
}
