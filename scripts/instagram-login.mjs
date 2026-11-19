// One-time Instagram setup. Run on your own computer (needs the GitHub CLI logged in).
//   node scripts/instagram-login.mjs <token>
// <token> is the access token you generate in the Meta App Dashboard
// (Instagram > API setup with Instagram login > Generate token). The script checks it, finds your
// Instagram account id and stores IG_USER_ID and IG_TOKEN as secrets in the GitHub repo.

import { execFileSync } from 'node:child_process';

const REPO = process.env.REPO || 'sttal3/aboko-social';
const token = process.argv[2];
if (!token) { console.log('Usage: node scripts/instagram-login.mjs <token>'); process.exit(1); }

const res = await fetch(`https://graph.instagram.com/v27.0/me?fields=user_id,username,account_type&access_token=${encodeURIComponent(token)}`);
const me = await res.json();
if (!res.ok || !me.user_id) { console.log(`Instagram didn't accept the token: ${JSON.stringify(me.error || me).slice(0, 300)}`); process.exit(1); }
if (me.account_type && !['BUSINESS', 'MEDIA_CREATOR'].includes(me.account_type)) console.log(`Note: @${me.username} is a ${me.account_type} account. Posting needs a professional account (Business works best).`);

const set = (name, value) => execFileSync('gh', ['secret', 'set', name, '--repo', REPO], { input: value, stdio: ['pipe', 'ignore', 'inherit'] });
set('IG_USER_ID', String(me.user_id));
set('IG_TOKEN', token);
console.log(`Done. Connected @${me.username}. The token renews itself on every daily run.`);
