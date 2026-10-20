/**
 * ui/consoles/aduc/pickers.ts — the object picker and the container browser.
 *
 * "Select Groups" is the dialog behind every Add... button in AD: type part
 * of a name, press Check Names, and it is resolved (and underlined) or you
 * are told it matched nothing or several. Advanced... is the search form for
 * when you do not know the name. The Move dialog is the container tree with
 * +/- boxes. Both are reproduced because they are where the clicks go on the
 * real console, and because "Check Names" is a habit worth building.
 */
import type { OuId } from './shim/domain';
import type { Aduc } from './context';
import { icon } from './icons';
import {
  BUILTIN_OBJECTS,
  CONTAINERS,
  DOMAIN,
  groupRow,
  homeOf,
  userRow,
  type AdObj,
} from './model';
import { button, checkbox, el, listBox, messageBox, openDialog, textbox } from './ui';

export type PickKind = 'user' | 'group';

export interface PickOptions {
  title: string;
  kinds: PickKind[];
  multi?: boolean;
  /** Keys to leave out (the object itself, groups it is already in...). */
  exclude?: Set<string>;
  onOk: (picked: AdObj[]) => void;
}

const typeLabel = (kinds: PickKind[]): string => {
  const parts: string[] = [];
  if (kinds.includes('user')) parts.push('Users');
  if (kinds.includes('group')) parts.push('Groups');
  if (kinds.length === 1 && kinds[0] === 'group') return 'Groups or Built-in security principals';
  return `${parts.join(', ')}, or Built-in security principals`;
};

/** Everything a picker can offer: real accounts and groups, and CN=Users' defaults. */
function candidates(aduc: Aduc, kinds: PickKind[], scope: string): AdObj[] {
  const dir = aduc.dir;
  const inScope = (home: string): boolean => {
    if (scope === 'domain') return true;
    // An OU scope includes everything beneath it.
    for (let k: string | undefined = home; k; ) {
      if (k === scope) return true;
      if (!k.startsWith('ou:')) return false;
      const parent: OuId | undefined = dir.getOu(k.slice(3) as OuId)?.parentId;
      k = parent ? `ou:${parent}` : undefined;
    }
    return false;
  };
  const out: AdObj[] = [];
  if (kinds.includes('user')) out.push(...dir.listUsers().filter((u) => inScope(homeOf(u))).map(userRow));
  if (kinds.includes('group')) {
    out.push(...dir.listGroups().filter((g) => inScope(homeOf(g))).map(groupRow));
    if (scope === 'domain' || scope === 'c:users' || scope === 'c:builtin') {
      const real = new Set(dir.listGroups().map((g) => g.name.toLowerCase()));
      for (const b of BUILTIN_OBJECTS) {
        if (b.kind !== 'group' || real.has(b.name.toLowerCase())) continue;
        if (scope !== 'domain' && `c:${b.container}` !== scope) continue;
        out.push({ key: `b:${b.name}`, kind: 'builtin-group', name: b.name, type: 'Group', description: b.description, icon: 'group', builtin: b });
      }
    }
  }
  return out;
}

function matches(o: AdObj, q: string, exact: boolean): boolean {
  const names = [o.name, o.user?.username, o.user?.email, o.user ? `${o.user.username}@${DOMAIN}` : undefined]
    .filter((s): s is string => !!s)
    .map((s) => s.toLowerCase());
  const want = q.toLowerCase();
  return exact ? names.includes(want) : names.some((n) => n.startsWith(want));
}

const display = (o: AdObj): string => (o.user ? `${o.name} (${o.user.username}@${DOMAIN})` : o.name);

/**
 * Select Users / Select Groups. Resolves names on Check Names and on OK;
 * built-in groups from CN=Users are made real the first time one is picked.
 */
