# CSS candidate measurement — R5/D5, 2026-08-01

Measured locally rather than taken from a docs page or a bundlephobia badge. Method: read the
npm registry document for each package, download the **published tarball**, and measure the
stylesheet artefacts it actually ships. Licence is read from the registry document (and, where
it matters, checked against the LICENSE inside the tarball — the PrimeVue guard from R4).

Environment: Linux, `curl`, `gzip -9`, `tar`. Read 2026-08-01.

## Registry facts

| Package | Latest | Published | Licence (registry) | Unpacked |
| --- | --- | --- | --- | --- |
| `@picocss/pico` | 2.1.1 | 2025-03-15 | MIT | 19,558,862 B |
| `tailwindcss` | 4.3.3 | 2026-07-16 | MIT | 772,893 B |
| `unocss` | 66.7.5 | 2026-07-07 | MIT | 18,192 B |
| `open-props` | 1.7.23 | 2026-01-31 | MIT | 1,287,011 B |
| `bulma` | 1.0.4 | 2025-04-19 | MIT | 6,967,616 B |
| `water.css` | 2.1.1 | 2021-08-11 | MIT | 119,457 B |
| `simpledotcss` | 2.3.7 | 2025-05-29 | MIT | 41,673 B |
| `@vue-flow/core` | 1.48.2 | 2026-01-28 | MIT | 1,285,046 B |

Against the research plan's "released within the last 12 months" gate (today 2026-08-01), only
**tailwindcss, unocss, open-props and @vue-flow/core** pass. Pico (16 months), Bulma (15),
Simple.css (14) and Water.css (**59 months**) do not.

## Artefact measurement

`raw` is what a single-file build inlines. `gzip -9` is reported for comparison with the byte
figures in R2/R3, which are gzipped.

| Artefact | raw | gzip ‑9 | `@font-face` | `url(` | of which `data:` |
| --- | --- | --- | --- | --- | --- |
| `pico/css/pico.min.css` | 83,319 | 11,630 | 0 | 14 | 14 |
| `pico/css/pico.classless.min.css` | 71,040 | 10,328 | 0 | 14 | 14 |
| `bulma/css/bulma.min.css` | 677,931 | 65,219 | 0 | 0 | – |
| `water.css/out/water.min.css` | 22,668 | 3,571 | 0 | 4 | 4 |
| `simpledotcss/simple.min.css` | 9,429 | 2,790 | 0 | 0 | – |
| `open-props/open-props.min.css` | 29,566 | 7,664 | 0 | 10 | 5 |
| `tailwindcss/index.css` | 29,786 | 7,870 | 0 | 0 | – |
| `tailwindcss/preflight.css` | 8,489 | 2,934 | 0 | 0 | – |
| `tailwindcss/theme.css` | 19,586 | 4,948 | 0 | 0 | – |
| `tailwindcss/utilities.css` | **21** | 55 | 0 | 0 | – |
| `@vue-flow/core/dist/style.css` | 3,930 | 906 | 0 | 0 | – |
| `@vue-flow/core/dist/theme-default.css` | 3,470 | 718 | 0 | 0 | – |

`unocss` ships **no stylesheet at all** — the published package is an 18 KB meta-package; every
byte of its output is generated from the app's own markup at build time.

## The no-fetch gate separates nothing here

**Not one candidate contains an `@font-face` rule, and every `url()` in every candidate resolves
to a `data:` URI.** The five apparent exceptions in Open Props are `url(%23a)` — an SVG fragment
reference *inside* the `data:image/svg+xml` payload (`…%3Crect … filter='url(%23a)'/%3E%3C/svg%3E`),
not a separate CSS reference. Checked by extracting the surrounding 70 characters of each match.

Pico's default sans-serif stack is a system stack
(`system-ui,"Segoe UI",Roboto,Oxygen,Ubuntu,Cantarell,Helvetica,Arial,…`) and requires no web font.

So the gate that shaped R6 does not discriminate in D5 either. Size and reset behaviour decide.

## `tailwindcss/utilities.css` is 21 bytes

This is the load-bearing measurement for the "what does Tailwind actually cost inlined" question.
The published `utilities.css` contains only a layer declaration — **every utility is generated at
build time from the app's own markup**, so Tailwind's inlined cost is a function of querbeet, not
of the package. The fixed part is `theme.css` (19,586 B raw) and, if kept, `preflight.css`
(8,489 B raw). Tailwind v4 emits only the theme variables actually referenced, so even the
theme figure is an upper bound.

**What this does not settle:** the real post-build number for querbeet. That needs one Vite build
of the actual app and is named as an open item in the report.

## Reproduction

`measure.sh` (preserved beside this file) takes artefact paths and prints the table above. The
tarballs are re-downloadable from the registry URLs in the table; they were not committed.
