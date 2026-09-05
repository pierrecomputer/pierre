import oneDarkPro from '@pierre/highlights/themes/one-dark-pro';
import { transformerStyleToClass } from '@shikijs/transformers';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ElementContent } from 'hast';
import { toHtml } from 'hast-util-to-html';

import type { CodeHighlighter } from '../src/highlighter/code_highlighter';
import { setHighlighter } from '../src/highlighter/code_highlighter';
import {
  getCodeHighlighter,
  getCustomHighlighter,
} from '../src/highlighter/resolve_highlighter';
import { preloadHighlighter } from '../src/highlighter/resolve_highlighter';
import { shikiHighlighter } from '../src/highlighter/shiki_highlighter';
import highlightsHighlighter from '../src/highlights';
import { FileRenderer } from '../src/renderers/FileRenderer';
import { preloadFile } from '../src/ssr/preloadFile';
import type { FileContents } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../src/utils/renderFileWithHighlighter';

const file: FileContents = {
  name: 'example.ts',
  contents: 'const a = 1; // hi\nlet s = "x";\n',
};

const fileOptions = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' } as const,
  useTokenTransformer: false,
  tokenizeMaxLineLength: 1000,
};

beforeAll(async () => {
  await highlightsHighlighter.load({
    langs: ['typescript'],
    themes: ['pierre-dark', 'pierre-light', 'one-dark-pro'],
  });
});

function linesToHtml(lines: ElementContent[]): string {
  return lines.map((line) => toHtml(line)).join('\n');
}

describe('registration', () => {
  test('the registry defaults to the built-in shiki highlighter', () => {
    expect(getCodeHighlighter().name).toBe('shiki');
    // the shiki implementation is not a "custom" highlighter: pre-existing
    // shiki code paths (worker pool, TextMate edit mode) stay active
    expect(getCustomHighlighter()).toBeUndefined();
  });

  test('setHighlighter overrides the default registration', () => {
    setHighlighter(highlightsHighlighter);
    expect(getCodeHighlighter().name).toBe('highlights');
    expect(getCustomHighlighter()?.name).toBe('highlights');
    setHighlighter(shikiHighlighter);
    expect(getCodeHighlighter().name).toBe('shiki');
    expect(getCustomHighlighter()).toBeUndefined();
  });

  test('a custom highlighter exposing getShikiInstance stays custom', () => {
    // only the built-in adapter (by identity) routes to the pre-existing
    // shiki code paths; implementing the hook must not bypass load/isReady
    const wrapped: CodeHighlighter = {
      ...highlightsHighlighter,
      name: 'wrapped',
      getShikiInstance: () => undefined,
    };
    setHighlighter(wrapped);
    expect(getCustomHighlighter()?.name).toBe('wrapped');
    setHighlighter(shikiHighlighter);
    expect(getCustomHighlighter()).toBeUndefined();
  });
});

describe('registration races', () => {
  afterAll(() => {
    setHighlighter(shikiHighlighter);
  });

  test('a stale async load cannot restore the previous highlighter', async () => {
    let resolveLoad: (() => void) | undefined;
    let slowRenders = 0;
    const slow: CodeHighlighter = {
      ...highlightsHighlighter,
      name: 'slow',
      isReady: () => false,
      load: () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        }),
      codeToHast(code, options) {
        slowRenders++;
        return highlightsHighlighter.codeToHast(code, options);
      },
    };
    let highlightsRenders = 0;
    const fast: CodeHighlighter = {
      ...highlightsHighlighter,
      name: 'fast',
      codeToHast(code, options) {
        highlightsRenders++;
        return highlightsHighlighter.codeToHast(code, options);
      },
    };
    setHighlighter(slow);
    const renderer = new FileRenderer();
    const pending = renderer.initializeHighlighter();
    // the registration changes while the slow load is still in flight
    setHighlighter(fast);
    expect(renderer.renderFile(file)).toBeDefined();
    const after = highlightsRenders;
    resolveLoad?.();
    await pending;
    // a fresh render pass must keep using the current implementation, not
    // the one whose load resolved late
    renderer.clearRenderCache();
    expect(renderer.renderFile(file)).toBeDefined();
    expect(slowRenders).toBe(0);
    expect(highlightsRenders).toBeGreaterThan(after);
  });

  test('preloadHighlighter loads the registered implementation', async () => {
    const loads: unknown[] = [];
    const custom: CodeHighlighter = {
      ...highlightsHighlighter,
      name: 'preloadable',
      load(options) {
        loads.push(options);
      },
    };
    setHighlighter(custom);
    await preloadHighlighter({
      langs: ['typescript'],
      themes: ['pierre-dark'],
    });
    expect(loads).toHaveLength(1);
  });
});

