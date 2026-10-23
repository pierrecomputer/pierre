import type { Browser, CDPSession, Page } from '@playwright/test';

import { summarizeTrace, TRACE_CATEGORIES, type TraceSummary } from './trace';

/** One measured run of one scenario: trace data, CDP counters, and content counters. */
export interface Sample extends TraceSummary {
  cdpLayoutCount: number;
  cdpRecalcStyleCount: number;
  cdpLayoutMs: number;
  cdpRecalcStyleMs: number;
  cdpScriptMs: number;
  cdpTaskMs: number;
  contentRenders: number;
  contentResizeCallbacks: number;
}

const CDP_METRICS = {
  LayoutCount: 'cdpLayoutCount',
  RecalcStyleCount: 'cdpRecalcStyleCount',
  LayoutDuration: 'cdpLayoutMs',
  RecalcStyleDuration: 'cdpRecalcStyleMs',
  ScriptDuration: 'cdpScriptMs',
  TaskDuration: 'cdpTaskMs',
} as const;

type CdpMetricName = keyof typeof CDP_METRICS;

async function readCdpMetrics(
  session: CDPSession
): Promise<Record<CdpMetricName, number>> {
  const { metrics } = await session.send('Performance.getMetrics');
  const values = {} as Record<CdpMetricName, number>;
  for (const name of Object.keys(CDP_METRICS) as CdpMetricName[]) {
    values[name] = metrics.find((metric) => metric.name === name)?.value ?? 0;
  }
  return values;
}

/** Wait for two frames and a short idle period, so that earlier work does not leak into a measurement. */
export async function settle(page: Page, idleMs = 150): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  await page.waitForTimeout(idleMs);
}

/**
 * Run one operation under a Chrome trace and the CDP Performance domain.
 * Durations from CDP are in seconds; the sample stores milliseconds.
 */
export async function measure(
  browser: Browser,
  page: Page,
  operation: () => Promise<void>
): Promise<Sample> {
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  await page.evaluate(() => window.__layoutsBench.resetCounters());
  const before = await readCdpMetrics(session);
  await browser.startTracing(page, { categories: TRACE_CATEGORIES });
  await operation();
  const trace = await browser.stopTracing();
  const after = await readCdpMetrics(session);
  const content = await page.evaluate(() => window.__layoutsBench.counters());
  await session.detach();

  const delta = (name: CdpMetricName, scale = 1): number =>
    (after[name] - before[name]) * scale;
  return {
    ...summarizeTrace(trace.toString()),
    cdpLayoutCount: delta('LayoutCount'),
    cdpRecalcStyleCount: delta('RecalcStyleCount'),
    cdpLayoutMs: delta('LayoutDuration', 1000),
    cdpRecalcStyleMs: delta('RecalcStyleDuration', 1000),
    cdpScriptMs: delta('ScriptDuration', 1000),
    cdpTaskMs: delta('TaskDuration', 1000),
    contentRenders: content.renders,
    contentResizeCallbacks: content.resizeCallbacks,
  };
}
