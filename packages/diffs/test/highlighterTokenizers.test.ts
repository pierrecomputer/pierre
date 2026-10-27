import { LiveTokenizer } from '@pierre/highlights';
import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import {
  TextDocument,
  type TextDocumentChange,
} from '../src/editor/textDocument';
import type { TextEdit } from '../src/editor/types';
import { lineAfterChange } from '../src/highlighter/linesAfterChange';
import {
  createHighlighter,
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { CodeToTokenTransformStream } from '../src/shiki-stream';
import type {
  HighlightedToken,
  HighlighterTypes,
  RenderRange,
  ThemedToken,
} from '../src/types';

// Each test loads its backend fresh: only one highlighter type can be loaded.
beforeEach(disposeHighlighter);
afterAll(disposeHighlighter);

describe('backend tokenizers', () => {
  for (const preferredHighlighter of [
    'shiki-js',
    'shiki-wasm',
    'highlights',
  ] as const) {
    test(`${preferredHighlighter} switches editor tokenizers to a resolved theme`, async () => {
      const highlighter = await createHighlighter(preferredHighlighter);
      await highlighter.themeResolver.resolveThemes([
        'pierre-dark',
        'pierre-light',
      ]);
      await highlighter.loadLanguages(['typescript']);
      const document = new TextDocument(
        'test.ts',
        'const value = 1;',
        'typescript'
      );
      // tokenize() returns the lines finished within its synchronous time
      // budget; the rest arrive through onDeferTokenize, as in the editor
      const deferred = new Map<number, HighlightedToken[]>();
      const tokenizer = highlighter.createEditorTokenizer({
        textDocument: document,
        theme: 'pierre-dark',
        onDeferTokenize: (lines) => {
          for (const [line, tokens] of lines) deferred.set(line, tokens);
        },
      });
      try {
        for (const theme of ['pierre-light', 'pierre-dark']) {
          tokenizer.setTheme(theme);
          deferred.clear();
          const change = document.applyEdits([
            {
              range: {
                start: { line: 0, character: 14 },
                end: { line: 0, character: 15 },
              },
              newText: theme === 'pierre-light' ? '2' : '3',
            },
          ]);
          let tokens = tokenizer.tokenize(change!).get(0) ?? deferred.get(0);
          for (let i = 0; tokens == null && i < 200; i++) {
            await new Promise((resolve) => setTimeout(resolve, 1));
            tokens = deferred.get(0);
          }
          const expected = highlighter.codeToTokens(document.getText(), {
            lang: 'typescript',
            theme,
          });
          expect(tokens?.map((token) => token[2]).join('')).toBe(
            document.getText()
          );
          expect(tokens?.[0]?.[1]).toBe(expected.tokens[0][0].color);
        }
      } finally {
        tokenizer.dispose();
        highlighter.dispose();
      }
    });

    test(`${preferredHighlighter} disposes cancelled and aborted stream tokenizers`, async () => {
      const highlighter = await getSharedHighlighter({
        preferredHighlighter,
        themes: ['pierre-dark'],
        langs: ['typescript'],
      });
      for (const action of ['cancel', 'abort'] as const) {
        const stream = new CodeToTokenTransformStream({
          highlighter,
          lang: 'typescript',
          theme: 'pierre-dark',
        });
        const dispose = spyOn(stream.tokenizer, 'dispose');
        try {
          if (action === 'cancel') await stream.readable.cancel();
          else await stream.writable.abort();
          expect(dispose).toHaveBeenCalledTimes(1);
        } finally {
          dispose.mockRestore();
          stream.tokenizer.dispose();
        }
      }
    });

    test(`${preferredHighlighter} applies UTF-16 edits, multiline state and undo`, async () => {
      const highlighter = await getSharedHighlighter({
        preferredHighlighter,
        themes: ['pierre-dark'],
        langs: ['typescript'],
      });
      const document = new TextDocument(
        'test.ts',
        'const emoji = "🚀";\r\nconst value = 1;\r\nvalue;',
        'typescript'
      );
      const tokenizer = highlighter.createEditorTokenizer({
        textDocument: document,
        theme: 'pierre-dark',
        onDeferTokenize: () => {},
      });
      try {
        const change = document.applyEdits([
          {
            range: {
              start: { line: 0, character: 15 },
              end: { line: 0, character: 17 },
            },
            newText: '🌍',
          },
          {
            range: {
              start: { line: 1, character: 0 },
              end: { line: 1, character: 0 },
            },
            newText: '/*\r\n',
          },
          {
            range: {
              start: { line: 2, character: 6 },
              end: { line: 2, character: 6 },
            },
            newText: '\r\n*/',
          },
        ]);
        expect(change).toBeDefined();
        const lines = tokenizer.tokenize(change!);
        const expected = highlighter.codeToTokens(document.getText(), {
          lang: 'typescript',
          theme: 'pierre-dark',
        });
        expect(
          lines
            .get(0)
            ?.map((token) => token[2])
            .join('')
        ).toBe('const emoji = "🌍";');
        for (const [line, tokens] of lines) {
          expect(tokens.map((token) => token[2]).join('')).toBe(
            document.getLineText(line)
          );
          for (const [offset, , content] of tokens)
            expect(
              document.getLineText(line).slice(offset, offset + content.length)
            ).toBe(content);
        }
        const ranges = tokenizer.getStringCommentRegexpRangesInLine(2);
        expect(ranges?.[0]?.[0]).toBe(0);
        expect(ranges?.at(-1)?.[1]).toBe(document.getLineText(2).length);
        expect(lines.get(2)?.[0]?.[1]).toBe(expected.tokens[2][0].color);
        const undo = document.undo();
        expect(undo).toBeDefined();
        const undone = tokenizer.tokenize(undo![0]);
        expect(
          undone
            .get(0)
            ?.map((token) => token[2])
            .join('')
        ).toBe('const emoji = "🚀";');
        expect(tokenizer.getStringCommentRegexpRangesInLine(1) ?? []).toEqual(
          []
        );
      } finally {
        tokenizer.dispose();
      }
    });

    test(`${preferredHighlighter} recalls partial streamed tokens and preserves dual themes`, async () => {
      const highlighter = await getSharedHighlighter({
        preferredHighlighter,
        themes: ['pierre-dark', 'pierre-light'],
        langs: ['typescript'],
      });
      const tokenizer = highlighter.createStreamTokenizer({
        lang: 'typescript',
        themes: { dark: 'pierre-dark', light: 'pierre-light' },
        defaultColor: false,
        cssVariablePrefix: '--diffs-token-',
      });
      const chunks = [
        'const text = "\uD83D',
        '\uDE80";\n/*',
        ' comment\n',
        'still comment */\ntext;',
      ];
      const tokens: ThemedToken[] = [];
      let recalls = 0;
      try {
        for (const chunk of chunks) {
          const result = await tokenizer.enqueue(chunk);
          recalls += result.recall;
          tokens.splice(
            tokens.length - result.recall,
            result.recall,
            ...result.stable,
            ...result.unstable
          );
        }
        expect(tokens.map((token) => token.content).join('')).toBe(
          chunks.join('')
        );
        expect(recalls).toBeGreaterThan(0);
        const themed = tokens.find((token) => token.content.includes('const'));
        expect(themed?.htmlStyle?.['--diffs-token-dark']).toBeDefined();
        expect(themed?.htmlStyle?.['--diffs-token-light']).toBeDefined();
        const source = chunks.join('');
        for (const token of tokens)
          expect(
            source.slice(token.offset, token.offset + token.content.length)
          ).toBe(token.content);
        tokenizer.close();
      } finally {
        tokenizer.dispose();
      }
    });

    test(`${preferredHighlighter} flushes the final line without recalls`, async () => {
      const highlighter = await getSharedHighlighter({
        preferredHighlighter,
        themes: ['pierre-dark'],
        langs: ['typescript'],
      });
      const chunks = [
        'const answer',
        ' = 42;\r',
        '\nanswer\r',
        ';\n',
        'answer\r',
      ];
      const stream = new ReadableStream<string>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }).pipeThrough(
        new CodeToTokenTransformStream({
          highlighter,
          lang: 'typescript',
          theme: 'pierre-dark',
        })
      );
      let source = '';
      for await (const token of stream) {
        expect('recall' in token).toBe(false);
        if ('content' in token) source += token.content;
      }
      expect(source).toBe(chunks.join(''));
    });

    test(`${preferredHighlighter} ignores an undefined theme key beside the selected one`, async () => {
      const highlighter = await getSharedHighlighter({
        preferredHighlighter,
        themes: ['pierre-dark', 'pierre-light'],
        langs: ['typescript'],
      });
      const code = 'const value = 1;';
      // FileStream forwards both keys and clears the unused one.
      const single = {
        lang: 'typescript',
        theme: 'pierre-dark',
        themes: undefined,
      };
      const dual = {
        lang: 'typescript',
        theme: undefined,
        themes: { dark: 'pierre-dark', light: 'pierre-light' },
      };
      expect(
        highlighter.codeToTokens(code, single).tokens[0].length
      ).toBeGreaterThan(1);
      expect(
        highlighter.codeToTokens(code, dual).tokens[0].length
      ).toBeGreaterThan(1);
      for (const options of [single, dual]) {
        const stream = new CodeToTokenTransformStream({
          highlighter,
          ...options,
        });
        try {
          const { unstable } = await stream.tokenizer.enqueue(code);
          expect(unstable.map((token) => token.content).join('')).toBe(code);
        } finally {
          stream.tokenizer.dispose();
        }
      }
    });

    test(`${preferredHighlighter} recovers from edits that were never delivered`, async () => {
      const highlighter = await getSharedHighlighter({
        preferredHighlighter,
        themes: ['pierre-dark'],
        langs: ['typescript'],
      });
      const document = new TextDocument(
        'test.ts',
        'const a = 1;\nconst b = 2;\nconst c = 3;',
        'typescript'
      );
      const tokenizer = highlighter.createEditorTokenizer({
        textDocument: document,
        theme: 'pierre-dark',
        onDeferTokenize: () => {},
      });
      const expectLinesMatchDocument = (
        lines: Map<number, HighlightedToken[]>
      ) => {
        expect(lines.size).toBeGreaterThan(0);
        for (const [line, tokens] of lines) {
          expect(tokens.map((token) => token[2]).join('')).toBe(
            document.getLineText(line)
          );
        }
      };
      try {
        // A skipped delivery that changes the line count.
        document.applyEdits([
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: '// header\n',
          },
        ]);
        const renamed = document.applyEdits([
          {
            range: {
              start: { line: 3, character: 6 },
              end: { line: 3, character: 7 },
            },
            newText: 'renamed',
          },
        ]);
        const lines = tokenizer.tokenize(renamed!);
        expectLinesMatchDocument(lines);
        expect(
          lines
            .get(3)
            ?.map((token) => token[2])
            .join('')
        ).toBe('const renamed = 3;');
        // A skipped delivery that keeps the line count but lengthens a line,
        // so the next edit lands past the end of the stale line.
        document.applyEdits([
          {
            range: {
              start: { line: 1, character: 0 },
              end: { line: 1, character: 0 },
            },
            newText: 'export ',
          },
        ]);
        const widened = document.applyEdits([
          {
            range: {
              start: { line: 1, character: 17 },
              end: { line: 1, character: 18 },
            },
            newText: '10',
          },
        ]);
        const relined = tokenizer.tokenize(widened!);
        expectLinesMatchDocument(relined);
        expect(
          relined
            .get(1)
            ?.map((token) => token[2])
            .join('')
        ).toBe('export const a = 10;');
        // Skipped edits can stay in bounds and preserve every line's length.
        document.applyEdits([
          {
            range: {
              start: { line: 1, character: 13 },
              end: { line: 1, character: 14 },
            },
            newText: 'b',
          },
        ]);
        const incremented = document.applyEdits([
          {
            range: {
              start: { line: 1, character: 17 },
              end: { line: 1, character: 19 },
            },
            newText: '11',
          },
        ]);
        const updated = tokenizer.tokenize(incremented!);
        expectLinesMatchDocument(updated);
        expect(
          updated
            .get(1)
            ?.map((token) => token[2])
            .join('')
        ).toBe('export const b = 11;');
        // Bracket matching between renders reads the mirror too.
        const appended = document.applyEdits([
          {
            range: {
              start: { line: 3, character: 18 },
              end: { line: 3, character: 18 },
            },
            newText: '\n"(";',
          },
        ]);
        expect(appended).toBeDefined();
        expect(document.getLineText(4)).toBe('"(";');
        const ranges = tokenizer.getStringCommentRegexpRangesInLine(4);
        expect(ranges?.[0]).toEqual([0, 3]);
      } finally {
        tokenizer.dispose();
      }
    });

    test(`${preferredHighlighter} leaves lines at tokenizeMaxLineLength unthemed`, async () => {
      const highlighter = await getSharedHighlighter({
        preferredHighlighter,
        themes: ['pierre-dark'],
        langs: ['typescript'],
      });
      const atLimit = 'const value = 1;';
      const underLimit = 'const v = 1;';
      const options = {
        lang: 'typescript',
        theme: 'pierre-dark',
        tokenizeMaxLineLength: atLimit.length,
      };
      const rendered = highlighter.codeToTokens(
        `${atLimit}\n${underLimit}`,
        options
      ).tokens;
      expect(rendered[0]).toHaveLength(1);
      expect(rendered[1].length).toBeGreaterThan(1);
      const document = new TextDocument(
        'test.ts',
        `${atLimit}\n${underLimit}`,
        'typescript'
      );
      const tokenizer = highlighter.createEditorTokenizer({
        textDocument: document,
        theme: 'pierre-dark',
        tokenizeMaxLineLength: atLimit.length,
        onDeferTokenize: () => {},
      });
      try {
        const lines = tokenizer.tokenize({
          changes: [],
          startLine: 0,
          startCharacter: 0,
          endCharacter: 0,
          endLine: 1,
          endedAtDocumentEnd: true,
          previousLineCount: document.lineCount,
          lineCount: document.lineCount,
          lineDelta: 0,
          changedLineRanges: [[0, 1]],
        });
        expect(lines.get(0)).toHaveLength(1);
        expect(lines.get(0)?.[0]?.[2]).toBe(atLimit);
        expect(lines.get(1)?.length).toBeGreaterThan(1);
      } finally {
        tokenizer.dispose();
      }
    });
  }

  test('Highlights streams long input with a bounded document and exact tokens', async () => {
    const highlighter = await getSharedHighlighter({
      preferredHighlighter: 'highlights',
      themes: ['pierre-dark'],
      langs: ['typescript'],
    });
    const options = { lang: 'typescript', theme: 'pierre-dark' } as const;
    const tokenizer = highlighter.createStreamTokenizer(options);
    const reset = spyOn(LiveTokenizer.prototype, 'reset');
    const tokens: ThemedToken[] = [];
    let unstableCount = 0;
    const enqueue = async (text: string) => {
      for (let index = 0; index < text.length; index += 997) {
        const result = await tokenizer.enqueue(text.slice(index, index + 997));
        tokens.splice(
          tokens.length - result.recall,
          result.recall,
          ...result.stable,
          ...result.unstable
        );
        unstableCount = result.unstable.length;
      }
    };
    const code = 'const a = `x`;\n'.repeat(3000);
    // The comment spans failed trims, which must restore the dropped lines.
    const comment = `/*\n${' * const b = 1;\n'.repeat(2500)} */\nconst c = 2;`;
    try {
      await enqueue(code);
      tokenizer.clone().dispose();
      const cloned = reset.mock.calls[0]?.[0] ?? '';
      expect(cloned.split('\n').length).toBeLessThanOrEqual(1026);
      expect(code.endsWith(cloned)).toBe(true);
      await enqueue(comment);
      tokens.splice(
        tokens.length - unstableCount,
        unstableCount,
        ...tokenizer.close().stable
      );
    } finally {
      reset.mockRestore();
      tokenizer.dispose();
    }
    const source = code + comment;
    expect(tokens.map((token) => token.content).join('')).toBe(source);
    expect(
      tokens
        .filter((token) => token.content !== '\n')
        .map((token) => [token.content, token.color])
    ).toEqual(
      highlighter
        .codeToTokens(source, options)
        .tokens.flat()
        .map((token) => [token.content, token.color])
    );
  });

  test('Highlights refreshes same-line edits before bracket matching', async () => {
    const highlighter = await getSharedHighlighter({
      preferredHighlighter: 'highlights',
      themes: ['pierre-dark'],
      langs: ['typescript'],
    });
    const document = new TextDocument('test.ts', 'value;', 'typescript');
    const tokenizer = highlighter.createEditorTokenizer({
      textDocument: document,
      theme: 'pierre-dark',
      onDeferTokenize: () => {},
    });
    try {
      expect(tokenizer.getStringCommentRegexpRangesInLine(0)).toEqual([]);
      const change = document.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 5 },
          },
          newText: '"("',
        },
      ]);
      expect(tokenizer.getStringCommentRegexpRangesInLine(0)).toEqual([[0, 3]]);
      const lines = tokenizer.tokenize(change!);
      expect(
        lines
          .get(0)
          ?.map((token) => token[2])
          .join('')
      ).toBe('"(";');
    } finally {
      tokenizer.dispose();
    }
  });

  test('Highlights returns every row a render finishes and delivers none', async () => {
    const highlighter = await getSharedHighlighter({
      preferredHighlighter: 'highlights',
      themes: ['pierre-dark'],
      langs: ['typescript'],
    });
    const document = new TextDocument(
      'test.ts',
      'const text = "🚀";\n'.repeat(300),
      'typescript'
    );
    const delivered = new Set<number>();
    const tokenizer = highlighter.createEditorTokenizer({
      textDocument: document,
      theme: 'pierre-dark',
      onDeferTokenize: (lines) => {
        for (const line of lines.keys()) delivered.add(line);
      },
    });
    try {
      // Opening a comment on line 0 leaves every later line pending.
      const change = document.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: '/*',
        },
      ]);
      tokenizer.tokenize(change!, {
        startingLine: 0,
        totalLines: 2,
        bufferBefore: 0,
        bufferAfter: 0,
      });
      tokenizer.pauseBackgroundTokenize();
      delivered.clear();
      // A scroll re-renders a window further down at the same version.
      const lines = tokenizer.tokenize(
        {
          ...change!,
          changes: [],
          startLine: 0,
          lineDelta: 0,
          previousLineCount: document.lineCount,
          lineCount: document.lineCount,
        },
        { startingLine: 100, totalLines: 10, bufferBefore: 0, bufferAfter: 0 }
      );
      for (let line = 100; line < 110; line++)
        expect(lines.has(line)).toBe(true);
      // Lines the flush finished above the window come back with the
      // window's own, so the component applies them all against the same
      // document. The background pass carries on below the window; nothing
      // the call returned is delivered again.
      expect([...lines.keys()].some((line) => line < 100)).toBe(true);
      expect(delivered.size).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect([...delivered].every((line) => line >= 110)).toBe(true);
    } finally {
      tokenizer.dispose();
    }
  });

  test('Highlights retokenizes deferred edits with the selected theme', async () => {
    const highlighter = await getSharedHighlighter({
      preferredHighlighter: 'highlights',
      themes: ['pierre-dark', 'pierre-light'],
      langs: ['typescript'],
    });
    const document = new TextDocument(
      'test.ts',
      'const text = "🚀";\n'.repeat(300),
      'typescript'
    );
    const deferred = new Map<number, HighlightedToken[]>();
    const tokenizer = highlighter.createEditorTokenizer({
      textDocument: document,
      theme: 'pierre-dark',
      onDeferTokenize: (lines) => {
        for (const [line, tokens] of lines) deferred.set(line, tokens);
      },
    });
    try {
      tokenizer.setTheme('pierre-light');
      const change = document.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: '/*',
        },
      ]);
      tokenizer.tokenize(change!, {
        startingLine: 0,
        totalLines: 2,
        bufferBefore: 0,
        bufferAfter: 0,
      });
      tokenizer.pauseBackgroundTokenize();
      tokenizer.resumeBackgroundTokenize();
      for (let retries = 0; retries < 100 && !deferred.has(250); retries++)
        await new Promise((resolve) => setTimeout(resolve, 5));
      const expected = highlighter.codeToTokens(document.getText(), {
        lang: 'typescript',
        theme: 'pierre-light',
      });
      expect(deferred.get(250)?.[0]?.[1]).toBe(expected.tokens[250][0].color);
    } finally {
      tokenizer.dispose();
    }
  });
});

