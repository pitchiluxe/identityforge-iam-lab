/**
 * terminal/cmdlets2.ts — the everyday cmdlets that make the console feel like
 * Windows: files, processes, services, networking, history, objects, and the
 * commands that open other windows on the desktop.
 */
import { copyFile, deleteFile, fileExists, readFile, renameFile, writeFile } from '../world/docs.ts';
import { type CmdletCtx, type CmdletDef, ExitSignal, PsError, cell, getProp, refOf, toStr, withRef } from './shell.ts';
import { CmdShell } from './cmd.ts';

const OPEN = '\u0000OPEN:';

function typeName(v: unknown): string {
  if (v === null || v === undefined) return 'System.Object';
  if (typeof v === 'string') return 'System.String';
  if (typeof v === 'number') return Number.isInteger(v) ? 'System.Int32' : 'System.Double';
  if (typeof v === 'boolean') return 'System.Boolean';
  if (v instanceof Date) return 'System.DateTime';
  if (Array.isArray(v)) return 'System.Object[]';
  const r = refOf(v);
  if (r?.type === 'user') return 'Microsoft.ActiveDirectory.Management.ADUser';
  if (r?.type === 'group') return 'Microsoft.ActiveDirectory.Management.ADGroup';
  if (r?.type === 'computer') return 'Microsoft.ActiveDirectory.Management.ADComputer';
  if (r?.type === 'event') return 'System.Diagnostics.Eventing.Reader.EventLogRecord';
  return 'System.Management.Automation.PSCustomObject';
}

const PROCESSES: [string, number, number][] = [
  ['ApplicationFrameHost', 4120, 22], ['csrss', 612, 1], ['ctfmon', 5032, 9], ['dwm', 1180, 61], ['explorer', 4876, 84],
  ['lsass', 788, 4], ['MsMpEng', 3344, 210], ['msedge', 6120, 37], ['powershell', 7344, 3], ['RuntimeBroker', 5660, 6],
  ['SearchHost', 6000, 11], ['services', 760, 3], ['sihost', 4404, 4], ['smss', 412, 0], ['spoolsv', 2556, 2], ['svchost', 1020, 12],
  ['svchost', 1204, 8], ['svchost', 1588, 15], ['System', 4, 1], ['taskhostw', 4460, 2], ['Teams', 8212, 95], ['winlogon', 704, 1], ['wininit', 696, 0],
];

const SERVICES: [string, string, string][] = [
  ['Running', 'BITS', 'Background Intelligent Transfer Service'], ['Running', 'Dnscache', 'DNS Client'], ['Running', 'EventLog', 'Windows Event Log'],
  ['Running', 'gpsvc', 'Group Policy Client'], ['Running', 'LanmanWorkstation', 'Workstation'], ['Running', 'Netlogon', 'Netlogon'],
  ['Running', 'Spooler', 'Print Spooler'], ['Running', 'W32Time', 'Windows Time'], ['Running', 'WinDefend', 'Microsoft Defender Antivirus Service'],
  ['Running', 'WinRM', 'Windows Remote Management (WS-Management)'], ['Stopped', 'RemoteRegistry', 'Remote Registry'], ['Running', 'wuauserv', 'Windows Update'],
];

function toJson(v: unknown, depth: number): unknown {
  if (depth < 0) return toStr(v);
  if (v === null || v === undefined || typeof v !== 'object') return v ?? null;
  if (v instanceof Date) return `/Date(${v.getTime()})/`;
  if (Array.isArray(v)) return v.map((x) => toJson(x, depth - 1));
  return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, toJson(x, depth - 1)]));
}

