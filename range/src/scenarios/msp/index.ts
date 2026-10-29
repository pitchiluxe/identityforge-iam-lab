/**
 * scenarios/msp/index.ts — the MSP ServiceNow ticket library (company-generic).
 */
import type { MspTemplate } from './lifecycle.ts';
import { mspGreenfield, mspJoiner, mspLeaver, mspMover } from './lifecycle.ts';
import { mspGuest, mspLicense, mspMfaReset, mspRbac, mspRoleRequest } from './cloud.ts';
import { susExport, susGlobalAdmin, susLookalike, susMfaUnverified } from './suspicious.ts';

export type { MspTemplate };

export const MSP_TEMPLATES: readonly MspTemplate[] = [
  mspGreenfield, mspJoiner, mspLeaver, mspMover, mspMfaReset, mspLicense, mspRbac, mspGuest, mspRoleRequest,
  susGlobalAdmin, susMfaUnverified, susLookalike, susExport,
];
