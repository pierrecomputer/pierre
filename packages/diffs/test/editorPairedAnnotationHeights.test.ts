import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { Virtualizer } from '../src/components/Virtualizer';
import { Editor } from '../src/editor/editor';
import type { EditorCaret } from '../src/editor/types';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { DiffLineAnnotation, FileDiffMetadata } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import {
  createRoot,
  installDom,
  preloadTestHighlighter,
  wait,
  waitFor,
} from './domHarness';

beforeAll(async () => {
  await preloadTestHighlighter();
});

afterAll(async () => {
  await disposeHighlighter();
});

const ROW_HEIGHT = 20;
const OLD_ANNOTATION_HEIGHT = 80;
const NEW_ANNOTATION_HEIGHT = 20;

// The test DOM has no layout. This gives rows the heights a browser would:
// a line is 20px, an annotation on the old side is 80px and one on the new
// side is 20px, until the resize manager gives both sides the same
// min-height.
function installRowLayout(): void {
  function ownAnnotationHeight(element: Element): number {
    return element.closest('[data-deletions]') != null
      ? OLD_ANNOTATION_HEIGHT
      : NEW_ANNOTATION_HEIGHT;
  }
  function height(element: Element): number {
    if (element instanceof HTMLElement && 'lineAnnotation' in element.dataset) {
      const minHeight = parseFloat(
        element.style.getPropertyValue('--diffs-annotation-min-height')
      );
      return Math.max(
        Number.isNaN(minHeight) ? 0 : minHeight,
        ownAnnotationHeight(element)
      );
    }
    if (element.parentElement?.hasAttribute('data-line-annotation') === true) {
      return ownAnnotationHeight(element);
    }
    if (
      element.hasAttribute('data-content') ||
      element.hasAttribute('data-gutter')
    ) {
      let total = 0;
      for (const child of element.children) {
        total += height(child);
      }
      return total;
    }
    return ROW_HEIGHT;
  }
  function top(element: Element): number {
    if (!element.hasAttribute('data-line')) {
      return 0;
    }
    let total = 0;
    let previous = element.previousElementSibling;
    while (previous != null) {
      total += height(previous);
      previous = previous.previousElementSibling;
    }
    return total;
  }
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 400,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      return top(this);
    },
  });
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const y = top(this);
    const boxHeight = height(this);
    return {
      x: 0,
      y,
      top: y,
      left: 0,
      right: 400,
      bottom: y + boxHeight,
      width: 400,
      height: boxHeight,
      toJSON: () => ({}),
    };
  };
}

function twoLineDiff(): FileDiffMetadata {
  return parseDiffFromFile(
    { name: 'a.ts', contents: 'old\nlast\n' },
    { name: 'a.ts', contents: 'new\nlast\n' }
  );
}

// An annotation on each side of line 1. The old side's is taller, so the new
// side's is stretched and line 2 moves down.
const UNEVEN_ANNOTATIONS: DiffLineAnnotation<string>[] = [
  { side: 'deletions', lineNumber: 1, metadata: 'old' },
  { side: 'additions', lineNumber: 1, metadata: 'new' },
];

interface CaretMetadata {
  color: string;
}

const CARET_ON_LINE_2: EditorCaret<CaretMetadata> = {
  anchor: { line: 1, character: 0 },
  focus: { line: 1, character: 0 },
  metadata: { color: '#7c3aed' },
};

function isEditable(shadowRoot: ShadowRoot | null | undefined): boolean {
  const content = shadowRoot?.querySelector('[data-additions] [data-content]');
  return content instanceof HTMLElement && content.contentEditable === 'true';
}

// Where the remote caret is drawn and where the new side's line 2 is.
function readCaretAndRow(shadowRoot: ShadowRoot | null | undefined): {
  caretY: number;
  rowTop: number;
} {
  const caret = shadowRoot?.querySelector('[data-remote-caret]');
  const row = shadowRoot?.querySelector('[data-additions] [data-line="2"]');
  if (!(caret instanceof HTMLElement) || !(row instanceof HTMLElement)) {
    throw new Error('the caret or line 2 was not rendered');
  }
  const match = /translateY\(([-\d.]+)px\)/.exec(caret.style.transform);
  if (match == null) {
    throw new Error(`invalid caret transform: ${caret.style.transform}`);
  }
  return { caretY: Number(match[1]), rowTop: row.offsetTop };
}