/** Windows programs PowerShell runs as it would on a real workstation: the same engine as Command Prompt. */
const PROGRAMS: [string, string, string[]][] = [
  ['tasklist', 'Lists running processes (tasklist.exe).', ['tasklist.exe']],
  ['systeminfo', 'Shows the computer, operating system and domain (systeminfo.exe).', ['systeminfo.exe']],
  ['net', 'Accounts, groups and shares: net user vhale /domain, net group "Domain Admins" /domain (net.exe).', ['net.exe', 'net1', 'net1.exe']],
  ['nslookup', 'Looks a name up in the domain DNS (nslookup.exe).', ['nslookup.exe']],
  ['ping', 'Tests whether a computer answers (ping.exe). Test-Connection is the cmdlet.', ['ping.exe']],
  ['whoami', 'Shows the account this shell runs as: /groups, /upn, /fqdn, /all (whoami.exe).', ['whoami.exe']],
  ['hostname', 'Shows the computer name (hostname.exe).', ['hostname.exe']],
  ['gpupdate', 'Refreshes Group Policy: gpupdate /force (gpupdate.exe).', ['gpupdate.exe']],
  ['gpresult', 'Shows the Group Policy and groups applied: gpresult /r (gpresult.exe).', ['gpresult.exe']],
  ['klist', 'Lists the Kerberos tickets of this logon session (klist.exe).', ['klist.exe']],
  ['tree', 'Draws the folder structure (tree.com).', ['tree.com']],
  ['where.exe', 'Finds a program on the PATH. Type where.exe: in PowerShell, where means Where-Object.', []],
];

function runProgram(c: CmdletCtx, tool: string): string[] {
  const asAdmin = tool === 'whoami' ? { user: c.w.player.adminSam, host: 'MHS-IAM-WKS01' } : undefined;
  const sh = new CmdShell(c.w, { powershell: () => [], ask: () => null }, c.shell.cwd, asAdmin);
  const line = [tool, ...c.pos.map((a) => (/\s/.test(toStr(a)) ? `"${toStr(a)}"` : toStr(a)))].join(' ');
  const out: string[] = [];
  for (const l of sh.run(line)) {
    if (l.text.startsWith('\u0000')) continue;
    if (l.kind === 'err') c.shell.nativeError(l.text);
    else out.push(l.text);
  }
  return out;
}

