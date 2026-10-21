/**
 * core/taskmgr.ts — what Task Manager shows for the workstation.
 *
 * Apps are the real windows open on the desktop, so ending one closes it.
 * Background and Windows processes are what an IAM workstation on a domain
 * runs (Defender, the Okta Verify and Entra sign-in brokers, Ollama when the
 * local AI answers). Usage figures are generated from a tick and the PID, so
 * they move like live counters but are the same for the same tick, which keeps
 * the model testable. Pure: no DOM, no clock.
 */

export interface OpenWindow {
  id: string;
  appId: string;
  title: string;
  minimized: boolean;
}

export type ProcGroup = 'app' | 'background' | 'windows';

export interface Proc {
  pid: number;
  name: string;
  exe: string;
  description: string;
  publisher: string;
  group: ProcGroup;
  user: string;
  status: 'Running' | 'Suspended' | 'Efficiency mode';
  cpu: number;
  memMb: number;
  diskMbs: number;
  netMbps: number;
  /** The desktop window behind an app process. */
  winId?: string;
  /** Windows will not end it (Access is denied) or ending it would stop the session. */
  critical: boolean;
}

interface Image { exe: string; name: string; description: string; publisher: string; baseMb: number; cpu: number }

const MS = 'Microsoft Corporation';

/** Each app's executable, as Task Manager names it. */
export const APP_IMAGES: Record<string, Image> = {
  browser: { exe: 'chrome.exe', name: 'Google Chrome', description: 'Google Chrome', publisher: 'Google LLC', baseMb: 410, cpu: 3 },
  aduc: { exe: 'mmc.exe', name: 'Active Directory Users and Computers', description: 'Microsoft Management Console', publisher: MS, baseMb: 38, cpu: 0.6 },
  eventviewer: { exe: 'mmc.exe', name: 'Event Viewer', description: 'Microsoft Management Console', publisher: MS, baseMb: 44, cpu: 0.6 },
  terminal: { exe: 'WindowsTerminal.exe', name: 'Terminal', description: 'Windows Terminal', publisher: MS, baseMb: 96, cpu: 0.8 },
  powershell: { exe: 'powershell.exe', name: 'Windows PowerShell', description: 'Windows PowerShell', publisher: MS, baseMb: 72, cpu: 0.5 },
  ise: { exe: 'powershell_ise.exe', name: 'Windows PowerShell ISE', description: 'Windows PowerShell ISE', publisher: MS, baseMb: 140, cpu: 0.7 },
  rdp: { exe: 'mstsc.exe', name: 'Remote Desktop Connection', description: 'Remote Desktop Connection', publisher: MS, baseMb: 64, cpu: 1.2 },
  explorer: { exe: 'explorer.exe', name: 'File Explorer', description: 'Windows Explorer', publisher: MS, baseMb: 52, cpu: 0.4 },
  notepad: { exe: 'Notepad.exe', name: 'Notepad', description: 'Notepad', publisher: MS, baseMb: 24, cpu: 0.1 },
  control: { exe: 'control.exe', name: 'Control Panel', description: 'Windows Control Panel', publisher: MS, baseMb: 30, cpu: 0.2 },
  settings: { exe: 'SystemSettings.exe', name: 'Settings', description: 'Settings', publisher: MS, baseMb: 58, cpu: 0.3 },
  security: { exe: 'SecHealthUI.exe', name: 'Windows Security', description: 'Windows Security', publisher: MS, baseMb: 46, cpu: 0.2 },
  coach: { exe: 'IAMCoach.exe', name: 'IAM Coach', description: 'IAM Coach', publisher: 'Meridian Health System', baseMb: 88, cpu: 0.6 },
  career: { exe: 'IAMCoach.exe', name: 'Career Record', description: 'IAM Coach', publisher: 'Meridian Health System', baseMb: 40, cpu: 0.2 },
  word: { exe: 'WINWORD.EXE', name: 'Word', description: 'Microsoft Word', publisher: MS, baseMb: 180, cpu: 0.6 },
  excel: { exe: 'EXCEL.EXE', name: 'Excel', description: 'Microsoft Excel', publisher: MS, baseMb: 170, cpu: 0.6 },
  powerpoint: { exe: 'POWERPNT.EXE', name: 'PowerPoint', description: 'Microsoft PowerPoint', publisher: MS, baseMb: 190, cpu: 0.6 },
  stickynotes: { exe: 'Microsoft.Notes.exe', name: 'Sticky Notes', description: 'Microsoft Sticky Notes', publisher: MS, baseMb: 34, cpu: 0.1 },
  taskmgr: { exe: 'Taskmgr.exe', name: 'Task Manager', description: 'Task Manager', publisher: MS, baseMb: 36, cpu: 1.1 },
};

