import { test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

import { measure, type Sample, settle } from './lib/measure';
import { options } from './lib/options';
import type { RawRecord } from './lib/report';
import { SCENARIOS } from './lib/scenarios';
import { BENCH_VIEWPORT } from './playwright.config';

const scenarios = SCENARIOS.filter(
  ({ id }) => options.scenarios.length === 0 || options.scenarios.includes(id)
);

for (const panes of options.panes) {
  for (const content of options.content) {
    for (const scenario of scenarios) {
      test(`${scenario.id} · ${panes} panes · ${content}`, async ({
        browser,
        page,
      }, testInfo) => {
        const params = { panes, content };
        const samples: Sample[] = [];
        for (let run = 0; run < options.warmupRuns + options.runs; run++) {
          // A fresh document for each run, so that no state from an earlier run remains.
          await page.setViewportSize(BENCH_VIEWPORT);
          await page.goto(`/?panes=${panes}&content=${content}`);
          await page.waitForFunction(() => window.__layoutsBench?.ready);
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
