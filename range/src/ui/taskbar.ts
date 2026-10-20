/**
 * ui/taskbar.ts — the Windows 11 system tray flyouts: the notification centre
 * with its calendar (date/time), Quick Settings (network, volume, brightness
 * and toggles), and the hidden icons overflow. Each control changes the real
 * setting in ui/system.ts, so the tray, Settings and the flyouts agree.
 */
import { clear, h } from './dom.ts';
import { persist, store } from './store.ts';
import { ai } from './aiState.ts';
import { appearance, applyAppearance } from './theme.ts';
import { applySystem, fmtDate, fmtTime, markNotificationsRead, notifications, setSys, sys, zonedParts } from './system.ts';

let current: { el: HTMLElement; kind: string; dispose: () => void } | null = null;

export function closeFlyout(): void {
  current?.dispose();
  current?.el.remove();
  current = null;
}

function open(kind: string, el: HTMLElement, dispose: () => void = () => {}): void {
  const same = current?.kind === kind;
  closeFlyout();
  if (same) return;
  document.querySelector('.workstation')?.appendChild(el);
  current = { el, kind, dispose };
}

let installed = false;
function install(): void {
  if (installed) return;
  installed = true;
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    if (current && !current.el.contains(t) && !t.closest('.tray')) closeFlyout();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFlyout(); });
}

// ---------------------------------------------------------------- notification centre and calendar

export interface CalendarHooks {
  openSettings(page: string): void;
  openUrl(url: string): void;
}

export function toggleCalendar(hooks: CalendarHooks): void {
  install();
  const now = new Date();
  const today = zonedParts(now);
  let view = { y: today.y, m: today.m };
  let picked = today.day;
  const el = h('div', { class: 'fly fly-cal', role: 'dialog', 'aria-label': 'Notification centre and calendar' });
  const notes = h('section', { class: 'fly-card fly-notes' });
  const cal = h('section', { class: 'fly-card fly-calendar' });

  const drawNotes = (): void => {
    clear(notes);
    const s = sys();
    notes.append(
      h('div', { class: 'fly-head' }, h('strong', null, 'Notifications'),
        notifications.length ? h('button', { class: 'fly-link', type: 'button', onClick: () => { notifications.length = 0; markNotificationsRead(); drawNotes(); } }, 'Clear all') : null),
      notifications.length
        ? h('div', { class: 'fly-note-list' }, notifications.slice(0, 12).map((n) => h('div', { class: `fly-note ${n.kind}` }, h('span', { class: 'fly-note-app' }, n.kind === 'err' ? 'Error' : store.world.company.name, h('span', null, fmtTime(new Date(n.time), { seconds: false }))), h('span', null, n.text))))
        : h('p', { class: 'fly-empty' }, 'No new notifications'),
      h('div', { class: 'fly-focus' },
        h('span', null, s.doNotDisturb ? 'Do not disturb is on' : 'Focus'),
        h('button', { class: `fly-pill ${s.doNotDisturb ? 'on' : ''}`, type: 'button', onClick: () => { setSys({ doNotDisturb: !sys().doNotDisturb }); drawNotes(); } }, s.doNotDisturb ? 'Turn off' : 'Do not disturb')));
    markNotificationsRead();
  };

  const drawCal = (): void => {
    clear(cal);
    const s = sys();
    const first = new Date(Date.UTC(view.y, view.m, 1));
    const startDay = first.getUTCDay();
    const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
    const monthName = first.toLocaleDateString(s.region, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const weekNames = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2024, 0, 7 + i)).toLocaleDateString(s.region, { weekday: 'narrow', timeZone: 'UTC' }));
    const due = new Map<number, string[]>();
    for (const t of store.world.tickets) {
      if (!t.slaDue || ['Resolved', 'Cancelled'].includes(t.state)) continue;
      const p = zonedParts(new Date(t.slaDue));
      if (p.y === view.y && p.m === view.m) due.set(p.day, [...(due.get(p.day) ?? []), `${t.id}: ${t.short}`]);
    }
    const cells: HTMLElement[] = [];
    for (let i = 0; i < startDay; i++) cells.push(h('span', { class: 'cal-blank' }));
    for (let d = 1; d <= days; d++) {
      const isToday = view.y === today.y && view.m === today.m && d === today.day;
      cells.push(h('button', { class: `cal-day ${isToday ? 'today' : ''} ${d === picked ? 'picked' : ''} ${due.has(d) ? 'has' : ''}`, type: 'button', 'aria-label': `${d}${due.has(d) ? `, ${due.get(d)!.length} ticket(s) due` : ''}`, onClick: () => { picked = d; drawCal(); } }, String(d)));
    }
    const agenda = due.get(picked) ?? [];
    const pickedDate = new Date(Date.UTC(view.y, view.m, picked, 12));
    cal.append(
      h('div', { class: 'fly-head' }, h('strong', null, fmtDate(now, 'full'))),
      h('div', { class: 'cal-nav' },
        h('span', { class: 'cal-month' }, monthName),
        h('button', { class: 'fly-ib', type: 'button', 'aria-label': 'Previous month', onClick: () => { view = view.m === 0 ? { y: view.y - 1, m: 11 } : { y: view.y, m: view.m - 1 }; picked = 1; drawCal(); } }, ''),
        h('button', { class: 'fly-ib', type: 'button', 'aria-label': 'Next month', onClick: () => { view = view.m === 11 ? { y: view.y + 1, m: 0 } : { y: view.y, m: view.m + 1 }; picked = 1; drawCal(); } }, '')),
      h('div', { class: 'cal-grid' }, ...weekNames.map((w) => h('span', { class: 'cal-wk' }, w)), ...cells),
      h('div', { class: 'cal-agenda' },
        h('div', { class: 'cal-agenda-day' }, pickedDate.toLocaleDateString(s.region, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })),
        agenda.length
          ? agenda.map((a) => h('button', { class: 'cal-event', type: 'button', onClick: () => { closeFlyout(); hooks.openUrl(`https://servicedesk.meridianhealth.test/ticket/${a.split(':')[0]}`); } }, h('span', { class: 'cal-dot' }), h('span', null, 'SLA due: ', a)))
          : h('p', { class: 'fly-empty' }, 'No tickets due'),
        h('button', { class: 'fly-link', type: 'button', onClick: () => { closeFlyout(); hooks.openSettings('time'); } }, 'Date and time settings')));
  };

  el.append(notes, cal);
  drawNotes();
  drawCal();
  const tick = window.setInterval(() => { if (!el.isConnected) clearInterval(tick); }, 30_000);
  open('calendar', el, () => clearInterval(tick));
}

