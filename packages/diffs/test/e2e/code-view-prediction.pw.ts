import { expect, type Page, test } from '@playwright/test';

// The fixture's window helpers (see fixtures/code-view-prediction.html).
interface RecordedConsoleError {
  message: string;
  ready: boolean;
  at: number;
  details: Record<string, number | string | boolean>;
}

declare global {
  interface Window {
    __predictionReady?: boolean;
    __predictionRequests?: { line: number; character: number }[];
    __consoleErrors?: RecordedConsoleError[];
    __prediction?: {
      itemIds: string[];
      lineCount: number;
      ghostLineCount: number;
      root: HTMLElement;
      getHost(id: string): HTMLElement | undefined;
      placeCaret(id: string, line: number): void;
      getTopForItem(id: string): number | undefined;
    };
  }
}

type Overflow = 'scroll' | 'wrap';
type Diff = 'none' | 'unified' | 'split';

const HEIGHT_INVARIANT_ERRORS = [
  'reconciled item height does not match DOM height',
  'sticky container height',
];

// Opens the fixture variant, waits for both editors, and lets two frames pass
// so the initial render has settled. Returns uncaught page errors.
async function openFixture(
  page: Page,
  { overflow, diff }: { overflow: Overflow; diff: Diff }
): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  await page.goto(
    `/test/e2e/fixtures/code-view-prediction.html?overflow=${overflow}&diff=${diff}`
  );
  await page.waitForFunction(() => window.__predictionReady === true);
  await twoFrames(page);
  return pageErrors;
}

// Every console.error recorded by the fixture so far.
function consoleErrors(page: Page): Promise<RecordedConsoleError[]> {
  return page.evaluate(() => window.__consoleErrors ?? []);
}

// The height-invariant errors CodeView logged from record `since` onwards,
// flattened to one line each so a failure shows the exact numbers.
async function invariantErrorsSince(
  page: Page,
  since: number
): Promise<string[]> {
  const records = await consoleErrors(page);
  return records
    .slice(since)
    .filter((record) =>
      HEIGHT_INVARIANT_ERRORS.some((needle) => record.message.includes(needle))
    )
    .map((record) => `${record.message} ${JSON.stringify(record.details)}`);
}

async function twoFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
}

// Places the caret at the end of a zero-based line of an item and waits until
// the scripted prediction has drawn its ghost text and reserved rows for it.
async function showGhost(page: Page, id: string, line: number): Promise<void> {
  await page.evaluate(
    ([id, line]) => window.__prediction?.placeCaret(id, line),
    [id, line] as const
  );
  await page.waitForFunction((id) => {
    const shadow = window.__prediction?.getHost(id)?.shadowRoot;
    return (
      shadow?.querySelector('[data-edit-prediction]') != null &&
      shadow.querySelector('[data-edit-prediction-spacer]') != null
    );
  }, id);
  await twoFrames(page);
}

async function hideGhost(page: Page, id: string): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForFunction((id) => {
    const shadow = window.__prediction?.getHost(id)?.shadowRoot;
    return (
      shadow != null &&
      shadow.querySelector('[data-edit-prediction]') == null &&
      shadow.querySelector('[data-edit-prediction-spacer]') == null
    );
  }, id);
  await twoFrames(page);
}

interface GhostMeasurement {
  // Rows reserved below the anchor row, from the spacer's `Nlh` custom property.
  rows: number;
  // Height of an ordinary single-line row, i.e. one `lh`.
  lineHeight: number;
  anchorMarginBlockEnd: number;
  anchorPaddingBlockEnd: number;
  ghostHeight: number;
  ghostBottom: number;
  // Bottom of the box that clips the column: `[data-code]` when it has its own
  // box, otherwise (split + wrap renders the columns as `display: contents`
  // inside one grid) the `<pre>` that holds them.
  clipBottom: number;
  contentInlinePaddingBlockEnd: string;
  ghostLineCount: number;
}

