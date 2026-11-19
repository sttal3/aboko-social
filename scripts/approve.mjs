// Approve queued videos so the daily job may post them.
//   node scripts/approve.mjs all            approve everything in queue/
//   node scripts/approve.mjs 001 004 007    approve only these
//   node scripts/approve.mjs --undo 004     take one back
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const QUEUE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'queue');
let args = process.argv.slice(2);
const undo = args[0] === '--undo'; if (undo) args = args.slice(1);
if (!args.length) { console.log('Usage: node scripts/approve.mjs all | 001 002 ... | --undo 004'); process.exit(1); }
for (const d of fs.readdirSync(QUEUE).filter((d) => /^\d{3}-/.test(d)).sort()) {
  if (args[0] !== 'all' && !args.some((a) => d.startsWith(a))) continue;
  const p = path.join(QUEUE, d, 'post.json');
  const post = JSON.parse(fs.readFileSync(p, 'utf8'));
  post.approved = !undo;
  fs.writeFileSync(p, JSON.stringify(post, null, 2) + '\n');
  console.log(`${undo ? 'Unapproved' : 'Approved'} ${d}`);
}
console.log('Now commit and push, for example: git add -A && git commit -m "Approve videos" && git push');
