import { expect, type Page, test } from '@playwright/test';

// The editable content column of the one file item in the CodeView fixture.
const CONTENT = 'diffs-container [data-code] [data-content]';

async function openFileSession(page: Page): Promise<void> {
  await page.goto(
    '/test/e2e/fixtures/code-view-annotations.html?type=file&edit=true&fileAnnotation=false'
  );
  await page.waitForFunction(() => window.__annotationScroll != null);
  await page.waitForFunction(
    (selector) =>
      document
        .querySelector('diffs-container')
        ?.shadowRoot?.querySelector<HTMLElement>(selector)
        ?.isContentEditable === true,
    CONTENT.replace('diffs-container ', '')
  );
}

// The text of the first row and the caret's column in it, read from the
// native selection the way the editor reads it.
function firstRow(page: Page): Promise<{ text: string; caret: number }> {
  return page.evaluate(() => {
    // ShadowRoot.getSelection is non-standard and missing from the DOM types.
    const shadow:
      | (ShadowRoot & { getSelection?: () => Selection | null })
      | null
      | undefined = document.querySelector('diffs-container')?.shadowRoot;
    const row = shadow?.querySelector('[data-content] > [data-line="1"]');
    const selection = shadow?.getSelection?.() ?? document.getSelection();
    if (row == null || selection == null || selection.anchorNode == null) {
      throw new Error('missing the first row or the selection');
    }
    const range = document.createRange();
    range.setStart(row, 0);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    return { text: row.textContent ?? '', caret: range.toString().length };
  });
}

const twoFrames = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );

test.describe('CodeView edit session', () => {
  // A keystroke's rows are patched in the virtualizer's frame, after the
  // editor placed the caret in them. Typing faster than the frame must not
  // move the caret, or later characters land earlier in the line.
  test('fast typing keeps the caret at the end of the line', async ({
    page,
  }) => {
    await openFileSession(page);
    const row = page.locator(`${CONTENT} > [data-line="1"]`);
    await row.click();
    await page.keyboard.press('End');
    const before = await firstRow(page);
    expect(before).toEqual({ text: 'const line1 = 1;', caret: 16 });

    const typed = 'abcdefghijklmnop';
    await page.keyboard.type(typed, { delay: 0 });
    await twoFrames(page);

    const after = await firstRow(page);
    expect(after.text).toBe(`const line1 = 1;${typed}`);
    expect(after.caret).toBe(after.text.length);
  });
});

// Several editable items: scrolling the focused one out of the window
// releases it and parks focus on the CodeView root.
test.describe('CodeView edit session across an item unmount', () => {
  test('focus and the caret come back when the item mounts again', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/code-view-edit.html');
    await page.waitForFunction(() => window.__codeViewEditReady === true);
    const firstId = await page.evaluate(
      () => window.__codeViewEdit?.itemIds[0]
    );
    if (firstId == null) throw new Error('missing the first item id');
    const caretState = () =>
      page.evaluate((id) => {
        const w = window.__codeViewEdit;
        if (w == null) throw new Error('missing the code-view-edit fixture');
        const host = w.getHost(id);
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
          mounted: host != null,
          focused: content != null && shadow?.activeElement === content,
          caretLine:
            content != null && anchor != null && content.contains(anchor)
              ? (anchorElement
                  ?.closest('[data-line]')
                  ?.getAttribute('data-line') ?? null)
              : null,
        };
      }, firstId);
    // Put the caret at the end of the first item's second line.
    await page
      .locator(
        'diffs-container [data-content][contenteditable="true"] > [data-line="2"]'
      )
      .first()
      .click();
    await page.keyboard.press('End');
    expect(await caretState()).toEqual({
      mounted: true,
      focused: true,
      caretLine: '2',
    });

    // Wheel down until the first item is released, then back up until the
    // caret's line has a row again. Wheel input, like the user's, also
    // cancels the caret reveal the click requested; a programmatic scroll
    // would not.
    const box = await page.locator('[data-code-view-root]').boundingBox();
    if (box == null) throw new Error('missing the CodeView root');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const firstItemShows = (line: number | null) =>
      page.evaluate(
        ([id, line]) => {
          const host = window.__codeViewEdit?.getHost(id);
          if (line == null) return host != null;
          return (
            host?.shadowRoot?.querySelector(
              `[data-content] > [data-line="${line}"]`
            ) != null
          );
        },
        [firstId, line] as const
      );
    const wheelUntil = async (
      deltaY: number,
      shows: boolean,
      line: number | null
    ) => {
      for (let step = 0; step < 60; step++) {
        await page.mouse.wheel(0, deltaY);
        await twoFrames(page);
        if ((await firstItemShows(line)) === shows) return;
      }
      throw new Error(
        `the first item did not ${shows ? 'show' : 'release'} ${line ?? 'its rows'}`
      );
    };
    await wheelUntil(600, false, null);
    await wheelUntil(-600, true, 2);
    await twoFrames(page);
    expect(await caretState()).toEqual({
      mounted: true,
      focused: true,
      caretLine: '2',
    });
  });
});
