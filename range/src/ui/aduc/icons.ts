/**
 * ui/consoles/aduc/icons.ts — the ADUC glyphs, redrawn as small SVGs.
 *
 * The snap-in is recognised by its icons before anything else: the yellow
 * folder with a book on it is an OU, the plain folder is a container, and a
 * user with a down-arrow badge is disabled. Emoji could not say any of that,
 * so these are drawn to the same shapes and colours, at 16 px for the tree and
 * list and 32 px for the dialogs.
 *
 * Returned as <img> elements with a data: URI, so no markup is ever parsed.
 */

const FOLDER_BACK = '#dcae3b';
const FOLDER_FRONT = '#f4cf5a';
const FOLDER_EDGE = '#b8892a';

const folder = (extra = ''): string =>
  `<path d="M1 4.5h5l1.2-1.5H15v10.5H1z" fill="${FOLDER_BACK}" stroke="${FOLDER_EDGE}" stroke-width=".6"/>` +
  `<path d="M1 6h14v7.5H1z" fill="${FOLDER_FRONT}" stroke="${FOLDER_EDGE}" stroke-width=".6"/>` +
  extra;

/** The OU's "book on a folder": a grey tablet lying on the front flap. */
const ouBook =
  '<path d="M5.2 7.6l5.6-1.4 1.9 4.2-5.6 1.4z" fill="#9aa3ad" stroke="#5d6670" stroke-width=".5"/>' +
  '<path d="M6 8.1l4.3-1.1 1.3 2.9-4.3 1.1z" fill="#dfe4ea"/>';

const head = (cx: number, cy: number, hair: string, scale = 1): string =>
  `<circle cx="${cx}" cy="${cy}" r="${2.6 * scale}" fill="#f1c9a5" stroke="#b98a64" stroke-width=".5"/>` +
  `<path d="M${cx - 2.7 * scale} ${cy - 0.3 * scale}a${2.7 * scale} ${2.9 * scale} 0 0 1 ${5.4 * scale} 0` +
  `c-1-1.4-3.6-1.7-5.4 0z" fill="${hair}"/>`;

const body = (cx: number, top: number, color: string, scale = 1): string =>
  `<path d="M${cx - 4.2 * scale} ${top + 5.5 * scale}c0-3.4 1.9-5.3 4.2-5.3s4.2 1.9 4.2 5.3z" ` +
  `fill="${color}" stroke="#1f4f86" stroke-width=".5"/>`;

const USER = body(8, 9, '#3a7bd5') + head(8, 6, '#5a3a22');
const GROUP =
  body(10.6, 9.2, '#3a7bd5', 0.85) + head(10.6, 6.4, '#3b2a1c', 0.85) +
  body(5.6, 9.6, '#5c9e3f', 0.85) + head(5.6, 6.8, '#7a4b25', 0.85);

/** The disabled badge: a small white disc with a black down arrow. */
const disabledBadge =
  '<circle cx="12" cy="12" r="3.4" fill="#fff" stroke="#222" stroke-width=".8"/>' +
  '<path d="M12 9.8v3.6M10.4 11.8l1.6 1.8 1.6-1.8" stroke="#111" stroke-width="1.1" fill="none"/>';

const star =
  '<path d="M12.5 .8l.9 2 2.1.2-1.6 1.4.5 2.1-1.9-1.1-1.9 1.1.5-2.1-1.6-1.4 2.1-.2z" fill="#f7c600" stroke="#b58a00" stroke-width=".4"/>';

const monitor =
  '<rect x="1.5" y="2.5" width="13" height="9" rx=".8" fill="#e8eef5" stroke="#5c6b7a" stroke-width=".8"/>' +
  '<rect x="3" y="4" width="10" height="6" fill="#4d9be6"/>' +
  '<path d="M6 11.5h4l.8 2H5.2z" fill="#8795a3"/><rect x="4" y="13.3" width="8" height="1.2" fill="#6b7886"/>';

const tower = (x: number): string =>
  `<rect x="${x}" y="1.5" width="5.4" height="12.5" rx=".6" fill="#c9ced4" stroke="#5f6770" stroke-width=".6"/>` +
  `<rect x="${x + 1}" y="3" width="3.4" height=".9" fill="#6f7a86"/>` +
  `<rect x="${x + 1}" y="4.6" width="3.4" height=".9" fill="#6f7a86"/>` +
  `<circle cx="${x + 2.7}" cy="11.6" r=".7" fill="#46b04a"/>`;

