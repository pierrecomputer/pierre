import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

import {
  attribute,
  type Attribution,
  measure,
  probeDisplay,
  type Sample,
  settle,
} from './lib/measure';
import { measureMemory, type MemorySnapshot } from './lib/memory';
import { options } from './lib/options';
import { GROWTH_VALUES, type RawRecord, type RepeatRecord } from './lib/report';
import {
  type ContentWeight,
  hideOtherPanes,
  REPEAT_CYCLES,
  repeatZoomAndHide,
  SCENARIOS,
  zoomFirstPane,
} from './lib/scenarios';
import { BENCH_VIEWPORT } from './playwright.config';

const selected = (id: string): boolean =>
  options.scenarios.length === 0 || options.scenarios.includes(id);
const scenarios = SCENARIOS.filter(({ id }) => selected(id));

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
  expect(forced.taskLayoutMs).toBeGreaterThan(0);
  // The parts of the breakdown add up to the main-thread time.
  const parts =
    forced.taskScriptMs +
    forced.taskStyleMs +
    forced.taskLayoutMs +
    forced.taskPrePaintMs +
    forced.taskPaintMs +
    forced.taskLayerizeMs +
    forced.taskCommitMs +
    forced.taskGcMs +
    forced.taskOtherMs;
  expect(Math.abs(parts - forced.mainThreadMs)).toBeLessThan(0.05);

  // Attribution: a text change in pane a stays in pane a; a font size change
  // above both panes reaches both.
  const attributeRun = (name: 'paneText' | 'sharedFont') =>
    attribute(
      browser,
      page,
      async () => {
        await page.evaluate(
          (operation) => window.__selftest[operation](),
          name
        );
        await page.waitForTimeout(200);
      },
      'a'
    );
  const contained = await attributeRun('paneText');
  expect(contained.panes.a?.[0] ?? 0).toBeGreaterThan(0);
  expect(contained.layoutInvalidationsOutsideTarget).toBe(0);
  const shared = await attributeRun('sharedFont');
  expect(shared.layoutInvalidatedPanes).toBe(1);
  expect(shared.innerLayoutInvalidationsOutsideTarget).toBeGreaterThan(0);
});

// Four composited panes of 256 by 256 CSS pixels with a gradient each add four
// layers and four tiles. When a browser update renames a memory-infra field or
// changes the layer data, this test fails, and the run does not report zeros.
test('self-test: memory values match a page with known layers', async ({
  page,
}) => {
  await page.goto('/selftest.html');
  await page.waitForFunction(() => window.__selftest !== undefined);
  await settle(page);
  const before = await measureMemory(page);
  await page.evaluate(() => window.__selftest.addLayers(4));
  await settle(page);
  const after = await measureMemory(page);

  for (const value of [
    'tileMemoryMb',
    'rendererMb',
    'gpuMb',
    'v8Mb',
    'blinkGcMb',
    'partitionAllocMb',
    'mallocMb',
    'jsHeapMb',
    'domNodes',
  ] as const)
    expect(after[value], value).toBeGreaterThan(0);
  expect(after.layers - before.layers).toBe(4);
  expect(after.drawingLayers - before.drawingLayers).toBe(4);
  // Each pane is one layer of the same size.
  expect(after.panes.m0?.estimatedRasterMb).toBeGreaterThan(0);
  for (const id of ['m0', 'm1', 'm2', 'm3']) {
    expect(after.panes[id]?.drawingLayers).toBe(1);
    expect(after.panes[id]?.estimatedRasterMb).toBeCloseTo(
      after.panes.m0.estimatedRasterMb,
      3
    );
  }
  // The measured tiles of the new layers agree with the estimate.
  const added = after.tileMemoryMb - before.tileMemoryMb;
  const estimated = 4 * after.panes.m0.estimatedRasterMb;
  expect(added).toBeGreaterThan(estimated * 0.75);
  expect(added).toBeLessThan(estimated * 1.5);
  expect(after.tileMemoryVisibleMb).toBeGreaterThan(before.tileMemoryVisibleMb);
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
        const otherTasks: { name: string; ms: number }[] = [];
        // A fresh document for each run, so that no state from an earlier run remains.
        const prepare = async (): Promise<
          Awaited<ReturnType<NonNullable<typeof scenario.setup>>>
        > => {
          await page.setViewportSize(BENCH_VIEWPORT);
          await page.goto(url);
          await page.waitForFunction(() => window.__layoutsBench?.ready);
          if (content === 'real')
            await page.waitForTimeout(REAL_CONTENT_SETTLE_MS);
          const point = await scenario.setup?.(page, params);
          await settle(page);
          return point;
        };
        for (let run = 0; run < options.warmupRuns + options.runs; run++) {
          const point = await prepare();
          const sample = await measure(
            browser,
            page,
            () => scenario.run(page, params, point),
            otherTasks
          );
          if (run >= options.warmupRuns) samples.push(sample);
        }
        // One extra run attributes the work to panes, and then measures the
        // memory of the page after the operation.
        let attribution: Attribution | undefined;
        let memory: MemorySnapshot | undefined;
        if (options.attribution || options.memory) {
          const point = await prepare();
          const operation = (): Promise<void> =>
            scenario.run(page, params, point);
          if (options.attribution)
            attribution = await attribute(
              browser,
              page,
              operation,
              scenario.target ?? null
            );
          else await operation();
          if (options.memory) memory = await measureMemory(page);
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
          otherTasks,
          attribution,
          memory,
        };
        writeFileSync(
          testInfo.outputPath('record.json'),
          JSON.stringify(record)
        );
      });
    }
  }
}

