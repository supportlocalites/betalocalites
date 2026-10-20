// Draws the illustrations for the sample businesses (scripts/demo/load-demo-businesses.mjs)
// and saves them in public/sample-photos/, in the two sizes the site uses for photos
// (large 1600 x 1200 and small 800 x 600; profile photos 800 x 800 and 400 x 400).
// They are drawings, not photos, so nobody mistakes a sample business for a real one.
// Run again only when the drawings change: node scripts/demo/make-demo-photos.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { DEMO_BUSINESSES } from './demo-businesses.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', '..', 'public', 'sample-photos');

const W = 1600;
const H = 1200;
const INK = '#1d1d1b';
const CREAM = '#f6f1e7';

// ---- Small drawing pieces -------------------------------------------------------------------
const balloon = (x, y, r, fill, string = true) => `
  ${string ? `<path d="M${x} ${y + r * 1.15} q ${r * 0.3} ${r * 0.9} 0 ${r * 1.8} q ${-r * 0.3} ${r * 0.8} 0 ${r * 1.6}" stroke="${INK}" stroke-opacity=".45" stroke-width="3" fill="none"/>` : ''}
  <ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 1.18}" fill="${fill}"/>
  <path d="M${x - 9} ${y + r * 1.17} l9 -14 l9 14 z" fill="${fill}"/>
  <ellipse cx="${x - r * 0.38}" cy="${y - r * 0.45}" rx="${r * 0.18}" ry="${r * 0.3}" fill="#fff" fill-opacity=".45" transform="rotate(-25 ${x - r * 0.38} ${y - r * 0.45})"/>`;

const bunting = (y, colours, sag = 60) => {
  let s = `<path d="M0 ${y} Q ${W / 2} ${y + sag * 2} ${W} ${y}" stroke="${INK}" stroke-opacity=".5" stroke-width="3" fill="none"/>`;
  for (let i = 0; i < 16; i++) {
    const x = 50 + i * 100;
    const t = x / W;
    const yy = (1 - t) * (1 - t) * y + 2 * (1 - t) * t * (y + sag * 2) + t * t * y;
    s += `<path d="M${x - 34} ${yy} L${x + 34} ${yy} L${x} ${yy + 80} z" fill="${colours[i % colours.length]}"/>`;
  }
  return s;
};

const sky = (top, bottom) => `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>`;

const cloud = (x, y, s) => `<g fill="#fff" fill-opacity=".9">
  <ellipse cx="${x}" cy="${y}" rx="${90 * s}" ry="${45 * s}"/><ellipse cx="${x + 70 * s}" cy="${y - 25 * s}" rx="${70 * s}" ry="${50 * s}"/>
  <ellipse cx="${x + 140 * s}" cy="${y}" rx="${80 * s}" ry="${40 * s}"/></g>`;

const tree = (x, y, s, c = '#5f8a5a') => `<rect x="${x - 12 * s}" y="${y - 40 * s}" width="${24 * s}" height="${120 * s}" fill="#7a5a3c"/>
  <circle cx="${x}" cy="${y - 80 * s}" r="${90 * s}" fill="${c}"/><circle cx="${x - 60 * s}" cy="${y - 40 * s}" r="${60 * s}" fill="${c}"/>
  <circle cx="${x + 60 * s}" cy="${y - 40 * s}" r="${60 * s}" fill="${c}"/>`;

const room = (
  wall,
  floor,
) => `<rect width="${W}" height="${H}" fill="${wall}"/><rect y="${H * 0.68}" width="${W}" height="${H * 0.32}" fill="${floor}"/>
  <rect y="${H * 0.68 - 8}" width="${W}" height="16" fill="${INK}" fill-opacity=".08"/>`;

const confetti = (n, colours, seed = 1) => {
  let s = '';
  let r = seed;
  const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < n; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    s += `<rect x="${x}" y="${y}" width="${10 + rnd() * 10}" height="${20 + rnd() * 10}" fill="${colours[i % colours.length]}" transform="rotate(${rnd() * 180} ${x} ${y})" opacity=".85"/>`;
  }
  return s;
};

