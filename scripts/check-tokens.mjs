// Design-token check (docs/testing-strategy.md): colours, fonts and sizes are written
// only in src/styles/tokens.css, so a change to the look reaches every screen.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const TOKENS = path.join('src', 'styles', 'tokens.css');
const SKIP = [path.join('src', 'db', 'generated')];

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const cssRules = [
  [/#[0-9a-fA-F]{3,8}\b/, 'a raw colour'],
  [/\b(rgba?|hsla?|oklch|lab|lch)\(/, 'a raw colour'],
  [/font-family\s*:(?![^;]*var\()/, 'a font not taken from a token'],
  [/font-size\s*:(?![^;]*var\()/, 'a font size not taken from a token'],
  [/(?<![\w-])\d*\.?\d+(px|rem|em)\b/, 'a size not taken from a token'],
];
const codeRules = [
  [/['"`]#[0-9a-fA-F]{3,8}['"`]/, 'a raw colour'],
  [/\b(rgba?|hsla?)\(/, 'a raw colour'],
  [/fontFamily\s*:/, 'a font set in code'],
  [/fontSize\s*:\s*['"`]?\d/, 'a font size set in code'],
  [/:\s*['"`]?\d+(px|rem|em)['"`]/, 'a size set in code'],
];

const problems = [];
for await (const file of walk(path.join(root, 'src'))) {
  const rel = path.relative(root, file);
  if (rel === TOKENS || SKIP.some((s) => rel.startsWith(s))) continue;
  const isCss = rel.endsWith('.css');
  const isCode = /\.(tsx?|jsx?)$/.test(rel);
  if (!isCss && !isCode) continue;
  const lines = (await readFile(file, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    if (isCss && /^\s*@media/.test(line)) return; // breakpoints can't use variables
    for (const [re, what] of isCss ? cssRules : codeRules) {
      if (re.test(line)) problems.push(`${rel}:${i + 1}: ${what}: ${line.trim()}`);
    }
  });
}

if (problems.length) {
  console.error('Design-token check failed. Move these values into src/styles/tokens.css:\n');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('Design-token check passed: no colours, fonts or sizes outside the tokens file.');
