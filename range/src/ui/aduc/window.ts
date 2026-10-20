/**
 * ui/consoles/activeDirectoryWindow.ts — Active Directory Users and Computers.
 *
 * Built to look and behave like dsa.msc on Windows Server: File / Action /
 * View / Help, the MMC toolbar, "Active Directory Users and Computers
 * [DC.domain]" at the top of a tree that holds Saved Queries and the domain
 * with Builtin, Computers, Domain Controllers, ForeignSecurityPrincipals,
 * Managed Service Accounts and Users, the result pane with Name / Type /
 * Description, and the real right-click menus (Delegate Control..., New >
 * User, Copy..., Add to a group..., Reset Password..., Move...). View >
 * Advanced Features adds LostAndFound, System and the Object, Security and
 * Attribute Editor tabs, exactly as it does on a server.
 *
 * That shape is not decoration. "Where do I click to reset a password" is an
 * interview question, and the muscle memory built here is meant to transfer
 * to the first real console the learner sits at.
 *
 * Every change goes through the capability registry, so an action taken here
 * fires the same service calls and audit events as the same cmdlet typed in
 * the terminal. The pieces live in ./aduc/: the controls (ui), the icons, the
 * object model, the pickers, the wizards, the property sheets and Find.
 */
import type { OuId, User } from './shim/domain';
import type { VmServices } from './shim/session';
import { VM_HOST } from './shim/config';
import { makeRunner, type Aduc } from './context';
import { icon, type IconName } from './icons';
import {
  ALL_COLUMNS,
  DC_FQDN,
  DEFAULT_COLUMNS,
  DOMAIN,
  canCreateObjectsIn,
  canCreateOuIn,
  childrenOf,
  objectByKey,
  parentKey,
  treeChildren,
  type AdObj,
  type ViewOptions,
} from './model';
import {
  addToGroupDialog,
  deleteObjects,
  moveDialog,
  renameDialog,
  resetPasswordDialog,
  setEnabled,
} from './actions';
import { delegationWizard, newGroupDialog, newOuDialog, newUserWizard } from './wizards';
import { openProperties } from './properties';
import { findDialog } from './find';
import {
  button,
  checkbox,
  closeDialogsOf,
  closeMenus,
  el,
  ensureStyles,
  listBox,
  messageBox,
  openDialog,
  openMenu,
  radio,
  select,
  setMenuHintSink,
  textbox,
  type MenuItem,
} from './ui';

type ViewMode = 'large' | 'small' | 'list' | 'detail';

interface Prefs {
  advanced: boolean;
  asContainers: boolean;
  mode: ViewMode;
  columns: string[];
  widths: Record<string, number>;
  treeWidth: number;
  showTree: boolean;
  showToolbar: boolean;
  showStatus: boolean;
  showDescription: boolean;
  filter: string[] | null;
}

const PREFS_KEY = 'aduc.view.v1';

function loadPrefs(): Prefs {
  const base: Prefs = {
    advanced: false, asContainers: false, mode: 'detail', columns: [...DEFAULT_COLUMNS], widths: {},
    treeWidth: 250, showTree: true, showToolbar: true, showStatus: true, showDescription: false, filter: null,
  };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...base, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    /* private mode or blocked storage: defaults */
  }
  return base;
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* not essential */
  }
}