const cake = (x, y, s, layers, candles = 5) => {
  let out = `<ellipse cx="${x}" cy="${y + 10 * s}" rx="${260 * s}" ry="${36 * s}" fill="${INK}" fill-opacity=".12"/>
    <rect x="${x - 250 * s}" y="${y - 10 * s}" width="${500 * s}" height="${20 * s}" rx="${10 * s}" fill="#e8e1d2"/>`;
  let top = y - 10 * s;
  layers.forEach(([w, h, fill, trim], i) => {
    top -= h * s;
    out += `<rect x="${x - (w / 2) * s}" y="${top}" width="${w * s}" height="${h * s}" rx="${14 * s}" fill="${fill}"/>
      <path d="M${x - (w / 2) * s} ${top + 18 * s} ${Array.from({ length: 8 }, () => `q ${(w / 16) * s} ${30 * s} ${(w / 8) * s} 0`).join(' ')}" fill="${trim}"/>`;
    if (i === layers.length - 1) {
      for (let c = 0; c < candles; c++) {
        const cx = x - (w / 2) * s + ((c + 1) * w * s) / (candles + 1);
        out += `<rect x="${cx - 7 * s}" y="${top - 70 * s}" width="${14 * s}" height="${70 * s}" rx="${4 * s}" fill="${['#e6a6b8', '#9fc5e8', '#f3d27a'][c % 3]}"/>
          <path d="M${cx} ${top - 110 * s} q ${14 * s} ${22 * s} 0 ${36 * s} q ${-14 * s} ${-14 * s} 0 ${-36 * s}" fill="#f2a13b"/>`;
      }
    }
  });
  return out;
};

const cupcake = (
  x,
  y,
  s,
  frosting,
  cup,
) => `<path d="M${x - 70 * s} ${y - 90 * s} L${x + 70 * s} ${y - 90 * s} L${x + 50 * s} ${y} L${x - 50 * s} ${y} z" fill="${cup}"/>
  ${[-40, -13, 13, 40].map((d) => `<line x1="${x + d * s}" y1="${y - 88 * s}" x2="${x + d * 0.7 * s}" y2="${y - 2 * s}" stroke="${INK}" stroke-opacity=".12" stroke-width="${5 * s}"/>`).join('')}
  <ellipse cx="${x}" cy="${y - 105 * s}" rx="${85 * s}" ry="${40 * s}" fill="${frosting}"/>
  <ellipse cx="${x}" cy="${y - 140 * s}" rx="${62 * s}" ry="${34 * s}" fill="${frosting}"/>
  <ellipse cx="${x}" cy="${y - 170 * s}" rx="${36 * s}" ry="${26 * s}" fill="${frosting}"/>
  <circle cx="${x + 6 * s}" cy="${y - 200 * s}" r="${16 * s}" fill="#c0392b"/>`;

const table = (x, y, w, cloth) => `<rect x="${x}" y="${y}" width="${w}" height="26" fill="${cloth}"/>
  <path d="M${x} ${y + 26} L${x + w} ${y + 26} L${x + w - 10} ${y + 190} L${x + 10} ${y + 190} z" fill="${cloth}" opacity=".85"/>`;

const chair = (
  x,
  y,
  c,
) => `<rect x="${x}" y="${y}" width="70" height="110" rx="10" fill="${c}"/><rect x="${x - 6}" y="${y + 100}" width="82" height="18" rx="6" fill="${c}"/>
  <rect x="${x}" y="${y + 118}" width="10" height="70" fill="${c}"/><rect x="${x + 60}" y="${y + 118}" width="10" height="70" fill="${c}"/>`;

