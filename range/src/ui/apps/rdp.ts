/**
 * ui/apps/rdp.ts — Remote Desktop Connection (mstsc), as in IAM Range.
 *
 * Two reasons a service desk opens it:
 *
 *   Help a user: connect to their computer with your OWN admin credentials
 *   and work on their desktop. The desk never knows the user's password.
 *
 *   Verify a sign-in: sign in to the test workstation AS a directory account
 *   to prove a fix worked, without leaving your own session. The domain
 *   checks the account for real (world/directory.ts signIn): wrong password
 *   counts towards lockout, disabled/locked/expired accounts are refused with
 *   Windows' own words, and "must change password" asks for a new one.
 *
 * Either way you land on a remote desktop with a Command Prompt running as
 * that account, and Sign out writes the logoff event.
 */
import { clear, h } from '../dom.ts';
import type { World } from '../../core/types.ts';
import { act, notify, persist, store } from '../store.ts';
import { allDomains, companyWorld, peekCompany } from '../companies.ts';
import { rdpFolders, type RdpFolder } from '../rdpTargets.ts';
import { appIcon } from '../icons.ts';
import { type AppDef, type WinHandle } from '../wm.ts';
import { changeOwnPassword, findUser, signIn, signOutAudit } from '../../world/directory.ts';
import { audit } from '../../world/audit.ts';
import { signInPassword, fmtTime } from '../system.ts';

const TEST_HOST = 'MHS-TEST-WKS01';
const TEST_IP = '10.10.20.50';

type Screen = 'connect' | 'credentials' | 'signin' | 'change' | 'session' | 'ended';

