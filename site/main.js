// Landing page behaviour: the latest installer link, the access-graph story in
// the hero, and reveal-on-scroll. Everything degrades to plain links and a
// static page without JavaScript.

const REPO = 'pitchiluxe/identityforge-iam-lab';
const RELEASES = `https://github.com/${REPO}/releases/latest`;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- download link
// Point every Download button straight at the newest installer. If GitHub's API
// is unreachable or rate-limited, the buttons keep linking to the releases page.
(async () => {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return;
    const release = await res.json();
    const asset = (release.assets || []).find((a) => /Setup.*\.exe$/i.test(a.name));
    if (!asset) return;
    const mb = (asset.size / 1048576).toFixed(0);
    for (const a of document.querySelectorAll('.js-download')) a.href = asset.browser_download_url;
    for (const s of document.querySelectorAll('.js-size')) s.textContent = `Version ${release.tag_name.replace(/^v/, '')}, ${mb} MB.`;
    const line = document.getElementById('release-line');
    if (line) line.textContent = `Version ${release.tag_name.replace(/^v/, '')} for Windows 10 and 11, 64-bit. ${mb} MB. Free and open source. Updates itself.`;
  } catch {
    /* offline or rate-limited: the releases page link is still correct */
  }
})();

// The exact origin to allow in OLLAMA_ORIGINS for the web edition.
for (const el of document.querySelectorAll('.js-origin')) el.textContent = location.origin;

// ---------------------------------------------------------------- header
const header = document.querySelector('.top');
const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// ---------------------------------------------------------------- the hero story
// A joiner is provisioned with the Registered Nurse birthright, then leaves.
// The event IDs are the Windows Security events these changes really write.
const graph = document.querySelector('.graph');
const phase = document.getElementById('phase');
const log = document.getElementById('log');
const EDGES = ['e1', 'e6', 'e3', 'e2', 'e4', 'e5'];
const GROUP_OF = { e1: 'role-nursing-rn', e2: 'app-carechart', e3: 'grp-nursing-clinical', e4: 'grp-all-staff', e5: 'app-expenseflow', e6: 'grp-vpn-users' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const resFor = (id) => document.querySelector(`.res[data-edge="${id}"]`);

function line(id, text, warn = false) {
  const li = document.createElement('li');
  if (warn) li.className = 'warn';
  const b = document.createElement('b');
  b.textContent = id;
  li.append(b, text);
  log.appendChild(li);
  while (log.children.length > 5) log.firstElementChild.remove();
}

function reset() {
  graph.classList.remove('leaving');
  log.replaceChildren();
  for (const id of EDGES) {
    const p = document.getElementById(id);
    p.classList.remove('on', 'cut');
    resFor(id).classList.remove('on');
  }
}

async function story() {
  for (;;) {
    reset();
    phase.textContent = 'Joiner: provisioned from PeopleHub';
    await sleep(500);
    line('4720', 'A user account was created: nowusu');
    await sleep(700);
    line('4722', 'A user account was enabled: nowusu');
    for (const id of EDGES) {
      await sleep(520);
      document.getElementById(id).classList.add('on');
      resFor(id).classList.add('on');
      line('4728', `Member added: ${GROUP_OF[id]}`);
    }
    await sleep(2600);
    phase.textContent = 'Leaver: last shift ended, access removed';
    graph.classList.add('leaving');
    line('4725', 'A user account was disabled: nowusu', true);
    await sleep(700);
    line('Entra', 'Sign-in sessions revoked for nowusu@meridianhealth.test', true);
    for (const id of [...EDGES].reverse()) {
      await sleep(480);
      const p = document.getElementById(id);
      p.classList.remove('on');
      p.classList.add('cut');
      resFor(id).classList.remove('on');
      line('4729', `Member removed: ${GROUP_OF[id]}`, true);
    }
    await sleep(3400);
  }
}

if (reduced) {
  for (const id of EDGES) { document.getElementById(id).classList.add('on'); resFor(id).classList.add('on'); }
  line('4720', 'A user account was created: nowusu');
  line('4728', 'Member added: role-nursing-rn and 5 more groups');
} else {
  // Only animate while the hero is on screen.
  let started = false;
  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !started) { started = true; story(); }
  }).observe(graph);
}

// ---------------------------------------------------------------- reveal on scroll
const targets = document.querySelectorAll('.block-head, .tools > div, .step, .lab-group, .copilot > *, .install-steps li, .notes p, .shot');
if (!reduced && 'IntersectionObserver' in window) {
  for (const el of targets) el.classList.add('reveal');
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in', 'seen');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -12% 0px' });
  for (const el of targets) io.observe(el);
} else {
  for (const el of document.querySelectorAll('.step')) el.classList.add('seen');
}