const windowFrame = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#bfe0ef"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#fff" stroke-width="18"/>
  <line x1="${x + w / 2}" y1="${y}" x2="${x + w / 2}" y2="${y + h}" stroke="#fff" stroke-width="12"/>
  <line x1="${x}" y1="${y + h / 2}" x2="${x + w}" y2="${y + h / 2}" stroke="#fff" stroke-width="12"/>`;

const face = (x, y, s, skin, paint) => `<circle cx="${x}" cy="${y}" r="${260 * s}" fill="${skin}"/>
  <path d="M${x - 250 * s} ${y - 60 * s} Q ${x} ${y - 420 * s} ${x + 250 * s} ${y - 60 * s} Q ${x + 180 * s} ${y - 200 * s} ${x} ${y - 190 * s} Q ${x - 180 * s} ${y - 200 * s} ${x - 250 * s} ${y - 60 * s} z" fill="#5b3a29"/>
  ${paint}
  <circle cx="${x - 90 * s}" cy="${y + 10 * s}" r="${22 * s}" fill="${INK}"/><circle cx="${x + 90 * s}" cy="${y + 10 * s}" r="${22 * s}" fill="${INK}"/>
  <path d="M${x - 90 * s} ${y + 120 * s} Q ${x} ${y + 200 * s} ${x + 90 * s} ${y + 120 * s}" stroke="${INK}" stroke-width="${14 * s}" fill="none" stroke-linecap="round"/>`;

const butterfly = (x, y, s, a, b) => `<g transform="translate(${x} ${y}) scale(${s})">
  <path d="M0 0 C -120 -160 -260 -60 -170 40 C -260 120 -110 190 0 40 z" fill="${a}" opacity=".9"/>
  <path d="M0 0 C 120 -160 260 -60 170 40 C 260 120 110 190 0 40 z" fill="${a}" opacity=".9"/>
  <circle cx="-120" cy="-10" r="30" fill="${b}"/><circle cx="120" cy="-10" r="30" fill="${b}"/>
  <rect x="-10" y="-60" width="20" height="140" rx="10" fill="${INK}"/></g>`;

const palette = (x, y, s, colours) => `<g transform="translate(${x} ${y}) scale(${s})">
  <path d="M0 0 C 200 -140 460 -40 420 140 C 390 260 240 200 200 260 C 150 330 -80 260 -40 120 C -20 60 -60 40 0 0 z" fill="#e9d8b8"/>
  <circle cx="60" cy="210" r="34" fill="${CREAM}"/>
  ${colours.map((c, i) => `<circle cx="${40 + i * 75}" cy="${60 + (i % 2) * 40}" r="34" fill="${c}"/>`).join('')}
  <rect x="180" y="-200" width="22" height="300" rx="8" fill="#a0522d" transform="rotate(30 190 -50)"/>
  <path d="M232 -270 q 18 40 0 70 q -18 -30 0 -70" fill="${INK}" transform="rotate(30 190 -50)"/></g>`;

const castle = (x, y, s, a, b, c) => `<g transform="translate(${x} ${y}) scale(${s})">
  <rect x="-330" y="-40" width="660" height="80" rx="30" fill="${b}"/>
  <rect x="-300" y="-330" width="600" height="300" rx="30" fill="${a}"/>
  <path d="M-200 -40 Q 0 -260 200 -40 z" fill="${CREAM}"/>
  ${[-300, 300].map((tx) => `<rect x="${tx - 60}" y="-470" width="120" height="460" rx="40" fill="${c}"/><path d="M${tx - 70} -470 L${tx} -580 L${tx + 70} -470 z" fill="${b}"/><circle cx="${tx}" cy="-595" r="16" fill="#f3d27a"/>`).join('')}
  ${[-150, 0, 150].map((tx) => `<rect x="${tx - 40}" y="-400" width="80" height="90" rx="30" fill="${c}"/>`).join('')}
  </g>`;

const camera = (x, y, s, body, accent) => `<g transform="translate(${x} ${y}) scale(${s})">
  <rect x="-300" y="-170" width="600" height="380" rx="50" fill="${body}"/>
  <rect x="-120" y="-240" width="200" height="90" rx="20" fill="${body}"/>
  <rect x="-300" y="-60" width="600" height="40" fill="${accent}"/>
  <circle cx="0" cy="30" r="160" fill="#3a3a38"/><circle cx="0" cy="30" r="120" fill="#22313f"/>
  <circle cx="0" cy="30" r="70" fill="#3d5a73"/><circle cx="-35" cy="-5" r="22" fill="#fff" fill-opacity=".5"/>
  <rect x="190" y="-130" width="70" height="40" rx="10" fill="#f3d27a"/></g>`;

const frame = (x, y, w, h, scene) => `<rect x="${x - 18}" y="${y - 18}" width="${w + 36}" height="${h + 36}" fill="#fff"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${scene[0]}"/>
  <circle cx="${x + w * 0.7}" cy="${y + h * 0.3}" r="${h * 0.14}" fill="${scene[2]}"/>
  <path d="M${x} ${y + h} L${x + w * 0.35} ${y + h * 0.45} L${x + w * 0.6} ${y + h * 0.75} L${x + w * 0.78} ${y + h * 0.55} L${x + w} ${y + h} z" fill="${scene[1]}"/>`;

const hat = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})">
  <ellipse cx="0" cy="0" rx="260" ry="60" fill="${INK}"/><rect x="-170" y="-360" width="340" height="360" fill="${INK}"/>
  <ellipse cx="0" cy="-360" rx="170" ry="40" fill="#2e2e2c"/><rect x="-170" y="-90" width="340" height="50" fill="#b03a2e"/></g>`;

