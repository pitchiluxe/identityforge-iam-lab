// Landing page behaviour: the latest installer link, the identity-console
// story in the hero, the workstation that straightens as it scrolls in, the
// tool viewer, the shift timeline and reveal-on-scroll. Shared with the
// walkthrough page, so every part checks its elements exist. Without
// JavaScript the page is a static document with plain links.

const REPO = 'pitchiluxe/identityforge-iam-lab';
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
document.documentElement.classList.add('js');

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
    const version = release.tag_name.replace(/^v/, '');
    for (const a of document.querySelectorAll('.js-download')) a.href = asset.browser_download_url;
    for (const s of document.querySelectorAll('.js-size')) s.textContent = `Version ${version}, ${mb} MB.`;
    const line = document.getElementById('release-line');
    if (line) line.textContent = `Version ${version} for Windows 10 and 11, 64-bit. ${mb} MB. Free and open source. Updates itself.`;
  } catch {
    /* offline or rate-limited: the releases page link is still correct */
  }
})();

// The exact origin to allow in OLLAMA_ORIGINS for the web edition.
for (const el of document.querySelectorAll('.js-origin')) el.textContent = location.origin;

// ---------------------------------------------------------------- mobile menu
const menuBtn = document.querySelector('.menu-btn');
if (menuBtn && header0()) {
  const top = header0();
  const setOpen = (open) => { top.classList.toggle('open', open); menuBtn.setAttribute('aria-expanded', String(open)); menuBtn.textContent = open ? 'Close' : 'Menu'; };
  menuBtn.addEventListener('click', () => setOpen(!top.classList.contains('open')));
  for (const a of top.querySelectorAll('nav a')) a.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && top.classList.contains('open')) { setOpen(false); menuBtn.focus(); } });
}
function header0() { return document.querySelector('.top'); }

// ---------------------------------------------------------------- in-page links
// Smooth scrolling only for clicks on #links. A global scroll-behavior: smooth
// fed back into the scroll-linked effects below and made the page drift.
for (const a of document.querySelectorAll('a[href^="#"]')) {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href').slice(1);
    const target = id ? document.getElementById(id) : null;
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    history.pushState(null, '', `#${id}`);
  });
}

// ---------------------------------------------------------------- header
const header = document.querySelector('.top');
if (header) {
  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// ---------------------------------------------------------------- the hero story
// A joiner is provisioned with the Registered Nurse birthright, then leaves.
// The event IDs are the Windows Security events these changes really write.
const graph = document.querySelector('.graph');
if (graph) {
  const phase = document.getElementById('phase');
  const stateText = document.getElementById('state-text');
  const log = document.getElementById('log');
  const flows = graph.querySelector('.flows');
  const EDGES = ['e1', 'e6', 'e3', 'e2', 'e4', 'e5'];
  const GROUP_OF = { e1: 'role-nursing-rn', e2: 'app-carechart', e3: 'grp-nursing-clinical', e4: 'grp-all-staff', e5: 'app-expenseflow', e6: 'grp-vpn-users' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const resFor = (id) => graph.querySelector(`.res[data-edge="${id}"]`);
  const edge = (id) => document.getElementById(id);
  // A bright pulse travels each edge as access is granted.
  const flowFor = {};
  for (const id of EDGES) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', edge(id).getAttribute('d'));
    flows.appendChild(p);
    flowFor[id] = p;
  }
  let clock = new Date();
  clock.setHours(7, 2, 14, 0);

  function line(id, text, warn = false) {
    clock = new Date(clock.getTime() + 1000 + Math.random() * 4000);
    const li = document.createElement('li');
    if (warn) li.className = 'warn';
    const t = document.createElement('time');
    t.textContent = clock.toTimeString().slice(0, 8);
    const b = document.createElement('b');
    b.textContent = id;
    const s = document.createElement('span');
    s.textContent = text;
    li.append(t, b, s);
    log.appendChild(li);
    while (log.children.length > 6) log.firstElementChild.remove();
  }
  function reset() {
    graph.classList.remove('leaving');
    stateText.textContent = 'Enabled';
    log.replaceChildren();
    for (const id of EDGES) { edge(id).classList.remove('on', 'cut'); resFor(id).classList.remove('on'); }
  }
  async function story() {
    for (;;) {
      reset();
      phase.textContent = 'Joiner: provisioned from PeopleHub';
      await sleep(900);
      line('4720', 'A user account was created: nowusu');
      await sleep(650);
      line('4722', 'A user account was enabled: nowusu');
      for (const id of EDGES) {
        await sleep(560);
        edge(id).classList.add('on');
        const f = flowFor[id];
        f.classList.remove('go'); void f.getBoundingClientRect(); f.classList.add('go');
        setTimeout(() => resFor(id).classList.add('on'), 450);
        line('4728', `Member added: ${GROUP_OF[id]}`);
      }
      await sleep(1200);
      line('Sync', 'Delta sync: nowusu reached Entra ID and CareChart');
      await sleep(2600);
      phase.textContent = 'Leaver: last shift ended, access removed';
      graph.classList.add('leaving');
      stateText.textContent = 'Disabled';
      line('4725', 'A user account was disabled: nowusu', true);
      await sleep(700);
      line('Entra', 'Sign-in sessions revoked for nowusu', true);
      for (const id of [...EDGES].reverse()) {
        await sleep(460);
        edge(id).classList.remove('on');
        edge(id).classList.add('cut');
        resFor(id).classList.remove('on');
        line('4729', `Member removed: ${GROUP_OF[id]}`, true);
      }
      await sleep(3600);
    }
  }
  if (reduced) {
    for (const id of EDGES) { edge(id).classList.add('on'); resFor(id).classList.add('on'); }
    line('4720', 'A user account was created: nowusu');
    line('4728', 'Member added: role-nursing-rn and 5 more groups');
  } else {
    let started = false;
    new IntersectionObserver((entries) => { if (entries[0].isIntersecting && !started) { started = true; story(); } }).observe(graph);
  }
}

// ---------------------------------------------------------------- the workstation straightens as it scrolls in
const monitor = document.getElementById('monitor');
if (monitor && !reduced) {
  let ticking = false;
  const update = () => {
    ticking = false;
    const r = monitor.getBoundingClientRect();
    const vh = window.innerHeight;
    // 0 when the top of the screenshot is at the bottom of the viewport, 1 when it reaches a third of the way up.
    const p = Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.66)));
    monitor.style.setProperty('--tilt', `${(1 - p) * 18}deg`);
    monitor.style.setProperty('--scale', String(0.92 + p * 0.08));
  };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  window.addEventListener('resize', update);
  update();
}

