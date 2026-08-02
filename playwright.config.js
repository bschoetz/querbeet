import { defineConfig, devices } from '@playwright/test'

// AD-27 — the test envelope is a rule, not a preference.
//
// core/ is tested under Vitest with no browser. The *built artefact* is tested
// here, from a file:// URL, because that is how the product is used: double-click,
// no server, no origin. A dev server would test a page this product never runs as.
//
// Chromium is the lead engine and every performance claim is measured there.
// Firefox is measured rather than assumed and is dropped rather than specially
// accommodated (C-4). Both run; what differs is which assertions are allowed to
// count as evidence — see the caveats in tests/e2e/single-file.spec.js.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    // No baseURL on purpose. Every navigation in this suite is an absolute
    // file:// URL built from the artefact's real path; a baseURL would invite a
    // relative goto and quietly reintroduce an origin.
    trace: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
})