describe('Highlights state prebuild', () => {
  test('keeps a pause set before rendering', async () => {
    const highlighter = await getSharedHighlighter({
      preferredHighlighter: 'highlights',
      themes: ['pierre-dark'],
      langs: ['typescript'],
    });
    const document = new TextDocument(
      'test.ts',
      'const text = "🚀";\n'.repeat(300),
      'typescript'
    );
    const delivered: number[] = [];
    const tokenizer = highlighter.createEditorTokenizer({
      textDocument: document,
      theme: 'pierre-dark',
      onDeferTokenize: (lines) => {
        delivered.push(...lines.keys());
      },
    });
    try {
      // Opening a comment on line 0 leaves every later line pending.
      const change = document.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: '/*',
        },
      ]);
      tokenizer.tokenize(change!, {
        startingLine: 0,
        totalLines: 2,
        bufferBefore: 0,
        bufferAfter: 0,
      });
      // Same order as File.render: pause, then sync the editor view.
      tokenizer.pauseBackgroundTokenize();
      delivered.length = 0;
      tokenizer.prebuildStateStack({
        startingLine: 0,
        totalLines: 10,
        bufferBefore: 0,
        bufferAfter: 0,
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(delivered).toHaveLength(0);
      tokenizer.resumeBackgroundTokenize();
      for (let retries = 0; retries < 100 && delivered.length === 0; retries++)
        await new Promise((resolve) => setTimeout(resolve, 5));
      expect(delivered.length).toBeGreaterThan(0);
    } finally {
      tokenizer.dispose();
    }
  });
});