// ---------------------------------------------------------------- Quick Settings

export function toggleQuickSettings(hooks: CalendarHooks, onChange: () => void): void {
  install();
  const el = h('div', { class: 'fly fly-qs', role: 'dialog', 'aria-label': 'Quick settings' });
  const draw = (): void => {
    clear(el);
    const s = sys();
    const a = appearance();
    const vpn = s.vpn[0];
    const tile = (icon: string, label: string, on: boolean, fn: () => void, sub = ''): HTMLElement =>
      h('button', { class: `qs-tile ${on ? 'on' : ''}`, type: 'button', 'aria-pressed': String(on), onClick: () => { fn(); draw(); onChange(); } },
        h('span', { class: 'mdl' }, icon), h('span', { class: 'qs-label' }, label, sub ? h('small', null, sub) : null));
    const slider = (icon: string, value: number, min: number, label: string, fn: (v: number) => void, iconFn?: () => void): HTMLElement =>
      h('div', { class: 'qs-slider' },
        h('button', { class: 'fly-ib', type: 'button', 'aria-label': label, onClick: () => { iconFn?.(); draw(); onChange(); } }, icon),
        h('input', { type: 'range', min: String(min), max: '100', value: String(value), 'aria-label': label, onInput: (e: Event) => { fn(Number((e.target as HTMLInputElement).value)); onChange(); } }),
        h('span', { class: 'qs-val' }, String(value)));
    el.append(
      h('div', { class: 'qs-grid' },
        tile(s.airplane ? '' : '', s.airplane ? 'No internet' : 'Ethernet', !s.airplane, () => setSys({ airplane: !s.airplane }), s.airplane ? '' : 'MERIDIAN-CORP'),
        tile('', 'Bluetooth', s.bluetooth, () => setSys({ bluetooth: !s.bluetooth }), s.bluetooth ? 'Not connected' : ''),
        tile('', 'Airplane mode', s.airplane, () => setSys({ airplane: !s.airplane })),
        tile('', 'VPN', !!vpn?.connected, () => { if (vpn) setSys({ vpn: [{ ...vpn, connected: !vpn.connected }, ...s.vpn.slice(1)] }); else { closeFlyout(); hooks.openSettings('network'); } }, vpn ? vpn.name : 'Not set up'),
        tile('', 'Night light', !!store.settings.nightLight, () => { store.settings.nightLight = !store.settings.nightLight; persist(); applySystem(); }),
        tile('', 'Dark mode', a.mode === 'dark', () => { store.settings.appearance = { ...(store.settings.appearance ?? {}), mode: a.mode === 'dark' ? 'light' : 'dark' }; persist(); applyAppearance(); }),
        tile('', 'Do not disturb', s.doNotDisturb, () => setSys({ doNotDisturb: !s.doNotDisturb })),
        tile('', 'Accessibility', s.contrast, () => setSys({ contrast: !s.contrast }), s.contrast ? 'Contrast' : '')),
      slider('', s.brightness, 20, 'Brightness', (v) => setSys({ brightness: v })),
      slider(s.muted || s.volume === 0 ? '' : s.volume < 34 ? '' : s.volume < 67 ? '' : '', s.volume, 0, s.muted ? 'Unmute' : 'Mute', (v) => setSys({ volume: v, muted: false }), () => setSys({ muted: !s.muted })),
      h('div', { class: 'qs-foot' },
        h('span', null, h('span', { class: 'mdl' }, ''), ' Plugged in'),
        h('button', { class: 'fly-ib', type: 'button', 'aria-label': 'All settings', title: 'All settings', onClick: () => { closeFlyout(); hooks.openSettings('home'); } }, '')));
  };
  draw();
  open('quick', el);
}

// ---------------------------------------------------------------- hidden icons

export function toggleHiddenIcons(items: { icon: string; title: string; dim?: boolean; onClick: () => void }[]): void {
  install();
  const el = h('div', { class: 'fly fly-hidden', role: 'dialog', 'aria-label': 'Hidden icons' },
    items.map((i) => h('button', { class: 'fly-ib big', type: 'button', title: i.title, 'aria-label': i.title, onClick: () => { closeFlyout(); i.onClick(); } }, h('span', { class: `mdl ${i.dim ? 'dim' : ''}` }, i.icon))));
  open('hidden', el);
}

export function trayVolumeIcon(): string {
  const s = sys();
  return s.muted || s.volume === 0 ? '' : s.volume < 34 ? '' : s.volume < 67 ? '' : '';
}

export function aiTitle(): string {
  return !sys().localAi ? 'Local AI turned off in Privacy & security' : ai.status === 'online' ? `Ollama (local AI): ${ai.model}` : 'Ollama (local AI): not running';
}
