import { expect, type Page, test } from '@playwright/test';

const ADDITIONS = '[data-code][data-additions] [data-content]';
const DELETIONS = '[data-code][data-deletions] [data-content]';

async function openFixture(
  page: Page,
  options: { gutterUtility?: boolean } = {}
): Promise<void> {
  const query = options.gutterUtility === true ? '?gutterUtility' : '';
  await page.goto(`/test/e2e/fixtures/edit.html${query}`);
  await page.waitForFunction(() => window.__editReady === true);
}

const canUndo = (page: Page): Promise<boolean> =>
  page.evaluate(() => window.__editor?.canUndo ?? false);
const canRedo = (page: Page): Promise<boolean> =>
  page.evaluate(() => window.__editor?.canRedo ?? false);
const changeCount = (page: Page): Promise<number> =>
  page.evaluate(() => window.__editorEvents?.length ?? 0);
const editorHasFocus = (page: Page): Promise<boolean> =>
  page.evaluate((selector) => {
    const root = document.querySelector('diffs-container')?.shadowRoot;
    const content = root?.querySelector(selector);
    return root?.activeElement === content;
  }, ADDITIONS);

// Real user path: a plain click into the editable additions column places the
// caret, then typing flows through the genuine keyboard -> beforeinput ->
// onChange pipeline. This guards the shadow-selection fallback in
// src/editor/editor.ts: the pinned Chromium here lacks
// Selection.getComposedRanges, so the editor reads the caret via
// ShadowRoot.getSelection() instead. Without that fallback a click left the
// caret unseeded and every keystroke was silently dropped.
async function clickIntoAdditions(page: Page): Promise<void> {
  await page.locator(ADDITIONS).click();
}

async function moveFocusDuringFullRender(
  page: Page,
  target: 'background' | 'external-link' | 'host',
  timing: 'replacement' | 'after-sync'
): Promise<void> {
  await page.evaluate(
    ({ selector, target, timing }) =>
      new Promise<void>((resolve, reject) => {
        const host = document.querySelector('diffs-container');
        const root = host?.shadowRoot;
        const content = root?.querySelector(selector);
        const code = content?.parentElement;
        const externalLink = document.querySelector('[data-fixtures-index]');
        const focusTarget =
          target === 'host'
            ? host
            : target === 'background'
              ? document.body
              : externalLink;
        if (
          !(host instanceof HTMLElement) ||
          !(code instanceof HTMLElement) ||
          !(focusTarget instanceof HTMLElement)
        ) {
          reject(new Error('missing editor or external focus target'));
          return;
        }
        if (target === 'host') {
          host.tabIndex = -1;
        }
        const observer = new MutationObserver(() => {
          const replacement = root?.querySelector(selector);
          if (
            replacement === content ||
            (timing === 'after-sync' &&
              replacement?.getAttribute('contenteditable') !== 'true')
          ) {
            return;
          }
          observer.disconnect();
          if (target === 'background') {
            focusTarget.dispatchEvent(
              new PointerEvent('pointerdown', {
                bubbles: true,
                composed: true,
              })
            );
          } else {
            focusTarget.focus();
            if (
              target === 'host' &&
              (document.activeElement !== host || root?.activeElement != null)
            ) {
              reject(new Error('host did not receive focus'));
              return;
            }
          }
          resolve();
        });
        observer.observe(code, {
          attributes: true,
          attributeFilter: ['contenteditable'],
          childList: true,
          subtree: true,
        });
        window.__forceEditorFullRender?.();
      }),
    { selector: ADDITIONS, target, timing }
  );
}