function imageFor(appId: string, title: string): Image {
  return APP_IMAGES[appId] ?? { exe: `${appId}.exe`, name: title, description: title, publisher: '', baseMb: 40, cpu: 0.3 };
}

type Fixed = Omit<Image, 'baseMb' | 'cpu'> & { pid: number; group: Exclude<ProcGroup, 'app'>; user: string; baseMb: number; cpu: number; critical: boolean; disk?: number; net?: number };

const SYSTEM = 'SYSTEM';
const LOCAL = 'LOCAL SERVICE';
const NET = 'NETWORK SERVICE';

function fixedProcs(user: string): Fixed[] {
  return [
    { pid: 4, exe: 'System', name: 'System', description: 'NT Kernel & System', publisher: MS, group: 'windows', user: SYSTEM, baseMb: 0.1, cpu: 0.4, critical: true, disk: 0.1 },
    { pid: 140, exe: 'Registry', name: 'Registry', description: 'NT Kernel & System', publisher: MS, group: 'windows', user: SYSTEM, baseMb: 12, cpu: 0, critical: true },
    { pid: 512, exe: 'smss.exe', name: 'Windows Session Manager', description: 'Windows Session Manager', publisher: MS, group: 'windows', user: SYSTEM, baseMb: 0.4, cpu: 0, critical: true },
    { pid: 724, exe: 'csrss.exe', name: 'Client Server Runtime Process', description: 'Client Server Runtime Process', publisher: MS, group: 'windows', user: SYSTEM, baseMb: 1.4, cpu: 0.1, critical: true },
    { pid: 812, exe: 'wininit.exe', name: 'Windows Start-Up Application', description: 'Windows Start-Up Application', publisher: MS, group: 'windows', user: SYSTEM, baseMb: 1.1, cpu: 0, critical: true },
    { pid: 880, exe: 'services.exe', name: 'Services and Controller app', description: 'Services and Controller app', publisher: MS, group: 'windows', user: SYSTEM, baseMb: 5.6, cpu: 0.1, critical: true },
    { pid: 896, exe: 'lsass.exe', name: 'Local Security Authority Process', description: 'Local Security Authority Process', publisher: MS, group: 'windows', user: SYSTEM, baseMb: 9.8, cpu: 0.2, critical: true },
    { pid: 1012, exe: 'winlogon.exe', name: 'Windows Logon Application', description: 'Windows Logon Application', publisher: MS, group: 'windows', user: SYSTEM, baseMb: 2.2, cpu: 0, critical: true },
    { pid: 1188, exe: 'dwm.exe', name: 'Desktop Window Manager', description: 'Desktop Window Manager', publisher: MS, group: 'windows', user: 'DWM-1', baseMb: 74, cpu: 1.6, critical: true },
    { pid: 1316, exe: 'svchost.exe', name: 'Service Host: DCOM Server Process Launcher', description: 'Host Process for Windows Services', publisher: MS, group: 'windows', user: SYSTEM, baseMb: 14, cpu: 0.1, critical: true },
    { pid: 1460, exe: 'svchost.exe', name: 'Service Host: Netlogon', description: 'Host Process for Windows Services', publisher: MS, group: 'windows', user: SYSTEM, baseMb: 4.1, cpu: 0.1, critical: true, net: 0.01 },
    { pid: 1596, exe: 'svchost.exe', name: 'Service Host: Windows Event Log', description: 'Host Process for Windows Services', publisher: MS, group: 'windows', user: LOCAL, baseMb: 9.2, cpu: 0.1, critical: true, disk: 0.1 },
    { pid: 1744, exe: 'svchost.exe', name: 'Service Host: Windows Time', description: 'Host Process for Windows Services', publisher: MS, group: 'windows', user: LOCAL, baseMb: 2.0, cpu: 0, critical: true },
    { pid: 1808, exe: 'svchost.exe', name: 'Service Host: DNS Client', description: 'Host Process for Windows Services', publisher: MS, group: 'windows', user: NET, baseMb: 3.4, cpu: 0, critical: true, net: 0.01 },
    { pid: 2216, exe: 'spoolsv.exe', name: 'Spooler SubSystem App', description: 'Spooler SubSystem App', publisher: MS, group: 'windows', user: SYSTEM, baseMb: 6.0, cpu: 0, critical: false },
    { pid: 2540, exe: 'explorer.exe', name: 'Windows Explorer', description: 'Windows Explorer', publisher: MS, group: 'windows', user, baseMb: 118, cpu: 0.6, critical: false },
    { pid: 3112, exe: 'MsMpEng.exe', name: 'Antimalware Service Executable', description: 'Antimalware Service Executable', publisher: MS, group: 'background', user: SYSTEM, baseMb: 210, cpu: 1.4, critical: true, disk: 0.3 },
    { pid: 3388, exe: 'SearchHost.exe', name: 'Search', description: 'Search', publisher: MS, group: 'background', user, baseMb: 66, cpu: 0.1, critical: false },
    { pid: 3540, exe: 'StartMenuExperienceHost.exe', name: 'Start', description: 'Start', publisher: MS, group: 'background', user, baseMb: 48, cpu: 0.1, critical: false },
    { pid: 3716, exe: 'Microsoft.AAD.BrokerPlugin.exe', name: 'Work or school account', description: 'Microsoft Entra ID sign-in broker', publisher: MS, group: 'background', user, baseMb: 21, cpu: 0, critical: false, net: 0.02 },
    { pid: 3904, exe: 'OktaVerify.exe', name: 'Okta Verify', description: 'Okta Verify', publisher: 'Okta, Inc.', group: 'background', user, baseMb: 54, cpu: 0.1, critical: false, net: 0.01 },
    { pid: 4128, exe: 'SecurityHealthSystray.exe', name: 'Windows Security notification icon', description: 'Windows Security notification icon', publisher: MS, group: 'background', user, baseMb: 3.2, cpu: 0, critical: false },
    { pid: 4296, exe: 'RuntimeBroker.exe', name: 'Runtime Broker', description: 'Runtime Broker', publisher: MS, group: 'background', user, baseMb: 8.4, cpu: 0, critical: false },
  ];
}

