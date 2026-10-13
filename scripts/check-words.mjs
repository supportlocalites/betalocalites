// Language check (docs/A-product-blueprint.md §6): screens never imply Localites
// handles money or confirms bookings, and never call an event an "occasion".
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const BANNED = [
  'book now', 'booking confirmed', 'secure your booking', 'reserved', 'request a quote', 'request to book',
  'checkout', 'deposit', 'pay now', 'payment due', 'invoice received', 'transaction', 'verified purchase',
  'verified booking', 'guarantee', 'localites-approved', 'shortlist confirmed', 'occasion', 'add a vendor',
  // Slice 2A (planning an event): nothing is paid for or secured through Localites.
  'secure booking', 'list a business', 'fee', 'fees',
];

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    // Words shown on screens also live in src/lib/*-terms.ts. Not every .ts file: code
    // words such as db.transaction would trip the check.
    else if (/\.(tsx|mdx|html|txt)$/.test(e.name) || /-terms\.ts$/.test(e.name)) yield p;
  }
}

const problems = [];
for (const dir of ['src', 'emails']) {
  let files;
  try {
    files = walk(path.join(root, dir));
    for await (const file of files) {
      const text = (await readFile(file, 'utf8')).toLowerCase();
      for (const word of BANNED) {
        const re = new RegExp(`\\b${word.replace(/[-]/g, '\\-')}\\b`);
        if (re.test(text)) problems.push(`${path.relative(root, file)}: "${word}"`);
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

if (problems.length) {
  console.error('Language check failed. These words imply something Localites never does (A §6):\n');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('Language check passed.');