export function selectObjects(aduc: Aduc, opts: PickOptions): void {
  let kinds = [...opts.kinds];
  let scope = 'domain';
  let resolved: AdObj[] | null = null;

  const d = openDialog({ title: opts.title, width: 470, modal: true, owner: aduc.owner });
  const b = d.body;
  b.style.cssText += 'display:flex;flex-direction:column;gap:4px;';

  const typeBox = textbox(typeLabel(kinds), { readOnly: true });
  typeBox.style.flex = '1';
  const locBox = textbox(DOMAIN, { readOnly: true });
  locBox.style.flex = '1';
  const names = document.createElement('textarea');
  names.rows = 4;
  names.style.cssText = 'flex:1;height:78px;';
  names.spellcheck = false;

  const line = (...c: HTMLElement[]): HTMLElement => {
    const r = el('div');
    r.style.cssText = 'display:flex;gap:10px;align-items:flex-start;';
    r.append(...c);
    return r;
  };

  const objTypesBtn = button('Object Types...', () => {
    const t = openDialog({ title: 'Object Types', width: 340, modal: true, owner: aduc.owner });
    t.body.appendChild(el('div', undefined, 'Select the types of objects you want to find.'));
    const box = el('div', 'ad-lb');
    box.style.cssText += 'height:120px;padding:4px;margin-top:6px;';
    const u = checkbox('Users', kinds.includes('user'));
    const g = checkbox('Groups', kinds.includes('group'));
    const bsp = checkbox('Built-in security principals', true);
    bsp.setDisabled(true);
    if (!opts.kinds.includes('user')) u.setDisabled(true);
    if (!opts.kinds.includes('group')) g.setDisabled(true);
    box.append(bsp.el, g.el, u.el);
    t.body.appendChild(box);
    const ok = button('OK', () => {
      const next: PickKind[] = [];
      if (u.checked && opts.kinds.includes('user')) next.push('user');
      if (g.checked && opts.kinds.includes('group')) next.push('group');
      if (next.length) {
        kinds = next;
        typeBox.value = typeLabel(kinds);
      }
      t.close();
    }, { primary: true });
    t.foot.style.display = 'flex';
    t.foot.append(ok, button('Cancel', () => t.close()));
    t.buttons.push(ok);
  }, { width: '110px' });

  const locBtn = button('Locations...', () => {
    browseContainer(aduc, {
      title: 'Locations',
      prompt: 'Select the location you want to search.',
      allowDomain: true,
      onOk: (key) => {
        scope = key;
        locBox.value = key === 'domain' ? DOMAIN : key.startsWith('ou:') ? `${DOMAIN}/${aduc.dir.ouPath(key.slice(3) as OuId)}` : `${DOMAIN}/${CONTAINERS.find((c) => `c:${c.id}` === key)?.name ?? ''}`;
      },
    });
  }, { width: '110px' });

  const checkBtn = button('Check Names', () => void checkNames(), { width: '110px' });
  checkBtn.disabled = true;

  b.append(
    el('label', undefined, 'Select this object type:'),
    line(typeBox, objTypesBtn),
    el('label', undefined, 'From this location:'),
    line(locBox, locBtn),
  );
  const ex = el('div');
  ex.appendChild(document.createTextNode('Enter the object name' + (opts.multi === false ? '' : 's') + ' to select ('));
  const exLink = el('span', 'ad-link', 'examples');
  exLink.addEventListener('click', () =>
    messageBox(
      'Examples:\n\nDisplayName\t\tFirstName LastName\nObjectName\t\tUser1; Group2\nUserName\t\tlogon1\nObjectName@Domain\tuser1@' + DOMAIN +
        '\n\nPart of a name also works: type the start of it and click Check Names.',
      { title: 'Examples', kind: 'info' },
    ),
  );
  ex.append(exLink, document.createTextNode('):'));
  b.append(ex, line(names, checkBtn));

  names.addEventListener('input', () => {
    resolved = null;
    names.style.textDecoration = '';
    checkBtn.disabled = !names.value.trim();
    okBtn.disabled = !names.value.trim();
  });

  /** Resolve every ;-separated entry. Returns false if any could not be. */
  const checkNames = async (): Promise<boolean> => {
    const tokens = names.value.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
    const pool = candidates(aduc, kinds, scope).filter((o) => !opts.exclude?.has(o.key));
    const out: AdObj[] = [];
    for (const tok of tokens) {
      // Already-resolved text, "Name (user@domain)", resolves to itself.
      const bare = tok.replace(/\s*\([^)]*@[^)]*\)\s*$/, '');
      let hits = pool.filter((o) => matches(o, bare, true));
      if (hits.length === 0) hits = pool.filter((o) => matches(o, bare, false));
      if (hits.length === 0) {
        await new Promise<void>((done) => {
          const m = messageBox(
            `An object named "${bare}" cannot be found. Check the selected object types and location for accuracy and ensure that you typed the object name correctly, or remove this object from the selection.`,
            { title: 'Name Not Found', kind: 'warning' },
          );
          m.onClose = done;
        });
        return false;
      }
      if (hits.length > 1) {
        const pick = await chooseOne(aduc, bare, hits);
        if (!pick) return false;
        hits = [pick];
      }
      if (!out.some((o) => o.key === hits[0]!.key)) out.push(hits[0]!);
    }
    if (opts.multi === false && out.length > 1) {
      messageBox('Only one object can be selected here.', { kind: 'warning' });
      return false;
    }
    resolved = out;
    names.value = out.map(display).join('; ');
    names.style.textDecoration = 'underline';
    return out.length > 0;
  };

  const advBtn = button('Advanced...', () => {
    advancedSearch(aduc, kinds, scope, opts, (picked) => {
      const existing = names.value.trim();
      names.value = [existing, ...picked.map(display)].filter(Boolean).join('; ');
      names.dispatchEvent(new Event('input'));
      void checkNames();
    });
  }, { width: '90px' });

  const okBtn = button('OK', () => {
    void (async () => {
      if (!resolved && !(await checkNames())) return;
      const picked = resolved ?? [];
      d.close();
      opts.onOk(picked);
    })();
  }, { primary: true, disabled: true });
  const cancelBtn = button('Cancel', () => d.close());
  d.buttons.push(okBtn, cancelBtn);
  d.foot.style.display = 'flex';
  d.foot.style.justifyContent = 'space-between';
  const right = el('div');
  right.style.cssText = 'display:flex;gap:8px;';
  right.append(okBtn, cancelBtn);
  d.foot.append(advBtn, right);
  queueMicrotask(() => names.focus());
}

