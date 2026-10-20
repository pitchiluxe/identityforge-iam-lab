/**
 * ui/icons.ts — every glyph on the workstation, drawn as SVG.
 *
 * The 16 px directory glyphs are ported from IAM Range
 * (../IAM_virtual-machine/src/ui/consoles/aduc/icons.ts): the yellow folder
 * with a book is an OU, a plain folder is a container, a user with a
 * down-arrow badge is disabled. App icons are drawn in the same spirit at
 * 48 px. Returned as <img> with a data: URI, so no markup is ever parsed.
 */

const FOLDER_BACK = '#dcae3b';
const FOLDER_FRONT = '#f4cf5a';
const FOLDER_EDGE = '#b8892a';

const folder = (extra = ''): string =>
  `<path d="M1 4.5h5l1.2-1.5H15v10.5H1z" fill="${FOLDER_BACK}" stroke="${FOLDER_EDGE}" stroke-width=".6"/>` +
  `<path d="M1 6h14v7.5H1z" fill="${FOLDER_FRONT}" stroke="${FOLDER_EDGE}" stroke-width=".6"/>` + extra;
const ouBook = '<path d="M5.2 7.6l5.6-1.4 1.9 4.2-5.6 1.4z" fill="#9aa3ad" stroke="#5d6670" stroke-width=".5"/><path d="M6 8.1l4.3-1.1 1.3 2.9-4.3 1.1z" fill="#dfe4ea"/>';
const head = (cx: number, cy: number, hair: string, s = 1): string =>
  `<circle cx="${cx}" cy="${cy}" r="${2.6 * s}" fill="#f1c9a5" stroke="#b98a64" stroke-width=".5"/><path d="M${cx - 2.7 * s} ${cy - 0.3 * s}a${2.7 * s} ${2.9 * s} 0 0 1 ${5.4 * s} 0c-1-1.4-3.6-1.7-5.4 0z" fill="${hair}"/>`;
const body = (cx: number, top: number, color: string, s = 1): string =>
  `<path d="M${cx - 4.2 * s} ${top + 5.5 * s}c0-3.4 1.9-5.3 4.2-5.3s4.2 1.9 4.2 5.3z" fill="${color}" stroke="#1f4f86" stroke-width=".5"/>`;
const USER = body(8, 9, '#3a7bd5') + head(8, 6, '#5a3a22');
const GROUP = body(10.6, 9.2, '#3a7bd5', 0.85) + head(10.6, 6.4, '#3b2a1c', 0.85) + body(5.6, 9.6, '#5c9e3f', 0.85) + head(5.6, 6.8, '#7a4b25', 0.85);
const disabledBadge = '<circle cx="12" cy="12" r="3.4" fill="#fff" stroke="#222" stroke-width=".8"/><path d="M12 9.8v3.6M10.4 11.8l1.6 1.8 1.6-1.8" stroke="#111" stroke-width="1.1" fill="none"/>';
const star = '<path d="M12.5 .8l.9 2 2.1.2-1.6 1.4.5 2.1-1.9-1.1-1.9 1.1.5-2.1-1.6-1.4 2.1-.2z" fill="#f7c600" stroke="#b58a00" stroke-width=".4"/>';
const monitor = '<rect x="1.5" y="2.5" width="13" height="9" rx=".8" fill="#e8eef5" stroke="#5c6b7a" stroke-width=".8"/><rect x="3" y="4" width="10" height="6" fill="#4d9be6"/><path d="M6 11.5h4l.8 2H5.2z" fill="#8795a3"/><rect x="4" y="13.3" width="8" height="1.2" fill="#6b7886"/>';
const tower = (x: number): string =>
  `<rect x="${x}" y="1.5" width="5.4" height="12.5" rx=".6" fill="#c9ced4" stroke="#5f6770" stroke-width=".6"/><rect x="${x + 1}" y="3" width="3.4" height=".9" fill="#6f7a86"/><rect x="${x + 1}" y="4.6" width="3.4" height=".9" fill="#6f7a86"/><circle cx="${x + 2.7}" cy="11.6" r=".7" fill="#46b04a"/>`;
const page = (fill = '#fff'): string => `<path d="M3 1h7l3 3v11H3z" fill="${fill}" stroke="#6f7a86" stroke-width=".7"/><path d="M10 1v3h3" fill="#e3e8ee" stroke="#6f7a86" stroke-width=".7"/>`;

