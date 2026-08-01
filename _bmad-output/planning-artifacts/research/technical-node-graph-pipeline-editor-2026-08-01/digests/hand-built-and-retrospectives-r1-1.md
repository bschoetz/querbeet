# Digest — hand-built cost & library retrospectives (round 1, assistant 3)

Lane: what hand-building a node editor actually costs, and what practitioners say 6–12 months
into using a node-editor library. Budget: 8 sources / 12 tool calls.

## Findings

- Vue Flow is **not** xyflow code and is not published from the xyflow monorepo — it is an independent Vue 3 reimplementation by a single author (bcakmakoglu), whose README states verbatim: *"Vue flow is heavily based on webkid's ReactFlow. I wholeheartedly thank them for their amazing work!"* — https://github.com/bcakmakoglu/vue-flow | GitHub / bcakmakoglu | README undated, repo state read 2026-08-01 | accessed 2026-08-01 | confidence: high | class: architecture
- Vue Flow repo state at access: 6.8k stars, 405 forks, 12 open issues, 3,857 commits on master, MIT — a healthy but **single-maintainer** project — https://github.com/bcakmakoglu/vue-flow | GitHub | accessed 2026-08-01 | confidence: high | class: ecosystem
- `@vue-flow/core` latest published version is **1.48.2**; the registry metadata retrieved by this assistant was truncated and did not yield its publish date — https://registry.npmjs.org/@vue-flow/core | npm registry | accessed 2026-08-01 | confidence: medium (version high, date not established) | class: ecosystem
  - *Lead note: closed by the lead's own registry read — 1.48.2 published 2026-01-28. See `imports/npm-package-audit-2026-08-01.md`.*
- Vue Flow's issue tracker shows a recurring **state-synchronisation** cluster: #1630 (open) race condition where nodes/edges removed via change handlers persist in serialised state; #291, #288, #50 (all closed) edges reappearing or erroring after external state mutation — https://github.com/bcakmakoglu/vue-flow/issues | GitHub API | accessed 2026-08-01 | confidence: medium | class: experience
- Vue Flow #1886 (**open**): TypeScript "Type instantiation is excessively deep and possibly infinite" introduced in **v1.45.0+** — a live regression against a version close to current — https://github.com/bcakmakoglu/vue-flow/issues/1886 | GitHub | accessed 2026-08-01 | confidence: medium | class: ecosystem
- Vue Flow #174 (closed): handle/anchor positions computed wrongly on nodes with **dynamic height** — the DOM-measurement problem is real in the Vue port too — https://github.com/bcakmakoglu/vue-flow/issues/174 | GitHub | accessed 2026-08-01 | confidence: medium | class: architecture
- React Flow's two highest-comment issues of all time are **undo/redo** (#656, 53 comments, open 2020-11-02 → closed 2022-02-22) and **auto-layout** (#5, 42 comments, 2019-10-07 → 2021-03-07) — both resolved as "do it yourself / use dagre", i.e. the library never absorbed them — https://github.com/xyflow/xyflow/issues/656, https://github.com/xyflow/xyflow/issues/5 | GitHub | accessed 2026-08-01 | confidence: high | class: architecture
- React Flow #3270 (closed 2023-09-18): **a node disappears entirely if you don't set an explicit width** when its content is dynamic — node measurement is a load-bearing, non-obvious contract — https://github.com/xyflow/xyflow/issues/3270 | GitHub | accessed 2026-08-01 | confidence: high | class: architecture
- React Flow #4528 (39 comments, 2024-08-08 → closed 2024-09-16): the **v11→v12 upgrade broke edge positions when nodes contain images** — major-version upgrades of this library shift layout behaviour — https://github.com/xyflow/xyflow/issues/4528 | GitHub | accessed 2026-08-01 | confidence: high | class: experience
- React Flow #4888 "Edge not displayed" is **still open** (created 2024-12-15, 20 comments), an intermittent edge-render failure needing a refresh — https://github.com/xyflow/xyflow/issues/4888 | GitHub | accessed 2026-08-01 | confidence: medium | class: experience
- React Flow uses **d3-zoom** for pan/zoom; maintainer moklick in 2021: *"We are using d3-zoom for panning and zooming the pan but I am actually looking for an alternative to decrease the size of react flow."* Confirmed still live as a dependency-conflict source in #1979 (2022-03-17 → closed 2024-03-23) — https://news.ycombinator.com/item?id=26860381 | Hacker News | 2021-04-19 | accessed 2026-08-01 | confidence: high | class: architecture
- Flyde's author (gabigrin) on rendering strategy: *"When I started Flyde, I went for DOM as it was the simplest solution to get something working. I was sure a rewrite to WebGL/Canvas would be needed to be performant, but we managed to render pretty complex flows"* — an explicit retrospective that the expected canvas rewrite never became necessary — https://news.ycombinator.com/item?id=43834830 | Hacker News | 2025-04-29 | accessed 2026-08-01 | confidence: medium (single account) | class: performance
- A practitioner who hand-built a node editor for ffmpeg filter graphs characterises the work as *"fairly straightforward but a ton of bitch work"* — the only direct effort-shaped account retrieved — https://news.ycombinator.com/item?id=47600744 | Hacker News | 2026-04-01 | accessed 2026-08-01 | confidence: low (single anecdote, AI-assisted build) | class: experience

## The hand-built cost picture

