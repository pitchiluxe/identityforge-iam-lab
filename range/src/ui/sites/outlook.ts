/**
 * Outlook on the web (simulated) at mail.meridianhealth.test.
 *
 * Folder pane with unread counts, search, a message list with a reading pane,
 * and the actions people use every day: reply, reply all, forward, delete
 * (to Deleted Items, then for good), archive, junk, flag, mark as read/unread,
 * move, report phishing, drafts and Cc. Opening a message marks it read.
 * Every change goes through world/itsm.ts.
 */
import type { MailFolder, MailMessage } from '../../core/types.ts';
import { fmt } from '../../core/time.ts';
import { fmtTime } from '../system.ts';
import { h } from '../dom.ts';
import { act, store } from '../store.ts';
import { deleteMail, emptyDeletedItems, flagMail, markMailRead, moveMail, quoteForReply, reportPhishing, saveDraft, sendMail } from '../../world/itsm.ts';
import type { Site, SiteCtx } from './common.ts';

const FOLDERS: [MailFolder, string, string][] = [
  ['Inbox', 'Inbox', ''], ['Drafts', 'Drafts', ''], ['Sent', 'Sent Items', ''], ['Deleted', 'Deleted Items', ''],
  ['Junk', 'Junk Email', ''], ['Archive', 'Archive', ''], ['Reported', 'Reported', ''],
];
const label = (f: MailFolder): string => FOLDERS.find((x) => x[0] === f)?.[1] ?? f;
let query = '';
let flaggedOnly = false;

const slug = (f: MailFolder): string => f.toLowerCase();
const folderOf = (s: string | undefined): MailFolder => FOLDERS.find((x) => slug(x[0]) === s)?.[0] ?? 'Inbox';

function open(ctx: SiteCtx, m: MailMessage): void {
  // Opening a message marks it read, as Outlook does.
  if (!m.read) act((w) => { markMailRead(w, m.id, true); });
  ctx.go(m.folder === 'Drafts' ? `/compose/draft/${m.id}` : `/f/${slug(m.folder)}/${m.id}`);
}

function list(ctx: SiteCtx, folder: MailFolder, selected: string | null): HTMLElement {
  const q = query.trim().toLowerCase();
  const msgs = store.world.mail
    .filter((m) => (q ? true : m.folder === folder) && (!flaggedOnly || m.flagged))
    .filter((m) => !q || `${m.fromName} ${m.from} ${m.to} ${m.subject} ${m.body}`.toLowerCase().includes(q))
    .sort((a, b) => b.time.localeCompare(a.time));
  return h('div', { class: 'ol-list', role: 'list' },
    h('div', { class: 'ol-list-head' }, h('strong', null, q ? `Results for "${query}"` : label(folder)),
      h('label', { class: 'ol-filter' }, h('input', { type: 'checkbox', checked: flaggedOnly, onChange: () => { flaggedOnly = !flaggedOnly; ctx.go(ctx.path); } }), 'Flagged'),
      folder === 'Deleted' && !q ? h('button', { class: 'ol-link', type: 'button', onClick: () => act((w) => { emptyDeletedItems(w); }, 'Deleted Items emptied') && ctx.go('/f/deleted') }, 'Empty folder') : null),
    msgs.length ? msgs.map((m) => {
      const who = m.folder === 'Sent' || m.folder === 'Drafts' ? `To: ${m.to || '(no recipient)'}` : m.fromName;
      return h('button', { class: `ol-item ${m.read ? '' : 'unread'} ${m.id === selected ? 'on' : ''}`, type: 'button', role: 'listitem', onClick: () => open(ctx, m) },
        h('span', { class: 'ol-who' }, m.folder === 'Drafts' ? h('span', { class: 'ol-draft' }, '[Draft] ') : null, who),
        h('span', { class: 'ol-time' }, fmtTime(new Date(m.time))),
        h('span', { class: 'ol-subj' }, m.flagged ? h('span', { class: 'ol-flag', 'aria-label': 'Flagged' }, '⚑ ') : null, m.subject || '(no subject)'),
        h('span', { class: 'ol-prev' }, m.body.replace(/\s+/g, ' ').slice(0, 90)));
    }) : h('p', { class: 'ol-empty' }, q ? 'We didn’t find anything.' : folder === 'Inbox' ? 'All caught up.' : 'Nothing in this folder.'));
}