describe('Highlights bracket reads', () => {
  test('keep background work paused and deliver completed lines afterwards', async () => {
    const highlighter = await getSharedHighlighter({
      preferredHighlighter: 'highlights',
      themes: ['pierre-dark'],
      langs: ['typescript'],
    });
    const document = new TextDocument(
      'test.ts',
      'const text = "🚀";\n'.repeat(300),
      'typescript'
    );
    const delivered: number[] = [];
    let reading = false;
    let deliveredWhileReading = false;
    const tokenizer = highlighter.createEditorTokenizer({
      textDocument: document,
      theme: 'pierre-dark',
      onDeferTokenize: (lines) => {
        deliveredWhileReading ||= reading;
        delivered.push(...lines.keys());
      },
    });
    try {
      // Opening a comment on line 0 leaves every later line pending.
      const change = document.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: '/*',
        },
      ]);
      tokenizer.tokenize(change!, {
        startingLine: 0,
        totalLines: 2,
        bufferBefore: 0,
        bufferAfter: 0,
      });
      tokenizer.pauseBackgroundTokenize();
      delivered.length = 0;
      reading = true;
      const ranges = tokenizer.getStringCommentRegexpRangesInLine(150);
      reading = false;
      expect(ranges?.[0]?.[0]).toBe(0);
      expect(ranges?.at(-1)?.[1]).toBe(document.getLineText(150).length);
      expect(deliveredWhileReading).toBe(false);
      expect(delivered).toHaveLength(0);
      await Promise.resolve();
      expect(delivered.length).toBeGreaterThan(0);
      expect(Math.max(...delivered)).toBeLessThan(151);
      const completedByRead = delivered.length;
      // The read must leave background work paused.
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(delivered).toHaveLength(completedByRead);
      tokenizer.resumeBackgroundTokenize();
      for (
        let retries = 0;
        retries < 100 && delivered.length === completedByRead;
        retries++
      )
        await new Promise((resolve) => setTimeout(resolve, 5));
      expect(delivered.length).toBeGreaterThan(completedByRead);
    } finally {
      tokenizer.dispose();
    }
  });
});

