// Hosting fit test, size part (ADR-005): the compressed worker must stay well under
// Cloudflare's free-plan limit of 3 MiB. Run after `npm run cf:build`.
import { execFileSync } from 'node:child_process';

const LIMIT_KIB = 3 * 1024;
const WARN_AT = 0.8;

const out = execFileSync('npx', ['wrangler', 'deploy', '--dry-run', '--outdir', '.wrangler/dry-run'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
const m = out.match(/gzip:\s*([\d.]+)\s*KiB/);
if (!m) {
  console.error('Could not read the worker size from wrangler:\n' + out);
  process.exit(1);
}
const kib = Number(m[1]);
const pct = Math.round((kib / LIMIT_KIB) * 100);
console.log(`Worker size: ${kib.toFixed(0)} KiB compressed, ${pct}% of the free plan's 3 MiB limit.`);
if (kib > LIMIT_KIB * WARN_AT) {
  console.error(`Over ${WARN_AT * 100}% of the limit. Investigate before adding more.`);
  process.exit(1);
}