function reading(ctx: SiteCtx, m: MailMessage | undefined): HTMLElement {
  if (!m) return h('div', { class: 'ol-read ol-read-empty' }, h('p', null, 'Select an item to read'));
  const back = `/f/${slug(m.folder)}`;
  const actions: HTMLElement[] = [];
  const btn = (text: string, onClick: () => void, cls = ''): HTMLElement => h('button', { class: `ol-cmd ${cls}`, type: 'button', onClick }, text);
  if (m.folder !== 'Sent' && m.folder !== 'Reported') {
    actions.push(btn('Reply', () => ctx.go(`/compose/reply/${m.id}`)), btn('Reply all', () => ctx.go(`/compose/replyAll/${m.id}`)));
  }
  actions.push(btn('Forward', () => ctx.go(`/compose/forward/${m.id}`)));
  actions.push(btn(m.folder === 'Deleted' ? 'Delete permanently' : 'Delete', () => { if (act((w) => deleteMail(w, m.id), m.folder === 'Deleted' ? 'Deleted permanently' : 'Moved to Deleted Items')) ctx.go(back); }));
  if (m.folder === 'Inbox' || m.folder === 'Junk' || m.folder === 'Deleted') actions.push(btn('Archive', () => { if (act((w) => { moveMail(w, m.id, 'Archive'); }, 'Archived')) ctx.go(back); }));
  if (m.folder === 'Inbox') actions.push(btn('Junk', () => { if (act((w) => { moveMail(w, m.id, 'Junk'); }, 'Moved to Junk Email')) ctx.go(back); }));
  if (m.folder !== 'Inbox' && m.folder !== 'Sent' && m.folder !== 'Drafts' && m.folder !== 'Reported') actions.push(btn('Move to Inbox', () => { if (act((w) => { moveMail(w, m.id, 'Inbox'); }, 'Moved to Inbox')) ctx.go(back); }));
  actions.push(btn('Mark as unread', () => { if (act((w) => { markMailRead(w, m.id, false); })) ctx.go(back); }));
  actions.push(btn(m.flagged ? 'Clear flag' : 'Flag', () => { act((w) => { flagMail(w, m.id, !m.flagged); }); ctx.go(ctx.path); }));
  if (m.folder === 'Inbox' || m.folder === 'Junk') actions.push(btn('Report phishing', () => { if (act((w) => { reportPhishing(w, m.id); }, 'Reported to Security. The message was moved to Reported.')) ctx.go(back); }, 'danger'));
  return h('article', { class: 'ol-read' },
    h('div', { class: 'ol-cmds', role: 'toolbar' }, actions),
    h('h2', null, m.subject || '(no subject)'),
    m.external ? h('p', { class: 'ol-banner' }, 'External sender: this message came from outside Meridian Health System. Do not act on requests in it without verifying through a known channel.') : null,
    m.folder === 'Junk' ? h('p', { class: 'ol-banner' }, 'This message is in Junk Email. Links and attachments are disabled until you move it to the Inbox.') : null,
    h('div', { class: 'ol-from' }, h('span', { class: 'ol-avatar', 'aria-hidden': 'true' }, (m.fromName[0] ?? '?').toUpperCase()),
      h('div', null, h('strong', null, `${m.fromName} <${m.from}>`), h('div', { class: 'ol-meta' }, `To: ${m.to}${m.cc ? ` · Cc: ${m.cc}` : ''}`), h('div', { class: 'ol-meta' }, fmt(m.time)))),
    h('pre', { class: 'ol-body' }, m.body));
}

