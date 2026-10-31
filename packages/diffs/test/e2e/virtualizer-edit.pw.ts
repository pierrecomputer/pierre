import { expect, type Page, test } from '@playwright/test';

const twoFrames = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );

// Several editable files under a plain Virtualizer: scrolling the focused
// one out of view swaps its rows for a placeholder, which removes the
// focused content element.
test.describe('Virtualizer edit session across a placeholder swap', () => {
  test('focus and the caret come back when the rows render again', async ({
    page,
  }) => {
    await page.goto('/test/e2e/fixtures/virtualizer-edit.html');
    await page.waitForFunction(() => window.__virtualizerEditReady === true);
    const first = 'first';
    const state = () =>
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
              ? (anchorElement
                  ?.closest('[data-line]')
                  ?.getAttribute('data-line') ?? null)
              : null,
        };
      }, first);
    const showsLine = (line: number) =>
      page.evaluate(
        ([id, line]) =>
          window.__virtualizerEdit
            ?.getHost(id)
            ?.shadowRoot?.querySelector(
              `[data-content] > [data-line="${line}"]`
            ) != null,
        [first, line] as const
      );

    // Put the caret at the end of the first file's second line.
    await page
      .locator(
        '[data-host="first"] [data-content][contenteditable="true"] > [data-line="2"]'
      )
      .click();
    await page.keyboard.press('End');
    expect(await state()).toEqual({
      placeholder: false,
      focused: true,
      caretLine: '2',
    });

    // Wheel down until the first file is a placeholder, then back up until
    // the caret's line has a row again.
    const box = await page.locator('[data-virtualizer-root]').boundingBox();
    if (box == null) throw new Error('missing the Virtualizer root');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const wheelUntil = async (deltaY: number, done: () => Promise<boolean>) => {
      for (let step = 0; step < 60; step++) {
        await page.mouse.wheel(0, deltaY);
        await twoFrames(page);
        if (await done()) return;
      }
      throw new Error('the scroll never reached its target');
    };
    await wheelUntil(600, async () => (await state()).placeholder);
    await wheelUntil(-600, () => showsLine(2));
    await twoFrames(page);
    expect(await state()).toEqual({
      placeholder: false,
      focused: true,
      caretLine: '2',
    });
  });
});
