import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import { bundledLanguages } from 'shiki/langs';
import { bundledThemes } from 'shiki/themes';

import { TextDocument } from '../src/editor/textDocument';
import { getShikiOptions, ShikiLiveTokenizer } from '../src/highlighter/shiki';
import type { DiffsLiveTokenizerOptions, HighlightedToken } from '../src/types';

function edit(sl: number, sc: number, el: number, ec: number, newText: string) {
  return {
    range: {
      start: { line: sl, character: sc },
      end: { line: el, character: ec },
    },
    newText,
  };
}

for (const engine of ['wasm', 'js']) {
  describe(`ShikiLiveTokenizer ${engine}`, () => {
    let highlighter: HighlighterCore;
    let options: Omit<DiffsLiveTokenizerOptions, 'textDocument'>;

    beforeAll(async () => {
      highlighter = await createHighlighterCore({
        engine:
          engine === 'js'
            ? createJavaScriptRegexEngine({ forgiving: true })
            : createOnigurumaEngine(() => import('shiki/wasm')),
        langs: [bundledLanguages.typescript, bundledLanguages.html],
        themes: [bundledThemes['github-dark'], bundledThemes['github-light']],
      });
      options = {
        lang: 'typescript',
        theme: highlighter.getTheme('github-dark'),
      };
    });

    afterAll(() => highlighter.dispose());

    // A fresh full-document pass checks both styling and UTF-16 offsets.
    function expectTokens(
      tokenizer: ShikiLiveTokenizer,
      code: string,
      tokenOptions = options
    ): void {
      const lines = code.split(/\r\n|\r|\n/);
      const expected = highlighter.codeToTokens(
        code.replace(/\r(?!\n)/g, '\n'),
        getShikiOptions(tokenOptions)
      ).tokens;
      let offset = 0;
      for (let line = 0; line < lines.length; line++) {
        expect(tokenizer.getLineTokens(line).tokens).toEqual(
          expected[line].map((token) => ({
            ...token,
            offset: token.offset - offset,
          }))
        );
        offset +=
          lines[line].length +
          (code.slice(offset + lines[line].length).startsWith('\r\n') ? 2 : 1);
      }
    }

    test('retains grammar states through multiline edits and stops once they converge', () => {
      const code = [
        'const first = 1;',
        '/* comment',
        'inside */',
        'const last = 2;',
        ...Array.from({ length: 300 }, (_, i) => `const value${i} = ${i};`),
      ].join('\n');
      const document = new TextDocument('example.ts', code);
      const tokenizer = new ShikiLiveTokenizer(highlighter, {
        ...options,
        textDocument: document,
      });
      const spy = spyOn(highlighter.getLanguage('typescript'), 'tokenizeLine2');
      try {
        tokenizer.tokenize(document.applyEdits([edit(0, 14, 0, 15, '3')])!);
        expect(spy).toHaveBeenCalledTimes(1);
        expectTokens(tokenizer, document.getText());
        spy.mockClear();
        tokenizer.tokenize(document.applyEdits([edit(1, 0, 1, 2, '//')])!);
        expect(spy.mock.calls.length).toBeLessThan(5);
        expectTokens(tokenizer, document.getText());
      } finally {
        spy.mockRestore();
        tokenizer.dispose();
      }
    });

    test('preserves font styles and color replacements after the shared theme changes', async () => {
      await highlighter.loadTheme({
        name: 'live-styles',
        type: 'dark',
        colors: {
          'editor.foreground': '#abcdef',
          'editor.background': '#000000',
        },
        tokenColors: [
          {
            scope: ['string', 'comment', 'storage'],
            settings: {
              foreground: '#112233',
              fontStyle: 'italic bold underline',
            },
          },
        ],
        colorReplacements: { '#112233': 'var(--live-token)' },
      });
      const styled = { ...options, theme: highlighter.getTheme('live-styles') };
      const document = new TextDocument(
        'example.ts',
        'const value = "one";\n/* note */'
      );
      const tokenizer = new ShikiLiveTokenizer(highlighter, {
        ...styled,
        textDocument: document,
      });
      try {
        highlighter.codeToTokens('const other = "light";', {
          lang: 'typescript',
          theme: 'github-light',
        });
        tokenizer.tokenize(document.applyEdits([edit(0, 15, 0, 18, 'two')])!);
        expectTokens(tokenizer, document.getText(), styled);
        expect(
          tokenizer
            .getLineTokens(1)
            .tokens.some((token) => token.fontStyle === 7)
        ).toBe(true);
        expect(
          tokenizer
            .getLineTokens(1)
            .tokens.some((token) => token.color === 'var(--live-token)')
        ).toBe(true);
      } finally {
        tokenizer.dispose();
      }
    });

    test('reads the shared document without copying or applying editor edits again', () => {
      const document = new TextDocument(
        'example.ts',
        'const first = 1;\nconst last = 2;'
      );
      const applyEdits = document.applyEdits.bind(document);
      const getText = document.getText.bind(document);
      const editSpy = spyOn(document, 'applyEdits').mockImplementation(() => {
        throw new Error('The editor has already applied this change');
      });
      const textSpy = spyOn(document, 'getText').mockImplementation(() => {
        throw new Error('Read lines from the shared document');
      });
      const tokenizer = new ShikiLiveTokenizer(highlighter, {
        ...options,
        textDocument: document,
      });
      try {
        expectTokens(tokenizer, getText());
        const change = applyEdits([edit(0, 0, 0, 0, '/*\n')])!;
        const revision = document.revision;
        tokenizer.tokenize(change);
        expect(document.revision).toBe(revision);
        expectTokens(tokenizer, getText());
        tokenizer.tokenize(document.undo()![0]);
        expectTokens(tokenizer, getText());
        tokenizer.tokenize(document.redo()![0]);
        expectTokens(tokenizer, getText());
        applyEdits([edit(0, 0, 0, 2, '//')]);
        applyEdits([edit(2, 13, 2, 14, '3')]);
        tokenizer.reset();
        expectTokens(tokenizer, getText());
        expect(editSpy).not.toHaveBeenCalled();
        expect(textSpy).not.toHaveBeenCalled();
      } finally {
        tokenizer.dispose();
        editSpy.mockRestore();
        textSpy.mockRestore();
      }
    });

    test('applies simultaneous UTF-16 edits and preserves mixed newline boundaries', () => {
      const document = new TextDocument(
        'example.ts',
        'const emoji = "👋";\r\n/* start\rinside */\nconst end = 4;\r'
      );
      const tokenizer = new ShikiLiveTokenizer(highlighter, {
        ...options,
        textDocument: document,
      });
      try {
        for (const edits of [
          [edit(0, 15, 0, 17, '🪴'), edit(3, 12, 3, 13, '5')],
          [edit(1, 0, 2, 9, 'const a = `one\r\ntwo`;')],
          [edit(0, 0, 0, 0, '// header\r')],
          [edit(1, 0, 1, 0, '\n')],
          [edit(0, 2, 0, 4, ''), edit(0, 4, 0, 4, ' extra')],
        ]) {
          tokenizer.tokenize(document.applyEdits(edits)!);
          expectTokens(tokenizer, document.getText());
        }
      } finally {
        tokenizer.dispose();
      }
    });

    test('uses document line geometry when raw edits split and join CRLF', () => {
      const code = 'const a = 1;\r\nconst b = 2;\nconst c = 3;\rconst d = 4;';
      const document = new TextDocument('example.ts', code);
      const tokenizer = new ShikiLiveTokenizer(highlighter, {
        ...options,
        textDocument: document,
      });
      try {
        const split = code.indexOf('\r') + 1;
        const join = code.lastIndexOf('\r') + 1;
        const change = document.applyResolvedEdits([
          { start: split, end: split, text: '/*' },
          { start: join, end: join, text: '\n' },
        ])!;
        // The two boundary changes cancel in the reported total line delta.
        expect(
          change.changedLineChanges!.reduce(
            (sum, [, , delta]) => sum + delta,
            0
          )
        ).toBe(change.lineDelta);
        tokenizer.tokenize(change);
        expectTokens(tokenizer, document.getText());
      } finally {
        tokenizer.dispose();
      }
    });

    test('retains both theme states and ignores adjacent strings, comments and regexps', () => {
      const code = 'const value = "([)]"; // comment {}\nconst regex = /[()]/;';
      const dual = {
        ...options,
        theme: {
          dark: highlighter.getTheme('github-dark'),
          light: highlighter.getTheme('github-light'),
        },
        defaultColor: false as const,
        cssVariablePrefix: '--diffs-',
      };
      const document = new TextDocument('example.ts', code);
      const tokenizer = new ShikiLiveTokenizer(highlighter, {
        ...dual,
        textDocument: document,
      });
      try {
        expectTokens(tokenizer, code, dual);
        expect(
          tokenizer
            .getLineTokens(0)
            .bracketIgnoredRanges.map(([start, end]) => code.slice(start, end))
        ).toEqual(['"([)]"', '// comment {}']);
        expect(tokenizer.getLineTokens(1).bracketIgnoredRanges).toEqual([
          [13, 20],
        ]);
        tokenizer.tokenize(document.applyEdits([edit(0, 14, 0, 20, '`open')])!);
        expectTokens(tokenizer, document.getText(), dual);
      } finally {
        tokenizer.dispose();
      }
    });

    test('remaps pending grammar propagation through repeated line insertions and deletions', () => {
      const document = new TextDocument(
        'example.ts',
        'const first = 1;\n/* comment\nstill comment */\r\nconst last = `text`;\r'
      );
      const tokenizer = new ShikiLiveTokenizer(highlighter, {
        ...options,
        textDocument: document,
      });
      let seed = 83;
      const random = (limit: number) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed % limit;
      };
      try {
        for (let i = 0; i < 80; i++) {
          const lines = document.getText().split(/\r\n|\r|\n/);
          const startLine = random(lines.length);
          const endLine =
            startLine + random(Math.min(3, lines.length - startLine));
          const start = random(lines[startLine].length + 1);
          const end =
            endLine === startLine
              ? start + random(lines[endLine].length - start + 1)
              : random(lines[endLine].length + 1);
          const edits = [
            edit(
              startLine,
              start,
              endLine,
              end,
              ['\r', '\n', '\r\n', '/*', '*/', '`', 'const value = 3;', ''][
                random(8)
              ]
            ),
          ];
          tokenizer.tokenize(document.applyEdits(edits)!, {
            renderRange: [0, 1],
          });
          tokenizer.pause();
          if (i % 4 === 0) {
            tokenizer.flush();
            expectTokens(tokenizer, document.getText());
          }
        }
        tokenizer.flush();
        expectTokens(tokenizer, document.getText());
      } finally {
        tokenizer.dispose();
      }
    });

    test('uses the default theme for viewport token colors', () => {
      const code = 'const answer = 42;';
      const theme = {
        dark: highlighter.getTheme('github-dark'),
        light: highlighter.getTheme('github-light'),
      };
      for (const defaultColor of [
        undefined,
        false,
        'dark',
        'light',
        'light-dark()',
      ] as const) {
        const tokenizer = new ShikiLiveTokenizer(highlighter, {
          ...options,
          theme,
          defaultColor,
          textDocument: new TextDocument('example.ts', code),
        });
        try {
          const result = tokenizer.reset({ renderRange: [0, 1] });
          const expected = highlighter.codeToTokens(
            code,
            getShikiOptions({
              ...options,
              theme:
                defaultColor === false || defaultColor === 'dark'
                  ? theme.dark
                  : theme.light,
            })
          ).tokens[0];
          expect(result.lines.get(0)).toEqual(
            expected.map((token) => [
              token.offset,
              token.color ?? '',
              token.content,
            ])
          );
        } finally {
          tokenizer.dispose();
        }
      }
    });

    test('delivers synchronous viewport lines and resumes a paused, remapped tail', async () => {
      const deferred = new Map<number, HighlightedToken[]>();
      const code = Array.from(
        { length: 30 },
        (_, i) => `const n${i} = ${i};`
      ).join('\n');
      const document = new TextDocument('example.ts', code);
      const tokenizer = new ShikiLiveTokenizer(highlighter, {
        ...options,
        textDocument: document,
        renderRange: [2, 4],
        onDeferTokenize(lines) {
          for (const [line, tokens] of lines) deferred.set(line, tokens);
        },
      });
      try {
        expect([...deferred.keys()]).toEqual([0, 1]);
        expect(tokenizer.pendingTokenization).toBe(true);
        tokenizer.pause();
        await Bun.sleep(10);
        expect([...deferred.keys()]).toEqual([0, 1]);
        const result = tokenizer.tokenize(
          document.applyEdits([edit(0, 0, 0, 0, '/*\n')])!,
          { renderRange: [1, 3] }
        );
        expect([...result.lines.keys()]).toEqual([1, 2]);
        tokenizer.pause();
        tokenizer.flush();
        expect(tokenizer.pendingTokenization).toBe(false);
        expectTokens(tokenizer, document.getText());
        deferred.clear();
        document.applyEdits([
          edit(
            0,
            0,
            30,
            document.getLineLength(30),
            'const fresh = 1;\n// fresh\nconst last = 2;'
          ),
        ]);
        tokenizer.reset({ renderRange: [0, 1] });
        tokenizer.pause();
        tokenizer.resume();
        for (
          let tries = 0;
          tokenizer.pendingTokenization && tries < 100;
          tries++
        )
          await Bun.sleep(5);
        expect(tokenizer.pendingTokenization).toBe(false);
        expect([...deferred.keys()]).toEqual([1, 2]);
      } finally {
        tokenizer.dispose();
      }
    });

    test('bounded flush finishes only the requested prefix and resumes the tail', async () => {
      const code = '/*\n' + 'inside\n'.repeat(30) + '*/';
      const document = new TextDocument('example.ts', code);
      const delivered = new Map<number, HighlightedToken[]>();
      const tokenizer = new ShikiLiveTokenizer(highlighter, {
        ...options,
        textDocument: document,
        renderRange: [0, 2],
        onDeferTokenize(lines) {
          for (const [line, tokens] of lines) delivered.set(line, tokens);
        },
      });
      try {
        tokenizer.pause();
        tokenizer.flush(2);
        expect(delivered.size).toBe(0);
        expect(tokenizer.pendingTokenization).toBe(true);
        tokenizer.flush(4);
        expect([...delivered.keys()]).toEqual([2, 3]);
        expect(tokenizer.getLineTokens(3).bracketIgnoredRanges).toEqual([
          [0, 6],
        ]);
        expect(tokenizer.pendingTokenization).toBe(true);
        tokenizer.flush(0);
        expect([...delivered.keys()]).toEqual([2, 3]);
        expect(() => tokenizer.flush(-1)).toThrow();
        expect(() => tokenizer.flush(1.5)).toThrow();
        for (
          let tries = 0;
          tokenizer.pendingTokenization && tries < 100;
          tries++
        )
          await Bun.sleep(5);
        expect(tokenizer.pendingTokenization).toBe(false);
        expectTokens(tokenizer, document.getText());
      } finally {
        tokenizer.dispose();
      }
    });

    test('bounded flush retains disjoint edits beyond its end', () => {
      const code = 'const n = 1;\n'.repeat(30);
      const document = new TextDocument('example.ts', code);
      const delivered = new Map<number, HighlightedToken[]>();
      const tokenizer = new ShikiLiveTokenizer(highlighter, {
        ...options,
        textDocument: document,
        onDeferTokenize(lines) {
          for (const [line, tokens] of lines) delivered.set(line, tokens);
        },
      });
      try {
        tokenizer.tokenize(
          document.applyEdits([
            edit(0, 0, 0, 5, 'let'),
            edit(20, 0, 20, 5, 'let'),
          ])!,
          { renderRange: [0, 0] }
        );
        tokenizer.flush(10);
        expect([...delivered.keys()]).toEqual([0]);
        expect(tokenizer.pendingTokenization).toBe(true);
        tokenizer.flush();
        expect([...delivered.keys()]).toEqual([0, 20]);
        expectTokens(tokenizer, document.getText());
      } finally {
        tokenizer.dispose();
      }
    });

    test('handles plain languages, empty lines, and maximum line length', () => {
      for (const tokenOptions of [
        { ...options, tokenizeMaxLineLength: 15 },
        { ...options, lang: 'unknown-language' },
      ]) {
        const code = '/* very long opening comment\n\nconst x = 1;\n';
        const tokenizer = new ShikiLiveTokenizer(highlighter, {
          ...tokenOptions,
          textDocument: new TextDocument('example.ts', code),
        });
        try {
          expectTokens(tokenizer, code, tokenOptions);
          expect(tokenizer.getLineTokens(0).bracketIgnoredRanges).toEqual([]);
        } finally {
          tokenizer.dispose();
        }
      }
    });

    test('carries ANSI styles through empty lines and edits until a reset', () => {
      const code = '\x1b[31mred\n\nstill red\n\x1b[0mplain\nlast';
      const document = new TextDocument('example.ts', code);
      const tokenOptions = { ...options, lang: 'ansi' };
      const tokenizer = new ShikiLiveTokenizer(highlighter, {
        ...tokenOptions,
        textDocument: document,
      });
      const spy = spyOn(highlighter, 'codeToTokens');
      try {
        expectTokens(tokenizer, code, tokenOptions);
        spy.mockClear();
        tokenizer.tokenize(document.applyEdits([edit(0, 2, 0, 4, '32')])!);
        expect(spy.mock.calls.length).toBe(4);
        expectTokens(tokenizer, document.getText(), tokenOptions);
      } finally {
        spy.mockRestore();
        tokenizer.dispose();
      }
    });

    test('accepts pastes beyond the JavaScript argument limit', () => {
      const document = new TextDocument('example.ts', '');
      const tokenizer = new ShikiLiveTokenizer(highlighter, {
        ...options,
        lang: 'text',
        textDocument: document,
      });
      try {
        tokenizer.tokenize(
          document.applyEdits([
            edit(0, 0, 0, 0, '\n'.repeat(110_000) + 'tail'),
          ])!,
          { renderRange: [0, 1] }
        );
        tokenizer.pause();
        expect(tokenizer.getLineTokens(110_000).tokens[0].content).toBe('tail');
        expect(tokenizer.pendingTokenization).toBe(true);
      } finally {
        tokenizer.dispose();
      }
    });

    test('window messages isolate tokenizers and ignore canceled or foreign jobs', () => {
      const originals = new Map(
        [
          'window',
          'postMessage',
          'addEventListener',
          'removeEventListener',
        ].map(
          (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
        )
      );
      const messages: unknown[] = [];
      const listeners = new Set<(event: MessageEvent<unknown>) => void>();
      const deliveries: number[][] = [[], []];
      const tokenizers: ShikiLiveTokenizer[] = [];
      const documents = [0, 1].map(
        () =>
          new TextDocument(
            'example.ts',
            'const first = 1;\nconst second = 2;\nconst last = 3;'
          )
      );
      // Force one line per slice, then replay messages in the order under test.
      let time = 0;
      const now = spyOn(performance, 'now').mockImplementation(
        () => (time += 5)
      );
      const timer = spyOn(globalThis, 'setTimeout');
      const deliver = (data: unknown, ownWindow = true): void => {
        for (const listener of [...listeners])
          listener({
            data,
            source: ownWindow ? globalThis : null,
          } as MessageEvent<unknown>);
      };
      try {
        Object.assign(globalThis, {
          window: globalThis,
          postMessage(data: unknown) {
            messages.push(data);
          },
          addEventListener(
            type: string,
            listener: (event: MessageEvent<unknown>) => void
          ) {
            if (type === 'message') listeners.add(listener);
          },
          removeEventListener(
            type: string,
            listener: (event: MessageEvent<unknown>) => void
          ) {
            if (type === 'message') listeners.delete(listener);
          },
        });
        for (const [index, document] of documents.entries()) {
          tokenizers.push(
            new ShikiLiveTokenizer(highlighter, {
              ...options,
              textDocument: document,
              renderRange: [0, 0],
              onDeferTokenize(lines) {
                deliveries[index].push(...lines.keys());
              },
            })
          );
        }
        expect(listeners.size).toBe(2);
        const canceled = messages.shift();
        tokenizers[0].pause();
        expect(listeners.size).toBe(1);
        tokenizers[0].resume();
        deliver(canceled);
        deliver(null);
        deliver({ type: 'unrelated' });
        deliver(messages[0], false);
        expect(deliveries).toEqual([[], []]);
        tokenizers[0].tokenize(
          documents[0].applyEdits([edit(0, 0, 0, 0, '/*')])!,
          {
            renderRange: [0, 0],
          }
        );
        for (let attempts = 0; messages.length > 0 && attempts < 20; attempts++)
          deliver(messages.shift());
        expect(messages).toHaveLength(0);
        expect(deliveries).toEqual([
          [0, 1, 2],
          [0, 1, 2],
        ]);
        expect(listeners.size).toBe(0);
        for (const [index, tokenizer] of tokenizers.entries()) {
          expect(tokenizer.pendingTokenization).toBe(false);
          expectTokens(tokenizer, documents[index].getText());
        }
        tokenizers[1].reset({ renderRange: [0, 0] });
        tokenizers[1].dispose();
        deliver(messages.shift());
        expect(deliveries[1]).toEqual([0, 1, 2]);
        expect(listeners.size).toBe(0);
        expect(timer).not.toHaveBeenCalled();
      } finally {
        for (const tokenizer of tokenizers) tokenizer.dispose();
        timer.mockRestore();
        now.mockRestore();
        for (const [key, descriptor] of originals) {
          if (descriptor === undefined) Reflect.deleteProperty(globalThis, key);
          else Object.defineProperty(globalThis, key, descriptor);
        }
      }
    });

    test('keeps a cancellable fallback in runtimes without message channels', async () => {
      const channel = Object.getOwnPropertyDescriptor(
        globalThis,
        'MessageChannel'
      );
      Reflect.set(globalThis, 'MessageChannel', undefined);
      let tokenizer: ShikiLiveTokenizer | undefined;
      const delivered: number[] = [];
      try {
        tokenizer = new ShikiLiveTokenizer(highlighter, {
          ...options,
          textDocument: new TextDocument(
            'example.ts',
            'const first = 1;\nconst last = 2;'
          ),
          renderRange: [0, 0],
          onDeferTokenize(lines) {
            delivered.push(...lines.keys());
          },
        });
        tokenizer.pause();
        await Bun.sleep(10);
        expect(delivered).toEqual([]);
        tokenizer.resume();
        for (
          let tries = 0;
          tokenizer.pendingTokenization && tries < 100;
          tries++
        )
          await Bun.sleep(5);
        expect(tokenizer.pendingTokenization).toBe(false);
        expect(delivered).toEqual([0, 1]);
      } finally {
        tokenizer?.dispose();
        if (channel === undefined)
          Reflect.deleteProperty(globalThis, 'MessageChannel');
        else Object.defineProperty(globalThis, 'MessageChannel', channel);
      }
    });

    test('cancels deferred work on disposal', async () => {
      const code = 'const x = 1;\nconst y = 2;';
      let delivered = false;
      const tokenizer = new ShikiLiveTokenizer(highlighter, {
        ...options,
        textDocument: new TextDocument('example.ts', code),
        renderRange: [0, 0],
        onDeferTokenize() {
          delivered = true;
        },
      });
      tokenizer.pause();
      tokenizer.flush();
      expectTokens(tokenizer, code);
      delivered = false;
      tokenizer.reset({ renderRange: [0, 0] });
      tokenizer.dispose();
      tokenizer.dispose();
      await Bun.sleep(10);
      expect(delivered).toBe(false);
      expect(() => tokenizer.getLineTokens(0)).toThrow('disposed');
      expect(() => tokenizer.resume()).toThrow('disposed');
    });
  });
}
