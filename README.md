# haze social

*haze social* is a small, invite-only social app for posting text, images, audio, video, albums, replies, edits, and edit history. It is a fork/evolution of *untitled social* with built-in accounts, invite-code signup, editable posts, local-first media uploads, and a private home feed.

It is intentionally simple: Node.js, Express, EJS templates, SQLite, plain CSS, and plain browser JavaScript.

## Features

- private home feed for authenticated users
- invite-code registration
- invite links (`/signup?invite=...`) for one-tap signup
- login/logout sessions stored in SQLite
- admin invite-code generation + copy-link helpers
- text, image, video, audio, album, recording, and doodle post blocks
- clickable Markdown links and automatic bare URL links
- `@username` mentions that link to user post pages
- reply autocomplete suggestions for existing users while typing `@`
- replies
- editable posts with edit history
- local media uploads by default
- optional Backblaze B2-compatible remote media storage
- automatic image optimization on upload (when `sharp` is available)
- long-cache headers for local media URLs for faster repeat loads
- progressive web app support
- mobile-first UI improvements: bottom tab bar + full-screen swipe media viewer for albums
- optional push notifications
- per-user API keys from settings
- JSON API for feed + posts + account info
- outgoing webhooks for new posts (Discord/bot relays)
- public direct post links with Open Graph / Twitter embed metadata

## Requirements

Recommended:

- Node.js 20 LTS or 22 LTS
- npm
- SQLite support through `better-sqlite3`
- Linux/macOS/Windows, or a Raspberry Pi running Raspberry Pi OS / Debian

For Raspberry Pi, a Pi 4 or Pi 5 is ideal. A Pi Zero 2 W can run it for very small usage, but media processing/uploads will feel slower.

## Repository

```txt
https://github.com/j4ckxyz/haze-social
```

## Quick start

```sh
npm install
npm start
```

The app starts on port `8080` by default:

```txt
http://localhost:8080
```

To use a different port:

```sh
PORT=3000 npm start
```

## First setup

### 1. Install dependencies

```sh
npm install
```

### 2. Start the app

```sh
npm start
```

### 3. Generate an invite code

In a second terminal:

```sh
npm run generate-invite
```

Use that invite code on `/signup`.

The first registered user automatically becomes an admin.

### 4. Log in

After signup, the home feed is available at `/`.

Logged-out users are redirected to `/landing` and cannot load the feed, post index, individual post pages, history pages, or feed pagination.

## Media uploads

By default, uploaded media is stored locally on the device running the app.

Default local media directory:

```txt
public/media
```

Default public URL path:

```txt
/media
```

That means this works without any bucket, cloud storage, or extra configuration.

When `sharp` is installed (default dependency), image uploads are optimized server-side automatically with conservative quality settings. If `sharp` is missing, uploads still work and optimization is skipped.

### Local media environment variables

You usually do not need these, but they are available:

```sh
LOCAL_MEDIA_DIR=public/media
LOCAL_MEDIA_URL_PATH=/media
TMP_UPLOAD_DIR=tmp
```

If you change `LOCAL_MEDIA_DIR`, make sure Express can serve the files, or point it somewhere under `public`.

### Important backup note

If you use local media storage, back up both:

```txt
db/db.db
public/media
```

The database contains posts/users/sessions/history. The `public/media` folder contains uploaded files.

## Optional remote media storage with Backblaze B2

If all four B2 variables are present, uploads are stored in B2 instead of local disk:

```sh
B2_BUCKET_NAME=your-bucket-name
B2_BUCKET_ID=your-bucket-id
B2_KEY_ID=your-key-id
B2_KEY=your-application-key
```

If any of those variables are missing, the app falls back to local disk storage.

Despite the variable names, this is currently implemented through the Backblaze B2 SDK. If you want Cloudflare R2 support directly, use the S3-compatible API in a future adapter.

## Optional push notifications

Push notifications are optional. If not configured, the rest of the app still works.

Variables:

```sh
VAPID_ADMIN_EMAIL=you@example.com
VAPID_PUBLIC_KEY=your-public-key
VAPID_PRIVATE_KEY=your-private-key
```