// Shiki schedules each background chunk through a window message. The stub
// records them so a test runs the chunks when it chooses.
function stubBackgroundMessages(): { drain(): void; restore(): void } {
  const saved = {
    addEventListener: globalThis.addEventListener,
    removeEventListener: globalThis.removeEventListener,
    postMessage: globalThis.postMessage,
  };
  let listener: ((event: MessageEvent) => void) | undefined;
  const posted: unknown[] = [];
  globalThis.addEventListener = ((
    type: string,
    callback: EventListenerOrEventListenerObject
  ) => {
    if (type === 'message' && typeof callback === 'function') {
      listener = callback as (event: MessageEvent) => void;
    }
  }) as typeof globalThis.addEventListener;
  globalThis.removeEventListener = ((
    type: string,
    callback: EventListenerOrEventListenerObject
  ) => {
    if (type === 'message' && callback === listener) {
      listener = undefined;
    }
  }) as typeof globalThis.removeEventListener;
  globalThis.postMessage = ((message: unknown) => {
    posted.push(message);
  }) as typeof globalThis.postMessage;
  return {
    drain() {
      while (posted.length > 0) {
        const data = posted.shift();
        listener?.({ data } as MessageEvent);
      }
    },
    restore() {
      Object.assign(globalThis, saved);
    },
  };
}