describe('highlights highlighter', () => {
  beforeAll(() => {
    setHighlighter(highlightsHighlighter);
  });
  afterAll(() => {
    setHighlighter(shikiHighlighter);
  });

  test('lazy-loads themes by ID and resolves theme metadata', async () => {
    expect(
      highlightsHighlighter.isReady({
        langs: ['typescript'],
        themes: ['pierre-dark'],
      })
    ).toBe(true);
    await highlightsHighlighter.load({
      langs: ['typescript'],
      themes: ['pierre-dark'],
    });
    const theme = highlightsHighlighter.getTheme('pierre-dark');
    expect(theme.type).toBe('dark');
    expect(theme.bg).toMatch(/^#/);
    expect(highlightsHighlighter.getTheme('pierre-light').type).toBe('light');

    expect(
      highlightsHighlighter.isReady({ langs: [], themes: ['atom-one-dark'] })
    ).toBe(false);
    await highlightsHighlighter.load({ langs: [], themes: ['atom-one-dark'] });
    expect(highlightsHighlighter.getTheme('atom-one-dark').type).toBe('dark');
  });

  test('getTheme maps Zed editor colors onto VS Code color keys', () => {
    const { colors } = highlightsHighlighter.getTheme('pierre-dark');
    expect(colors?.['editor.selectionBackground']).toBe('#009fff4d');
    expect(colors?.['editor.lineHighlightBackground']).toBe('#19283c8c');
    expect(colors?.['editorCursor.foreground']).toBe('#009fff');
    // keys the Zed theme lacks stay unset so the editor keeps its fallbacks
    expect(colors?.['editorBracketMatch.background']).toBeUndefined();
    // shiki bundled-theme names resolve straight to highlights's bundle; the
    // expected value comes from the bundled theme itself so upstream theme
    // tuning does not break the mapping assertion
    expect(
      highlightsHighlighter.getTheme('one-dark-pro').colors?.[
        'editor.selectionBackground'
      ]
    ).toBe(oneDarkPro.style.players?.[0]?.selection as string);
    // Pierre variant names resolve through the alias table
    expect(
      highlightsHighlighter.getTheme('pierre-dark-vibrant').colors
    ).toEqual(colors);
  });

  test('renderFileWithHighlighter renders highlights tokens per line', () => {
    const { code, themeStyles, baseThemeType } = renderFileWithHighlighter(
      file,
      highlightsHighlighter,
      fileOptions
    );
    expect(baseThemeType).toBeUndefined();
    expect(themeStyles).toContain('--diffs-dark:#fafafa');
    expect(themeStyles).toContain('--diffs-dark-bg:#0a0a0a');
    // one hast node per line, tagged by processLine
    expect(code).toHaveLength(3);
    const html = linesToHtml(code);
    expect(html).toContain('data-line="1"');
    expect(html).toContain('data-line-type="context"');
    // dual-theme custom properties with highlights's pierre-dark keyword color
    expect(html).toContain('--diffs-token-dark:#ff678d');
    expect(html).toContain('--diffs-token-light:');
    expect(html).toContain('const ');
  });

  test('unknown languages render as plain text instead of throwing', () => {
    const { code } = renderFileWithHighlighter(
      { name: 'main.rb', contents: 'puts "hello"\n' },
      highlightsHighlighter,
      fileOptions
    );
    expect(linesToHtml(code)).toContain('puts ');
  });

  test('renderDiffWithHighlighter emits word-diff decorations', () => {
    const diff = parseDiffFromFile(
      { name: 'file.ts', contents: 'const oldValue = 1;\n' },
      { name: 'file.ts', contents: 'const newValue = 2;\n' }
    );
    const { code } = renderDiffWithHighlighter(diff, highlightsHighlighter, {
      ...fileOptions,
      lineDiffType: 'word',
      maxLineDiffLength: 1000,
    });
    const deletionHtml = linesToHtml(code.deletionLines);
    const additionHtml = linesToHtml(code.additionLines);
    expect(deletionHtml).toContain('data-line-type="change-deletion"');
    expect(additionHtml).toContain('data-line-type="change-addition"');
    // intra-line word diff wraps the changed spans
    expect(deletionHtml).toContain('data-diff-span');
    expect(additionHtml).toContain('data-diff-span');
    expect(additionHtml).toContain('newValue');
  });

  test('StreamTokenizer emits completed lines and flushes the tail', () => {
    const stream = new highlightsHighlighter.StreamTokenizer({
      lang: 'ts',
      theme: 'pierre-dark',
    });
    const first = stream.pushCode('const a = `x\ny`; //');
    expect(first).toHaveLength(1);
    expect(first[0].map((token) => token.content).join('')).toBe(
      'const a = `x'
    );
    const rest = stream.pushCode(' done');
    expect(rest).toHaveLength(0);
    const tail = stream.end();
    expect(tail).toHaveLength(1);
    expect(tail[0].map((token) => token.content).join('')).toBe('y`; // done');
  });

  test('tokenizeMaxLineLength renders overlong lines as one plain token', () => {
    const { code } = renderFileWithHighlighter(file, highlightsHighlighter, {
      ...fileOptions,
      tokenizeMaxLineLength: 5,
    });
    const html = linesToHtml(code);
    // both lines exceed the cap: content survives, keyword coloring does not
    expect(html).toContain('const a = 1; // hi');
    expect(html).not.toContain('--diffs-token-dark:#ff678d');
  });

  test('shiki transformers using the this-context work (styleToClass)', () => {
    const transformer = transformerStyleToClass();
    const root = highlightsHighlighter.codeToHast('const a = 1\n', {
      lang: 'typescript',
      themes: { dark: 'pierre-dark', light: 'pierre-light' },
      defaultColor: false,
      transformers: [transformer],
    });
    const html = toHtml(root);
    // token styles moved into registered classes (via token htmlAttrs), and
    // the pre style moved through the context's addClassToHast
    expect(html).toContain('__shiki_');
    expect(html).not.toContain('style=');
    expect(transformer.getCSS()).toContain('--cha-dark:');
  });

  test('FileRenderer re-renders through a newly registered highlighter', () => {
    setHighlighter(highlightsHighlighter);
    const renderer = new FileRenderer();
    expect(renderer.renderFile(file)).toBeDefined();
    let replacementRenders = 0;
    const replacement: CodeHighlighter = {
      ...highlightsHighlighter,
      name: 'highlights-replacement',
      codeToHast(code, options) {
        replacementRenders++;
        return highlightsHighlighter.codeToHast(code, options);
      },
    };
    setHighlighter(replacement);
    // the cached markup from the previous highlighter must not be served
    expect(renderer.renderFile(file)).toBeDefined();
    expect(replacementRenders).toBeGreaterThan(0);
    setHighlighter(highlightsHighlighter);
  });

  test('preloadFile renders SSR markup through highlights', async () => {
    const { prerenderedHTML } = await preloadFile({
      file,
      options: { theme: { dark: 'pierre-dark', light: 'pierre-light' } },
    });
    // highlights's pierre-dark keyword color proves which implementation ran
    expect(prerenderedHTML).toContain('--diffs-token-dark:#ff678d');
    expect(prerenderedHTML).toContain('data-dehydrated');
    expect(prerenderedHTML).toContain('const ');
  });

  test('createLiveTokenizer applies edits and reports bracket ranges', () => {
    const live = highlightsHighlighter.createLiveTokenizer?.({
      lang: 'typescript',
      theme: 'pierre-dark',
      code: 'function f() {\n  return 1;\n}',
    });
    expect(live).toBeDefined();
    expect(live!.lineCount).toBe(3);

    const line = live!.getLineTokens(1);
    expect(line.tokens.map(([, , text]) => text).join('')).toBe('  return 1;');

    const update = live!.applyEdits(
      [
        {
          range: {
            start: { line: 1, character: 2 },
            end: { line: 1, character: 11 },
          },
          newText: 'return "a { b"; // c(d)',
        },
      ],
      { renderRange: [0, 3] }
    );
    expect(update.lineCount).toBe(3);
    // convergence may re-tokenize a following line before the lexer state
    // provably matches; the edited line is always included
    expect([...update.lines.keys()]).toContain(1);
    const edited = live!.getLineTokens(1);
    expect(edited.tokens.map(([, , text]) => text).join('')).toBe(
      '  return "a { b"; // c(d)'
    );
    // the string and the trailing comment are ignored for bracket matching
    expect(edited.bracketIgnoredRanges).toEqual([
      [9, 16],
      [18, 25],
    ]);
    live!.dispose();
  });

  test('pending inserted lines expose their text as one unthemed token', () => {
    const live = highlightsHighlighter.createLiveTokenizer?.({
      lang: 'typescript',
      theme: 'pierre-dark',
      code: 'const a = 1;\nconst b = 2;',
    });
    // splice in 50 lines but tokenize only the first line synchronously
    live!.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 12 },
            end: { line: 0, character: 12 },
          },
          newText: Array.from(
            { length: 50 },
            (_, i) => `\nlet n${i} = ${i};`
          ).join(''),
        },
      ],
      { renderRange: [0, 1] }
    );
    expect(live!.pendingTokenization).toBe(true);
    // deferred work has not reached line 30 and it has no records yet, but
    // it must render its current text, not read back as an empty line
    const pending = live!.getLineTokens(30);
    expect(pending.tokens).toHaveLength(1);
    expect(pending.tokens[0][2]).toBe('let n29 = 29;');
    live!.flush();
    expect(live!.getLineTokens(30).tokens.length).toBeGreaterThan(1);
    live!.dispose();
  });

  test('pause suspends background slices without discarding them', async () => {
    const live = highlightsHighlighter.createLiveTokenizer?.({
      lang: 'typescript',
      theme: 'pierre-dark',
      code: Array.from({ length: 200 }, (_, i) => `let v${i} = ${i};`).join(
        '\n'
      ),
    });
    live!.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'const s = `',
        },
      ],
      { renderRange: [0, 2] }
    );
    expect(live!.pendingTokenization).toBe(true);
    live!.pause?.();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(live!.pendingTokenization).toBe(true);
    live!.resume?.();
    const deadline = Date.now() + 2000;
    while (live!.pendingTokenization && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(live!.pendingTokenization).toBe(false);
    live!.dispose();
  });
});