If your local Node version has issues with `web-push`, use Node 20 LTS or 22 LTS.

## Environment file

Create a `.env` file in the project root if you need custom config:

```sh
PORT=8080

# Optional local media settings
LOCAL_MEDIA_DIR=public/media
LOCAL_MEDIA_URL_PATH=/media
TMP_UPLOAD_DIR=tmp

# Optional B2 remote media storage
# B2_BUCKET_NAME=
# B2_BUCKET_ID=
# B2_KEY_ID=
# B2_KEY=

# Optional push notifications
# VAPID_ADMIN_EMAIL=
# VAPID_PUBLIC_KEY=
# VAPID_PRIVATE_KEY=

# Optional image optimization tuning
# IMAGE_OPTIMIZATION_ENABLED=true
# IMAGE_OPTIMIZATION_MIN_BYTES=1200000
# IMAGE_MAX_DIMENSION=2560
# IMAGE_JPEG_QUALITY=86
# IMAGE_WEBP_QUALITY=84

# Optional absolute base URL for embeds/webhooks
# PUBLIC_BASE_URL=https://your-domain.example
```

## Raspberry Pi self-hosting guide

### 1. Install system packages

On Raspberry Pi OS / Debian:

```sh
sudo apt update
sudo apt install -y git curl build-essential python3 make g++
```

### 2. Install Node.js LTS

Using NodeSource for Node 20:

```sh
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
```

### 3. Clone the repo

```sh
git clone https://github.com/j4ckxyz/haze-social.git
cd haze-social
```

### 4. Install dependencies

```sh
npm install
```

### 5. Start once manually

```sh
npm start
```

Visit:

```txt
http://YOUR_PI_IP:8080
```

### 6. Generate your first invite code

```sh
npm run generate-invite
```

Sign up using that code. The first user becomes admin.

## Run as a systemd service

Create a service file:

```sh
sudo nano /etc/systemd/system/haze-social.service
```

Example service:

```ini
[Unit]
Description=haze social
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/pi/haze-social
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
```

If your repo lives somewhere else, change `WorkingDirectory`.

Enable and start it:

```sh
sudo systemctl daemon-reload
sudo systemctl enable haze-social
sudo systemctl start haze-social
sudo systemctl status haze-social
```

View logs:

```sh
journalctl -u haze-social -f
```

## Reverse proxy with nginx

Optional, but recommended if you want to use a domain and HTTPS.

Install nginx:

```sh
sudo apt install -y nginx
```

Example nginx site:

```nginx
server {
    listen 80;
    server_name your-domain.example;

    client_max_body_size 120M;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then use Certbot or your preferred ACME client for HTTPS.

## Backups

At minimum, back up:

```txt
db/db.db
public/media
.env
```

The app also creates SQLite backups in `db/` when configured in `js/sqlite.js`, but you should still back up the directory externally.

A simple backup example:

```sh
mkdir -p ~/haze-backups
cp db/db.db ~/haze-backups/db-$(date +%F).db
rsync -a public/media/ ~/haze-backups/media/
```

## Updating safely (without losing data)

Use the built-in safe updater:

```sh
npm run safe-update
```

That command will:
1. create a timestamped backup in `backups/`
2. pull latest code (`git pull --ff-only`)
3. run `npm install`

Then restart your service:

```sh
sudo systemctl restart haze-social
```

You can also run only the backup step manually:

```sh
npm run backup-instance
```

## API and webhooks

See `API.md` for API key auth, endpoint examples, and webhook payload/signature details.

For a practical Discord relay setup, see `DISCORD_BOT_WEBHOOK_GUIDE.md`.

## Development notes

There is no build step. The app runs directly with Node:

```sh
node app.js
```

Useful checks:

```sh
node --check app.js
npm start
```

## Project data directories

Ignored runtime data:

- `db/` — SQLite database and backups
- `tmp/` — temporary upload files
- `public/media/` — locally uploaded media files
- `.env` — local configuration/secrets

`public/media/.gitkeep` is committed so the media directory exists after cloning.

## License / upstream

This project is based on *untitled social* and has been adapted for private invite-only use as `haze-social`.
