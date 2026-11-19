// One-time TikTok login. Run on your own computer (needs the GitHub CLI logged in).
//
// Step 1: node scripts/tiktok-login.mjs <client_key> <redirect_uri>
//         Prints a link. Open it, log in to the TikTok account and allow access.
//         TikTok sends you to the redirect page; copy the "code" value from the address bar.
// Step 2: node scripts/tiktok-login.mjs <client_key> <redirect_uri> <client_secret> <code>
//         Exchanges the code and stores TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET and
//         TIKTOK_REFRESH_TOKEN as secrets in the GitHub repo. Nothing secret is printed.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

const REPO = process.env.REPO || 'sttal3/aboko-social';
const [key, redirect, secret, code] = process.argv.slice(2);
if (!key || !redirect) { console.log('Usage: see the top of this file.'); process.exit(1); }

if (!code) {
  const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
  url.search = new URLSearchParams({ client_key: key, scope: 'user.info.basic,video.upload,video.publish', response_type: 'code', redirect_uri: redirect, state: crypto.randomBytes(8).toString('hex') }).toString();
  console.log(`Open this link, log in and allow access:\n\n${url}\n\nThen run this script again with your client secret and the code from the address bar.`);
  process.exit(0);
}

const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_key: key, client_secret: secret, code: decodeURIComponent(code), grant_type: 'authorization_code', redirect_uri: redirect }),
});
const body = await res.json();
if (!body.refresh_token) { console.log(`TikTok said no: ${body.error_description || body.error || JSON.stringify(body).slice(0, 300)}`); process.exit(1); }

const set = (name, value) => execFileSync('gh', ['secret', 'set', name, '--repo', REPO], { input: value, stdio: ['pipe', 'ignore', 'inherit'] });
set('TIKTOK_CLIENT_KEY', key);
set('TIKTOK_CLIENT_SECRET', secret);
set('TIKTOK_REFRESH_TOKEN', body.refresh_token);
console.log(`Done. TikTok is connected (scopes: ${body.scope}). The login stays valid as long as the daily job runs, because each run renews it.`);