function compose(ctx: SiteCtx, kind: string | undefined, id: string | undefined): HTMLElement {
  const src = id ? store.world.mail.find((m) => m.id === id) : undefined;
  const draft = kind === 'draft' ? src : undefined;
  const pre = draft ? { to: draft.to, cc: draft.cc ?? '', subject: draft.subject, body: draft.body }
    : src && (kind === 'reply' || kind === 'replyAll' || kind === 'forward') ? quoteForReply(src, kind) : { to: '', cc: '', subject: '', body: '' };
  const to = h('input', { class: 'ol-input', value: pre.to, 'aria-label': 'To', placeholder: 'To' });
  const cc = h('input', { class: 'ol-input', value: pre.cc, 'aria-label': 'Cc', placeholder: 'Cc' });
  const subject = h('input', { class: 'ol-input', value: pre.subject, 'aria-label': 'Subject', placeholder: 'Add a subject' });
  const body = h('textarea', { class: 'ol-input ol-compose-body', rows: 14, 'aria-label': 'Message' }, pre.body);
  setTimeout(() => (pre.to ? body : to).focus(), 30);
  if (pre.to) setTimeout(() => body.setSelectionRange(0, 0), 40);
  return h('section', { class: 'ol-compose' },
    h('div', { class: 'ol-cmds' },
      h('button', { class: 'ol-cmd primary', type: 'button', onClick: () => { if (act((w) => { sendMail(w, to.value, subject.value, body.value, { cc: cc.value, draftId: draft?.id }); }, 'Sent')) ctx.go('/f/sent'); } }, 'Send'),
      h('button', { class: 'ol-cmd', type: 'button', onClick: () => { if (act((w) => { saveDraft(w, { id: draft?.id, to: to.value, cc: cc.value, subject: subject.value, body: body.value }); }, 'Draft saved')) ctx.go('/f/drafts'); } }, 'Save draft'),
      h('button', { class: 'ol-cmd', type: 'button', onClick: () => { if (draft) act((w) => deleteMail(w, draft.id)); ctx.go('/f/inbox'); } }, 'Discard')),
    h('div', { class: 'ol-field' }, h('span', null, 'To'), to),
    h('div', { class: 'ol-field' }, h('span', null, 'Cc'), cc),
    h('div', { class: 'ol-field' }, h('span', null, 'Subject'), subject),
    body);
}

export const outlook: Site = {
  host: 'mail.meridianhealth.test',
  name: 'Outlook on the web',
  short: 'Mail',
  color: '#245fa0',
  render(ctx) {
    const w = store.world;
    const p = ctx.path;
    // Older links: /, /sent, /reported, /compose and /msg/<id> still work.
    const legacy = /^\/msg\/(.+)$/.exec(p);
    const legacyMsg = legacy ? w.mail.find((m) => m.id === legacy[1]) : undefined;
    if (legacyMsg && !legacyMsg.read) queueMicrotask(() => act((x) => { markMailRead(x, legacyMsg.id, true); }));
    const fm = /^\/f\/([a-z]+)(?:\/(.+))?$/.exec(p);
    const cm = /^\/compose(?:\/([a-zA-Z]+)\/(.+))?$/.exec(p);
    const folder: MailFolder = legacyMsg ? legacyMsg.folder : fm ? folderOf(fm[1]) : p.startsWith('/sent') ? 'Sent' : p.startsWith('/reported') ? 'Reported' : 'Inbox';
    const selectedId = legacyMsg?.id ?? fm?.[2] ?? null;
    const selected = selectedId ? w.mail.find((m) => m.id === selectedId) : undefined;
    // A message opened by address is marked read too (links from IAM Coach, notifications).
    if (selected && !selected.read && !legacyMsg) queueMicrotask(() => act((x) => { markMailRead(x, selected.id, true); }));
    const search = h('input', { class: 'ol-search', type: 'search', placeholder: 'Search', value: query, 'aria-label': 'Search mail' });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { query = search.value; ctx.go(`/f/${slug(folder)}`); } if (e.key === 'Escape') { query = ''; ctx.go(`/f/${slug(folder)}`); } });
    const unread = (f: MailFolder): number => w.mail.filter((m) => m.folder === f && !m.read).length;
    const count = (f: MailFolder): number => w.mail.filter((m) => m.folder === f).length;
    return h('div', { class: 'ol' },
      h('header', { class: 'ol-top' }, h('strong', null, 'Outlook'), search, h('span', { class: 'ol-me' }, `${w.player.sam}@meridianhealth.test`)),
      h('div', { class: 'ol-main' },
        h('nav', { class: 'ol-folders', 'aria-label': 'Folders' },
          h('button', { class: 'ol-new', type: 'button', onClick: () => ctx.go('/compose') }, '+ New mail'),
          FOLDERS.map(([f, name, glyph]) => {
            const n = f === 'Drafts' ? count(f) : unread(f);
            return h('a', { href: '#', class: `${f === folder && !cm ? 'on' : ''} ${n && f !== 'Drafts' ? 'has-unread' : ''}`, onClick: (e: Event) => { e.preventDefault(); query = ''; ctx.go(`/f/${slug(f)}`); } },
              h('span', { class: 'ol-ic', 'aria-hidden': 'true' }, glyph), h('span', null, name), n ? h('span', { class: 'ol-count' }, String(n)) : null);
          })),
        cm ? compose(ctx, cm[1], cm[2]) : h('div', { class: 'ol-panes' }, list(ctx, folder, selectedId), reading(ctx, selected))));
  },
};