// Measures the ghost text and its anchor row inside the editable column of an
// item. The anchor row is the `[data-line]` row carrying the spacer; the
// reference line height comes from the first row of the same column.
function measureGhost(page: Page, id: string): Promise<GhostMeasurement> {
  return page.evaluate((id) => {
    const shadow = window.__prediction?.getHost(id)?.shadowRoot;
    const content = Array.from(
      shadow?.querySelectorAll('[data-content]') ?? []
    ).find((element) => element.getAttribute('contenteditable') === 'true');
    const code = content?.closest('[data-code]');
    const pre = content?.closest('pre');
    const anchor = content?.querySelector(
      ':scope > [data-line][data-edit-prediction-spacer]'
    );
    const firstRow = content?.querySelector(':scope > [data-line]');
    const ghost = shadow?.querySelector('[data-edit-prediction]');
    if (
      !(content instanceof HTMLElement) ||
      !(code instanceof HTMLElement) ||
      !(pre instanceof HTMLElement) ||
      !(anchor instanceof HTMLElement) ||
      !(firstRow instanceof HTMLElement) ||
      !(ghost instanceof HTMLElement)
    ) {
      throw new Error('missing ghost text, anchor row, or column');
    }
    const anchorStyle = getComputedStyle(anchor);
    const ghostRect = ghost.getBoundingClientRect();
    const codeRect = code.getBoundingClientRect();
    return {
      rows: Number.parseInt(
        anchor.style.getPropertyValue('--diffs-edit-prediction-spacer-height'),
        10
      ),
      lineHeight: firstRow.getBoundingClientRect().height,
      anchorMarginBlockEnd: Number.parseFloat(anchorStyle.marginBlockEnd),
      anchorPaddingBlockEnd: Number.parseFloat(anchorStyle.paddingBlockEnd),
      ghostHeight: ghostRect.height,
      ghostBottom: ghostRect.bottom,
      clipBottom:
        codeRect.height > 0
          ? codeRect.bottom
          : pre.getBoundingClientRect().bottom,
      contentInlinePaddingBlockEnd: content.style.paddingBlockEnd,
      ghostLineCount: ghost.querySelectorAll('[data-edit-prediction-line]')
        .length,
    };
  }, id);
}

// An item's DOM top in scroll-content coordinates next to CodeView's modeled
// top for it, so the two can be compared directly.
function measureItemTop(
  page: Page,
  id: string
): Promise<{ dom: number; model: number }> {
  return page.evaluate((id) => {
    const prediction = window.__prediction;
    const host = prediction?.getHost(id);
    const model = prediction?.getTopForItem(id);
    if (prediction == null || host == null || model == null) {
      throw new Error(`item "${id}" is not rendered`);
    }
    const { root } = prediction;
    const dom =
      host.getBoundingClientRect().top -
      root.getBoundingClientRect().top -
      root.clientTop +
      root.scrollTop;
    return { dom, model };
  }, id);
}

const ANCHOR_LINE = 9;

