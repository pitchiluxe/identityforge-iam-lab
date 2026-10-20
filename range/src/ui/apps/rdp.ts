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
import { act, notify, persist, store } from '../store.ts';
import { appIcon } from '../icons.ts';
import { type AppDef, type WinHandle } from '../wm.ts';
import { changeOwnPassword, findUser, signIn, signOutAudit } from '../../world/directory.ts';
import { audit } from '../../world/audit.ts';
import { CmdShell } from '../../terminal/cmd.ts';
import { mountCmd } from './console.ts';
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
    const root = h('div', { class: 'rdp' });
    host.appendChild(root);

    const go = (s: Screen): void => { screen = s; draw(); };
    const field = (label: string, input: HTMLElement): HTMLElement => h('label', { class: 'rdp-field' }, h('span', null, label), input);

    function connectScreen(): HTMLElement {
      const machines = store.world.ad.computers.filter((c) => c.enabled && c.primaryUser).sort((a, b) => a.name.localeCompare(b.name));
      const pick = h('select', { class: 'input', 'aria-label': 'Computer' }, machines.map((c) => {
        const u = findUser(store.world, c.primaryUser!);
        return h('option', { value: c.name, selected: c.name === computer }, `${c.name} (${u?.displayName ?? c.primaryUser})`);
      }));
      const typed = h('input', { class: 'input', list: 'rdp-hosts', placeholder: 'Computer name, e.g. MHS-LT-0412', value: computer, 'aria-label': 'Computer' });
      return h('div', { class: 'rdp-connect' },
        h('div', { class: 'rdp-brand' }, appIcon('rdp', 40), h('div', null, h('span', null, 'Remote Desktop'), h('strong', null, 'Connection'))),
        h('section', { class: 'rdp-card' },
          h('h3', null, 'Help a user: connect to their computer'),
          h('p', { class: 'muted' }, 'Sign in with your own admin account and work on their desktop. You never need the user\'s password.'),
          field('Computer:', machines.length ? pick : typed),
          h('div', { class: 'rdp-actions' }, h('button', { class: 'btn primary', type: 'button', onClick: () => { computer = (machines.length ? pick.value : typed.value).trim().toUpperCase(); error = ''; go('credentials'); } }, 'Connect'))),
        h('section', { class: 'rdp-card' },
          h('h3', null, 'Verify a sign-in: test an account'),
          h('p', { class: 'muted' }, `Sign in AS a directory account on ${TEST_HOST} (${TEST_IP}) to prove a reset, unlock or new account works. Real refusals: disabled, locked out, expired, wrong password (counts towards lockout), must change password.`),
          h('div', { class: 'rdp-actions' }, h('button', { class: 'btn', type: 'button', onClick: () => { computer = TEST_HOST; error = ''; go('signin'); } }, `Connect to ${TEST_HOST}`))));
    }

    /** Windows Security: your own credentials for a user's computer. */
    function credentialsScreen(): HTMLElement {
      const comp = store.world.ad.computers.find((c) => c.name.toUpperCase() === computer);
      const pw = h('input', { class: 'input', type: 'password', placeholder: 'Password', 'aria-label': 'Password' });
      const ok = (): void => {
        if (!comp) { error = `Remote Desktop can't find the computer "${computer}". This might mean that "${computer}" does not belong to the specified network.`; draw(); return; }
        if (!comp.enabled) { error = 'The trust relationship between this workstation and the primary domain failed. (The computer account is disabled in Active Directory.)'; draw(); return; }
        if (pw.value !== signInPassword()) { error = 'The logon attempt failed.'; draw(); return; }
        act((w) => audit(w, { source: 'AD', eventId: 4624, action: 'An account was successfully logged on', target: w.player.sam, actor: w.player.sam, origin: comp.name, detail: `Logon type: 10 (RemoteInteractive). Help-desk connection to ${comp.primaryUser}'s computer.` }));
        session = { user: store.world.player.sam, host: comp.name, mode: 'help', started: new Date().toISOString() };
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
          h('input', { class: 'input', value: `${store.world.ad.netbios}\\${store.world.player.sam}`, readOnly: true, 'aria-label': 'User name' }),
          pw,
          error ? h('p', { class: 'rdp-error' }, error) : null,
          h('div', { class: 'rdp-actions' }, h('button', { class: 'btn primary', type: 'button', onClick: ok }, 'OK'), h('button', { class: 'btn', type: 'button', onClick: () => { error = ''; go('connect'); } }, 'Cancel')))));
    }

    /** The remote computer's own sign-in screen. */
    function signInScreen(): HTMLElement {
      const user = h('input', { class: 'lk-input', placeholder: 'User name', value: account, autocomplete: 'off', 'aria-label': 'User name', list: 'rdp-users' });
      const pw = h('input', { class: 'lk-input', type: 'password', placeholder: 'Password', 'aria-label': 'Password' });
      const list = h('datalist', { id: 'rdp-users' }, store.world.ad.users.filter((u) => u.kind === 'user').map((u) => h('option', { value: u.sam }, u.displayName)));
      const submit = (): void => {
        account = user.value.trim();
        if (!account) { error = 'Type a user name.'; draw(); return; }
        let r: ReturnType<typeof signIn> | null = null;
        act((w) => { r = signIn(w, account, pw.value, TEST_HOST); });
        const res = r as ReturnType<typeof signIn> | null;
        if (!res) return;
        if (res.ok) { session = { user: res.user.sam, host: TEST_HOST, mode: 'verify', started: new Date().toISOString() }; error = ''; go('session'); return; }
        if (res.reason === 'must-change') { tempPassword = pw.value; account = res.user!.sam; error = ''; go('change'); return; }
        error = res.message;
        draw();
      };
      pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      setTimeout(() => (account ? pw : user).focus(), 30);
      return h('div', { class: 'rdp-remote-login' },
        h('div', { class: 'rdp-conn' }, `Connecting to ${TEST_IP} (${TEST_HOST})`),
        h('div', { class: 'lk-glass lk-panel rdp-login' },
          h('div', { class: 'lk-avatar', style: 'width:84px;height:84px;font-size:30px' }, '👤'),
          h('div', { class: 'lk-name' }, 'Other user'),
          h('div', { class: 'lk-upn' }, `Sign in to: ${store.world.ad.netbios}`),
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
        const okChange = act((w) => { changeOwnPassword(w, account, tempPassword, p1.value, TEST_HOST); });
        if (!okChange) { error = 'Unable to update the password. The value provided for the new password does not meet the length, complexity, or history requirements of the domain.'; draw(); return; }
        let r: ReturnType<typeof signIn> | null = null;
        act((w) => { r = signIn(w, account, p1.value, TEST_HOST); });
        const res = r as ReturnType<typeof signIn> | null;
        if (res?.ok) { session = { user: res.user.sam, host: TEST_HOST, mode: 'verify', started: new Date().toISOString() }; error = ''; go('session'); }
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

    function sessionScreen(): HTMLElement {
      const s = session!;
      const u = findUser(store.world, s.user);
      const desk = h('div', { class: 'rdp-desk' });
      const consoleHost = h('div', { class: 'rdp-console' });
      let consoleOpen = false;
      const openConsole = (): void => {
        if (consoleOpen) return;
        consoleOpen = true;
        const sh = new CmdShell(store.world, { powershell: () => [{ text: 'PowerShell is restricted by policy on this computer. Use your own workstation.', kind: 'err' }], ask: (p) => window.prompt(p, '') }, undefined, { user: s.user, host: s.host });
        const box = h('div', { class: 'rdp-cmdwin' }, h('div', { class: 'rdp-cmdbar' }, appIcon('cmd', 16), h('span', null, `Command Prompt (${s.host})`), h('button', { class: 'rdp-x', type: 'button', 'aria-label': 'Close', onClick: () => { box.remove(); consoleOpen = false; } }, '')), consoleHost);
        desk.appendChild(box);
        mountCmd(consoleHost, { shell: sh, onExit: () => { box.remove(); consoleOpen = false; } });
      };
      const signOut = (): void => {
        act((w) => signOutAudit(w, s.user, s.host));
        ended = `${s.mode === 'verify' ? `${s.user} signed out of ${s.host}.` : `You signed out of ${s.host}.`} The session lasted from ${fmtTime(new Date(s.started))} to ${fmtTime(new Date())}.`;
        session = null;
        go('ended');
      };
      const disconnect = (): void => {
        ended = `Your remote session to ${s.host} was disconnected. The user is still signed in there.`;
        session = null;
        go('ended');
      };
      const icons = h('div', { class: 'rdp-icons' },
        h('button', { class: 'rdp-icon', type: 'button', onDblclick: openConsole }, appIcon('cmd', 36), h('span', null, 'Command Prompt')),
        h('button', { class: 'rdp-icon', type: 'button', onDblclick: openConsole }, appIcon('thisPc', 36), h('span', null, 'This PC')));
      desk.append(icons, h('div', { class: 'rdp-who' }, h('strong', null, u?.displayName ?? s.user), h('span', null, `${store.world.ad.netbios}\\${s.user} on ${s.host}`), h('span', null, s.mode === 'verify' ? 'Sign-in verified by the domain controller' : `Helping ${store.world.ad.computers.find((c) => c.name === s.host)?.primaryUser ?? 'the user'}`)));
      return h('div', { class: 'rdp-session' },
        h('div', { class: 'rdp-bar', role: 'toolbar', 'aria-label': 'Connection bar' }, h('span', { class: 'mdl' }, ''), h('strong', null, s.host),
          h('button', { class: 'rdp-bar-btn', type: 'button', title: 'Disconnect', onClick: disconnect }, '')),
        desk,
        h('div', { class: 'rdp-taskbar' },
          h('button', { class: 'rdp-start', type: 'button', title: 'Start', onClick: (e: MouseEvent) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            import('../ctxmenu.ts').then(({ showMenu }) => showMenu(r.left, r.top - 120, [
              { label: u?.displayName ?? s.user, bold: true, disabled: true },
              { label: 'Command Prompt', icon: '', onClick: openConsole },
              '-',
              { label: 'Sign out', icon: '', onClick: signOut },
              { label: 'Disconnect', icon: '', onClick: disconnect },
            ])).catch(() => undefined);
          } }, appIcon('start', 20)),
          h('button', { class: 'rdp-tb', type: 'button', title: 'Command Prompt', onClick: openConsole }, appIcon('cmd', 20)),
          h('span', { class: 'rdp-clock' }, fmtTime(new Date()))));
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
    return { redraw: () => { if (screen !== 'session') draw(); }, dispose: () => { if (session) { act((w) => signOutAudit(w, session!.user, session!.host)); persist(); notify(); } } };
  },
};
