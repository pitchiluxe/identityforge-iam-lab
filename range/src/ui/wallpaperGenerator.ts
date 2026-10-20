/**
 * util/wallpaperGenerator.ts — wallpapers the machine makes for itself.
 *
 * There is no image model here. Ollama runs llama3.2, which writes text; a
 * diffusion model is a multi-gigabyte download this product deliberately does
 * not have, and pretending otherwise would put a "Generate" button in front of
 * something that cannot happen offline. So these are generated the way a
 * screensaver is: a seeded random number generator drives a small set of
 * drawing routines, and the result is an SVG.
 *
 * That turns out to be the better answer rather than the consolation prize.
 * Generation is instantaneous, works with no network and no model, is
 * identical on every machine, and is genuinely unbounded — a 32-bit seed is
 * four billion wallpapers.
 *
 * Determinism is what makes them cheap to keep. A generated wallpaper is
 * stored as its seed and nothing else: eight characters instead of a hundred
 * kilobytes of data URI, and re-rendered from that seed on the next launch.
 * localStorage is a few megabytes in total, so storing the images themselves
 * would have let a dozen wallpapers fill it.
 */
import type { Wallpaper } from './wallpapers.ts';

/**
 * mulberry32 — a small, fast, well-distributed seeded generator.
 *
 * Math.random() cannot be used: without a seed the same wallpaper could never
 * be produced twice, and the whole storage scheme depends on regenerating an
 * identical image from its seed.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The palettes.
 *
 * Every one is dark and low-contrast, because a wallpaper sits behind windows
 * full of text all day. A bright or busy background makes a directory console
 * harder to read, which is a real cost for a decorative feature.
 */
const PALETTES: { name: string; bg: [string, string]; ink: string; accent: string }[] = [
  { name: 'Midnight', bg: ['#0a0d12', '#111a24'], ink: '#4ec9b0', accent: '#7fd1c1' },
  { name: 'Cobalt', bg: ['#080f1e', '#12203a'], ink: '#5b8def', accent: '#89b4ff' },
  { name: 'Graphite', bg: ['#0c0c0e', '#1a1a1f'], ink: '#8a95a3', accent: '#c3ccd8' },
  { name: 'Plum', bg: ['#120a18', '#241033'], ink: '#b57edc', accent: '#d3aef0' },
  { name: 'Ember', bg: ['#140b06', '#2a1408'], ink: '#d7853d', accent: '#f0b477' },
  { name: 'Moss', bg: ['#07120c', '#0f2418'], ink: '#5aa871', accent: '#8fd3a3' },
  { name: 'Slate', bg: ['#0b0f14', '#16202b'], ink: '#6b8ba4', accent: '#a3c0d6' },
  { name: 'Rust', bg: ['#150a0a', '#2b1212'], ink: '#c1615b', accent: '#e59a95' },
];

/** What the picture is of. Named so the label describes what you are looking at. */
const MOTIFS = ['Mesh', 'Orbit', 'Lattice', 'Drift', 'Ridge', 'Bloom'] as const;
type Motif = (typeof MOTIFS)[number];

const W = 1920;
const H = 1080;

/** A number between lo and hi. */
function span(r: () => number, lo: number, hi: number): number {
  return lo + r() * (hi - lo);
}

/**
 * An identity graph: nodes joined to their nearer neighbours.
 *
 * The motif this product already uses on the lock screen and the installer
 * artwork, so a generated wallpaper still looks like it belongs to the same
 * piece of software rather than like a screensaver that wandered in.
 */
function mesh(r: () => number, ink: string, accent: string): string {
  const count = Math.round(span(r, 14, 26));
  const nodes = Array.from({ length: count }, () => ({
    x: span(r, 60, W - 60),
    y: span(r, 60, H - 60),
    size: span(r, 2, 5),
  }));

  const edges: string[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    // Join to the two nearest, so the graph is connected without becoming a
    // solid wall of lines.
    const a = nodes[i]!;
    const others = nodes
      .map((n, j) => ({ n, j, d: Math.hypot(n.x - a.x, n.y - a.y) }))
      .filter((o) => o.j !== i)
      .sort((p, q) => p.d - q.d)
      .slice(0, 2);
    for (const o of others) {
      edges.push(`M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${o.n.x.toFixed(1)} ${o.n.y.toFixed(1)}`);
    }
  }

  return (
    `<path d="${edges.join('')}" stroke="${ink}" stroke-width="0.8" fill="none" opacity="0.20"/>` +
    nodes
      .map(
        (n) =>
          `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.size.toFixed(1)}" ` +
          `fill="${accent}" opacity="0.42"/>`,
      )
      .join('')
  );
}