const rabbit = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})">
  <ellipse cx="-45" cy="-210" rx="34" ry="110" fill="#fff"/><ellipse cx="45" cy="-210" rx="34" ry="110" fill="#fff"/>
  <ellipse cx="-45" cy="-210" rx="16" ry="80" fill="#f2b8c6"/><ellipse cx="45" cy="-210" rx="16" ry="80" fill="#f2b8c6"/>
  <circle cx="0" cy="-60" r="100" fill="#fff"/><circle cx="-36" cy="-75" r="12" fill="${INK}"/><circle cx="36" cy="-75" r="12" fill="${INK}"/>
  <ellipse cx="0" cy="-40" rx="14" ry="10" fill="#e88aa0"/></g>`;

const card = (
  x,
  y,
  rot,
  suit,
  red,
) => `<g transform="rotate(${rot} ${x} ${y + 200})"><rect x="${x - 110}" y="${y - 160}" width="220" height="320" rx="18" fill="#fff" stroke="${INK}" stroke-opacity=".15" stroke-width="4"/>
  <text x="${x}" y="${y + 40}" font-size="140" text-anchor="middle" fill="${red ? '#b03a2e' : INK}" font-family="serif">${suit}</text></g>`;

const curtains = (c) => `<rect width="${W}" height="${H}" fill="#2b1d24"/>
  ${Array.from({ length: 9 }, (_, i) => `<rect x="${i * 70}" y="0" width="60" height="${H}" fill="${c}" opacity="${0.75 + (i % 2) * 0.25}"/>`).join('')}
  ${Array.from({ length: 9 }, (_, i) => `<rect x="${W - 60 - i * 70}" y="0" width="60" height="${H}" fill="${c}" opacity="${0.75 + (i % 2) * 0.25}"/>`).join('')}
  <path d="M0 0 H${W} V120 Q ${W / 2} 220 0 120 z" fill="${c}"/>
  <rect y="${H - 200}" width="${W}" height="200" fill="#5a3b2a"/>
  <ellipse cx="${W / 2}" cy="${H - 200}" rx="420" ry="60" fill="#f3d27a" opacity=".25"/>`;

const truck = (x, y, s, body, stripe) => `<g transform="translate(${x} ${y}) scale(${s})">
  <rect x="-420" y="-380" width="640" height="380" rx="30" fill="${body}"/>
  <path d="M220 -260 H360 Q 420 -260 440 -180 L460 -60 V0 H220 z" fill="${body}"/>
  <path d="M240 -240 H350 Q 395 -240 410 -180 L420 -140 H240 z" fill="#bfe0ef"/>
  <rect x="-380" y="-300" width="420" height="170" rx="12" fill="#bfe0ef"/>
  <rect x="-420" y="-90" width="880" height="40" fill="${stripe}"/>
  <path d="M-440 -380 H240 L220 -440 H-420 z" fill="${stripe}"/>
  ${[-260, 300].map((wx) => `<circle cx="${wx}" cy="10" r="80" fill="${INK}"/><circle cx="${wx}" cy="10" r="36" fill="#d9d9d9"/>`).join('')}
  <g transform="translate(-170 -470)"><path d="M-40 0 L0 120 L40 0 z" fill="#d9a25f"/><circle cx="0" cy="-20" r="50" fill="#f2b8c6"/><circle cx="0" cy="-70" r="40" fill="${CREAM}"/></g></g>`;

const cone = (x, y, s, scoops) => `<g transform="translate(${x} ${y}) scale(${s})">
  <path d="M-80 0 L0 300 L80 0 z" fill="#d9a25f"/>
  <path d="M-60 40 L40 140 M-30 120 L50 40 M-70 20 L60 20" stroke="#b37f3f" stroke-width="8"/>
  ${scoops.map((c, i) => `<circle cx="0" cy="${-40 - i * 110}" r="${92 - i * 6}" fill="${c}"/>`).join('')}
  <circle cx="10" cy="${-60 - (scoops.length - 1) * 110 - 80}" r="22" fill="#c0392b"/></g>`;

const decks = (x, y, s, glow) => `<g transform="translate(${x} ${y}) scale(${s})">
  <rect x="-600" y="-60" width="1200" height="260" rx="30" fill="#2a2a2a"/>
  <rect x="-600" y="-110" width="1200" height="70" rx="20" fill="#3a3a3a"/>
  ${[-330, 330].map((dx) => `<ellipse cx="${dx}" cy="-75" rx="200" ry="34" fill="#151515"/><ellipse cx="${dx}" cy="-75" rx="60" ry="12" fill="${glow}"/>`).join('')}
  ${[-80, -30, 20, 70].map((dx, i) => `<rect x="${dx}" y="-100" width="30" height="40" rx="6" fill="${i % 2 ? glow : '#888'}"/>`).join('')}
  </g>`;

const speaker = (
  x,
  y,
  s,
) => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-120" y="-320" width="240" height="420" rx="20" fill="#232323"/>
  <circle cx="0" cy="-200" r="60" fill="#3a3a3a"/><circle cx="0" cy="-200" r="25" fill="#111"/>
  <circle cx="0" cy="0" r="90" fill="#3a3a3a"/><circle cx="0" cy="0" r="40" fill="#111"/></g>`;

