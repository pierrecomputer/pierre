import { describe, expect, test } from 'bun:test';

import { CodeView, type CodeViewCoordinator } from '../src/components/CodeView';
import { DEFAULT_THEMES } from '../src/constants';
import type { CodeViewItem, FileContents } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import {
  createRoot,
  dispatchScroll,
  installDom,
  renderItems,
  wait,
  waitFor,
} from './domHarness';

// Kept local: the shared makeFile/makeFileItem helpers have no label
// parameter, and these tests assert on label text in rendered output.
function makeFile(
  name: string,
  label: string,
  lineCount: number
): FileContents {
  return {
    name,
    contents: Array.from(
      { length: lineCount },
      (_, index) => `${label} line ${index + 1}`
    ).join('\n'),
  };
}

function makeFileItem(
  id: string,
  label: string,
  lineCount: number
): CodeViewItem<undefined> {
  return {
    id,
    type: 'file',
    file: makeFile(`${id}.ts`, label, lineCount),
  };
}

function makeDiffItem(id: string, name: string): CodeViewItem<undefined> {
  return {
    id,
    type: 'diff',
    fileDiff: parseDiffFromFile(
      { name, contents: 'one\ntwo\nthree\n' },
      { name, contents: 'one\ntwo changed\nthree\n' }
    ),
  };
}

function getShadowText(element: HTMLElement): string {
  return element.shadowRoot?.textContent ?? '';
}

function getHeaderCount(element: HTMLElement): number {
  return (
    element.shadowRoot?.querySelectorAll('[data-diffs-header]').length ?? 0
  );
}

function getShellCounts(element: HTMLElement): {
  pre: number;
  svg: number;
  theme: number;
  unsafe: number;
} {
  const { shadowRoot } = element;
  expect(shadowRoot).not.toBeNull();
  return {
    pre: shadowRoot?.querySelectorAll('pre').length ?? 0,
    svg: shadowRoot?.querySelectorAll('svg[data-icon-sprite]').length ?? 0,
    theme: shadowRoot?.querySelectorAll('style[data-theme-css]').length ?? 0,
    unsafe: shadowRoot?.querySelectorAll('style[data-unsafe-css]').length ?? 0,
  };
}

async function waitForShellCounts(
  element: HTMLElement,
  expected: ReturnType<typeof getShellCounts>
): Promise<void> {
  // ~4s budget: returns as soon as the counts match, so passing runs only pay
  // a few iterations; the headroom is for loaded CI runners.
  for (let attempt = 0; attempt < 400; attempt++) {
    try {
      expect(getShellCounts(element)).toEqual(expected);
      return;
    } catch {
      await wait(10);
    }
  }
  expect(getShellCounts(element)).toEqual(expected);
}

