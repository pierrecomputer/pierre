import { afterAll, describe, expect, jest, spyOn, test } from 'bun:test';

import { File } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import {
  Editor,
  type EditorOptions,
  type EditPredictContext,
  type EditPredictProvider,
  type EditPredictRequest,
  type EditPredictResponse,
} from '../src/editor/editor';
import { recordEditPrediction } from '../src/editor/editPrediction';
import { TextDocument } from '../src/editor/textDocument';
import { getTextDocumentChangeTransaction } from '../src/editor/textDocumentChangeTransaction';
import type { EditorType } from '../src/editor/types';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { RenderRange } from '../src/types';
import { installDom, wait, waitFor } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

const FILE_NAME = 'src/edit.ts';
const EDIT_PREDICTION_DEBOUNCE_MS = 300;
const PREDICT_TIMEOUT = 2_000;

type Surface = 'File' | 'FileDiff';

interface PredictionCall {
  context: EditPredictContext;
  request: EditPredictRequest;
}

interface PredictionFixture {
  cleanup(): Promise<void>;
  container: HTMLElement;
  content: HTMLElement;
  editor: Editor<EditorType, undefined, undefined>;
  replaceExternalDocument(options: {
    contents: string;
    name?: string;
    oldContents?: string;
  }): void;
  // File only: re-render the same contents with a new virtualized window, the
  // way a scrolling host does. Throws on FileDiff, which has no window here.
  setRenderRange(renderRange: RenderRange): void;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function findEditableContent(container: HTMLElement): HTMLElement | undefined {
  return Array.from(
    container.shadowRoot?.querySelectorAll<HTMLElement>('[data-content]') ?? []
  ).find(
    (element) =>
      element.contentEditable === 'true' ||
      element.getAttribute('contenteditable') === 'true'
  );
}

async function createPredictionFixture({
  contents,
  diffStyle = 'split',
  editorOptions,
  name = FILE_NAME,
  oldContents,
  overflow,
  renderRange,
  surface = 'File',
}: {
  contents: string;
  // FileDiff only.
  diffStyle?: 'split' | 'unified';
  editorOptions: EditorOptions<EditorType, undefined, undefined>;
  name?: string;
  // FileDiff only: the old side. Defaults to `contents` with every "value"
  // replaced, so each such line becomes a two-sided change.
  oldContents?: string;
  overflow?: 'scroll' | 'wrap';
  renderRange?: RenderRange;
  surface?: Surface;
}): Promise<PredictionFixture> {
  const dom = installDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = new Editor<EditorType, undefined, undefined>(
    surface === 'FileDiff' ? 'file-diff' : 'file',
    editorOptions
  );
  let cleanUpSurface: () => void;
  let replaceExternalDocument: PredictionFixture['replaceExternalDocument'];
  let setRenderRange: PredictionFixture['setRenderRange'];

  if (surface === 'File') {
    let activeRenderRange = renderRange;
    const file = new File<undefined>({
      disableFileHeader: true,
      overflow,
      theme: DEFAULT_THEMES,
    });
    file.render({
      file: { name, contents },
      fileContainer: container,
      forceRender: true,
      renderRange: activeRenderRange,
    });
    editor.edit(file);
    cleanUpSurface = () => file.cleanUp();
    replaceExternalDocument = (replacement) => {
      file.render({
        file: {
          name: replacement.name ?? name,
          contents: replacement.contents,
        },
        fileContainer: container,
        forceRender: true,
        renderRange: activeRenderRange,
      });
    };
    setRenderRange = (nextRenderRange) => {
      activeRenderRange = nextRenderRange;
      file.render({
        file: { name, contents },
        fileContainer: container,
        forceRender: true,
        renderRange: activeRenderRange,
      });
    };
  } else {
    const diffOldContents =
      oldContents ?? contents.replaceAll('value', 'previous');
    const fileDiff = new FileDiff<undefined>({
      disableFileHeader: true,
      diffStyle,
      overflow,
      theme: DEFAULT_THEMES,
    });
    fileDiff.render({
      oldFile: { name, contents: diffOldContents },
      newFile: { name, contents },
      fileContainer: container,
      forceRender: true,
    });
    editor.edit(fileDiff);
    cleanUpSurface = () => fileDiff.cleanUp();
    replaceExternalDocument = (replacement) => {
      const replacementName = replacement.name ?? name;
      fileDiff.render({
        oldFile: {
          name: replacementName,
          contents: replacement.oldContents ?? diffOldContents,
        },
        newFile: {
          name: replacementName,
          contents: replacement.contents,
        },
        fileContainer: container,
        forceRender: true,
      });
    };
    setRenderRange = () => {
      throw new Error('setRenderRange is only available on the File surface');
    };
  }

  await waitFor(() => findEditableContent(container) !== undefined, {
    timeout: 3_000,
  });
  const content = findEditableContent(container);
  if (content === undefined) {
    throw new Error(`${surface} did not become editable`);
  }

  return {
    async cleanup() {
      editor.cleanUp();
      cleanUpSurface();
      await wait(0);
      dom.cleanup();
    },
    container,
    content,
    editor,
    replaceExternalDocument,
    setRenderRange,
  };
}

function setCaret(
  editor: Editor<EditorType, undefined, undefined>,
  line: number,
  character: number
): void {
  const position = { line, character };
  editor.setSelections([{ start: position, end: position, direction: 'none' }]);
}

function dispatchTextInput(content: HTMLElement, data: string): InputEvent {
  const view = content.ownerDocument.defaultView;
  if (view == null) {
    throw new Error('editor content is not attached to a window');
  }
  const event = new view.InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    composed: true,
    data,
    inputType: 'insertText',
  });
  content.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  return event;
}

function dispatchKey(
  content: HTMLElement,
  key: string,
  init: KeyboardEventInit = {},
  type: 'keydown' | 'keyup' = 'keydown'
): KeyboardEvent {
  const view = content.ownerDocument.defaultView;
  if (view == null) {
    throw new Error('editor content is not attached to a window');
  }
  const event = new view.KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    key,
    ...init,
  });
  content.dispatchEvent(event);
  return event;
}

function predictionElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.shadowRoot?.querySelectorAll<HTMLElement>(
      '[data-edit-prediction]'
    ) ?? []
  );
}

function hasVisiblePrediction(container: HTMLElement): boolean {
  return predictionElements(container).some((element) => {
    const style = getComputedStyle(element);
    return (
      element.hidden === false &&
      style.display !== 'none' &&
      style.opacity !== '0' &&
      style.visibility !== 'hidden'
    );
  });
}

// jsdom's canvas stub measures every character at 8px (domHarness) and the
// editor's Metrics keeps its 20px default line height without layout.
const CH = 8;
const LINE_HEIGHT = 20;

function domRect(
  left: number,
  top: number,
  width: number,
  height: number
): DOMRect {
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
  };
}

// jsdom performs no layout. #wrapLineText finds visual row starts by watching a
// Range's top move downward, so report a new top every `columns` UTF-16 offsets
// and give elements a non-zero rect so measurement is attempted at all. The
// hidden ghost text probe (`[data-edit-prediction]`) reports `ghostHeight`
// instead, which #measureGhostTextRows divides by the line height.
function installWrapMeasurement(
  view: Window & typeof globalThis,
  columns: number,
  ghostHeight: number
): () => void {
  const rangePrototype: object = Object.getPrototypeOf(
    view.document.createRange()
  );
  const elementPrototype = view.HTMLElement.prototype;
  const originals: Array<[object, string, PropertyDescriptor | undefined]> = [
    [
      rangePrototype,
      'getBoundingClientRect',
      Object.getOwnPropertyDescriptor(rangePrototype, 'getBoundingClientRect'),
    ],
    [
      rangePrototype,
      'getClientRects',
      Object.getOwnPropertyDescriptor(rangePrototype, 'getClientRects'),
    ],
    [
      elementPrototype,
      'getBoundingClientRect',
      Object.getOwnPropertyDescriptor(
        elementPrototype,
        'getBoundingClientRect'
      ),
    ],
  ];
  const rangeRect = (range: Range): DOMRect =>
    domRect(
      (range.startOffset % columns) * CH,
      Math.floor(range.startOffset / columns) * LINE_HEIGHT,
      CH,
      LINE_HEIGHT
    );
  Object.defineProperty(rangePrototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: Range): DOMRect {
      return rangeRect(this);
    },
  });
  Object.defineProperty(rangePrototype, 'getClientRects', {
    configurable: true,
    value(this: Range) {
      const rects = [rangeRect(this)];
      return Object.assign(rects, {
        item(index: number): DOMRect | null {
          return rects[index] ?? null;
        },
      });
    },
  });
  Object.defineProperty(elementPrototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: HTMLElement): DOMRect {
      return domRect(
        0,
        0,
        columns * CH,
        this.dataset.editPrediction === undefined ? LINE_HEIGHT : ghostHeight
      );
    },
  });
  return () => {
    for (const [prototype, property, descriptor] of originals) {
      if (descriptor === undefined) {
        Reflect.deleteProperty(prototype, property);
      } else {
        Object.defineProperty(prototype, property, descriptor);
      }
    }
  };
}

