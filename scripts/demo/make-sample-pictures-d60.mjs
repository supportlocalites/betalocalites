// Draws one picture for each sample business of the Base44 design (sample-businesses-d60.mjs)
// into public/sample-photos/, large (1600 x 1200) and small (800 x 600). They are drawings, not
// photos, so nobody mistakes a sample business for a real one. A simple scene for each main kind
// of business, in the business's own colours.
// Run again only when the drawings change: node scripts/demo/make-sample-pictures-d60.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { SAMPLE_BUSINESSES_D60 } from './sample-businesses-d60.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', '..', 'public', 'sample-photos');
const W = 1600;
const H = 1200;
const INK = '#1d1d1b';

const ground = (y, fill) => `<rect y="${y}" width="${W}" height="${H - y}" fill="${fill}"/>`;
const sun = (x, y, r, fill) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
const balloon = (x, y, r, fill) => `
  <path d="M${x} ${y + r * 1.15} q ${r * 0.3} ${r * 0.9} 0 ${r * 1.8}" stroke="${INK}" stroke-opacity=".4" stroke-width="3" fill="none"/>
  <ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 1.18}" fill="${fill}"/>`;

const SCENES = {
  parties: (p, i) =>
    `<rect width="${W}" height="${H}" fill="${p.bg}"/>${ground(900, p.bg2)}
     <rect x="420" y="640" width="760" height="280" rx="18" fill="#fff"/>
     <rect x="560" y="420" width="480" height="240" rx="16" fill="${p.a}"/><rect x="640" y="250" width="320" height="190" rx="14" fill="${p.b}"/>
     ${[680, 760, 840, 920].map((x) => `<rect x="${x}" y="180" width="14" height="70" fill="${p.c}"/><ellipse cx="${x + 7}" cy="170" rx="10" ry="18" fill="#f3d27a"/>`).join('')}
     ${balloon(220 + (i % 3) * 30, 300, 90, p.c)}${balloon(1360, 340, 80, p.a)}${balloon(1240, 240, 70, p.b)}`,
  wellness: (p, i) =>
    `<rect width="${W}" height="${H}" fill="${p.bg2}"/>${sun(1200 - (i % 3) * 120, 300, 130, p.b)}
     <path d="M0 760 Q 400 640 800 760 T 1600 760 V1200 H0 z" fill="${p.c}" fill-opacity=".55"/>
     <path d="M0 880 Q 400 800 800 880 T 1600 880 V1200 H0 z" fill="${p.c}"/>
     ${[[640, 880, 150, 60], [800, 790, 120, 50], [920, 720, 90, 40]].map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${p.a}"/>`).join('')}
     <path d="M300 900 C 300 600 520 520 560 460 C 560 640 420 760 300 900 z" fill="${p.a}" fill-opacity=".85"/>`,
  spiritual: (p, i) =>
    `<rect width="${W}" height="${H}" fill="#1f1b2e"/>
     ${Array.from({ length: 40 }, (_, k) => `<circle cx="${(k * 173 + i * 31) % W}" cy="${(k * 97) % 700}" r="${2 + (k % 3)}" fill="#fff" fill-opacity=".7"/>`).join('')}
     <circle cx="1150" cy="280" r="140" fill="#f6efe4"/><circle cx="1210" cy="250" r="130" fill="#1f1b2e"/>
     ${ground(880, p.a)}
     <rect x="740" y="620" width="120" height="260" rx="12" fill="#f6efe4"/><path d="M800 520 C 760 580 770 610 800 620 C 830 610 840 580 800 520 z" fill="#f3d27a"/>
     <circle cx="800" cy="600" r="90" fill="#f3d27a" fill-opacity=".18"/>`,
  beauty: (p, i) =>
    `<rect width="${W}" height="${H}" fill="${p.bg}"/>
     <ellipse cx="560" cy="560" rx="260" ry="330" fill="#fff" stroke="${p.c}" stroke-width="28"/>
     <ellipse cx="560" cy="560" rx="200" ry="270" fill="${p.bg2}"/>
     <rect x="1000" y="380" width="70" height="380" rx="20" fill="${p.a}"/><rect x="990" y="320" width="90" height="80" rx="14" fill="${p.c}"/>
     <rect x="1160" y="460" width="120" height="300" rx="40" fill="${p.b}"/><rect x="1190" y="410" width="60" height="60" rx="10" fill="${INK}" fill-opacity=".7"/>
     ${ground(860, p.a)}<circle cx="${1250 - (i % 3) * 40}" cy="250" r="40" fill="${p.b}" fill-opacity=".6"/>`,
  kids: (p, i) =>
    `<rect width="${W}" height="${H}" fill="${p.bg2}"/>${sun(260, 260, 110, '#f3d27a')}${ground(900, '#9bbf86')}
     ${[[520, 720, p.a], [700, 720, p.b], [880, 720, p.c], [610, 560, p.c], [790, 560, p.a], [700, 400, p.b]]
       .map(([x, y, c], k) => `<rect x="${x}" y="${y}" width="170" height="160" rx="12" fill="${c}"/><text x="${x + 85}" y="${y + 115}" font-family="Georgia, serif" font-weight="700" font-size="96" text-anchor="middle" fill="#fff">${'ABC123'[(k + i) % 6]}</text>`)
       .join('')}
     <circle cx="1240" cy="840" r="70" fill="${p.a}"/><path d="M1180 840 h120" stroke="#fff" stroke-width="10"/>`,
  home: (p, i) =>
    `<rect width="${W}" height="${H}" fill="${p.bg2}"/>${sun(1300, 230, 90, p.b)}${ground(880, '#9bbf86')}
     <rect x="520" y="520" width="560" height="380" fill="#fff"/><path d="M460 540 L800 260 L1140 540 z" fill="${p.a}"/>
     <rect x="740" y="700" width="120" height="200" fill="${p.c}"/><rect x="580" y="600" width="110" height="100" fill="${p.bg}"/><rect x="910" y="600" width="110" height="100" fill="${p.bg}"/>
     ${Array.from({ length: 6 }, (_, k) => `<circle cx="${180 + k * 60 + (i % 2) * 20}" cy="${860 - (k % 2) * 30}" r="46" fill="${p.c}" fill-opacity=".8"/>`).join('')}`,
};

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [i, b] of SAMPLE_BUSINESSES_D60.entries()) {
  for (const [scale, suffix] of [
    [1, ''],
    [0.5, '-small'],
  ]) {
    await page.setViewportSize({ width: W * scale, height: H * scale });
    await page.setContent(
      `<html><body style="margin:0"><div style="width:${W}px;height:${H}px;transform:scale(${scale});transform-origin:0 0">${svg(SCENES[b.scene](b.colours, i))}</div></body></html>`,
    );
    await writeFile(path.join(OUT, `${b.slug}-1${suffix}.jpg`), await page.screenshot({ type: 'jpeg', quality: 72 }));
  }
}
await browser.close();
console.log(`Drew ${SAMPLE_BUSINESSES_D60.length} sample businesses' pictures into public/sample-photos/.`);