/** Concentric rings around an off-centre point. */
function orbit(r: () => number, ink: string, accent: string): string {
  const cx = span(r, W * 0.3, W * 0.7);
  const cy = span(r, H * 0.3, H * 0.7);
  const rings = Math.round(span(r, 7, 14));
  const gap = span(r, 55, 110);

  const out: string[] = [];
  for (let i = 1; i <= rings; i += 1) {
    const radius = i * gap;
    const dash = r() > 0.6 ? ` stroke-dasharray="${span(r, 4, 22).toFixed(0)} ${span(r, 6, 26).toFixed(0)}"` : '';
    out.push(
      `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${radius.toFixed(0)}" fill="none" ` +
        `stroke="${ink}" stroke-width="${span(r, 0.6, 1.6).toFixed(2)}" ` +
        `opacity="${(0.30 - i * 0.016).toFixed(3)}"${dash}/>`,
    );
  }
  out.push(`<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="7" fill="${accent}" opacity="0.5"/>`);
  return out.join('');
}

/** A skewed grid, like a blueprint seen at an angle. */
function lattice(r: () => number, ink: string, accent: string): string {
  const step = span(r, 70, 130);
  const skew = span(r, -0.35, 0.35);
  const out: string[] = [];
  for (let x = -H; x < W + H; x += step) {
    out.push(`M${x.toFixed(0)} 0L${(x + skew * H).toFixed(0)} ${H}`);
  }
  for (let y = 0; y < H; y += step) {
    out.push(`M0 ${y.toFixed(0)}L${W} ${y.toFixed(0)}`);
  }
  const dots = Math.round(span(r, 5, 12));
  const marks = Array.from({ length: dots }, () => {
    const gx = Math.round(span(r, 1, W / step - 1)) * step;
    const gy = Math.round(span(r, 1, H / step - 1)) * step;
    return `<rect x="${(gx - 4).toFixed(0)}" y="${(gy - 4).toFixed(0)}" width="8" height="8" ` +
      `fill="${accent}" opacity="0.45"/>`;
  }).join('');
  return `<path d="${out.join('')}" stroke="${ink}" stroke-width="0.6" fill="none" opacity="0.13"/>${marks}`;
}

/** Long horizontal curves, like a contour map. */
function drift(r: () => number, ink: string, accent: string): string {
  const lines = Math.round(span(r, 8, 16));
  const amp = span(r, 30, 110);
  const out: string[] = [];
  for (let i = 0; i < lines; i += 1) {
    const y = (H / (lines + 1)) * (i + 1);
    const phase = span(r, 0, Math.PI * 2);
    const pts: string[] = [];
    for (let x = 0; x <= W; x += 60) {
      const yy = y + Math.sin(x / span(r, 240, 420) + phase) * amp * (0.4 + r() * 0.2);
      pts.push(`${x === 0 ? 'M' : 'L'}${x} ${yy.toFixed(1)}`);
    }
    out.push(
      `<path d="${pts.join('')}" fill="none" stroke="${i % 4 === 0 ? accent : ink}" ` +
        `stroke-width="${span(r, 0.7, 1.8).toFixed(2)}" opacity="${span(r, 0.10, 0.28).toFixed(3)}"/>`,
    );
  }
  return out.join('');
}

/** Angular peaks along the lower third. */
function ridge(r: () => number, ink: string, accent: string): string {
  const layers = Math.round(span(r, 3, 6));
  const out: string[] = [];
  for (let i = 0; i < layers; i += 1) {
    const base = H * (0.55 + i * 0.09);
    const pts: string[] = [`M0 ${H}`, `L0 ${base.toFixed(0)}`];
    for (let x = 0; x <= W; x += span(r, 90, 200)) {
      pts.push(`L${x.toFixed(0)} ${(base - span(r, 0, 130)).toFixed(0)}`);
    }
    pts.push(`L${W} ${H}Z`);
    out.push(
      `<path d="${pts.join('')}" fill="${i === layers - 1 ? accent : ink}" ` +
        `opacity="${(0.06 + i * 0.02).toFixed(3)}"/>`,
    );
  }
  return out.join('');
}

