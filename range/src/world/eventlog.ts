/**
 * world/eventlog.ts — what Event Viewer shows. Read-only: builds Windows event
 * logs from the world and never changes it.
 *
 * Security is the domain controller's audit log, built from the AD audit
 * trail the lab writes as you work (4720, 4740, 4771...). The other logs hold
 * what a real server and workstation log on their own (service starts, Group
 * Policy, Windows Update, DNS, PowerShell), placed relative to when this
 * company was created and seeded from the world, so they are stable between
 * redraws. A few of them are deliberate teaching material: unsigned LDAP binds
 * by a service account (2887/2889), the Print Spooler disabled on a DC, a
 * client that cannot resolve wpad. Windows Defender's log comes from the scans
 * you run in Windows Security.
 */
import type { AuditEvent, World } from '../core/types.ts';
import { AD_EVENT_NAMES } from './audit.ts';

export type Level = 'Critical' | 'Error' | 'Warning' | 'Information' | 'Verbose' | 'Audit Success' | 'Audit Failure';

export const LOGS = ['Application', 'Security', 'Setup', 'System', 'Forwarded Events', 'Directory Service', 'DNS Server', 'Windows PowerShell', 'Microsoft-Windows-Windows Defender/Operational'] as const;
export type LogName = (typeof LOGS)[number];

export interface LogEvent {
  key: string;
  log: LogName;
  level: Level;
  time: string;
  source: string;
  eventId: number;
  task: string;
  message: string;
  details: string;
  user: string;
  computer: string;
  keywords: string;
}

