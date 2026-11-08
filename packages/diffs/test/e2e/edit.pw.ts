import { expect, type Page, test } from '@playwright/test';

const ADDITIONS = '[data-code][data-additions] [data-content]';
const DELETIONS = '[data-code][data-deletions] [data-content]';

async function openFixture(
  page: Page,
  options: {
    annotations?: boolean;
    gutterUtility?: boolean;
    mixedBlocks?: boolean;
    unified?: boolean;
  } = {}
): Promise<void> {
  const searchParams = new URLSearchParams();
  if (options.annotations === true) searchParams.set('annotations', '');
  if (options.gutterUtility === true) searchParams.set('gutterUtility', '');
  if (options.mixedBlocks === true) searchParams.set('mixedBlocks', '');
  if (options.unified === true) searchParams.set('unified', '');
  const query = searchParams.size === 0 ? '' : `?${searchParams}`;
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

// Moves focus away from the editor at a controlled point inside a full
// render, then lets the caller assert the editor does not reclaim it. A full
// render keeps the editable element in place, so the two hook points are:
// 'rebuild' — the column children were just swapped (the editor's deferred
// focus/selection restore has not run yet) — and 'after-sync' — the editor
// re-sync (which invokes the restore) has completed.
async function moveFocusDuringFullRender(
  page: Page,
  target: 'background' | 'external-link' | 'host',
  timing: 'rebuild' | 'after-sync'
): Promise<void> {
  await page.evaluate(
    ({ selector, target, timing }) =>
      new Promise<void>((resolve, reject) => {
        const host = document.querySelector('diffs-container');
        const root = host?.shadowRoot;
        const content = root?.querySelector(selector);
        const externalLink = document.querySelector('[data-fixtures-index]');
        const focusTarget =
          target === 'host'
            ? host
            : target === 'background'
              ? document.body
              : externalLink;
        if (
          !(host instanceof HTMLElement) ||
          !(content instanceof HTMLElement) ||
          !(focusTarget instanceof HTMLElement)
        ) {
          reject(new Error('missing editor or external focus target'));
          return;
        }
        if (target === 'host') {
          host.tabIndex = -1;
        }
        const moveFocus = () => {
          if (target === 'background') {
            focusTarget.dispatchEvent(
              new PointerEvent('pointerdown', {
                bubbles: true,
                composed: true,
              })
            );
            // A synthetic pointerdown carries no default focus change; a real
            // background press blurs the editor, so blur explicitly to match.
            if (root?.activeElement instanceof HTMLElement) {
              root.activeElement.blur();
            }
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
        };
        if (timing === 'after-sync') {
          const syncsBefore = window.__syncCount ?? 0;
          const poll = () => {
            if ((window.__syncCount ?? 0) > syncsBefore) {
              moveFocus();
              return;
            }
            requestAnimationFrame(poll);
          };
          window.__forceEditorFullRender?.();
          poll();
          return;
        }
        const observer = new MutationObserver(() => {
          observer.disconnect();
          moveFocus();
        });
        observer.observe(content, {
          childList: true,
          subtree: true,
        });
        window.__forceEditorFullRender?.();
      }),
    { selector: ADDITIONS, target, timing }
  );
}

// Kicks off a full render and resolves once the editor has re-synced to it.
async function runFullRender(page: Page): Promise<void> {
  const syncsBefore = await page.evaluate(() => window.__syncCount ?? 0);
  await page.evaluate(() => window.__forceEditorFullRender?.());
  await expect
    .poll(() => page.evaluate(() => window.__syncCount ?? 0))
    .toBeGreaterThan(syncsBefore);
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

  test('uses the native caret during composition and restores the overlay', async ({
    page,
  }) => {
    await openFixture(page);
    await clickIntoAdditions(page);

    const content = page.locator(ADDITIONS);
    const caret = page
      .locator(`${ADDITIONS} ~ [data-editor-overlay] [data-caret]`)
      .first();
    const transparent = 'rgba(0, 0, 0, 0)';
    await expect(content).toHaveCSS('caret-color', transparent);
    await expect(caret).toHaveCSS('visibility', 'visible');

    // Synthetic events check rendered caret modes; OS IME placement is manual.
    for (const data of ['가', '']) {
      await content.evaluate((element) => {
        element.dispatchEvent(
          new CompositionEvent('compositionstart', {
            bubbles: true,
            composed: true,
          })
        );
      });
      await expect(content).not.toHaveCSS('caret-color', transparent);
      await expect(caret).toHaveCSS('visibility', 'hidden');

      await content.evaluate((element, data) => {
        element.dispatchEvent(
          new CompositionEvent('compositionend', {
            bubbles: true,
            composed: true,
            data,
          })
        );
      }, data);
      await expect(content).toHaveCSS('caret-color', transparent);
      await expect(caret).toHaveCSS('visibility', 'visible');
    }
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

  test('inserting a line keeps split annotations aligned', async ({ page }) => {
    await openFixture(page, { annotations: true });

    const annotationRows = page.locator('[data-line-annotation]');
    await expect(annotationRows).toHaveCount(2);
    const getAnnotationTops = () =>
      annotationRows.evaluateAll((rows) =>
        rows.map((row) => row.getBoundingClientRect().top)
      );
    const before = await getAnnotationTops();
    expect(Math.abs(before[0] - before[1])).toBeLessThan(1);

    const annotatedLine = page.locator(
      `${ADDITIONS} [data-line="2"][data-line-type="change-addition"]`
    );
    await annotatedLine.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect.poll(() => changeCount(page)).toBeGreaterThan(0);

    await expect(annotationRows).toHaveCount(2);
    await expect
      .poll(async () => {
        const [deletionTop, additionTop] = await getAnnotationTops();
        return Math.abs(deletionTop - additionTop);
      })
      .toBeLessThan(1);
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

    await runFullRender(page);

    // The full render rebuilds the columns on the same editable element, so
    // focus never leaves it and typing keeps flowing.
    expect(
      await additions.evaluate(
        (content, previous) => content === previous,
        previousContent
      )
    ).toBe(true);
    await expect.poll(() => editorHasFocus(page)).toBe(true);
    await page.keyboard.type('Z');
    await expect(additions).toContainText('Z');
  });

  test('focused editor survives overlapping full renders', async ({ page }) => {
    await openFixture(page);

    const additions = page.locator(ADDITIONS);
    await additions.click();
    // Start a second full render the moment the first one swaps the column
    // children, so the second render races the first one's editor re-sync.
    await page.evaluate(
      (selector) =>
        new Promise<void>((resolve, reject) => {
          const root = document.querySelector('diffs-container')?.shadowRoot;
          const content = root?.querySelector(selector);
          if (!(content instanceof HTMLElement)) {
            reject(new Error('missing editor content'));
            return;
          }
          const observer = new MutationObserver(() => {
            observer.disconnect();
            window.__forceEditorFullRender?.();
            resolve();
          });
          observer.observe(content, {
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

  test('focused editor without a selection survives a container move', async ({
    page,
  }) => {
    await openFixture(page);

    await page.evaluate(() => {
      window.__editor?.setSelections([]);
      window.__editor?.focus();
    });
    await expect.poll(() => editorHasFocus(page)).toBe(true);

    // A container move genuinely replaces the editable element (a full render
    // rebuilds it in place), so focus restoration must work even with no
    // selection to anchor the caret.
    await page.evaluate(() => window.__moveEditorContainer?.());

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

  test('full render does not reclaim focus moved during the rebuild', async ({
    page,
  }) => {
    await openFixture(page);

    await clickIntoAdditions(page);
    const fixturesLink = page.locator('[data-fixtures-index]');
    await moveFocusDuringFullRender(page, 'external-link', 'rebuild');

    await expect(fixturesLink).toBeFocused();
  });

  test('full render does not reclaim focus after a background press', async ({
    page,
  }) => {
    await openFixture(page);

    await clickIntoAdditions(page);
    await moveFocusDuringFullRender(page, 'background', 'rebuild');

    await expect.poll(() => editorHasFocus(page)).toBe(false);
  });

  test('stopped background press that starts a full render leaves focus in place', async ({
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

    // The press never moved focus (its default was stopped) and the render
    // keeps the editable element, so focus stays exactly where it was — the
    // canceled restore must neither blur the editor nor steal focus back.
    await expect.poll(() => editorHasFocus(page)).toBe(true);
    await page.keyboard.type('Z');
    await expect(page.locator(ADDITIONS)).toContainText('Z');
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

  test('a queued focus yields to the search panel when the host render lands later', async ({
    page,
  }) => {
    await openFixture(page);

    await clickIntoAdditions(page);
    await expect.poll(() => editorHasFocus(page)).toBe(true);
    await page.keyboard.press('ControlOrMeta+Alt+f');
    const replacement = page.locator('[data-search-panel] input[data-replace]');
    await expect(replacement).toBeVisible();

    // The editor asks for focus and the host captures for a DOM write whose
    // sync has not landed yet. The user moves into the replace input before
    // it lands; the sync then lands with a full render. The editor's earlier
    // request must not take focus back from the input.
    const syncsBefore = await page.evaluate(() => window.__syncCount ?? 0);
    await page.evaluate(() => {
      window.__editor?.focus();
      window.__editor?.__captureFocusForDOMReplacement();
    });
    await replacement.focus();
    await page.evaluate(() => window.__forceEditorFullRender?.());
    await expect
      .poll(() => page.evaluate(() => window.__syncCount ?? 0))
      .toBeGreaterThan(syncsBefore);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })
    );

    await expect(replacement).toBeFocused();
    await page.keyboard.type('Z');
    await expect(replacement).toHaveValue('Z');
    expect(await changeCount(page)).toBe(0);
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
        page.evaluate(
          () => window.__editor?.getViewState().selections?.length ?? 0
        )
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

// Clicking text the editor cannot edit (the deletions column in split view,
// deleted rows in unified view) moves the caret to where editing continues on
// the editable side. The mixedBlocks diff has one of every block: context,
// a change with additions, a pure deletion mid-file, and one at end of file.
test.describe('clicking read-only diff text', () => {
  const UNIFIED = '[data-code][data-unified] [data-content]';
  const deletedRow = (column: 'deletions' | 'unified', line: number) =>
    `[data-code][data-${column}] [data-content] [data-line="${line}"][data-line-type="change-deletion"]`;

  // The caret's position: both ends of the primary selection, so a collapsed
  // selection reads as one point.
  const primarySelection = (page: Page) =>
    page.evaluate(() => {
      const selection = window.__editor?.getViewState().selections?.at(-1);
      return selection != null
        ? { start: selection.start, end: selection.end }
        : undefined;
    });
  const contentHasFocus = (page: Page, selector: string) =>
    page.evaluate((selector) => {
      const root = document.querySelector('diffs-container')?.shadowRoot;
      return root?.activeElement === root?.querySelector(selector);
    }, selector);

  // The page point just inside `character` of the row's text, on the row's
  // vertical center, so a click there lands the caret on that character.
  async function characterPoint(
    page: Page,
    rowSelector: string,
    character: number
  ): Promise<{ x: number; y: number }> {
    return page.evaluate(
      ({ rowSelector, character }) => {
        const root = document.querySelector('diffs-container')?.shadowRoot;
        const row = root?.querySelector(rowSelector);
        if (!(row instanceof HTMLElement)) {
          throw new Error(`missing row ${rowSelector}`);
        }
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        let remaining = character;
        for (
          let node = walker.nextNode();
          node != null;
          node = walker.nextNode()
        ) {
          const length = node.textContent?.length ?? 0;
          if (remaining <= length) {
            const range = document.createRange();
            range.setStart(node, remaining);
            range.collapse(true);
            const rect = range.getBoundingClientRect();
            const rowRect = row.getBoundingClientRect();
            return { x: rect.left + 1, y: rowRect.top + rowRect.height / 2 };
          }
          remaining -= length;
        }
        throw new Error(`row ${rowSelector} has no character ${character}`);
      },
      { rowSelector, character }
    );
  }

  async function clickRow(page: Page, rowSelector: string, character = 0) {
    const point = await characterPoint(page, rowSelector, character);
    await page.mouse.click(point.x, point.y);
  }

  async function dragWithinRow(page: Page, rowSelector: string) {
    const from = await characterPoint(page, rowSelector, 2);
    const to = await characterPoint(page, rowSelector, 13);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
  }

  test('a context line on the deletions side focuses the same line and column', async ({
    page,
  }) => {
    await openFixture(page, { mixedBlocks: true });

    await clickRow(page, `${DELETIONS} [data-line="3"]`, 6);

    await expect
      .poll(() => primarySelection(page))
      .toEqual({
        start: { line: 2, character: 6 },
        end: { line: 2, character: 6 },
      });
    await expect.poll(() => contentHasFocus(page, ADDITIONS)).toBe(true);
    await expect(page.locator('pre[data-deleted-text-selection]')).toHaveCount(
      0
    );
  });

  test('a deleted line focuses the first added line of its block', async ({
    page,
  }) => {
    await openFixture(page, { mixedBlocks: true });

    await clickRow(page, deletedRow('deletions', 2), 8);

    await expect
      .poll(() => primarySelection(page))
      .toEqual({
        start: { line: 1, character: 0 },
        end: { line: 1, character: 0 },
      });
    await expect.poll(() => contentHasFocus(page, ADDITIONS)).toBe(true);
    await expect(page.locator('pre[data-deleted-text-selection]')).toHaveCount(
      0
    );
  });

  test('a deleted line with no additions focuses the line after it', async ({
    page,
  }) => {
    await openFixture(page, { mixedBlocks: true });

    await clickRow(page, deletedRow('deletions', 4), 8);

    await expect
      .poll(() => primarySelection(page))
      .toEqual({
        start: { line: 3, character: 0 },
        end: { line: 3, character: 0 },
      });
    await expect.poll(() => contentHasFocus(page, ADDITIONS)).toBe(true);
  });

  test('a deleted line at the end of the file focuses the end of the document', async ({
    page,
  }) => {
    await openFixture(page, { mixedBlocks: true });

    await clickRow(page, deletedRow('deletions', 6), 3);

    const lines = (
      await page.evaluate(() => window.__editor?.getText() ?? '')
    ).split('\n');
    const end = {
      line: lines.length - 1,
      character: lines[lines.length - 1].length,
    };
    await expect
      .poll(() => primarySelection(page))
      .toEqual({
        start: end,
        end,
      });
    await expect.poll(() => contentHasFocus(page, ADDITIONS)).toBe(true);
  });

  test('unified: a deleted line focuses the first added line of its block', async ({
    page,
  }) => {
    await openFixture(page, { mixedBlocks: true, unified: true });

    await clickRow(page, deletedRow('unified', 2), 8);

    await expect
      .poll(() => primarySelection(page))
      .toEqual({
        start: { line: 1, character: 0 },
        end: { line: 1, character: 0 },
      });
    await expect.poll(() => contentHasFocus(page, UNIFIED)).toBe(true);
    await expect(page.locator('pre[data-deleted-text-selection]')).toHaveCount(
      0
    );
  });

  test('unified: a deleted line with no additions focuses the line after it', async ({
    page,
  }) => {
    await openFixture(page, { mixedBlocks: true, unified: true });

    await clickRow(page, deletedRow('unified', 4), 8);

    await expect
      .poll(() => primarySelection(page))
      .toEqual({
        start: { line: 3, character: 0 },
        end: { line: 3, character: 0 },
      });
    await expect.poll(() => contentHasFocus(page, UNIFIED)).toBe(true);
  });

  for (const unified of [false, true]) {
    test(`${unified ? 'unified' : 'split'}: dragging across deleted text keeps the native selection`, async ({
      page,
    }) => {
      await openFixture(page, { mixedBlocks: true, unified });

      await dragWithinRow(
        page,
        deletedRow(unified ? 'unified' : 'deletions', 2)
      );

      await expect
        .poll(() =>
          page.evaluate(() => window.getSelection()?.toString() ?? '')
        )
        .toContain('removed');
      expect(
        await page.evaluate(
          () => window.__editor?.getViewState().selections?.length ?? 0
        )
      ).toBe(0);
      await expect(
        page.locator('pre[data-deleted-text-selection]')
      ).toHaveCount(1);
    });
  }
});