function insertAt(line: number, character: number, newText: string): TextEdit {
  return {
    range: { start: { line, character }, end: { line, character } },
    newText,
  };
}

describe('Shiki background work', () => {
  const lineCount = 40;
  const contents = Array.from(
    { length: lineCount },
    (_, line) => `const value${line} = (${line});`
  ).join('\n');
  const window = {
    startingLine: 10,
    totalLines: 10,
    bufferBefore: 0,
    bufferAfter: 0,
  };

  test('a bracket read while a job is pending leaves its lines to the job', async () => {
    const highlighter = await getSharedHighlighter({
      preferredHighlighter: 'shiki-js',
      themes: ['pierre-dark'],
      langs: ['typescript'],
    });
    const messages = stubBackgroundMessages();
    const document = new TextDocument('test.ts', contents, 'typescript');
    const tokens = new Map<number, HighlightedToken[]>();
    const tokenizer = highlighter.createEditorTokenizer({
      textDocument: document,
      theme: 'pierre-dark',
      onDeferTokenize: (lines) => {
        for (const [line, lineTokens] of lines) tokens.set(line, lineTokens);
      },
    });
    try {
      // Open a comment in the window and close it below it, in one batch. The
      // lines below the window wait for the background job.
      const open = document.applyEdits([
        insertAt(10, 0, '/*'),
        insertAt(32, 0, '*/'),
      ]);
      for (const [line, lineTokens] of tokenizer.tokenize(open!, window)) {
        tokens.set(line, lineTokens);
      }
      // Bracket matching below the window reads the states down to its line
      // before the job ran.
      expect(tokenizer.getStringCommentRegexpRangesInLine(35)).toEqual([]);

      const above = document.applyEdits([insertAt(0, 0, 'export ')]);
      for (const [line, lineTokens] of tokenizer.tokenize(above!, window)) {
        tokens.set(line, lineTokens);
      }
      messages.drain();
      expectLinesColored(
        highlighter,
        document,
        tokens,
        Array.from({ length: 13 }, (_, index) => 20 + index),
        'pierre-dark'
      );
    } finally {
      tokenizer.dispose();
      messages.restore();
    }
  });

  test('a flush while paused leaves the background paused', async () => {
    const highlighter = await getSharedHighlighter({
      preferredHighlighter: 'shiki-js',
      themes: ['pierre-dark'],
      langs: ['typescript'],
    });
    const messages = stubBackgroundMessages();
    const document = new TextDocument('test.ts', contents, 'typescript');
    const tokens = new Map<number, HighlightedToken[]>();
    const tokenizer = highlighter.createEditorTokenizer({
      textDocument: document,
      theme: 'pierre-dark',
      onDeferTokenize: (lines) => {
        for (const [line, lineTokens] of lines) tokens.set(line, lineTokens);
      },
    });
    try {
      // The comment opened at the top is colored through the window and the
      // rest left for later; the component then pauses the background until
      // its next frame.
      const open = document.applyEdits([insertAt(0, 0, '/*')]);
      for (const [line, lineTokens] of tokenizer.tokenize(open!, window)) {
        tokens.set(line, lineTokens);
      }
      tokenizer.pauseBackgroundTokenize();
      // A bracket read below the window colors down to its line and no
      // further, and the pause holds.
      tokenizer.getStringCommentRegexpRangesInLine(25);
      messages.drain();
      await Promise.resolve();
      expect(Math.max(...tokens.keys())).toBe(25);

      tokenizer.resumeBackgroundTokenize();
      messages.drain();
      expectLinesColored(
        highlighter,
        document,
        tokens,
        Array.from({ length: lineCount }, (_, line) => line),
        'pierre-dark'
      );
    } finally {
      tokenizer.dispose();
      messages.restore();
    }
  });

  test('an edit above pending work is colored with it', async () => {
    const highlighter = await getSharedHighlighter({
      preferredHighlighter: 'shiki-js',
      themes: ['pierre-dark'],
      langs: ['typescript'],
    });
    const messages = stubBackgroundMessages();
    const document = new TextDocument('test.ts', contents, 'typescript');
    const tokens = new Map<number, HighlightedToken[]>();
    const tokenizer = highlighter.createEditorTokenizer({
      textDocument: document,
      theme: 'pierre-dark',
      onDeferTokenize: (lines) => {
        for (const [line, lineTokens] of lines) tokens.set(line, lineTokens);
      },
    });
    try {
      // The comment opened at the top is colored through the window, with
      // the rest left for later, when it is closed at the window's first
      // line.
      const open = document.applyEdits([insertAt(0, 0, '/*')]);
      for (const [line, lineTokens] of tokenizer.tokenize(open!, window)) {
        tokens.set(line, lineTokens);
      }
      for (const [line, lineTokens] of tokenizer.flush(window)) {
        tokens.set(line, lineTokens);
      }
      const close = document.applyEdits([insertAt(10, 0, '*/')]);
      for (const [line, lineTokens] of tokenizer.tokenize(close!, window)) {
        tokens.set(line, lineTokens);
      }
      messages.drain();
      expectLinesColored(
        highlighter,
        document,
        tokens,
        Array.from({ length: lineCount }, (_, line) => line),
        'pierre-dark'
      );
    } finally {
      tokenizer.dispose();
      messages.restore();
    }
  });

  test('a deletion above a cold window colors every line it reaches', async () => {
    const highlighter = await getSharedHighlighter({
      preferredHighlighter: 'shiki-js',
      themes: ['pierre-dark'],
      langs: ['typescript'],
    });
    const messages = stubBackgroundMessages();
    const document = new TextDocument('test.ts', contents, 'typescript');
    const tokens = new Map<number, HighlightedToken[]>();
    const tokenizer = highlighter.createEditorTokenizer({
      textDocument: document,
      theme: 'pierre-dark',
      onDeferTokenize: (lines) => {
        for (const [line, lineTokens] of lines) tokens.set(line, lineTokens);
      },
    });
    try {
      // Nothing is lexed yet. Replacing two lines above the window with an
      // open comment must recolor everything below it.
      const change = document.applyEdits([
        {
          range: {
            start: { line: 2, character: 0 },
            end: { line: 4, character: 0 },
          },
          newText: '/*\n',
        },
      ]);
      for (const [line, lineTokens] of tokenizer.tokenize(change!, window)) {
        tokens.set(line, lineTokens);
      }
      messages.drain();
      expectLinesColored(
        highlighter,
        document,
        tokens,
        Array.from({ length: lineCount - 1 - 2 }, (_, index) => 2 + index),
        'pierre-dark'
      );
    } finally {
      tokenizer.dispose();
      messages.restore();
    }
  });

  test('an edit during a theme pass leaves the rest of the pass to the job', async () => {
    const highlighter = await getSharedHighlighter({
      preferredHighlighter: 'shiki-js',
      themes: ['pierre-dark', 'pierre-light'],
      langs: ['typescript'],
    });
    const messages = stubBackgroundMessages();
    const document = new TextDocument('test.ts', contents, 'typescript');
    const tokens = new Map<number, HighlightedToken[]>();
    const tokenizer = highlighter.createEditorTokenizer({
      textDocument: document,
      theme: 'pierre-dark',
      onDeferTokenize: (lines) => {
        for (const [line, lineTokens] of lines) tokens.set(line, lineTokens);
      },
    });
    try {
      tokenizer.setTheme('pierre-light');
      // The theme pass has not run when the next edit interrupts it.
      const change = document.applyEdits([insertAt(15, 0, 'export ')]);
      for (const [line, lineTokens] of tokenizer.tokenize(change!, window)) {
        tokens.set(line, lineTokens);
      }
      messages.drain();
      expectLinesColored(
        highlighter,
        document,
        tokens,
        Array.from({ length: lineCount }, (_, line) => line),
        'pierre-light'
      );
    } finally {
      tokenizer.dispose();
      messages.restore();
    }
  });
});

