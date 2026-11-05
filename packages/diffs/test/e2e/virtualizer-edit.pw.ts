import { expect, type Page, test } from '@playwright/test';

const FIRST = 'first';

const twoFrames = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );

// What the first file shows: a placeholder or rows, whether its editable
// content holds focus, and the row the native caret sits in.
const state = (page: Page) =>
  page.evaluate((id) => {
    const host = window.__virtualizerEdit?.getHost(id);
    const shadow:
      | (ShadowRoot & { getSelection?: () => Selection | null })
      | null
      | undefined = host?.shadowRoot;
    const content = shadow?.querySelector<HTMLElement>(
      '[data-content][contenteditable="true"]'
    );
    const selection = shadow?.getSelection?.() ?? document.getSelection();
    const anchor = selection?.anchorNode ?? null;
    const anchorElement =
      anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
    return {
      placeholder: shadow?.querySelector('[data-placeholder]') != null,
      focused: content != null && shadow?.activeElement === content,
      caretLine:
        content != null && anchor != null && content.contains(anchor)
          ? (anchorElement?.closest('[data-line]')?.getAttribute('data-line') ??
            null)
          : null,
    };
  }, FIRST);

// The editor's own idea of the caret: the primary selection's start, as a
// zero-based line.
const editorCaretLine = (page: Page) =>
  page.evaluate(
    (id) =>
      window.__virtualizerEdit?.getEditor(id)?.getViewState().selections?.at(-1)
        ?.start.line,
    FIRST
  );

const showsLine = (page: Page, line: number) =>
  page.evaluate(
    ([id, line]) =>
      window.__virtualizerEdit
        ?.getHost(id)
        ?.shadowRoot?.querySelector(`[data-content] > [data-line="${line}"]`) !=
      null,
    [FIRST, line] as const
  );

// Wheels the Virtualizer root in steps until `done` holds.
async function wheelUntil(
  page: Page,
  deltaY: number,
  done: () => Promise<boolean>
): Promise<void> {
  for (let step = 0; step < 60; step++) {
    await page.mouse.wheel(0, deltaY);
    await twoFrames(page);
    if (await done()) return;
  }
  throw new Error('the scroll never reached its target');
}

// Opens the fixture, puts the caret at the end of the first file's second
// line, and parks the pointer over the Virtualizer root for wheeling.
async function openWithCaretOnLine2(page: Page): Promise<void> {
  await page.goto('/test/e2e/fixtures/virtualizer-edit.html');
  await page.waitForFunction(() => window.__virtualizerEditReady === true);
  await page
    .locator(
      '[data-host="first"] [data-content][contenteditable="true"] > [data-line="2"]'
    )
    .click();
  await page.keyboard.press('End');
  expect(await state(page)).toEqual({
    placeholder: false,
    focused: true,
    caretLine: '2',
  });
  const box = await page.locator('[data-virtualizer-root]').boundingBox();
  if (box == null) throw new Error('missing the Virtualizer root');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

// Several editable files under a plain Virtualizer: scrolling the focused
// one out of view swaps its rows for a placeholder, which removes the
// focused content element.
test.describe('Virtualizer edit session across a placeholder swap', () => {
  test('focus and the caret come back when the rows render again', async ({
    page,
  }) => {
    await openWithCaretOnLine2(page);

    // Wheel down until the first file is a placeholder, then back up until
    // the caret's line has a row again.
    await wheelUntil(page, 600, async () => (await state(page)).placeholder);
    await wheelUntil(page, -600, () => showsLine(page, 2));
    // The caret comes back on a frame after the row renders; a slow machine
    // takes a few.
    await expect
      .poll(() => state(page))
      .toEqual({
        placeholder: false,
        focused: true,
        caretLine: '2',
      });
  });

  test('a render that drops the caret row keeps the editor on its line', async ({
    page,
  }) => {
    await openWithCaretOnLine2(page);

    // Scroll just far enough that the caret's row leaves the window while
    // the file stays mounted and its content keeps focus. The browser moves
    // the native selection onto whatever row is left.
    await wheelUntil(
      page,
      300,
      async () =>
        !(await showsLine(page, 2)) && !(await state(page)).placeholder
    );
    await twoFrames(page);
    await twoFrames(page);
    // The browser reports that move as a selection change of its own; on a
    // slow machine it lands after the editor's deferred focus frame has run.
    await page.evaluate(() =>
      document.dispatchEvent(new Event('selectionchange'))
    );
    expect(await editorCaretLine(page)).toBe(1);

    await wheelUntil(page, -600, () => showsLine(page, 2));
    await expect
      .poll(() => state(page))
      .toEqual({
        placeholder: false,
        focused: true,
        caretLine: '2',
      });
  });
});