function chooseOne(aduc: Aduc, typed: string, hits: AdObj[]): Promise<AdObj | null> {
  return new Promise((resolve) => {
    let chosen: AdObj | null = null;
    const d = openDialog({
      title: 'Multiple Names Found',
      width: 440,
      modal: true,
      owner: aduc.owner,
      buttons: [
        { label: 'OK', primary: true, onClick: () => (chosen ? undefined : false) },
        { label: 'Cancel', cancel: true, onClick: () => void (chosen = null) },
      ],
    });
    d.body.appendChild(el('div', undefined, `More than one object matched the name "${typed}". Select one or more names from this list, or, reenter the name.`));
    const lb = listBox<AdObj>(
      [
        { label: 'Name', render: (o) => o.name, iconOf: (o) => o.icon, width: '45%' },
        { label: 'E-Mail Address', render: (o) => o.user?.email ?? '' },
        { label: 'In Folder', render: (o) => (o.user ? locationOf(aduc, homeOf(o.user)) : o.group ? locationOf(aduc, homeOf(o.group)) : `${DOMAIN}/Users`) },
      ],
      { height: '160px', onOpen: (o) => { chosen = o; d.buttons[0]!.click(); } },
    );
    lb.onSelect = (rows) => (chosen = rows[0] ?? null);
    lb.setRows(hits);
    lb.el.style.marginTop = '8px';
    d.body.appendChild(lb.el);
    d.onClose = () => resolve(chosen);
  });
}

function locationOf(aduc: Aduc, home: string): string {
  return home.startsWith('ou:') ? `${DOMAIN}/${aduc.dir.ouPath(home.slice(3) as OuId)}` : `${DOMAIN}/Users`;
}