**The assistant reports it did not establish this to the standard the brief demanded.** Five
retrieval attempts (general web search, two Hacker News full-text comment sweeps, a story sweep)
produced **no retrospective with a line count, a time estimate, or a documented reversal in
either direction**. Marked as weaker than it should be rather than dressed up.

**Cheap — corroborated.** DOM/SVG rendering of nodes scales further than practitioners expect.
Flyde's author budgeted for a WebGL/canvas rewrite on performance grounds and never needed it
(HN 2025-04-29). At 5–30 nodes this is not a close call.

**Expensive — inferred from the library's own scar tissue rather than from hand-builders.** The
strongest available proxy is which problems the mature library *refused to solve for you*,
because those are exactly the ones a hand-builder inherits in full:

- **Undo/redo** — React Flow's single most-discussed issue ever (53 comments), closed without the
  library owning it. You write this yourself either way; it is not a differentiator.
- **Auto-layout** — same shape (#5, 42 comments), punted to dagre/elkjs. Also not a differentiator.
- **Node dimension measurement** — this *is* a differentiator. React Flow #3270 (a node vanishes
  without an explicit width) and Vue Flow #174 (handles misplaced on dynamic-height nodes) are the
  same bug in two independent codebases. Anchor positions depend on measured DOM geometry, that
  measurement is asynchronous, and both mature libraries shipped years of bugs here. A hand-built
  editor with variable-height nodes hits this on day one.
- **Coordinate-space conversion under zoom** — React Flow #1075 and the d3-zoom dependency
  conflicts (#1979) show the reference implementation delegates this to a battle-tested external
  library rather than hand-rolling it.

**Scale concerns that do NOT apply at 5–30 nodes:** React Flow #723 ("stress test performance
quite poor", 10×10 = 100 nodes), #2119 (drag lag under React 18) and the open RFC #4239 (BVH
spatial queries, viewport virtualisation, open since 2024-05-02) are all >100-node problems.
Viewport culling, canvas-vs-DOM rendering and spatial indexing are irrelevant at this size; advice
sourced from those threads should be discounted to zero here.

**Hit testing on connections** — no evidence found in either direction. Noted: at 30 nodes an SVG
`<path>` with a widened transparent `stroke` sibling handles this natively via DOM events; the
hard-case literature is about canvas, which this project does not need.

## Library regrets after 6–12 months

**Correction to the brief's premise:** xyflow's monorepo publishes React Flow and **Svelte** Flow.
**Vue Flow shares no code with them.** Every React Flow finding is therefore a *lesson about the
problem shape*, not a property the Vue package inherits. Bug-fix status especially does not
transfer: a React Flow issue closed in 2024 says nothing about whether Vue Flow has it.

1. **State ownership / sync between library and app store — still open, both libraries.** Vue Flow
   #1630 (open) is a race where nodes and edges deleted through change handlers survive in
   serialised output; #291, #288, #50 are closed variants. React Flow #1168 (closed 2021-07-01) is
   the controlled-vs-uncontrolled confusion that led xyflow to push users toward Zustand — and an
   HN commenter (HiPhish, 2026-01-04) confirms the pattern persists. **Best-evidenced regret, and
   exactly the "library's model fights the app's model" failure.**
2. **Dynamic node sizing breaks edge anchoring** — since-fixed in React Flow (#3270, closed
   2023-09-18), closed in Vue Flow (#174), but recurs across major versions (#4528, v11→v12).
3. **Major-version upgrades shift layout behaviour** — #4528 documented (39 comments). A risk, not
   a bug with a fix.
4. **TypeScript depth-limit regression in Vue Flow v1.45.0+ (#1886) — still open** against a
   version one minor behind current 1.48.2. The one complaint live against the version you would
   actually install.
5. **Nuxt 3 incompatibility (Vue Flow #25) closed "wontfix"** — evidence is an old closed issue,
   not the present state.
6. **Licensing/Pro model:** HN grumbling about React Flow Pro pricing; **zero** licensing issues in
   the xyflow tracker. Vue Flow is MIT with no Pro tier.

## Leads worth chasing

- `@vue-flow/core` release cadence via the registry `time` object — *closed by the lead.*
- xyflow's React Flow Developer Survey 2023 — maintainer-published, discount for advocacy, but
  quantified practitioner pain-point data.
- **Rete.js, Drawflow, LiteGraph, jsPlumb, Baklava — nothing retrieved on any of them.** Their
  issue trackers via the GitHub search API is the cheapest high-yield next step.
- HN thread 48654484, "2026: The year of the node based editor" (2026-06-24, 4 comments).
- webkid.io's *datablocks* post — the React Flow authors built a data-wrangling node editor on
  their own library. Closest published artifact to this project's actual shape.

## What I looked for and could not find

- **Any account with a line count, hour count or sprint count for a hand-built web node editor.**
  Four query formulations, zero hits. The brief's highest-value ask, returned empty.
- **Any documented reversal in either direction** — no "we replaced our hand-built editor with Vue
  Flow", no "we ripped out React Flow for our own SVG".
- **Second independent confirmation for the Vue Flow state-sync complaint.** All of it comes from
  one issue tracker, so it is one project's bug list, not two independent practitioner accounts.
  Per the two-source rule, "Vue Flow state sync fails" is **not** stated as a finding.
- Anything about nested scroll containers or browser zoom in a node editor.
- **Reddit entirely** — r/vuejs and r/webdev inaccessible through the search tool this run. The
  Vue-specific practitioner voice is missing from this digest as a result.