export const EXTRA_CMDLETS: CmdletDef[] = [
  { name: 'exit', module: 'Core', params: ['Code'], positional: ['Code'], synopsis: 'Closes this PowerShell window.', run(c) { throw new ExitSignal(Number(c.named.Code ?? 0)); } },
  { name: 'notepad', aliases: ['notepad.exe'], module: 'Core', params: ['Path'], positional: ['Path'], synopsis: 'Opens Notepad.', run(c) { c.shell.host(`${OPEN}notepad:${c.named.Path === undefined ? '' : c.shell.resolvePath(c.str('Path'))}`); } },
  { name: 'ise', aliases: ['powershell_ise', 'powershell_ise.exe'], module: 'Core', params: ['File'], positional: ['File'], synopsis: 'Opens the Windows PowerShell ISE.', run(c) { c.shell.host(`${OPEN}ise:${c.named.File === undefined ? '' : c.shell.resolvePath(c.str('File'))}`); } },
  { name: 'explorer', aliases: ['explorer.exe'], module: 'Core', params: ['Path'], positional: ['Path'], synopsis: 'Opens File Explorer.', run(c) { c.shell.host(`${OPEN}explorer:${c.named.Path === undefined ? c.shell.cwd : c.shell.resolvePath(c.str('Path'))}`); } },
  {
    name: 'Start-Process', aliases: ['start', 'saps', 'Invoke-Item', 'ii'], module: 'Core', params: ['FilePath', 'Path', 'ArgumentList'], positional: ['FilePath'],
    synopsis: 'Opens a file or program, as double-clicking it would.', run(c) {
      const target = c.str(c.named.FilePath !== undefined ? 'FilePath' : 'Path', true);
      if (/^https?:\/\//i.test(target)) return void c.shell.host(`${OPEN}url:${target}`);
      const prog = target.toLowerCase().replace(/\.exe$/, '');
      if (['notepad', 'powershell', 'powershell_ise', 'explorer', 'msedge', 'chrome', 'dsa.msc', 'eventvwr', 'eventvwr.msc', 'control', 'ms-settings:', 'windowsdefender:'].includes(prog)) return void c.shell.host(`${OPEN}app:${prog}`);
      const path = c.shell.resolvePath(target);
      if (!fileExists(c.w, path)) throw new PsError(`This command cannot be run because "${target}" could not be found.`, 'ObjectNotFound');
      c.shell.host(`${OPEN}file:${path}`);
    },
  },
  {
    name: 'New-Item', aliases: ['ni'], module: 'Core', params: ['Path', 'Name', 'ItemType', 'Value'], positional: ['Path'],
    synopsis: 'Creates a file.', run(c) {
      let path = c.shell.resolvePath(c.str('Path', true));
      if (c.named.Name !== undefined) path = `${path}\\${c.str('Name')}`;
      if (/^directory$/i.test(c.str('ItemType'))) {
        writeFile(c.w, `${path}\\desktop.ini`, '');
        return { Mode: 'd-----', LastWriteTime: new Date(), Length: '', Name: path.split('\\').pop() };
      }
      if (fileExists(c.w, path) && !c.has('Force')) throw new PsError(`The file '${path}' already exists.`, 'ResourceExists');
      writeFile(c.w, path, c.named.Value === undefined ? '' : toStr(c.named.Value));
      return { Mode: '-a----', LastWriteTime: new Date(), Length: toStr(c.named.Value ?? '').length, Name: path.split('\\').pop() };
    },
  },
  {
    name: 'Remove-Item', aliases: ['del', 'rm', 'erase', 'ri'], module: 'Core', params: ['Path'], switches: ['Recurse'], positional: ['Path'],
    synopsis: 'Deletes a file (it goes to the Recycle Bin here).', run(c) { deleteFile(c.w, c.shell.resolvePath(c.str('Path', true))); },
  },
  {
    name: 'Copy-Item', aliases: ['copy', 'cp', 'cpi'], module: 'Core', params: ['Path', 'Destination'], positional: ['Path', 'Destination'],
    synopsis: 'Copies a file.', run(c) {
      const from = c.shell.resolvePath(c.str('Path', true));
      const dest = c.shell.resolvePath(c.str('Destination', true));
      if (/\.[a-z0-9]{1,4}$/i.test(dest)) writeFile(c.w, dest, readFile(c.w, from));
      else copyFile(c.w, from, dest);
    },
  },
  {
    name: 'Move-Item', aliases: ['move', 'mv', 'mi'], module: 'Core', params: ['Path', 'Destination'], positional: ['Path', 'Destination'],
    synopsis: 'Moves a file.', run(c) {
      const from = c.shell.resolvePath(c.str('Path', true));
      let dest = c.shell.resolvePath(c.str('Destination', true));
      if (!/\.[a-z0-9]{1,4}$/i.test(dest)) dest = `${dest}\\${from.split('\\').pop()}`;
      writeFile(c.w, dest, readFile(c.w, from));
      deleteFile(c.w, from);
    },
  },
  {
    name: 'Rename-Item', aliases: ['ren', 'rni'], module: 'Core', params: ['Path', 'NewName'], positional: ['Path', 'NewName'],
    synopsis: 'Renames a file.', run(c) { renameFile(c.w, c.shell.resolvePath(c.str('Path', true)), c.str('NewName', true)); },
  },
  { name: 'Get-History', aliases: ['h', 'history', 'ghy'], module: 'Core', synopsis: 'Lists commands entered in this session.', run: (c) => c.shell.history.slice(0, -1).map((l, i) => ({ Id: i + 1, CommandLine: l })) },
  { name: 'Clear-History', aliases: ['clhy'], module: 'Core', synopsis: 'Clears the command history.', run(c) { c.shell.history.length = 0; } },
  {
    name: 'Get-Variable', aliases: ['gv'], module: 'Core', params: ['Name'], positional: ['Name'], switches: ['ValueOnly'], synopsis: 'Lists variables.',
    run(c) {
      const want = c.named.Name === undefined ? null : c.str('Name').toLowerCase().replace('*', '');
      const list = [...c.shell.vars.entries()].filter(([k]) => !want || k.startsWith(want)).map(([k, v]) => ({ Name: k, Value: cell(v) }));
      return c.has('ValueOnly') ? list.map((x) => c.shell.vars.get(x.Name)) : list;
    },
  },
  {
    name: 'Get-Member', aliases: ['gm'], module: 'Core', pipe: 'all', synopsis: 'Shows the properties of objects.', run(c) {
      const first = (c.input ?? [])[0];
      if (first === undefined) throw new PsError('You must specify an object for the Get-Member cmdlet.');
      const props = first && typeof first === 'object' && !(first instanceof Date) ? Object.keys(first as object) : ['Length'];
      c.shell.host(`\n   TypeName: ${typeName(first)}\n`);
      return props.map((p) => ({ Name: p, MemberType: 'Property', Definition: `${typeName(getProp(first, p)).replace('System.', '').toLowerCase()} ${p} {get;set;}` }));
    },
  },
  {
    name: 'Get-Process', aliases: ['ps', 'gps'], module: 'Core', params: ['Name'], positional: ['Name'], synopsis: 'Lists running processes.',
    run(c) {
      const want = c.named.Name === undefined ? null : c.str('Name').toLowerCase();
      const list = PROCESSES.filter(([n]) => !want || n.toLowerCase().startsWith(want.replace('*', '')));
      if (want && !list.length) throw new PsError(`Cannot find a process with the name "${c.str('Name')}". Verify the process name and call the cmdlet again.`, 'ObjectNotFound');
      return list.map(([n, id, cpu]) => ({ Handles: 180 + (id % 900), 'NPM(K)': 12 + (id % 40), 'PM(K)': 2000 + id * 3, 'WS(K)': 6000 + id * 5, 'CPU(s)': cpu.toFixed(2), Id: id, SI: id < 800 ? 0 : 1, ProcessName: n }));
    },
  },
  {
    name: 'Stop-Process', aliases: ['kill', 'spps'], module: 'Core', params: ['Name', 'Id'], positional: ['Name'], synopsis: 'Stops a process.',
    run(c) { throw new PsError(`Cannot stop process "${c.str('Name') || c.str('Id')}" because of the following error: Access is denied`, 'CloseError'); },
  },
  {
    name: 'Get-Service', aliases: ['gsv'], module: 'Core', params: ['Name'], positional: ['Name'], synopsis: 'Lists services.',
    run(c) {
      const want = c.named.Name === undefined ? null : c.str('Name').toLowerCase().replace('*', '');
      const list = SERVICES.filter(([, n, d]) => !want || n.toLowerCase().startsWith(want) || d.toLowerCase().startsWith(want));
      if (want && !list.length) throw new PsError(`Cannot find any service with service name '${c.str('Name')}'.`, 'ObjectNotFound');
      return list.map(([Status, Name, DisplayName]) => ({ Status, Name, DisplayName }));
    },
  },
  { name: 'Get-ExecutionPolicy', module: 'Core', synopsis: 'Shows the PowerShell execution policy.', run: (c) => toStr(c.shell.vars.get('__executionpolicy') ?? 'RemoteSigned') },
  {
    name: 'Set-ExecutionPolicy', module: 'Core', params: ['ExecutionPolicy', 'Scope'], positional: ['ExecutionPolicy'], synopsis: 'Changes the execution policy for this session.',
    run(c) {
      const v = c.str('ExecutionPolicy', true);
      if (!/^(Restricted|AllSigned|RemoteSigned|Unrestricted|Bypass|Undefined)$/i.test(v)) throw new PsError(`Cannot bind parameter 'ExecutionPolicy'. Cannot convert value "${v}" to type "Microsoft.PowerShell.ExecutionPolicy".`, 'InvalidArgument');
      c.shell.vars.set('__executionpolicy', v);
    },
  },
  {
    name: 'Get-Module', aliases: ['gmo'], module: 'Core', switches: ['ListAvailable'], synopsis: 'Lists loaded modules.',
    run: () => [['Manifest', '1.0.1.0', 'ActiveDirectory'], ['Manifest', '1.0.0.0', 'ADSync'], ['Script', '2.25.0', 'Microsoft.Graph.Authentication'], ['Script', '2.25.0', 'Microsoft.Graph.Users'], ['Manifest', '3.1.0.0', 'Microsoft.PowerShell.Management'], ['Manifest', '3.1.0.0', 'Microsoft.PowerShell.Utility']].map(([ModuleType, Version, Name]) => ({ ModuleType, Version, Name })),
  },
  {
    name: 'ipconfig', aliases: ['ipconfig.exe'], module: 'Core', params: ['Switch'], positional: ['Switch'], synopsis: 'Shows network configuration.',
    run(c) {
      const all = /all/i.test(c.str('Switch'));
      return [
        '', 'Windows IP Configuration', '',
        ...(all ? ['   Host Name . . . . . . . . . . . . : MHS-IAM-WKS01', `   Primary Dns Suffix  . . . . . . . : ${c.w.ad.domain}`, '   Node Type . . . . . . . . . . . . : Hybrid', ''] : []),
        'Ethernet adapter Ethernet:', '',
        `   Connection-specific DNS Suffix  . : ${c.w.ad.domain}`,
        ...(all ? ['   Physical Address. . . . . . . . . : 00-15-5D-2A-7C-04', '   DHCP Enabled. . . . . . . . . . . : Yes'] : []),
        '   IPv4 Address. . . . . . . . . . . : 10.10.20.15', '   Subnet Mask . . . . . . . . . . . : 255.255.255.0', '   Default Gateway . . . . . . . . . : 10.10.20.1',
        ...(all ? ['   DNS Servers . . . . . . . . . . . : 10.10.0.10'] : []), '',
      ].join('\n');
    },
  },
  {
    name: 'Test-Connection', module: 'Core', params: ['ComputerName', 'Count'], positional: ['ComputerName'], synopsis: 'Pings a computer.',
    run(c) {
      const name = c.str('ComputerName', true).replace(/\.meridianhealth\.test$/i, '').toUpperCase();
      const comp = c.w.ad.computers.find((x) => x.name === name || x.ip === name);
      const external = /^(8\.8\.8\.8|1\.1\.1\.1|[a-z0-9-]+\.(com|net|org))$/i.test(c.str('ComputerName'));
      if (!comp && !external) throw new PsError(`Ping request could not find host ${c.str('ComputerName')}. Please check the name and try again.`, 'ResourceUnavailable');
      if (comp && !comp.enabled) throw new PsError(`Testing connection to computer '${c.str('ComputerName')}' failed: Request timed out.`, 'ResourceUnavailable');
      const ip = comp?.ip ?? '8.8.8.8';
      const n = Number(c.named.Count ?? 4);
      return Array.from({ length: n }, () => ({ Source: 'MHS-IAM-WKS01', Destination: comp?.name ?? c.str('ComputerName'), IPV4Address: ip, 'Time(ms)': comp ? 1 : 14 }));
    },
  },
  { name: 'Get-Random', module: 'Core', params: ['Minimum', 'Maximum'], pipe: 'all', synopsis: 'Gets a random number or item.', run: (c) => (c.input?.length ? c.input[Math.floor(Math.random() * c.input.length)] : Math.floor(Number(c.named.Minimum ?? 0) + Math.random() * (Number(c.named.Maximum ?? 2147483647) - Number(c.named.Minimum ?? 0)))) },
  {
    name: 'ConvertTo-Json', module: 'Core', params: ['Depth', 'InputObject'], switches: ['Compress'], pipe: 'all', positional: ['InputObject'], synopsis: 'Converts objects to JSON.',
    run(c) {
      const items = c.input?.length ? c.input : c.named.InputObject !== undefined ? [c.named.InputObject] : [];
      const v = toJson(items.length === 1 ? items[0] : items, Number(c.named.Depth ?? 2));
      return JSON.stringify(v, null, c.has('Compress') ? undefined : 4);
    },
  },
  {
    name: 'ConvertFrom-Json', module: 'Core', params: ['InputObject'], positional: ['InputObject'], pipe: 'all', synopsis: 'Converts JSON text to objects.',
    run(c) {
      const text = c.input?.length ? c.input.map(toStr).join('\n') : c.str('InputObject', true);
      try { return JSON.parse(text); } catch { throw new PsError('Conversion from JSON failed with error: Invalid JSON primitive.', 'InvalidArgument'); }
    },
  },
  {
    name: 'Group-Object', aliases: ['group'], module: 'Core', params: ['Property'], positional: ['Property'], pipe: 'all', synopsis: 'Groups objects by a property.',
    run(c) {
      const prop = c.str('Property', true);
      const groups = new Map<string, unknown[]>();
      for (const o of c.input ?? []) { const k = toStr(getProp(o, prop)); groups.set(k, [...(groups.get(k) ?? []), o]); }
      return [...groups.entries()].map(([Name, Group]) => withRef({ Count: Group.length, Name, Group }, { type: 'cloud', key: Name }));
    },
  },
  { name: 'Write-Error', module: 'Core', params: ['Message'], positional: ['Message'], synopsis: 'Writes an error.', run(c) { throw new PsError(c.str('Message'), 'NotSpecified'); } },
  { name: 'Write-Verbose', module: 'Core', params: ['Message'], positional: ['Message'], synopsis: 'Writes verbose output.', run(c) { if (c.has('Verbose')) c.shell.host(`VERBOSE: ${c.str('Message')}`, 'yellow'); } },
  { name: 'Out-String', module: 'Core', pipe: 'all', synopsis: 'Converts objects to text.', run: (c) => (c.input ?? []).map(toStr).join('\n') },
  { name: 'Get-ComputerInfo', module: 'Core', synopsis: 'Shows system information.', run: (c) => ({ CsName: 'MHS-IAM-WKS01', CsDomain: c.w.ad.domain, OsName: 'Microsoft Windows 11 Enterprise', OsVersion: '10.0.22631', OsBuildNumber: '22631', CsProcessors: 'Intel(R) Core(TM) i7-1265U', CsTotalPhysicalMemory: 17179869184, LogonServer: '\\\\MHS-DC01' }) },
  ...PROGRAMS.map(([name, synopsis, aliases]): CmdletDef => ({ name, aliases, module: 'Core', native: true, synopsis, run: (c) => runProgram(c, name.replace(/\.exe$/, '')) })),
  {
    name: 'findstr', aliases: ['findstr.exe'], module: 'Core', native: true, synopsis: 'Shows the lines that contain a text: dir | findstr txt, findstr /i error <file>.',
    run(c) {
      const args = c.pos.map(toStr);
      const flags = args.filter((a) => /^\/\w$/.test(a)).map((a) => a.toLowerCase());
      const rest = args.filter((a) => !/^\/\w$/.test(a));
      const pattern = rest.shift();
      if (pattern === undefined) { c.shell.nativeError('FINDSTR: Bad command line'); return []; }
      let lines = c.input;
      if (!lines) {
        const file = rest[0];
        if (!file) { c.shell.nativeError('FINDSTR: Bad command line'); return []; }
        try { lines = readFile(c.w, c.shell.resolvePath(file)).split('\n'); } catch { c.shell.nativeError(`FINDSTR: Cannot open ${file}`); return []; }
      }
      const ci = flags.includes('/i');
      const words = pattern.split(/\s+/).filter(Boolean).map((x) => (ci ? x.toLowerCase() : x));
      const hit = (l: string): boolean => words.some((x) => (ci ? l.toLowerCase() : l).includes(x));
      return lines.map(toStr).filter((l) => hit(l) !== flags.includes('/v'));
    },
  },
  {
    name: 'Select-String', aliases: ['sls'], module: 'Core', params: ['Pattern', 'Path'], switches: ['SimpleMatch', 'CaseSensitive', 'NotMatch'], positional: ['Pattern', 'Path'], pipe: 'all',
    synopsis: 'Finds text in piped output or in files (PowerShell\'s grep).', example: "Get-Content .\\Documents\\Exports\\IA-2026-14-enabled-accounts.csv | Select-String 'Nursing'",
    run(c) {
      const pattern = c.str('Pattern', true);
      const re = c.has('SimpleMatch') ? null : new RegExp(pattern, c.has('CaseSensitive') ? '' : 'i');
      const test = (l: string): boolean => (re ? re.test(l) : (c.has('CaseSensitive') ? l : l.toLowerCase()).includes(c.has('CaseSensitive') ? pattern : pattern.toLowerCase())) !== c.has('NotMatch');
      if (c.named.Path !== undefined) {
        const path = c.shell.resolvePath(c.str('Path'));
        const name = path.split('\\').pop()!;
        return readFile(c.w, path).replace(/\n$/, '').split('\n').flatMap((l, i) => (test(l) ? [`${name}:${i + 1}:${l}`] : []));
      }
      return c.shell.textOf(c.input ?? []).filter((l) => l.trim() && test(l));
    },
  },
];