function advancedSearch(aduc: Aduc, kinds: PickKind[], scope: string, opts: PickOptions, onPick: (o: AdObj[]) => void): void {
  let picked: AdObj[] = [];
  const d = openDialog({
    title: opts.title,
    width: 560,
    modal: true,
    owner: aduc.owner,
    buttons: [
      { label: 'OK', primary: true, onClick: () => { if (picked.length) onPick(picked); } },
      { label: 'Cancel', cancel: true },
    ],
  });
  const fs = el('fieldset', 'ad-fs');
  fs.appendChild(el('legend', undefined, 'Common Queries'));
  const nameMode = document.createElement('select');
  for (const m of ['Starts with', 'Is exactly']) nameMode.appendChild(new Option(m, m));
  const nameBox = textbox('');
  const descBox = textbox('');
  const disabled = checkbox('Disabled accounts', false);
  const noExpire = checkbox('Non expiring password', false);
  const g = el('div', 'ad-grid');
  g.style.gridTemplateColumns = '80px 110px 1fr 90px';
  const findBtn = button('Find Now', () => run(), { primary: true, width: '90px' });
  g.append(el('label', undefined, 'Name:'), nameMode, nameBox, findBtn, el('label', undefined, 'Description:'), el('span'), descBox, el('span'));
  const opts2 = el('div');
  opts2.style.cssText = 'display:flex;gap:18px;margin-top:6px;';
  opts2.append(disabled.el, noExpire.el);
  fs.append(g, opts2);
  d.body.appendChild(fs);

  d.body.appendChild(css(el('div', undefined, 'Search results:'), 'margin:8px 0 3px;'));
  const lb = listBox<AdObj>(
    [
      { label: 'Name', render: (o) => o.name, iconOf: (o) => o.icon, width: '38%' },
      { label: 'E-Mail Address', render: (o) => o.user?.email ?? '' },
      { label: 'Description', render: (o) => o.description },
      { label: 'In Folder', render: (o) => (o.user ? locationOf(aduc, homeOf(o.user)) : o.group ? locationOf(aduc, homeOf(o.group)) : `${DOMAIN}/Users`) },
    ],
    { height: '190px', multi: opts.multi !== false, onOpen: (o) => { picked = [o]; d.buttons[0]!.click(); } },
  );
  lb.onSelect = (rows) => (picked = rows);
  d.body.appendChild(lb.el);

  const run = (): void => {
    const q = nameBox.value.trim().toLowerCase();
    const dq = descBox.value.trim().toLowerCase();
    const rows = candidates(aduc, kinds, scope).filter((o) => {
      if (opts.exclude?.has(o.key)) return false;
      if (q) {
        const n = o.name.toLowerCase();
        const sam = o.user?.username.toLowerCase() ?? '';
        const hit = nameMode.value === 'Is exactly' ? n === q || sam === q : n.startsWith(q) || sam.startsWith(q);
        if (!hit) return false;
      }
      if (dq && !o.description.toLowerCase().startsWith(dq)) return false;
      if (disabled.checked && o.user?.status !== 'disabled') return false;
      if (noExpire.checked && o.user?.attrs?.PasswordNeverExpires !== 'TRUE') return false;
      return true;
    });
    lb.setRows(rows.sort((a, b2) => a.name.localeCompare(b2.name)));
  };
  run();
}

function css(e: HTMLElement, s: string): HTMLElement {
  e.style.cssText += s;
  return e;
}

// ---------------------------------------------------------------------------
// Container browser (Move..., Locations..., Browse...)
// ---------------------------------------------------------------------------

