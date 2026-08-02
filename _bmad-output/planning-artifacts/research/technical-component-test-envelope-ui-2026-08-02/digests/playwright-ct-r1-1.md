# Digest — Playwright Component Testing (round 1)

Researcher: firewalled subagent, general-purpose. Budget ~10 sources.

## Findings (as claims)

**Q1 — Status: old packages phased out, new built-in model claims "stable"**

- The old `@playwright/experimental-ct-react` and `@playwright/experimental-ct-vue` packages have been superseded by a new "stories and galleries" model built directly into core `@playwright/test` (no separate package), introduced in **Playwright v1.62.0** — the exact version this project already depends on (`^1.62`). — Source: playwright.dev "Component testing" doc + v1.62.0 GitHub release notes, accessed 2026-08-02. Confidence: high. Class: maturity/compatibility.
- Current official docs state: **"It is stable."** `test`/`expect` import from plain `@playwright/test`; `fixtures.mount()` is a documented built-in fixture. — Source: playwright.dev/docs/test-components, accessed 2026-08-02. Confidence: medium-high (single publisher; no independent second source found for "stable" specifically re: the new model).
- **Contradicting secondary source**: currents.dev blog ("Playwright Component Testing in Large Frontend Codebases") characterizes Playwright CT as "remains experimental with no public timeline for stable release," and reports `@playwright/experimental-ct-svelte` was **removed entirely in Playwright 1.59 (April 2026) with no deprecation warning**, forcing Svelte users onto the core runner or a pin to 1.58. Confidence: medium (secondary blog, not maintainer-authored).
- **Tension flagged, unresolved by this round**: the docs' "stable" claim is about the NEW package-free `fixtures.mount()` model (shipped 1.62); the blog's complaint targets the OLD `experimental-ct-*` packages being removed. These may not actually be in conflict — but the publish date of the blog relative to 1.62's release was not confirmed, so it is unclear whether the blog is simply pre-dating (and thus superseded by) the new model, or is a still-valid skepticism about the "stable" label's durability. **This is the single most decision-relevant open item from this candidate and needs a landing-time verification pass.**

**Q2 — Vue-specific support**

- Old `@playwright/experimental-ct-vue` package: ~14,662 weekly npm downloads, "last version released less than a year ago" per a secondary aggregator snapshot (npmjs.com and socket.dev both returned HTTP 403 to this agent, so this is unverified against the primary registry). Confidence: low. Class: compatibility.
- The NEW built-in model treats Vue and React symmetrically in the docs: a full Vue 3 example using `defineComponent`/`h`/`ref`, presented as an equal alternative to the React/JSX example, no caveats singling out weaker Vue support. Confidence: high for "docs treat it equally"; the example uses the render-function API, not `<script setup>` — no `<script setup>`-specific example found or verified. Class: compatibility/limitation.
- No evidence either way found on whether Vue support trails React's in practice (open bugs, etc.) — a gap, not a negative finding.

**Q3 — Runs via a dev server (confirmed, real HTTP page — not file://)**

- Confirmed directly from docs: the "gallery" is "a single page, served by your own dev server." For Vite-based apps, "Vite apps serve it with the dev server they already run; other setups run a small standalone Vite server." Docs state explicitly: **"Playwright does not compile or serve anything—it navigates to a page, like in any other test."** — Source: playwright.dev/docs/test-components, accessed 2026-08-02. Confidence: high. Class: maturity/limitation.
- Implication: like the other two candidates, this tests a page served over HTTP by a dev-time bundler, not the shipped single-file `file://` artefact — the same fidelity gap flagged for Vitest Browser Mode applies here too.

**Q4 — Setup cost given `@playwright/test` ^1.62 already installed**

- Because the new model lives inside core `@playwright/test`, setup is additive for this project specifically: no new package, just a `testDir`/`webServer` config block and gallery/story files. Confidence: high given the project is already on 1.62+. Class: compatibility.
- Migration guidance exists for teams on the OLD package (incremental cutover, then delete `@playwright/experimental-ct-*` and its scaffolding) — implies real effort for anyone who'd adopted the old package, though not relevant to this project which hasn't. Confidence: medium (paraphrased by fetch tool, not verbatim). Class: limitation.
- No report found of friction running e2e Playwright config and CT Playwright config side-by-side in one repo under the new (1.62+) model. Gap, not a confirmed non-issue.

**Q5 — Real fidelity**

- Architecturally strong inference: gallery served over real HTTP, `mount()` returns a Locator against the real DOM in the same Chromium/Firefox engine already used for this project's e2e suite → real layout, real `getBoundingClientRect`/`ResizeObserver`/`scrollTop` should follow. Confidence: medium-high (strong architectural entailment; no doc sentence names those specific APIs explicitly). Class: performance/limitation.

**Q6 — Practical alternatives teams migrate to (context, not this candidate)**

- Per the currents.dev piece: teams leaving Playwright CT (old packages, esp. Svelte) go to Vitest Browser Mode (speed, native `vi.mock()`), Storybook + Vitest (+ Chromatic), Cypress Component Testing (esp. where Playwright lacks official framework support, e.g. Angular), or plain Jest/RTL for logic-heavy components. Confidence: low-medium (single publisher, blog register). Class: maturity.

## Leads worth chasing
- **Resolve the stable-vs-experimental tension** — pin the currents.dev article's publish date against the 1.62 release date.
- GitHub issue #26778 ("What are the plans for component testing?", 2023-08-29) — comment thread not retrieved (WebFetch pagination limitation); likely contains maintainer commentary.
- Direct npm registry JSON for `@playwright/experimental-ct-vue` (deprecated flag, last-publish date) — website + aggregator both 403'd.
- Playwright's own 1.59 changelog, to independently verify the Svelte-removal-without-warning claim (currently single-sourced from currents.dev).
- Whether Playwright ships any `<script setup>`-specific mounting sugar, or only the render-function API shown in the docs example.

## What I looked for and could not find
- Primary npm-registry metadata for `@playwright/experimental-ct-vue` (403'd twice).
- A second independent primary source (beyond playwright.dev) stating the new `fixtures.mount()` model is stable/GA'd.
- Explicit naming of `getBoundingClientRect`/`ResizeObserver`/`scrollTop` support in any Playwright CT doc (inferred architecturally, not confirmed by name).
- Maintainer-level commentary with a date on CT's long-term future (issue #26778's comments not retrieved).
- Any explicit statement that Vue support trails React's specifically.
- Independent verification of the Svelte-removal-in-1.59 claim from Playwright's own release notes.