/** 16 px glyphs (viewBox 0 0 16 16). */
const SMALL = {
  domain: tower(1.2) + tower(8.8) + '<path d="M6.6 8h2.2M3 15h10" stroke="#2f6fb5" stroke-width="1"/>',
  root: '<rect x="2" y="1.5" width="11" height="13" rx=".8" fill="#f2d27a" stroke="#b8892a" stroke-width=".6"/><rect x="4" y="3" width="7.5" height="10" fill="#fff8e1"/><path d="M5.5 5h4.5M5.5 7h4.5M5.5 9h3" stroke="#8a6d1f" stroke-width=".8"/>',
  container: folder(),
  ou: folder(ouBook),
  savedQueries: folder('<circle cx="10.5" cy="10" r="2" fill="none" stroke="#2f6fb5" stroke-width="1"/>'),
  user: USER,
  userDisabled: USER + disabledBadge,
  group: GROUP,
  computer: monitor,
  computerDisabled: monitor + disabledBadge,
  server: tower(5.3),
  back: '<path d="M14 8H4M8 3.5L3.5 8 8 12.5" stroke="#1f6fd1" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  forward: '<path d="M2 8h10M8 3.5l4.5 4.5L8 12.5" stroke="#1f6fd1" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  up: folder('<path d="M8 13V7.5M5.6 9.6L8 7.2l2.4 2.4" stroke="#1d7a2c" stroke-width="1.5" fill="none"/>'),
  properties: '<rect x="2.5" y="1.5" width="10" height="13" fill="#fff" stroke="#5f6770" stroke-width=".7"/><path d="M4.5 4.5h6M4.5 6.5h6M4.5 8.5h4" stroke="#7a8591" stroke-width=".8"/><path d="M9.5 10.5l2.8-2.2 1.5 1.5-2.4 2.9-2.3.4z" fill="#e8b93a" stroke="#8a6d1f" stroke-width=".5"/>',
  refresh: '<path d="M13 7.2A5 5 0 0 0 4.1 4.6" stroke="#2c9a3c" stroke-width="1.8" fill="none"/><path d="M3 1.8v3.6h3.6z" fill="#2c9a3c"/><path d="M3 8.8a5 5 0 0 0 8.9 2.6" stroke="#2c9a3c" stroke-width="1.8" fill="none"/><path d="M13 14.2v-3.6H9.4z" fill="#2c9a3c"/>',
  export: '<rect x="1.5" y="1.5" width="9" height="12" fill="#fff" stroke="#5f6770" stroke-width=".7"/><path d="M3.5 4.5h5M3.5 6.5h5M3.5 8.5h3" stroke="#7a8591" stroke-width=".8"/><path d="M8 11h6M11.5 8.5L14 11l-2.5 2.5" stroke="#1f6fd1" stroke-width="1.5" fill="none"/>',
  help: '<circle cx="8" cy="8" r="6.5" fill="#1f6fd1"/><path d="M6 6.2a2 2 0 1 1 2.7 1.9c-.5.2-.7.6-.7 1.1v.6" stroke="#fff" stroke-width="1.4" fill="none"/><circle cx="8" cy="11.7" r=".9" fill="#fff"/>',
  newUser: USER + star,
  newGroup: GROUP + star,
  newOu: folder(ouBook) + star,
  filter: '<path d="M1.5 2h13l-5 6v5.5l-3 1.5V8z" fill="#8fb8ea" stroke="#1f5fa8" stroke-width=".8"/>',
  find: folder('<circle cx="9.3" cy="9.3" r="2.6" fill="#e3f0ff" stroke="#1f5fa8" stroke-width="1"/><path d="M11.2 11.2l2.6 2.6" stroke="#1f5fa8" stroke-width="1.6"/>'),
  addToGroup: GROUP + '<path d="M12.5 1v5M10 3.5h5" stroke="#1d7a2c" stroke-width="1.6"/>',
  delete: '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="#d13438" stroke-width="2.2" stroke-linecap="round"/>',
  info: '<circle cx="8" cy="8" r="7" fill="#1f6fd1"/><rect x="7.1" y="6.6" width="1.8" height="5.4" fill="#fff"/><circle cx="8" cy="4.5" r="1.1" fill="#fff"/>',
  warning: '<path d="M8 1.2L15.2 14H.8z" fill="#f7c600" stroke="#a37e00" stroke-width=".6"/><rect x="7.2" y="5.2" width="1.6" height="5" fill="#222"/><circle cx="8" cy="11.9" r=".95" fill="#222"/>',
  error: '<circle cx="8" cy="8" r="7" fill="#d13438"/><path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" stroke="#fff" stroke-width="1.7"/>',
  keySuccess: '<circle cx="5" cy="8" r="3.2" fill="none" stroke="#b58a00" stroke-width="1.6"/><path d="M8 8h7M12.5 8v2.5M14.5 8v2" stroke="#b58a00" stroke-width="1.6"/>',
  lockFail: '<rect x="3" y="7" width="10" height="7.5" rx="1" fill="#f2c94c" stroke="#8a6d1f" stroke-width=".7"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="#6f7a86" stroke-width="1.4"/>',
  log: '<rect x="2" y="1.5" width="12" height="13" rx="1" fill="#fff" stroke="#6f7a86" stroke-width=".7"/><path d="M4.5 5h7M4.5 7.5h7M4.5 10h5" stroke="#2f6fb5" stroke-width="1"/>',
  file: page(),
  textFile: page() + '<path d="M5 7h6M5 9h6M5 11h4" stroke="#7a8591" stroke-width=".7"/>',
  csvFile: page() + '<path d="M5 7h6v6H5zM5 9h6M5 11h6M8 7v6" stroke="#1d7a2c" stroke-width=".7" fill="none"/>',
  psFile: page('#e8eefb') + '<path d="M5 8l2 1.5L5 11M8 11.5h3" stroke="#1d3f8f" stroke-width="1" fill="none"/>',
  batFile: page('#eceff1') + '<rect x="4.5" y="7.5" width="7" height="5" rx=".6" fill="#1f1f1f"/><path d="M5.7 9l1.1.8-1.1.8M7.6 11h1.6" stroke="#e6e6e6" stroke-width=".7" fill="none"/><circle cx="11.6" cy="6" r="1.6" fill="#9e9e9e"/>',
  mdFile: page() + '<path d="M4.5 12V8l1.6 2 1.6-2v4M10 8v4M8.8 10.8l1.2 1.2 1.2-1.2" stroke="#4b5563" stroke-width=".8" fill="none"/>',
  desktop: '<rect x="1.5" y="2.5" width="13" height="9" rx=".8" fill="#3c8de0" stroke="#1f4f86" stroke-width=".7"/><rect x="5" y="12.5" width="6" height="1.4" fill="#6b7886"/>',
  downloads: '<circle cx="8" cy="8" r="6.5" fill="#1f6fd1"/><path d="M8 4v6M5.5 7.8L8 10.3l2.5-2.5M5 12h6" stroke="#fff" stroke-width="1.4" fill="none"/>',
  docs: folder('<rect x="5.5" y="7.5" width="5" height="5" fill="#fff" stroke="#5d6670" stroke-width=".5"/>'),
  thisPc: monitor,
  drive: '<rect x="1.5" y="5" width="13" height="7" rx="1.2" fill="#d5dbe1" stroke="#5f6770" stroke-width=".7"/><rect x="3" y="9" width="5" height="1.2" fill="#2f6fb5"/><circle cx="12" cy="9.6" r=".8" fill="#46b04a"/>',
  lock: '<rect x="3.5" y="7" width="9" height="7" rx="1" fill="#6b7886"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="#6b7886" stroke-width="1.4"/>',
  star,
} satisfies Record<string, string>;

