# Aboko social poster

Posts one approved Aboko video a day to **Instagram Reels** and **TikTok**, by itself, for free.

- **Where it runs:** GitHub Actions, every day at 17:00 UTC (`.github/workflows/daily-post.yml`).
- **What it posts:** the next folder in `queue/` whose `post.json` says `"approved": true`.
- **What it records:** each post is logged in `posted.json`. Each platform keeps its own place in the queue, so if one fails it retries the same video the next day and the other carries on.
- **If something goes wrong** (an error, a login that expired, an empty queue), the run fails and GitHub emails you. When 3 or fewer approved videos are left, the run shows a warning.
- **Logins renew themselves on every run:** Instagram tokens last 60 days and are refreshed daily, and TikTok's login is renewed and saved back on each run.

> This repo is **public**, because Instagram downloads each video from a public address (GitHub Pages).
> Queued videos and captions can be seen here before they're posted. Your tokens are GitHub
> secrets and are never visible.

## Adding videos

```bash
node scripts/add.mjs path/to/video.mp4 exam-week
```

This creates `queue/NNN-exam-week/` with an Instagram-ready copy of the video and a `post.json`:

```json
{
  "approved": false,
  "notes": "",
  "instagram": { "caption": "Caption...\n\n#habits #habittracker" },
  "tiktok": { "title": "Caption... #habits #fyp", "is_aigc": false }
}
```

Write the captions, set `"approved": true`, then commit and push. Nothing unapproved is ever posted.

Optional fields:
- `instagram.share_to_feed: false` keeps the Reel off your grid.
- `instagram.thumb_offset_ms` and `tiktok.cover_ms` choose the cover frame.
- Set `"skip": true` inside a platform to never post that video there.

Videos: vertical 9:16 MP4 (H.264/AAC), 3 seconds to 3 minutes.

## One-time setup

### 1. Accounts
- **Instagram:** switch the account to a **Professional account → Business** (Settings → Account type and tools).
- **TikTok:** a normal account is fine.

### 2. GitHub Pages
This is already set up (Settings → Pages → Deploy from branch `main`, folder `/`). Videos are served at `https://sttal3.github.io/aboko-social/queue/...`.

### 3. Instagram connection (about 10 minutes, no app review needed for your own account)
1. Go to https://developers.facebook.com → My Apps → **Create app**.
2. Choose the **Business** type (or the "Manage messaging and content on Instagram" use case).
3. In the app, add **Instagram** → **API setup with Instagram login**.
4. Under "Generate access tokens", **Add account**, log in to your Instagram account and allow it. Then **Generate token** and copy it.
5. On your computer, in this folder, run:
   ```bash
   node scripts/instagram-login.mjs <the token>
   ```
   It checks the token and saves `IG_USER_ID` and `IG_TOKEN` as repo secrets.

### 4. TikTok connection
1. Go to https://developers.tiktok.com, then Manage apps → **Connect an app**.
2. Fill in the app details:
   - Website: `https://kovak-web.vercel.app`
   - Terms: `https://sttal3.github.io/kovak/terms.html`
   - Privacy: `https://sttal3.github.io/kovak/privacy.html`
3. Add the products **Login Kit** and **Content Posting API**, with **Direct Post** switched on, and the scopes `user.info.basic`, `video.upload` and `video.publish`.
4. In Login Kit, add the redirect URI `https://kovak-web.vercel.app/`.
5. Submit the app for review, and apply for the **Content Posting API audit** (needed for public posts).
6. When the app is approved, run these on your computer:
   ```bash
   node scripts/tiktok-login.mjs <client_key> https://kovak-web.vercel.app/
   # open the link, allow access, copy "code=..." from the address bar of the page you land on
   node scripts/tiktok-login.mjs <client_key> https://kovak-web.vercel.app/ <client_secret> <code>
   ```

**Before TikTok's audit passes,** TikTok only allows private posts through its API. Use `TIKTOK_MODE=inbox`: each day's video arrives in your TikTok inbox as a draft, and you tap it, check it and post. TikTok allows at most 5 waiting drafts.

**After the audit,** set `TIKTOK_MODE=direct` and posting is fully automatic.

### 5. Token saver (lets the job save renewed logins)
1. Go to GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token.
2. Repository access: **only `aboko-social`**.
3. Permissions: **Secrets: Read and write** (nothing else).
4. Expiration: the longest offered. Put a reminder in your calendar to renew it.
5. Add it as the repo secret `GH_PAT` (Settings → Secrets and variables → Actions).

### 6. Switch posting on (Settings → Secrets and variables → Actions → **Variables**)

| Variable | Value |
|---|---|
| `IG_ENABLED` | `1` |
| `TIKTOK_MODE` | `inbox` now, `direct` after the audit, `off` to pause |
| `TIKTOK_PRIVACY` | leave empty (public) |

### 7. Test
In the **Actions** tab, open **Daily post** and click **Run workflow**. "Dry run" is ticked by default, so it only shows what it would post. Untick it to post for real once.

## Pausing
- **Everything:** Actions → Daily post → ⋯ → **Disable workflow**.
- **One platform:** set `IG_ENABLED=0` or `TIKTOK_MODE=off`.
