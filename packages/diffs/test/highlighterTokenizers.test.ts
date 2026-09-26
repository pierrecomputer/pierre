import { afterAll, describe, expect, spyOn, test } from 'bun:test';

import { TextDocument } from '../src/editor/textDocument';
import {
  createHighlighter,
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { CodeToTokenTransformStream } from '../src/shiki-stream';
import type { HighlightedToken, ThemedToken } from '../src/types';

afterAll(disposeHighlighter);

describe('backend tokenizers', () => {
  for (const preferredHighlighter of [
    'shiki-js',
    'shiki-wasm',
    'highlights',
  ] as const) {
    test(`${preferredHighlighter} switches live tokenizers to a resolved theme`, async () => {
      const highlighter = await createHighlighter({ preferredHighlighter });
      await highlighter.themeResolver.resolveThemes([
        'pierre-dark',
        'pierre-light',
      ]);
      await highlighter.loadLanguages?.(['typescript']);
      const document = new TextDocument(
        'test.ts',
        'const value = 1;',
        'typescript'
      );
      const tokenizer = highlighter.createLiveTokenizer({
        textDocument: document,
        theme: 'pierre-dark',
        onDeferTokenize: () => {},
      });
      try {
        for (const theme of ['pierre-light', 'pierre-dark']) {
          tokenizer.setTheme(theme);
          const change = document.applyEdits([
            {
              range: {
                start: { line: 0, character: 14 },
                end: { line: 0, character: 15 },
              },
              newText: theme === 'pierre-light' ? '2' : '3',
            },
          ]);
          const tokens = tokenizer.tokenize(change!).get(0);
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
      const tokenizer = highlighter.createLiveTokenizer({
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
      const tokenizer = highlighter.createLiveTokenizer({
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
      const tokenizer = highlighter.createLiveTokenizer({
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

  test('Highlights refreshes same-line edits before bracket matching', async () => {
    const highlighter = await getSharedHighlighter({
      preferredHighlighter: 'highlights',
      themes: ['pierre-dark'],
      langs: ['typescript'],
    });
    const document = new TextDocument('test.ts', 'value;', 'typescript');
    const tokenizer = highlighter.createLiveTokenizer({
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

  test('Highlights delivers only rows a render does not return', async () => {
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
    const tokenizer = highlighter.createLiveTokenizer({
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
      expect(delivered.size).toBeGreaterThan(0);
      for (const line of delivered) expect(line).toBeLessThan(100);
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
    const tokenizer = highlighter.createLiveTokenizer({
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
    const tokenizer = highlighter.createLiveTokenizer({
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
      // Nothing reaches the host from inside the read.
      expect(deliveredWhileReading).toBe(false);
      expect(delivered).toHaveLength(0);
      await Promise.resolve();
      // The lines the read completed arrive once the read has returned.
      expect(delivered.length).toBeGreaterThan(0);
      expect(Math.max(...delivered)).toBeLessThan(151);
      const completedByRead = delivered.length;
      // The host's pause still holds: no background slice runs.
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
