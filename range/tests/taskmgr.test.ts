import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SERVICES, pidFor, processes, sortProcs, totals } from '../src/core/taskmgr.ts';
import { DEFAULT_TASKBAR, resolveTaskbar, showLabels, trayPlacement } from '../src/core/taskbar.ts';

const WINS = [
  { id: 'win-1', appId: 'browser', title: 'ServiceDesk - Google Chrome', minimized: false },
  { id: 'win-2', appId: 'aduc', title: 'Active Directory Users and Computers', minimized: true },
  { id: 'win-3', appId: 'terminal', title: 'Windows PowerShell', minimized: false },
];
const base = { windows: WINS, aiOnline: false, online: true, tick: 7, user: 'MERIDIAN\admin' };

test('every open window is an app process tied to that window', () => {
  const apps = processes(base).filter((p) => p.group === 'app');
  assert.equal(apps.length, 3);
  assert.deepEqual(apps.map((p) => p.winId), ['win-1', 'win-2', 'win-3']);
  assert.equal(apps[0]!.exe, 'chrome.exe');
  assert.equal(apps[1]!.exe, 'mmc.exe');
  assert.ok(apps.every((p) => p.user === 'MERIDIAN\admin' && !p.critical));
});

test('PIDs are unique multiples of 4 and stable for a window', () => {
  const procs = processes(base);
  assert.equal(new Set(procs.map((p) => p.pid)).size, procs.length);
  assert.ok(procs.every((p) => p.pid % 4 === 0));
  assert.equal(pidFor('win-1'), pidFor('win-1'));
  assert.equal(processes({ ...base, tick: 99 }).find((p) => p.winId === 'win-1')!.pid, procs.find((p) => p.winId === 'win-1')!.pid);
});

test('usage is never negative, at any tick', () => {
  for (let tick = 0; tick < 500; tick++) for (const p of processes({ ...base, aiOnline: true, tick })) assert.ok(p.cpu >= 0 && p.memMb > 0 && p.diskMbs >= 0 && p.netMbps >= 0, `${p.exe} at tick ${tick}: ${p.cpu}`);
});

test('usage is repeatable for a tick and moves between ticks', () => {
  assert.deepEqual(processes(base), processes(base));
  const a = totals(processes(base)), b = totals(processes({ ...base, tick: 8 }));
  assert.notEqual(a.cpu, b.cpu);
  assert.ok(a.cpu >= 0 && a.cpu <= 100);
  assert.ok(a.memPct > 20 && a.memPct < 60, `memory ${a.memPct}%`);
});

test('Ollama appears only while the local AI answers; no network use offline', () => {
  assert.ok(!processes(base).some((p) => p.exe === 'ollama.exe'));
  assert.ok(processes({ ...base, aiOnline: true }).some((p) => p.exe === 'ollama.exe'));
  assert.equal(totals(processes({ ...base, online: false })).netMbps, 0);
});

test('closing a window removes its process; system processes are protected', () => {
  const after = processes({ ...base, windows: WINS.filter((w) => w.id !== 'win-3') });
  assert.ok(!after.some((p) => p.winId === 'win-3'));
  for (const exe of ['lsass.exe', 'csrss.exe', 'winlogon.exe', 'MsMpEng.exe']) assert.ok(after.find((p) => p.exe === exe)!.critical, exe);
});

test('efficiency mode lowers a process and shows in its status', () => {
  const pid = pidFor('win-1');
  const sum = (eff: boolean): number => Array.from({ length: 50 }, (_, t) => processes({ ...base, tick: t, efficiency: eff ? new Set([pid]) : undefined }).find((p) => p.pid === pid)!.cpu).reduce((a, b) => a + b, 0);
  assert.ok(sum(true) < sum(false) * 0.5);
  assert.equal(processes({ ...base, efficiency: new Set([pid]) }).find((p) => p.pid === pid)!.status, 'Efficiency mode');
});

test('sorting by a column', () => {
  const byMem = sortProcs(processes(base), 'memMb', true);
  for (let i = 1; i < byMem.length; i++) assert.ok(byMem[i - 1]!.memMb >= byMem[i]!.memMb);
  const byName = sortProcs(processes(base), 'name', false);
  assert.ok(byName[0]!.name.localeCompare(byName[1]!.name) <= 0);
});

test('services: the domain ones a workstation needs are running', () => {
  for (const n of ['Netlogon', 'W32Time', 'Dnscache', 'WinDefend']) assert.equal(SERVICES.find((s) => s.name === n)!.status, 'Running', n);
  assert.ok(SERVICES.filter((s) => s.status === 'Stopped').every((s) => s.pid === null));
});

test('taskbar prefs: defaults, migration of the old search switch, saved values win', () => {
  assert.deepEqual(resolveTaskbar(undefined), DEFAULT_TASKBAR);
  assert.equal(resolveTaskbar(undefined, false).search, 'hide');
  assert.equal(resolveTaskbar({ search: 'box' }, false).search, 'box');
  assert.equal(resolveTaskbar({ trayIcons: { vpn: true } as never }).trayIcons.security, false);
});

test('tray placement follows the per-icon switches and the hidden icon menu', () => {
  const p = resolveTaskbar({ trayIcons: { ai: false, security: true, vpn: true, bluetooth: false, update: false } });
  assert.deepEqual(trayPlacement(p).shown, ['security', 'vpn']);
  assert.deepEqual(trayPlacement(p).hidden, ['ai', 'bluetooth', 'update']);
  assert.equal(trayPlacement(p).chevron, true);
  const all = trayPlacement({ ...p, hiddenIconMenu: false });
  assert.equal(all.hidden.length, 0);
  assert.equal(all.chevron, false);
});

test('labels on taskbar buttons follow "Combine taskbar buttons and hide labels"', () => {
  assert.equal(showLabels('always', 2), false);
  assert.equal(showLabels('never', 30), true);
  assert.equal(showLabels('whenFull', 4), true);
  assert.equal(showLabels('whenFull', 12), false);
});
