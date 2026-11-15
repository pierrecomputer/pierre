import { expect, type Page, test } from '@playwright/test';

// The timing of `PANE_VISIBILITY_EVENT` against the paint of the frame that
// shows the change (demo/timing.tsx), for `Layout.Root`: for a click on a
// collapse button, a click that shows another tab, and a hide from a timer,
// outside a React event.

interface EventRecord {
  pane: string;
  hidden: boolean;
  trigger: string;
  beforeFrame: boolean;
  beforePaint: boolean;
}

const records = (page: Page): Promise<EventRecord[]> =>
  page.evaluate(
    () =>
      (window as unknown as { __timing: { records: EventRecord[] } }).__timing
        .records
  );

async function run(page: Page): Promise<EventRecord[]> {
  await page.goto('/timing.html');
  await expect(page.locator('[data-layout-pane]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Collapse terminal' }).click();
  await expect.poll(async () => (await records(page)).length).toBe(1);
  await page.getByRole('button', { name: 'Show output' }).click();
  await expect.poll(async () => (await records(page)).length).toBe(3);
  await page.evaluate(() =>
    (
      window as unknown as {
        __timing: { setHiddenLater(id: string, hidden: boolean): void };
      }
    ).__timing.setHiddenLater('editor', true)
  );
  await expect.poll(async () => (await records(page)).length).toBe(4);
  // Wait for the paint of the last change.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => setTimeout(resolve, 0))
      )
  );
  return records(page);
}

const EXPECTED = [
  { pane: 'terminal', hidden: true, trigger: 'click' },
  { pane: 'logs', hidden: true, trigger: 'click' },
  { pane: 'output', hidden: false, trigger: 'click' },
  { pane: 'editor', hidden: true, trigger: 'timer' },
];

test('Root sends each visibility event before the paint that shows its change', async ({
  page,
}) => {
  const events = await run(page);
  test.info().annotations.push({
    type: 'timing',
    description: JSON.stringify(events),
  });
  expect(
    events.map(({ pane, hidden, trigger }) => ({ pane, hidden, trigger }))
  ).toEqual(EXPECTED);
  // Each event comes before the frame callback of the frame that shows the
  // change, so before its paint.
  for (const event of events) {
    expect(event.beforeFrame).toBe(true);
    expect(event.beforePaint).toBe(true);
  }
});
