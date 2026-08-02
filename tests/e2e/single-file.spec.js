// The built artefact, opened the way the product is actually used: a file:// URL,
// no server, no origin. AD-27.
//
// Two caveats are written into this file rather than left to be rediscovered,
// because both are ways this suite can be green and wrong:
//
//   AD-18 — the network assertion runs in Chromium only, because Playwright
//   observes HTTP channels and file:// is not one. Re-measured here on 2026-08-02
//   against Playwright 1.62.1, by sabotaging a built artefact with five runtime
//   subresources (three http://, two relative file://) and asking each engine what
//   it saw: **Chromium reported 6 of 6** — the document and all five — while
//   **Firefox reported 0**, not even the document. A split bundle would pass green
//   there. The spine records this caveat as "1 of 5" from an earlier probe of a
//   different composition; the direction is identical and the figure here is the
//   one this suite was built against. A green Firefox network check is not
//   evidence, so the assertion is skipped with that reason attached rather than
//   run and believed.
//
//   AD-16 — the storage-isolation rule is NOT TESTED HERE AND CANNOT BE. Playwright's
//   bundled Firefox ships `security.fileuri.strict_origin_policy: false` and is more
//   permissive than a real double-click, so any isolation result it produced would
//   describe the harness rather than the platform. The measured truth — one shared
//   bucket across directories in both engines — came from real browsers driven
//   outside this suite. Nothing below asserts it; that gap is deliberate and stated.

import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

const ARTIFACT = resolve('dist/index.html')
const ARTIFACT_URL = pathToFileURL(ARTIFACT).href

test.beforeAll(() => {
  if (!existsSync(ARTIFACT)) {
    throw new Error(
      `No built artefact at ${ARTIFACT}. Run \`npm run build\` first — this suite tests the ` +
        'built file, never a dev server, because a dev server serves an origin the product never has.',
    )
  }
})

test.describe('the artefact opens from file://', () => {
  test('mounts and renders, with no page error and no console error', async ({ page }) => {
    const consoleErrors = []
    const pageErrors = []
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
    page.on('pageerror', (e) => pageErrors.push(e.message))

    await page.goto(ARTIFACT_URL)

    await expect(page.getByRole('heading', { name: 'querbeet', level: 1 })).toBeVisible()
    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test('renders German text with umlauts intact', async ({ page }) => {
    await page.goto(ARTIFACT_URL)

    // Proves the whole chain in one assertion: the build inlined the module, Vue
    // mounted, core/diagnostics was reachable from the driving adapter, and the
    // German sentence was composed in ui/ from a code and a structured value
    // (AD-13, C-6). The umlaut proves the charset survived inlining.
    await expect(page.getByText('Gerüst steht')).toBeVisible()
    await expect(page.getByText('nichts in der Spalte entscheidet die Lesart')).toBeVisible()
  })

  test('formats numbers in German conventions', async ({ page }) => {
    await page.goto(ARTIFACT_URL)

    // 4200 → "4.200", not "4,200". CAP-31 requires German display conventions
    // regardless of the locale a value was read in, and a headless browser with a
    // C locale is exactly where an implicit host-locale dependency would show up.
    await expect(page.getByText('4.200 → 61.000')).toBeVisible()
  })
})

test.describe('nothing is fetched at runtime', () => {
  test('issues no request beyond the document itself', async ({ page, browserName }) => {
    test.skip(
      browserName === 'firefox',
      'AD-18: Playwright observes HTTP channels and file:// is not one. Measured against a ' +
        'sabotaged artefact carrying five subresources, Firefox reported 0 requests where ' +
        'Chromium reported all 6. A split bundle would pass green. Chromium is the only ' +
        'engine where this assertion is evidence.',
    )

    const requested = []
    page.on('request', (r) => requested.push(r.url()))

    await page.goto(ARTIFACT_URL)
    await expect(page.getByRole('heading', { name: 'querbeet', level: 1 })).toBeVisible()

    const subresources = requested.filter((u) => u !== ARTIFACT_URL)
    expect(
      subresources,
      'AD-17: a file:// page has an opaque origin and anything it fetches fails CORS. ' +
        'Any URL here is a lazy chunk, a font, a stylesheet or a CDN link that the ' +
        'single-file build was supposed to have inlined.',
    ).toEqual([])
  })
})