const beams = (colours) =>
  colours
    .map((c, i) => `<path d="M${200 + i * 400} 0 L${80 + i * 400} ${H * 0.75} L${360 + i * 400} ${H * 0.75} z" fill="${c}" opacity=".22"/>`)
    .join('');

const flask = (x, y, s, liquid) => `<g transform="translate(${x} ${y}) scale(${s})">
  <path d="M-40 -260 H40 V-130 L150 80 Q 165 120 120 120 H-120 Q -165 120 -150 80 L-40 -130 z" fill="#fff" fill-opacity=".7" stroke="${INK}" stroke-opacity=".25" stroke-width="8"/>
  <path d="M-95 -20 H95 L150 80 Q 165 120 120 120 H-120 Q -165 120 -150 80 z" fill="${liquid}"/>
  <circle cx="-20" cy="-330" r="30" fill="${liquid}" opacity=".6"/><circle cx="25" cy="-400" r="20" fill="${liquid}" opacity=".5"/><circle cx="-5" cy="-460" r="14" fill="${liquid}" opacity=".4"/>
  <rect x="-55" y="-280" width="110" height="26" rx="8" fill="#ddd"/></g>`;

const volcano = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})">
  <path d="M-360 0 L-90 -360 H90 L360 0 z" fill="#8a6748"/><path d="M-90 -360 H90 L60 -320 H-60 z" fill="#5c4532"/>
  <path d="M-80 -360 Q -120 -520 -40 -600 Q 0 -660 40 -600 Q 120 -520 80 -360 z" fill="#e8553b"/>
  <path d="M-60 -360 Q -30 -280 -70 -180 Q -10 -260 0 -360 z M40 -360 Q 70 -260 30 -150 Q 90 -250 70 -360 z" fill="#e8553b"/></g>`;

const goggles = (x, y, s, band) => `<g transform="translate(${x} ${y}) scale(${s})">
  <rect x="-330" y="-30" width="660" height="60" rx="30" fill="${band}"/>
  ${[-130, 130].map((gx) => `<rect x="${gx - 120}" y="-110" width="240" height="200" rx="90" fill="#bfe0ef" stroke="${INK}" stroke-width="26" stroke-opacity=".8"/>`).join('')}
  <rect x="-20" y="-20" width="40" height="40" fill="${INK}" fill-opacity=".8"/></g>`;

const arch = (cx, cy, r, colours) => {
  let s = '';
  for (let i = 0; i <= 26; i++) {
    const a = Math.PI + (Math.PI * i) / 26;
    s += balloon(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 62, colours[i % colours.length], false);
    s += balloon(cx + Math.cos(a) * (r - 80), cy + Math.sin(a) * (r - 80), 48, colours[(i + 2) % colours.length], false);
  }
  return s;
};

const studio = (backdrop) => `<rect width="${W}" height="${H}" fill="#e9e4da"/>
  <path d="M300 0 H1300 V900 Q 1300 1100 1500 1200 H100 Q 300 1100 300 900 z" fill="${backdrop}"/>
  <g stroke="${INK}" stroke-width="10"><line x1="150" y1="300" x2="150" y2="1150"/><line x1="150" y1="1150" x2="60" y2="1190"/><line x1="150" y1="1150" x2="240" y2="1190"/></g>
  <path d="M60 180 H240 L270 330 H30 z" fill="#f6f1e7" stroke="${INK}" stroke-width="10"/>
  <g stroke="${INK}" stroke-width="10"><line x1="1450" y1="300" x2="1450" y2="1150"/><line x1="1450" y1="1150" x2="1360" y2="1190"/><line x1="1450" y1="1150" x2="1540" y2="1190"/></g>
  <circle cx="1450" cy="260" r="110" fill="#fff" stroke="${INK}" stroke-width="10"/>`;

// ---- One scene per kind of business, three ways each ---------------------------------------
const PARTY = ['#e6a6b8', '#9fc5e8', '#f3d27a', '#a8d5ba', '#c9b6e4'];

const SCENES = {
  'face-painting': [
    (p) => `<rect width="${W}" height="${H}" fill="${p.bg}"/>${face(800, 660, 1.5, '#f1c9a5', butterfly(800, 470, 1.05, p.a, p.b))}`,
    (p) =>
      `<rect width="${W}" height="${H}" fill="${p.bg2}"/>${face(800, 660, 1.5, '#d8a47f', `<g fill="${p.c}" opacity=".9">${[-1, 1].map((d) => [0, 1, 2].map((k) => `<path d="M${800 + d * (260 - k * 30)} ${560 + k * 80} q ${-d * 120} 20 ${-d * 190} -20 q ${d * 80} 50 ${d * 190} 60 z"/>`).join('')).join('')}</g>`)}`,
    (p) =>
      `<rect width="${W}" height="${H}" fill="${CREAM}"/>${palette(560, 560, 1.6, [p.a, p.b, p.c, '#a8d5ba', '#9fc5e8'])}${confetti(26, PARTY, 7)}`,
  ],
  'party-rooms': [
    (p) =>
      `${room(p.bg, '#c9a77c')}${windowFrame(980, 160, 460, 420)}${bunting(110, PARTY)}${table(250, 640, 1100, '#fff')}${[330, 560, 790, 1020, 1210].map((x) => chair(x, 560, p.a)).join('')}${balloon(180, 360, 70, PARTY[0])}${balloon(110, 420, 60, PARTY[1])}`,
    (p) =>
      `${room(p.bg2, '#b8956a')}${bunting(90, [p.a, p.b, CREAM], 40)}${table(200, 780, 1200, '#fff')}${cake(
        800,
        790,
        0.9,
        [
          [420, 140, '#fff3e0', p.b],
          [300, 120, '#fde2e8', p.a],
        ],
        6,
      )}${balloon(1350, 330, 80, p.a)}${balloon(1460, 400, 70, p.c)}`,
    (p) =>
      `${room(p.bg, '#c9a77c')}${windowFrame(140, 180, 400, 380)}${windowFrame(600, 180, 400, 380)}${windowFrame(1060, 180, 400, 380)}${[200, 450, 700, 950, 1200].map((x) => chair(x, 720, p.c)).join('')}`,
  ],
  'custom-cakes': [
    (p) =>
      `<rect width="${W}" height="${H}" fill="${p.bg}"/>${cake(
        800,
        1020,
        1.25,
        [
          [560, 220, '#fff7ee', p.a],
          [420, 180, '#fde2e8', p.b],
          [280, 150, '#fff7ee', p.a],
        ],
        5,
      )}`,
    (p) =>
      `<rect width="${W}" height="${H}" fill="${p.bg2}"/>${[300, 640, 980, 1320].map((x, i) => cupcake(x, 900, 1.4, [p.a, p.b, '#fff7ee', p.c][i], ['#9fc5e8', '#f3d27a', '#e6a6b8', '#a8d5ba'][i])).join('')}`,
    (p) =>
      `<rect width="${W}" height="${H}" fill="${CREAM}"/>${cake(800, 980, 1.6, [[500, 260, '#5b3a29', p.a]], 3)}${confetti(30, PARTY, 3)}`,
  ],
  'bouncy-castles': [
    (p) =>
      `${sky('#9fd3f2', '#e3f3fb')}${cloud(220, 200, 1)}${cloud(1150, 150, 0.8)}<rect y="900" width="${W}" height="300" fill="#7fbf6a"/>${castle(800, 960, 1.05, p.a, p.b, p.c)}`,
    (p) =>
      `${sky('#a9dcf5', '#eef8fc')}${cloud(900, 180, 1.2)}<rect y="850" width="${W}" height="350" fill="#86c46f"/>${tree(180, 860, 1.4)}${tree(1450, 880, 1.2, '#6d9b5f')}${castle(800, 920, 0.85, p.b, p.c, p.a)}`,
    (p) =>
      `${sky('#ffd9a8', '#fff3e0')}<rect y="880" width="${W}" height="320" fill="#7fbf6a"/>${tree(1380, 900, 1.3)}<g transform="translate(700 900)"><path d="M-420 0 L0 -420 L420 0 z" fill="#fff"/><path d="M-420 0 L-200 -220 L-140 0 z M140 0 L200 -220 L420 0 z" fill="${p.a}"/><rect x="-460" y="-10" width="920" height="30" fill="${p.b}"/></g>`,
  ],
  photographers: [
    (p) => `<rect width="${W}" height="${H}" fill="${p.bg}"/>${camera(800, 620, 1.6, '#2b2b2a', p.a)}`,
    (p) =>
      `<rect width="${W}" height="${H}" fill="${p.bg2}"/>${frame(160, 180, 560, 400, ['#bfe0ef', '#7fbf6a', '#f3d27a'])}${frame(880, 140, 520, 640, ['#f5d6c6', '#c9b6e4', '#fff'])}${frame(260, 700, 480, 360, ['#e3f3fb', '#86a8c4', '#f2a13b'])}${frame(900, 860, 420, 260, ['#ffe9c7', '#d98c6a', '#fff'])}`,
    (p) => `${studio(p.a)}${camera(800, 900, 0.55, '#2b2b2a', p.b)}`,
  ],
  magicians: [
    (p) => `${curtains(p.a)}${hat(800, 940, 1.1)}${rabbit(800, 560, 1)}`,
    (p) =>
      `<rect width="${W}" height="${H}" fill="${p.bg}"/>${[
        ['♠', 0],
        ['♥', 1],
        ['♣', 0],
        ['♦', 1],
        ['♥', 1],
      ]
        .map(([suit, red], i) => card(560 + i * 120, 520, -40 + i * 20, suit, red))
        .join(
          '',
        )}<rect x="200" y="900" width="1200" height="40" rx="20" fill="${INK}" transform="rotate(-8 800 920)"/><rect x="1300" y="855" width="120" height="40" fill="#fff" transform="rotate(-8 800 920)"/>`,
    (p) =>
      `${curtains(p.b)}${hat(800, 960, 0.9)}${Array.from({ length: 14 }, (_, i) => `<path d="M${800 + Math.cos(i) * 300} ${520 + Math.sin(i * 1.7) * 200} l12 30 l32 2 l-25 20 l9 32 l-28 -18 l-28 18 l9 -32 l-25 -20 l32 -2 z" fill="#f3d27a"/>`).join('')}`,
  ],
  balloons: [
    (p) => `<rect width="${W}" height="${H}" fill="${p.bg}"/>${arch(800, 1150, 640, [p.a, p.b, p.c, '#fff'])}`,
    (p) =>
      `<rect width="${W}" height="${H}" fill="${p.bg2}"/>${[
        [620, 340, p.a],
        [800, 280, p.b],
        [980, 340, p.c],
        [700, 480, p.c],
        [900, 480, p.a],
        [800, 420, '#fff'],
        [560, 520, p.b],
        [1040, 520, p.b],
      ]
        .map(([x, y, c]) => balloon(x, y, 95, c))
        .join('')}<path d="M760 1050 h80 l-20 80 h-40 z" fill="${INK}" fill-opacity=".7"/>`,
    (p) =>
      `${room('#f6efe4', '#d8c3a5')}${Array.from({ length: 22 }, (_, i) => balloon(60 + i * 70, 180 + Math.sin(i / 2) * 60, 46 + (i % 3) * 10, [p.a, p.b, p.c, '#fff'][i % 4], false)).join('')}${table(380, 760, 840, '#fff')}${cake(800, 770, 0.6, [[400, 160, '#fff7ee', p.a]], 4)}`,
  ],
  'food-trucks': [
    (p) =>
      `${sky('#a9dcf5', '#eef8fc')}${cloud(1100, 180, 1)}<rect y="930" width="${W}" height="270" fill="#9bbf86"/>${truck(760, 980, 1.1, p.a, p.b)}`,
    (p) =>
      `<rect width="${W}" height="${H}" fill="${p.bg}"/>${cone(450, 760, 1.2, [p.a, '#fff7ee'])}${cone(800, 760, 1.2, [p.b, p.a, '#fff7ee'])}${cone(1150, 760, 1.2, ['#5b3a29', p.c])}`,
    (p) =>
      `<rect width="${W}" height="${H}" fill="${p.bg2}"/><path d="M500 640 H1100 L1020 980 H580 z" fill="#fff" fill-opacity=".85"/>${[
        [650, 560, p.a],
        [800, 520, p.b],
        [950, 560, '#fff7ee'],
      ]
        .map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="140" fill="${c}"/>`)
        .join(
          '',
        )}<path d="M600 440 q 200 -120 400 0" stroke="#5b3a29" stroke-width="40" fill="none" stroke-linecap="round"/><circle cx="820" cy="360" r="36" fill="#c0392b"/>`,
  ],
  'djs-and-music': [
    (p) => `<rect width="${W}" height="${H}" fill="#151824"/>${beams([p.a, p.b, p.c, p.a])}${decks(800, 860, 1, p.a)}`,
    (p) =>
      `<rect width="${W}" height="${H}" fill="#1b1730"/>${beams([p.b, p.c, p.a, p.b])}${speaker(300, 900, 1.3)}${speaker(1300, 900, 1.3)}${Array.from({ length: 30 }, (_, i) => `<circle cx="${(i * 137) % W}" cy="${(i * 211) % 700}" r="${6 + (i % 4) * 3}" fill="${[p.a, p.b, p.c][i % 3]}" opacity=".8"/>`).join('')}`,
    (p) =>
      `<rect width="${W}" height="${H}" fill="#141414"/>${Array.from({ length: 16 }, (_, i) => `<rect x="${130 + i * 86}" y="${900 - (220 + ((i * 97) % 420))}" width="56" height="${220 + ((i * 97) % 420)}" rx="10" fill="${[p.a, p.b, p.c][i % 3]}"/>`).join('')}<rect y="920" width="${W}" height="280" fill="#222"/>`,
  ],
  science: [
    (p) =>
      `<rect width="${W}" height="${H}" fill="${p.bg}"/>${flask(480, 760, 1.4, p.a)}${flask(1050, 820, 1.1, p.b)}<rect y="960" width="${W}" height="240" fill="#d8c3a5"/>`,
    () =>
      `${sky('#ffe0b5', '#fff6e8')}<rect y="980" width="${W}" height="220" fill="#d8c3a5"/>${volcano(800, 990, 1.2)}${confetti(18, ['#e8553b', '#f3d27a'], 5)}`,
    (p) =>
      `<rect width="${W}" height="${H}" fill="${p.bg2}"/>${goggles(800, 520, 1.6, p.a)}${flask(380, 1080, 0.8, p.b)}${flask(1220, 1080, 0.8, p.c)}`,
  ],
};

