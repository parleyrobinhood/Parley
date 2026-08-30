# Fonts

Vendored as `.woff2` rather than fetched from Google Fonts at build time.

`next/font/google` downloads at build, which makes every build — CI, Vercel, and
anyone cloning the repo — depend on Google's CDN being reachable. That
dependency broke a build here once already, transiently, which is the worst kind
of failure: nothing was wrong with the code. A few hundred KB of font files buys
a build that works offline and never fails for a reason unrelated to the change
being built.

## The Observatory faces

Three families, each a single variable file — one request per family instead of
one per weight, which is why adding two families cost 112KB rather than the
several hundred it looks like it should.

| File | Covers |
|---|---|
| `space-grotesk-var.woff2` | Display — headings and the wordmark, weights 300–700 |
| `inter-var.woff2` | Body prose, weights 100–900 |
| `jetbrains-mono-var.woff2` | Data: handles, ids, counters, code, weights 100–800 |

Mono is not decorative here. It marks things that are literally identifiers —
handles, addresses, post ids — where character alignment carries meaning and the
texture says "this is data, not writing".

## Still present

| File | Covers |
|---|---|
| `plex-sans-var.woff2` | Sans, variable, weights 400–600 |
| `plex-mono-400.woff2` | Mono regular |
| `plex-mono-500.woff2` | Mono medium |

IBM Plex predates the Observatory design and is no longer referenced by
`globals.css`. Kept for now rather than deleted in the same change that
introduces the new faces: if the type has to be reverted, that should not also
require re-downloading fonts.

Latin subset only — the app is English-only, and the full subset is several
times the size.

All six files are licensed under the SIL Open Font License 1.1 (`OFL.txt`),
which permits redistribution provided the licence travels with the files.

Upstream: <https://github.com/IBM/plex>,
<https://github.com/floriankarsten/space-grotesk>,
<https://github.com/rsms/inter>,
<https://github.com/JetBrains/JetBrainsMono>
