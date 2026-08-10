import { expect, type Page, test } from '@playwright/test';

const CONTENT = '[data-content]';

async function openFixture(page: Page): Promise<void> {
  await page.goto('/test/e2e/fixtures/editable.html');
  await page.waitForFunction(() => window.__editableReady === true);
}

const contents = (page: Page): Promise<string> =>
  page.evaluate(() => window.__editor?.getText() ?? '');

const selectionTuples = (page: Page): Promise<number[][] | undefined> =>
  page.evaluate(() =>
    window.__editor
      ?.getState()
      .selections?.map((selection) => [
        selection.start.line,
        selection.start.character,
        selection.end.line,
        selection.end.character,
      ])
  );

test.describe('multi-cursor and indentation', () => {
  // Adding a caret with a modifier-click can't be simulated in the pinned
  // headless Chromium: selectionchange fires before pointerdown there, so the
  // editor can't reserve the prior caret before the new one lands. We instead
  // seed two carets through the public setSelections API and drive real
  // keyboard input, which exercises the multi-caret edit pipeline itself.
  test('typing with multiple carets edits every caret', async ({ page }) => {
    await openFixture(page);

    await page.locator(CONTENT).click();
    await page.evaluate(() => {
      const editor = window.__editor;
      if (editor == null) {
        throw new Error('editor missing');
      }
      editor.focus();
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
        {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 0 },
          direction: 'none',
        },
      ]);
    });

    await page.keyboard.type('Z');

    // Both carets receive the keystroke, so two Z's are inserted.
    await expect
      .poll(async () => (await contents(page)).split('Z').length - 1)
      .toBe(2);
  });

  test('Alt-drag keeps its goal column across short and empty lines', async ({
    page,
  }) => {
    await openFixture(page);

    const content = page.locator(CONTENT);
    await content.click();
    await content.evaluate((element) => {
      const history: number[][][] = [];
      let recording = false;
      Reflect.set(window, '__altDragSelectionHistory', history);
      element.addEventListener('pointerdown', (event) => {
        recording = event instanceof PointerEvent && event.altKey;
        if (recording) {
          history.length = 0;
        }
      });
      document.addEventListener('selectionchange', () => {
        if (!recording) {
          return;
        }
        const selections = window.__editor
          ?.getState()
          .selections?.map((selection) => [
            selection.start.line,
            selection.start.character,
            selection.end.line,
            selection.end.character,
          ]);
        if (selections !== undefined) {
          history.push(selections);
        }
      });
      document.addEventListener('pointerup', () => {
        recording = false;
      });
    });

    const points = await content.evaluate((element) => {
      const rect = (selector: string): DOMRect => {
        const target = element.querySelector(selector);
        if (target == null) {
          throw new Error(`column selection target missing: ${selector}`);
        }
        return target.getBoundingClientRect();
      };
      const short = rect('[data-line="3"]');
      const empty = rect('[data-line="4"]');
      const token = rect('[data-line="2"] [data-char="18"]');
      return {
        x: token.left + token.width / 2,
        startY: token.top + token.height / 2,
        shortY: short.top + short.height / 2,
        emptyY: empty.top + empty.height / 2,
      };
    });
    await page.keyboard.down('Alt');
    await page.mouse.move(points.x, points.startY);
    await page.mouse.down();
    await page.mouse.move(points.x, points.shortY, { steps: 4 });

    await expect
      .poll(async () => (await selectionTuples(page))?.length)
      .toBe(2);
    const anchor = (await selectionTuples(page))?.[0]?.[1] ?? -1;
    expect(anchor).toBeGreaterThan(16);

    await page.mouse.move(points.x, points.emptyY, { steps: 4 });
    const selections = [
      [1, anchor, 1, anchor],
      [2, 16, 2, 16],
      [3, 0, 3, 0],
    ];
    await expect.poll(() => selectionTuples(page)).toEqual(selections);

    await page.mouse.up();
    await page.keyboard.up('Alt');

    await expect.poll(() => selectionTuples(page)).toEqual(selections);

    const history = await page.evaluate(
      () => Reflect.get(window, '__altDragSelectionHistory') as number[][][]
    );
    expect(history.some((snapshot) => snapshot.length === 2)).toBe(true);
    expect(history.some((snapshot) => snapshot.length === 3)).toBe(true);
    for (const snapshot of history) {
      expect(snapshot).toEqual(selections.slice(0, snapshot.length));
    }
  });

  test('Tab indents selected lines and Shift+Tab outdents them', async ({
    page,
  }) => {
    await openFixture(page);
    const original = await contents(page);

    await page.locator(CONTENT).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Tab');

    // Every non-empty line gains a leading indent unit (tab or spaces).
    await expect
      .poll(async () =>
        (await contents(page))
          .split('\n')
          .filter((line) => line.length > 0)
          .every((line) => /^(\t| {2,})/.test(line))
      )
      .toBe(true);

    // Re-focus and re-select every line so the outdent applies to the whole
    // file regardless of where the indent left the selection. The explicit click
    // guarantees the content surface holds focus before the select-all, which
    // otherwise races the async re-render under parallel worker pressure.
    await page.locator(CONTENT).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => contents(page)).toBe(original);
  });
});
