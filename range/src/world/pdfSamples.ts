/**
 * world/pdfSamples.ts — the PDFs on the workstation, in the lab PDF format
 * (core/pdfdoc.ts): a fillable access request form, the acceptable use policy
 * and an exported access review. They open in PDF-XChange Editor.
 */
import { addField, addTextBlock, insertPages, newPdf, writePdf, type BlockKind, type PdfDoc } from '../core/pdfdoc.ts';

export interface SamplePdf { folder: string; name: string; content: string }

function pages(title: string, org: string, body: [BlockKind, string][][]): PdfDoc {
  let d = { ...newPdf(title, `${org} Identity & Access Management`), subject: title };
  if (body.length > 1) d = insertPages(d, 1, body.length - 1);
  body.forEach((blocks, i) => { for (const [kind, text] of blocks) d = addTextBlock(d, i, text, kind); });
  return d;
}

export function samplePdfs(org: string, domain: string): SamplePdf[] {
  let form = pages('Access Request Form', org, [[
    ['title', 'Access Request Form'],
    ['small', `${org} - Identity & Access Management - Form IAM-F-002 rev. 4`],
    ['text', 'Complete every field. Requests without a business justification and the approval of the line manager are returned unprocessed. Privileged access (admin accounts, Tier 0 groups) needs a separate PAM request.'],
    ['heading', 'Requester'],
    ['text', ' '], ['text', ' '], ['text', ' '],
    ['heading', 'Access requested'],
    ['text', ' '], ['text', ' '], ['text', ' '],
    ['heading', 'Approval'],
    ['text', ' '], ['text', ' '],
    ['small', `Return the signed form to the Service Desk or attach it to the ticket. Questions: iam-team@${domain}`],
  ]]);
  // Each field sits on one of the blank lines under its heading (positions are % of the page).
  const field = (name: string, type: 'text' | 'check' | 'date', x: number, y: number, w: number): void => { form = addField(form, { page: 0, name, type, x, y, w, h: type === 'check' ? 1.8 : 2.2 }); };
  field('Requester', 'text', 30, 21.4, 55);
  field('Employee ID', 'text', 30, 24.1, 25);
  field('Department', 'text', 30, 26.7, 40);
  field('System or application', 'text', 30, 33.1, 55);
  field('Group or role', 'text', 30, 35.7, 55);
  field('Business justification', 'text', 30, 38.4, 55);
  field('Manager approved', 'check', 30, 45, 1.8);
  field('Manager name', 'text', 30, 47.4, 32);
  field('Date', 'date', 72, 47.4, 16);

  const aup = pages('Acceptable Use Policy', org, [
    [
      ['title', 'Acceptable Use Policy'],
      ['small', `${org} - Information Security - Policy ISP-01 - Version 3.2`],
      ['heading', '1. Purpose'],
      ['text', `This policy sets out how staff, contractors and partners may use ${org} systems, accounts and data. It applies to every account in the ${domain} directory and to every cloud application signed in to with it.`],
      ['heading', '2. Accounts and passwords'],
      ['text', 'Accounts are personal. Never share a password, a one-time code or a session with anyone, including the Service Desk. The Service Desk will never ask for your password.'],
      ['text', 'Passwords must be at least 14 characters and are checked against known-breached lists. Multi-factor authentication is required for remote access and for every cloud application.'],
    ],
    [
      ['heading', '3. Privileged access'],
      ['text', 'Administrators use a separate admin account (adm-*) only for administration, never for email or browsing. Privileged roles are requested through PAM and activated just in time.'],
      ['heading', '4. Leavers and movers'],
      ['text', 'Access ends on the last working day. Managers must raise a leaver request at least five working days in advance. Movers lose access they no longer need on the day of the move.'],
      ['heading', '5. Reporting'],
      ['text', `Report suspected phishing with the Report button in Outlook. Report a lost device or a suspected account compromise to the Service Desk immediately.`],
      ['small', 'Approved by the Chief Information Security Officer. Review annually.'],
    ],
  ]);

  const review = pages('Quarterly Access Review - Finance', org, [
    [
      ['title', 'Quarterly Access Review: Finance'],
      ['small', `Exported from the IGA platform. Campaign Q3 - Reviewer: Finance line manager - ${domain}`],
      ['text', 'Certify each line: keep the access if the person still needs it for their current job, revoke it otherwise. Comment on every revocation.'],
      ['heading', 'grp-finance'],
      ['text', 'Members at export time are listed in the IGA campaign. Compare against PeopleHub before you certify.'],
      ['heading', 'app-payrollpro'],
      ['text', 'PayrollPro has no connector: revocations raise a manual work item for the application owner.'],
      ['small', 'This export is a point-in-time copy. Do not email it outside the company.'],
    ],
  ]);
  return [
    { folder: 'Documents\\Policies', name: 'Access-Request-Form.pdf', content: writePdf(form) },
    { folder: 'Documents\\Policies', name: 'Acceptable-Use-Policy.pdf', content: writePdf(aup) },
    { folder: 'Downloads', name: 'Access-Review-Q3-Finance.pdf', content: writePdf(review) },
  ];
}
