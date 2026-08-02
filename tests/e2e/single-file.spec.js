// The built artefact, opened the way the product is actually used: a file:// URL,
// no server, no origin. AD-27.
//
// Two caveats are written into this file rather than left to be rediscovered,
// because both are ways this suite can be green and wrong:
//
//   AD-18 — the network assertion runs in Chromium only, because Playwright's
//   Firefox network layer is built on Gecko's HTTP-channel observer topics and
//   file:// is not an HTTP channel. Re-confirmed 2026-08-02 against Playwright
//   1.62.1 and a real built artefact, sabotaged with five runtime subresources and
//   counted per scheme:
//
//     scheme                              Chromium   Firefox
//     the file:// document                       1         0
//     http:// on an open port                    2         2
//     http:// on a Firefox-banned port (9)       1         0
//     relative file:// subresources              2         0
//
//   So the blindness is specific, and the specificity matters: Firefox sees
//   ordinary http:// fine — a CDN link or an external font *is* caught in both
//   engines — and sees no file:// traffic at all. The split-bundle case is exactly
//   the one that goes unobserved, which is the failure AD-18 exists to prevent, so
//   a green Firefox run here is not evidence and the assertion is skipped with
//   that reason attached rather than run and believed.
//
//   Recorded because it cost a wrong conclusion once: the first probe used port 9
//   for every http:// request. Port 9 is on Firefox's default banned-port list, so
//   Firefox reported nothing and the probe appeared to show it blind to http://
//   as well. It is not. Pick an unbanned port when re-measuring this.
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

  test('shows no raw core vocabulary — the interface is German, not just its sentences', async ({
    page,
  }) => {
    await page.goto(ARTIFACT_URL)
    const shown = (await page.locator('body').innerText()).toLowerCase()

    // The first build of this scaffold rendered the severity enum straight to the
    // screen as WARNING and UNRESOLVED. The sentences were German and the label
    // was not, which is still core/ talking to the user (AD-13, C-6). Severities
    // are the enum that leaked; diagnostic codes are the other machine vocabulary
    // that must never surface, and `?? d.code` in ui/ is a live fallback path to
    // exactly that.
    // Word boundaries, not substrings: "Informationen" is a perfectly good German
    // word that contains "info", and a test that forbids it would be deleted the
    // first time it cried wolf.
    for (const enumValue of ['info', 'warning', 'error', 'unresolved']) {
      expect(shown, `severity "${enumValue}" reached the screen untranslated`).not.toMatch(
        new RegExp(`\\b${enumValue}\\b`),
      )
    }

    // A diagnostic code is dotted and snake_cased, which no German sentence is.
    expect(shown, 'a diagnostic code reached the screen instead of a sentence').not.toMatch(
      /\b[a-z]+\.[a-z]+_[a-z_]+\b/,
    )
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
      'AD-18: Playwright observes HTTP channels and file:// is not one. Measured, Firefox ' +
        'reports zero file:// requests — not the document, not a sibling chunk — where ' +
        'Chromium reports every one. A split bundle would pass green here. Chromium is the ' +
        'only engine where this assertion is evidence.',
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
