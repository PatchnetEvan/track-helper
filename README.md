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

Works out of the box on any static host:

- **Cloudflare Pages** — connect the repo, leave build command empty, set
  publish directory to `/`.
- **Vercel** — import the repo, framework preset **Other**, build command
  empty, output directory root.
- **GitHub Pages / Netlify / S3 / nginx** — drop the files in and serve.

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
