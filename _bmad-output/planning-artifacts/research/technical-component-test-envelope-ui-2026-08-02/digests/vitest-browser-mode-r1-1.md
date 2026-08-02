# Digest — Vitest Browser Mode (round 1)

Researcher: firewalled subagent, general-purpose. Budget ~10 sources.

## Findings (as claims)

**Q1 — Maturity/status**

- Vitest 4.0 (released 2025-10-22) removed the "experimental" tag from Browser Mode — official wording: "we are removing the `experimental` tag from Browser Mode." — Source: vitest.dev/blog/vitest-4, accessed 2026-08-02. Confidence: high. Class: maturity.
- Corroborated (with affiliation caveat) by voidzero.dev's companion announcement and by a secondary outlet (Progosling). Confidence: high, though VoidZero and the Vitest team are not fully independent publishers. Class: maturity.
- Providers split into separate packages in v4: `@vitest/browser-playwright`, `@vitest/browser-webdriverio`, `@vitest/browser-preview`; `@vitest/browser` itself no longer a direct dependency. — Source: vitest.dev/blog/vitest-4. Confidence: high. Class: compatibility.

**Q2 — Server vs. file:// (decisive for this project)**

- Official docs state plainly: "Vitest uses Vite dev server to run your tests," assigning port 63315. Browser Mode serves everything over `http://localhost` via Vite's dev server. — Source: vitest.dev/guide/browser/, accessed 2026-08-02. Confidence: high. Class: limitation.
- No doc, issue, or blog post found describing any capability to point Browser Mode at a static built `file://` artefact. Absence across all sources searched. Confidence: high (single primary source for the mechanism; no second source framing the origin/protocol distinction explicitly the way this project cares about it). Class: limitation.

**Q3 — Setup/dependencies**

- Playwright is the provider "recommended for parallel execution" of the three (Playwright, WebdriverIO, Preview); Preview is explicitly unsuitable for CI. — Source: vitest.dev/guide/browser/. Confidence: high. Class: compatibility.
- Minimal setup per a secondary source (SitePoint): install `@vitest/browser-playwright`, edit `vitest.config.ts` to set `browser.provider` and an `instances` array, add `@vitest/browser/providers/playwright` to `tsconfig.json` types. Confidence: medium (single secondary source; official config page 404'd for this agent). Class: compatibility.
- Playwright provider needs Playwright's own browser binaries (`--with-deps` recommended in CI); WebdriverIO avoids a Playwright dependency. Confidence: medium (single source). Class: compatibility.
- `vitest-browser-vue` (testing-library-style render helper for Vue) requires Vitest ≥4.0.0, latest v2.1.0, "published 3 days ago" relative to 2026-08-02. Org discrepancy unresolved: repo page reads `vitest-community/vitest-browser-vue`, a releases URL pointed to `vitest-dev/vitest-browser-vue`. Confidence: medium. Class: maturity/compatibility.

**Q4 — Real-browser fidelity**

- Multiple blogs (SitePoint, alexop.dev, mayashavin.com) converge on: Browser Mode gives real CSS/layout, real `getBoundingClientRect`, `IntersectionObserver`, `ResizeObserver`, computed styles — contrasted against jsdom/happy-dom's zeroed/stubbed versions. Confidence: medium (secondary/blog sources, no official doc enumerating these APIs explicitly, no test code shown as proof). Class: compatibility.
- No source found demonstrating `scrollTop`/`scrollHeight`/`clientHeight` behavior specifically with code/output. This narrower claim (the one this project actually needs) is unverified.

**Q5 — Performance / ecosystem health**

- Concrete dated data point: GitHub issue vitest-dev/vitest#9323 (2025-12-22) — adding 3 Browser Mode tests to an existing 507-test jsdom suite raised total CI run time from 284.83s to 473.52s (~66% increase; test-execution portion 23.10s→45.82s). CI-only; no slowdown seen locally. Closed as "not planned"/"needs reproduction," no maintainer explanation. Confidence: medium (single documented case, not independently corroborated). Class: performance.
- No official Vitest-team benchmark found quantifying Browser Mode startup/runtime overhead in isolation. Gap.
- Browser Mode reaching stable was a headline feature of v4 (alongside visual regression testing, Playwright trace support) — active team investment signal. Confidence: high. Class: maturity.
- "13k+ GitHub stars" for vitest-dev/vitest circulated via a secondary aggregator only, not independently confirmed this round. Confidence: low. Class: maturity.

**Q6 — Known rough edges (last ~12 months)**

- #9323 (2025-12-22): CI-specific slowdown mixing Browser Mode + jsdom tests, closed unresolved. Confidence: high (read in full). Class: limitation.
- #9437: Chromium disk usage accumulates per test file in Browser Mode, exhausting disk on long runs. Confidence: medium (title-level only). Class: limitation.
- #10261: Vitest's `projects` (workspace) feature has friction with Browser Mode. Confidence: medium (title-level only). Class: limitation.
- #9801: Node API (`startVitest`) + Browser Mode crashes with a missing-browser-config error under certain project setups. Confidence: medium (title-level only). Class: limitation.
- Providers (Playwright, WebdriverIO) reported incompatible with WebContainer-style in-browser Node runtimes. Confidence: medium (snippet-level). Class: limitation.
- **No Vue-SFC-specific (vs. React/vanilla) rough-edge report found** — all rough edges found are framework-agnostic (CI perf, disk, monorepo config, WebContainer). Gap relative to the brief's ask.

## Leads worth chasing
- Resolve `vitest-community` vs `vitest-dev` org ownership of `vitest-browser-vue` — materially changes its maturity story (community add-on vs. officially adopted).
- GitHub discussion #6223 (referenced inside #9323) may add a second CI-slowdown data point — not read this round.
- alexop.dev's "Vue 3 Testing Pyramid... with Vitest Browser Mode" looks like the single most relevant Vue-specific production account found — not opened in full this round.
- Confirm whether WebdriverIO is genuinely first-class/equally documented, or a second-tier path behind Playwright.
- Fetch `vitest-dev/benchmarks` repo directly for possible startup-overhead numbers.

## What I looked for and could not find
- A second independent source framing the HTTP-origin-vs-file://-origin distinction the way this project's decision needs it (mechanism itself is high-confidence from the one primary doc source).
- A second independent source corroborating the #9323 CI-slowdown numbers — treat as a single-source, not-necessarily-representative data point.
- Verified GitHub star count / discussion-activity trend for vitest-dev/vitest.
- Any Vue-SFC-specific rough-edge report in Browser Mode (vs. React/vanilla).
- The official `vitest.dev/config/browser/playwright` config page (404'd for this agent) — would firm up the setup-complexity claim beyond one secondary blog.
