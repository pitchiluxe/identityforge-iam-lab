/**
 * terminal/graphAuth.ts — run a world operation for a Graph cmdlet and turn its
 * error into the record Microsoft Graph PowerShell prints.
 */
import { PsError } from './shell.ts';

export function asGraph<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const denied = /Insufficient privileges/.test(msg);
    throw new PsError(`${msg}\nStatus: ${denied ? '403 (Forbidden)' : '400 (BadRequest)'}\nErrorCode: ${denied ? 'Authorization_RequestDenied' : 'Request_BadRequest'}`, denied ? 'PermissionDenied' : 'InvalidOperation', { exception: 'Microsoft.Graph.PowerShell.Runtime.RestException' });
  }
}
