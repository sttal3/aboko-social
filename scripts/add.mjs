// Adds a video to the queue.
//   node scripts/add.mjs <path/to/video.mp4> <short-name>
// Creates queue/NNN-short-name/ with an Instagram-ready copy of the video (its index moved to the
// front, which Instagram requires) and a post.json to fill in. New posts start unapproved:
// nothing is posted until you set "approved": true.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [src, rawName] = process.argv.slice(2);
if (!src || !rawName) { console.log('Usage: node scripts/add.mjs <video.mp4> <short-name>'); process.exit(1); }
if (!fs.existsSync(src)) { console.log(`Not found: ${src}`); process.exit(1); }

const name = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'video';
const queue = path.join(ROOT, 'queue');
fs.mkdirSync(queue, { recursive: true });
const n = fs.readdirSync(queue).map((d) => parseInt(d, 10)).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0) + 1;
const dir = path.join(queue, `${String(n).padStart(3, '0')}-${name}`);
fs.mkdirSync(dir);

// Same streams, no re-encoding; only the file layout changes.
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', src, '-c', 'copy', '-movflags', '+faststart', path.join(dir, 'video.mp4')], { stdio: 'inherit' });

const post = {
  approved: false,
  notes: '',
  instagram: { caption: 'Caption for Instagram.\n\n#habits #habittracker' },
  tiktok: { title: 'Caption for TikTok #habits #fyp', is_aigc: false },
};
fs.writeFileSync(path.join(dir, 'post.json'), JSON.stringify(post, null, 2) + '\n');
console.log(`Added ${path.relative(ROOT, dir)}. Fill in post.json and set "approved": true.`);
