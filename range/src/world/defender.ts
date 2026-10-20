/**
 * world/defender.ts — what Windows Security's scan finds on the virtual disk.
 *
 * Pure: reads files and returns findings; quarantining is the caller's job.
 * The rules are the ones an IAM engineer meets in practice: the EICAR test
 * file, credential-theft tools, and passwords written in plain text into
 * scripts (the "temporary password in the onboarding script" problem).
 */
import type { VFile } from '../core/types.ts';

export type Severity = 'Severe' | 'High' | 'Medium' | 'Low';

export interface Finding {
  path: string;
  name: string;
  severity: Severity;
  category: string;
  detail: string;
}

const RULES: { name: string; severity: Severity; category: string; detail: string; test: (path: string, text: string) => boolean }[] = [
  {
    name: 'Virus:DOS/EICAR_Test_File', severity: 'Severe', category: 'Virus',
    detail: 'The industry-standard antivirus test file. Harmless, but it is detected on purpose.',
    test: (_p, t) => t.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'),
  },
  {
    name: 'HackTool:Win32/Mimikatz', severity: 'Severe', category: 'HackTool',
    detail: 'Credential-theft tooling: reads passwords and Kerberos tickets from memory (sekurlsa, lsadump).',
    test: (_p, t) => /\b(invoke-mimikatz|mimikatz|sekurlsa::|lsadump::)/i.test(t),
  },
  {
    name: 'HackTool:PowerShell/CredentialDumping', severity: 'High', category: 'HackTool',
    detail: 'Reads the SAM or NTDS.dit database, or dumps LSASS memory.',
    test: (p, t) => /\.(ps1|bat|cmd)$/i.test(p) && /(ntds\.dit|reg\s+save\s+hklm\\sam|procdump.*lsass|comsvcs\.dll.*minidump)/i.test(t),
  },
  {
    name: 'Behavior:Script/PlaintextCredential', severity: 'Medium', category: 'Credential exposure',
    detail: 'A password is written in plain text in a script. Anyone who can read the file can use it; use Read-Host -AsSecureString or a vault.',
    test: (p, t) => /\.(ps1|bat|cmd|txt)$/i.test(p) && (/ConvertTo-SecureString\s+['"][^'"]{6,}['"]\s+-AsPlainText/i.test(t) || /\bnet\s+user\s+\S+\s+(?!\/)[^\s*]{8,}/i.test(t) || /(\$password|\$pwd|password)\s*=\s*['"][^'"$]{8,}['"]/i.test(t)),
  },
];

export function scanFiles(files: readonly VFile[], scope: 'quick' | 'full' = 'quick', folder?: string): Finding[] {
  const quickRoots = /\\(Desktop|Downloads|Documents|AppData)\\/i;
  const out: Finding[] = [];
  for (const f of files) {
    if (f.deleted) continue;
    if (folder && !f.path.toLowerCase().startsWith(`${folder.toLowerCase()}\\`)) continue;
    if (!folder && scope === 'quick' && !quickRoots.test(f.path)) continue;
    for (const r of RULES) {
      if (r.test(f.path, f.content)) {
        out.push({ path: f.path, name: r.name, severity: r.severity, category: r.category, detail: r.detail });
        break;
      }
    }
  }
  return out;
}
