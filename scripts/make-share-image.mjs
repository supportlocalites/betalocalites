// Draws public/share.png, the picture shown when a Localites link is shared (Facebook,
// WhatsApp, texts): the wordmark with its map pin (D-31) and one line, 1200 × 630 pixels.
// Colours, fonts and pin sizes come from src/styles/tokens.css; run again if they change.
//
// Usage: node scripts/make-share-image.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = new URL('..', import.meta.url);
const file = (p) => new URL(p, root).href;
const tokens = readFileSync(fileURLToPath(new URL('src/styles/tokens.css', root)), 'utf8');
const pin = /PIN_PATH =\s*'([^']+)'/.exec(readFileSync(fileURLToPath(new URL('src/components/Wordmark.tsx', root)), 'utf8'))[1];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${tokens}
@font-face { font-family: 'Playfair Display'; font-weight: 700; src: url('${file('node_modules/@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff2')}'); }
@font-face { font-family: 'Jost'; font-weight: 400; src: url('${file('node_modules/@fontsource/jost/files/jost-latin-400-normal.woff2')}'); }
html, body { margin: 0; }
body { width: 1200px; height: 630px; display: flex; flex-direction: column; align-items: center; justify-content: center;
       background: var(--color-surface); color: var(--color-ink); }
.mark { font-family: var(--font-display); font-weight: 700; font-size: 168px; letter-spacing: var(--tracking-welcome); white-space: nowrap; }
.anchor { display: inline-block; width: 0; height: 0; position: relative; vertical-align: baseline; }
.pin { position: absolute; left: var(--pin-centre); bottom: var(--pin-lift); width: var(--pin-width); height: auto; transform: translateX(-50%); overflow: visible; fill: currentColor; }
.line { font-family: var(--font-body); font-size: 40px; color: var(--color-ink-soft); margin-top: 28px; }
</style></head><body>
<div class="mark">Local<span class="anchor"><svg class="pin" viewBox="0 0 24 34"><path fill-rule="evenodd" d="${pin}"/></svg></span>ıtes</div>
<div class="line">Local businesses for your event in Orillia and area</div>
</body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? undefined });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate('document.fonts.ready');
await page.screenshot({ path: fileURLToPath(new URL('public/share.png', root)) });
await browser.close();
console.log('public/share.png drawn');