/** 48 px application icons (viewBox 0 0 48 48). */
const APP = {
  aduc:
    '<rect x="5" y="9" width="38" height="31" rx="3" fill="#f4cf5a" stroke="#b8892a" stroke-width="1.2"/><path d="M5 15h38" stroke="#dcae3b" stroke-width="3"/>' +
    '<circle cx="19" cy="25" r="4.5" fill="#f1c9a5" stroke="#b98a64"/><path d="M11.5 37c0-5 3.3-7.5 7.5-7.5s7.5 2.5 7.5 7.5z" fill="#3a7bd5" stroke="#1f4f86"/>' +
    '<circle cx="31" cy="23.5" r="4" fill="#f1c9a5" stroke="#b98a64"/><path d="M24.5 35c0-4.5 2.8-6.8 6.5-6.8s6.5 2.3 6.5 6.8z" fill="#5c9e3f" stroke="#2f6a1f"/>',
  terminal:
    '<rect x="4" y="7" width="40" height="34" rx="6" fill="#1f1f1f"/><rect x="4" y="7" width="40" height="8" rx="6" fill="#3a3a3a"/><rect x="4" y="12" width="40" height="3" fill="#3a3a3a"/>' +
    '<path d="M12 22l7 5-7 5" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 33h12" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="10" cy="11" r="1.4" fill="#60cdff"/>',
  cmd:
    '<rect x="4" y="7" width="40" height="34" rx="4" fill="#0c0c0c" stroke="#5a5a5a" stroke-width="1.5"/><rect x="4" y="7" width="40" height="7" rx="4" fill="#e6e6e6"/><rect x="4" y="11" width="40" height="3" fill="#e6e6e6"/>' +
    '<path d="M11 21l6 4.5-6 4.5" stroke="#e6e6e6" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 31h9" stroke="#e6e6e6" stroke-width="2.6" stroke-linecap="round"/>',
  pen:
    '<circle cx="24" cy="24" r="19" fill="#0f6cbd"/><path d="M15 33l2-7 13-13 5 5-13 13z" fill="#fff"/><path d="M28 15l5 5" stroke="#0f6cbd" stroke-width="2"/><path d="M15 33l2-7 5 5z" fill="#ffb900"/>',
  markdown:
    '<rect x="5" y="10" width="38" height="28" rx="4" fill="#fff" stroke="#1f2937" stroke-width="2.4"/><path d="M11 31V17l5 6 5-6v14" stroke="#1f2937" stroke-width="3" fill="none" stroke-linejoin="round" stroke-linecap="round"/><path d="M32 17v13M27 25l5 5 5-5" stroke="#0f6cbd" stroke-width="3" fill="none" stroke-linejoin="round" stroke-linecap="round"/>',
  security:
    '<path d="M24 5l16 6v11c0 10-7 17-16 21C15 39 8 32 8 22V11z" fill="#0f6cbd"/><path d="M24 5l16 6v11c0 10-7 17-16 21z" fill="#3a96dd"/><path d="M17 24l5 5 10-11" stroke="#fff" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  rdp:
    '<rect x="5" y="8" width="38" height="26" rx="3" fill="#0f6cbd"/><rect x="8" y="11" width="32" height="20" rx="1.5" fill="#9fd3ff"/><path d="M19 34h10l2 5H17z" fill="#78909c"/><rect x="13" y="39" width="22" height="3" rx="1.5" fill="#546e7a"/>' +
    '<path d="M16 21h11M23 17l4 4-4 4" stroke="#0f3b63" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  powershell:
    '<rect x="4" y="7" width="40" height="34" rx="5" fill="#2671be"/><rect x="4" y="7" width="40" height="34" rx="5" fill="url(#g)" opacity=".35"/>' +
    '<path d="M13 17l10 7-10 7" stroke="#fff" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M25 32h11" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>',
  browser:
    '<circle cx="24" cy="24" r="18" fill="#1e88e5"/><circle cx="24" cy="24" r="18" fill="url(#b)"/>' +
    '<path d="M6 24h36M24 6c-6 5-6 31 0 36M24 6c6 5 6 31 0 36M9 15h30M9 33h30" stroke="#e3f2fd" stroke-width="1.6" fill="none"/>' +
    '<defs><radialGradient id="b" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#4fc3f7" stop-opacity=".9"/><stop offset="1" stop-color="#0d47a1" stop-opacity=".2"/></radialGradient></defs>',
  explorer:
    '<path d="M4 12h15l3 4h22v24H4z" fill="#dcae3b" stroke="#b8892a"/><path d="M4 19h40v21H4z" fill="#f8d36a" stroke="#c99a2e"/><rect x="4" y="32" width="40" height="3" fill="#2f7bd5" opacity=".85"/>',
  eventviewer:
    '<rect x="9" y="5" width="30" height="38" rx="2" fill="#fff" stroke="#6f7a86" stroke-width="1.4"/><path d="M14 13h20M14 18h20M14 23h14" stroke="#9aa3ad" stroke-width="2"/>' +
    '<path d="M27 25l11 19H16z" fill="#f7c600" stroke="#a37e00"/><rect x="26" y="31" width="2.4" height="7" fill="#222"/><circle cx="27.2" cy="40.5" r="1.3" fill="#222"/>',
  notepad:
    '<rect x="9" y="5" width="30" height="38" rx="2" fill="#fff" stroke="#6f7a86" stroke-width="1.4"/><rect x="9" y="5" width="30" height="7" rx="2" fill="#4aa0e6"/>' +
    '<path d="M14 18h20M14 23h20M14 28h20M14 33h13" stroke="#9aa3ad" stroke-width="2"/>',
  coach:
    '<circle cx="24" cy="24" r="18" fill="#fff" stroke="#c62828" stroke-width="3"/><circle cx="24" cy="24" r="11.5" fill="#fff" stroke="#c62828" stroke-width="3"/><circle cx="24" cy="24" r="5" fill="#c62828"/>' +
    '<path d="M24 24L40 8M35 7l5 1 1 5" stroke="#37474f" stroke-width="2.6" fill="none" stroke-linecap="round"/>',
  career:
    '<rect x="6" y="6" width="36" height="36" rx="4" fill="#fff" stroke="#6f7a86" stroke-width="1.4"/><path d="M12 36V28M20 36V20M28 36V24M36 36V13" stroke="#2f7bd5" stroke-width="4.5" stroke-linecap="round"/>',
  settings:
    '<circle cx="24" cy="24" r="16" fill="#6b7886"/><circle cx="24" cy="24" r="16" fill="none" stroke="#4b5563" stroke-width="7" stroke-dasharray="5 4.4"/><circle cx="24" cy="24" r="6.5" fill="#e5e9ee"/>',
  thisPc:
    '<rect x="5" y="8" width="38" height="25" rx="2.5" fill="#2b88d8" stroke="#185a9d" stroke-width="1.4"/><rect x="8" y="11" width="32" height="19" rx="1" fill="#9fd3ff"/><path d="M8 26l9-8 6 5 6-6 11 9v4H8z" fill="#4aa3f0"/><path d="M19 33h10l2 6H17z" fill="#b0bec5"/><rect x="13" y="39" width="22" height="3" rx="1.5" fill="#78909c"/>',
  recycle:
    '<path d="M12 14h24l-2.5 28h-19z" fill="#cfd8dc" stroke="#78909c" stroke-width="1.4"/><path d="M10 11h28v4H10z" fill="#b0bec5" stroke="#78909c"/><path d="M19 20v18M24 20v18M29 20v18" stroke="#90a4ae" stroke-width="1.6"/>',
  textFile:
    '<path d="M11 5h18l8 8v30H11z" fill="#fff" stroke="#6f7a86" stroke-width="1.4"/><path d="M29 5v8h8" fill="#e3e8ee" stroke="#6f7a86" stroke-width="1.4"/><path d="M16 21h16M16 26h16M16 31h11" stroke="#9aa3ad" stroke-width="2"/>',
  user:
    '<circle cx="24" cy="18" r="9" fill="#f1c9a5"/><path d="M8 44c0-10 7-15 16-15s16 5 16 15z" fill="#3a7bd5"/>',
  control:
    '<rect x="5" y="7" width="38" height="30" rx="3" fill="#e8eef5" stroke="#5c6b7a" stroke-width="1.4"/><rect x="5" y="7" width="38" height="7" rx="3" fill="#3a7bd5"/><rect x="11" y="19" width="10" height="13" rx="1.5" fill="#46b04a"/><rect x="26" y="19" width="12" height="5" rx="1.5" fill="#f2c94c"/><rect x="26" y="27" width="12" height="5" rx="1.5" fill="#d13438"/><path d="M18 41h12" stroke="#5c6b7a" stroke-width="3"/>',
  network:
    '<rect x="6" y="28" width="12" height="10" rx="1.5" fill="#4d9be6" stroke="#1f4f86"/><rect x="30" y="28" width="12" height="10" rx="1.5" fill="#4d9be6" stroke="#1f4f86"/><rect x="18" y="8" width="12" height="10" rx="1.5" fill="#4d9be6" stroke="#1f4f86"/><path d="M24 18v6M12 28v-4h24v4" stroke="#37474f" stroke-width="2.4" fill="none"/>',
  mouse:
    '<rect x="13" y="6" width="22" height="36" rx="11" fill="#e8eef5" stroke="#5c6b7a" stroke-width="1.6"/><path d="M24 6v13M13 19h22" stroke="#5c6b7a" stroke-width="1.6"/><rect x="22.5" y="10" width="3" height="6" rx="1.5" fill="#3a7bd5"/>',
  programs:
    '<rect x="6" y="10" width="36" height="28" rx="3" fill="#fff" stroke="#5c6b7a" stroke-width="1.4"/><rect x="11" y="16" width="10" height="8" fill="#3a7bd5"/><rect x="27" y="16" width="10" height="8" fill="#46b04a"/><rect x="11" y="27" width="10" height="6" fill="#f2c94c"/><rect x="27" y="27" width="10" height="6" fill="#d13438"/>',
  clock:
    '<circle cx="24" cy="24" r="17" fill="#fff" stroke="#3a7bd5" stroke-width="3"/><path d="M24 13v12l8 5" stroke="#37474f" stroke-width="3" fill="none" stroke-linecap="round"/>',
  access:
    '<circle cx="24" cy="24" r="18" fill="#3a7bd5"/><circle cx="24" cy="14" r="3.5" fill="#fff"/><path d="M13 20l11 2 11-2M24 22v8l-5 9M24 30l5 9" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>',
  chrome:
    '<circle cx="24" cy="24" r="20" fill="#db4437"/><path d="M24 4a20 20 0 0 1 17.3 10H24z" fill="#db4437"/><path d="M41.3 14A20 20 0 0 1 24 44l8.7-15z" fill="#f4b400"/><path d="M24 44A20 20 0 0 1 6.7 14l8.7 15z" fill="#0f9d58"/><circle cx="24" cy="24" r="9.5" fill="#fff"/><circle cx="24" cy="24" r="7.5" fill="#4285f4"/>',
  copilot:
    '<defs><linearGradient id="cp" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b88d8"/><stop offset=".5" stop-color="#8661c5"/><stop offset="1" stop-color="#e3008c"/></linearGradient></defs><path d="M10 34c0-12 6-24 16-24h6c4 0 6 3 5 7l-5 17c-1 4-4 6-8 6H14c-3 0-4-3-4-6z" fill="url(#cp)"/><circle cx="21" cy="24" r="2.6" fill="#fff"/><circle cx="29" cy="24" r="2.6" fill="#fff"/>',
  search: '<circle cx="21" cy="21" r="11" fill="none" stroke="currentColor" stroke-width="3.4"/><path d="M29 29l11 11" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/>',
  start:
    '<rect x="6" y="6" width="17" height="17" rx="1.5" fill="#1a73e8"/><rect x="25" y="6" width="17" height="17" rx="1.5" fill="#1a73e8"/><rect x="6" y="25" width="17" height="17" rx="1.5" fill="#1a73e8"/><rect x="25" y="25" width="17" height="17" rx="1.5" fill="#1a73e8"/>',
} satisfies Record<string, string>;

