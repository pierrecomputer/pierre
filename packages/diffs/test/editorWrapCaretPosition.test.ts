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

interface EditorTestWindow extends Window {
  KeyboardEvent: {
    new (type: string, eventInitDict?: KeyboardEventInit): KeyboardEvent;
  };
}

// Height the test uses for a single visual row. Deliberately not the editor's
// default 20px line height: the caret's y must come from the measured line
// offsetTop, so a distinct value proves it is not coincidentally matching a
// fixed lineHeight multiple.
const ROW = 23;

function rect(left: number, top: number, width = 1, height = 1): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON() {
      return {};
    },
  } as DOMRect;
}

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

function restorePrototypeProperty(
  proto: object,
  property: string,
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor !== undefined) {
    Object.defineProperty(proto, property, descriptor);
  } else {
    Reflect.deleteProperty(proto, property);
  }
}

// #wrapLineText detects visual row starts by checking when a Range's top moves
// downward. jsdom does not measure ranges, so this harness reports a new top
// every `columns` UTF-16 offsets, making wrap offsets deterministic.
function installWrapMeasurement(columns: number): { restore(): void } {
  const rangeProto = Object.getPrototypeOf(document.createRange()) as object;
  const elementProto = HTMLElement.prototype;
  const originalRangeRect = Object.getOwnPropertyDescriptor(
    rangeProto,
    'getBoundingClientRect'
  );
  const originalElementRect = Object.getOwnPropertyDescriptor(
    elementProto,
    'getBoundingClientRect'
  );

  Object.defineProperty(rangeProto, 'getBoundingClientRect', {
    configurable: true,
    value(this: Range): DOMRect {
      const offset = this.startOffset;
      return rect((offset % columns) * 8, Math.floor(offset / columns) * ROW);
    },
  });
  Object.defineProperty(elementProto, 'getBoundingClientRect', {
    configurable: true,
    value(): DOMRect {
      return rect(0, 0, columns * 8, ROW);
    },
  });

  return {
    restore(): void {
      restorePrototypeProperty(
        rangeProto,
        'getBoundingClientRect',
        originalRangeRect
      );
      restorePrototypeProperty(
        elementProto,
        'getBoundingClientRect',
        originalElementRect
      );
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

async function createWrapEditor(
  contents: string,
  wrapColumns: number
): Promise<{
  cleanup(): void;
  content: HTMLElement;
  editor: Editor<undefined>;
  window: EditorTestWindow;
}> {
  const dom = installDom();
  const wrapMeasurement = installWrapMeasurement(wrapColumns);
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
    contents,
  };

  file.render({ file: initialFile, fileContainer, forceRender: true });
  editor.edit(file);
  const content = await waitForEditableContent(fileContainer);

  return {
    cleanup(): void {
      wrapMeasurement.restore();
      editor.cleanUp();
      file.cleanUp();
      dom.cleanup();
    },
    content,
    editor,
    window: dom.window as unknown as EditorTestWindow,
  };
}

function dispatchMovementKey(
  window: EditorTestWindow,
  content: HTMLElement,
  init: KeyboardEventInit & { key: string }
): KeyboardEvent {
  const event = new window.KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  content.dispatchEvent(event);
  return event;
}

function setCaret(editor: Editor<undefined>, line: number, character: number) {
  editor.setSelections([
    {
      start: { line, character },
      end: { line, character },
      direction: 'none',
    },
  ]);
}

function expectCaret(
  editor: Editor<undefined>,
  line: number,
  character: number
): void {
  const selection = editor.getState().selections?.at(-1);
  expect(selection?.start).toEqual({ line, character });
  expect(selection?.end).toEqual({ line, character });
}

describe('editor wrap caret position', () => {
  test('arrow keys move through wrapped visual rows before changing logical lines', async () => {
    const { cleanup, content, editor, window } = await createWrapEditor(
      '012345678901234567890123456789\nshort',
      10
    );

    try {
      setCaret(editor, 0, 15);

      const downWithinLine = dispatchMovementKey(window, content, {
        key: 'ArrowDown',
      });
      expect(downWithinLine.defaultPrevented).toBe(true);
      expectCaret(editor, 0, 25);

      dispatchMovementKey(window, content, { key: 'ArrowUp' });
      expectCaret(editor, 0, 15);

      setCaret(editor, 0, 25);
      dispatchMovementKey(window, content, { key: 'ArrowDown' });
      expectCaret(editor, 1, 5);
    } finally {
      cleanup();
    }
  });

  test('line-boundary shortcuts use wrapped visual row boundaries', async () => {
    const { cleanup, content, editor, window } = await createWrapEditor(
      '  abcdefghij  klmnop',
      12
    );

    try {
      setCaret(editor, 0, 16);

      const commandLeft = dispatchMovementKey(window, content, {
        key: 'ArrowLeft',
        metaKey: true,
      });
      expect(commandLeft.defaultPrevented).toBe(true);
      expectCaret(editor, 0, 14);

      dispatchMovementKey(window, content, {
        key: 'ArrowLeft',
        metaKey: true,
      });
      expectCaret(editor, 0, 12);

      setCaret(editor, 0, 16);
      dispatchMovementKey(window, content, {
        key: 'ArrowRight',
        metaKey: true,
      });
      expectCaret(editor, 0, 20);

      setCaret(editor, 0, 16);
      dispatchMovementKey(window, content, { key: 'a', ctrlKey: true });
      expectCaret(editor, 0, 12);

      setCaret(editor, 0, 16);
      dispatchMovementKey(window, content, { key: 'e', ctrlKey: true });
      expectCaret(editor, 0, 20);

      setCaret(editor, 0, 16);
      dispatchMovementKey(window, content, { key: 'Home' });
      expectCaret(editor, 0, 12);

      setCaret(editor, 0, 16);
      dispatchMovementKey(window, content, { key: 'End' });
      expectCaret(editor, 0, 20);
    } finally {
      cleanup();
    }
  });

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
