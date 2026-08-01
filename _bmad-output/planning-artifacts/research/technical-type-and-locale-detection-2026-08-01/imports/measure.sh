#!/bin/sh
# R5 CSS measurement — run 2026-08-01. Downloads the PUBLISHED npm tarballs and
# measures the shipped stylesheet artefacts. gzip -9 approximates the transport
# size; the single-file build inlines the RAW bytes, so both are reported.
for f in "$@"; do
  [ -f "$f" ] || { printf '%-52s MISSING\n' "$f"; continue; }
  raw=$(stat -c%s "$f"); gz=$(gzip -9 -c "$f" | wc -c)
  ff=$(grep -c '@font-face' "$f"); u=$(grep -o 'url(' "$f" | wc -l)
  ud=$(grep -o 'url("\?data:' "$f" | wc -l)
  printf '%-52s raw=%-8s gzip=%-7s @font-face=%s url()=%s of-which-data:=%s\n' "$f" "$raw" "$gz" "$ff" "$u" "$ud"
done
