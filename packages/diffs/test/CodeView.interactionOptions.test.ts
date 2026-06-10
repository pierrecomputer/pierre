import { describe, expect, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import { DEFAULT_THEMES } from '../src/constants';
import type { CodeViewItem } from '../src/types';
import {
  createRoot,
  installDom,
  makeFile,
  renderItems,
  wait,
} from './domHarness';

// Differs from the shared makeFileItem: these tests use 8-line .txt fixtures
// rather than the harness default of 20-line .ts files.
function makeFileItem(id: string, lineCount = 8): CodeViewItem<undefined> {
  return {
    id,
    type: 'file',
    file: makeFile(`${id}.txt`, lineCount),
  };
}

async function renderFileItem(viewer: CodeView, item = makeFileItem('file')) {
  await renderItems(viewer, [item]);
}

function getRenderedPre(viewer: CodeView): HTMLPreElement {
  const [renderedItem] = viewer.getRenderedItems();
  expect(renderedItem).toBeDefined();
  const pre = renderedItem?.element.shadowRoot?.querySelector('pre');
  expect(pre).toBeInstanceOf(HTMLPreElement);
  return pre as HTMLPreElement;
}

function getLineElement(pre: HTMLPreElement, lineNumber: number): HTMLElement {
  const line = pre.querySelector(`[data-line="${lineNumber}"]`);
  expect(line).toBeInstanceOf(HTMLElement);
  return line as HTMLElement;
}

function getNumberElement(
  pre: HTMLPreElement,
  lineNumber: number
): HTMLElement {
  const number = pre.querySelector(`[data-column-number="${lineNumber}"]`);
  expect(number).toBeInstanceOf(HTMLElement);
  return number as HTMLElement;
}

describe('CodeView interaction option updates', () => {
  test('enables line clicks for an already-rendered file item', async () => {
    const { cleanup } = installDom();
    const clickedLines: number[] = [];
    const viewer = new CodeView({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
    });

    try {
      viewer.setup(createRoot({ width: 800, height: 400 }));
      await renderFileItem(viewer);

      let pre = getRenderedPre(viewer);
      expect(pre.hasAttribute('data-interactive-lines')).toBe(false);

      viewer.setOptions({
        disableFileHeader: true,
        theme: DEFAULT_THEMES,
        onLineClick: (props: { lineNumber: number }) => {
          clickedLines.push(props.lineNumber);
        },
      });
      await wait(0);

      pre = getRenderedPre(viewer);
      expect(pre.hasAttribute('data-interactive-lines')).toBe(true);
      getLineElement(pre, 1).dispatchEvent(
        new window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          composed: true,
        })
      );

      expect(clickedLines).toEqual([1]);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('enables line selection attributes for an already-rendered file item', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
    });

    try {
      viewer.setup(createRoot({ width: 800, height: 400 }));
      await renderFileItem(viewer);

      let pre = getRenderedPre(viewer);
      expect(pre.hasAttribute('data-interactive-line-numbers')).toBe(false);

      viewer.setOptions({
        disableFileHeader: true,
        enableLineSelection: true,
        theme: DEFAULT_THEMES,
      });
      await wait(0);

      pre = getRenderedPre(viewer);
      expect(pre.hasAttribute('data-interactive-line-numbers')).toBe(true);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('enables hover highlighting for an already-rendered file item', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
    });

    try {
      viewer.setup(createRoot({ width: 800, height: 400 }));
      await renderFileItem(viewer);

      viewer.setOptions({
        disableFileHeader: true,
        lineHoverHighlight: 'both',
        theme: DEFAULT_THEMES,
      });
      await wait(0);

      const pre = getRenderedPre(viewer);
      const line = getLineElement(pre, 1);
      const number = getNumberElement(pre, 1);
      line.dispatchEvent(
        new window.PointerEvent('pointermove', {
          bubbles: true,
          composed: true,
          pointerType: 'mouse',
        })
      );

      expect(line.hasAttribute('data-hovered')).toBe(true);
      expect(number.hasAttribute('data-hovered')).toBe(true);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('enables custom gutter utility setup for an already-rendered file item', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
    });

    try {
      viewer.setup(createRoot({ width: 800, height: 400 }));
      await renderFileItem(viewer);

      viewer.setOptions({
        disableFileHeader: true,
        enableGutterUtility: true,
        renderGutterUtility: () => document.createElement('button'),
        theme: DEFAULT_THEMES,
      });
      await wait(0);

      const pre = getRenderedPre(viewer);
      const number = getNumberElement(pre, 1);
      number.dispatchEvent(
        new window.PointerEvent('pointermove', {
          bubbles: true,
          composed: true,
          pointerType: 'mouse',
        })
      );

      expect(number.querySelector('[data-gutter-utility-slot]')).not.toBeNull();
      expect(
        viewer
          .getRenderedItems()[0]
          .element.querySelector('[slot="gutter-utility-slot"]')
      ).not.toBeNull();
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });
});