export function browseContainer(
  aduc: Aduc,
  opts: {
    title: string;
    prompt: string;
    /** May the domain itself be chosen? (Locations and moving an OU: yes. Moving an account: no.) */
    allowDomain?: boolean;
    /** Allow OUs only (moving an OU cannot target a plain container). */
    ousOnly?: boolean;
    /** Keys that may not be chosen (an OU cannot move into itself). */
    forbid?: (key: string) => boolean;
    initial?: string;
    onOk: (key: string) => void;
  },
): void {
  let chosen: string | null = opts.initial ?? null;
  const expanded = new Set<string>(['domain']);
  const d = openDialog({
    title: opts.title,
    width: 380,
    modal: true,
    owner: aduc.owner,
    buttons: [
      {
        label: 'OK',
        primary: true,
        onClick: () => {
          if (!chosen) return false;
          if (chosen === 'domain' && !opts.allowDomain) {
            messageBox('Objects cannot be moved directly into the domain in this lab. Choose an organizational unit or the Users container.', { kind: 'warning' });
            return false;
          }
          if (opts.forbid?.(chosen)) {
            messageBox('The object cannot be moved into that container.', { kind: 'error' });
            return false;
          }
          opts.onOk(chosen);
        },
      },
      { label: 'Cancel', cancel: true },
    ],
  });
  d.body.appendChild(css(el('div', undefined, opts.prompt), 'margin-bottom:6px;'));
  const tree = el('div', 'ad-lb');
  tree.style.cssText += 'height:250px;padding:3px 2px;';
  tree.tabIndex = 0;
  d.body.appendChild(tree);

  const kids = (key: string): { key: string; name: string; iconName: 'ou' | 'container' }[] => {
    if (key === 'domain') {
      const cs = CONTAINERS.filter((c) => !c.advanced && (!opts.ousOnly || c.id === 'dcs'))
        .filter((c) => ['builtin', 'computers', 'dcs', 'fsp', 'msa', 'users'].includes(c.id))
        .map((c) => ({ key: `c:${c.id}`, name: c.name, iconName: c.icon as 'ou' | 'container' }));
      const os = aduc.dir.childOus(undefined).map((o) => ({ key: `ou:${o.id}`, name: o.name, iconName: 'ou' as const }));
      return [...cs, ...os].sort((a, b2) => a.name.localeCompare(b2.name));
    }
    if (key.startsWith('ou:')) {
      return aduc.dir.childOus(key.slice(3) as OuId).map((o) => ({ key: `ou:${o.id}`, name: o.name, iconName: 'ou' as const }))
        .sort((a, b2) => a.name.localeCompare(b2.name));
    }
    return [];
  };

  const paint = (): void => {
    tree.textContent = '';
    const draw = (key: string, name: string, iconName: 'domain' | 'ou' | 'container', depth: number): void => {
      const children = kids(key);
      const row = el('div');
      row.style.cssText = `display:flex;align-items:center;gap:3px;height:19px;padding-left:${depth * 18}px;white-space:nowrap;`;
      const box = el('span');
      box.style.cssText =
        'width:9px;height:9px;border:1px solid #919191;position:relative;flex-shrink:0;' +
        'background:#fff;margin:0 3px;' + (children.length ? '' : 'visibility:hidden;');
      // The classic tree box: a minus, plus a vertical bar when collapsed.
      const bar = (v: boolean): HTMLElement => {
        const b = el('span');
        b.style.cssText = v
          ? 'position:absolute;left:3px;top:1px;width:1px;height:5px;background:#333;'
          : 'position:absolute;left:1px;top:3px;width:5px;height:1px;background:#333;';
        return b;
      };
      box.appendChild(bar(false));
      if (!expanded.has(key)) box.appendChild(bar(true));
      box.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (expanded.has(key)) expanded.delete(key);
        else expanded.add(key);
        paint();
      });
      const label = el('span', undefined, name);
      label.style.cssText = 'padding:0 2px;' + (chosen === key ? 'background:#0078d7;color:#fff;' : '');
      row.append(box, icon(iconName), label);
      row.addEventListener('mousedown', () => {
        chosen = key;
        paint();
      });
      row.addEventListener('dblclick', () => {
        if (expanded.has(key)) expanded.delete(key);
        else expanded.add(key);
        paint();
      });
      tree.appendChild(row);
      if (expanded.has(key)) for (const c of children) draw(c.key, c.name, c.iconName, depth + 1);
    };
    draw('domain', DOMAIN, 'domain', 0);
  };
  // Open the tree down to the current location.
  if (opts.initial?.startsWith('ou:')) {
    for (let k: string | undefined = opts.initial; k?.startsWith('ou:'); ) {
      const p: OuId | undefined = aduc.dir.getOu(k.slice(3) as OuId)?.parentId;
      k = p ? `ou:${p}` : undefined;
      if (k) expanded.add(k);
    }
  }
  paint();
}