// A profile photo: the business's first letters in a ring, like a simple logo.
const logo = (b) => `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <rect width="800" height="800" fill="${b.colours.a}"/>
  <circle cx="400" cy="400" r="300" fill="${CREAM}"/><circle cx="400" cy="400" r="270" fill="none" stroke="${INK}" stroke-width="6"/>
  <text x="400" y="${b.initials.length > 2 ? 455 : 470}" font-family="'Playfair Display', Georgia, serif" font-weight="700" font-size="${b.initials.length > 2 ? 160 : 220}" text-anchor="middle" fill="${INK}">${b.initials}</text></svg>`;

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
async function save(markup, w, h, name) {
  for (const [scale, suffix] of [
    [1, ''],
    [0.5, '-small'],
  ]) {
    await page.setViewportSize({ width: Math.round(w * scale), height: Math.round(h * scale) });
    await page.setContent(
      `<html><body style="margin:0"><div style="width:${w}px;height:${h}px;transform:scale(${scale});transform-origin:0 0">${markup}</div></body></html>`,
    );
    await writeFile(path.join(OUT, `${name}${suffix}.jpg`), await page.screenshot({ type: 'jpeg', quality: 80 }));
  }
}
for (const b of DEMO_BUSINESSES) {
  const scenes = SCENES[b.scene];
  for (let i = 0; i < b.photos.length; i++) await save(svg(scenes[i](b.colours)), W, H, `${b.slug}-${i + 1}`);
  await save(logo(b), 800, 800, `${b.slug}-profile`);
}
await browser.close();
console.log(`Drew ${DEMO_BUSINESSES.length} sample businesses' pictures into public/sample-photos/.`);