// The repeat scenario: memory before and after repeated zooms and hides, each
// after the page settles. One cycle of each runs first, so that memory that
// the first operation allocates once does not count as growth. Then the
// raster memory of covered panes: a zoom, and the same zoom with every other
// pane hidden, which removes their layers.
const repeatParams: [number, ContentWeight][] =
  options.memory && selected('repeat')
    ? options.panes.flatMap((panes) =>
        options.content.map((content): [number, ContentWeight] => [
          panes,
          content,
        ])
      )
    : [];
for (const [panes, content] of repeatParams) {
  test(`repeat · ${panes} panes · ${content}`, async ({
    browser,
    page,
  }, testInfo) => {
    await page.setViewportSize(BENCH_VIEWPORT);
    await page.goto(
      `/?panes=${panes}&content=${content}${options.query === '' ? '' : `&${options.query}`}`
    );
    const display = await probeDisplay(page);
    await page.waitForFunction(() => window.__layoutsBench?.ready);
    if (content === 'real') await page.waitForTimeout(REAL_CONTENT_SETTLE_MS);
    await repeatZoomAndHide(page, 1);
    await settle(page);
    const before = await measureMemory(page);
    await repeatZoomAndHide(page, REPEAT_CYCLES);
    await settle(page);
    const after = await measureMemory(page);
    const growth = Object.fromEntries(
      GROWTH_VALUES.map((value) => [
        value,
        Number((after[value] - before[value]).toFixed(3)),
      ])
    ) as RepeatRecord['growth'];
    await zoomFirstPane(page);
    const zoomed = await measureMemory(page);
    await hideOtherPanes(page);
    const alone = await measureMemory(page);
    const record: RepeatRecord = {
      panes,
      content,
      browser: `chromium ${browser.version()}`,
      display: {
        refreshHz: display.refreshHz,
        deviceScaleFactor: display.deviceScaleFactor,
      },
      cycles: REPEAT_CYCLES,
      before,
      after,
      growth,
      covered: {
        zoomedMb: zoomed.tileMemoryMb,
        aloneMb: alone.tileMemoryMb,
        tileMemoryMb: Number(
          (zoomed.tileMemoryMb - alone.tileMemoryMb).toFixed(3)
        ),
      },
    };
    writeFileSync(testInfo.outputPath('repeat.json'), JSON.stringify(record));
  });
}
