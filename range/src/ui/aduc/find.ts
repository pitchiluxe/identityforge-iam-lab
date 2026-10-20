/**
 * ui/consoles/aduc/find.ts — Find Users, Contacts, and Groups.
 *
 * The help desk's first click on most tickets: the caller gives a name, you
 * find the account, right-click it, and reset or unlock it from the results
 * list without ever walking the tree. Results behave like the result pane --
 * double-click for Properties, right-click for the same menu.
 */
import type { OuId } from './shim/domain';
import type { Aduc } from './context';
import { icon } from './icons';
import { COMPUTERS, DOMAIN, groupRow, homeOf, ouRow, userRow, type AdObj } from './model';
import { browseContainer } from './pickers';
import { button, el, listBox, openDialog, select, textbox } from './ui';

type FindKind = 'Users, Contacts, and Groups' | 'Computers' | 'Organizational Units';
const KINDS: FindKind[] = ['Users, Contacts, and Groups', 'Computers', 'Organizational Units'];

const FIELDS: Record<string, (o: AdObj) => string> = {
  'Department': (o) => o.user?.department ?? '',
  'Job Title': (o) => o.user?.title ?? '',
  'Office': (o) => o.user?.attrs?.physicalDeliveryOfficeName ?? '',
  'City': (o) => o.user?.attrs?.l ?? '',
  'E-Mail Address': (o) => o.user?.email ?? o.group?.attrs?.mail ?? '',
  'Logon Name': (o) => o.user?.username ?? '',
  'First Name': (o) => o.user?.attrs?.givenName ?? '',
  'Last Name': (o) => o.user?.attrs?.sn ?? '',
  'Account Status': (o) => (o.user ? o.user.status : ''),
};
const CONDS = ['Starts with', 'Ends with', 'Is (exactly)', 'Is not', 'Present', 'Not present'] as const;

