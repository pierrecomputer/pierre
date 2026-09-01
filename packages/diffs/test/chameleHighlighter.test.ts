import { transformerStyleToClass } from '@shikijs/transformers';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ElementContent } from 'hast';
import { toHtml } from 'hast-util-to-html';

import chameleHighlighter from '../src/chamele';
import type { CodeHighlighter } from '../src/highlighter/code_highlighter';
import { setHighlighter } from '../src/highlighter/code_highlighter';
import {
  getCodeHighlighter,
  getCustomHighlighter,
} from '../src/highlighter/resolve_highlighter';
import { shikiHighlighter } from '../src/highlighter/shiki_highlighter';
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
    setHighlighter(chameleHighlighter);
    expect(getCodeHighlighter().name).toBe('chamele');
    expect(getCustomHighlighter()?.name).toBe('chamele');
    setHighlighter(shikiHighlighter);
    expect(getCodeHighlighter().name).toBe('shiki');
    expect(getCustomHighlighter()).toBeUndefined();
  });

  test('a custom highlighter exposing getShikiInstance stays custom', () => {
    // only the built-in adapter (by identity) routes to the pre-existing
    // shiki code paths; implementing the hook must not bypass load/isReady
    const wrapped: CodeHighlighter = {
      ...chameleHighlighter,
      name: 'wrapped',
      getShikiInstance: () => undefined,
    };
    setHighlighter(wrapped);
    expect(getCustomHighlighter()?.name).toBe('wrapped');
    setHighlighter(shikiHighlighter);
    expect(getCustomHighlighter()).toBeUndefined();
  });
});

describe('chamele highlighter', () => {
  beforeAll(() => {
    setHighlighter(chameleHighlighter);
  });
  afterAll(() => {
    setHighlighter(shikiHighlighter);
  });

  test('loads synchronously and resolves theme metadata', async () => {
    expect(
      chameleHighlighter.isReady({
        langs: ['typescript'],
        themes: ['pierre-dark'],
      })
    ).toBe(true);
    await chameleHighlighter.load({
      langs: ['typescript'],
      themes: ['pierre-dark'],
    });
    const theme = chameleHighlighter.getTheme('pierre-dark');
    expect(theme.type).toBe('dark');
    expect(theme.bg).toMatch(/^#/);
    expect(chameleHighlighter.getTheme('pierre-light').type).toBe('light');
  });

  test('getTheme maps Zed editor colors onto VS Code color keys', () => {
    const { colors } = chameleHighlighter.getTheme('pierre-dark');
    expect(colors?.['editor.selectionBackground']).toBe('#009fff4d');
    expect(colors?.['editor.lineHighlightBackground']).toBe('#19283c8c');
    expect(colors?.['editorCursor.foreground']).toBe('#009fff');
    // keys the Zed theme lacks stay unset so the editor keeps its fallbacks
    expect(colors?.['editorBracketMatch.background']).toBeUndefined();
    // shiki bundled-theme names resolve straight to chamele's bundle
    expect(
      chameleHighlighter.getTheme('one-dark-pro').colors?.[
        'editor.selectionBackground'
      ]
    ).toBe('#67769660');
    // Pierre variant names resolve through the alias table
    expect(chameleHighlighter.getTheme('pierre-dark-vibrant').colors).toEqual(
      colors
    );
  });

  test('renderFileWithHighlighter renders chamele tokens per line', () => {
    const { code, themeStyles, baseThemeType } = renderFileWithHighlighter(
      file,
      chameleHighlighter,
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
    // dual-theme custom properties with chamele's pierre-dark keyword color
    expect(html).toContain('--diffs-token-dark:#ff678d');
    expect(html).toContain('--diffs-token-light:');
    expect(html).toContain('const ');
  });

  test('unknown languages render as plain text instead of throwing', () => {
    const { code } = renderFileWithHighlighter(
      { name: 'main.rb', contents: 'puts "hello"\n' },
      chameleHighlighter,
      fileOptions
    );
    expect(linesToHtml(code)).toContain('puts ');
  });

  test('renderDiffWithHighlighter emits word-diff decorations', () => {
    const diff = parseDiffFromFile(
      { name: 'file.ts', contents: 'const oldValue = 1;\n' },
      { name: 'file.ts', contents: 'const newValue = 2;\n' }
    );
    const { code } = renderDiffWithHighlighter(diff, chameleHighlighter, {
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

  test('TokenizeStream emits completed lines and flushes the tail', () => {
    const stream = new chameleHighlighter.TokenizeStream({
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
    const { code } = renderFileWithHighlighter(file, chameleHighlighter, {
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
    const root = chameleHighlighter.codeToHast('const a = 1\n', {
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
    setHighlighter(chameleHighlighter);
    const renderer = new FileRenderer();
    expect(renderer.renderFile(file)).toBeDefined();
    let replacementRenders = 0;
    const replacement: CodeHighlighter = {
      ...chameleHighlighter,
      name: 'chamele-replacement',
      codeToHast(code, options) {
        replacementRenders++;
        return chameleHighlighter.codeToHast(code, options);
      },
    };
    setHighlighter(replacement);
    // the cached markup from the previous highlighter must not be served
    expect(renderer.renderFile(file)).toBeDefined();
    expect(replacementRenders).toBeGreaterThan(0);
    setHighlighter(chameleHighlighter);
  });

  test('preloadFile renders SSR markup through chamele', async () => {
    const { prerenderedHTML } = await preloadFile({
      file,
      options: { theme: { dark: 'pierre-dark', light: 'pierre-light' } },
    });
    // chamele's pierre-dark keyword color proves which implementation ran
    expect(prerenderedHTML).toContain('--diffs-token-dark:#ff678d');
    expect(prerenderedHTML).toContain('data-dehydrated');
    expect(prerenderedHTML).toContain('const ');
  });

  test('createLiveTokenizer applies edits and reports bracket ranges', () => {
    const live = chameleHighlighter.createLiveTokenizer?.({
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
});