/** A stable, Windows-shaped PID (a multiple of 4) for a desktop window. */
export function pidFor(winId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < winId.length; i++) h = Math.imul(h ^ winId.charCodeAt(i), 0x01000193) >>> 0;
  return 5000 + (h % 5000) * 4;
}

/** A repeatable 0..1 value for a process at a tick. */
function noise(pid: number, tick: number, salt: number): number {
  let x = Math.imul(pid * 2654435761 + tick * 40503 + salt * 9973, 0x5bd1e995) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return (x % 10000) / 10000;
}

export interface ProcessInput {
  windows: OpenWindow[];
  aiOnline: boolean;
  online: boolean;
  tick: number;
  /** DOMAIN\user of the signed-in learner. */
  user: string;
  efficiency?: ReadonlySet<number>;
}

export function processes(input: ProcessInput): Proc[] {
  const { tick, user } = input;
  const out: Proc[] = [];
  const used = new Set<number>();
  const usage = (pid: number, cpu: number, efficient: boolean): number => {
    const v = cpu * (0.4 + 1.2 * noise(pid, tick, 1));
    return Math.round((efficient ? v * 0.3 : v) * 10) / 10;
  };
  for (const w of input.windows) {
    const img = imageFor(w.appId, w.title);
    let pid = pidFor(w.id);
    while (used.has(pid)) pid += 4;
    used.add(pid);
    const eff = !!input.efficiency?.has(pid);
    out.push({
      pid, name: img.name, exe: img.exe, description: img.description, publisher: img.publisher, group: 'app', user,
      status: eff ? 'Efficiency mode' : 'Running',
      cpu: w.minimized ? Math.round(usage(pid, img.cpu, eff) * 0.2 * 10) / 10 : usage(pid, img.cpu, eff),
      memMb: Math.round((img.baseMb * (0.95 + 0.1 * noise(pid, Math.floor(tick / 10), 2))) * 10) / 10,
      diskMbs: noise(pid, tick, 3) > 0.85 ? Math.round(noise(pid, tick, 4) * 10) / 10 : 0,
      netMbps: input.online && w.appId === 'browser' ? Math.round(noise(pid, tick, 5) * 15) / 10 : 0,
      winId: w.id, critical: false,
    });
  }
  const fixed = fixedProcs(user);
  if (input.aiOnline) fixed.push({ pid: 4472, exe: 'ollama.exe', name: 'Ollama', description: 'Ollama', publisher: 'Ollama', group: 'background', user, baseMb: 1450, cpu: 2.5, critical: false });
  for (const f of fixed) {
    const eff = !!input.efficiency?.has(f.pid);
    out.push({
      pid: f.pid, name: f.name, exe: f.exe, description: f.description, publisher: f.publisher, group: f.group, user: f.user,
      status: eff ? 'Efficiency mode' : 'Running',
      cpu: usage(f.pid, f.cpu, eff),
      memMb: Math.round(f.baseMb * (0.97 + 0.06 * noise(f.pid, Math.floor(tick / 10), 2)) * 10) / 10,
      diskMbs: f.disk ? Math.round(f.disk * noise(f.pid, tick, 3) * 10) / 10 : 0,
      netMbps: input.online && f.net ? Math.round(f.net * noise(f.pid, tick, 5) * 100) / 100 : 0,
      critical: f.critical,
    });
  }
  return out;
}

