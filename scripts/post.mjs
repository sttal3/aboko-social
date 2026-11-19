// Posts the next approved video from queue/ to Instagram (Reels) and TikTok.
// Runs once a day in GitHub Actions (.github/workflows/daily-post.yml). No dependencies: Node 20+.
//
// Each platform keeps its own place in the queue, so if one platform fails, the other still
// moves on and the failed one retries the same video the next day.
//
// Settings come from environment variables (GitHub secrets and variables):
//   DRY_RUN=1                 show what would be posted, post nothing, change nothing
//   PAGES_BASE                public address of this repo's GitHub Pages, e.g. https://sttal3.github.io/aboko-social
//   IG_ENABLED=1              post to Instagram
//   IG_USER_ID, IG_TOKEN      Instagram account id and long-lived token (Instagram API with Instagram Login)
//   TIKTOK_MODE               off | inbox (drafts you tap to post) | direct (public posting, needs TikTok's audit)
//   TIKTOK_PRIVACY            privacy for direct mode, default PUBLIC_TO_EVERYONE
//   TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REFRESH_TOKEN
//   GH_PAT                    token allowed to update this repo's secrets (refreshed tokens are saved back)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUEUE = path.join(ROOT, 'queue');
const POSTED = path.join(ROOT, 'posted.json');
const env = process.env;
const DRY = env.DRY_RUN === '1' || env.DRY_RUN === 'true';
const IG_API = `https://graph.instagram.com/${env.IG_API_VERSION || 'v27.0'}`;
const TT_API = 'https://open.tiktokapis.com/v2';

const log = (...a) => console.log(...a);
const warn = (msg) => console.log(`::warning::${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mask = (secret) => { if (secret && env.GITHUB_ACTIONS) console.log(`::add-mask::${secret}`); };

/* ---------- Queue ---------- */
export function loadQueue(dir = QUEUE) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'post.json'))).sort().map((id) => {
    const folder = path.join(dir, id);
    const post = JSON.parse(fs.readFileSync(path.join(folder, 'post.json'), 'utf8'));
    return { id, folder, post, video: path.join(folder, 'video.mp4') };
  });
}

export function nextFor(platform, items, posted) {
  const ready = items.filter((i) => i.post.approved === true && i.post[platform] && i.post[platform].skip !== true && !(posted[platform] || {})[i.id]);
  return { item: ready[0] || null, left: ready.length };
}

/* ---------- Saving refreshed tokens back to GitHub ---------- */
function saveSecret(name, value) {
  mask(value);
  if (DRY) { log(`(dry run) would update secret ${name}`); return; }
  if (!env.GH_PAT || !env.GITHUB_REPOSITORY) throw new Error(`Can't save the refreshed ${name}: GH_PAT is missing. See README, step 5.`);
  execFileSync('gh', ['secret', 'set', name, '--repo', env.GITHUB_REPOSITORY], { input: value, env: { ...env, GH_TOKEN: env.GH_PAT }, stdio: ['pipe', 'ignore', 'inherit'] });
  log(`Saved refreshed ${name}.`);
}

async function json(res, what) {
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
  if (!res.ok) throw new Error(`${what} failed (${res.status}): ${JSON.stringify(body.error || body).slice(0, 400)}`);
  return body;
}