describe('CodeView element pooling', () => {
  test('reuses sanitized item shells without duplicating shared assets', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      unsafeCSS: ':host { --pooled-shell: 1; }',
    });
    const root = createRoot({ height: 120 });
    const items = [
      makeFileItem('file:first', 'first pooled content', 100),
      makeFileItem('file:second', 'second pooled content', 100),
    ];

    try {
      viewer.setup(root);
      await renderItems(viewer, items);

      let renderedItems = viewer.getRenderedItems();
      expect(renderedItems.map((item) => item.id)).toEqual(['file:first']);
      const firstElement = renderedItems[0].element;
      await waitForShellCounts(firstElement, {
        pre: 1,
        svg: 1,
        theme: 1,
        unsafe: 1,
      });
      expect(getShadowText(firstElement)).toContain('first pooled content');

      root.scrollTop = 2_400;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);

      renderedItems = viewer.getRenderedItems();
      expect(renderedItems.map((item) => item.id)).toEqual(['file:second']);
      const secondElement = renderedItems[0].element;
      expect(secondElement).toBe(firstElement);
      await waitForShellCounts(secondElement, {
        pre: 1,
        svg: 1,
        theme: 1,
        unsafe: 1,
      });
      expect(getShadowText(secondElement)).toContain('second pooled content');
      expect(getShadowText(secondElement)).not.toContain(
        'first pooled content'
      );
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  // Header slot nodes produced by options callbacks (renderHeaderPrefix and
  // friends) are light-DOM children of the host element, owned by the
  // File/FileDiff instance rather than the host application. Releasing a row
  // must remove them — a shell with leftover light-DOM children never
  // qualifies as clean, which would exclude it from pooled reuse.
  test('reuses shells for rows that render header slot content', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      theme: DEFAULT_THEMES,
      renderHeaderPrefix: () => 'prefix content',
    });
    const root = createRoot({ height: 120 });

    try {
      viewer.setup(root);
      await renderItems(viewer, [
        makeFileItem('file:first', 'first slotted content', 100),
        makeFileItem('file:second', 'second slotted content', 100),
      ]);

      let renderedItems = viewer.getRenderedItems();
      expect(renderedItems.map((item) => item.id)).toEqual(['file:first']);
      const firstElement = renderedItems[0].element;
      await waitFor(
        () => firstElement.querySelector('[slot="header-prefix"]') != null
      );
      expect(
        firstElement.querySelectorAll('[slot="header-prefix"]')
      ).toHaveLength(1);

      root.scrollTop = 2_400;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);

      renderedItems = viewer.getRenderedItems();
      expect(renderedItems.map((item) => item.id)).toEqual(['file:second']);
      expect(renderedItems[0].element).toBe(firstElement);
      expect(
        firstElement.querySelectorAll('[slot="header-prefix"]')
      ).toHaveLength(1);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('clears pooled shells when shared css options change', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      themeType: 'light',
    });

    try {
      viewer.setup(createRoot({ height: 1000 }));
      await renderItems(viewer, [
        makeFileItem('file:first', 'first content', 5),
        makeFileItem('file:second', 'second content', 5),
      ]);

      const pooledCandidates = viewer
        .getRenderedItems()
        .map((item) => item.element);
      expect(pooledCandidates).toHaveLength(2);

      viewer.setItems([]);
      viewer.setOptions({
        disableFileHeader: true,
        theme: DEFAULT_THEMES,
        themeType: 'dark',
      });
      await renderItems(viewer, [
        makeFileItem('file:third', 'third content', 5),
      ]);

      const nextElement = viewer.getRenderedItems()[0]?.element;
      expect(nextElement).toBeDefined();
      expect(pooledCandidates).not.toContain(nextElement);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  // Toggling disableFileHeader does not clear the element pool. A row
  // remounted from a pooled shell must not display a header carried over
  // from the shell's previous occupant.
  test('drops stale pooled headers when disableFileHeader is enabled', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({ theme: DEFAULT_THEMES });

    try {
      viewer.setup(createRoot({ height: 1000 }));
      await renderItems(viewer, [
        makeDiffItem('diff:first', 'first.ts'),
        makeFileItem('file:second', 'second pooled header', 5),
      ]);

      const pooledCandidates = viewer
        .getRenderedItems()
        .map((item) => item.element);
      expect(pooledCandidates).toHaveLength(2);
      for (const element of pooledCandidates) {
        await waitFor(() => getHeaderCount(element) === 1);
        expect(getHeaderCount(element)).toBe(1);
      }

      // Release both rows into the pool, then disable headers — this option
      // change intentionally keeps the pool.
      viewer.setItems([]);
      viewer.setOptions({ disableFileHeader: true, theme: DEFAULT_THEMES });
      await renderItems(viewer, [
        makeDiffItem('diff:third', 'third.ts'),
        makeFileItem('file:fourth', 'fourth pooled header', 5),
      ]);

      const remountedItems = viewer.getRenderedItems();
      expect(remountedItems.map((item) => item.id)).toEqual([
        'diff:third',
        'file:fourth',
      ]);
      for (const item of remountedItems) {
        // The rows must reuse pooled shells, otherwise this test would not
        // exercise pooled reuse at all.
        expect(pooledCandidates).toContain(item.element);
        expect(getHeaderCount(item.element)).toBe(0);
      }
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('waits for managed slot children to clear before reusing a shell', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({ disableFileHeader: true }, undefined, true);
    const root = createRoot({ height: 120 });
    const coordinator: CodeViewCoordinator<undefined> = {
      hasAnnotationRenderer: false,
      hasGutterRenderer: false,
      hasHeaderRenderers: true,
      onSnapshotChange() {},
    };

    try {
      viewer.setSlotCoordinator(coordinator);
      viewer.setup(root);
      await renderItems(viewer, [
        makeFileItem('file:first', 'first managed content', 100),
        makeFileItem('file:second', 'second managed content', 100),
      ]);

      const firstItem = viewer.getRenderedItems()[0];
      expect(firstItem?.id).toBe('file:first');
      const firstElement = firstItem.element;
      firstElement.appendChild(document.createElement('div'));

      root.scrollTop = 2_400;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);

      const secondItem = viewer.getRenderedItems()[0];
      expect(secondItem?.id).toBe('file:second');
      expect(secondItem.element).not.toBe(firstElement);

      firstElement.replaceChildren();
      root.scrollTop = 0;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);

      const remountedFirstItem = viewer.getRenderedItems()[0];
      expect(remountedFirstItem?.id).toBe('file:first');
      expect(remountedFirstItem.element).toBe(firstElement);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });
});
