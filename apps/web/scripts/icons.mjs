// Renders the app icons from the header's three-spine mark. Run: node scripts/icons.mjs
import sharp from '../../api/node_modules/sharp/lib/index.js';
import { writeFileSync } from 'node:fs';

/** The mark: accent, tan and ink spines, the last one leaning, as in the header. `pad` is the share of the canvas left empty around it. */
function svg(size, pad, bg = '#FAFAF8', rounded = false) {
  const inner = size * (1 - pad * 2);
  const u = inner / 24; // the header mark is ~22×24 units
  const x0 = (size - 22 * u) / 2 + u;
  const base = (size + 24 * u) / 2;
  const w = 6 * u;
  const gap = 2 * u;
  const r = 1.5 * u;
  const bar = (i, h, fill, rot = 0) =>
    `<rect x="${x0 + i * (w + gap)}" y="${base - h * u}" width="${w}" height="${h * u}" rx="${r}" fill="${fill}" ${rot ? `transform="rotate(${rot} ${x0 + i * (w + gap)} ${base})"` : ''}/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${rounded ? size * 0.22 : 0}" fill="${bg}"/>
  ${bar(0, 24, '#B0592F')}${bar(1, 20, '#D4C5B0')}${bar(2, 22, '#2B2621', 9)}
</svg>`;
}

const out = [
  ['icon-192.png', 192, 0.2],
  ['icon-512.png', 512, 0.2],
  ['maskable-192.png', 192, 0.3],
  ['maskable-512.png', 512, 0.3],
  ['apple-touch-icon.png', 180, 0.2],
];
for (const [name, size, pad] of out) await sharp(Buffer.from(svg(size, pad))).png().toFile(`public/icons/${name}`);
writeFileSync('public/favicon.svg', svg(64, 0.12, '#FAFAF8', true));
console.log('icons written');