/* ---------- Instagram (Reels, Instagram API with Instagram Login) ---------- */
async function refreshInstagramToken() {
  // Long-lived tokens last 60 days and can be refreshed once they are 24 hours old.
  // Refreshing on every run keeps the token from ever expiring.
  const res = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(env.IG_TOKEN)}`);
  if (!res.ok) { warn('Instagram token not refreshed this time (it may be less than 24 hours old). Posting with the current one.'); return env.IG_TOKEN; }
  const body = await res.json();
  if (body.access_token && body.access_token !== env.IG_TOKEN) saveSecret('IG_TOKEN', body.access_token);
  return body.access_token || env.IG_TOKEN;
}

async function postInstagram(item) {
  const caption = item.post.instagram.caption || '';
  const videoUrl = `${env.PAGES_BASE.replace(/\/$/, '')}/queue/${encodeURIComponent(item.id)}/video.mp4`;
  if (DRY) { log(`(dry run) Instagram Reel: ${videoUrl}\n  caption: ${caption.replace(/\n/g, ' / ').slice(0, 200)}`); return { dry: true }; }
  if (!env.IG_USER_ID || !env.IG_TOKEN) throw new Error('IG_USER_ID or IG_TOKEN is missing. See README, step 3.');
  mask(env.IG_TOKEN);

  // Instagram downloads the video from this public address, so make sure Pages already serves it.
  const head = await fetch(videoUrl, { method: 'HEAD' });
  if (!head.ok) throw new Error(`The video isn't on GitHub Pages yet (${head.status}): ${videoUrl}. Pages can take a few minutes after a push.`);

  const token = await refreshInstagramToken();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const body = { media_type: 'REELS', video_url: videoUrl, caption, share_to_feed: item.post.instagram.share_to_feed !== false };
  if (item.post.instagram.thumb_offset_ms) body.thumb_offset = item.post.instagram.thumb_offset_ms;
  const container = await json(await fetch(`${IG_API}/${env.IG_USER_ID}/media`, { method: 'POST', headers: auth, body: JSON.stringify(body) }), 'Instagram: create Reel');

  // Instagram processes the video before it can be published.
  for (let i = 0; i < 40; i++) {
    await sleep(30_000);
    const st = await json(await fetch(`${IG_API}/${container.id}?fields=status_code,status`, { headers: auth }), 'Instagram: check status');
    log(`Instagram processing: ${st.status_code}`);
    if (st.status_code === 'FINISHED') {
      const pub = await json(await fetch(`${IG_API}/${env.IG_USER_ID}/media_publish`, { method: 'POST', headers: auth, body: JSON.stringify({ creation_id: container.id }) }), 'Instagram: publish');
      return { media_id: pub.id };
    }
    if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error(`Instagram couldn't process the video: ${st.status || st.status_code}`);
  }
  throw new Error('Instagram was still processing the video after 20 minutes.');
}

/* ---------- TikTok (Content Posting API) ---------- */
async function tiktokAccessToken() {
  // TikTok refresh tokens rotate: every refresh returns a new one and the old one stops working.
  // The new one is saved right away, before anything else can fail.
  const form = new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: env.TIKTOK_REFRESH_TOKEN });
  const body = await json(await fetch(`${TT_API}/oauth/token/`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form }), 'TikTok: refresh login');
  if (body.error && body.error !== 'ok' && !body.access_token) throw new Error(`TikTok login refresh failed: ${body.error_description || body.error}. Run scripts/tiktok-login.mjs again (README, step 4).`);
  mask(body.access_token);
  if (body.refresh_token && body.refresh_token !== env.TIKTOK_REFRESH_TOKEN) saveSecret('TIKTOK_REFRESH_TOKEN', body.refresh_token);
  return body.access_token;
}

// TikTok upload rules: chunks of 5 to 64 MB sent in order, the last chunk takes the remainder
// (up to 128 MB), and a file under 5 MB goes up in one piece.
export function chunkPlan(size, preferred = 10 * 1024 * 1024) {
  if (size <= preferred) return { chunk_size: size, total_chunk_count: 1 };
  return { chunk_size: preferred, total_chunk_count: Math.floor(size / preferred) };
}