// What onPostRender finds once the annotations are in the DOM.
function recordAtPostRender(): {
  seen: { caretY: number; rowTop: number }[];
  onPostRender(fileContainer: HTMLElement): void;
} {
  const seen: { caretY: number; rowTop: number }[] = [];
  return {
    seen,
    onPostRender(fileContainer) {
      const { shadowRoot } = fileContainer;
      if (
        shadowRoot?.querySelector('[data-line-annotation]') != null &&
        shadowRoot.querySelector('[data-remote-caret]') != null
      ) {
        seen.push(readCaretAndRow(shadowRoot));
      }
    },
  };
}

describe('editor positions with paired annotation heights', () => {
  test('a caret under a stretched annotation follows its row in a Virtualizer', async () => {
    const dom = installDom();
    installRowLayout();
    const root = createRoot();
    const virtualizer = new Virtualizer();
    virtualizer.setup(root);
    const container = document.createElement('div');
    root.appendChild(container);
    const postRender = recordAtPostRender();
    const instance = new VirtualizedFileDiff<string, CaretMetadata>(
      {
        disableFileHeader: true,
        expandUnchanged: true,
        useTokenTransformer: true,
        renderAnnotation: () => document.createElement('div'),
        onPostRender: postRender.onPostRender,
      },
      virtualizer
    );
    const editor = new Editor<'file-diff', string, CaretMetadata>('file-diff', {
      renderCaret: () => document.createElement('span'),
    });

    try {
      instance.render({
        fileDiff: twoLineDiff(),
        fileContainer: container,
        forceRender: true,
      });
      editor.edit(instance);
      await waitFor(() => isEditable(container.shadowRoot));
      await wait(30);
      editor.setCarets([CARET_ON_LINE_2]);

      instance.setLineAnnotations(UNEVEN_ANNOTATIONS);
      instance.rerender();
      await waitFor(
        () =>
          container.shadowRoot?.querySelector('[data-line-annotation]') != null
      );
      await wait(40);

      const { caretY, rowTop } = readCaretAndRow(container.shadowRoot);
      expect(rowTop).toBe(ROW_HEIGHT + OLD_ANNOTATION_HEIGHT);
      expect(caretY).toBe(rowTop);
      // onPostRender saw the same finished DOM.
      expect(postRender.seen.at(0)).toEqual({ caretY, rowTop });
    } finally {
      editor.cleanUp();
      instance.cleanUp();
      virtualizer.cleanUp();
      dom.cleanup();
    }
  });

  test('a caret under a stretched annotation follows its row in a CodeView', async () => {
    const dom = installDom();
    installRowLayout();
    const fileDiff = twoLineDiff();
    const postRender = recordAtPostRender();
    const viewer = new CodeView<string, CaretMetadata>({
      disableFileHeader: true,
      expandUnchanged: true,
      useTokenTransformer: true,
      diffStyle: 'split',
      renderAnnotation: () => document.createElement('div'),
      onPostRender: postRender.onPostRender,
      createEditor: (type, options, editStateKey) =>
        new Editor(
          type,
          { ...options, renderCaret: () => document.createElement('span') },
          editStateKey
        ),
    });
    const root = createRoot({ height: 600 });
    viewer.setup(root);
    const shadowRoot = () => viewer.getRenderedItems()[0]?.element.shadowRoot;

    try {
      viewer.setItems([
        { id: 'diff', type: 'diff', fileDiff, edit: true, version: 1 },
      ]);
      viewer.render(true);
      await waitFor(() => isEditable(shadowRoot()));
      await wait(30);
      viewer.getEditor('diff')?.setCarets([CARET_ON_LINE_2]);

      viewer.setItems([
        {
          id: 'diff',
          type: 'diff',
          fileDiff,
          edit: true,
          version: 2,
          annotations: UNEVEN_ANNOTATIONS,
        },
      ]);
      viewer.render(true);
      await waitFor(
        () => shadowRoot()?.querySelector('[data-line-annotation]') != null
      );
      await wait(60);

      const { caretY, rowTop } = readCaretAndRow(shadowRoot());
      expect(rowTop).toBe(ROW_HEIGHT + OLD_ANNOTATION_HEIGHT);
      expect(caretY).toBe(rowTop);
      // onPostRender saw the same finished DOM.
      expect(postRender.seen.at(0)).toEqual({ caretY, rowTop });
    } finally {
      viewer.cleanUp();
      await wait(0);
      dom.cleanup();
    }
  });
});
