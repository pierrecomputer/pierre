import { expect, type Page, test } from '@playwright/test';

// The fixture's window helpers (see fixtures/code-view-blank-lines.html).
interface RenderedRow {
  line: number;
  text: string;
  height: number;
}

declare global {
  interface Window {
    __blankLinesReady?: boolean;
    __blankLines?: {
      root: HTMLElement;
      rowStart(lineNumber: number): { x: number; y: number };
      rows(from: number, to: number): RenderedRow[];
      lines(): string[];
    };
  }
}

// One-based line the edit starts on, far enough down that CodeView renders
// only a window of rows around it.
const EDIT_LINE = 170;

async function openFixture(page: Page): Promise<void> {
  await page.goto('/test/e2e/fixtures/code-view-blank-lines.html');
  await page.waitForFunction(() => window.__blankLinesReady === true);
}

async function press(page: Page, key: string, count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    await page.keyboard.press(key);
  }
}

test('blank lines added inside a run of blank lines render at full height', async ({
  page,
}) => {
  await openFixture(page);
  await page.locator('[data-code-view-root]').hover();
  await page.mouse.wheel(0, (EDIT_LINE - 8) * 20);
  await expect
    .poll(() =>
      page.evaluate(
        (line) => window.__blankLines!.rows(line, line).length,
        EDIT_LINE
      )
    )
    .toBe(1);

  const start = await page.evaluate(
    (line) => window.__blankLines!.rowStart(line),
    EDIT_LINE
  );
  await page.mouse.click(start.x, start.y);
  await page.keyboard.press('Home');

  // Three blank lines, back to the first of them, then three more inside the run.
  await press(page, 'Enter', 3);
  await press(page, 'ArrowUp', 3);
  await press(page, 'Enter', 3);

  await expect
    .poll(() =>
      page.evaluate(
        (line) => window.__blankLines!.lines().slice(line - 1, line + 6),
        EDIT_LINE
      )
    )
    .toEqual(['', '', '', '', '', '', 'const value170 = 170;']);

  // Every rendered row matches the document and takes up a full line.
  const rows = await page.evaluate(
    (line) => window.__blankLines!.rows(line - 1, line + 7),
    EDIT_LINE
  );
  const lines = await page.evaluate(() => window.__blankLines!.lines());
  expect(rows).toHaveLength(9);
  for (const row of rows) {
    expect(row.text, `line ${row.line}`).toBe(lines[row.line - 1]);
    expect(row.height, `line ${row.line}`).toBeGreaterThan(0);
  }
});
