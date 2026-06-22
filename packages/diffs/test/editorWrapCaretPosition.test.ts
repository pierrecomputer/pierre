import { afterAll, describe, expect, test } from 'bun:test';

import { File } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { FileContents } from '../src/types';
import { installDom, wait } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

async function waitForEditableContent(
  container: HTMLElement
): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const content = container.shadowRoot?.querySelector('[data-content]');
    if (
      content instanceof HTMLElement &&
      (content.contentEditable === 'true' ||
        content.getAttribute('contenteditable') === 'true')
    ) {
      return content;
    }
    await wait(0);
  }

  throw new Error('editor content did not become editable');
}

// Height the test uses for a single visual row. Deliberately not the editor's
// default 20px line height: the caret's y must come from the measured line
// offsetTop, so a distinct value proves it is not coincidentally matching a
// fixed lineHeight multiple.
const ROW = 23;

// jsdom performs no layout, so every element.offsetTop is 0 and the wrap-induced
// vertical shift this test exercises would be invisible. Install a getter that
// reports each rendered row's top from a layout map the test controls, keyed by
// the 1-based data-line attribute the editor stamps on each line element.
// Elements without a mapped data-line (e.g. the content wrapper) keep offsetTop
// 0, matching their jsdom default.
function installLineLayout(): {
  setLineTop(lineIndex: number, top: number): void;
  restore(): void;
} {
  const tops = new Map<string, number>();
  // installDom() has already pointed the global HTMLElement at this jsdom
  // window, so patching the global prototype patches the rendered line elements.
  const proto = HTMLElement.prototype;
  const original = Object.getOwnPropertyDescriptor(proto, 'offsetTop');
  Object.defineProperty(proto, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement): number {
      const dataLine = this.getAttribute?.('data-line');
      if (dataLine != null && tops.has(dataLine)) {
        return tops.get(dataLine)!;
      }
      return 0;
    },
  });
  return {
    setLineTop(lineIndex: number, top: number): void {
      tops.set(String(lineIndex + 1), top);
    },
    restore(): void {
      if (original !== undefined) {
        Object.defineProperty(proto, 'offsetTop', original);
      } else {
        Object.defineProperty(proto, 'offsetTop', {
          configurable: true,
          get: () => 0,
        });
      }
    },
  };
}

function caretTranslateY(container: HTMLElement): number {
  const caret = container.shadowRoot?.querySelector('[data-caret]');
  if (!(caret instanceof HTMLElement)) {
    throw new Error('no caret element rendered');
  }
  const match = /translateY\(([-\d.]+)px\)/.exec(caret.style.transform);
  if (match === null) {
    throw new Error(`caret has no translateY: ${caret.style.transform}`);
  }
  return parseFloat(match[1]);
}

function caretAt(line: number) {
  return [
    {
      start: { line, character: 0 },
      end: { line, character: 0 },
      direction: 'none' as const,
    },
  ];
}

describe('editor wrap caret position', () => {
  // When word wrap is on, growing a line until it wraps onto a second visual
  // row keeps the logical line count unchanged (change.lineDelta === 0) but
  // pushes every following line down by a row. The cached line-Y positions of
  // those downstream lines must be invalidated so the caret/selection overlays
  // stay aligned; otherwise they render a row too high, on the wrapped line's
  // continuation row.
  test('re-measures downstream line Y after a wrap-height-changing edit', async () => {
    const dom = installDom();
    const layout = installLineLayout();
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);

    const file = new File<undefined>({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      overflow: 'wrap',
    });
    const editor = new Editor<undefined>();
    const initialFile: FileContents = {
      name: 'wrap.ts',
      contents: 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;',
    };

    file.render({ file: initialFile, fileContainer, forceRender: true });
    editor.edit(file);
    await waitForEditableContent(fileContainer);

    try {
      // Initial layout: each logical line occupies exactly one visual row.
      for (let i = 0; i < 4; i++) {
        layout.setLineTop(i, i * ROW);
      }

      // Cache line 2's Y while line 0 is still a single row.
      editor.setSelections(caretAt(2));
      const beforeY = caretTranslateY(fileContainer);

      // Line 0 grows long enough to wrap onto a second visual row, pushing
      // lines 1..3 down by one row. Reflect that in the layout map, then apply
      // the edit so #applyChange runs with lineDelta === 0 (no new logical
      // line) — the case the stale-cache bug missed.
      for (let i = 1; i < 4; i++) {
        layout.setLineTop(i, i * ROW + ROW);
      }
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 12 },
            end: { line: 0, character: 12 },
          },
          newText: ' // padded out until this line wraps onto a second row',
        },
      ]);
      await wait(0);

      // Re-render the caret on line 2 and read its new Y.
      editor.setSelections(caretAt(2));
      const afterY = caretTranslateY(fileContainer);

      // Line 2 dropped exactly one row when line 0 wrapped, so the caret must
      // follow. Before the fix the stale #lineYCache left afterY === beforeY.
      expect(afterY - beforeY).toBe(ROW);
    } finally {
      layout.restore();
      editor.cleanUp();
      file.cleanUp();
      dom.cleanup();
    }
  });
});