export function findDialog(aduc: Aduc, startIn: string): void {
  let scope = startIn.startsWith('ou:') ? startIn : 'domain';
  const conditions: { field: string; cond: (typeof CONDS)[number]; value: string }[] = [];

  const d = openDialog({ title: 'Find Users, Contacts, and Groups', width: 640, owner: aduc.owner, iconName: 'find' });
  d.body.style.padding = '0';

  const menubar = el('div', 'ad-menubar');
  menubar.style.borderBottom = 'none';
  menubar.style.background = '#f0f0f0';
  for (const m of ['File', 'Edit', 'View']) {
    const s = el('span', undefined, m);
    s.addEventListener('click', () => { if (m === 'File') d.close(); });
    s.title = m === 'File' ? 'File > Close' : '';
    menubar.appendChild(s);
  }

  const top = el('div');
  top.style.cssText = 'display:grid;grid-template-columns:36px 210px 24px 1fr 90px;gap:8px;align-items:center;padding:8px 11px 6px;';
  const kind = select(KINDS, KINDS[0]);
  const inBox = select([DOMAIN], DOMAIN);
  const syncIn = (): void => {
    inBox.textContent = '';
    const label = scope === 'domain' ? DOMAIN : `${DOMAIN}/${aduc.dir.ouPath(scope.slice(3) as OuId)}`;
    inBox.appendChild(new Option(label, label));
  };
  syncIn();
  top.append(
    el('label', undefined, 'Find:'),
    kind,
    el('label', undefined, 'In:'),
    inBox,
    button('Browse...', () =>
      browseContainer(aduc, { title: 'Browse for Container', prompt: 'Select the container to search.', allowDomain: true, onOk: (k) => { scope = k.startsWith('ou:') ? k : 'domain'; syncIn(); } }),
    ),
  );

  // Criteria tabs + the button column.
  const mid = el('div');
  mid.style.cssText = 'display:grid;grid-template-columns:1fr 110px;gap:12px;padding:0 11px;';
  const tabs = el('div');
  const tabRow = el('div', 'ad-tabrow');
  const panel = el('div', 'ad-tabpanel');
  panel.style.height = '150px';
  tabs.append(tabRow, panel);

  const name = textbox('');
  const desc = textbox('');
  name.style.width = desc.style.width = '100%';
  const basic = el('div');
  basic.style.cssText = 'display:grid;grid-template-columns:90px 1fr;gap:8px;align-items:center;padding-top:10px;';
  const nameLabel = el('label', undefined, 'Name:');
  basic.append(nameLabel, name, el('label', undefined, 'Description:'), desc);

  const adv = el('div');
  const fieldSel = select(Object.keys(FIELDS), 'Department');
  const condSel = select(CONDS, 'Starts with');
  const valBox = textbox('');
  const condList = listBox<(typeof conditions)[number]>([{ label: 'Condition List', render: (c) => `${c.field} ${c.cond.toLowerCase()} ${c.value}`.trim() }], { height: '64px' });
  const advRow = el('div');
  advRow.style.cssText = 'display:grid;grid-template-columns:auto 1fr auto 1fr;gap:6px;align-items:center;';
  advRow.append(el('label', undefined, 'Field'), fieldSel, el('label', undefined, 'Condition:'), condSel);
  const valRow = el('div');
  valRow.style.cssText = 'display:grid;grid-template-columns:auto 1fr auto auto;gap:6px;align-items:center;margin:6px 0;';
  valRow.append(
    el('label', undefined, 'Value:'),
    valBox,
    button('Add', () => {
      conditions.push({ field: fieldSel.value, cond: condSel.value as (typeof CONDS)[number], value: valBox.value.trim() });
      condList.setRows([...conditions]);
      valBox.value = '';
    }),
    button('Remove', () => {
      for (const c of condList.selected()) conditions.splice(conditions.indexOf(c), 1);
      condList.setRows([...conditions]);
    }),
  );
  adv.append(advRow, valRow, condList.el);

  const pages: [string, HTMLElement][] = [['Users, Contacts, and Groups', basic], ['Advanced', adv]];
  let activeTab = 0;
  const paintTabs = (): void => {
    tabRow.textContent = '';
    pages.forEach(([label], i) => {
      const t = el('div', 'ad-tab' + (i === activeTab ? ' sel' : ''), i === 0 ? kind.value : label);
      t.style.flex = '0 0 auto';
      t.addEventListener('mousedown', (e) => { e.preventDefault(); activeTab = i; paintTabs(); });
      tabRow.appendChild(t);
    });
    panel.textContent = '';
    panel.appendChild(pages[activeTab]![1]);
  };
  kind.addEventListener('change', () => {
    nameLabel.textContent = kind.value === 'Computers' ? 'Computer name:' : 'Name:';
    d.setTitle(`Find ${kind.value}`);
    paintTabs();
  });
  paintTabs();

  const side = el('div');
  side.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding-top:24px;align-items:stretch;';
  const findNow = button('Find Now', () => run(), { primary: true });
  const stop = button('Stop', () => undefined, { disabled: true });
  const clear = button('Clear All', () => {
    name.value = desc.value = '';
    conditions.length = 0;
    condList.setRows([]);
    results.el.style.display = resultsLabel.style.display = 'none';
    status.textContent = '';
  });
  const flash = icon('flashlight', 32);
  flash.style.margin = '14px auto 0';
  side.append(findNow, stop, clear, flash);
  d.buttons.push(findNow);
  mid.append(tabs, side);

  const resultsLabel = el('div', undefined, 'Search results:');
  resultsLabel.style.cssText = 'padding:10px 11px 3px;display:none;';
  const results = listBox<AdObj>(
    [
      { label: 'Name', render: (o) => o.name, iconOf: (o) => o.icon, width: '34%' },
      { label: 'Type', render: (o) => o.type, width: '26%' },
      { label: 'Description', render: (o) => o.description },
    ],
    {
      height: '190px',
      multi: true,
      onOpen: (o) => aduc.openProperties(o),
      onContext: (o, e) => aduc.contextMenuFor(o, e.clientX, e.clientY),
    },
  );
  results.el.style.cssText += 'margin:0 11px;display:none;';
  const status = el('div');
  status.style.cssText = 'padding:4px 11px 8px;min-height:22px;';

  d.body.append(menubar, top, mid, resultsLabel, results.el, status);

  const inScope = (home: string): boolean => {
    if (scope === 'domain') return true;
    for (let k: string | undefined = home; k; ) {
      if (k === scope) return true;
      if (!k.startsWith('ou:')) return false;
      const p: OuId | undefined = aduc.dir.getOu(k.slice(3) as OuId)?.parentId;
      k = p ? `ou:${p}` : undefined;
    }
    return false;
  };

  function run(): void {
    const q = name.value.trim().toLowerCase();
    const dq = desc.value.trim().toLowerCase();
    let pool: AdObj[];
    if (kind.value === 'Computers') {
      pool = scope === 'domain' ? COMPUTERS.map((c) => ({ key: `computer:${c.name}`, kind: 'computer' as const, name: c.name, type: 'Computer', description: c.description, icon: 'computer' as const, computer: c })) : [];
    } else if (kind.value === 'Organizational Units') {
      pool = aduc.dir.listOus().filter((o) => inScope(o.parentId ? `ou:${o.parentId}` : 'domain') || scope === `ou:${o.id}`).map(ouRow);
    } else {
      pool = [
        ...aduc.dir.listUsers().filter((u) => inScope(homeOf(u))).map(userRow),
        ...aduc.dir.listGroups().filter((g) => inScope(homeOf(g))).map(groupRow),
      ];
    }
    const hits = pool.filter((o) => {
      const names = [o.name, o.user?.username ?? '', o.user?.attrs?.givenName ?? '', o.user?.attrs?.sn ?? ''].map((s) => s.toLowerCase());
      // Name matches the start of any word, as the real search's ANR does.
      if (q && !names.some((n) => n.startsWith(q) || n.split(/\s+/).some((w) => w.startsWith(q)))) return false;
      if (dq && !o.description.toLowerCase().startsWith(dq)) return false;
      for (const c of conditions) {
        const v = (FIELDS[c.field]?.(o) ?? '').toLowerCase();
        const want = c.value.toLowerCase();
        const ok =
          c.cond === 'Starts with' ? v.startsWith(want) :
          c.cond === 'Ends with' ? v.endsWith(want) :
          c.cond === 'Is (exactly)' ? v === want :
          c.cond === 'Is not' ? v !== want :
          c.cond === 'Present' ? v !== '' : v === '';
        if (!ok) return false;
      }
      return true;
    });
    hits.sort((a, b) => a.name.localeCompare(b.name));
    results.setRows(hits);
    results.el.style.display = resultsLabel.style.display = '';
    status.textContent = `${hits.length} item(s) found`;
    // The dialog grows to show results, as the real one does; keep it on screen.
    const box = d.root.getBoundingClientRect();
    if (box.bottom > window.innerHeight - 4) d.root.style.top = `${Math.max(4, window.innerHeight - box.height - 8)}px`;
  }

  queueMicrotask(() => name.focus());
}
