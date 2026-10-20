#!/usr/bin/env node
/**
 * build-icons.cjs — the application icon, as in IAM Range.
 *
 * A hospital cross on a navy tile, with the identity key from IAM Range's mark
 * on its corner: identity operations for a healthcare system.
 *
 * Writes build/icon.svg, PNGs at the sizes Windows and Linux use, a
 * multi-resolution build/icon.ico, public/favicon.svg, and ../site/favicon.svg
 * when the landing page sits next to this folder. Called by the packaging
 * scripts before electron-builder, because an installer built without an icon
 * silently ships Electron's.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIcoMod = require('png-to-ico');
const pngToIco = pngToIcoMod.default || pngToIcoMod.imagesToIco || pngToIcoMod;

const ROOT = path.dirname(__filename);
const OUT = path.join(ROOT, 'build');
const PUB = path.join(ROOT, 'public');
const SITE = path.join(ROOT, '..', 'site');
for (const dir of [OUT, PUB]) fs.mkdirSync(dir, { recursive: true });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f3b63"/>
      <stop offset="1" stop-color="#071a2e"/>
    </linearGradient>
    <linearGradient id="cross" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#cfe9fb"/>
    </linearGradient>
  </defs>
  <rect x="26" y="26" width="460" height="460" rx="96" fill="url(#tile)"/>
  <rect x="26" y="26" width="460" height="460" rx="96" fill="none" stroke="#3aa0e0" stroke-opacity="0.55" stroke-width="6"/>
  <g stroke="#60cdff" stroke-opacity="0.35" stroke-width="5" fill="none">
    <path d="M256 236 L120 120"/><path d="M256 236 L392 118"/><path d="M256 236 L110 360"/>
  </g>
  <g fill="#60cdff" fill-opacity="0.6"><circle cx="120" cy="120" r="12"/><circle cx="392" cy="118" r="12"/><circle cx="110" cy="360" r="12"/></g>
  <path d="M212 122h88v92h92v88h-92v92h-88v-92h-92v-88h92z" fill="url(#cross)" stroke="#0a2a47" stroke-width="6" stroke-linejoin="round"/>
  <g transform="translate(330 352)">
    <circle cx="0" cy="0" r="30" fill="#071a2e" stroke="#e8b94a" stroke-width="12"/>
    <rect x="26" y="-6" width="66" height="12" rx="6" fill="#e8b94a"/>
    <rect x="70" y="-6" width="12" height="28" rx="6" fill="#e8b94a"/>
  </g>
</svg>`;

const SIZES = [16, 32, 48, 64, 128, 256, 512];
const ICO_SIZES = [16, 32, 48, 64, 128, 256];

async function main() {
  fs.writeFileSync(path.join(OUT, 'icon.svg'), svg, 'utf8');
  fs.writeFileSync(path.join(PUB, 'favicon.svg'), svg, 'utf8');
  if (fs.existsSync(SITE)) fs.writeFileSync(path.join(SITE, 'favicon.svg'), svg, 'utf8');
  for (const size of SIZES) await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(OUT, `icon-${size}.png`));
  fs.writeFileSync(path.join(OUT, 'icon.ico'), await pngToIco(ICO_SIZES.map((s) => path.join(OUT, `icon-${s}.png`))));
  fs.copyFileSync(path.join(OUT, 'icon-512.png'), path.join(OUT, 'icon.png'));
  console.log('Icons written: build/icon.ico, build/icon.png, build/icon.svg, public/favicon.svg');
}

main().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