export const rdpApp: AppDef = {
  id: 'rdp',
  title: 'Remote Desktop Connection',
  icon: 'rdp',
  width: 1000,
  height: 680,
  mount(host, win: WinHandle) {
    let screen: Screen = 'connect';
    let computer = '';
    let account = '';
    let tempPassword = '';
    let error = '';
    let session: { user: string; host: string; mode: 'help' | 'verify'; started: string } | null = null;
    let ended = '';
    // The company Remote Desktop is working in (Meridian or an MSP customer), and the person picked there.
    let companyId = 'meridian';
    let machine = '';
    // Reading a company (the lists) does not open it; the first write does (no scheduler or save before that).
    const worldOf = (id: string): World => (id === 'meridian' ? store.world : peekCompany(id));
    const W = (): World => worldOf(companyId);
    const actIn = (fn: (w: World) => void, success?: string): boolean => act(fn, success, companyId === 'meridian' ? store.world : companyWorld(companyId));
    /** Where a sign-in is verified: Meridian's test workstation, or the picked person's own computer. */
    const vMachine = () => (companyId === 'meridian' ? null : W().ad.computers.find((c) => c.name === machine) ?? null);
    const vHost = (): string => vMachine()?.name ?? TEST_HOST;
    const vIp = (): string => vMachine()?.ip ?? TEST_IP;
    const root = h('div', { class: 'rdp' });
    host.appendChild(root);

    const go = (s: Screen): void => { screen = s; draw(); };
    const field = (label: string, input: HTMLElement): HTMLElement => h('label', { class: 'rdp-field' }, h('span', null, label), input);

    function connectScreen(): HTMLElement {
      const folders: RdpFolder[] = rdpFolders(allDomains().map((d) => ({ id: d.id, w: worldOf(d.id) })));
      const folder = folders.find((f) => f.id === companyId) ?? folders[0]!;
      if (!folder.people.some((p) => p.machine === machine)) machine = folder.people[0]?.machine ?? '';
      const label = (p: RdpFolder['people'][number]): string => `${p.displayName} — ${p.machine}${p.state === 'ok' ? '' : ` (${p.state})`}`;
      const company = h('select', { class: 'input', 'aria-label': 'Company', onChange: (e: Event) => { companyId = (e.target as HTMLSelectElement).value; machine = ''; error = ''; draw(); } },
        folders.map((f) => h('option', { value: f.id, selected: f.id === folder.id }, `${f.name} (${f.domain})`)));
      const who = h('select', { class: 'input', 'aria-label': 'User', onChange: (e: Event) => { machine = (e.target as HTMLSelectElement).value; draw(); } },
        folder.people.map((p) => h('option', { value: p.machine, selected: p.machine === machine }, label(p))));
      const target = folder.people.find((p) => p.machine === machine);
      const meridian = companyId === 'meridian';
      return h('div', { class: 'rdp-connect' },
        h('div', { class: 'rdp-brand' }, appIcon('rdp', 40), h('div', null, h('span', null, 'Remote Desktop'), h('strong', null, 'Connection'))),
        h('section', { class: 'rdp-card' },
          h('h3', null, 'Choose who you are working on'),
          field('Company:', company),
          folder.people.length ? field('User:', who) : h('p', { class: 'muted' }, `Nobody at ${folder.name} has a computer yet. Create their account first: every new hire gets a workstation.`),
          folder.reclaimed.length ? h('p', { class: 'muted' }, `Reclaimed machines (owner deleted): ${folder.reclaimed.join(', ')}`) : null),
        h('section', { class: 'rdp-card' },
          h('h3', null, 'Help a user: connect to their computer'),
          h('p', { class: 'muted' }, "Sign in with your own admin account and work on their desktop. You never need the user's password."),
          h('div', { class: 'rdp-actions' }, h('button', { class: 'btn primary', type: 'button', disabled: !target, onClick: () => { computer = target!.machine.toUpperCase(); error = ''; go('credentials'); } }, target ? `Connect to ${target.machine}` : 'Connect'))),
        h('section', { class: 'rdp-card' },
          h('h3', null, 'Verify a sign-in: test an account'),
          h('p', { class: 'muted' }, meridian
            ? `Sign in AS a directory account on ${TEST_HOST} (${TEST_IP}) to prove a reset, unlock or new account works. Real refusals: disabled, locked out, expired, wrong password, must change password.`
            : `Sign in AS ${target?.displayName ?? 'the user'} on their own computer to prove a reset, unlock or new account works. Real refusals: disabled, locked out, expired, wrong password, must change password.`),
          h('div', { class: 'rdp-actions' }, h('button', { class: 'btn', type: 'button', disabled: !meridian && !target, onClick: () => { computer = vHost(); account = meridian ? '' : target!.sam; error = ''; go('signin'); } }, `Connect to ${vHost()}`))));
    }

    /** Windows Security: your own credentials for a user's computer. */
    function credentialsScreen(): HTMLElement {
      const comp = W().ad.computers.find((c) => c.name.toUpperCase() === computer);
      const pw = h('input', { class: 'input', type: 'password', placeholder: 'Password', 'aria-label': 'Password' });
      const ok = (): void => {
        if (!comp) { error = `Remote Desktop can't find the computer "${computer}". This might mean that "${computer}" does not belong to the specified network.`; draw(); return; }
        if (!comp.enabled) { error = 'The trust relationship between this workstation and the primary domain failed. (The computer account is disabled in Active Directory.)'; draw(); return; }
        if (pw.value !== signInPassword()) { error = 'The logon attempt failed.'; draw(); return; }
        actIn((w) => audit(w, { source: 'AD', eventId: 4624, action: 'An account was successfully logged on', target: w.player.sam, actor: w.player.sam, origin: comp.name, detail: `Logon type: 10 (RemoteInteractive). Help-desk connection to ${comp.primaryUser}'s computer.` }));
        session = { user: W().player.sam, host: comp.name, mode: 'help', started: new Date().toISOString() };
        error = '';
        go('session');
      };
      pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
      setTimeout(() => pw.focus(), 30);
      return h('div', { class: 'rdp-center' }, h('div', { class: 'rdp-dialog' },
        h('div', { class: 'rdp-dialog-title' }, 'Windows Security'),
        h('div', { class: 'rdp-dialog-body' },
          h('h3', null, 'Enter your credentials'),
          h('p', null, `These credentials will be used to connect to ${computer}${comp?.primaryUser ? ` (${comp.primaryUser}'s computer)` : ''}.`),
          h('input', { class: 'input', value: `${W().ad.netbios}\\${W().player.sam}`, readOnly: true, 'aria-label': 'User name' }),
          pw,
          error ? h('p', { class: 'rdp-error' }, error) : null,
          h('div', { class: 'rdp-actions' }, h('button', { class: 'btn primary', type: 'button', onClick: ok }, 'OK'), h('button', { class: 'btn', type: 'button', onClick: () => { error = ''; go('connect'); } }, 'Cancel')))));
    }

    /** The remote computer's own sign-in screen. */
    function signInScreen(): HTMLElement {
      const user = h('input', { class: 'lk-input', placeholder: 'User name', value: account, autocomplete: 'off', 'aria-label': 'User name', list: 'rdp-users' });
      const pw = h('input', { class: 'lk-input', type: 'password', placeholder: 'Password', 'aria-label': 'Password' });
      const list = h('datalist', { id: 'rdp-users' }, W().ad.users.filter((u) => u.kind === 'user').map((u) => h('option', { value: u.sam }, u.displayName)));
      const submit = (): void => {
        account = user.value.trim();
        if (!account) { error = 'Type a user name.'; draw(); return; }
        let r: ReturnType<typeof signIn> | null = null;
        actIn((w) => { r = signIn(w, account, pw.value, vHost()); });
        const res = r as ReturnType<typeof signIn> | null;
        if (!res) return;
        if (res.ok) { session = { user: res.user.sam, host: vHost(), mode: 'verify', started: new Date().toISOString() }; error = ''; go('session'); return; }
        if (res.reason === 'must-change') { tempPassword = pw.value; account = res.user!.sam; error = ''; go('change'); return; }
        error = res.message;
        draw();
      };
      pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      setTimeout(() => (account ? pw : user).focus(), 30);
      return h('div', { class: 'rdp-remote-login' },
        h('div', { class: 'rdp-conn' }, `Connecting to ${vIp()} (${vHost()})`),
        h('div', { class: 'lk-glass lk-panel rdp-login' },
          h('div', { class: 'lk-avatar', style: 'width:84px;height:84px;font-size:30px' }, '👤'),
          h('div', { class: 'lk-name' }, 'Other user'),
          h('div', { class: 'lk-upn' }, `Sign in to: ${W().ad.netbios}`),
          list,
          h('div', { class: 'rdp-login-fields' }, user, pw),
          error ? h('div', { class: 'lk-msg' }, error) : h('div', { class: 'lk-msg' }),
          h('button', { class: 'lk-btn', type: 'button', onClick: submit }, 'Sign in'),
          h('button', { class: 'rdp-cancel', type: 'button', onClick: () => { error = ''; go('connect'); } }, 'Cancel')));
    }

    function changeScreen(): HTMLElement {
      const p1 = h('input', { class: 'lk-input', type: 'password', placeholder: 'New password', 'aria-label': 'New password' });
      const p2 = h('input', { class: 'lk-input', type: 'password', placeholder: 'Confirm password', 'aria-label': 'Confirm password' });
      const submit = (): void => {
        if (p1.value !== p2.value) { error = 'The passwords don\'t match.'; draw(); return; }
        const okChange = actIn((w) => { changeOwnPassword(w, account, tempPassword, p1.value, vHost()); });
        if (!okChange) { error = 'Unable to update the password. The value provided for the new password does not meet the length, complexity, or history requirements of the domain.'; draw(); return; }
        let r: ReturnType<typeof signIn> | null = null;
        actIn((w) => { r = signIn(w, account, p1.value, vHost()); });
        const res = r as ReturnType<typeof signIn> | null;
        if (res?.ok) { session = { user: res.user.sam, host: vHost(), mode: 'verify', started: new Date().toISOString() }; error = ''; go('session'); }
        else { error = res && !res.ok ? res.message : 'Sign-in failed.'; go('signin'); }
      };
      p2.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      setTimeout(() => p1.focus(), 30);
      return h('div', { class: 'rdp-remote-login' }, h('div', { class: 'lk-glass lk-panel rdp-login' },
        h('div', { class: 'lk-name' }, account),
        h('p', { class: 'lk-upn' }, 'The user\'s password must be changed before signing in.'),
        h('div', { class: 'rdp-login-fields' }, p1, p2),
        error ? h('div', { class: 'lk-msg' }, error) : h('div', { class: 'lk-msg' }),
        h('button', { class: 'lk-btn', type: 'button', onClick: submit }, 'Change password and sign in'),
        h('button', { class: 'rdp-cancel', type: 'button', onClick: () => { error = ''; go('signin'); } }, 'Cancel')));
    }

    /**
     * The remote machine's screen is the IAM Range workstation (vendored under
     * public/remote-pc from ../IAM_virtual-machine), with all of its apps. It is
     * kept across redraws so the remote session does not reload while you work.
     */
    let remoteFrame: HTMLIFrameElement | null = null;

    function sessionScreen(): HTMLElement {
      const s = session!;
      const u = findUser(W(), s.user);
      const signOut = (): void => {
        actIn((w) => signOutAudit(w, s.user, s.host));
        ended = `${s.mode === 'verify' ? `${s.user} signed out of ${s.host}.` : `You signed out of ${s.host}.`} The session lasted from ${fmtTime(new Date(s.started))} to ${fmtTime(new Date())}.`;
        session = null;
        remoteFrame = null;
        go('ended');
      };
      const disconnect = (): void => {
        ended = `Your remote session to ${s.host} was disconnected. The user is still signed in there.`;
        session = null;
        remoteFrame = null;
        go('ended');
      };
      remoteFrame ??= h('iframe', { class: 'rdp-remote', src: `${import.meta.env.BASE_URL}remote-pc/index.html`, title: `${s.host} (Remote Desktop)` });
      const who = `${W().ad.netbios}\\${s.user} \u00b7 ${s.mode === 'verify' ? 'sign-in verified by the domain controller' : `helping ${W().ad.computers.find((c) => c.name === s.host)?.primaryUser ?? 'the user'}`}`;
      return h('div', { class: 'rdp-session rdp-session-remote' },
        h('div', { class: 'rdp-bar', role: 'toolbar', 'aria-label': 'Connection bar' },
          h('span', { class: 'mdl' }, '\ue8af'), h('strong', null, s.host), h('span', { class: 'rdp-bar-who' }, `${u?.displayName ?? s.user} \u00b7 ${who}`),
          h('button', { class: 'rdp-bar-btn rdp-bar-text', type: 'button', title: 'Sign out', onClick: signOut }, 'Sign out'),
          h('button', { class: 'rdp-bar-btn', type: 'button', title: 'Disconnect', onClick: disconnect }, '\ue711')),
        remoteFrame);
    }

    function endedScreen(): HTMLElement {
      return h('div', { class: 'rdp-center' }, h('div', { class: 'rdp-dialog' },
        h('div', { class: 'rdp-dialog-title' }, 'Remote Desktop Connection'),
        h('div', { class: 'rdp-dialog-body' }, h('p', null, ended), h('p', { class: 'muted' }, 'The sign-in and sign-out are in Event Viewer (4624, 4634) and in the audit log the lab grades.'),
          h('div', { class: 'rdp-actions' }, h('button', { class: 'btn primary', type: 'button', onClick: () => go('connect') }, 'Reconnect'), h('button', { class: 'btn', type: 'button', onClick: () => win.close() }, 'Close')))));
    }

    function draw(): void {
      clear(root);
      win.setTitle(screen === 'session' && session ? `${session.host} - Remote Desktop Connection` : 'Remote Desktop Connection');
      root.appendChild(screen === 'connect' ? connectScreen() : screen === 'credentials' ? credentialsScreen() : screen === 'signin' ? signInScreen() : screen === 'change' ? changeScreen() : screen === 'session' ? sessionScreen() : endedScreen());
    }
    draw();
    // A world change elsewhere must not tear down the live session view.
    return { redraw: () => { if (screen !== 'session') draw(); }, dispose: () => { if (session) { actIn((w) => signOutAudit(w, session!.user, session!.host)); persist(); notify(); } } };
  },
};