export interface DefenderEntry { time: string; name: string; path: string; severity: string; action: 'Quarantined' | 'Allowed' | 'Restored' | 'Active' }
export interface LogClear { log: LogName; time: string; by: string }
export interface EventLogInput {
  defender?: { lastScan?: { time: string; scope: string; files: number; threats: number }; history: DefenderEntry[] };
  clears?: LogClear[];
  now: number;
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

export const isFailure = (e: { eventId: number | null }): boolean => e.eventId === 4625 || e.eventId === 4771;

export function taskCategory(id: number): string {
  if ([4624, 4625, 4634].includes(id)) return id === 4634 ? 'Logoff' : 'Logon';
  if (id === 4771) return 'Kerberos Authentication Service';
  if ([4727, 4728, 4729, 4730, 4732, 4733, 4737].includes(id)) return 'Security Group Management';
  if ([5136, 5137, 5139, 5141].includes(id)) return 'Directory Service Changes';
  if (id === 1102) return 'Log clear';
  return 'User Account Management';
}

/** The Security event's General-tab text, laid out as Windows lays it out. */
export function securityMessage(e: AuditEvent, netbios: string): string {
  const subj = e.actor === 'SYSTEM' ? 'SYSTEM' : `${netbios}\\${e.actor}`;
  const target = e.eventId === 4740 ? 'Account That Was Locked Out' : e.eventId === 4625 ? 'Account For Which Logon Failed' : 'Target Account';
  const extra = e.eventId === 4740 ? `\n\nAdditional Information:\n\t${e.detail}`
    : `\n\nNetwork Information:\n\tClient Address:\t\t${e.origin || '-'}${e.detail ? `\n\nAdditional Information:\n\t${e.detail}` : ''}`;
  return `${AD_EVENT_NAMES[e.eventId!] ?? e.action}.\n\nSubject:\n\tSecurity ID:\t\t${subj}\n\tAccount Name:\t\t${e.actor}\n\tAccount Domain:\t\t${netbios}\n\n${target}:\n\tSecurity ID:\t\t${netbios}\\${e.target}\n\tAccount Name:\t\t${e.target}\n\tAccount Domain:\t\t${netbios}${extra}`;
}

function xml(log: string, provider: string, id: number, time: string, computer: string, data: Record<string, string>): string {
  return `- System\n  - Provider [ Name] ${provider}\n    EventID ${id}\n    TimeCreated [ SystemTime] ${time}\n    Channel ${log}\n    Computer ${computer}\n- EventData\n${Object.entries(data).map(([k, v]) => `    ${k} ${v}`).join('\n')}`;
}

/** Every log, newest first. */
export function buildEventLogs(w: World, input: EventLogInput): Record<LogName, LogEvent[]> {
  const domain = w.ad.domain;
  const nb = w.ad.netbios;
  const DC = `MHS-DC01.${domain}`;
  const WKS = `MHS-IAM-WKS01.${domain}`;
  const anchor = Date.parse(w.created) || input.now - DAY;
  const now = input.now;
  const r = rng(w.seed);
  const out = Object.fromEntries(LOGS.map((l) => [l, [] as LogEvent[]])) as Record<LogName, LogEvent[]>;
  let n = 0;
  const add = (log: LogName, at: number, level: Level, source: string, eventId: number, task: string, message: string, opts: { computer?: string; user?: string; data?: Record<string, string>; keywords?: string } = {}): void => {
    if (at > now) return;
    const time = new Date(at).toISOString();
    const computer = opts.computer ?? DC;
    out[log].push({
      key: `${log}#${n++}`, log, level, time, source, eventId, task, message, computer,
      user: opts.user ?? 'N/A', keywords: opts.keywords ?? (level === 'Audit Success' || level === 'Audit Failure' ? level : 'Classic'),
      details: xml(log, source, eventId, time, computer, opts.data ?? { Message: message.split('\n')[0]! }),
    });
  };

  // ---------------------------------------------------------------- Security (domain controller)
  for (const e of w.audit) {
    if (e.source !== 'AD' || !e.eventId) continue;
    const at = Date.parse(e.time);
    const fail = isFailure(e);
    add('Security', at, fail ? 'Audit Failure' : 'Audit Success', 'Microsoft Windows security auditing.', e.eventId, taskCategory(e.eventId), securityMessage(e, nb), {
      data: { TargetUserName: e.target, TargetDomainName: nb, SubjectUserName: e.actor, SubjectDomainName: nb, ...(e.eventId === 4740 ? { CallerComputerName: e.detail.replace('Caller Computer Name: ', '') } : { IpAddress: e.origin || '-' }) },
    });
  }

  // ---------------------------------------------------------------- System (domain controller)
  const boot = anchor - 3 * 60 * MIN;
  add('System', boot, 'Information', 'Kernel-General', 12, 'None', `The operating system started at system time ${new Date(boot).toISOString()}.`);
  add('System', boot + 20_000, 'Information', 'EventLog', 6009, 'None', 'Microsoft (R) Windows (R) 10.00. 20348  Multiprocessor Free.');
  add('System', boot + 21_000, 'Information', 'EventLog', 6005, 'None', 'The Event log service was started.');
  ['Active Directory Domain Services', 'DNS Server', 'Kerberos Key Distribution Center', 'Netlogon', 'Windows Time', 'DFS Replication', 'Active Directory Web Services'].forEach((svc, i) =>
    add('System', boot + (60 + i * 7) * 1000, 'Information', 'Service Control Manager', 7036, 'None', `The ${svc} service entered the running state.`, { data: { param1: svc, param2: 'running' } }));
  add('System', boot + 3 * MIN, 'Information', 'Service Control Manager', 7040, 'None', 'The start type of the Print Spooler service was changed from auto start to disabled.\n\nDomain controllers do not print. Disabling the spooler removes the PrintNightmare attack path (CVE-2021-34527).', { user: `${nb}\\${w.player.adminSam}` });
  add('System', boot + 4 * MIN, 'Information', 'Microsoft-Windows-Time-Service', 37, 'None', 'The time provider NtpClient is currently receiving valid time data from time.windows.com,0x9 (ntp.m|0x9|0.0.0.0:123->40.119.6.228:123).\n\nThe PDC emulator keeps domain time. Kerberos refuses tickets when clocks differ by more than 5 minutes.');
  add('System', boot + 5 * MIN, 'Warning', 'Microsoft-Windows-DNS-Client', 1014, '(1014)', `Name resolution for the name wpad.${domain} timed out after none of the configured DNS servers responded.`);
  add('System', boot + 6 * MIN, 'Warning', 'NETLOGON', 5829, 'None', 'The Netlogon service allowed a vulnerable Netlogon secure channel connection.\n\nMachine SamAccountName: LEGACY-PACS01$\nDomain: ' + nb + '\nAccount Type: Domain Member\nMachine Operating System: Windows Server 2008 R2\n\nThis is the Zerologon (CVE-2020-1472) compatibility mode. Replace or update the device before enforcement mode is turned on.');
  for (let d = 0, t = anchor; t <= now && d < 30; d++, t += DAY) {
    add('System', t + 12 * 60 * MIN, 'Information', 'EventLog', 6013, 'None', `The system uptime is ${Math.round((t + 12 * 60 * MIN - boot) / 1000)} seconds.`);
    add('System', t + 90 * MIN, 'Information', 'Microsoft-Windows-GroupPolicy', 1500, '(None)', 'The Group Policy settings for the computer were processed successfully. There were no changes detected since the last successful processing of Group Policy.', { user: 'SYSTEM' });
  }

  // ---------------------------------------------------------------- Directory Service (domain controller)
  add('Directory Service', boot + 70_000, 'Information', 'NTDS General', 1000, 'Service Control', 'Microsoft Active Directory Domain Services startup complete, version 10.0.20348.1', { user: 'ANONYMOUS LOGON' });
  add('Directory Service', boot + 80_000, 'Information', 'NTDS General', 1394, 'Service Control', 'All problems preventing updates to the Active Directory Domain Services database have been cleared. New updates to the Active Directory Domain Services database are succeeding. The Net Logon service has restarted.');
  add('Directory Service', boot + 2 * 60 * MIN, 'Information', 'NTDS ISAM', 700, 'Online Defragmentation', 'NTDS (608,D,50) NTDSA: Online defragmentation is beginning a full pass on database \'C:\\Windows\\NTDS\\ntds.dit\'.');
  add('Directory Service', boot + 2 * 60 * MIN + 40_000, 'Information', 'NTDS ISAM', 701, 'Online Defragmentation', 'NTDS (608,D,50) NTDSA: Online defragmentation has completed a full pass on database \'C:\\Windows\\NTDS\\ntds.dit\'.');
  const svc = w.ad.users.find((u) => /^svc-/i.test(u.sam))?.sam ?? 'svc-app';
  for (let d = 0, t = anchor; t <= now && d < 30; d++, t += DAY) {
    const simple = 3 + Math.floor(r() * 20), unsigned = 40 + Math.floor(r() * 300);
    add('Directory Service', t + 9 * 60 * MIN, 'Warning', 'ActiveDirectory_DomainService', 2887, 'LDAP Interface',
      `During the previous 24 hour period, some clients attempted to perform LDAP binds that were either:\n(1) A SASL (Negotiate, Kerberos, NTLM, or Digest) LDAP bind that did not request signing (integrity validation), or\n(2) A LDAP simple bind that was performed on a clear text (non-SSL/TLS-encrypted) connection\n\nThis directory server is not currently configured to reject such binds. The security of these binds can be significantly improved by configuring the server to enforce validation of such binds.\n\nSummary information on the number of these binds received within the past 24 hours is below.\n\nNumber of simple binds performed without SSL/TLS: ${simple}\nNumber of Negotiate/Kerberos/NTLM/Digest binds performed without signing: ${unsigned}`,
      { user: 'ANONYMOUS LOGON' });
  }
  add('Directory Service', anchor + 30 * MIN, 'Warning', 'ActiveDirectory_DomainService', 2889, 'LDAP Interface',
    `The following client performed a SASL (Negotiate/Kerberos/NTLM/Digest) LDAP bind without requesting signing (integrity verification), or performed a simple bind over a clear text (non-SSL/TLS-encrypted) LDAP connection.\n\nClient IP address:\n10.20.4.37:52144\nIdentity the client attempted to authenticate as:\n${nb}\\${svc}\nBinding Type:\n0\n\nBinding type 0 is a simple bind: the service account's password crossed the network in clear text. Move the application to LDAPS (636) or signed binds, then rotate the password.`,
    { user: 'ANONYMOUS LOGON' });

  // ---------------------------------------------------------------- DNS Server (domain controller)
  add('DNS Server', boot + 65_000, 'Warning', 'DNS-Server-Service', 4013, 'None', 'The DNS server is waiting for Active Directory Domain Services (AD DS) to signal that the initial synchronization of the directory has been completed. The DNS server service cannot start until the initial synchronization is complete because critical DNS data might not yet be replicated onto this domain controller.');
  add('DNS Server', boot + 75_000, 'Information', 'DNS-Server-Service', 2, 'None', 'The DNS server has started.');
  add('DNS Server', boot + 90_000, 'Information', 'DNS-Server-Service', 4, 'None', 'The DNS server has finished the background loading of zones. All zones are now available for DNS updates and zone transfers, as allowed by their individual zone configuration.');

  // ---------------------------------------------------------------- Application (workstation)
  const wboot = anchor - 40 * MIN;
  const wk = { computer: WKS };
  add('Application', wboot, 'Information', 'Microsoft-Windows-Security-SPP', 16384, 'None', `Successfully scheduled Software Protection service for re-start at ${new Date(wboot + 7 * DAY).toISOString()}. Reason: RulesEngine.`, wk);
  add('Application', wboot + 30_000, 'Information', 'Microsoft-Windows-Winlogon', 6000, 'None', 'The winlogon notification subscriber <SessionEnv> was unavailable to handle a notification event.', wk);
  add('Application', wboot + 60_000, 'Information', 'Microsoft-Windows-RestartManager', 10000, 'None', `Starting session 0 - ${new Date(wboot + 60_000).toISOString()}.`, { ...wk, user: `${nb}\\${w.player.sam}` });
  add('Application', wboot + 62_000, 'Information', 'Microsoft-Windows-RestartManager', 10001, 'None', `Ending session 0 started ${new Date(wboot + 60_000).toISOString()}.`, { ...wk, user: `${nb}\\${w.player.sam}` });
  add('Application', wboot + 5 * MIN, 'Information', 'MsiInstaller', 11707, 'None', 'Product: Remote Server Administration Tools -- Installation completed successfully.', { ...wk, user: `${nb}\\${w.player.adminSam}` });
  add('Application', wboot + 9 * MIN, 'Error', 'Application Error', 1000, '(100)', 'Faulting application name: OneDrive.exe, version: 24.201.1006.0005, time stamp: 0x66f2b2c1\nFaulting module name: ntdll.dll, version: 10.0.22621.4249\nException code: 0xc0000409\nFaulting process id: 0x2a3c\nFaulting application path: C:\\Users\\' + w.player.sam + '\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe', wk);
  add('Application', wboot + 9 * MIN + 2000, 'Information', 'Windows Error Reporting', 1001, 'None', 'Fault bucket , type 0\nEvent Name: APPCRASH\nResponse: Not available\nP1: OneDrive.exe', wk);
  add('Application', wboot + 15 * MIN, 'Warning', 'Microsoft-Windows-User Profiles Service', 1530, 'None', 'Windows detected your registry file is still in use by other applications or services. The file will be unloaded now. The applications or services that hold your registry file may not function properly afterwards.', { ...wk, user: 'SYSTEM' });
  for (let d = 1, t = anchor; t <= now && d < 30; d++, t += DAY) add('Application', t + 3 * 60 * MIN, 'Information', 'Microsoft-Windows-Security-SPP', 16384, 'None', 'Successfully scheduled Software Protection service for re-start. Reason: RulesEngine.', wk);

  // ---------------------------------------------------------------- Setup (workstation)
  for (const [i, kb] of ['KB5031364', 'KB5034441', 'KB5041585'].entries()) {
    const t = anchor - (20 - i * 6) * DAY;
    add('Setup', t, 'Information', 'Microsoft-Windows-Servicing', 1, 'None', `Initiating changes for package ${kb}. Current state is Absent. Target state is Installed. Client id: WindowsUpdateAgent.`, { ...wk, user: 'SYSTEM' });
    add('Setup', t + 4 * MIN, 'Information', 'Microsoft-Windows-Servicing', 4, 'None', `A reboot is necessary before package ${kb} can be changed to the Installed state.`, { ...wk, user: 'SYSTEM' });
    add('Setup', t + 9 * MIN, 'Information', 'Microsoft-Windows-Servicing', 2, 'None', `Package ${kb} was successfully changed to the Installed state.`, { ...wk, user: 'SYSTEM' });
  }

  // ---------------------------------------------------------------- Windows PowerShell (workstation)
  add('Windows PowerShell', wboot + 20 * MIN, 'Information', 'PowerShell', 600, 'Provider Lifecycle', 'Provider "Registry" is Started.\n\nDetails:\n\tProviderName=Registry\n\tNewProviderState=Started\n\tHostName=ConsoleHost', wk);
  add('Windows PowerShell', wboot + 20 * MIN + 500, 'Information', 'PowerShell', 400, 'Engine Lifecycle', 'Engine state is changed from None to Available.\n\nDetails:\n\tNewEngineState=Available\n\tPreviousEngineState=None\n\tHostName=ConsoleHost\n\tHostVersion=5.1.22621.4111\n\tHostApplication=C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\n\tEngineVersion=5.1.22621.4111\n\tRunspaceId=4f1d0a62-1d7b-4f5e-9a51-7e1f5d3c2b10', wk);
  add('Windows PowerShell', wboot + 2 * 60 * MIN, 'Information', 'PowerShell', 403, 'Engine Lifecycle', 'Engine state is changed from Available to Stopped.\n\nDetails:\n\tNewEngineState=Stopped\n\tPreviousEngineState=Available\n\tHostName=ConsoleHost', wk);

  // ---------------------------------------------------------------- Windows Defender (workstation), from Windows Security
  const DEF: LogName = 'Microsoft-Windows-Windows Defender/Operational';
  const user = `${nb}\\${w.player.sam}`;
  for (let d = 0, t = anchor; t <= now && d < 30; d++, t += DAY) {
    add(DEF, t + 45 * MIN, 'Information', 'Microsoft-Windows-Windows Defender', 2000, 'None', 'Microsoft Defender Antivirus security intelligence version updated.\n\nCurrent security intelligence Version: 1.419.' + (100 + d) + '.0\nPrevious security intelligence Version: 1.419.' + (99 + d) + '.0\nSecurity intelligence Type: AntiVirus\nUpdate Type: Delta', { ...wk, user: 'SYSTEM' });
    add(DEF, t + 46 * MIN, 'Information', 'Microsoft-Windows-Windows Defender', 1150, 'None', 'Endpoint Protection client is up and running in a healthy state.\n\nPlatform version: 4.18.24090.11\nEngine version: 1.1.24090.11\nReal-time protection: Enabled', { ...wk, user: 'SYSTEM' });
  }
  const scan = input.defender?.lastScan;
  if (scan) {
    const t = Date.parse(scan.time);
    const type = /Quick/.test(scan.scope) ? 'Quick Scan' : /Full/.test(scan.scope) ? 'Full Scan' : 'Custom Scan';
    add(DEF, t - 3000, 'Information', 'Microsoft-Windows-Windows Defender', 1000, 'None', `Microsoft Defender Antivirus scan has started.\n\tScan ID: {${(w.seed >>> 0).toString(16).padStart(8, '0')}-5C2D-4A1B-9E77-0B6D2E1F4A30}\n\tScan Type: Antimalware\n\tScan Parameters: ${type}\n\tUser: ${user}`, { ...wk, user });
    add(DEF, t, 'Information', 'Microsoft-Windows-Windows Defender', 1001, 'None', `Microsoft Defender Antivirus scan has finished.\n\tScan Type: Antimalware\n\tScan Parameters: ${type}\n\tUser: ${user}\n\tFiles scanned: ${scan.files}\n\tThreats found: ${scan.threats}`, { ...wk, user });
  }
  for (const h of input.defender?.history ?? []) {
    const t = Date.parse(h.time);
    const detected = `Microsoft Defender Antivirus has detected malware or other potentially unwanted software.\n\tName: ${h.name}\n\tSeverity: ${h.severity}\n\tPath: file:_${h.path}\n\tDetection Origin: Local machine\n\tDetection Type: Concrete\n\tUser: ${user}`;
    if (h.action === 'Active') add(DEF, t, 'Warning', 'Microsoft-Windows-Windows Defender', 1116, 'None', detected, { ...wk, user });
    else if (h.action === 'Restored') add(DEF, t, 'Information', 'Microsoft-Windows-Windows Defender', 1009, 'None', `Microsoft Defender Antivirus has restored an item from quarantine.\n\tName: ${h.name}\n\tPath: ${h.path}\n\tUser: ${user}`, { ...wk, user });
    else {
      add(DEF, t - 1000, 'Warning', 'Microsoft-Windows-Windows Defender', 1116, 'None', detected, { ...wk, user });
      add(DEF, t, 'Information', 'Microsoft-Windows-Windows Defender', 1117, 'None', `Microsoft Defender Antivirus has taken action to protect this machine from malware or other potentially unwanted software.\n\tName: ${h.name}\n\tSeverity: ${h.severity}\n\tPath: file:_${h.path}\n\tAction: ${h.action === 'Quarantined' ? 'Quarantine' : 'Allow'}\n\tUser: ${user}`, { ...wk, user });
    }
  }

  // ---------------------------------------------------------------- clearing a log leaves a record of who cleared it
  for (const c of input.clears ?? []) {
    const at = Date.parse(c.time);
    for (const k of Object.keys(out) as LogName[]) if (k === c.log) out[k] = out[k].filter((e) => Date.parse(e.time) > at);
    if (c.log === 'Security') {
      add('Security', at, 'Audit Success', 'Microsoft-Windows-Eventlog', 1102, 'Log clear', `The audit log was cleared.\nSubject:\n\tSecurity ID:\t${nb}\\${c.by}\n\tAccount Name:\t${c.by}\n\tDomain Name:\t${nb}\n\nClearing the Security log destroys evidence. Outside a documented change, treat 1102 as an incident.`, { user: `${nb}\\${c.by}`, data: { SubjectUserName: c.by, SubjectDomainName: nb } });
    } else {
      add('System', at, 'Information', 'Microsoft-Windows-Eventlog', 104, 'Log clear', `The ${c.log} log file was cleared.`, { user: `${nb}\\${c.by}`, computer: ['Application', 'Setup', 'Windows PowerShell', DEF].includes(c.log) ? WKS : DC });
    }
  }

  for (const k of LOGS) out[k].sort((a, b) => b.time.localeCompare(a.time) || b.key.localeCompare(a.key));
  return out;
}

/** Windows' Event ID filter: "4720-4729, 4740, -4624" (ranges, and a minus to exclude). */
export function idFilter(spec: string): ((id: number) => boolean) | null {
  const parts = spec.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const inc: [number, number][] = [];
  const exc: [number, number][] = [];
  for (const p of parts) {
    const neg = p.startsWith('-');
    const body = neg ? p.slice(1) : p;
    const m = /^(\d+)(?:-(\d+))?$/.exec(body);
    if (!m) return () => false;
    const range: [number, number] = [Number(m[1]), Number(m[2] ?? m[1])];
    (neg ? exc : inc).push(range);
  }
  return (id) => (!inc.length || inc.some(([a, b]) => id >= a && id <= b)) && !exc.some(([a, b]) => id >= a && id <= b);
}