test.describe('CodeView edit prediction layout', () => {
  for (const diff of ['none', 'unified', 'split'] as const) {
    for (const overflow of ['scroll', 'wrap'] as const) {
      test(`keeps the dev height invariants quiet (${diff}, ${overflow})`, async ({
        page,
      }) => {
        const pageErrors = await openFixture(page, { overflow, diff });
        // The items' first paint is deferred by the cold highlighter; the
        // invariants must stay quiet through it and through the ghost text.
        expect(await invariantErrorsSince(page, 0)).toEqual([]);

        await showGhost(page, 'first', ANCHOR_LINE);
        expect(await invariantErrorsSince(page, 0)).toEqual([]);

        await hideGhost(page, 'first');
        expect(await invariantErrorsSince(page, 0)).toEqual([]);
        expect(pageErrors).toEqual([]);
      });
    }
  }

  test('moves the next item by the reserved rows in DOM and model (scroll)', async ({
    page,
  }) => {
    await openFixture(page, { overflow: 'scroll', diff: 'none' });
    const before = await measureItemTop(page, 'second');
    expect(before.dom).toBeCloseTo(before.model, 5);

    await showGhost(page, 'first', ANCHOR_LINE);
    const { rows, lineHeight } = await measureGhost(page, 'first');
    expect(rows).toBe(3);
    const after = await measureItemTop(page, 'second');
    expect(after.dom).toBeCloseTo(after.model, 5);
    expect(after.model - before.model).toBeCloseTo(rows * lineHeight, 5);
    expect(after.dom - before.dom).toBeCloseTo(rows * lineHeight, 5);

    await hideGhost(page, 'first');
    const restored = await measureItemTop(page, 'second');
    expect(restored).toEqual(before);
  });

  test('grows the anchor row by exactly one line-break per ghost line (scroll)', async ({
    page,
  }) => {
    await openFixture(page, { overflow: 'scroll', diff: 'none' });
    await showGhost(page, 'first', ANCHOR_LINE);

    const ghost = await measureGhost(page, 'first');
    expect(ghost.ghostLineCount).toBe(4);
    expect(ghost.rows).toBe(3);
    expect(ghost.anchorMarginBlockEnd).toBeCloseTo(
      ghost.rows * ghost.lineHeight,
      5
    );
    expect(ghost.anchorPaddingBlockEnd).toBe(0);
    expect(ghost.contentInlinePaddingBlockEnd).toBe('');
    expect(ghost.ghostBottom).toBeLessThanOrEqual(ghost.clipBottom + 0.5);
  });

  for (const diff of ['none', 'unified', 'split'] as const) {
    test(`reserves the probed visual rows for soft-wrapped ghost text (${diff}, wrap)`, async ({
      page,
    }) => {
      await openFixture(page, { overflow: 'wrap', diff });
      await showGhost(page, 'first', ANCHOR_LINE);

      const ghost = await measureGhost(page, 'first');
      const lineBreaks = 3;
      const ghostVisualLines = Math.round(ghost.ghostHeight / ghost.lineHeight);
      expect(ghost.ghostLineCount).toBe(lineBreaks + 1);
      // The long middle line wraps, so the ghost spans more visual lines than
      // it has line breaks and the spacer must cover every wrapped row.
      expect(ghostVisualLines).toBeGreaterThan(lineBreaks + 1);
      expect(ghost.rows).toBe(ghostVisualLines - 1);
      expect(ghost.anchorMarginBlockEnd).toBeCloseTo(
        ghost.rows * ghost.lineHeight,
        5
      );
      expect(ghost.contentInlinePaddingBlockEnd).toBe('');
      expect(ghost.ghostBottom).toBeLessThanOrEqual(ghost.clipBottom + 0.5);
    });
  }

  test('pads the deletions column to match the additions column (split, scroll)', async ({
    page,
  }) => {
    await openFixture(page, { overflow: 'scroll', diff: 'split' });
    await showGhost(page, 'first', ANCHOR_LINE);

    const columns = await page.evaluate((id) => {
      const shadow = window.__prediction?.getHost(id)?.shadowRoot;
      const codes = Array.from(shadow?.querySelectorAll('[data-code]') ?? []);
      const deletions = codes.find((code) =>
        code.hasAttribute('data-deletions')
      );
      const additions = codes.find((code) =>
        code.hasAttribute('data-additions')
      );
      const deletionSpacer = deletions?.querySelector(
        '[data-content] > [data-edit-prediction-spacer]'
      );
      const additionSpacer = additions?.querySelector(
        '[data-content] > [data-line][data-edit-prediction-spacer]'
      );
      const referenceRow = additions?.querySelector(
        '[data-content] > [data-line]'
      );
      if (
        !(deletions instanceof HTMLElement) ||
        !(additions instanceof HTMLElement) ||
        !(deletionSpacer instanceof HTMLElement) ||
        !(additionSpacer instanceof HTMLElement) ||
        !(referenceRow instanceof HTMLElement)
      ) {
        throw new Error('missing split columns or their spacers');
      }
      const deletionStyle = getComputedStyle(deletionSpacer);
      const additionStyle = getComputedStyle(additionSpacer);
      return {
        rows: Number.parseInt(
          additionSpacer.style.getPropertyValue(
            '--diffs-edit-prediction-spacer-height'
          ),
          10
        ),
        lineHeight: referenceRow.getBoundingClientRect().height,
        deletionsHeight: deletions.getBoundingClientRect().height,
        additionsHeight: additions.getBoundingClientRect().height,
        deletionSpacerPadding: Number.parseFloat(deletionStyle.paddingBlockEnd),
        deletionSpacerMargin: Number.parseFloat(deletionStyle.marginBlockEnd),
        additionSpacerPadding: Number.parseFloat(additionStyle.paddingBlockEnd),
        additionSpacerMargin: Number.parseFloat(additionStyle.marginBlockEnd),
      };
    }, 'first');

    expect(columns.rows).toBe(3);
    expect(columns.deletionsHeight).toBeCloseTo(columns.additionsHeight, 5);
    expect(columns.deletionSpacerPadding).toBeCloseTo(
      columns.rows * columns.lineHeight,
      5
    );
    expect(columns.deletionSpacerMargin).toBe(0);
    expect(columns.additionSpacerMargin).toBeCloseTo(
      columns.rows * columns.lineHeight,
      5
    );
    expect(columns.additionSpacerPadding).toBe(0);
  });

  test('makes trailing ghost rows on the last item scrollable (scroll)', async ({
    page,
  }) => {
    await openFixture(page, { overflow: 'scroll', diff: 'none' });
    const lastLine = await page.evaluate(() => {
      const prediction = window.__prediction;
      if (prediction == null) {
        throw new Error('fixture helpers missing');
      }
      const { root } = prediction;
      root.scrollTop = root.scrollHeight;
      return prediction.lineCount - 1;
    });
    await twoFrames(page);
    const settled = (await consoleErrors(page)).length;
    const scrollHeightBefore = await page.evaluate(
      () => window.__prediction?.root.scrollHeight ?? 0
    );
    expect(scrollHeightBefore).toBeGreaterThan(0);

    await showGhost(page, 'second', lastLine);
    const { rows, lineHeight } = await measureGhost(page, 'second');
    expect(rows).toBe(3);
    const scrollHeightAfter = await page.evaluate(
      () => window.__prediction?.root.scrollHeight ?? 0
    );
    expect(scrollHeightAfter - scrollHeightBefore).toBeCloseTo(
      rows * lineHeight,
      5
    );
    expect(await invariantErrorsSince(page, settled)).toEqual([]);

    await hideGhost(page, 'second');
    expect(
      await page.evaluate(() => window.__prediction?.root.scrollHeight ?? 0)
    ).toBe(scrollHeightBefore);
    expect(await invariantErrorsSince(page, settled)).toEqual([]);
  });
});
