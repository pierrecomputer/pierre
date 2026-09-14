import { afterEach, describe, expect, spyOn, test } from 'bun:test';

import { TextDocument } from '../src/editor/textDocument';
import { EditorTokenizer } from '../src/editor/tokenizer';
import { disposeHighlighter, getSharedHighlighter } from '../src/highlighter';
import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import { FileRenderer } from '../src/renderers/FileRenderer';
import { preloadDiffHTML } from '../src/ssr/preloadDiffs';
import { preloadFile } from '../src/ssr/preloadFile';
import type { FileContents } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom, waitFor } from './domHarness';

const file: FileContents = {
  name: 'example.ts',
  contents: 'const answer = 42;\n',
};
const oldFile: FileContents = {
  name: 'example.ts',
  contents: 'const answer = 21;\n',
};

afterEach(async () => {
  await disposeHighlighter();
});

describe('highlighter consumers', () => {
  for (const preferredHighlighter of [
    'highlights',
    'shiki-wasm',
    'shiki-js',
  ] as const) {
    test(`editor bounds bracket queries, redraws and prebuilds with ${preferredHighlighter}`, async () => {
      const dom = installDom();
      const highlighter = await getSharedHighlighter({
        themes: ['pierre-dark'],
        langs: ['typescript'],
        preferredHighlighter,
      });
      const document = new TextDocument(
        'example.ts',
        'const n = "value";\n'.repeat(300),
        'typescript'
      );
      const deferred = new Map<number, unknown>();
      const create = spyOn(highlighter, 'createLiveTokenizer');
      const getLineText = spyOn(document, 'getLineText');
      const tokenizer = new EditorTokenizer({
        highlighter,
        textDocument: document,
        codeOptions: { theme: 'pierre-dark', preferredHighlighter },
        setStyle() {},
        onDeferTokenize(lines) {
          for (const [line, tokens] of lines) deferred.set(line, tokens);
        },
      });
      try {
        tokenizer.prebuildTokens({
          startingLine: 200,
          totalLines: 10,
          bufferBefore: 0,
          bufferAfter: 0,
        });
        const result = create.mock.results[0];
        if (result.type !== 'return')
          throw new Error('Expected a live tokenizer');
        const backend = result.value;
        expect(backend.pendingTokenization).toBe(true);
        expect(getLineText).not.toHaveBeenCalled();
        expect(tokenizer.getStringCommentRegexpRangesInLine(1)).toEqual([
          [10, 17],
        ]);
        expect(backend.pendingTokenization).toBe(true);
        const change = document.applyEdits([
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: '/*',
          },
        ])!;
        tokenizer.tokenize(change, {
          startingLine: 0,
          totalLines: 2,
          bufferBefore: 0,
          bufferAfter: 0,
        });
        expect(tokenizer.getStringCommentRegexpRangesInLine(5)).toEqual([
          [0, 18],
        ]);
        expect(backend.pendingTokenization).toBe(true);
        const lines = tokenizer.tokenize(change, {
          startingLine: 10,
          totalLines: 2,
          bufferBefore: 0,
          bufferAfter: 0,
        });
        expect([...lines.keys()]).toEqual([10, 11]);
        const expected = highlighter.codeToTokens(document.getText(), {
          lang: 'typescript',
          theme: highlighter.getTheme('pierre-dark'),
        }).tokens[10];
        expect(lines.get(10)).toEqual(
          expected.map(({ offset, color, content }) => [
            offset - document.offsetAt({ line: 10, character: 0 }),
            color ?? '',
            content,
          ])
        );
        expect(backend.pendingTokenization).toBe(true);
        await Promise.resolve();
        expect(Math.max(...deferred.keys())).toBe(11);
        await waitFor(() => !backend.pendingTokenization);
        expect(backend.pendingTokenization).toBe(false);
      } finally {
        tokenizer.cleanUp();
        getLineText.mockRestore();
        create.mockRestore();
        dom.cleanup();
      }
    });
  }

  for (const preferredHighlighter of [
    'highlights',
    'shiki-wasm',
    'shiki-js',
  ] as const) {
    test(`file and diff SSR use ${preferredHighlighter}`, async () => {
      const highlighter = await getSharedHighlighter({
        themes: ['pierre-dark'],
        langs: ['typescript'],
        preferredHighlighter,
      });
      const tokenize = spyOn(highlighter, 'codeToTokens');
      try {
        const options = { theme: 'pierre-dark', preferredHighlighter };
        const renderedFile = await preloadFile({ file, options });
        expect(renderedFile.prerenderedHTML).toContain('answer');
        expect(tokenize).toHaveBeenCalledTimes(1);
        const html = await preloadDiffHTML({ oldFile, newFile: file, options });
        expect(html).toContain('answer');
        expect(tokenize).toHaveBeenCalledTimes(3);
      } finally {
        tokenize.mockRestore();
      }
    });
  }

  test('cached file and diff renders switch backends when options change', async () => {
    const diff = parseDiffFromFile(oldFile, file);
    const fileRenderer = new FileRenderer({ theme: 'pierre-dark' });
    const diffRenderer = new DiffHunksRenderer({ theme: 'pierre-dark' });
    await fileRenderer.asyncRender(file);
    await diffRenderer.asyncRender(diff);
    expect(fileRenderer.renderFile(file)).toBeDefined();
    expect(diffRenderer.renderDiff(diff)).toBeDefined();
    for (const preferredHighlighter of [
      'shiki-js',
      'shiki-wasm',
      'highlights',
    ] as const) {
      const highlighter = await getSharedHighlighter({
        themes: ['pierre-dark'],
        langs: ['typescript'],
        preferredHighlighter,
      });
      const tokenize = spyOn(highlighter, 'codeToTokens');
      try {
        fileRenderer.mergeOptions({ preferredHighlighter });
        diffRenderer.mergeOptions({ preferredHighlighter });
        expect(fileRenderer.renderFile(file)).toBeDefined();
        expect(diffRenderer.renderDiff(diff)).toBeDefined();
        expect(tokenize).toHaveBeenCalledTimes(3);
      } finally {
        tokenize.mockRestore();
      }
    }
  });

  test('loads a newly requested Shiki grammar before rendering', async () => {
    let updated = false;
    const renderer = new FileRenderer(
      { preferredHighlighter: 'shiki-js' },
      undefined,
      () => {
        updated = true;
      }
    );
    await renderer.initializeHighlighter();
    const rust = {
      name: 'main.rs',
      contents: 'fn main() { println!("hello"); }',
    };
    expect(renderer.renderFile(rust)).toBeUndefined();
    await waitFor(() => updated);
    expect(updated).toBe(true);
    expect(renderer.renderFile(rust)).toBeDefined();
  });

  test('an attached editor switches its existing tokenizer to a new backend', async () => {
    const dom = installDom();
    let tokenizer: EditorTokenizer | undefined;
    try {
      const highlights = await getSharedHighlighter({
        themes: ['pierre-dark'],
      });
      const shiki = await getSharedHighlighter({
        themes: ['pierre-dark'],
        langs: ['typescript'],
        preferredHighlighter: 'shiki-js',
      });
      const document = new TextDocument(
        'example.ts',
        'const text = "hello";',
        'typescript'
      );
      tokenizer = new EditorTokenizer({
        highlighter: highlights,
        textDocument: document,
        codeOptions: { theme: 'pierre-dark' },
        setStyle() {},
        onDeferTokenize() {},
      });
      tokenizer.prebuildTokens();
      tokenizer.syncTheme(
        { theme: 'pierre-dark', preferredHighlighter: 'shiki-js' },
        shiki
      );
      const tokenize = spyOn(shiki, 'codeToTokens');
      try {
        const change = document.applyEdits([
          {
            range: {
              start: { line: 0, character: 14 },
              end: { line: 0, character: 19 },
            },
            newText: 'world',
          },
        ]);
        expect(change).toBeDefined();
        if (change == null)
          throw new Error('Expected an editor document change');
        const lines = tokenizer.tokenize(change);
        expect(tokenize).not.toHaveBeenCalled();
        expect(
          lines
            .get(0)
            ?.map(([, , text]) => text)
            .join('')
        ).toBe('const text = "world";');
      } finally {
        tokenize.mockRestore();
      }
    } finally {
      tokenizer?.cleanUp();
      dom.cleanup();
    }
  });

  for (const preferredHighlighter of ['shiki-wasm', 'shiki-js'] as const) {
    test(`editor shares its document with ${preferredHighlighter} without taking text snapshots`, async () => {
      const dom = installDom();
      const highlighter = await getSharedHighlighter({
        themes: ['pierre-dark'],
        langs: ['typescript'],
        preferredHighlighter,
      });
      const document = new TextDocument(
        'example.ts',
        'const x = 1;\n// end',
        'typescript'
      );
      const createTokenizer = spyOn(highlighter, 'createLiveTokenizer');
      const getText = spyOn(document, 'getText').mockImplementation(() => {
        throw new Error(
          'Editor tokenization must read the shared document by line'
        );
      });
      let tokenizer: EditorTokenizer | undefined;
      try {
        tokenizer = new EditorTokenizer({
          highlighter,
          textDocument: document,
          codeOptions: { theme: 'pierre-dark', preferredHighlighter },
          setStyle() {},
          onDeferTokenize() {},
        });
        tokenizer.prebuildTokens();
        expect(createTokenizer.mock.calls[0][0].textDocument).toBe(document);
        const change = document.applyEdits([
          {
            range: {
              start: { line: 0, character: 10 },
              end: { line: 0, character: 11 },
            },
            newText: '42',
          },
        ]);
        const lines = tokenizer.tokenize(change!);
        expect(
          lines
            .get(0)
            ?.map(([, , text]) => text)
            .join('')
        ).toBe('const x = 42;');
        // Missing one edit requires a cache reset against the same document.
        document.applyEdits([
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: '/*',
          },
        ]);
        const latest = document.applyEdits([
          {
            range: {
              start: { line: 1, character: 6 },
              end: { line: 1, character: 6 },
            },
            newText: ' */',
          },
        ]);
        const reset = tokenizer.tokenize(latest!);
        expect(
          reset
            .get(1)
            ?.map(([, , text]) => text)
            .join('')
        ).toBe('// end */');
        expect(tokenizer.getStringCommentRegexpRangesInLine(1)).toEqual([
          [0, 9],
        ]);
        expect(getText).not.toHaveBeenCalled();
      } finally {
        tokenizer?.cleanUp();
        getText.mockRestore();
        createTokenizer.mockRestore();
        dom.cleanup();
      }
    });

    for (const lineEnding of ['\n', '\r']) {
      test(`editor edits use ${preferredHighlighter} tokens and bracket ranges with ${lineEnding === '\r' ? 'CR' : 'LF'} rows`, async () => {
        const dom = installDom();
        let tokenizer: EditorTokenizer | undefined;
        try {
          const highlighter = await getSharedHighlighter({
            themes: ['pierre-dark'],
            langs: ['typescript'],
            preferredHighlighter,
          });
          const document = new TextDocument(
            'example.ts',
            ['const a = 1;', 'const text = "(ok)";'].join(lineEnding),
            'typescript'
          );
          tokenizer = new EditorTokenizer({
            highlighter,
            textDocument: document,
            codeOptions: { theme: 'pierre-dark', preferredHighlighter },
            setStyle() {},
            onDeferTokenize() {},
          });
          const change = document.applyEdits([
            {
              range: {
                start: { line: 0, character: 10 },
                end: { line: 0, character: 11 },
              },
              newText: '42',
            },
          ]);
          expect(change).toBeDefined();
          if (change == null)
            throw new Error('Expected an editor document change');
          const lines = tokenizer.tokenize(change);
          const expected = highlighter.codeToTokens(document.getText(), {
            lang: 'typescript',
            theme: highlighter.getTheme('pierre-dark'),
            tokenizeMaxLineLength: 1000,
          }).tokens;
          for (const [line, tokens] of lines) {
            expect(tokens.map(([, , content]) => content).join('')).toBe(
              document.getLineText(line)
            );
            const offset = document.offsetAt({ line, character: 0 });
            expect(tokens).toEqual(
              expected[line].map((token) => [
                token.offset - offset,
                token.color ?? '',
                token.content,
              ])
            );
          }
          const ignored = tokenizer.getStringCommentRegexpRangesInLine(1);
          expect(ignored?.some(([start, end]) => start <= 14 && end > 14)).toBe(
            true
          );
        } finally {
          tokenizer?.cleanUp();
          dom.cleanup();
        }
      });
    }
  }
});
