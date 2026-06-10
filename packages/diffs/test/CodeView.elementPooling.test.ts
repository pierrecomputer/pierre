import { describe, expect, test } from 'bun:test';

import { CodeView, type CodeViewCoordinator } from '../src/components/CodeView';
import { DEFAULT_THEMES } from '../src/constants';
import type { CodeViewItem, FileContents } from '../src/types';
import {
  createRoot,
  dispatchScroll,
  installDom,
  renderItems,
  wait,
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

function getShadowText(element: HTMLElement): string {
  return element.shadowRoot?.textContent ?? '';
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
  for (let attempt = 0; attempt < 50; attempt++) {
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