// Edits on both backends, checked against a fresh tokenizer over the same
// text: every line's bracket ranges, and every line's colors as the rows
// would hold them from the deliveries.
describe('edits against a fresh tokenizer', () => {
  const backends: HighlighterTypes[] = ['highlights', 'shiki-js'];

  interface BackendUnderTest {
    document: TextDocument;
    /** Applies the edits and gives the tokenizer the change. */
    apply(edits: TextEdit[], window?: RenderRange): TextDocumentChange | null;
    /** A bracket read, as the editor makes one. */
    read(line: number): void;
    /** Finishes the background work, then compares with a fresh tokenizer. */
    expectLikeFresh(): Promise<void>;
    dispose(): void;
  }

  // Opens `source` on `backend` with every line colored, and keeps each
  // delivery by line, moved through each change the way rows move.
  async function start(
    backend: HighlighterTypes,
    source: string
  ): Promise<BackendUnderTest> {
    const highlighter = await getSharedHighlighter({
      preferredHighlighter: backend,
      themes: ['pierre-dark'],
      langs: ['typescript'],
    });
    // Shiki schedules its slices through window messages, which the stub
    // holds until drained; Highlights runs its own through a MessageChannel.
    const messages =
      backend === 'shiki-js' ? stubBackgroundMessages() : undefined;
    const document = new TextDocument('edited.ts', source, 'typescript');
    let tokens = new Map<number, HighlightedToken[]>();
    const take = (lines: Map<number, HighlightedToken[]>): void => {
      for (const [line, lineTokens] of lines) tokens.set(line, lineTokens);
    };
    const tokenizer = highlighter.createEditorTokenizer({
      textDocument: document,
      theme: 'pierre-dark',
      onDeferTokenize: take,
    });
    // Colored once, so every later effect has to be delivered.
    take(tokenizer.tokenize(wholeDocument(document)));
    const finish = async (): Promise<void> => {
      if (messages != null) {
        messages.drain();
      } else {
        await tick();
      }
      take(tokenizer.flush());
    };
    return {
      document,
      apply(edits, window) {
        const change = document.applyEdits(edits);
        if (change == null) return null;
        // Rows keep their colors and move with their lines; a line the edit
        // rewrote shows nothing until it is colored again.
        const moved = new Map<number, HighlightedToken[]>();
        for (const [line, lineTokens] of tokens) {
          const to = lineAfterChange(line, change);
          if (to != null) moved.set(to, lineTokens);
        }
        tokens = moved;
        take(tokenizer.tokenize(change, window));
        if (window != null) take(tokenizer.flush(window));
        return change;
      },
      read(line) {
        tokenizer.getStringCommentRegexpRangesInLine(line);
      },
      async expectLikeFresh() {
        await finish();
        const fresh = highlighter.createEditorTokenizer({
          textDocument: document,
          theme: 'pierre-dark',
          onDeferTokenize: () => {},
        });
        try {
          for (let line = 0; line < document.lineCount; line++) {
            expect({
              line,
              ranges: tokenizer.getStringCommentRegexpRangesInLine(line),
            }).toEqual({
              line,
              ranges: fresh.getStringCommentRegexpRangesInLine(line),
            });
          }
          // Lines a bracket read colored on its way arrive on a microtask.
          await Promise.resolve();
          const wanted = fresh.tokenize(wholeDocument(document));
          for (let line = 0; line < document.lineCount; line++) {
            expect({ line, tokens: visibleTokens(tokens.get(line)) }).toEqual({
              line,
              tokens: visibleTokens(wanted.get(line)),
            });
          }
        } finally {
          fresh.dispose();
        }
      },
      dispose() {
        tokenizer.dispose();
        messages?.restore();
      },
    };
  }

  for (const backend of backends) {
    test(`${backend}: two Enters on one line keep the lines below theirs`, async () => {
      // Every line has a string or comment range of its own, so a line that
      // took its neighbor's shows.
      const backendUnderTest = await start(
        backend,
        [
          'a("0");',
          '// c1',
          'b("22");',
          '// c333',
          'c("4444");',
          '// c55555',
        ].join('\n')
      );
      try {
        backendUnderTest.apply([insertAt(0, 0, '\n'), insertAt(0, 1, '\n')]);
        await backendUnderTest.expectLikeFresh();
      } finally {
        backendUnderTest.dispose();
      }
    });

    // Each round applies one to three edits, with Enters, block-comment
    // openers and template literals, often two edits on one line, and
    // checks every line. The check runs every round: a later edit that
    // recolors to the end of the file would repair a line moved wrongly and
    // hide it.
    test(`${backend}: random edit batches leave every line like a fresh run`, async () => {
      let seed = 7;
      const random = (): number => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      const below = (limit: number): number => Math.floor(random() * limit);
      const fragments = [
        '/*',
        '*/',
        '"',
        '(',
        ')',
        '\n',
        'x\n',
        'y',
        '\n\n',
        '// c\n',
        '`t${',
        '}`',
        '',
      ];
      const source = Array.from({ length: 40 }, (_, line) =>
        line % 7 === 3
          ? `// note ${line} (a)`
          : line % 5 === 2
            ? `const s${line} = "(${line})";`
            : `call${line}(x${line}, [${line}]);`
      ).join('\n');
      const backendUnderTest = await start(backend, source);
      const { document } = backendUnderTest;
      try {
        for (let round = 0; round < 80; round++) {
          // One to three edits, in order, on distinct spots; often two on one
          // line, which is two carets pressing Enter.
          const spots: { line: number; character: number }[] = [];
          const count = 1 + below(3);
          for (let index = 0; index < count; index++) {
            const line =
              index > 0 && random() < 0.5
                ? spots[index - 1].line
                : below(document.lineCount);
            spots.push({
              line,
              character: below(document.getLineLength(line) + 1),
            });
          }
          spots.sort((a, b) =>
            a.line !== b.line ? a.line - b.line : a.character - b.character
          );
          const edits: TextEdit[] = [];
          for (const [index, spot] of spots.entries()) {
            const previous = spots[index - 1];
            if (
              previous != null &&
              previous.line === spot.line &&
              previous.character === spot.character
            ) {
              continue;
            }
            const next = spots[index + 1];
            const room =
              (next != null && next.line === spot.line
                ? next.character
                : document.getLineLength(spot.line)) - spot.character;
            const remove = random() < 0.4 ? Math.min(room, below(4)) : 0;
            const newText = fragments[below(fragments.length)];
            // An editor never submits an edit that changes nothing, and
            // Highlights skips one; the line would then have nothing to
            // deliver.
            const replaced = document
              .getLineText(spot.line)
              .slice(spot.character, spot.character + remove);
            if (replaced === newText) {
              continue;
            }
            edits.push({
              range: {
                start: spot,
                end: { line: spot.line, character: spot.character + remove },
              },
              newText,
            });
          }
          const windowStart = below(Math.max(1, document.lineCount - 10));
          const change = backendUnderTest.apply(edits, {
            startingLine: windowStart,
            totalLines: 10,
            bufferBefore: 0,
            bufferAfter: 0,
          });
          if (change == null) continue;
          if (random() < 0.5) {
            backendUnderTest.read(below(document.lineCount));
          }
          await backendUnderTest.expectLikeFresh();
        }
      } finally {
        backendUnderTest.dispose();
      }
    });
  }
});