/** Overall usage for the Performance page (16 GB RAM, as Settings > About says). */
export const INSTALLED_MB = 16 * 1024;
const OS_BASE_MB = 3900;

export function totals(procs: readonly Proc[]): { cpu: number; memMb: number; memPct: number; diskMbs: number; netMbps: number; count: number; threads: number; handles: number } {
  const cpu = Math.min(100, Math.round(procs.reduce((n, p) => n + p.cpu, 0) * 10) / 10);
  const memMb = Math.round(OS_BASE_MB + procs.reduce((n, p) => n + p.memMb, 0));
  return {
    cpu, memMb, memPct: Math.round((memMb / INSTALLED_MB) * 100),
    diskMbs: Math.round(procs.reduce((n, p) => n + p.diskMbs, 0) * 10) / 10,
    netMbps: Math.round(procs.reduce((n, p) => n + p.netMbps, 0) * 100) / 100,
    count: procs.length + 118, threads: 1800 + procs.length * 23, handles: 61000 + procs.length * 410,
  };
}

/** Group, then sort, as the Processes page does. */
export function sortProcs(procs: readonly Proc[], key: 'name' | 'cpu' | 'memMb' | 'diskMbs' | 'netMbps' | 'pid', desc: boolean): Proc[] {
  const dir = desc ? -1 : 1;
  return [...procs].sort((a, b) => {
    const av = a[key], bv = b[key];
    const c = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return c * dir || a.pid - b.pid;
  });
}

export interface Service { name: string; display: string; group: string; status: 'Running' | 'Stopped'; pid: number | null; description: string }

/** The services of a domain-joined Windows 11 workstation. */
export const SERVICES: readonly Service[] = [
  { name: 'Dnscache', display: 'DNS Client', group: 'NetworkService', status: 'Running', pid: 1808, description: 'Caches DNS names and registers this computer in DNS.' },
  { name: 'EventLog', display: 'Windows Event Log', group: 'LocalServiceNetworkRestricted', status: 'Running', pid: 1596, description: 'Manages events and event logs.' },
  { name: 'LanmanWorkstation', display: 'Workstation', group: 'NetworkService', status: 'Running', pid: 1808, description: 'Creates and maintains client network connections to servers using the SMB protocol.' },
  { name: 'Netlogon', display: 'Netlogon', group: '', status: 'Running', pid: 1460, description: 'Maintains a secure channel between this computer and the domain controller for authenticating users and services.' },
  { name: 'W32Time', display: 'Windows Time', group: 'LocalService', status: 'Running', pid: 1744, description: 'Keeps date and time in sync with the domain hierarchy; Kerberos fails if clocks drift more than 5 minutes.' },
  { name: 'WinDefend', display: 'Microsoft Defender Antivirus Service', group: '', status: 'Running', pid: 3112, description: 'Helps protect users from malware and other potentially unwanted software.' },
  { name: 'mpssvc', display: 'Windows Defender Firewall', group: 'LocalServiceNoNetworkFirewall', status: 'Running', pid: 1316, description: 'Helps protect this computer by preventing unauthorized users from gaining access through the network.' },
  { name: 'KeyIso', display: 'CNG Key Isolation', group: '', status: 'Running', pid: 896, description: 'Hosts key operations in the LSA process.' },
  { name: 'SamSs', display: 'Security Accounts Manager', group: '', status: 'Running', pid: 896, description: 'Signals other services that the Security Accounts Manager is ready.' },
  { name: 'gpsvc', display: 'Group Policy Client', group: 'netsvcs', status: 'Running', pid: 1316, description: 'Applies settings configured by administrators through Group Policy.' },
  { name: 'Spooler', display: 'Print Spooler', group: '', status: 'Running', pid: 2216, description: 'Spools print jobs and handles interaction with the printer.' },
  { name: 'TermService', display: 'Remote Desktop Services', group: 'NetworkService', status: 'Stopped', pid: null, description: 'Allows users to connect interactively to this computer. Inbound RDP is off on IAM workstations.' },
  { name: 'RemoteRegistry', display: 'Remote Registry', group: 'localService', status: 'Stopped', pid: null, description: 'Enables remote users to modify registry settings. Disabled by the workstation baseline.' },
  { name: 'wuauserv', display: 'Windows Update', group: 'netsvcs', status: 'Running', pid: 1316, description: 'Enables the detection, download and installation of updates.' },
  { name: 'AADBrokerPluginSvc', display: 'Web Account Manager', group: 'netsvcs', status: 'Running', pid: 1316, description: 'Single sign-on to Microsoft Entra ID for apps on this computer.' },
  { name: 'SCardSvr', display: 'Smart Card', group: 'LocalServiceAndNoImpersonation', status: 'Stopped', pid: null, description: 'Manages access to smart cards read by this computer.' },
];
