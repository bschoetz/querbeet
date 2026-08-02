# Digest — @vue/test-utils + jsdom/happy-dom (round 1)

Researcher: firewalled subagent, general-purpose. Budget ~10 sources.

## Findings (as claims)

**Q1 — @vue/test-utils maturity**

- Latest published version of `@vue/test-utils` is 2.4.11, confirmed via npm registry dist-tags and `github.com/vuejs/test-utils/releases`. — Source: npm registry API + GitHub vuejs/test-utils releases, accessed 2026-08-02. Confidence: high. Class: maturity.
- 2.4.11 was published 2024-06-04 per the GitHub releases page — no new release for roughly two years as of 2026-08-02. A WebSearch snippet claimed "published 2 months ago," directly conflicting with this; likely a stale aggregator cache. Confidence: medium (conflict unresolved). Class: maturity.
- Repo lives under the official `vuejs` GitHub org (Vue core team's own repo), ~1.2k stars, ~2,416 commits total. Commit *frequency* in the last 6-12 months not verified. — Source: GitHub github.com/vuejs/test-utils, accessed 2026-08-02. Confidence: high on ownership/count, gap on recent activity. Class: maturity.

**Q2 — jsdom vs happy-dom DOM fidelity (the decisive question)**

- jsdom has no layout engine; `getBoundingClientRect()` returns zero-valued rects for all elements. Open issue jsdom/jsdom#3621 requests a layout engine, unresolved. — Source: GitHub jsdom/jsdom#3621, accessed 2026-08-02. Confidence: high. Class: limitation.
- `window.ResizeObserver` is `undefined` in jsdom — not implemented at all. Feature request jsdom/jsdom#3368 (opened 2022-05) still open, no maintainer commitment. — Source: GitHub jsdom/jsdom#3368, accessed 2026-08-02. Confidence: high. Class: limitation.
- `scrollHeight`/`clientHeight` are always zero in jsdom absent real layout — corroborated across jsdom/jsdom#1013, #2342 and testing-library/react-testing-library#353. — Confidence: medium-high (two independent threads agree; no explicit "permanent by design" maintainer statement found). Class: limitation.
- happy-dom's own README/wiki (primary source) is **silent** on `ResizeObserver`, `getBoundingClientRect`, and `scrollTop`/`scrollHeight`/`clientHeight` fidelity. Only a secondary aggregator (PkgPulse) claims happy-dom "doesn't fully support ResizeObserver" and recommends polyfilling. No primary confirmation either way. Confidence: low / unverified. Class: limitation.
- **No source, for either library, confirms or denies `scrollTop` behavior specifically** — the exact property this project's row-window mechanism reads. Direct, unresolved gap on the single most decision-relevant point.

**Q3 — Vitest multi-project config**

- Vitest's `projects` config (formerly `workspace`, deprecated since 3.2) is the documented, supported way to run one project at `environment: 'node'` and another at `environment: 'happy-dom'|'jsdom'`, scoped by `include` globs — confirmed against live vitest.dev docs for the v4 line. Confidence: high. Class: compatibility.
- Gotchas: every project needs a unique `name` (Vitest throws otherwise); project configs do not inherit root-level test config unless `extends: true`; some settings (coverage, reporters, snapshot resolvers) are root-only. Confidence: high. Class: compatibility.
- No source found on Tailwind/`<style>`-block handling specifics when combining `@vitejs/plugin-vue` + `@vue/test-utils` + a DOM emulator in one multi-project Vitest config. Gap.

**Q4 — Known limitations testing Vue SFCs**

- General (non-Vue-specific but directly applicable) pattern across multiple vuejs/vue-test-utils issues (#1288, #999, #1774 threads): jsdom "doesn't fully resemble entire DOM behavior, particularly ... directives that ... rely on measuring DOM nodes' position/sizes" — read via search-result summaries, not full threads. Confidence: medium. Class: limitation.
- No recent (12-month) blog post or talk found comparing jsdom vs happy-dom specifically for **Vue** component testing (most comparisons found are generic or React-flavored). Gap.

**Q5 — Install size / runtime overhead**

- jsdom has several-times-higher weekly npm downloads than happy-dom (direction corroborated by two sources; exact multiplier disputed — reports ranged, not reconciled). Confidence: medium on direction only. Class: maturity.
- Multiple secondary/aggregator sources (not primary benchmarks) claim happy-dom is faster than jsdom in Vitest, with wildly inconsistent multipliers (2-4x, 5-10x, 3-10x) across sources, one noting the advantage shrinks to ~1.5x when tests are consolidated into fewer files. All trace to aggregator content (PkgPulse), not a primary benchmark. Confidence: low, flagged unverified per two-source rule. Class: performance.
- No install-footprint (disk / dependency count) numbers found for either combination. Gap.
- jsdom's current version reported as 30.0.1 "published a day ago" per a WebSearch aggregator snippet only, not a direct registry fetch. Confidence: medium. Class: maturity.

## Leads worth chasing
- Reconcile the @vue/test-utils release-date discrepancy directly against `registry.npmjs.org/@vue/test-utils`'s `time` object (npmjs.com page itself 403'd for this agent).
- happy-dom's own wiki likely has a per-API compatibility/coverage table beyond the "Getting-started" page reached this round — worth a direct fetch next round.
- `vitest-dev/vitest#1607` ("jsdom vs happy-dom") is a Vitest-maintainer-adjacent GitHub discussion, unopened this round — likely first-party commentary outranking the aggregator content relied on here.
- Vitest docs reportedly support a per-file `// @vitest-environment jsdom` override on top of a happy-dom default — relevant to a hybrid strategy (happy-dom broadly, jsdom just for geometry-sensitive files) — not verified against the primary docs page yet.

## What I looked for and could not find
- **The decisive gap: no primary source, for either jsdom or happy-dom, confirms or denies real support for `getBoundingClientRect`, `ResizeObserver` firing, or `scrollTop`/`scrollHeight`/`clientHeight`, for happy-dom specifically.** jsdom's "no layout engine, values read zero" story is well-evidenced from jsdom's own issue tracker. happy-dom is unconfirmed either way from primary sources — do not assume it solves the fidelity problem merely because it isn't jsdom.
- No `scrollTop`-specific finding for either library — the exact property this project's mechanism depends on.
- No 2025-2026 Vue-specific (not React-flavored) production retrospective on jsdom vs happy-dom.
- No verified recent commit-frequency signal for `@vue/test-utils` beyond total commit count.
- No install-size/dependency-count numbers for either DOM-emulator combination.
- No CSS/Tailwind/`<style>`-block gotchas for the specific multi-project Vitest + plugin-vue + test-utils + DOM-emulator combination.
