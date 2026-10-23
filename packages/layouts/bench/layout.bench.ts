import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

import { measure, probeDisplay, type Sample, settle } from './lib/measure';
import { options } from './lib/options';
import type { RawRecord } from './lib/report';
import { SCENARIOS } from './lib/scenarios';
import { BENCH_VIEWPORT } from './playwright.config';

const scenarios = SCENARIOS.filter(
  ({ id }) => options.scenarios.length === 0 || options.scenarios.includes(id)
);

// Real components finish async work after their first render, for example
// syntax highlighting in a diff. Wait for it, so that it does not leak into a trace.
const REAL_CONTENT_SETTLE_MS = 1500;

// The harness checks itself on a page with known counts, so that a browser
// update that renames a trace field fails the run instead of reporting zeros.
test('self-test: trace counts match a page with known work', async ({
  browser,
  page,
}) => {
  await page.goto('/selftest.html');
  await page.waitForFunction(() => window.__selftest !== undefined);
  const run = (name: 'composited' | 'mainThread' | 'forcedLayout') =>
    measure(browser, page, async () => {
      await page.evaluate((operation) => window.__selftest[operation](), name);
      await page.waitForTimeout(400);
    });
  const composited = await run('composited');
  expect(composited.animations).toBeGreaterThan(0);
  expect(composited.animationsNotComposited).toBe(0);
  expect(
    composited.framesPresented +
      composited.framesPartial +
      composited.framesDropped
  ).toBeGreaterThan(0);
  const mainThread = await run('mainThread');
  expect(mainThread.animationsNotComposited).toBeGreaterThan(0);
  expect(mainThread.framesWithMainAnimation).toBeGreaterThan(0);
  const forced = await run('forcedLayout');
  expect(forced.forcedLayouts).toBeGreaterThan(0);
});

for (const panes of options.panes) {
  for (const content of options.content) {
    for (const scenario of scenarios) {
      test(`${scenario.id} · ${panes} panes · ${content}`, async ({
        browser,
        page,
      }, testInfo) => {
        const url = `/?panes=${panes}&content=${content}${options.query === '' ? '' : `&${options.query}`}`;
        await page.setViewportSize(BENCH_VIEWPORT);
        await page.goto(url);
        const display = await probeDisplay(page);
        const params = { panes, content, frameMs: display.frameMs };
        const samples: Sample[] = [];
        for (let run = 0; run < options.warmupRuns + options.runs; run++) {
          // A fresh document for each run, so that no state from an earlier run remains.
          await page.setViewportSize(BENCH_VIEWPORT);
          await page.goto(url);
          await page.waitForFunction(() => window.__layoutsBench?.ready);
          if (content === 'real')
            await page.waitForTimeout(REAL_CONTENT_SETTLE_MS);
          const point = await scenario.setup?.(page, params);
          await settle(page);
          const sample = await measure(browser, page, () =>
            scenario.run(page, params, point)
          );
          if (run >= options.warmupRuns) samples.push(sample);
        }
        const record: RawRecord = {
          scenario: scenario.id,
          panes,
          content,
          steps: scenario.steps ?? 1,
          browser: `chromium ${browser.version()}`,
          display: {
            refreshHz: display.refreshHz,
            deviceScaleFactor: display.deviceScaleFactor,
          },
          samples,
        };
        writeFileSync(
          testInfo.outputPath('record.json'),
          JSON.stringify(record)
        );
      });
    }
  }
}
