#!/usr/bin/env node
/**
 * build-installer-art.cjs — the pictures the Windows installer shows.
 *
 * NSIS accepts only uncompressed 24-bit BMP at exact sizes: a 164x314 sidebar
 * for the welcome and finish pages, and a 150x57 header for the pages between.
 * sharp cannot write BMP, so the art is rendered to raw pixels and wrapped in
 * a BMP header here (rows bottom-up, padded to four bytes).
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.join(path.dirname(__filename), 'build');
fs.mkdirSync(OUT, { recursive: true });

function encodeBmp(rgb, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const header = Buffer.alloc(54);
  header.write('BM', 0);
  header.writeUInt32LE(54 + rowSize * height, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(rowSize * height, 34);
  header.writeInt32LE(2835, 38);
  header.writeInt32LE(2835, 42);
  const pixels = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y += 1) {
    const src = (height - 1 - y) * width * 3;
    for (let x = 0; x < width; x += 1) {
      pixels[y * rowSize + x * 3] = rgb[src + x * 3 + 2];
      pixels[y * rowSize + x * 3 + 1] = rgb[src + x * 3 + 1];
      pixels[y * rowSize + x * 3 + 2] = rgb[src + x * 3];
    }
  }
  return Buffer.concat([header, pixels]);
}

const BLUE = '#60cdff';
const MUTED = '#9fb3c8';

const sidebar = `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#0f3b63"/><stop offset="1" stop-color="#06121f"/></linearGradient></defs>
  <rect width="164" height="314" fill="url(#bg)"/>
  <g stroke="${BLUE}" stroke-width="0.7" opacity="0.35" fill="none">
    <path d="M82 140 L40 86"/><path d="M82 140 L128 94"/><path d="M82 140 L30 180"/><path d="M82 140 L134 186"/><path d="M82 140 L74 222"/><path d="M82 140 L112 56"/>
  </g>
  <g fill="${BLUE}" opacity="0.6"><circle cx="40" cy="86" r="2.6"/><circle cx="128" cy="94" r="2.6"/><circle cx="30" cy="180" r="2.6"/><circle cx="134" cy="186" r="2.6"/><circle cx="74" cy="222" r="2.6"/><circle cx="112" cy="56" r="2.6"/></g>
  <path d="M74 118h16v14h14v16h-14v14h-16v-14h-14v-16h14z" fill="#ffffff"/>
  <text x="16" y="262" font-family="Segoe UI, sans-serif" font-size="17" font-weight="600" fill="#ffffff">Meridian</text>
  <text x="16" y="281" font-family="Segoe UI, sans-serif" font-size="13" font-weight="600" fill="#ffffff">IAM Range</text>
  <text x="16" y="299" font-family="Segoe UI, sans-serif" font-size="9.5" fill="${MUTED}">Healthcare identity operations</text>
</svg>`;

const header = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57">
  <rect width="150" height="57" fill="#ffffff"/>
  <rect x="12" y="13" width="31" height="31" rx="7" fill="#0f3b63"/>
  <path d="M24 18h7v8h8v7h-8v8h-7v-8h-8v-7h8z" fill="#ffffff"/>
  <text x="51" y="27" font-family="Segoe UI, sans-serif" font-size="11.5" font-weight="600" fill="#0f2236">Meridian IAM Range</text>
  <text x="51" y="40" font-family="Segoe UI, sans-serif" font-size="8" fill="#5b6672">Erick Omari</text>
</svg>`;

async function write(name, svg, width, height) {
  const { data } = await sharp(Buffer.from(svg)).resize(width, height).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  fs.writeFileSync(path.join(OUT, name), encodeBmp(data, width, height));
}

(async () => {
  await write('installerSidebar.bmp', sidebar, 164, 314);
  await write('uninstallerSidebar.bmp', sidebar, 164, 314);
  await write('installerHeader.bmp', header, 150, 57);
  console.log('Installer art written: build/installerSidebar.bmp, build/uninstallerSidebar.bmp, build/installerHeader.bmp');
})().catch((err) => {
  console.error('Installer art failed:', err);
  process.exit(1);
});
