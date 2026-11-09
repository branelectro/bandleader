// Cache-busting: stamps ?v=<n> on index.html's stylesheet/script and on every
// relative JS import, so browsers never mix new and cached old files.
// Usage: node scripts/bump-version.mjs        (increments)
//        node scripts/bump-version.mjs 7      (sets to 7)
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const current = Number((html.match(/app\.js\?v=(\d+)/) || [])[1] || 0);
const next = process.argv[2] ? Number(process.argv[2]) : current + 1;

writeFileSync(join(root, 'index.html'), html
  .replace(/styles\.css(\?v=\d+)?"/, `styles.css?v=${next}"`)
  .replace(/app\.js(\?v=\d+)?"/, `app.js?v=${next}"`));

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) {
      const src = readFileSync(p, 'utf8');
      const out = src.replace(/(from\s+'|import\(')(\.{1,2}\/[^'?]+\.js)(\?v=\d+)?'/g, (_, a, path) => `${a}${path}?v=${next}'`);
      if (out !== src) writeFileSync(p, out);
    }
  }
}
walk(join(root, 'src'));
console.log(`Asset version is now v${next}`);