export function renderActiveDirectoryWindow(body: HTMLElement, conductor: VmServices): void {
  ensureStyles();
  body.innerHTML = '';
  Object.assign(body.style, { overflow: 'hidden', background: '#fff', flex: '1', minHeight: '0' });

  const prefs = loadPrefs();
  const owner = {};
  let selectedNode = 'domain';
  let selectedKeys = new Set<string>();
  let anchorIndex = -1;
  let sortCol = 'name';
  let sortAsc = true;
  let cutKeys = new Set<string>();
  const expanded = new Set<string>(['root', 'domain']);
  const history: string[] = ['domain'];
  let historyAt = 0;
  let focusPane: 'tree' | 'list' = 'tree';
  let rows: AdObj[] = [];

  const view = (): ViewOptions => ({
    advanced: prefs.advanced,
    types: prefs.filter ? new Set(prefs.filter as never[]) : null,
  });

  // ── Layout ────────────────────────────────────────────────────────────────
  const root = el('div', 'ad-root');
  root.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0;';
  body.appendChild(root);

  const menubar = el('div', 'ad-menubar');
  const toolbar = el('div', 'ad-toolbar');
  const panes = el('div', 'ad-panes');
  const tree = el('div', 'ad-tree');
  tree.tabIndex = 0;
  const splitter = el('div', 'ad-splitter');
  const right = el('div');
  right.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;';
  const descBar = el('div');
  descBar.style.cssText = 'padding:3px 8px;background:#f0f0f0;border-bottom:1px solid #d9d9d9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  const list = el('div', 'ad-list');
  list.tabIndex = 0;
  right.append(descBar, list);
  panes.append(tree, splitter, right);
  const status = el('div', 'ad-status');
  root.append(menubar, toolbar, panes, status);

  const applyChrome = (): void => {
    tree.style.width = `${prefs.treeWidth}px`;
    tree.style.display = splitter.style.display = prefs.showTree ? '' : 'none';
    toolbar.style.display = prefs.showToolbar ? '' : 'none';
    status.style.display = prefs.showStatus ? '' : 'none';
    descBar.style.display = prefs.showDescription ? '' : 'none';
  };

  // Resizable console tree.
  splitter.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = prefs.treeWidth;
    const move = (ev: MouseEvent): void => {
      prefs.treeWidth = Math.max(120, Math.min(560, startW + ev.clientX - startX));
      tree.style.width = `${prefs.treeWidth}px`;
    };
    const up = (): void => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      savePrefs(prefs);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  // Close this console's dialogs when the window goes away.
  const stopWorld = conductor.onWorldChange(() => { if (root.isConnected) refresh(); });
  const watch = window.setInterval(() => {
    if (!root.isConnected) {
      stopWorld();
      closeDialogsOf(owner);
      closeMenus();
      setMenuHintSink(null);
      window.clearInterval(watch);
    }
  }, 1000);

  // ── The console context the dialogs use ──────────────────────────────────
  const refresh = (): void => {
    if (!objectByKey(selectedNode, conductor.dir)) selectedNode = parentKey(selectedNode, conductor.dir) ?? 'domain';
    renderTree();
    renderList();
  };
  const aduc: Aduc = {
    conductor,
    dir: conductor.dir,
    owner,
    advanced: () => prefs.advanced,
    run: makeRunner(conductor, () => refresh()),
    refresh,
    reveal: (nodeKey, objectKey) => navigate(nodeKey, objectKey),
    openProperties: (o, tab) => openProperties(aduc, o, tab),
    contextMenuFor: (o, x, y) => openMenu(x, y, menuForObjects([o])),
  };

  // ── Navigation ───────────────────────────────────────────────────────────
  function navigate(nodeKey: string, objectKey?: string, fromHistory = false): void {
    if (!objectByKey(nodeKey, conductor.dir)) return;
    selectedNode = nodeKey;
    // Open the path to it.
    for (let k = parentKey(nodeKey, conductor.dir); k; k = parentKey(k, conductor.dir)) expanded.add(k);
    // Revealing a new child (an OU just created here) opens the parent, so it shows in the tree.
    if (objectKey) expanded.add(nodeKey);
    selectedKeys = new Set(objectKey ? [objectKey] : []);
    if (!fromHistory && history[historyAt] !== nodeKey) {
      history.splice(historyAt + 1);
      history.push(nodeKey);
      historyAt = history.length - 1;
    }
    refresh();
    if (objectKey) {
      list.focus();
      focusPane = 'list';
      list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    }
  }

  // ── Menus ────────────────────────────────────────────────────────────────
  const viewItems = (): MenuItem[] => [
    { label: 'Add/Remove Columns...', onClick: () => columnsDialog(), hint: 'Adds or removes columns in the result pane' },
    { separator: true },
    { label: 'Large Icons', radio: true, checked: prefs.mode === 'large', onClick: () => setMode('large'), hint: 'Displays items by using large icons' },
    { label: 'Small Icons', radio: true, checked: prefs.mode === 'small', onClick: () => setMode('small'), hint: 'Displays items by using small icons' },
    { label: 'List', radio: true, checked: prefs.mode === 'list', onClick: () => setMode('list'), hint: 'Displays items in a list' },
    { label: 'Detail', radio: true, checked: prefs.mode === 'detail', onClick: () => setMode('detail'), hint: 'Displays information about each item in the window' },
    { separator: true },
    {
      label: 'Users, Contacts, Groups, and Computers as containers',
      checked: prefs.asContainers,
      onClick: () => { prefs.asContainers = !prefs.asContainers; savePrefs(prefs); refresh(); },
      hint: 'Shows users, contacts, groups and computers in the console tree',
    },
    {
      label: 'Advanced Features',
      checked: prefs.advanced,
      onClick: () => {
        prefs.advanced = !prefs.advanced;
        savePrefs(prefs);
        if (!prefs.advanced && !objectByKey(selectedNode, conductor.dir)) selectedNode = 'domain';
        refresh();
      },
      hint: 'Shows advanced objects and the Object, Security and Attribute Editor tabs',
    },
    { separator: true },
    { label: 'Filter Options...', onClick: () => filterDialog(), hint: 'Specifies which objects are displayed' },
    { separator: true },
    { label: 'Customize...', onClick: () => customizeDialog(), hint: 'Customizes the view' },
  ];

  const newItems = (nodeKey: string): MenuItem[] => {
    const objs = canCreateObjectsIn(nodeKey);
    const na = { disabled: true, hint: 'This object type is not available in this lab' };
    return [
      { label: 'Computer', ...na },
      { label: 'Contact', ...na },
      { label: 'Group', disabled: !objs, onClick: () => newGroupDialog(aduc, nodeKey), hint: 'Creates a new group' },
      { label: 'InetOrgPerson', ...na },
      { label: 'msDS-ShadowPrincipalContainer', ...na },
      { label: 'msImaging-PSPs', ...na },
      { label: 'MSMQ Queue Alias', ...na },
      { label: 'Organizational Unit', disabled: !canCreateOuIn(nodeKey), onClick: () => newOuDialog(aduc, nodeKey), hint: 'Creates a new organizational unit' },
      { label: 'Printer', ...na },
      { label: 'User', disabled: !objs, onClick: () => newUserWizard(aduc, nodeKey), hint: 'Creates a new user' },
      { label: 'Shared Folder', ...na },
    ];
  };

  const domainTasks = (): MenuItem[] => [
    { label: 'Delegate Control...', onClick: () => delegationWizard(aduc, 'domain'), hint: 'Delegates control of this container' },
    { label: 'Find...', onClick: () => findDialog(aduc, 'domain'), hint: 'Finds objects in the directory' },
    { label: 'Change Domain...', onClick: () => changeDomainDialog(), hint: 'Connects to another domain' },
    { label: 'Change Domain Controller...', onClick: () => changeDcDialog(), hint: 'Connects to another domain controller' },
    { label: 'Raise domain functional level...', onClick: () => raiseLevelDialog(), hint: 'Raises the domain functional level' },
    { label: 'Operations Masters...', onClick: () => opsMastersDialog(), hint: 'Shows the operations master roles' },
  ];

  const tail = (o: { props?: () => void; exportable?: boolean }): MenuItem[] => [
    { separator: true },
    { label: 'Refresh', onClick: () => refresh(), hint: 'Refreshes the current view' },
    ...(o.exportable === false ? [] : [{ label: 'Export List...', onClick: () => exportList(), hint: 'Exports the current list to a text file' }] as MenuItem[]),
    { separator: true },
    ...(o.props ? [{ label: 'Properties', bold: false, onClick: o.props, hint: 'Opens the properties dialog box for the current selection' }, { separator: true } as MenuItem] : []),
    { label: 'Help', onClick: () => helpDialog(), hint: 'Help for the current selection' },
  ];

  /** The menu for a tree node (right-click on it, or Action with the tree focused). */
  function menuForNode(nodeKey: string): MenuItem[] {
    const o = objectByKey(nodeKey, conductor.dir);
    if (!o) return [];
    if (o.kind === 'root') {
      return [
        { label: 'Change Domain...', onClick: () => changeDomainDialog() },
        { label: 'Change Domain Controller...', onClick: () => changeDcDialog() },
        { label: 'Operations Masters...', onClick: () => opsMastersDialog() },
        { separator: true },
        { label: 'View', submenu: viewItems() },
        ...tail({ exportable: true }),
      ];
    }
    if (o.kind === 'saved') {
      return [
        { label: 'New', submenu: [{ label: 'Query', disabled: true }] },
        { label: 'Import Query Definition...', disabled: true },
        { separator: true },
        { label: 'View', submenu: viewItems() },
        ...tail({}),
      ];
    }
    if (o.kind === 'domain') {
      return [
        ...domainTasks(),
        { separator: true },
        { label: 'New', submenu: newItems('domain') },
        { label: 'All Tasks', submenu: domainTasks() },
        { separator: true },
        { label: 'View', submenu: viewItems() },
        ...tail({ props: () => openProperties(aduc, o) }),
      ];
    }
    if (o.kind === 'ou') {
      const tasks: MenuItem[] = [
        { label: 'Delegate Control...', onClick: () => delegationWizard(aduc, nodeKey), hint: 'Delegates control of this organizational unit' },
        { label: 'Move...', onClick: () => moveDialog(aduc, [o]), hint: 'Moves the current selection to another container' },
        { label: 'Find...', onClick: () => findDialog(aduc, nodeKey), hint: 'Finds objects in this organizational unit' },
      ];
      return [
        ...tasks,
        { separator: true },
        { label: 'New', submenu: newItems(nodeKey) },
        { label: 'All Tasks', submenu: tasks },
        { separator: true },
        { label: 'View', submenu: viewItems() },
        { separator: true },
        { label: 'Cut', onClick: () => cut([o]), hint: 'Removes the current selection and places it on the clipboard' },
        { label: 'Delete', onClick: () => deleteObjects(aduc, [o]), hint: 'Deletes the current selection' },
        { label: 'Rename', onClick: () => renameDialog(aduc, o), hint: 'Renames the current selection' },
        ...tail({ props: () => openProperties(aduc, o) }),
      ];
    }
    // A built-in container.
    const canDelegate = ['c:users', 'c:computers', 'c:dcs'].includes(nodeKey);
    return [
      ...(canDelegate ? [{ label: 'Delegate Control...', onClick: () => delegationWizard(aduc, nodeKey) } as MenuItem] : []),
      { label: 'Find...', onClick: () => findDialog(aduc, nodeKey.startsWith('ou:') ? nodeKey : 'domain') },
      { separator: true },
      { label: 'New', submenu: newItems(nodeKey), disabled: !canCreateObjectsIn(nodeKey) && !canCreateOuIn(nodeKey) },
      { label: 'All Tasks', submenu: [{ label: 'Find...', onClick: () => findDialog(aduc, 'domain') }] },
      { separator: true },
      { label: 'View', submenu: viewItems() },
      ...(nodeKey === 'c:dcs' ? [{ separator: true } as MenuItem, { label: 'Cut', disabled: true }, { label: 'Delete', disabled: true }, { label: 'Rename', disabled: true }] : []),
      ...tail({ props: () => openProperties(aduc, o) }),
    ];
  }

  /** The menu for one or more selected objects in the result pane. */
  function menuForObjects(objs: AdObj[]): MenuItem[] {
    if (objs.length === 0) return menuForBlank();
    const one = objs.length === 1 ? objs[0]! : null;
    if (one?.nodeKey) return menuForNode(one.nodeKey);
    const users = objs.map((o) => o.user).filter((u): u is User => !!u);
    const allUsers = users.length === objs.length;
    const props = one ? () => openProperties(aduc, one) : undefined;
    const rsop: MenuItem[] = [
      { label: 'Resultant Set of Policy (Planning)...', disabled: true },
      { label: 'Resultant Set of Policy (Logging)...', disabled: true },
    ];

    if (one?.user) {
      const u = one.user;
      return [
        { label: 'Copy...', onClick: () => newUserWizard(aduc, homeKey(u), u), hint: 'Creates a new user from this template' },
        { label: 'Add to a group...', onClick: () => addToGroupDialog(aduc, [u]), hint: 'Adds the selected objects to a group' },
        { label: 'Name Mappings...', onClick: () => nameMappingsDialog(u.displayName), hint: 'Maps certificates and Kerberos names to this account' },
        u.status === 'disabled'
          ? { label: 'Enable Account', onClick: () => setEnabled(aduc, [u], true), hint: 'Enables the selected accounts' }
          : { label: 'Disable Account', onClick: () => setEnabled(aduc, [u], false), hint: 'Disables the selected accounts' },
        { label: 'Reset Password...', onClick: () => resetPasswordDialog(aduc, u), hint: 'Resets the password for the selected user' },
        { label: 'Move...', onClick: () => moveDialog(aduc, objs), hint: 'Moves the current selection to another container' },
        { label: 'Open Home Page', onClick: () => openHomePage(u), hint: "Opens the user's home page" },
        { label: 'Send Mail', onClick: () => messageBox(`No e-mail program is configured on ${VM_HOST.name}. The address is ${u.email}.`, { kind: 'info' }), hint: 'Sends mail to the selected user' },
        { separator: true },
        { label: 'All Tasks', submenu: rsop },
        { separator: true },
        { label: 'Cut', onClick: () => cut(objs), hint: 'Removes the current selection and places it on the clipboard' },
        { label: 'Delete', onClick: () => deleteObjects(aduc, objs), hint: 'Deletes the current selection' },
        { label: 'Rename', onClick: () => renameDialog(aduc, one), hint: 'Renames the current selection' },
        { separator: true },
        { label: 'Properties', bold: true, onClick: props, hint: 'Opens the properties dialog box for the current selection' },
        { separator: true },
        { label: 'Help', onClick: () => helpDialog() },
      ];
    }
    if (allUsers) {
      return [
        { label: 'Add to a group...', onClick: () => addToGroupDialog(aduc, users) },
        { label: 'Enable Account', onClick: () => setEnabled(aduc, users, true) },
        { label: 'Disable Account', onClick: () => setEnabled(aduc, users, false) },
        { label: 'Move...', onClick: () => moveDialog(aduc, objs) },
        { label: 'Send Mail', disabled: true },
        { separator: true },
        { label: 'All Tasks', submenu: rsop },
        { separator: true },
        { label: 'Cut', onClick: () => cut(objs) },
        { label: 'Delete', onClick: () => deleteObjects(aduc, objs) },
        { separator: true },
        { label: 'Properties', bold: true, disabled: true },
        { separator: true },
        { label: 'Help', onClick: () => helpDialog() },
      ];
    }
    if (one?.group) {
      return [
        { label: 'Add to a group...', onClick: () => messageBox('Group nesting is not modelled in this lab directory. Add the accounts to the group that holds the permission instead.', { kind: 'info' }) },
        { label: 'Move...', onClick: () => moveDialog(aduc, objs) },
        { label: 'Send Mail', disabled: !one.group.attrs?.mail, onClick: () => messageBox(`No e-mail program is configured. The group address is ${one.group!.attrs?.mail}.`, { kind: 'info' }) },
        { separator: true },
        { label: 'All Tasks', submenu: [{ label: 'Find...', onClick: () => findDialog(aduc, 'domain') }] },
        { separator: true },
        { label: 'Cut', onClick: () => cut(objs) },
        { label: 'Delete', onClick: () => deleteObjects(aduc, objs) },
        { label: 'Rename', onClick: () => renameDialog(aduc, one) },
        { separator: true },
        { label: 'Properties', bold: true, onClick: props },
        { separator: true },
        { label: 'Help', onClick: () => helpDialog() },
      ];
    }
    if (one?.computer) {
      const dis = { disabled: true };
      return [
        { label: 'Add to a group...', ...dis },
        { label: 'Disable Account', ...dis },
        { label: 'Reset Account', ...dis },
        { label: 'Move...', ...dis },
        { label: 'Manage', ...dis },
        { separator: true },
        { label: 'All Tasks', submenu: rsop },
        { separator: true },
        { label: 'Cut', ...dis },
        { label: 'Delete', ...dis },
        { separator: true },
        { label: 'Properties', bold: true, onClick: props },
        { separator: true },
        { label: 'Help', onClick: () => helpDialog() },
      ];
    }
    if (one?.builtin) {
      return [
        { label: 'Add to a group...', disabled: true },
        { label: 'Move...', disabled: true },
        { separator: true },
        { label: 'Cut', disabled: true },
        { label: 'Delete', disabled: true },
        { label: 'Rename', disabled: true },
        { separator: true },
        { label: 'Properties', bold: true, onClick: props },
        { separator: true },
        { label: 'Help', onClick: () => helpDialog() },
      ];
    }
    // A mixed selection.
    return [
      { label: 'Move...', onClick: () => moveDialog(aduc, objs) },
      { separator: true },
      { label: 'Cut', onClick: () => cut(objs) },
      { label: 'Delete', onClick: () => deleteObjects(aduc, objs) },
      { separator: true },
      { label: 'Help', onClick: () => helpDialog() },
    ];
  }

  /** Right-click on empty space in the result pane. */
  function menuForBlank(): MenuItem[] {
    const n = selectedNode;
    const creatable = canCreateObjectsIn(n) || canCreateOuIn(n);
    return [
      ...(creatable ? [{ label: 'New', submenu: newItems(n) } as MenuItem] : []),
      { label: 'All Tasks', submenu: [{ label: 'Find...', onClick: () => findDialog(aduc, n.startsWith('ou:') ? n : 'domain') }] },
      ...(cutKeys.size && (n === 'c:users' || n.startsWith('ou:') || n === 'domain') ? [{ label: 'Paste', onClick: () => paste(n) } as MenuItem] : []),
      { separator: true },
      { label: 'Refresh', onClick: () => refresh() },
      { label: 'Export List...', onClick: () => exportList() },
      { separator: true },
      { label: 'View', submenu: viewItems() },
      { label: 'Arrange Icons', submenu: [{ label: 'by Name', onClick: () => { sortCol = 'name'; sortAsc = true; renderList(); } }, { label: 'by Type', onClick: () => { sortCol = 'type'; sortAsc = true; renderList(); } }, { label: 'by Description', onClick: () => { sortCol = 'description'; sortAsc = true; renderList(); } }] },
      { label: 'Line up Icons', disabled: prefs.mode === 'detail' || prefs.mode === 'list' },
      { separator: true },
      { label: 'Properties', onClick: () => { const o = objectByKey(n, conductor.dir); if (o) openProperties(aduc, o); } },
      { separator: true },
      { label: 'Help', onClick: () => helpDialog() },
    ];
  }

  const homeKey = (u: User): string => (u.ouId ? `ou:${u.ouId}` : 'c:users');

  /** What Action shows: the menu of whatever has focus, as MMC does. */
  function actionMenu(): MenuItem[] {
    if (focusPane === 'list') return menuForObjects(selectedObjects());
    return menuForNode(selectedNode);
  }

  const MENUS: Record<string, () => MenuItem[]> = {
    File: () => [
      { label: 'Options...', onClick: () => messageBox('Console options are managed by the Microsoft Management Console. This console opens in User mode - full access.', { title: 'Options', kind: 'info' }) },
      { separator: true },
      { label: 'Exit', onClick: () => (root.closest('.apex-window')?.querySelector('button[title=close]') as HTMLButtonElement | null)?.click(), hint: 'Closes the console' },
    ],
    Action: () => actionMenu(),
    View: () => viewItems(),
    Help: () => [
      { label: 'Help Topics', onClick: () => helpDialog() },
      { separator: true },
      { label: 'About Active Directory Users and Computers...', onClick: () => aboutDialog() },
    ],
  };

  for (const label of Object.keys(MENUS)) {
    const m = el('span', undefined, label);
    m.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const r = m.getBoundingClientRect();
      m.classList.add('open');
      openMenu(r.left, r.bottom, MENUS[label]!(), 0, () => m.classList.remove('open'));
    });
    menubar.appendChild(m);
  }

  setMenuHintSink((t) => {
    if (t) status.textContent = t;
    else paintStatus();
  });

  // ── Toolbar ──────────────────────────────────────────────────────────────
  const tb = (name: IconName, title: string, onClick: () => void): HTMLButtonElement => {
    const b = el('button', 'ad-tb');
    b.type = 'button';
    b.title = title;
    b.appendChild(icon(name));
    b.addEventListener('click', onClick);
    b.addEventListener('mouseenter', () => (status.textContent = title));
    b.addEventListener('mouseleave', () => paintStatus());
    return b;
  };
  const sep = (): HTMLElement => el('span', 'ad-tbsep');
  const tBack = tb('back', 'Back', () => { if (historyAt > 0) navigate(history[--historyAt]!, undefined, true); });
  const tFwd = tb('forward', 'Forward', () => { if (historyAt < history.length - 1) navigate(history[++historyAt]!, undefined, true); });
  const tUp = tb('up', 'Up One Level', () => { const p = parentKey(selectedNode, conductor.dir); if (p) navigate(p); });
  const tTree = tb('tree', 'Show/Hide Console Tree', () => { prefs.showTree = !prefs.showTree; savePrefs(prefs); applyChrome(); });
  const tDel = tb('delete', 'Delete', () => deleteObjects(aduc, selectedObjects()));
  const tProps = tb('properties', 'Properties', () => {
    const s = selectedObjects();
    const o = s.length === 1 ? s[0]! : focusPane === 'tree' ? objectByKey(selectedNode, conductor.dir) : undefined;
    if (o) openProperties(aduc, o);
  });
  const tRefresh = tb('refresh', 'Refresh', () => refresh());
  const tExport = tb('export', 'Export List', () => exportList());
  const tHelp = tb('help', 'Help', () => helpDialog());
  const tNewUser = tb('newUser', 'Create a new user in the current container.', () => newUserWizard(aduc, selectedNode));
  const tNewGroup = tb('newGroup', 'Create a new group in the current container.', () => newGroupDialog(aduc, selectedNode));
  const tNewOu = tb('newOu', 'Create a new organizational unit in the current container.', () => newOuDialog(aduc, selectedNode));
  const tFilter = tb('filter', 'Add a filter to the current list.', () => filterDialog());
  const tFind = tb('find', 'Find objects in Active Directory Domain Services.', () => findDialog(aduc, selectedNode.startsWith('ou:') ? selectedNode : 'domain'));
  const tAddGroup = tb('addToGroup', 'Add the selected object to a group you specify.', () => {
    const users = selectedObjects().map((o) => o.user).filter((u): u is User => !!u);
    if (users.length) addToGroupDialog(aduc, users);
  });
  toolbar.append(tBack, tFwd, tUp, sep(), tTree, sep(), tDel, tProps, tRefresh, tExport, sep(), tHelp, sep(), tNewUser, tNewGroup, tNewOu, tFilter, tFind, tAddGroup);

  function paintToolbar(): void {
    tBack.disabled = historyAt === 0;
    tFwd.disabled = historyAt >= history.length - 1;
    tUp.disabled = !parentKey(selectedNode, conductor.dir);
    const sel = selectedObjects();
    tDel.disabled = !sel.length || sel.some((o) => !(o.user || o.group || o.ou));
    tProps.disabled = !(sel.length === 1 || (focusPane === 'tree' && selectedNode !== 'root' && selectedNode !== 'saved'));
    tNewUser.disabled = tNewGroup.disabled = !canCreateObjectsIn(selectedNode);
    tNewOu.disabled = !canCreateOuIn(selectedNode);
    tAddGroup.disabled = !sel.length || !sel.every((o) => o.user);
    tFilter.classList.toggle('on', !!prefs.filter);
    tTree.classList.toggle('on', prefs.showTree);
  }

  // ── Console tree ─────────────────────────────────────────────────────────
  const rootLabel = `Active Directory Users and Computers [${DC_FQDN}]`;

  function renderTree(): void {
    const scroll = tree.scrollTop;
    tree.textContent = '';
    const draw = (key: string, label: string, iconName: IconName, depth: number): void => {
      const kids = treeChildren(key, conductor.dir, view(), prefs.asContainers);
      const row = el('div', 'ad-trow' + (key === selectedNode ? ' sel' : '') + (cutKeys.has(key) ? ' cut' : ''));
      row.style.paddingLeft = `${2 + depth * 16}px`;
      row.dataset.key = key;
      const tw = el('span', 'ad-twisty');
      if (kids.length) {
        const chev = el('span', 'ad-chev' + (expanded.has(key) ? ' open' : ''));
        tw.appendChild(chev);
        tw.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (expanded.has(key)) expanded.delete(key);
          else expanded.add(key);
          renderTree();
        });
      }
      const lab = el('span', 'ad-tlabel', label);
      row.append(tw, icon(iconName), lab);
      row.addEventListener('mousedown', (e) => {
        focusPane = 'tree';
        const obj = objectByKey(key, conductor.dir);
        if (obj && !obj.nodeKey) {
          // An object shown as a container: select it in its parent's list.
          const p = parentKey(key, conductor.dir);
          if (p) navigate(p, key);
          if (e.button === 2) openMenu(e.clientX, e.clientY, menuForObjects([obj]));
          return;
        }
        if (key !== selectedNode) navigate(key);
      });
      row.addEventListener('dblclick', () => {
        if (!kids.length) return;
        if (expanded.has(key)) expanded.delete(key);
        else expanded.add(key);
        renderTree();
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const obj = objectByKey(key, conductor.dir);
        if (obj?.nodeKey) openMenu(e.clientX, e.clientY, menuForNode(key));
      });
      // Drop target for dragged objects.
      row.addEventListener('dragover', (e) => {
        if (key === 'c:users' || key.startsWith('ou:') || key === 'domain') {
          e.preventDefault();
          lab.style.outline = '1px dashed #0078d7';
        }
      });
      row.addEventListener('dragleave', () => (lab.style.outline = ''));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        lab.style.outline = '';
        const keys = (e.dataTransfer?.getData('text/aduc') ?? '').split('\n').filter(Boolean);
        dropMove(keys, key);
      });
      tree.appendChild(row);
      if (expanded.has(key)) for (const c of kids) draw(c.nodeKey ?? c.key, c.name, c.icon, depth + 1);
    };
    draw('root', rootLabel, 'root', 0);
    tree.scrollTop = scroll;
    const selRow = tree.querySelector<HTMLElement>('.ad-trow.sel');
    if (selRow) {
      const r = selRow.getBoundingClientRect();
      const t = tree.getBoundingClientRect();
      if (r.top < t.top || r.bottom > t.bottom) selRow.scrollIntoView({ block: 'nearest' });
    }
  }

  // ── Result pane ──────────────────────────────────────────────────────────
  function selectedObjects(): AdObj[] {
    return rows.filter((r) => selectedKeys.has(r.key));
  }

  function sortRows(input: AdObj[]): AdObj[] {
    const colDef = ALL_COLUMNS.find((c) => c.id === sortCol) ?? ALL_COLUMNS[0]!;
    const sorted = [...input].sort((a, b) => colDef.value(a, conductor.dir).localeCompare(colDef.value(b, conductor.dir), undefined, { sensitivity: 'base', numeric: true }));
    // Keep the snap-in's default order (containers then objects by name) for the Name column.
    if (sortCol === 'name') return sortAsc ? input : [...input].reverse();
    return sortAsc ? sorted : sorted.reverse();
  }

  function renderList(): void {
    const scroll = list.scrollTop;
    list.textContent = '';
    rows = sortRows(childrenOf(selectedNode, conductor.dir, view()));
    for (const k of [...selectedKeys]) if (!rows.some((r) => r.key === k)) selectedKeys.delete(k);
    const o = objectByKey(selectedNode, conductor.dir);
    descBar.textContent = o ? (o.kind === 'root' ? rootLabel : o.kind === 'domain' ? DOMAIN : `${o.name}${o.description ? '    ' + o.description : ''}`) : '';

    if (rows.length === 0) {
      list.appendChild(el('div', 'ad-empty', 'There are no items to show in this view.'));
    } else if (prefs.mode === 'detail') {
      renderDetails();
    } else {
      renderIcons();
    }
    list.scrollTop = scroll;
    paintStatus();
    paintToolbar();
  }

  function rowEvents(node: HTMLElement, r: AdObj, i: number): void {
    node.draggable = !!(r.user || r.group || r.ou);
    node.addEventListener('mousedown', (e) => {
      focusPane = 'list';
      if (e.shiftKey && anchorIndex >= 0) {
        const [a, b] = [Math.min(anchorIndex, i), Math.max(anchorIndex, i)];
        selectedKeys = new Set(rows.slice(a, b + 1).map((x) => x.key));
      } else if (e.ctrlKey || e.metaKey) {
        if (selectedKeys.has(r.key)) selectedKeys.delete(r.key);
        else selectedKeys.add(r.key);
        anchorIndex = i;
      } else if (!(e.button === 2 && selectedKeys.has(r.key))) {
        selectedKeys = new Set([r.key]);
        anchorIndex = i;
      }
      paintSelection();
    });
    node.addEventListener('dblclick', () => {
      if (r.nodeKey) navigate(r.nodeKey);
      else openProperties(aduc, r);
    });
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMenu(e.clientX, e.clientY, menuForObjects(selectedObjects()));
    });
    node.addEventListener('dragstart', (e) => {
      if (!selectedKeys.has(r.key)) {
        selectedKeys = new Set([r.key]);
        paintSelection();
      }
      e.dataTransfer?.setData('text/aduc', [...selectedKeys].join('\n'));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
  }

  function paintSelection(): void {
    list.querySelectorAll<HTMLElement>('[data-key]').forEach((n) => n.classList.toggle('sel', selectedKeys.has(n.dataset.key!)));
    paintStatus();
    paintToolbar();
  }

  function renderDetails(): void {
    const cols = prefs.columns.map((id) => ALL_COLUMNS.find((c) => c.id === id)).filter((c): c is (typeof ALL_COLUMNS)[number] => !!c);
    const table = el('table', 'ad-table');
    const colgroup = el('colgroup');
    const thead = el('thead');
    const hr_ = el('tr');
    let total = 0;
    for (const c of cols) {
      const w = prefs.widths[c.id] ?? c.width;
      total += w;
      const cg = el('col');
      cg.style.width = `${w}px`;
      colgroup.appendChild(cg);
      const th = el('th', undefined, c.label + (sortCol === c.id && c.id !== 'name' ? (sortAsc ? '  ↑' : '  ↓') : sortCol === c.id && !sortAsc ? '  ↓' : ''));
      th.style.position = 'sticky';
      th.addEventListener('click', () => {
        if (sortCol === c.id) sortAsc = !sortAsc;
        else {
          sortCol = c.id;
          sortAsc = true;
        }
        renderList();
      });
      const grip = el('span', 'ad-grip');
      grip.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = prefs.widths[c.id] ?? c.width;
        const move = (ev: MouseEvent): void => {
          prefs.widths[c.id] = Math.max(40, startW + ev.clientX - startX);
          cg.style.width = `${prefs.widths[c.id]}px`;
        };
        const up = (): void => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          savePrefs(prefs);
          renderList();
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
      grip.addEventListener('click', (e) => e.stopPropagation());
      th.appendChild(grip);
      hr_.appendChild(th);
    }
    // Columns keep their own widths; a filler column takes the rest, as in ADUC.
    colgroup.appendChild(el('col'));
    hr_.appendChild(el('th', 'ad-fill'));
    table.style.minWidth = `${total}px`;
    thead.appendChild(hr_);
    const tbody = el('tbody');
    rows.forEach((r, i) => {
      const tr = el('tr', 'row' + (selectedKeys.has(r.key) ? ' sel' : '') + (cutKeys.has(r.key) ? ' cut' : ''));
      tr.dataset.key = r.key;
      cols.forEach((c, ci) => {
        const td = el('td');
        const v = c.value(r, conductor.dir);
        if (ci === 0) td.appendChild(el('div', 'ad-namecell')).append(icon(r.icon), el('span', undefined, v));
        else td.textContent = v;
        td.title = v;
        tr.appendChild(td);
      });
      tr.appendChild(el('td', 'ad-fill'));
      rowEvents(tr, r, i);
      tbody.appendChild(tr);
    });
    table.append(colgroup, thead, tbody);
    list.appendChild(table);
  }

  function renderIcons(): void {
    const wrap = el('div', 'ad-icons' + (prefs.mode === 'large' ? ' large' : prefs.mode === 'list' ? ' list' : ''));
    rows.forEach((r, i) => {
      const it = el('div', 'ad-icon-item' + (selectedKeys.has(r.key) ? ' sel' : ''));
      it.dataset.key = r.key;
      it.append(icon(r.icon, prefs.mode === 'large' ? 32 : 16), el('span', undefined, r.name));
      if (prefs.mode === 'small') it.style.width = '200px';
      rowEvents(it, r, i);
      wrap.appendChild(it);
    });
    list.appendChild(wrap);
  }

  function paintStatus(): void {
    const n = rows.length;
    const sel = selectedKeys.size;
    const filtered = prefs.filter ? ' [Filter Activated]' : '';
    status.textContent = sel > 1 ? `${sel} object(s) selected` : `${n} Object${n === 1 ? '' : 's'}${filtered}`;
  }

  list.addEventListener('mousedown', (e) => {
    focusPane = 'list';
    if (e.target === list || (e.target as HTMLElement).classList.contains('ad-icons') || (e.target as HTMLElement).classList.contains('ad-empty')) {
      selectedKeys.clear();
      paintSelection();
    }
  });
  list.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    selectedKeys.clear();
    paintSelection();
    openMenu(e.clientX, e.clientY, menuForBlank());
  });
  list.addEventListener('dragover', (e) => {
    if (selectedNode === 'c:users' || selectedNode.startsWith('ou:')) e.preventDefault();
  });
  list.addEventListener('drop', (e) => {
    e.preventDefault();
    const keys = (e.dataTransfer?.getData('text/aduc') ?? '').split('\n').filter(Boolean);
    const onto = (e.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key;
    const target = onto && objectByKey(onto, conductor.dir)?.nodeKey ? onto : selectedNode;
    dropMove(keys, target);
  });
  tree.addEventListener('mousedown', () => (focusPane = 'tree'));

  // ── Keyboard ─────────────────────────────────────────────────────────────
  list.addEventListener('keydown', (e) => {
    const sel = selectedObjects();
    const idx = rows.findIndex((r) => selectedKeys.has(r.key));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.max(0, Math.min(rows.length - 1, (idx < 0 ? -1 : idx) + (e.key === 'ArrowDown' ? 1 : -1)));
      if (rows[next]) {
        selectedKeys = new Set([rows[next]!.key]);
        anchorIndex = next;
        paintSelection();
        list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const one = sel[0];
      if (!one) return;
      if (e.altKey || !one.nodeKey) openProperties(aduc, one);
      else navigate(one.nodeKey);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      if (sel.length) deleteObjects(aduc, sel);
    } else if (e.key === 'F2') {
      e.preventDefault();
      if (sel.length === 1 && (sel[0]!.user || sel[0]!.group || sel[0]!.ou)) renameDialog(aduc, sel[0]!);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      const p = parentKey(selectedNode, conductor.dir);
      if (p) navigate(p);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectedKeys = new Set(rows.map((r) => r.key));
      paintSelection();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      cut(sel);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      paste(selectedNode);
    } else if (e.key === 'F5') {
      e.preventDefault();
      refresh();
    }
  });

  tree.addEventListener('keydown', (e) => {
    const visible = [...tree.querySelectorAll<HTMLElement>('.ad-trow')].map((r) => r.dataset.key!);
    const i = visible.indexOf(selectedNode);
    if (e.key === 'ArrowDown' && i < visible.length - 1) {
      e.preventDefault();
      navigate(visible[i + 1]!);
    } else if (e.key === 'ArrowUp' && i > 0) {
      e.preventDefault();
      navigate(visible[i - 1]!);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      expanded.add(selectedNode);
      renderTree();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (expanded.has(selectedNode)) {
        expanded.delete(selectedNode);
        renderTree();
      } else {
        const p = parentKey(selectedNode, conductor.dir);
        if (p) navigate(p);
      }
    } else if (e.key === 'Enter' && e.altKey) {
      e.preventDefault();
      const o = objectByKey(selectedNode, conductor.dir);
      if (o) openProperties(aduc, o);
    } else if (e.key === 'F5') {
      e.preventDefault();
      refresh();
    } else if (e.key === 'Delete' && selectedNode.startsWith('ou:')) {
      e.preventDefault();
      const o = objectByKey(selectedNode, conductor.dir);
      if (o) deleteObjects(aduc, [o]);
    }
  });

  // ── Cut / paste and drag-and-drop moves ─────────────────────────────────
  function cut(objs: AdObj[]): void {
    cutKeys = new Set(objs.filter((o) => o.user || o.group || o.ou).map((o) => o.key));
    renderTree();
    renderList();
  }

  function paste(target: string): void {
    if (!cutKeys.size) return;
    const keys = [...cutKeys];
    cutKeys.clear();
    moveKeysTo(keys, target);
  }

  /** Drag-and-drop asks first, with the warning the real console gives. */
  function dropMove(keys: string[], target: string): void {
    if (!keys.length || keys.includes(target)) return;
    messageBox(
      'Moving objects in Active Directory Domain Services can prevent your existing system from working the way it was designed. ' +
        'For example, moving an organizational unit (OU) can affect the way that group policies are applied to the accounts within it.\n\n' +
        'Are you sure you want to move this object?',
      { kind: 'warning', title: 'Active Directory Domain Services', yesNo: true, onYes: () => moveKeysTo(keys, target) },
    );
  }

  function moveKeysTo(keys: string[], target: string): void {
    const dest = target === 'c:users' ? `CN=Users,${DOMAIN}` : target === 'domain' ? `DC=${DOMAIN}` : target.startsWith('ou:') ? conductor.dir.ouPath(target.slice(3) as OuId) : null;
    if (!dest) {
      messageBox('Objects can be moved into an organizational unit or the Users container.', { kind: 'error' });
      return;
    }
    for (const k of keys) {
      const o = objectByKey(k, conductor.dir);
      if (!o) continue;
      if (target === 'domain' && !o.ou) {
        messageBox('Accounts and groups cannot be placed directly in the domain in this lab. Choose an OU or the Users container.', { kind: 'warning' });
        return;
      }
      if ((o.user || o.group) && target !== 'c:users' && !target.startsWith('ou:')) continue;
      const id = o.user ? o.user.username : o.group ? o.group.name : o.ou ? conductor.dir.ouPath(o.ou.id) : '';
      if (!id) continue;
      if (!aduc.run('user.move', { Identity: id, TargetPath: dest }).ok) break;
    }
    refresh();
  }

  // ── Small dialogs ────────────────────────────────────────────────────────
  function setMode(m: ViewMode): void {
    prefs.mode = m;
    savePrefs(prefs);
    renderList();
  }

  function columnsDialog(): void {
    const displayed = [...prefs.columns];
    const available = (): string[] => ALL_COLUMNS.map((c) => c.id).filter((id) => !displayed.includes(id));
    const label = (id: string): string => ALL_COLUMNS.find((c) => c.id === id)?.label ?? id;
    const d = openDialog({
      title: 'Add/Remove Columns',
      width: 520,
      modal: true,
      owner,
      buttons: [
        { label: 'OK', primary: true, onClick: () => { prefs.columns = displayed.length ? displayed : [...DEFAULT_COLUMNS]; if (!prefs.columns.includes('name')) prefs.columns.unshift('name'); savePrefs(prefs); renderList(); } },
        { label: 'Cancel', cancel: true },
      ],
    });
    const avail = listBox<string>([{ label: 'Available columns:', render: label }], { height: '220px', multi: true });
    const disp = listBox<string>([{ label: 'Displayed columns:', render: label }], { height: '220px', multi: true });
    const paint = (): void => { avail.setRows(available()); disp.setRows([...displayed]); };
    const mid = el('div');
    mid.style.cssText = 'display:flex;flex-direction:column;gap:8px;justify-content:center;';
    mid.append(
      button('Add ->', () => { for (const id of avail.selected()) displayed.push(id); paint(); }),
      button('<- Remove', () => { for (const id of disp.selected()) if (id !== 'name') displayed.splice(displayed.indexOf(id), 1); paint(); }),
    );
    const side = el('div');
    side.style.cssText = 'display:flex;flex-direction:column;gap:8px;justify-content:center;';
    const move = (delta: number): void => {
      const s = disp.selected()[0];
      if (!s) return;
      const i = displayed.indexOf(s);
      const j = i + delta;
      if (j < 0 || j >= displayed.length) return;
      displayed.splice(i, 1);
      displayed.splice(j, 0, s);
      paint();
    };
    side.append(button('Move Up', () => move(-1)), button('Move Down', () => move(1)));
    const g = el('div');
    g.style.cssText = 'display:grid;grid-template-columns:1fr 90px 1fr 90px;gap:10px;';
    g.append(avail.el, mid, disp.el, side);
    const restore = button('Restore Defaults', () => { displayed.splice(0, displayed.length, ...DEFAULT_COLUMNS); paint(); });
    restore.style.marginTop = '8px';
    d.body.append(g, restore);
    paint();
  }

  function filterDialog(): void {
    const types: [string, string][] = [['user', 'Users'], ['group', 'Groups'], ['computer', 'Computers'], ['ou', 'Organizational Units'], ['container', 'Containers and other objects']];
    const all = radio('flt', 'Show all types of objects', !prefs.filter);
    const some = radio('flt', 'Show only the following types of objects:', !!prefs.filter);
    const checks = types.map(([id, lab]) => [id, checkbox(lab, !prefs.filter || prefs.filter.includes(id))] as const);
    const box = el('div', 'ad-lb');
    box.style.cssText += 'height:120px;padding:3px 6px;margin:4px 0 10px 18px;';
    for (const [, c] of checks) box.appendChild(c.el);
    const max = textbox('2000', { width: '70px' });
    openDialog({
      title: 'Filter Options',
      width: 420,
      modal: true,
      owner,
      buttons: [
        {
          label: 'OK',
          primary: true,
          onClick: () => {
            prefs.filter = all.checked ? null : checks.filter(([, c]) => c.checked).map(([id]) => id);
            savePrefs(prefs);
            renderList();
          },
        },
        { label: 'Cancel', cancel: true },
      ],
    }).body.append(all.el, some.el, box, (() => { const r = el('div'); r.style.cssText = 'display:flex;gap:8px;align-items:center;'; r.append(el('span', undefined, 'Maximum number of items displayed per folder:'), max); return r; })());
  }

  function customizeDialog(): void {
    const c1 = checkbox('Console tree', prefs.showTree);
    const c2 = checkbox('Standard toolbar', prefs.showToolbar);
    const c3 = checkbox('Status bar', prefs.showStatus);
    const c4 = checkbox('Description bar', prefs.showDescription);
    const c5 = checkbox('Standard menus (Action and View)', true);
    c5.setDisabled(true);
    openDialog({
      title: 'Customize View',
      width: 360,
      modal: true,
      owner,
      buttons: [
        {
          label: 'OK',
          primary: true,
          onClick: () => {
            prefs.showTree = c1.checked;
            prefs.showToolbar = c2.checked;
            prefs.showStatus = c3.checked;
            prefs.showDescription = c4.checked;
            savePrefs(prefs);
            applyChrome();
          },
        },
        { label: 'Cancel', cancel: true },
      ],
    }).body.append(el('div', undefined, 'Select or clear the check boxes to show or hide items in the console window.'), (() => { const f = el('fieldset', 'ad-fs'); f.appendChild(el('legend', undefined, 'MMC')); f.append(c1.el, c5.el, c2.el, c3.el, c4.el); f.style.marginTop = '8px'; return f; })());
  }

  function exportList(): void {
    const cols = prefs.columns.map((id) => ALL_COLUMNS.find((c) => c.id === id)).filter((c): c is (typeof ALL_COLUMNS)[number] => !!c);
    const lines = [cols.map((c) => c.label).join('\t'), ...rows.map((r) => cols.map((c) => c.value(r, conductor.dir)).join('\t'))];
    const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const o = objectByKey(selectedNode, conductor.dir);
    a.href = url;
    a.download = `${(o?.name ?? 'export').replace(/[^\w.-]+/g, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function changeDomainDialog(): void {
    const s = select([DOMAIN], DOMAIN, '100%');
    openDialog({ title: 'Change Domain', width: 400, modal: true, owner, buttons: [{ label: 'OK', primary: true }, { label: 'Cancel', cancel: true }] })
      .body.append(el('div', undefined, 'Current domain:  ' + DOMAIN), (() => { const r = el('div'); r.style.cssText = 'display:grid;grid-template-columns:60px 1fr;gap:8px;align-items:center;margin-top:10px;'; r.append(el('label', undefined, 'Domain:'), s); return r; })(), (() => { const c = checkbox('Save this domain setting for the current console', false); c.el.style.marginTop = '10px'; return c.el; })());
  }

  function changeDcDialog(): void {
    const d = openDialog({ title: 'Change Directory Server', width: 460, modal: true, owner, buttons: [{ label: 'OK', primary: true }, { label: 'Cancel', cancel: true }] });
    const lb = listBox<[string, string, string]>([{ label: 'Name', render: (r) => r[0], iconOf: () => 'server' }, { label: 'Site', render: (r) => r[1] }, { label: 'DC Type', render: (r) => r[2] }], { height: '110px' });
    lb.setRows([[DC_FQDN, 'Default-First-Site-Name', 'GC']]);
    d.body.append(el('div', undefined, `Current Directory Server: ${DC_FQDN}`), (() => { const f = el('fieldset', 'ad-fs'); f.appendChild(el('legend', undefined, 'Change to:')); f.append(radio('cds', 'Any Writable Domain Controller', false).el, radio('cds', 'This Domain Controller or AD LDS instance', true).el, lb.el); f.style.marginTop = '8px'; return f; })());
  }

  function raiseLevelDialog(): void {
    const d = openDialog({ title: 'Raise domain functional level', width: 440, modal: true, owner, buttons: [{ label: 'Raise', disabled: true }, { label: 'Cancel', cancel: true, primary: true }] });
    d.body.append(
      el('div', undefined, 'Domain name:'), el('div', undefined, DOMAIN),
      (() => { const e = el('div', undefined, 'Current domain functional level:'); e.style.marginTop = '10px'; return e; })(), el('div', undefined, 'Windows Server 2016'),
      (() => { const e = el('div', 'ad-note', 'Select an available domain functional level:'); e.style.marginTop = '10px'; return e; })(),
      select(['Windows Server 2016'], 'Windows Server 2016', '100%'),
      (() => { const e = el('div', 'ad-note', 'The domain functional level is already at the highest level these domain controllers support. Raising it is irreversible: every DC must run that Windows Server version or later.'); e.style.marginTop = '10px'; return e; })(),
    );
  }

  function opsMastersDialog(): void {
    const d = openDialog({ title: 'Operations Masters', width: 460, modal: true, owner, buttons: [{ label: 'Close', primary: true, cancel: true }] });
    const roles: [string, string][] = [
      ['RID', 'The operations master manages the allocation of RID pools to other domain controllers. Only one server in the domain performs this role.'],
      ['PDC', 'The operations master emulates the functions of a Windows NT 4.0 primary domain controller (PDC). It is also the authoritative time source and receives urgent password and lockout changes first. Only one server in the domain performs this role.'],
      ['Infrastructure', 'The infrastructure operations master ensures that cross-domain object references are correctly handled. Only one server in the domain performs this role.'],
    ];
    const rowsEl = el('div');
    for (const [r, text] of roles) {
      const f = el('fieldset', 'ad-fs');
      f.appendChild(el('legend', undefined, r));
      f.append(el('div', 'ad-note', text), (() => { const g = el('div'); g.style.cssText = 'display:grid;grid-template-columns:120px 1fr;gap:6px;margin-top:6px;'; g.append(el('span', undefined, 'Operations master:'), textbox(DC_FQDN, { readOnly: true })); return g; })());
      f.style.marginBottom = '8px';
      rowsEl.appendChild(f);
    }
    d.body.appendChild(rowsEl);
  }

  function nameMappingsDialog(name: string): void {
    const d = openDialog({ title: `Security Identity Mapping`, width: 440, modal: true, owner, buttons: [{ label: 'OK', primary: true }, { label: 'Cancel', cancel: true }] });
    const lb = listBox<string>([{ label: 'Issued To', render: (s) => s }, { label: 'Issued By', render: () => '' }], { height: '160px' });
    lb.setRows([]);
    d.body.append(el('div', undefined, `Mapped user account: ${name}`), (() => { lb.el.style.marginTop = '8px'; return lb.el; })(), (() => { const r = el('div'); r.style.cssText = 'display:flex;gap:8px;margin-top:8px;'; r.append(button('Add...', () => undefined, { disabled: true }), button('Remove', () => undefined, { disabled: true })); return r; })());
  }

  function openHomePage(u: User): void {
    const url = u.attrs?.wWWHomePage;
    if (!url) {
      messageBox(`No home page is set for ${u.displayName}. Enter one on the General tab (Web page).`, { kind: 'info' });
      return;
    }
    messageBox(`${u.displayName}'s home page is ${url}. Open it in the Browser app.`, { kind: 'info' });
  }

  function helpDialog(): void {
    messageBox(
      'Active Directory Users and Computers\n\n' +
        '- Right-click the domain or an OU and choose New to create an Organizational Unit, User or Group.\n' +
        '- Right-click a user for Reset Password..., Disable Account, Add to a group..., Move... and Copy...\n' +
        '- Double-click an object for its Properties; Member Of lists its groups.\n' +
        '- View > Advanced Features shows the Object, Security and Attribute Editor tabs.\n' +
        '- Every action here is also a cmdlet in the Terminal (New-ADUser, Set-ADAccountPassword, Add-ADGroupMember, Move-ADObject...).',
      { title: 'Help', kind: 'info' },
    );
  }

  function aboutDialog(): void {
    messageBox(
      `Active Directory Users and Computers\nVersion 10.0.20348\n\nConnected to ${DC_FQDN} in ${DOMAIN}.\n\n` +
        'A simulated console for practice. Everything it does is also a cmdlet in the terminal; Get-Help lists them.',
      { title: 'About Active Directory Users and Computers', kind: 'info' },
    );
  }

  // ── First paint ──────────────────────────────────────────────────────────
  applyChrome();
  refresh();
  tree.focus();
}