export type SmallIcon = keyof typeof SMALL;
export type AppIcon = keyof typeof APP;

const cache = new Map<string, string>();

function uri(kind: 'small' | 'app', name: string): string {
  const key = `${kind}:${name}`;
  let u = cache.get(key);
  if (!u) {
    const vb = kind === 'small' ? 16 : 48;
    const shape = kind === 'small' ? SMALL[name as SmallIcon] : APP[name as AppIcon];
    u = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb} ${vb}">${shape}</svg>`)}`;
    cache.set(key, u);
  }
  return u;
}

function img(src: string, size: number, cls = ''): HTMLImageElement {
  const i = document.createElement('img');
  i.src = src;
  i.width = size;
  i.height = size;
  i.alt = '';
  i.draggable = false;
  if (cls) i.className = cls;
  i.style.cssText = `width:${size}px;height:${size}px;flex-shrink:0;display:inline-block;vertical-align:middle;`;
  return i;
}

/** A 16 px directory or file glyph. */
export function glyph(name: SmallIcon, size = 16): HTMLImageElement {
  return img(uri('small', name), size);
}

/** An application icon at any size. */
export function appIcon(name: AppIcon, size = 32): HTMLImageElement {
  return img(uri('app', name), size);
}

export function fileGlyph(path: string): SmallIcon {
  if (/\.csv$/i.test(path)) return 'csvFile';
  if (/\.ps1$/i.test(path)) return 'psFile';
  if (/\.(bat|cmd)$/i.test(path)) return 'batFile';
  if (/\.md$/i.test(path)) return 'mdFile';
  return 'textFile';
}
