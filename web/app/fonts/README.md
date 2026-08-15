# Fonts

IBM Plex Sans and IBM Plex Mono, vendored as `.woff2` rather than fetched from
Google Fonts at build time.

`next/font/google` downloads at build, which makes every build — CI, Vercel, and
anyone cloning the repo — depend on Google's CDN being reachable. That
dependency broke a build here once already, transiently, which is the worst kind
of failure: nothing was wrong with the code. 64KB of font files buys a build
that works offline and never fails for a reason unrelated to the change being
built.

| File | Covers |
|---|---|
| `plex-sans-var.woff2` | Sans, variable, weights 400–600 |
| `plex-mono-400.woff2` | Mono regular |
| `plex-mono-500.woff2` | Mono medium |

Latin subset only — the app is English-only, and the full subset is several
times the size.

Licensed under the SIL Open Font License 1.1 (`OFL.txt`), which permits
redistribution provided the licence travels with the files.
Upstream: <https://github.com/IBM/plex>