// ---------------------------------------------------------------- tool viewer (tabs)
const tabs = [...document.querySelectorAll('.viewer-tabs [role="tab"]')];
const viewerImg = document.getElementById('viewer-img');
if (tabs.length && viewerImg) {
  // Warm the cache so switching is instant.
  for (const t of tabs) { const i = new Image(); i.src = t.dataset.img; }
  const select = (tab, focus = false) => {
    if (tab.getAttribute('aria-selected') === 'true') return;
    for (const t of tabs) { const on = t === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; }
    document.getElementById('p-view').setAttribute('aria-labelledby', tab.id);
    if (focus) tab.focus();
    if (reduced) { viewerImg.src = tab.dataset.img; viewerImg.alt = tab.dataset.alt; return; }
    viewerImg.classList.add('swap');
    setTimeout(() => {
      viewerImg.src = tab.dataset.img;
      viewerImg.alt = tab.dataset.alt;
      const show = () => viewerImg.classList.remove('swap');
      if (viewerImg.complete) requestAnimationFrame(show); else viewerImg.addEventListener('load', show, { once: true });
    }, 180);
  };
  for (const t of tabs) {
    t.tabIndex = t.getAttribute('aria-selected') === 'true' ? 0 : -1;
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(t);
      const to = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : null;
      if (to) { e.preventDefault(); select(to, true); }
    });
  }
}

// ---------------------------------------------------------------- the shift timeline fills as you read
const timeline = document.getElementById('timeline');
if (timeline) {
  const steps = [...timeline.children];
  const update = () => {
    const r = timeline.getBoundingClientRect();
    const p = reduced ? 1 : Math.min(1, Math.max(0, (window.innerHeight * 0.8 - r.top) / (r.height + window.innerHeight * 0.25)));
    timeline.style.setProperty('--progress', p.toFixed(3));
    steps.forEach((s, i) => s.classList.toggle('lit', p >= i / steps.length + 0.02 || p === 1));
  };
  window.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
  update();
}

// ---------------------------------------------------------------- reveal on scroll
const chat = document.querySelector('.chat');
const targets = document.querySelectorAll('.block-head, .lab-group, .install-steps li, .notes, .also > div, .facts, .copilot-copy, .author, .finale h2, .walk-steps > li');
if (!reduced && 'IntersectionObserver' in window) {
  for (const el of targets) el.classList.add('reveal');
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -10% 0px' });
  for (const el of targets) io.observe(el);
  if (chat) io.observe(chat);
} else if (chat) {
  chat.classList.add('in');
}