const SHAPES = {
  // ── directory objects ─────────────────────────────────────────────────
  root:
    '<rect x="2" y="1.5" width="11" height="13" rx=".8" fill="#f2d27a" stroke="#b8892a" stroke-width=".6"/>' +
    '<rect x="4" y="3" width="7.5" height="10" fill="#fff8e1"/>' +
    '<path d="M5.5 5h4.5M5.5 7h4.5M5.5 9h3" stroke="#8a6d1f" stroke-width=".8"/>',
  domain:
    tower(1.2) + tower(8.8) +
    '<path d="M6.6 8h2.2" stroke="#2f6fb5" stroke-width="1"/>' +
    '<path d="M3 15h10" stroke="#2f6fb5" stroke-width="1"/>',
  container: folder(),
  ou: folder(ouBook),
  savedQueries: folder('<circle cx="10.5" cy="10" r="2" fill="none" stroke="#2f6fb5" stroke-width="1"/>'),
  user: USER,
  userDisabled: USER + disabledBadge,
  group: GROUP,
  computer: monitor,
  computerDisabled: monitor + disabledBadge,
  server: tower(5.3),
  contact:
    '<rect x="2" y="1.5" width="12" height="13" rx="1" fill="#f7f7f7" stroke="#6f7a86" stroke-width=".7"/>' +
    '<path d="M4.5 5h7M4.5 7.5h7M4.5 10h4.5" stroke="#3a9c4a" stroke-width="1.1"/>',
  printer:
    '<rect x="2" y="6" width="12" height="6" rx="1" fill="#b9c0c8" stroke="#5f6770" stroke-width=".6"/>' +
    '<rect x="4" y="2" width="8" height="4.5" fill="#fff" stroke="#5f6770" stroke-width=".6"/>' +
    '<rect x="4" y="10" width="8" height="4" fill="#fff" stroke="#5f6770" stroke-width=".6"/>',

  // ── toolbar ──────────────────────────────────────────────────────────
  back: '<path d="M14 8H4M8 3.5L3.5 8 8 12.5" stroke="#1f6fd1" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  forward: '<path d="M2 8h10M8 3.5l4.5 4.5L8 12.5" stroke="#1f6fd1" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  up: folder('<path d="M8 13V7.5M5.6 9.6L8 7.2l2.4 2.4" stroke="#1d7a2c" stroke-width="1.5" fill="none"/>'),
  tree:
    '<rect x="1.5" y="2" width="13" height="12" fill="#fff" stroke="#5f6770" stroke-width=".8"/>' +
    '<rect x="1.5" y="2" width="13" height="2.2" fill="#3a7bd5"/>' +
    '<path d="M6 4.2V14" stroke="#5f6770" stroke-width=".8"/>' +
    '<path d="M2.8 6.5h2M2.8 8.5h2M2.8 10.5h2" stroke="#9aa3ad" stroke-width=".8"/>',
  properties:
    '<rect x="2.5" y="1.5" width="10" height="13" fill="#fff" stroke="#5f6770" stroke-width=".7"/>' +
    '<path d="M4.5 4.5h6M4.5 6.5h6M4.5 8.5h4" stroke="#7a8591" stroke-width=".8"/>' +
    '<path d="M9.5 10.5l2.8-2.2 1.5 1.5-2.4 2.9-2.3.4z" fill="#e8b93a" stroke="#8a6d1f" stroke-width=".5"/>',
  refresh:
    '<path d="M13 7.2A5 5 0 0 0 4.1 4.6" stroke="#2c9a3c" stroke-width="1.8" fill="none"/>' +
    '<path d="M3 1.8v3.6h3.6z" fill="#2c9a3c"/>' +
    '<path d="M3 8.8a5 5 0 0 0 8.9 2.6" stroke="#2c9a3c" stroke-width="1.8" fill="none"/>' +
    '<path d="M13 14.2v-3.6H9.4z" fill="#2c9a3c"/>',
  export:
    '<rect x="1.5" y="1.5" width="9" height="12" fill="#fff" stroke="#5f6770" stroke-width=".7"/>' +
    '<path d="M3.5 4.5h5M3.5 6.5h5M3.5 8.5h3" stroke="#7a8591" stroke-width=".8"/>' +
    '<path d="M8 11h6M11.5 8.5L14 11l-2.5 2.5" stroke="#1f6fd1" stroke-width="1.5" fill="none"/>',
  help:
    '<circle cx="8" cy="8" r="6.5" fill="#1f6fd1"/>' +
    '<path d="M6 6.2a2 2 0 1 1 2.7 1.9c-.5.2-.7.6-.7 1.1v.6" stroke="#fff" stroke-width="1.4" fill="none"/>' +
    '<circle cx="8" cy="11.7" r=".9" fill="#fff"/>',
  newUser: USER + star,
  newGroup: GROUP + star,
  newOu: folder(ouBook) + star,
  filter: '<path d="M1.5 2h13l-5 6v5.5l-3 1.5V8z" fill="#8fb8ea" stroke="#1f5fa8" stroke-width=".8"/>',
  find: folder('<circle cx="9.3" cy="9.3" r="2.6" fill="#e3f0ff" stroke="#1f5fa8" stroke-width="1"/><path d="M11.2 11.2l2.6 2.6" stroke="#1f5fa8" stroke-width="1.6"/>'),
  addToGroup: GROUP + '<path d="M12.5 1v5M10 3.5h5" stroke="#1d7a2c" stroke-width="1.6"/>',
  delete: '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="#d13438" stroke-width="2.2" stroke-linecap="round"/>',
  cut: '<circle cx="4.5" cy="12" r="2" fill="none" stroke="#333" stroke-width="1"/><circle cx="11.5" cy="12" r="2" fill="none" stroke="#333" stroke-width="1"/><path d="M5.8 10.5L11 2M10.2 10.5L5 2" stroke="#333" stroke-width="1"/>',
  info:
    '<circle cx="8" cy="8" r="7" fill="#1f6fd1"/><rect x="7.1" y="6.6" width="1.8" height="5.4" fill="#fff"/><circle cx="8" cy="4.5" r="1.1" fill="#fff"/>',
  warning:
    '<path d="M8 1.2L15.2 14H.8z" fill="#f7c600" stroke="#a37e00" stroke-width=".6"/><rect x="7.2" y="5.2" width="1.6" height="5" fill="#222"/><circle cx="8" cy="11.9" r=".95" fill="#222"/>',
  error:
    '<circle cx="8" cy="8" r="7" fill="#d13438"/><path d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4" stroke="#fff" stroke-width="1.7"/>',
  question:
    '<circle cx="8" cy="8" r="7" fill="#1f6fd1"/>' +
    '<path d="M6 6.2a2 2 0 1 1 2.7 1.9c-.5.2-.7.6-.7 1.1v.6" stroke="#fff" stroke-width="1.4" fill="none"/>' +
    '<circle cx="8" cy="11.7" r=".9" fill="#fff"/>',
  flashlight:
    '<path d="M2 11l5-5 3 3-5 5z" fill="#f2c94c" stroke="#8a6d1f" stroke-width=".6"/>' +
    '<path d="M7 6l3-3 3 3-3 3z" fill="#d7dde3" stroke="#5f6770" stroke-width=".6"/>' +
    '<path d="M12 1.5l2.5-1M14.5 3.5l1.2-.3M13.5 .3l.2-1" stroke="#e8b93a" stroke-width=".8"/>',
} satisfies Record<string, string>;

export type IconName = keyof typeof SHAPES;

const cache = new Map<string, string>();

function uri(name: IconName): string {
  let u = cache.get(name);
  if (!u) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${SHAPES[name]}</svg>`;
    u = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    cache.set(name, u);
  }
  return u;
}

/** An <img> of the named glyph at `size` pixels. */
export function icon(name: IconName, size = 16): HTMLImageElement {
  const img = document.createElement('img');
  img.src = uri(name);
  img.width = size;
  img.height = size;
  img.alt = '';
  img.draggable = false;
  img.style.cssText = `width:${size}px;height:${size}px;flex-shrink:0;display:inline-block;vertical-align:middle;`;
  return img;
}