/** Soft overlapping discs. */
function bloom(r: () => number, ink: string, accent: string): string {
  const count = Math.round(span(r, 5, 11));
  return Array.from({ length: count }, (_, i) => {
    const cx = span(r, 0, W);
    const cy = span(r, 0, H);
    const rad = span(r, 140, 460);
    return (
      `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${rad.toFixed(0)}" ` +
      `fill="${i % 3 === 0 ? accent : ink}" opacity="${span(r, 0.03, 0.09).toFixed(3)}"/>`
    );
  }).join('');
}

const DRAW: Record<Motif, (r: () => number, ink: string, accent: string) => string> = {
  Mesh: mesh,
  Orbit: orbit,
  Lattice: lattice,
  Drift: drift,
  Ridge: ridge,
  Bloom: bloom,
};

/** Encode a seed as the id, so the wallpaper can be rebuilt from it alone. */
export function seedToId(seed: number, kind: 'wall' | 'lock'): string {
  return `gen-${kind}-${(seed >>> 0).toString(36)}`;
}

/** Read the seed back out of an id, or null if this is not a generated one. */
export function idToSeed(id: string): { seed: number; kind: 'wall' | 'lock' } | null {
  const m = /^gen-(wall|lock)-([0-9a-z]+)$/.exec(id);
  if (!m) return null;
  const seed = parseInt(m[2]!, 36);
  if (!Number.isFinite(seed)) return null;
  return { seed, kind: m[1] as 'wall' | 'lock' };
}

/**
 * Build one wallpaper from a seed.
 *
 * Pure: the same seed gives the same image on every machine and every launch,
 * which is what lets a saved wallpaper be eight characters rather than a
 * hundred kilobytes.
 */
export function generateWallpaper(seed: number, kind: 'wall' | 'lock' = 'wall'): Wallpaper {
  const r = rng(seed);
  const palette = PALETTES[Math.floor(r() * PALETTES.length)]!;
  const motif = MOTIFS[Math.floor(r() * MOTIFS.length)]!;
  const angle = Math.round(span(r, 100, 200));

  // A lock screen is looked at head-on with text over it, so it is drawn
  // quieter than a desktop that spends its life behind windows.
  const strength = kind === 'lock' ? 0.75 : 1;

  const art = DRAW[motif](r, palette.ink, palette.accent);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' ` +
    `viewBox='0 0 ${W} ${H}'>` +
    `<defs><linearGradient id='g' gradientTransform='rotate(${angle})'>` +
    `<stop offset='0' stop-color='${palette.bg[0]}'/>` +
    `<stop offset='1' stop-color='${palette.bg[1]}'/>` +
    `</linearGradient></defs>` +
    `<rect width='${W}' height='${H}' fill='url(#g)'/>` +
    `<g opacity='${strength}'>${art}</g>` +
    `</svg>`;

  return {
    id: seedToId(seed, kind),
    label: `${palette.name} ${motif}`,
    gradient: `${palette.bg[0]} url("data:image/svg+xml,${encodeURIComponent(svg)}") center/cover no-repeat`,
  };
}

/** A fresh seed. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/**
 * Generate a batch, avoiding seeds already in the queue.
 *
 * Duplicates are the failure mode that would make the button feel broken:
 * press Generate, get the same six pictures, conclude nothing happened.
 */
export function generateBatch(
  count: number,
  kind: 'wall' | 'lock',
  existingIds: readonly string[] = [],
): Wallpaper[] {
  const taken = new Set(existingIds);
  const out: Wallpaper[] = [];
  let guard = 0;
  while (out.length < count && guard < count * 20) {
    guard += 1;
    const wp = generateWallpaper(randomSeed(), kind);
    if (taken.has(wp.id)) continue;
    taken.add(wp.id);
    out.push(wp);
  }
  return out;
}