async function expectCallCount(
  calls: PredictionCall[],
  count: number
): Promise<void> {
  await waitFor(() => calls.length >= count, {
    timeout: PREDICT_TIMEOUT,
  });
  expect(calls).toHaveLength(count);
}

describe('Editor edit prediction', () => {
  test('debounces typed input and builds a small-document request', async () => {
    const calls: PredictionCall[] = [];
    const provider: EditPredictProvider = {
      predict(request, context) {
        calls.push({ context, request });
        return Promise.resolve({
          edits: [],
          newCursor: { line: 0, character: 4 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents: 'abc\r\ndef',
      editorOptions: { editPrediction: { provider } },
    });

    try {
      jest.useFakeTimers();
      setCaret(fixture.editor, 0, 3);
      dispatchTextInput(fixture.content, 'X');

      jest.advanceTimersByTime(EDIT_PREDICTION_DEBOUNCE_MS - 1);
      expect(calls).toHaveLength(0);
      jest.advanceTimersByTime(1);
      expect(calls).toHaveLength(1);

      expect(calls[0].request).toMatchObject({
        cursorOffsetInExcerpt: 4,
        editableRange: { start: 0, end: 9 },
        eol: '\r\n',
        excerptStartLine: 0,
        excerptText: 'abcX\r\ndef',
        path: FILE_NAME,
        version: 1,
      });
      expect(calls[0].context.signal.aborted).toBe(false);
    } finally {
      jest.useRealTimers();
      await fixture.cleanup();
    }
  });

  test('uses the document EOL when the excerpt has no line break', async () => {
    const calls: PredictionCall[] = [];
    const provider: EditPredictProvider = {
      predict(request, context) {
        calls.push({ context, request });
        return Promise.resolve({
          edits: [],
          newCursor: { line: 1, character: 1 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents: `${'界'.repeat(2_000)}\r\nshort`,
      editorOptions: { editPrediction: { provider } },
    });

    try {
      setCaret(fixture.editor, 1, 0);
      dispatchKey(fixture.content, 'ArrowRight');
      await expectCallCount(calls, 1);

      expect(calls[0].request.excerptText).toBe('short');
      expect(calls[0].request.eol).toBe('\r\n');
    } finally {
      await fixture.cleanup();
    }
  });

  test('bounds editable and context ranges around the cursor', async () => {
    const calls: PredictionCall[] = [];
    const contents = Array.from(
      { length: 600 },
      (_, line) => `const value${line} = ${line};`
    ).join('\n');
    const provider: EditPredictProvider = {
      predict(request, context) {
        calls.push({ context, request });
        return Promise.resolve({
          edits: [],
          newCursor: { line: 300, character: 6 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents,
      editorOptions: { editPrediction: { provider } },
    });

    try {
      setCaret(fixture.editor, 300, 5);
      dispatchKey(fixture.content, 'ArrowRight');
      await expectCallCount(calls, 1);

      const request = calls[0].request;
      expect(request.excerptStartLine).toBeGreaterThan(0);
      expect(request.excerptText.length).toBeLessThan(contents.length);
      expect(request.editableRange.start).toBeGreaterThan(0);
      expect(request.editableRange.end).toBeLessThan(
        request.excerptText.length
      );
      expect(request.cursorOffsetInExcerpt).toBeGreaterThan(
        request.editableRange.start
      );
      expect(request.cursorOffsetInExcerpt).toBeLessThan(
        request.editableRange.end
      );
    } finally {
      await fixture.cleanup();
    }
  });

  test('does not materialize the full document for prediction requests or history', async () => {
    const calls: PredictionCall[] = [];
    const provider: EditPredictProvider = {
      predict(request, context) {
        calls.push({ context, request });
        return Promise.resolve({
          edits: [],
          newCursor: { line: 60, character: 7 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents: Array.from(
        { length: 120 },
        (_, line) => `const value${line} = ${line};`
      ).join('\n'),
      editorOptions: {},
    });
    const getText = spyOn(TextDocument.prototype, 'getText');
    try {
      fixture.editor.setOptions({ editPrediction: { provider } });
      setCaret(fixture.editor, 60, 5);
      fixture.editor.applyEdits([
        {
          range: {
            start: { line: 60, character: 5 },
            end: { line: 60, character: 5 },
          },
          newText: 'X',
        },
      ]);
      await expectCallCount(calls, 1);

      expect(
        getText.mock.calls.filter(([range]) => range === undefined)
      ).toHaveLength(0);
      expect(calls[0].request.editHistory[0]?.diff).toContain(
        '+constX value60 = 60;'
      );
      expect(calls[0].request.excerptStartLine).toBeGreaterThan(0);
    } finally {
      getText.mockRestore();
      await fixture.cleanup();
    }
  });

  test('keeps pathological long-line requests within 128 KiB or skips them', async () => {
    const calls: PredictionCall[] = [];
    const contents = '界'.repeat(50_000);
    const provider: EditPredictProvider = {
      predict(request, context) {
        calls.push({ context, request });
        return Promise.resolve({
          edits: [],
          newCursor: { line: 0, character: 25_001 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents,
      editorOptions: { editPrediction: { provider } },
      name: 'pathological.txt',
    });

    try {
      setCaret(fixture.editor, 0, 25_000);
      dispatchKey(fixture.content, 'ArrowRight');
      await wait(400);

      expect(calls.length).toBeLessThanOrEqual(1);
      if (calls[0] !== undefined) {
        expect(
          new TextEncoder().encode(JSON.stringify(calls[0].request)).byteLength
        ).toBeLessThanOrEqual(128 * 1024);
      }
      expect(fixture.editor.getText()).toBe(contents);
    } finally {
      await fixture.cleanup();
    }
  });

  test('debounces prediction after a cursor-key movement', async () => {
    const calls: PredictionCall[] = [];
    const provider: EditPredictProvider = {
      predict(request, context) {
        calls.push({ context, request });
        return Promise.resolve({
          edits: [],
          newCursor: { line: 0, character: 1 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents: 'abc',
      editorOptions: { editPrediction: { provider } },
    });

    try {
      jest.useFakeTimers();
      setCaret(fixture.editor, 0, 0);
      const event = dispatchKey(fixture.content, 'ArrowRight');
      expect(event.defaultPrevented).toBe(true);

      jest.advanceTimersByTime(EDIT_PREDICTION_DEBOUNCE_MS - 1);
      expect(calls).toHaveLength(0);
      jest.advanceTimersByTime(1);
      expect(calls).toHaveLength(1);
      expect(calls[0].request).toMatchObject({
        cursorOffsetInExcerpt: 1,
        excerptText: 'abc',
        version: 0,
      });
    } finally {
      jest.useRealTimers();
      await fixture.cleanup();
    }
  });

  for (const surface of ['File', 'FileDiff'] as const) {
    test(`${surface} eagerly renders and accepts a prediction atomically`, async () => {
      const calls: PredictionCall[] = [];
      const changes: string[] = [];
      const typedText = 'const value = 1';
      const predictedText = 'const answer = 1;\nconsole.log(answer);';
      const newCursor = { line: 1, character: 7 };
      const response: EditPredictResponse = {
        edits: [
          {
            range: {
              start: { line: 0, character: 6 },
              end: { line: 0, character: 11 },
            },
            newText: 'answer',
          },
          {
            range: {
              start: { line: 0, character: typedText.length },
              end: { line: 0, character: typedText.length },
            },
            newText: ';\nconsole.log(answer);',
          },
        ],
        newCursor,
      };
      const provider: EditPredictProvider = {
        predict(request, context) {
          calls.push({ context, request });
          return Promise.resolve(response);
        },
      };
      const fixture = await createPredictionFixture({
        contents: 'const value = ',
        editorOptions: {
          editPrediction: { provider },
          onChange({ file }) {
            changes.push(file.contents);
          },
        },
        surface,
      });

      try {
        setCaret(fixture.editor, 0, 'const value = '.length);
        dispatchTextInput(fixture.content, '1');
        await expectCallCount(calls, 1);
        await waitFor(() => predictionElements(fixture.container).length > 0, {
          timeout: PREDICT_TIMEOUT,
        });

        expect(predictionElements(fixture.container).length).toBeGreaterThan(0);
        expect(fixture.editor.getText()).toBe(typedText);
        expect(changes).toEqual([typedText]);

        const tab = dispatchKey(fixture.content, 'Tab');
        expect(tab.defaultPrevented).toBe(true);
        expect(fixture.editor.getText()).toBe(predictedText);
        expect(fixture.editor.getViewState().selections).toEqual([
          { start: newCursor, end: newCursor, direction: 0 },
        ]);
        expect(changes).toEqual([typedText, predictedText]);
        await waitFor(
          () => predictionElements(fixture.container).length === 0,
          { timeout: PREDICT_TIMEOUT }
        );
        expect(predictionElements(fixture.container)).toHaveLength(0);
        expect(
          fixture.container.shadowRoot?.querySelectorAll(
            '[data-edit-prediction-spacer]'
          )
        ).toHaveLength(0);

        await expectCallCount(calls, 2);
        expect(calls[1].request.editHistory.at(-1)?.source).toBe('prediction');
        expect(calls[1].request.editHistory.at(-1)?.diff).toContain(
          '-const value = 1'
        );
        expect(calls[1].request.editHistory.at(-1)?.diff).toContain(
          '+const answer = 1;'
        );
        expect(calls[1].request.editHistory.at(-1)?.diff).toContain(
          '+console.log(answer);'
        );

        fixture.editor.undo();
        expect(fixture.editor.getText()).toBe(typedText);
      } finally {
        await fixture.cleanup();
      }
    });

    test(`${surface} masks and preserves the suffix for a mid-line insertion`, async () => {
      const contents = 'function value(items: CartItem[]): number {';
      const insertion = ', discount?: number';
      const character = 'function value(items: CartItem[]'.length;
      const provider: EditPredictProvider = {
        predict() {
          return Promise.resolve({
            edits: [
              {
                range: {
                  start: { line: 0, character },
                  end: { line: 0, character },
                },
                newText: insertion,
              },
            ],
            newCursor: { line: 0, character: character + insertion.length },
          });
        },
      };
      const fixture = await createPredictionFixture({
        contents,
        editorOptions: { editPrediction: { provider } },
        surface,
      });

      try {
        const sourceLine =
          fixture.content.querySelector<HTMLElement>('[data-line="1"]');
        await waitFor(
          () =>
            Array.from(sourceLine?.children ?? []).some(
              (token) =>
                Number((token as HTMLElement).dataset.char) >= character
            ),
          { timeout: PREDICT_TIMEOUT }
        );
        const sourceSuffixTokens = Array.from(sourceLine?.children ?? [])
          .map((token) => token as HTMLElement)
          .flatMap((token) => {
            const text = token.textContent ?? '';
            const start = Number(token.dataset.char);
            return start + text.length <= character
              ? []
              : [
                  {
                    text: text.slice(Math.max(0, character - start)),
                    dark: token.style.getPropertyValue('--diffs-token-dark'),
                    light: token.style.getPropertyValue('--diffs-token-light'),
                  },
                ];
          });
        expect(
          sourceSuffixTokens.some(
            ({ dark, light }) => dark !== '' && light !== ''
          )
        ).toBe(true);

        setCaret(fixture.editor, 0, character);
        await waitFor(() => predictionElements(fixture.container).length > 0, {
          timeout: PREDICT_TIMEOUT,
        });

        const prediction = predictionElements(fixture.container)[0];
        expect(prediction.dataset.replacement).toBeUndefined();
        expect(
          fixture.container.shadowRoot?.querySelector(
            '[data-edit-prediction-insertion-range]'
          )
        ).not.toBeNull();
        expect(
          prediction.querySelector('[data-edit-prediction-suffix]')?.textContent
        ).toBe('): number {');
        expect(
          Array.from(
            prediction.querySelector('[data-edit-prediction-suffix]')
              ?.children ?? []
          ).map((token) => ({
            text: token.textContent,
            dark: (token as HTMLElement).style.getPropertyValue(
              '--diffs-token-dark'
            ),
            light: (token as HTMLElement).style.getPropertyValue(
              '--diffs-token-light'
            ),
          }))
        ).toEqual(sourceSuffixTokens);
        expect(
          prediction.querySelector('[data-edit-prediction-line]')?.textContent
        ).toBe(', discount?: number): number {');

        expect(dispatchKey(fixture.content, 'Tab').defaultPrevented).toBe(true);
        expect(fixture.editor.getText()).toBe(
          'function value(items: CartItem[], discount?: number): number {'
        );
      } finally {
        await fixture.cleanup();
      }
    });

    test(`${surface} masks and preserves the suffix for a mid-line replacement`, async () => {
      const contents = 'return value;';
      const start = 'return '.length;
      const end = start + 'value'.length;
      const replacement = 'longerName';
      const provider: EditPredictProvider = {
        predict() {
          return Promise.resolve({
            edits: [
              {
                range: {
                  start: { line: 0, character: start },
                  end: { line: 0, character: end },
                },
                newText: replacement,
              },
            ],
            newCursor: { line: 0, character: start + replacement.length },
          });
        },
      };
      const fixture = await createPredictionFixture({
        contents,
        editorOptions: { editPrediction: { provider } },
        surface,
      });

      try {
        setCaret(fixture.editor, 0, end);
        await waitFor(() => predictionElements(fixture.container).length > 0, {
          timeout: PREDICT_TIMEOUT,
        });

        const prediction = predictionElements(fixture.container)[0];
        expect(prediction.dataset.replacement).toBe('');
        const replacementRange =
          fixture.container.shadowRoot?.querySelector<HTMLElement>(
            '[data-edit-prediction-replacement-range]'
          );
        expect(replacementRange).not.toBeNull();
        expect(replacementRange?.style.width).toBe('48px');
        expect(
          prediction.querySelector('[data-edit-prediction-line]')?.textContent
        ).toBe('longerName;');

        expect(dispatchKey(fixture.content, 'Tab').defaultPrevented).toBe(true);
        expect(fixture.editor.getText()).toBe('return longerName;');
      } finally {
        await fixture.cleanup();
      }
    });

    test(`${surface} composes multiple same-line insertions in the preview`, async () => {
      const contents = 'alpha value gamma';
      const firstCharacter = 'alpha '.length;
      const secondCharacter = 'alpha value '.length;
      const provider: EditPredictProvider = {
        predict() {
          return Promise.resolve({
            edits: [
              {
                range: {
                  start: { line: 0, character: firstCharacter },
                  end: { line: 0, character: firstCharacter },
                },
                newText: 'one ',
              },
              {
                range: {
                  start: { line: 0, character: secondCharacter },
                  end: { line: 0, character: secondCharacter },
                },
                newText: 'two ',
              },
            ],
            newCursor: { line: 0, character: 25 },
          });
        },
      };
      const fixture = await createPredictionFixture({
        contents,
        editorOptions: { editPrediction: { provider } },
        surface,
      });

      try {
        setCaret(fixture.editor, 0, firstCharacter);
        await waitFor(() => predictionElements(fixture.container).length > 0, {
          timeout: PREDICT_TIMEOUT,
        });

        const predictions = predictionElements(fixture.container);
        expect(predictions).toHaveLength(1);
        expect(
          predictions[0].querySelector('[data-edit-prediction-line]')
            ?.textContent
        ).toBe('one value two gamma');
        expect(fixture.editor.getText()).toBe(contents);

        expect(dispatchKey(fixture.content, 'Tab').defaultPrevented).toBe(true);
        expect(fixture.editor.getText()).toBe('alpha one value two gamma');
      } finally {
        await fixture.cleanup();
      }
    });

    test(`${surface} previews edits sharing a cross-line boundary`, async () => {
      const contents = 'abc\ndef value';
      const provider: EditPredictProvider = {
        predict() {
          return Promise.resolve({
            edits: [
              {
                range: {
                  start: { line: 0, character: 2 },
                  end: { line: 1, character: 0 },
                },
                newText: 'C',
              },
              {
                range: {
                  start: { line: 1, character: 1 },
                  end: { line: 1, character: 2 },
                },
                newText: 'E',
              },
            ],
            newCursor: { line: 0, character: 5 },
          });
        },
      };
      const fixture = await createPredictionFixture({
        contents,
        editorOptions: { editPrediction: { provider } },
        surface,
      });

      try {
        setCaret(fixture.editor, 0, 2);
        await waitFor(
          () => predictionElements(fixture.container).length === 1,
          {
            timeout: PREDICT_TIMEOUT,
          }
        );

        expect(
          predictionElements(fixture.container).map(
            (prediction) => prediction.textContent
          )
        ).toEqual(['CdEf value']);
        expect(fixture.editor.getText()).toBe(contents);

        expect(dispatchKey(fixture.content, 'Tab').defaultPrevented).toBe(true);
        expect(fixture.editor.getText()).toBe('abCdEf value');
      } finally {
        await fixture.cleanup();
      }
    });

    test(`${surface} reserves numberless rows for multiline ghost text`, async () => {
      const contents = 'const value = 1;\nnext();\nend();';
      const provider: EditPredictProvider = {
        predict() {
          return Promise.resolve({
            edits: [
              {
                range: {
                  start: { line: 1, character: 7 },
                  end: { line: 1, character: 7 },
                },
                newText: '\nghostOne();\nghostTwo();',
              },
            ],
            newCursor: { line: 3, character: 11 },
          });
        },
      };
      const fixture = await createPredictionFixture({
        contents,
        editorOptions: { editPrediction: { provider } },
        surface,
      });
      const gutter = fixture.content.parentElement?.querySelector<HTMLElement>(
        ':scope > [data-gutter]'
      );
      const lineNumbers = () =>
        Array.from(
          fixture.content.querySelectorAll<HTMLElement>(':scope > [data-line]')
        ).map((element) => element.dataset.line);
      const gutterNumbers = () =>
        Array.from(
          gutter?.querySelectorAll<HTMLElement>(
            ':scope > [data-column-number]'
          ) ?? []
        ).map((element) => element.dataset.columnNumber);
      const initialLineNumbers = lineNumbers();
      const initialGutterNumbers = gutterNumbers();

      try {
        setCaret(fixture.editor, 1, 7);
        await waitFor(() => predictionElements(fixture.container).length > 0, {
          timeout: PREDICT_TIMEOUT,
        });

        const prediction = predictionElements(fixture.container)[0];
        const ghostLines = Array.from(
          prediction.querySelectorAll<HTMLElement>(
            '[data-edit-prediction-line]'
          )
        );
        expect(ghostLines).toHaveLength(3);
        expect(
          ghostLines.every(
            (line) => line.closest('[data-line], [data-column-number]') === null
          )
        ).toBe(true);
        expect(lineNumbers()).toEqual(initialLineNumbers);
        expect(gutterNumbers()).toEqual(initialGutterNumbers);

        const anchorLine =
          fixture.content.querySelector<HTMLElement>('[data-line="2"]');
        const anchorGutter = gutter?.querySelector<HTMLElement>(
          '[data-column-number="2"]'
        );
        for (const element of [anchorLine, anchorGutter]) {
          expect(element?.dataset.editPredictionSpacer).toBe('');
          expect(
            element?.style.getPropertyValue(
              '--diffs-edit-prediction-spacer-height'
            )
          ).toBe('2lh');
        }

        dispatchKey(fixture.content, 'ArrowLeft');
        expect(
          fixture.container.shadowRoot?.querySelectorAll(
            '[data-edit-prediction-spacer]'
          )
        ).toHaveLength(0);
        expect(lineNumbers()).toEqual(initialLineNumbers);
        expect(gutterNumbers()).toEqual(initialGutterNumbers);
      } finally {
        await fixture.cleanup();
      }
    });

    test(`${surface} sums spacer rows for grouped multiline edits`, async () => {
      const contents = 'alpha value\nnext();';
      const provider: EditPredictProvider = {
        predict() {
          return Promise.resolve({
            edits: [
              {
                range: {
                  start: { line: 0, character: 5 },
                  end: { line: 0, character: 5 },
                },
                newText: '\nfirst',
              },
              {
                range: {
                  start: { line: 0, character: 11 },
                  end: { line: 0, character: 11 },
                },
                newText: '\nsecond',
              },
            ],
            newCursor: { line: 2, character: 6 },
          });
        },
      };
      const fixture = await createPredictionFixture({
        contents,
        editorOptions: { editPrediction: { provider } },
        surface,
      });

      try {
        setCaret(fixture.editor, 0, 5);
        await waitFor(() => predictionElements(fixture.container).length > 0, {
          timeout: PREDICT_TIMEOUT,
        });

        const anchorLine =
          fixture.content.querySelector<HTMLElement>('[data-line="1"]');
        expect(anchorLine?.dataset.editPredictionSpacer).toBe('');
        expect(
          anchorLine?.style.getPropertyValue(
            '--diffs-edit-prediction-spacer-height'
          )
        ).toBe('2lh');
      } finally {
        await fixture.cleanup();
      }
    });
  }

  // A deleted empty line, a deleted line break, or a replacement ending on an
  // empty line strikes through no text. The prediction still counts as drawn,
  // so Tab accepts it instead of indenting.
  for (const { diffStyle, label, surface } of [
    { label: 'File', surface: 'File' },
    { diffStyle: 'split', label: 'split FileDiff', surface: 'FileDiff' },
    { diffStyle: 'unified', label: 'unified FileDiff', surface: 'FileDiff' },
  ] as const) {
    test(`${label} accepts a prediction that deletes an empty line`, async () => {
      const calls: PredictionCall[] = [];
      const provider: EditPredictProvider = {
        predict(request, context) {
          calls.push({ context, request });
          return Promise.resolve({
            edits: [
              {
                range: {
                  start: { line: 0, character: 3 },
                  end: { line: 0, character: 3 },
                },
                newText: ' // done',
              },
              {
                range: {
                  start: { line: 1, character: 0 },
                  end: { line: 2, character: 0 },
                },
                newText: '',
              },
            ],
            newCursor: { line: 0, character: 11 },
          });
        },
      };
      const fixture = await createPredictionFixture({
        contents: 'foo\n\nbar\nbaz',
        diffStyle,
        editorOptions: { editPrediction: { provider } },
        oldContents: 'foo\n\nbar\nbase',
        surface,
      });

      try {
        setCaret(fixture.editor, 0, 3);
        await expectCallCount(calls, 1);
        await waitFor(() => predictionElements(fixture.container).length > 0, {
          timeout: PREDICT_TIMEOUT,
        });
        expect(predictionElements(fixture.container)).toHaveLength(1);
        // One mark on the deleted empty line; none on the line that survives
        // after the range's end at column 0.
        expect(
          fixture.container.shadowRoot?.querySelectorAll(
            '[data-edit-prediction-deletion-range]'
          )
        ).toHaveLength(1);

        const tab = dispatchKey(fixture.content, 'Tab');
        expect(tab.defaultPrevented).toBe(true);
        expect(fixture.editor.getText()).toBe('foo // done\nbar\nbaz');
      } finally {
        await fixture.cleanup();
      }
    });

    test(`${label} accepts a replacement that ends on an empty line`, async () => {
      const calls: PredictionCall[] = [];
      const provider: EditPredictProvider = {
        predict(request, context) {
          calls.push({ context, request });
          return Promise.resolve({
            edits: [
              {
                range: {
                  start: { line: 0, character: 3 },
                  end: { line: 1, character: 0 },
                },
                newText: ' // note',
              },
            ],
            newCursor: { line: 0, character: 11 },
          });
        },
      };
      const fixture = await createPredictionFixture({
        contents: 'foo\n\nbar',
        diffStyle,
        editorOptions: { editPrediction: { provider } },
        oldContents: 'foo\n\nbase',
        surface,
      });

      try {
        setCaret(fixture.editor, 0, 3);
        await expectCallCount(calls, 1);
        await waitFor(() => predictionElements(fixture.container).length > 0, {
          timeout: PREDICT_TIMEOUT,
        });
        expect(
          predictionElements(fixture.container)[0]?.dataset.replacement
        ).toBe('');

        const tab = dispatchKey(fixture.content, 'Tab');
        expect(tab.defaultPrevented).toBe(true);
        expect(fixture.editor.getText()).toBe('foo // note\nbar');
      } finally {
        await fixture.cleanup();
      }
    });
  }

  test('a whole-line deletion strikes only the deleted line', async () => {
    const calls: PredictionCall[] = [];
    const provider: EditPredictProvider = {
      predict(request, context) {
        calls.push({ context, request });
        return Promise.resolve({
          edits: [
            {
              range: {
                start: { line: 0, character: 3 },
                end: { line: 0, character: 3 },
              },
              newText: ' // done',
            },
            {
              range: {
                start: { line: 1, character: 0 },
                end: { line: 2, character: 0 },
              },
              newText: '',
            },
          ],
          newCursor: { line: 0, character: 11 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents: 'foo\nbar\nbaz',
      editorOptions: { editPrediction: { provider } },
      surface: 'File',
    });

    try {
      setCaret(fixture.editor, 0, 3);
      await expectCallCount(calls, 1);
      await waitFor(() => predictionElements(fixture.container).length > 0, {
        timeout: PREDICT_TIMEOUT,
      });
      // The range {1,0}->{2,0} removes "bar" and its line break. Only "bar"
      // is struck through; column 0 of "baz", where the range ends, gets no
      // one-character mark.
      const strikes = Array.from(
        fixture.container.shadowRoot?.querySelectorAll<HTMLElement>(
          '[data-edit-prediction-deletion-range]'
        ) ?? []
      );
      expect(strikes).toHaveLength(1);
      expect(parseFloat(strikes[0]?.style.width ?? '0')).toBeGreaterThan(0);

      const tab = dispatchKey(fixture.content, 'Tab');
      expect(tab.defaultPrevented).toBe(true);
      expect(fixture.editor.getText()).toBe('foo // done\nbaz');
    } finally {
      await fixture.cleanup();
    }
  });

  test('does not accept a response when a virtualized edit is not previewed', async () => {
    const contents = Array.from(
      { length: 100 },
      (_, index) => `line ${index + 1}`
    ).join('\n');
    const calls: PredictionCall[] = [];
    const provider: EditPredictProvider = {
      predict(request, context) {
        calls.push({ context, request });
        return Promise.resolve({
          edits: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 6 },
              },
              newText: 'visible',
            },
            {
              range: {
                start: { line: 80, character: 0 },
                end: { line: 80, character: 7 },
              },
              newText: 'unseen',
            },
          ],
          newCursor: { line: 0, character: 0 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents,
      editorOptions: { editPrediction: { provider } },
      renderRange: {
        startingLine: 0,
        totalLines: 10,
        bufferAfter: 0,
        bufferBefore: 0,
      },
    });

    try {
      setCaret(fixture.editor, 0, 0);
      await expectCallCount(calls, 1);
      await wait(0);
      // The request only offers the ten rendered lines for editing, so the
      // response's line 80 edit is rejected and nothing is drawn: no ghost,
      // no strike for the visible group either. Tab then behaves as if no
      // prediction existed and indents.
      const [{ request }] = calls;
      const editableEndLine =
        request.excerptStartLine +
        request.excerptText.slice(0, request.editableRange.end).split('\n')
          .length -
        1;
      expect(request.excerptStartLine).toBe(0);
      expect(editableEndLine).toBe(9);
      expect(predictionElements(fixture.container)).toHaveLength(0);
      expect(
        fixture.container.shadowRoot?.querySelectorAll(
          '[data-edit-prediction-replacement-range]'
        )
      ).toHaveLength(0);

      const tab = dispatchKey(fixture.content, 'Tab');
      expect(tab.defaultPrevented).toBe(true);
      expect(fixture.editor.getText()).not.toContain('visible');
      expect(fixture.editor.getText()).not.toContain('unseen');
      expect(fixture.editor.getText().startsWith('  line 1\n')).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  test('clamps the editable range to renderable lines beside a collapsed hunk', async () => {
    const contents = Array.from({ length: 41 }, (_, index) =>
      index === 0 || index === 40
        ? `line ${index + 1} value`
        : `line ${index + 1}`
    ).join('\n');
    const calls: PredictionCall[] = [];
    const provider: EditPredictProvider = {
      predict(request, context) {
        calls.push({ context, request });
        return Promise.resolve({
          edits: [],
          newCursor: { line: 4, character: 0 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents,
      editorOptions: { editPrediction: { provider } },
      surface: 'FileDiff',
    });

    try {
      // Lines 5..35 sit in the collapsed gap between the two hunks; the caret
      // is on the last rendered line before it.
      setCaret(fixture.editor, 4, 0);
      await expectCallCount(calls, 1);
      const [{ request }] = calls;
      const excerptLines = request.excerptText.split('\n');
      const editableEndLine =
        request.excerptStartLine +
        request.excerptText.slice(0, request.editableRange.end).split('\n')
          .length -
        1;
      expect(request.excerptStartLine).toBe(0);
      expect(editableEndLine).toBe(4);
      // Context is not clamped: it still reaches past the collapsed region.
      expect(request.excerptStartLine + excerptLines.length - 1).toBe(40);
    } finally {
      await fixture.cleanup();
    }
  });

  test('makes no request while the caret row is outside the render window', async () => {
    const contents = Array.from(
      { length: 100 },
      (_, index) => `line ${index + 1}`
    ).join('\n');
    const calls: PredictionCall[] = [];
    const provider: EditPredictProvider = {
      predict(request, context) {
        calls.push({ context, request });
        return Promise.resolve({
          edits: [],
          newCursor: { line: 50, character: 0 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents,
      editorOptions: { editPrediction: { provider } },
      renderRange: {
        startingLine: 0,
        totalLines: 10,
        bufferAfter: 0,
        bufferBefore: 0,
      },
    });

    try {
      setCaret(fixture.editor, 50, 0);
      await wait(PREDICT_TIMEOUT);
      expect(calls).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  // A ten-line window over a hundred-line File with one prediction whose two
  // ghost lines sit on lines 0 and 5, both inside the window.
  async function createWindowedPredictionFixture(): Promise<{
    calls: PredictionCall[];
    contents: string;
    fixture: PredictionFixture;
    spacerHeights(): Array<[line: string | undefined, height: string]>;
  }> {
    const contents = Array.from(
      { length: 100 },
      (_, index) => `line ${index + 1}`
    ).join('\n');
    const calls: PredictionCall[] = [];
    const provider: EditPredictProvider = {
      predict(request, context) {
        calls.push({ context, request });
        return Promise.resolve({
          edits: [
            {
              range: {
                start: { line: 0, character: 6 },
                end: { line: 0, character: 6 },
              },
              newText: '\nghost();',
            },
            {
              range: {
                start: { line: 5, character: 6 },
                end: { line: 5, character: 6 },
              },
              newText: '\nghost();',
            },
          ],
          newCursor: { line: 1, character: 8 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents,
      editorOptions: { editPrediction: { provider } },
      renderRange: {
        startingLine: 0,
        totalLines: 10,
        bufferAfter: 0,
        bufferBefore: 0,
      },
    });
    return {
      calls,
      contents,
      fixture,
      spacerHeights: () =>
        Array.from(
          fixture.content.querySelectorAll<HTMLElement>(
            '[data-edit-prediction-spacer]'
          )
        ).map((element) => [
          element.dataset.line,
          element.style.getPropertyValue(
            '--diffs-edit-prediction-spacer-height'
          ),
        ]),
    };
  }

  test('hides a prediction while the render window drops one of its rows and redraws it when the row returns', async () => {
    const { calls, fixture, spacerHeights } =
      await createWindowedPredictionFixture();

    try {
      setCaret(fixture.editor, 0, 0);
      await expectCallCount(calls, 1);
      await waitFor(() => predictionElements(fixture.container).length === 2, {
        timeout: PREDICT_TIMEOUT,
      });
      expect(spacerHeights()).toEqual([
        ['1', '1lh'],
        ['6', '1lh'],
      ]);

      // Line 5 leaves the window: nothing is drawn, not even the visible
      // group, and no rows stay reserved.
      fixture.setRenderRange({
        startingLine: 0,
        totalLines: 3,
        bufferAfter: 0,
        bufferBefore: 0,
      });
      await waitFor(() => predictionElements(fixture.container).length === 0, {
        timeout: PREDICT_TIMEOUT,
      });
      expect(predictionElements(fixture.container)).toHaveLength(0);
      expect(
        fixture.container.shadowRoot?.querySelectorAll(
          '[data-edit-prediction-spacer]'
        )
      ).toHaveLength(0);

      // The stored prediction is redrawn from the same response once its rows
      // exist again, without asking the provider a second time.
      fixture.setRenderRange({
        startingLine: 0,
        totalLines: 10,
        bufferAfter: 0,
        bufferBefore: 0,
      });
      await waitFor(() => predictionElements(fixture.container).length === 2, {
        timeout: PREDICT_TIMEOUT,
      });
      expect(spacerHeights()).toEqual([
        ['1', '1lh'],
        ['6', '1lh'],
      ]);

      const tab = dispatchKey(fixture.content, 'Tab');
      expect(tab.defaultPrevented).toBe(true);
      expect(
        fixture.editor
          .getText()
          .startsWith(
            'line 1\nghost();\nline 2\nline 3\nline 4\nline 5\nline 6\nghost();\nline 7\n'
          )
      ).toBe(true);
      expect(calls).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  test('Escape discards a prediction hidden by the render window', async () => {
    const { calls, contents, fixture } =
      await createWindowedPredictionFixture();

    try {
      setCaret(fixture.editor, 0, 0);
      await expectCallCount(calls, 1);
      await waitFor(() => predictionElements(fixture.container).length === 2, {
        timeout: PREDICT_TIMEOUT,
      });

      fixture.setRenderRange({
        startingLine: 0,
        totalLines: 3,
        bufferAfter: 0,
        bufferBefore: 0,
      });
      await waitFor(() => predictionElements(fixture.container).length === 0, {
        timeout: PREDICT_TIMEOUT,
      });

      // Nothing is drawn, but the prediction is still stored, so Escape
      // belongs to it.
      const escape = dispatchKey(fixture.content, 'Escape');
      expect(escape.defaultPrevented).toBe(true);
      expect(fixture.editor.getText()).toBe(contents);

      fixture.setRenderRange({
        startingLine: 0,
        totalLines: 10,
        bufferAfter: 0,
        bufferBefore: 0,
      });
      await waitFor(
        () =>
          fixture.content.querySelectorAll(':scope > [data-line]').length ===
          10,
        { timeout: PREDICT_TIMEOUT }
      );
      await wait(0);
      expect(predictionElements(fixture.container)).toHaveLength(0);
      expect(
        fixture.container.shadowRoot?.querySelectorAll(
          '[data-edit-prediction-spacer]'
        )
      ).toHaveLength(0);
      expect(calls).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  test('split FileDiff grows the deletions column under multiline ghost text', async () => {
    const provider: EditPredictProvider = {
      predict() {
        return Promise.resolve({
          edits: [
            {
              range: {
                start: { line: 1, character: 7 },
                end: { line: 1, character: 7 },
              },
              newText: '\nghostOne();\nghostTwo();',
            },
          ],
          newCursor: { line: 3, character: 11 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents: 'const value = 1;\nnext();\nend();',
      editorOptions: { editPrediction: { provider } },
      surface: 'FileDiff',
    });

    try {
      setCaret(fixture.editor, 1, 7);
      await waitFor(() => predictionElements(fixture.container).length > 0, {
        timeout: PREDICT_TIMEOUT,
      });
      const shadowRoot = fixture.container.shadowRoot;
      const spacers = Array.from(
        shadowRoot?.querySelectorAll<HTMLElement>(
          '[data-edit-prediction-spacer]'
        ) ?? []
      );
      // The additions row and its gutter cell, plus the deletions row and its
      // gutter cell in the same grid track, all reserve the same two rows.
      expect(spacers).toHaveLength(4);
      expect(
        shadowRoot?.querySelectorAll(
          '[data-code][data-deletions] [data-edit-prediction-spacer]'
        )
      ).toHaveLength(2);
      for (const spacer of spacers) {
        expect(
          spacer.style.getPropertyValue('--diffs-edit-prediction-spacer-height')
        ).toBe('2lh');
      }

      dispatchKey(fixture.content, 'ArrowLeft');
      expect(
        shadowRoot?.querySelectorAll('[data-edit-prediction-spacer]')
      ).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  test('split FileDiff grows the buffer opposite a one-sided run, summing anchors', async () => {
    // x1..x3 are added lines: the deletions column shows one empty buffer
    // spanning their three tracks. Ghost text under x1 (one row) and x3 (two
    // rows) must both grow that buffer.
    const provider: EditPredictProvider = {
      predict() {
        return Promise.resolve({
          edits: [
            {
              range: {
                start: { line: 1, character: 5 },
                end: { line: 1, character: 5 },
              },
              newText: '\nghost();',
            },
            {
              range: {
                start: { line: 3, character: 5 },
                end: { line: 3, character: 5 },
              },
              newText: '\nghost();\nghost();',
            },
          ],
          newCursor: { line: 1, character: 5 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents: 'a();\nx1();\nx2();\nx3();\nb();\nc();',
      oldContents: 'a();\nb();\nc();',
      editorOptions: { editPrediction: { provider } },
      surface: 'FileDiff',
    });

    try {
      setCaret(fixture.editor, 1, 5);
      await waitFor(() => predictionElements(fixture.container).length > 0, {
        timeout: PREDICT_TIMEOUT,
      });
      const shadowRoot = fixture.container.shadowRoot;
      const spacerHeight = (selector: string) =>
        shadowRoot
          ?.querySelector<HTMLElement>(selector)
          ?.style.getPropertyValue('--diffs-edit-prediction-spacer-height');
      expect(
        spacerHeight(
          '[data-code]:not([data-deletions]) [data-line="2"][data-edit-prediction-spacer]'
        )
      ).toBe('1lh');
      expect(
        spacerHeight(
          '[data-code]:not([data-deletions]) [data-line="4"][data-edit-prediction-spacer]'
        )
      ).toBe('2lh');
      expect(
        spacerHeight(
          '[data-code][data-deletions] [data-content-buffer][data-buffer-size="3"][data-edit-prediction-spacer]'
        )
      ).toBe('3lh');
      expect(
        spacerHeight(
          '[data-code][data-deletions] [data-gutter-buffer][data-buffer-size="3"][data-edit-prediction-spacer]'
        )
      ).toBe('3lh');
    } finally {
      await fixture.cleanup();
    }
  });

  test('split FileDiff pairs the deletions row past a deletions-only run', async () => {
    // d1 and d2 exist only on the old side, so the additions column carries a
    // two-track buffer before b(). The partner for b() is the deletions b()
    // row, not one of the deleted lines.
    const provider: EditPredictProvider = {
      predict() {
        return Promise.resolve({
          edits: [
            {
              range: {
                start: { line: 1, character: 4 },
                end: { line: 1, character: 4 },
              },
              newText: '\nghost();',
            },
          ],
          newCursor: { line: 1, character: 4 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents: 'a();\nb();\nc();',
      oldContents: 'a();\nd1();\nd2();\nb();\nc();',
      editorOptions: { editPrediction: { provider } },
      surface: 'FileDiff',
    });

    try {
      setCaret(fixture.editor, 1, 4);
      await waitFor(() => predictionElements(fixture.container).length > 0, {
        timeout: PREDICT_TIMEOUT,
      });
      const deletionsSpacers = Array.from(
        fixture.container.shadowRoot?.querySelectorAll<HTMLElement>(
          '[data-code][data-deletions] [data-edit-prediction-spacer]'
        ) ?? []
      );
      expect(deletionsSpacers).toHaveLength(2);
      const [row] = deletionsSpacers.filter((element) =>
        element.matches('[data-line]')
      );
      expect(row?.textContent).toContain('b();');
      expect(
        row?.style.getPropertyValue('--diffs-edit-prediction-spacer-height')
      ).toBe('1lh');
    } finally {
      await fixture.cleanup();
    }
  });

  test('wrap mode redraws the masked suffix after a mid-line insertion', async () => {
    const contents = 'function value(items: CartItem[]): number {';
    const insertion = ', discount?: number';
    const character = 'function value(items: CartItem[]'.length;
    const provider: EditPredictProvider = {
      predict() {
        return Promise.resolve({
          edits: [
            {
              range: {
                start: { line: 0, character },
                end: { line: 0, character },
              },
              newText: insertion,
            },
          ],
          newCursor: { line: 0, character: character + insertion.length },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents,
      editorOptions: { editPrediction: { provider } },
      overflow: 'wrap',
      surface: 'File',
    });

    try {
      setCaret(fixture.editor, 0, character);
      await waitFor(() => predictionElements(fixture.container).length > 0, {
        timeout: PREDICT_TIMEOUT,
      });

      // The in-flow remainder is hidden behind the mask, so the ghost must
      // carry a copy of it or the rest of the line disappears until accept.
      const prediction = predictionElements(fixture.container)[0];
      expect(prediction.dataset.wrap).toBe('');
      expect(
        fixture.container.shadowRoot?.querySelector(
          '[data-edit-prediction-insertion-range]'
        )
      ).not.toBeNull();
      expect(
        prediction.querySelector('[data-edit-prediction-suffix]')?.textContent
      ).toBe('): number {');
      expect(
        prediction.querySelector('[data-edit-prediction-line]')?.textContent
      ).toBe(', discount?: number): number {');

      expect(dispatchKey(fixture.content, 'Tab').defaultPrevented).toBe(true);
      expect(fixture.editor.getText()).toBe(
        'function value(items: CartItem[], discount?: number): number {'
      );
    } finally {
      await fixture.cleanup();
    }
  });

  test('sizes wrap-mode ghost rows from the measured ghost text', async () => {
    // One predicted line with no line breaks that wraps onto three visual
    // lines: the first shares the anchor row, so two rows are reserved.
    const provider: EditPredictProvider = {
      predict() {
        return Promise.resolve({
          edits: [
            {
              range: {
                start: { line: 0, character: 5 },
                end: { line: 0, character: 5 },
              },
              newText: ' + aVeryLongPredictedExpressionThatWraps()',
            },
          ],
          newCursor: { line: 0, character: 47 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents: 'value',
      editorOptions: { editPrediction: { provider } },
      overflow: 'wrap',
    });
    const elementPrototype =
      fixture.content.ownerDocument.defaultView!.HTMLElement.prototype;
    const getBoundingClientRect = elementPrototype.getBoundingClientRect;
    // jsdom does no layout; report three line heights for the ghost element.
    elementPrototype.getBoundingClientRect = function () {
      if (this.dataset.editPrediction !== undefined) {
        return {
          bottom: 60,
          height: 60,
          left: 0,
          right: 100,
          top: 0,
          width: 100,
          x: 0,
          y: 0,
          toJSON() {},
        };
      }
      return getBoundingClientRect.call(this);
    };

    try {
      setCaret(fixture.editor, 0, 5);
      await waitFor(() => predictionElements(fixture.container).length > 0, {
        timeout: PREDICT_TIMEOUT,
      });
      expect(
        fixture.content
          .querySelector<HTMLElement>('[data-line="1"]')
          ?.style.getPropertyValue('--diffs-edit-prediction-spacer-height')
      ).toBe('2lh');
      // The measuring probe never stays in the overlay.
      expect(predictionElements(fixture.container)).toHaveLength(1);
    } finally {
      elementPrototype.getBoundingClientRect = getBoundingClientRect;
      await fixture.cleanup();
    }
  });

  test.each([
    { anchorCharacter: 5, expectedRows: '1lh', visualLine: 'first' },
    { anchorCharacter: 12, expectedRows: '2lh', visualLine: 'second' },
  ])(
    'wrap mode subtracts the anchor rows below the caret on its $visualLine visual line',
    async ({ anchorCharacter, expectedRows }) => {
      // The anchor line wraps at ten columns onto two visual lines; the ghost
      // text measures three. Reserved rows = 3 - (2 - caret visual line).
      const provider: EditPredictProvider = {
        predict() {
          return Promise.resolve({
            edits: [
              {
                range: {
                  start: { line: 0, character: anchorCharacter },
                  end: { line: 0, character: anchorCharacter },
                },
                newText: ' + predictedExpression()',
              },
            ],
            newCursor: { line: 0, character: anchorCharacter + 24 },
          });
        },
      };
      const fixture = await createPredictionFixture({
        contents: 'abcdefghijklmno\nnext',
        editorOptions: { editPrediction: { provider } },
        overflow: 'wrap',
      });
      const view = fixture.content.ownerDocument.defaultView;
      if (view == null) {
        throw new Error('editor content is not attached to a window');
      }
      const restoreMeasurement = installWrapMeasurement(
        view,
        10,
        3 * LINE_HEIGHT
      );

      try {
        setCaret(fixture.editor, 0, anchorCharacter);
        await waitFor(() => predictionElements(fixture.container).length > 0, {
          timeout: PREDICT_TIMEOUT,
        });
        expect(
          fixture.content
            .querySelector<HTMLElement>('[data-line="1"]')
            ?.style.getPropertyValue('--diffs-edit-prediction-spacer-height')
        ).toBe(expectedRows);
      } finally {
        restoreMeasurement();
        await fixture.cleanup();
      }
    }
  );

  test('typing aborts an in-flight prediction and ignores its response', async () => {
    const calls: PredictionCall[] = [];
    const pending = createDeferred<EditPredictResponse>();
    const provider: EditPredictProvider = {
      predict(request, context) {
        calls.push({ context, request });
        return pending.promise;
      },
    };
    const fixture = await createPredictionFixture({
      contents: 'a',
      editorOptions: { editPrediction: { provider } },
    });

    try {
      setCaret(fixture.editor, 0, 1);
      dispatchTextInput(fixture.content, 'b');
      await expectCallCount(calls, 1);
      expect(calls[0].context.signal.aborted).toBe(false);

      dispatchTextInput(fixture.content, 'c');
      expect(calls[0].context.signal.aborted).toBe(true);
      pending.resolve({
        edits: [
          {
            range: {
              start: { line: 0, character: 2 },
              end: { line: 0, character: 2 },
            },
            newText: ' stale',
          },
        ],
        newCursor: { line: 0, character: 8 },
      });
      await wait(0);
      await wait(0);

      expect(fixture.editor.getText()).toBe('abc');
      expect(predictionElements(fixture.container)).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  test('cursor movement aborts an in-flight prediction', async () => {
    const calls: PredictionCall[] = [];
    const pending = createDeferred<EditPredictResponse>();
    const provider: EditPredictProvider = {
      predict(request, context) {
        calls.push({ context, request });
        return pending.promise;
      },
    };
    const fixture = await createPredictionFixture({
      contents: 'abc',
      editorOptions: { editPrediction: { provider } },
    });

    try {
      setCaret(fixture.editor, 0, 3);
      dispatchTextInput(fixture.content, 'd');
      await expectCallCount(calls, 1);

      dispatchKey(fixture.content, 'ArrowLeft');
      expect(calls[0].context.signal.aborted).toBe(true);
      pending.resolve({
        edits: [
          {
            range: {
              start: { line: 0, character: 4 },
              end: { line: 0, character: 4 },
            },
            newText: ' stale',
          },
        ],
        newCursor: { line: 0, character: 10 },
      });
      await wait(0);

      expect(fixture.editor.getText()).toBe('abcd');
      expect(predictionElements(fixture.container)).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  test('rejects a prediction range that splits a surrogate pair', async () => {
    const calls: PredictionCall[] = [];
    const provider: EditPredictProvider = {
      predict(request, context) {
        calls.push({ context, request });
        return Promise.resolve({
          edits: [
            {
              range: {
                start: { line: 0, character: 1 },
                end: { line: 0, character: 1 },
              },
              newText: '!',
            },
          ],
          newCursor: { line: 0, character: 3 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents: '😀x',
      editorOptions: { editPrediction: { provider } },
    });

    try {
      setCaret(fixture.editor, 0, 3);
      await expectCallCount(calls, 1);
      await wait(0);
      expect(predictionElements(fixture.container)).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  test('Escape discards a prediction without changing the document', async () => {
    const provider: EditPredictProvider = {
      predict() {
        return Promise.resolve({
          edits: [
            {
              range: {
                start: { line: 0, character: 1 },
                end: { line: 0, character: 1 },
              },
              newText: '!',
            },
          ],
          newCursor: { line: 0, character: 2 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents: 'a',
      editorOptions: { editPrediction: { provider } },
    });

    try {
      setCaret(fixture.editor, 0, 1);
      await waitFor(() => hasVisiblePrediction(fixture.container), {
        timeout: PREDICT_TIMEOUT,
      });

      const escape = dispatchKey(fixture.content, 'Escape');
      expect(escape.defaultPrevented).toBe(true);
      expect(predictionElements(fixture.container)).toHaveLength(0);
      expect(fixture.editor.getText()).toBe('a');
    } finally {
      await fixture.cleanup();
    }
  });

  test('an empty response leaves Tab available to the editor', async () => {
    const calls: PredictionCall[] = [];
    const provider: EditPredictProvider = {
      predict(request, context) {
        calls.push({ context, request });
        return Promise.resolve({
          edits: [],
          newCursor: { line: 0, character: 1 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents: 'a',
      editorOptions: { editPrediction: { provider } },
    });

    try {
      setCaret(fixture.editor, 0, 1);
      await expectCallCount(calls, 1);
      await wait(0);
      expect(predictionElements(fixture.container)).toHaveLength(0);

      const tab = dispatchKey(fixture.content, 'Tab');
      expect(tab.defaultPrevented).toBe(true);
      expect(fixture.editor.getText()).not.toBe('a');
    } finally {
      await fixture.cleanup();
    }
  });

  test.each([
    {
      eol: 'LF',
      contents: 'x\n',
      expected:
        '--- a/src/edit.ts\n+++ b/src/edit.ts\n@@ -1,1 +1,1 @@\n-x\n+xa',
    },
    {
      eol: 'CRLF',
      contents: 'x\r\n',
      expected:
        '--- a/src/edit.ts\n+++ b/src/edit.ts\n@@ -1,1 +1,1 @@\n-x\n+xa',
    },
    {
      eol: 'CR',
      contents: 'x\r',
      expected:
        '--- a/src/edit.ts\n+++ b/src/edit.ts\n@@ -1,1 +1,1 @@\n-x\n+xa',
    },
    {
      eol: 'LF with following context',
      contents: 'x\nnext\n',
      expected:
        '--- a/src/edit.ts\n+++ b/src/edit.ts\n@@ -1,2 +1,2 @@\n-x\n+xa\n next',
    },
  ])(
    'excludes the trailing $eol sentinel from history hunk line counts',
    ({ contents, expected }) => {
      const document = new TextDocument('src/edit.ts', contents, 'plain');
      const change = document.applyResolvedEdits([
        { start: 1, end: 1, text: 'a' },
      ]);
      if (change === undefined) {
        throw new Error('Expected the edit to change the document');
      }
      const transaction = getTextDocumentChangeTransaction(change);
      if (transaction === undefined) {
        throw new Error('Expected edit prediction transaction metadata');
      }

      const record = recordEditPrediction(
        [],
        'src/edit.ts',
        document,
        transaction,
        'user'
      )[0];

      expect(record?.hunk).toBe(expected);
    }
  );

  test('Shift+Tab runs outdent instead of accepting a prediction', async () => {
    const calls: PredictionCall[] = [];
    const provider: EditPredictProvider = {
      predict(request, context) {
        calls.push({ context, request });
        return Promise.resolve({
          edits: [
            {
              range: {
                start: { line: 0, character: 3 },
                end: { line: 0, character: 3 },
              },
              newText: '!',
            },
          ],
          newCursor: { line: 0, character: 4 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents: '  a',
      editorOptions: { editPrediction: { provider } },
    });

    try {
      setCaret(fixture.editor, 0, 3);
      await expectCallCount(calls, 1);
      await waitFor(() => predictionElements(fixture.container).length > 0, {
        timeout: PREDICT_TIMEOUT,
      });

      const tab = dispatchKey(fixture.content, 'Tab', { shiftKey: true });
      expect(tab.defaultPrevented).toBe(true);
      expect(fixture.editor.getText()).toBe('a');
      expect(fixture.editor.getText()).not.toContain('!');
    } finally {
      await fixture.cleanup();
    }
  });

  test('coalesces nearby user edits and caps history at ten entries', async () => {
    const calls: PredictionCall[] = [];
    const provider: EditPredictProvider = {
      predict(request, context) {
        calls.push({ context, request });
        const character = request.cursorOffsetInExcerpt;
        return Promise.resolve({
          edits: [
            {
              range: {
                start: { line: 0, character },
                end: { line: 0, character },
              },
              newText: 'p',
            },
          ],
          newCursor: { line: 0, character: character + 1 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents: 'x',
      editorOptions: { editPrediction: { provider } },
    });

    try {
      setCaret(fixture.editor, 0, 1);
      dispatchTextInput(fixture.content, 'a');
      await expectCallCount(calls, 1);
      dispatchTextInput(fixture.content, 'b');
      await expectCallCount(calls, 2);

      expect(calls[1].request.editHistory).toHaveLength(1);
      expect(calls[1].request.editHistory[0]?.source).toBe('user');
      expect(calls[1].request.editHistory[0]?.diff).toContain('+xab');

      for (let count = 3; count <= 12; count++) {
        if (count % 2 === 1) {
          await waitFor(
            () => predictionElements(fixture.container).length > 0,
            { timeout: PREDICT_TIMEOUT }
          );
          expect(dispatchKey(fixture.content, 'Tab').defaultPrevented).toBe(
            true
          );
        } else {
          dispatchTextInput(fixture.content, 'u');
        }
        await expectCallCount(calls, count);
      }

      expect(calls[11].request.editHistory.map(({ source }) => source)).toEqual(
        [
          'prediction',
          'user',
          'prediction',
          'user',
          'prediction',
          'user',
          'prediction',
          'user',
          'prediction',
          'user',
        ]
      );
    } finally {
      await fixture.cleanup();
    }
  });

  test('removes an immediately undone user edit and records its redo', async () => {
    const calls: PredictionCall[] = [];
    const provider: EditPredictProvider = {
      predict(request, context) {
        calls.push({ context, request });
        return Promise.resolve({
          edits: [],
          newCursor: { line: 0, character: 2 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents: 'x',
      editorOptions: { editPrediction: { provider } },
    });

    try {
      setCaret(fixture.editor, 0, 1);
      dispatchTextInput(fixture.content, 'a');
      await expectCallCount(calls, 1);
      expect(calls[0].request.editHistory[0]?.diff).toContain('+xa');

      fixture.editor.undo();
      await expectCallCount(calls, 2);
      expect(calls[1].request.editHistory).toHaveLength(0);

      fixture.editor.redo();
      await expectCallCount(calls, 3);
      expect(calls[2].request.editHistory).toHaveLength(1);
      expect(calls[2].request.editHistory[0]?.diff).toContain('+xa');
    } finally {
      await fixture.cleanup();
    }
  });

  test.each([
    {
      name: 'the File name changes',
      replacement: {
        contents: 'fresh',
        name: 'src/replacement.ts',
      },
      surface: 'File',
    },
    {
      name: 'the FileDiff base changes',
      replacement: {
        contents: 'fresh',
        name: undefined,
        oldContents: 'unrelated base',
      },
      surface: 'FileDiff',
    },
  ] as const)(
    'clears prediction history when $name',
    async ({ replacement, surface }) => {
      const calls: PredictionCall[] = [];
      const provider: EditPredictProvider = {
        predict(request, context) {
          calls.push({ context, request });
          return Promise.resolve({
            edits: [],
            newCursor: { line: 0, character: 0 },
          });
        },
      };
      const fixture = await createPredictionFixture({
        contents: 'value',
        editorOptions: { editPrediction: { provider } },
        surface,
      });

      try {
        setCaret(fixture.editor, 0, 5);
        dispatchTextInput(fixture.content, '!');
        await expectCallCount(calls, 1);
        expect(calls[0].request.editHistory).toHaveLength(1);
        expect(calls[0].request.editHistory[0]?.diff).toContain('+value!');

        fixture.replaceExternalDocument(replacement);
        await waitFor(() => fixture.editor.getText() === replacement.contents, {
          timeout: PREDICT_TIMEOUT,
        });

        setCaret(fixture.editor, 0, replacement.contents.length);
        await expectCallCount(calls, 2);
        expect(calls[1].request.path).toBe(replacement.name ?? FILE_NAME);
        expect(calls[1].request.editHistory).toHaveLength(0);
      } finally {
        await fixture.cleanup();
      }
    }
  );

  test('keeps subtle predictions hidden and unavailable before reveal', async () => {
    const calls: PredictionCall[] = [];
    const provider: EditPredictProvider = {
      predict(request, context) {
        calls.push({ context, request });
        return Promise.resolve({
          edits: [
            {
              range: {
                start: { line: 0, character: 2 },
                end: { line: 0, character: 2 },
              },
              newText: '!',
            },
          ],
          newCursor: { line: 0, character: 3 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents: 'a',
      editorOptions: {
        editPrediction: { mode: 'subtle', provider },
      },
    });

    try {
      setCaret(fixture.editor, 0, 1);
      dispatchTextInput(fixture.content, 'b');
      await expectCallCount(calls, 1);
      await wait(0);

      expect(hasVisiblePrediction(fixture.container)).toBe(false);
      expect(fixture.editor.getText()).toBe('ab');

      const tab = dispatchKey(fixture.content, 'Tab');
      expect(tab.defaultPrevented).toBe(true);
      expect(fixture.editor.getText()).toBe('ab  ');
      expect(fixture.editor.getText()).not.toContain('!');
    } finally {
      await fixture.cleanup();
    }
  });

  test('accepts a revealed subtle prediction with plain Tab', async () => {
    const calls: PredictionCall[] = [];
    const provider: EditPredictProvider = {
      predict(request, context) {
        calls.push({ context, request });
        return Promise.resolve({
          edits: [
            {
              range: {
                start: { line: 0, character: 1 },
                end: { line: 0, character: 1 },
              },
              newText: '!',
            },
          ],
          newCursor: { line: 0, character: 2 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents: 'a',
      editorOptions: {
        editPrediction: { mode: 'subtle', provider },
      },
    });

    try {
      setCaret(fixture.editor, 0, 1);
      dispatchKey(fixture.content, 'Alt', { altKey: true });
      await waitFor(() => hasVisiblePrediction(fixture.container), {
        timeout: PREDICT_TIMEOUT,
      });

      dispatchKey(fixture.content, 'Alt', {}, 'keyup');
      expect(hasVisiblePrediction(fixture.container)).toBe(true);

      const tab = dispatchKey(fixture.content, 'Tab');
      expect(tab.defaultPrevented).toBe(true);
      expect(fixture.editor.getText()).toBe('a!');

      await expectCallCount(calls, 2);
      await wait(0);
      expect(hasVisiblePrediction(fixture.container)).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  test('toggles a subtle prediction without discarding it', async () => {
    const calls: PredictionCall[] = [];
    const provider: EditPredictProvider = {
      predict(request, context) {
        calls.push({ context, request });
        return Promise.resolve({
          edits: [
            {
              range: {
                start: { line: 0, character: 1 },
                end: { line: 0, character: 1 },
              },
              newText: '!',
            },
          ],
          newCursor: { line: 0, character: 2 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents: 'a',
      editorOptions: {
        editPrediction: { mode: 'subtle', provider },
      },
    });

    try {
      setCaret(fixture.editor, 0, 1);
      dispatchKey(fixture.content, 'Alt', { altKey: true });
      await waitFor(() => hasVisiblePrediction(fixture.container), {
        timeout: PREDICT_TIMEOUT,
      });
      await expectCallCount(calls, 1);

      dispatchKey(fixture.content, 'Alt', {
        altKey: true,
        repeat: true,
      });
      expect(hasVisiblePrediction(fixture.container)).toBe(true);

      dispatchKey(fixture.content, 'Alt', {}, 'keyup');
      dispatchKey(fixture.content, 'Alt', { altKey: true });
      expect(hasVisiblePrediction(fixture.container)).toBe(false);
      expect(calls).toHaveLength(1);
      expect(fixture.editor.getText()).toBe('a');

      dispatchKey(fixture.content, 'Alt', {}, 'keyup');
      dispatchKey(fixture.content, 'Alt', { altKey: true });
      expect(hasVisiblePrediction(fixture.container)).toBe(true);
      expect(calls).toHaveLength(1);

      const escape = dispatchKey(fixture.content, 'Escape');
      expect(escape.defaultPrevented).toBe(true);
      expect(predictionElements(fixture.container)).toHaveLength(0);

      dispatchKey(fixture.content, 'Alt', {}, 'keyup');
      dispatchKey(fixture.content, 'Alt', { altKey: true });
      await wait(0);
      expect(hasVisiblePrediction(fixture.container)).toBe(false);
      expect(calls).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  const filterCases: Array<{
    allowed: boolean;
    name: string;
    options: Omit<
      NonNullable<
        EditorOptions<EditorType, undefined, undefined>['editPrediction']
      >,
      'provider'
    >;
  }> = [
    {
      allowed: true,
      name: 'exact-string include allows the path',
      options: { include: [FILE_NAME] },
    },
    {
      allowed: true,
      name: 'regular-expression include allows the path',
      options: { include: [/\.ts$/] },
    },
    {
      allowed: true,
      name: 'glob include allows the path',
      options: { include: ['**/*.ts'] },
    },
    {
      allowed: false,
      name: 'an unmatched include blocks the path',
      options: { include: ['src/other.ts'] },
    },
    {
      allowed: false,
      name: 'exact-string exclude overrides an include',
      options: { include: [FILE_NAME], exclude: [FILE_NAME] },
    },
    {
      allowed: false,
      name: 'regular-expression exclude overrides an include',
      options: { include: [FILE_NAME], exclude: [/edit\.ts$/] },
    },
  ];

  for (const { allowed, name, options } of filterCases) {
    test(name, async () => {
      const calls: PredictionCall[] = [];
      const provider: EditPredictProvider = {
        predict(request, context) {
          calls.push({ context, request });
          return Promise.resolve({
            edits: [],
            newCursor: { line: 0, character: 2 },
          });
        },
      };
      const fixture = await createPredictionFixture({
        contents: 'a',
        editorOptions: {
          editPrediction: { ...options, provider },
        },
      });

      try {
        jest.useFakeTimers();
        setCaret(fixture.editor, 0, 1);
        dispatchTextInput(fixture.content, 'b');
        jest.advanceTimersByTime(EDIT_PREDICTION_DEBOUNCE_MS);
        expect(calls).toHaveLength(allowed ? 1 : 0);
      } finally {
        jest.useRealTimers();
        await fixture.cleanup();
      }
    });
  }

  test('reuses a frozen global regular-expression include', async () => {
    const calls: PredictionCall[] = [];
    const include = Object.freeze(/\.ts$/g);
    const provider: EditPredictProvider = {
      predict(request, context) {
        calls.push({ context, request });
        return Promise.resolve({
          edits: [],
          newCursor: { line: 0, character: request.cursorOffsetInExcerpt },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents: 'a',
      editorOptions: { editPrediction: { include: [include], provider } },
    });

    try {
      setCaret(fixture.editor, 0, 1);
      dispatchTextInput(fixture.content, 'b');
      await expectCallCount(calls, 1);
      dispatchTextInput(fixture.content, 'c');
      await expectCallCount(calls, 2);
      expect(include.lastIndex).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });
});