test.describe('edit mode', () => {
  test('a plain click seeds the caret so typing works (regression)', async ({
    page,
  }) => {
    await openFixture(page);

    await clickIntoAdditions(page);
    await page.keyboard.type('Z');

    await expect(page.locator(ADDITIONS)).toContainText('Z');
    await expect.poll(() => changeCount(page)).toBeGreaterThan(0);
  });

  test('additions are editable while deletions stay read-only', async ({
    page,
  }) => {
    await openFixture(page);

    await expect(page.locator(ADDITIONS)).toHaveAttribute(
      'contenteditable',
      'true'
    );
    // The deleted (old-file) column is never editable.
    await expect(page.locator(DELETIONS)).not.toHaveAttribute(
      'contenteditable',
      'true'
    );

    const deletionText = await page.locator(DELETIONS).textContent();

    // Editing the additions column must not disturb the read-only deletions.
    await clickIntoAdditions(page);
    await page.keyboard.type('Z');
    await expect(page.locator(ADDITIONS)).toContainText('Z');

    await expect(page.locator(DELETIONS)).toHaveText(deletionText ?? '');
  });

  test('typing inserts text, fires onChange, and enables undo', async ({
    page,
  }) => {
    await openFixture(page);

    expect(await changeCount(page)).toBe(0);
    expect(await canUndo(page)).toBe(false);

    await clickIntoAdditions(page);
    await page.keyboard.type('Z');

    await expect(page.locator(ADDITIONS)).toContainText('Z');
    await expect.poll(() => changeCount(page)).toBeGreaterThan(0);
    await expect.poll(() => canUndo(page)).toBe(true);
  });

  test('focused editor survives a full render and accepts input', async ({
    page,
  }) => {
    await openFixture(page);

    const additions = page.locator(ADDITIONS);
    await additions.click();
    await expect.poll(() => editorHasFocus(page)).toBe(true);
    const previousContent = await additions.elementHandle();
    if (previousContent == null) {
      throw new Error('missing additions content');
    }

    await page.evaluate(() => window.__forceEditorFullRender?.());

    await expect
      .poll(() =>
        additions.evaluate(
          (content, previous) => content !== previous,
          previousContent
        )
      )
      .toBe(true);
    await expect.poll(() => editorHasFocus(page)).toBe(true);
    await page.keyboard.type('Z');
    await expect(additions).toContainText('Z');
  });

  test('focused editor survives overlapping full renders', async ({ page }) => {
    await openFixture(page);

    const additions = page.locator(ADDITIONS);
    await additions.click();
    await page.evaluate(
      (selector) =>
        new Promise<void>((resolve, reject) => {
          const root = document.querySelector('diffs-container')?.shadowRoot;
          const content = root?.querySelector(selector);
          const code = content?.parentElement;
          if (!(code instanceof HTMLElement)) {
            reject(new Error('missing editor content'));
            return;
          }
          const observer = new MutationObserver(() => {
            const replacement = root?.querySelector(selector);
            if (
              replacement === content ||
              replacement?.getAttribute('contenteditable') !== 'true'
            ) {
              return;
            }
            observer.disconnect();
            window.__forceEditorFullRender?.();
            resolve();
          });
          observer.observe(code, {
            attributes: true,
            attributeFilter: ['contenteditable'],
            childList: true,
            subtree: true,
          });
          window.__forceEditorFullRender?.();
        }),
      ADDITIONS
    );

    await expect.poll(() => editorHasFocus(page)).toBe(true);
    await page.keyboard.type('Z');
    await expect(additions).toContainText('Z');
  });

  test('focused editor without a selection survives a full render', async ({
    page,
  }) => {
    await openFixture(page);

    await page.evaluate(() => {
      window.__editor?.setSelections([]);
      window.__editor?.focus();
    });
    await expect.poll(() => editorHasFocus(page)).toBe(true);

    await page.evaluate(() => window.__forceEditorFullRender?.());

    await expect.poll(() => editorHasFocus(page)).toBe(true);
  });

  test('focused editor survives moving to a new container', async ({
    page,
  }) => {
    await openFixture(page);

    const additions = page.locator(ADDITIONS);
    await additions.click();
    await page.evaluate(() => window.__moveEditorContainer?.());

    await expect.poll(() => editorHasFocus(page)).toBe(true);
    await page.keyboard.type('Z');
    await expect(additions).toContainText('Z');
  });

  test('full render does not reclaim focus moved during replacement', async ({
    page,
  }) => {
    await openFixture(page);

    await clickIntoAdditions(page);
    const fixturesLink = page.locator('[data-fixtures-index]');
    await moveFocusDuringFullRender(page, 'external-link', 'replacement');

    await expect(fixturesLink).toBeFocused();
  });

  test('full render does not reclaim focus after a background press', async ({
    page,
  }) => {
    await openFixture(page);

    await clickIntoAdditions(page);
    await moveFocusDuringFullRender(page, 'background', 'replacement');

    await expect.poll(() => editorHasFocus(page)).toBe(false);
  });

  test('stopped background press that starts a full render does not restore focus', async ({
    page,
  }) => {
    await openFixture(page);

    await clickIntoAdditions(page);
    await page.evaluate(() => {
      document.body.addEventListener(
        'pointerdown',
        (event) => {
          window.__forceEditorFullRender?.();
          event.stopPropagation();
        },
        { once: true }
      );
      document.body.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, composed: true })
      );
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })
    );

    await expect.poll(() => editorHasFocus(page)).toBe(false);
  });

  test('full render does not reclaim focus moved to its host', async ({
    page,
  }) => {
    await openFixture(page);

    await clickIntoAdditions(page);
    await moveFocusDuringFullRender(page, 'host', 'after-sync');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })
    );

    await expect.poll(() => editorHasFocus(page)).toBe(false);
  });

  test('undo and redo round-trip a typed edit', async ({ page }) => {
    await openFixture(page);

    await clickIntoAdditions(page);
    await page.keyboard.type('Z');
    await expect(page.locator(ADDITIONS)).toContainText('Z');
    await expect.poll(() => canUndo(page)).toBe(true);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator(ADDITIONS)).not.toContainText('Z');
    await expect.poll(() => canRedo(page)).toBe(true);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(page.locator(ADDITIONS)).toContainText('Z');
  });

  test('programmatic refocus accepts the first input after a gutter gesture', async ({
    page,
  }) => {
    await openFixture(page, { gutterUtility: true });

    // A real deletion-gutter click creates a native read-only selection while
    // leaving the editor without its own text selection.
    const deletedGutter = page.locator(
      '[data-code][data-deletions] [data-gutter] [data-column-number="2"]'
    );
    const deletedGutterBox = await deletedGutter.boundingBox();
    if (deletedGutterBox == null) {
      throw new Error('missing deleted gutter');
    }
    await page.mouse.click(
      deletedGutterBox.x + 2,
      deletedGutterBox.y + deletedGutterBox.height / 2
    );

    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
      .toContain('removed');
    await expect
      .poll(() =>
        page.evaluate(() => window.__editor?.getState().selections?.length ?? 0)
      )
      .toBe(0);
    await expect(page.locator('pre[data-deleted-text-selection]')).toHaveCount(
      1
    );

    // The utility gesture uses the same selection-preservation path as diff
    // line selection, but there is no editor selection to preserve here.
    const additionsGutter = page.locator(
      '[data-code]:not([data-deletions]) [data-gutter] [data-column-number="2"]'
    );
    await additionsGutter.hover();
    const utility = additionsGutter.locator('[data-utility-button]');
    await expect(utility).toBeVisible();
    await utility.click();
    await expect(additionsGutter).toHaveAttribute(
      'data-selected-line',
      'single'
    );

    const before = await page.evaluate(() => window.__editor?.getText() ?? '');
    const changesBefore = await changeCount(page);
    await page.locator('[data-fixtures-index]').focus();
    await page.evaluate(() => window.__editor?.focus());

    await expect
      .poll(() =>
        page.evaluate(() => {
          const root = document.querySelector('diffs-container')?.shadowRoot;
          const content = root?.querySelector(
            '[data-code]:not([data-deletions]) [data-content]'
          );
          return root?.activeElement === content;
        })
      )
      .toBe(true);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })
    );
    await page.keyboard.type('Z');

    await expect
      .poll(() => page.evaluate(() => window.__editor?.getText() ?? ''))
      .not.toBe(before);
    await expect
      .poll(() => page.evaluate(() => window.__editor?.getText() ?? ''))
      .toContain('Z');
    await expect.poll(() => changeCount(page)).toBeGreaterThan(changesBefore);
  });
});
