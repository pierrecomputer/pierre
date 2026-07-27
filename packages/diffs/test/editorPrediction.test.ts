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
import { TextDocument } from '../src/editor/textDocument';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
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
  editor: Editor<undefined>;
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
  editorOptions,
  name = FILE_NAME,
  surface = 'File',
}: {
  contents: string;
  editorOptions: EditorOptions<undefined>;
  name?: string;
  surface?: Surface;
}): Promise<PredictionFixture> {
  const dom = installDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = new Editor<undefined>(editorOptions);
  let cleanUpSurface: () => void;

  if (surface === 'File') {
    const file = new File<undefined>({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
    });
    file.render({
      file: { name, contents },
      fileContainer: container,
      forceRender: true,
    });
    editor.edit(file);
    cleanUpSurface = () => file.cleanUp();
  } else {
    const fileDiff = new FileDiff<undefined>({
      disableFileHeader: true,
      diffStyle: 'split',
      theme: DEFAULT_THEMES,
    });
    fileDiff.render({
      oldFile: { name, contents: contents.replaceAll('value', 'previous') },
      newFile: { name, contents },
      fileContainer: container,
      forceRender: true,
    });
    editor.edit(fileDiff);
    cleanUpSurface = () => fileDiff.cleanUp();
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
  };
}

function setCaret(
  editor: Editor<undefined>,
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
          onChange(file) {
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
        expect(fixture.editor.getState().selections).toEqual([
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
  }

  test('reserves and clears space for a multiline FileDiff prediction at EOF', async () => {
    const provider: EditPredictProvider = {
      predict() {
        return Promise.resolve({
          edits: [
            {
              range: {
                start: { line: 0, character: 5 },
                end: { line: 0, character: 5 },
              },
              newText: '\nnext',
            },
          ],
          newCursor: { line: 1, character: 4 },
        });
      },
    };
    const fixture = await createPredictionFixture({
      contents: 'value',
      editorOptions: { editPrediction: { provider } },
      surface: 'FileDiff',
    });
    const elementPrototype =
      fixture.content.ownerDocument.defaultView!.HTMLElement.prototype;
    const getBoundingClientRect = elementPrototype.getBoundingClientRect;
    elementPrototype.getBoundingClientRect = function () {
      if (this.dataset.code !== undefined) {
        return {
          bottom: 20,
          height: 20,
          left: 0,
          right: 100,
          top: 0,
          width: 100,
          x: 0,
          y: 0,
          toJSON() {},
        };
      }
      if (this.dataset.editPrediction !== undefined) {
        return {
          bottom: 40,
          height: 40,
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

      expect(fixture.content.style.paddingBlockEnd).toBe('20px');

      dispatchKey(fixture.content, 'ArrowLeft');
      expect(fixture.content.style.paddingBlockEnd).toBe('');
    } finally {
      elementPrototype.getBoundingClientRect = getBoundingClientRect;
      await fixture.cleanup();
    }
  });

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

  test('subtle predictions are visible only while Alt is held', async () => {
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

      dispatchKey(fixture.content, 'Alt', { altKey: true });
      await waitFor(() => hasVisiblePrediction(fixture.container), {
        timeout: PREDICT_TIMEOUT,
      });
      expect(hasVisiblePrediction(fixture.container)).toBe(true);
      expect(fixture.editor.getText()).toBe('ab');

      dispatchKey(fixture.content, 'Alt', {}, 'keyup');
      await waitFor(() => !hasVisiblePrediction(fixture.container), {
        timeout: PREDICT_TIMEOUT,
      });
      expect(hasVisiblePrediction(fixture.container)).toBe(false);

      const tab = dispatchKey(fixture.content, 'Tab');
      expect(tab.defaultPrevented).toBe(true);
      expect(fixture.editor.getText()).toBe('ab  ');
      expect(fixture.editor.getText()).not.toContain('!');
    } finally {
      await fixture.cleanup();
    }
  });

  test('accepts a subtle prediction with Alt+Tab', async () => {
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

      const tab = dispatchKey(fixture.content, 'Tab', { altKey: true });
      expect(tab.defaultPrevented).toBe(true);
      expect(fixture.editor.getText()).toBe('a!');
    } finally {
      await fixture.cleanup();
    }
  });

  const filterCases: Array<{
    allowed: boolean;
    name: string;
    options: Omit<
      NonNullable<EditorOptions<undefined>['editPrediction']>,
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