async function postTikTok(item, mode) {
  const title = item.post.tiktok.title || '';
  if (DRY) { log(`(dry run) TikTok ${mode}: ${item.video}\n  title: ${title.slice(0, 200)}`); return { dry: true }; }
  for (const k of ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REFRESH_TOKEN']) if (!env[k]) throw new Error(`${k} is missing. See README, step 4.`);
  const token = await tiktokAccessToken();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' };
  const bytes = fs.readFileSync(item.video);
  const plan = chunkPlan(bytes.length);
  const source_info = { source: 'FILE_UPLOAD', video_size: bytes.length, ...plan };

  let init;
  if (mode === 'direct') {
    const info = (await json(await fetch(`${TT_API}/post/publish/creator_info/query/`, { method: 'POST', headers: auth }), 'TikTok: creator info')).data;
    const privacy = env.TIKTOK_PRIVACY || 'PUBLIC_TO_EVERYONE';
    if (!info.privacy_level_options.includes(privacy)) throw new Error(`TikTok won't allow ${privacy} for this account (allowed: ${info.privacy_level_options.join(', ')}). Before TikTok's audit only private posting works; use TIKTOK_MODE=inbox until then.`);
    const post_info = { title, privacy_level: privacy, disable_comment: !!info.comment_disabled, disable_duet: !!info.duet_disabled, disable_stitch: !!info.stitch_disabled, is_aigc: item.post.tiktok.is_aigc === true };
    if (item.post.tiktok.cover_ms) post_info.video_cover_timestamp_ms = item.post.tiktok.cover_ms;
    init = (await json(await fetch(`${TT_API}/post/publish/video/init/`, { method: 'POST', headers: auth, body: JSON.stringify({ post_info, source_info }) }), 'TikTok: start post')).data;
  } else {
    init = (await json(await fetch(`${TT_API}/post/publish/inbox/video/init/`, { method: 'POST', headers: auth, body: JSON.stringify({ source_info }) }), 'TikTok: start draft')).data;
  }

  for (let i = 0; i < plan.total_chunk_count; i++) {
    const start = i * plan.chunk_size;
    const end = i === plan.total_chunk_count - 1 ? bytes.length : start + plan.chunk_size;
    const res = await fetch(init.upload_url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(end - start), 'Content-Range': `bytes ${start}-${end - 1}/${bytes.length}` }, body: bytes.subarray(start, end) });
    if (res.status !== 206 && res.status !== 201) throw new Error(`TikTok upload failed at part ${i + 1}/${plan.total_chunk_count} (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }

  const done = mode === 'direct' ? 'PUBLISH_COMPLETE' : 'SEND_TO_USER_INBOX';
  for (let i = 0; i < 60; i++) {
    await sleep(15_000);
    const st = (await json(await fetch(`${TT_API}/post/publish/status/fetch/`, { method: 'POST', headers: auth, body: JSON.stringify({ publish_id: init.publish_id }) }), 'TikTok: check status')).data;
    log(`TikTok: ${st.status}`);
    if (st.status === done || st.status === 'PUBLISH_COMPLETE') return { publish_id: init.publish_id, status: st.status, post_ids: st.publicaly_available_post_id || [] };
    if (st.status === 'FAILED') throw new Error(`TikTok rejected the video: ${st.fail_reason}`);
  }
  throw new Error('TikTok was still processing the video after 15 minutes.');
}

/* ---------- Run ---------- */
async function main() {
  const items = loadQueue();
  const posted = fs.existsSync(POSTED) ? JSON.parse(fs.readFileSync(POSTED, 'utf8')) : {};
  const ttMode = (env.TIKTOK_MODE || 'off').toLowerCase();
  const jobs = [];
  if (env.IG_ENABLED === '1' || env.IG_ENABLED === 'true') jobs.push(['instagram', (i) => postInstagram(i)]);
  if (ttMode === 'inbox' || ttMode === 'direct') jobs.push(['tiktok', (i) => postTikTok(i, ttMode)]);
  if (!jobs.length) { warn('Nothing is switched on. Set IG_ENABLED and/or TIKTOK_MODE (README, step 6).'); return; }
  if (!env.PAGES_BASE && jobs.some(([p]) => p === 'instagram')) throw new Error('PAGES_BASE is missing (README, step 2).');

  const problems = [];
  for (const [platform, run] of jobs) {
    const { item, left } = nextFor(platform, items, posted);
    if (!item) { problems.push(`${platform}: the queue is empty. Add and approve more videos.`); continue; }
    log(`\n== ${platform}: ${item.id} (${left} approved video${left === 1 ? '' : 's'} waiting, including this one)`);
    if (!fs.existsSync(item.video)) { problems.push(`${platform}: ${item.id} has no video.mp4`); continue; }
    try {
      const result = await run(item);
      if (!DRY) { (posted[platform] ||= {})[item.id] = { at: new Date().toISOString(), ...result }; fs.writeFileSync(POSTED, JSON.stringify(posted, null, 2) + '\n'); }
      log(`${platform}: done`);
      if (left - 1 <= 3) warn(`${platform}: only ${left - 1} approved video${left - 1 === 1 ? '' : 's'} left in the queue.`);
    } catch (e) {
      problems.push(`${platform}: ${e.message}`);
    }
  }
  if (problems.length) {
    for (const p of problems) console.log(`::error::${p}`);
    process.exitCode = 1; // a failed run makes GitHub email the repo owner
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.log(`::error::${e.message}`); process.exitCode = 1; });
