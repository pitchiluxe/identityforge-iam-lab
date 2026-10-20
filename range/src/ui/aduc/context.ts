/**
 * ui/consoles/aduc/context.ts — what every ADUC dialog needs from the console.
 *
 * Every change goes through the capability registry (`run`), so a click here
 * fires the same service calls and audit events as the cmdlet typed in the
 * terminal. The console, the shell and scripts cannot drift apart.
 */
import { type VmServices, runCapability } from './shim/session';
import { messageBox } from './ui';
import type { AdObj, Dir } from './model';

export interface Aduc {
  conductor: VmServices;
  dir: Dir;
  /** Owner token: dialogs close with the console. */
  owner: object;
  /** View > Advanced Features. */
  advanced(): boolean;
  /**
   * Run a capability. Failures are shown as the snap-in shows them, in a
   * message box; success is silent unless the caller says what to report.
   */
  run(capId: string, args: Record<string, string>, opts?: { quiet?: boolean }): { ok: boolean; message: string };
  refresh(): void;
  /** Select a container in the tree (and optionally an object in the list). */
  reveal(nodeKey: string, objectKey?: string): void;
  openProperties(o: AdObj, tab?: string): void;
  contextMenuFor(o: AdObj, x: number, y: number): void;
}

export function makeRunner(conductor: VmServices, refresh: () => void): Aduc['run'] {
  return (capId, args, opts = {}) => {
    try {
      const message = runCapability(conductor.world(), capId, args);
      conductor.changed();
      refresh();
      return { ok: true, message };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      conductor.changed();
      if (!opts.quiet) messageBox(error, { kind: 'error' });
      return { ok: false, message: error };
    }
  };
}