// A change that marks every line of `document` changed without editing any.
function wholeDocument(document: TextDocument): TextDocumentChange {
  return {
    startLine: 0,
    startCharacter: 0,
    endCharacter: 0,
    endLine: document.lineCount - 1,
    endedAtDocumentEnd: false,
    previousLineCount: document.lineCount,
    lineCount: document.lineCount,
    lineDelta: 0,
    changes: [],
    changedLineRanges: [[0, document.lineCount - 1]],
  };
}

// The tokens of a line that show: a blank line's one empty token is left
// out, and whitespace, which the editor tokenizers leave uncolored, keeps
// no color.
function visibleTokens(
  tokens: readonly HighlightedToken[] | undefined
): [string, string][] | undefined {
  return tokens
    ?.filter(([, , content]) => content !== '')
    .map(([, color, content]) => [content.trim() === '' ? '' : color, content]);
}

// Lets a scheduled task run.
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Every line's tokens, from the edit's return value or a later delivery,
// against a fresh tokenization of the document in `theme`.
function expectLinesColored(
  highlighter: Awaited<ReturnType<typeof getSharedHighlighter>>,
  document: TextDocument,
  tokens: Map<number, HighlightedToken[]>,
  lines: Iterable<number>,
  theme: string
): void {
  const expected = highlighter.codeToTokens(document.getText(), {
    lang: 'typescript',
    theme,
  });
  // The tokenizer gives a blank line one empty, uncolored token and leaves
  // whitespace uncolored; neither shows, so both are compared without it.
  const visible = (
    pairs: readonly (readonly [string, string])[] | undefined
  ): [string, string][] | undefined =>
    pairs
      ?.filter(([, content]) => content !== '')
      .map(([color, content]) => [content.trim() === '' ? '' : color, content]);
  for (const line of lines) {
    const actual = visible(
      tokens.get(line)?.map((token): [string, string] => [token[1], token[2]])
    );
    const wanted = visible(
      expected.tokens[line].map((token): [string, string] => [
        token.color ?? '',
        token.content,
      ])
    );
    expect({ line, tokens: actual }).toEqual({ line, tokens: wanted });
  }
}
