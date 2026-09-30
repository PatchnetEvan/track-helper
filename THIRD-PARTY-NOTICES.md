# Third-party notices

## Lucide icons — `public/icons/*.svg`

The stage-navigation icon set is [Lucide](https://lucide.dev), redistributed
here under the ISC licence. The icons are served from this origin rather than
a CDN because `public/log/index.html` sets `img-src 'self'` and
`style-src 'self'`; nothing about that policy is relaxed to use them.

Lucide is itself a fork of [Feather](https://feathericons.com) (MIT), and its
licence carries both notices.

```
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part
of Feather (MIT). All other copyright (c) for Lucide are held by Lucide
Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

### Why the notice lives here and not in `public/icons/`

`tests/asset-boundary.test.js` allows only `.png`, `.webp`, `.ico`, `.svg` and
`.woff2` inside an approved public tree. Shipping a `LICENSE` file beside the
icons would mean widening that allowlist to carry a text file, which is a
larger change to the publication boundary than the attribution warrants. The
notice is therefore kept with the source, where the icons are redistributed,
and the deployed bundle carries only the assets themselves.

If a deployed copy of this notice is later judged necessary, the narrow change
is to serve it from an existing route rather than to widen the asset
extension allowlist.
