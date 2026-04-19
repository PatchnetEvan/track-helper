# MotoTrack

A privacy-first, session-only trackside notebook for motorcycle track riders
and club racers. Captures tire pressures, suspension settings, lap times, and
setup notes — without notifications, accounts, or a server watching over your
shoulder.

## Core idea

- No accounts, no database, no analytics, no cookies.
- The current session lives only in your browser tab — refresh and it's gone.
- Saved history (opt-in) stays on your own device via `localStorage`. Nothing
  is sent anywhere.
- Backups are plain JSON files you control.

## Features

- **Session setup** — bike, track, session label, ambient/track temp,
  humidity, general notes.
- **Tires** — cold / hot PSI front & rear, optional target hot PSI, tire
  warmer tracking, conservative delta suggestions.
- **Suspension** — fork & shock preload / compression / rebound, symptom
  chips (mid-corner push, chatter, brake dive…), plain-English recommendation
  hints.
- **Laps** — paste lap times (`mm:ss.sss` or plain seconds). Returns best,
  average, and Δ-from-best per lap.
- **Review** — one-tap summary of the whole session.
- **History** — save sessions locally, compare two side by side, see per-track
  trends, export / import JSON backups.

## Run locally

Just open `index.html` in a browser. No build step, no dependencies, no
`npm install`.

## Deploy

**Recommended host: Cloudflare Pages.** The project is genuinely static, and
Pages' free tier gives **unlimited bandwidth and unlimited requests** — the
site effectively scales for free no matter how many riders use it.

### Cloudflare Pages (recommended)

1. Push this repo to GitHub / GitLab.
2. Cloudflare dashboard → **Workers & Pages** → **Create application** →
   **Pages** → **Connect to Git** → pick the repo.
3. Framework preset: **None**.
4. Build command: *(leave empty)*.
5. Build output directory: `/`.
6. Deploy. You get a `*.pages.dev` URL immediately. Attach a custom domain
   any time.

The repo's `_headers` file is picked up automatically and applies the CSP
and other hardening headers described in [SECURITY.md](SECURITY.md).

**Cost at scale.** Free for a static site at essentially any realistic
traffic level. Known quotas on the free plan: 500 builds/month (we have no
build step, so each deploy is one "build" that just copies files), 20 000
files per deployment, 25 MiB per file. Custom domains are free; the domain
name itself (~$10/year) is the only out-of-pocket cost. Hosting only starts
costing money if you later add Cloudflare Workers, KV, D1, or similar — all
optional and not needed by this app.

### Vercel (alternative)

1. Import the repo.
2. Framework preset: **Other**.
3. Build command: *(leave empty)*.
4. Output directory: root.
5. Deploy.

`vercel.json` is committed and sets the CSP, other security headers, and
`cleanUrls` (so `/privacy` works in addition to `/privacy.html`). Vercel's
free tier has bandwidth caps that Cloudflare Pages does not, which is why
Pages is the default recommendation.

### Anywhere else

GitHub Pages, Netlify, S3 + CloudFront, nginx, Caddy — drop the files in and
serve. The `<meta http-equiv="Content-Security-Policy">` tags in each HTML
file keep the CSP active even when the host does not support custom
headers.

## Tech

Plain HTML, CSS, and vanilla JavaScript. No framework. No build tooling. No
`package.json`.

File layout:

- `index.html` — app shell, tab navigation, forms.
- `styles.css` — dark, mobile-first stylesheet tuned for paddock use.
- `app.js` — interactions, calculations, history UI.
- `storage.js` — thin `localStorage` wrapper. If you ever add a backend, this
  is the one file to replace.
- `privacy.html`, `terms.html` — plain-English policy pages.

## Privacy

See [privacy.html](privacy.html). Short version: we do not collect anything.
Nothing is persisted unless you tap **Save this session** on the Review tab,
and even then it only touches `localStorage` on your device. Exports and
imports are local file operations on your machine.

## License

[MIT](LICENSE) — open source, commercial use permitted. Fork it, modify it,
deploy it, sell a service built on it. Just keep the copyright notice.
