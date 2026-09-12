import {
  codeToTokens,
  isSupportedLanguage,
  type Theme,
} from '@pierre/highlights';
import { pierreDark, pierreLight } from '@pierre/highlights/themes';
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import {
  TextDocument,
  type TextDocumentChange,
} from '../src/editor/textDocument';
import { EditorTokenizer, renderLineTokens } from '../src/editor/tokenizer';
import type { TextEdit } from '../src/editor/types';
import type {
  BaseCodeOptions,
  DiffsHighlighter,
  HighlightedToken,
  RenderRange,
  SupportedLanguages,
} from '../src/types';
import { installDom, waitFor } from './domHarness';

const highlighter = {
  getTheme: (name: string) => (name === 'light' ? pierreLight : pierreDark),
} as unknown as DiffsHighlighter;

function renderRange(startingLine: number, totalLines: number): RenderRange {
  return { startingLine, totalLines, bufferBefore: 0, bufferAfter: 0 };
}

function fullChange(document: TextDocument): TextDocumentChange {
  return {
    changes: [],
    startLine: 0,
    startCharacter: 0,
    endCharacter: 0,
    endLine: document.lineCount - 1,
    endedAtDocumentEnd: true,
    previousLineCount: document.lineCount,
    lineCount: document.lineCount,
    lineDelta: 0,
    changedLineRanges: [[0, document.lineCount - 1]],
  };
}

function edit(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
  newText: string
): TextEdit {
  return {
    range: {
      start: { line: startLine, character: startCharacter },
      end: { line: endLine, character: endCharacter },
    },
    newText,
  };
}

// Compare token colors and text to a fresh full-document highlight, independent
// of the live tokenizer's retained lexer state and line-number remapping.
function expectTokens(
  document: TextDocument,
  lines: Map<number, HighlightedToken[]>,
  theme: Theme = pierreDark
): void {
  const language = document.languageId;
  const expected = codeToTokens(document.getText(), {
    lang: isSupportedLanguage(language) ? language : 'text',
    theme,
  }).tokens;
  for (const [line, tokens] of lines) {
    expect(tokens.map(([, , text]) => text).join('')).toBe(
      document.getLineText(line)
    );
    expect(
      tokens.flatMap(([, color, text]) => Array.from(text, () => color))
    ).toEqual(
      expected[line].flatMap(({ color, content }) =>
        Array.from(content, () => color ?? '')
      )
    );
  }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  await waitFor(predicate);
  expect(predicate()).toBe(true);
}

describe('EditorTokenizer', () => {
  let dom: ReturnType<typeof installDom>;
  const tokenizers: EditorTokenizer[] = [];
  beforeEach(() => {
    dom = installDom();
  });
  afterEach(() => {
    for (const tokenizer of tokenizers) tokenizer.cleanUp();
    tokenizers.length = 0;
    dom.cleanup();
  });

  function create(
    code: string,
    options: {
      lang?: SupportedLanguages;
      codeOptions?: BaseCodeOptions;
      matchBrackets?: boolean;
      theme?: Theme;
    } = {}
  ) {
    const document = new TextDocument(
      'test.ts',
      code,
      options.lang ?? 'typescript'
    );
    const deferred = new Map<number, HighlightedToken[]>();
    const modes: string[] = [];
    let style = '';
    let themeChanges = 0;
    const tokenizer = new EditorTokenizer({
      highlighter:
        options.theme === undefined
          ? highlighter
          : ({ getTheme: () => options.theme } as unknown as DiffsHighlighter),
      textDocument: document,
      codeOptions: { theme: 'dark', themeType: 'dark', ...options.codeOptions },
      matchBrackets: options.matchBrackets,
      setStyle: (value) => {
        style = value;
      },
      onDeferTokenize: (lines, themeType) => {
        modes.push(themeType);
        for (const [line, tokens] of lines) deferred.set(line, tokens);
      },
      onThemeChange: () => {
        themeChanges++;
      },
    });
    tokenizers.push(tokenizer);
    return {
      tokenizer,
      document,
      deferred,
      modes,
      get style() {
        return style;
      },
      get themeChanges() {
        return themeChanges;
      },
      initialize(range?: RenderRange) {
        return tokenizer.tokenize(fullChange(document), range);
      },
      update(edits: TextEdit[], range?: RenderRange, hostRealignsRows = false) {
        const change = document.applyEdits(edits);
        if (change === undefined) throw new Error('Expected an edit');
        tokenizer.stopBackgroundTokenize();
        return tokenizer.tokenize(change, range, hostRealignsRows);
      },
    };
  }

  test('a pinned theme keeps its own appearance', () => {
    const { tokenizer } = create('const x = 1', {
      codeOptions: { theme: 'dark', themeType: 'light' },
    });
    expect(tokenizer.themeType).toBe('dark');
    tokenizer.syncTheme({ theme: 'dark', themeType: 'light' });
    expect(tokenizer.themeType).toBe('dark');
  });

  test('maps Zed editor colors to selection, cursor, search and diagnostic styles', () => {
    const { style } = create('', {
      theme: {
        name: 'Editor colors',
        appearance: 'dark',
        style: {
          players: [{ selection: '#123456', cursor: '#234567' }],
          'editor.active_line.background': '#34567880',
          'editor.document_highlight.bracket_background': '#456789',
          'search.match_background': '#567890',
          hint: '#678901',
          info: '#789012',
          warning: '#890123',
          error: '#901234',
        },
      },
    });
    expect(style).toContain('--diffs-editor-selection-bg: #123456;');
    expect(style).toContain('--diffs-editor-cursor-fg: #234567;');
    expect(style).toContain('--diffs-editor-active-line-source-mix: 85%;');
    expect(style).toContain(
      '--diffs-editor-line-highlight-border: transparent;'
    );
    expect(style).toContain('--diffs-editor-bracket-match-bg: #456789;');
    expect(style).toContain('--diffs-editor-match-bg: #567890;');
    expect(style).toContain('--diffs-editor-hint-fg: #678901;');
    expect(style).toContain('--diffs-editor-info-fg: #789012;');
    expect(style).toContain('--diffs-editor-warning-fg: #890123;');
    expect(style).toContain('--diffs-editor-error-fg: #901234;');
  });

  test.each([undefined, '', '#00000000'])(
    'uses a border for an absent or transparent active-line background (%s)',
    (background) => {
      const { style } = create('', {
        theme: {
          name: 'Border',
          appearance: 'dark',
          style: { 'editor.active_line.background': background },
        },
      });
      expect(style).toContain('--diffs-editor-active-line-source-mix: 100%;');
      expect(style).toContain(
        '--diffs-editor-line-highlight-border: color-mix('
      );
    }
  );

  test('plain text and empty lines render without a language-loading step', () => {
    const instance = create('hello\n\nworld', { lang: 'text' });
    const lines = instance.initialize();
    expect([...lines.keys()]).toEqual([0, 1, 2]);
    expectTokens(instance.document, lines);
    expect(renderLineTokens(lines.get(1) ?? [])[0]).toBeInstanceOf(HTMLElement);
    expect(
      (renderLineTokens(lines.get(1) ?? [])[0] as HTMLElement).tagName
    ).toBe('BR');
    expect(instance.tokenizer.getStringCommentRegexpRangesInLine(0)).toBeNull();
  });

  test('bracket matching excludes strings, comments and regex literals', () => {
    const instance = create(
      'const x = "["; // }\nconst r = /[()]/;\n/* {\n} */\n({})'
    );
    const ranges = instance.tokenizer.getStringCommentRegexpRangesInLine(0);
    expect(
      ranges?.map(([start, end]) =>
        instance.document.getLineText(0).slice(start, end)
      )
    ).toEqual(['"["', '// }']);
    expect(
      instance.tokenizer
        .getStringCommentRegexpRangesInLine(1)
        ?.map(([start, end]) =>
          instance.document.getLineText(1).slice(start, end)
        )
    ).toEqual(['/[()]/']);
    expect(instance.tokenizer.getStringCommentRegexpRangesInLine(3)).toEqual([
      [0, 4],
    ]);
    expect(instance.tokenizer.getStringCommentRegexpRangesInLine(4)).toBeNull();
    expect(
      instance.tokenizer.getStringCommentRegexpRangesInLine(-1)
    ).toBeNull();
    expect(instance.tokenizer.getStringCommentRegexpRangesInLine(5)).toBeNull();
  });

  test('disabling bracket matching avoids ignored ranges', () => {
    const { tokenizer } = create('"["', { matchBrackets: false });
    expect(tokenizer.getStringCommentRegexpRangesInLine(0)).toBeNull();
  });

  test('retains downstream bracket ranges after a same-line edit converges', () => {
    const instance = create('const x = 1;\n"["\n// {');
    instance.initialize();
    const lines = instance.update([edit(0, 10, 0, 11, '2')]);
    expect([...lines.keys()]).toEqual([0]);
    expectTokens(instance.document, lines);
    expect(instance.tokenizer.getStringCommentRegexpRangesInLine(2)).toEqual([
      [0, 4],
    ]);
  });

  test('line-length limits retain multiline lexer state', () => {
    const instance = create('/* a long comment\ninside\n*/ const x = 1;', {
      codeOptions: { tokenizeMaxLineLength: 15 },
    });
    const lines = instance.initialize();
    expect(lines.get(0)).toHaveLength(1);
    expect(instance.tokenizer.getStringCommentRegexpRangesInLine(1)).toEqual([
      [0, 6],
    ]);
    expect(instance.tokenizer.getStringCommentRegexpRangesInLine(0)).toBeNull();
  });

  test('same-line edits propagate changes to multiline state', () => {
    const instance = create('const x = 1;\nconst y = 2;\nconst z = 3;');
    instance.initialize();
    const lines = instance.update([edit(0, 0, 0, 0, '/*')]);
    expect([...lines.keys()]).toEqual([0, 1, 2]);
    expectTokens(instance.document, lines);
    expect(instance.tokenizer.getStringCommentRegexpRangesInLine(2)).toEqual([
      [0, 12],
    ]);
  });

  test('disjoint edits skip unchanged lines after convergence', () => {
    const instance = create(
      Array.from({ length: 100 }, (_, line) => `const x${line} = 1;`).join('\n')
    );
    instance.initialize();
    const lines = instance.update([
      edit(1, 11, 1, 12, '2'),
      edit(80, 12, 80, 13, '3'),
    ]);
    expect([...lines.keys()]).toEqual([1, 80]);
    expectTokens(instance.document, lines);
  });

  test('redrawing an unchanged viewport reuses the tokenized document', () => {
    const instance = create('const a = 1;\nconst b = "value";\n// end');
    instance.initialize();
    const getText = spyOn(instance.document, 'getText');
    try {
      const lines = instance.initialize(renderRange(1, 2));
      expect([...lines.keys()]).toEqual([1, 2]);
      expect(getText).not.toHaveBeenCalled();
      expectTokens(instance.document, lines);
    } finally {
      getText.mockRestore();
    }
  });

  test('resets from the current document after an edit was missed', () => {
    const instance = create('const a = 1;\nconst b = 2;');
    instance.initialize();
    instance.document.applyEdits([edit(0, 10, 0, 11, '21')]);
    const change = instance.document.applyEdits([edit(1, 10, 1, 11, '42')]);
    if (change === undefined) throw new Error('Expected an edit');
    const lines = instance.tokenizer.tokenize(change);
    expect([...lines.keys()]).toEqual([0, 1]);
    expectTokens(instance.document, lines);
  });

  test('coalesced undo and redo keep downstream tokens cached', () => {
    const instance = create('const a = 1;\nconst b = "value";');
    instance.initialize();
    instance.update([edit(0, 11, 0, 11, '2')]);
    instance.update([edit(0, 12, 0, 12, '3')]);
    const undone = instance.document.undo();
    if (undone === undefined) throw new Error('Expected an undo');
    expect(instance.document.getLineText(0)).toBe('const a = 1;');
    const undoLines = instance.tokenizer.tokenize(undone[0]);
    expect([...undoLines.keys()]).toEqual([0]);
    expectTokens(instance.document, undoLines);
    const redone = instance.document.redo();
    if (redone === undefined) throw new Error('Expected a redo');
    expect(instance.document.getLineText(0)).toBe('const a = 123;');
    const redoLines = instance.tokenizer.tokenize(redone[0]);
    expect([...redoLines.keys()]).toEqual([0]);
    expectTokens(instance.document, redoLines);
  });

  test('insertion shifts visible rows for hosts that replace their content', () => {
    const instance = create(
      Array.from({ length: 20 }, (_, line) => `const x${line} = ${line};`).join(
        '\n'
      )
    );
    instance.initialize();
    const lines = instance.update(
      [edit(1, 0, 1, 0, 'const inserted = true;\n')],
      renderRange(0, 5)
    );
    expect([...lines.keys()]).toEqual([1, 2, 3, 4]);
    expectTokens(instance.document, lines);
  });

  test('virtualized hosts reuse shifted lines when lexer state converges', () => {
    const instance = create(
      Array.from({ length: 20 }, (_, line) => `const x${line} = ${line};`).join(
        '\n'
      )
    );
    instance.initialize();
    const lines = instance.update(
      [edit(1, 0, 1, 0, 'const inserted = true;\n')],
      renderRange(0, 5),
      true
    );
    expect(lines.has(1)).toBe(true);
    expect(lines.has(4)).toBe(false);
    expectTokens(instance.document, lines);
  });

  test.each([false, true])(
    'opposite line-count edits repaint shifted rows when hostRealignsRows is %s',
    (hostRealignsRows) => {
      const instance = create(
        Array.from(
          { length: 10 },
          (_, line) => `const x${line} = ${line};`
        ).join('\n')
      );
      instance.initialize();
      const lines = instance.update(
        [edit(1, 0, 1, 0, 'const inserted = true;\n'), edit(7, 0, 8, 0, '')],
        renderRange(0, 10),
        hostRealignsRows
      );
      expect(instance.document.lineCount).toBe(10);
      for (let line = 1; line < 8; line++) {
        expect(
          lines
            .get(line)
            ?.map(([, , text]) => text)
            .join('')
        ).toBe(instance.document.getLineText(line));
      }
      expectTokens(instance.document, lines);
    }
  );

  test('prepending lines limits foreground output to the viewport and finishes the tail', async () => {
    const instance = create(
      Array.from({ length: 40 }, (_, line) => `const x${line} = 1;`).join('\n')
    );
    instance.initialize();
    const lines = instance.update(
      [edit(0, 0, 0, 0, '/*\n')],
      renderRange(10, 5)
    );
    expect([...lines.keys()]).toEqual([10, 11, 12, 13, 14]);
    expect(instance.deferred.size).toBe(0);
    await waitUntil(() => instance.deferred.has(40));
    expect(instance.deferred.has(0)).toBe(true);
    expectTokens(instance.document, lines);
    expectTokens(instance.document, instance.deferred);
  });

  test('net-zero line shifts refresh cached rows outside the viewport', async () => {
    const instance = create(
      Array.from({ length: 12 }, (_, line) => `const x${line} = ${line};`).join(
        '\n'
      )
    );
    instance.initialize();
    const lines = instance.update(
      [edit(1, 0, 1, 0, '// inserted\n'), edit(8, 0, 9, 0, '')],
      renderRange(5, 2),
      true
    );
    expect([...lines.keys()]).toEqual([5, 6]);
    await waitUntil(() => instance.deferred.has(7));
    for (let line = 1; line <= 8; line++) {
      expect(lines.has(line) || instance.deferred.has(line)).toBe(true);
    }
    expectTokens(instance.document, lines);
    expectTokens(instance.document, instance.deferred);
  });

  test('deleting across the viewport seeds it from the retained open comment', () => {
    const instance = create('/*\na\nb\nc\nd\ne\nf\n*/\nconst x = 1;');
    instance.initialize();
    const lines = instance.update([edit(1, 0, 4, 0, '')], renderRange(2, 3));
    expectTokens(instance.document, lines);
    expectTokens(instance.document, instance.deferred);
    expect(instance.tokenizer.getStringCommentRegexpRangesInLine(2)).toEqual([
      [0, 1],
    ]);
  });

  test('select-all deletion delivers an empty line even when the viewport is past EOF', async () => {
    const instance = create('first\nsecond\nlast');
    instance.initialize();
    const lines = instance.update([edit(0, 0, 2, 4, '')], renderRange(2, 2));
    expect(lines.size).toBe(0);
    instance.tokenizer.getStringCommentRegexpRangesInLine(0);
    await waitUntil(() => instance.deferred.has(0));
    expect(instance.deferred.get(0)).toEqual([[0, '', '']]);
  });

  test('mixed line-count changes and an EOF insertion match a fresh highlight', async () => {
    const instance = create(
      'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;'
    );
    instance.initialize();
    const lines = instance.update(
      [
        edit(0, 0, 0, 0, '// header\n'),
        edit(1, 0, 2, 0, ''),
        edit(4, 12, 4, 12, '\nconst f = 6;'),
      ],
      renderRange(0, 3),
      true
    );
    await waitUntil(() => instance.deferred.has(5));
    expectTokens(instance.document, lines);
    expectTokens(instance.document, instance.deferred);
  });

  test('pauses and resumes deferred work', async () => {
    const instance = create(
      Array.from({ length: 200 }, () => 'const x = 1;').join('\n')
    );
    instance.initialize();
    instance.update([edit(0, 0, 0, 0, '/*')], renderRange(0, 1));
    instance.tokenizer.pauseBackgroundTokenize();
    await Bun.sleep(20);
    expect(instance.deferred.size).toBe(0);
    instance.tokenizer.resumeBackgroundTokenize();
    await waitUntil(() => instance.deferred.has(199));
    expectTokens(instance.document, instance.deferred);
  });

  test('a newer edit cancels stale deferred work and keeps the current document', async () => {
    const instance = create(
      Array.from({ length: 100 }, () => 'const x = 1;').join('\n')
    );
    instance.initialize();
    instance.update([edit(0, 0, 0, 0, '/*')], renderRange(0, 1));
    instance.update([edit(0, 0, 0, 2, '//')], renderRange(0, 1));
    await Bun.sleep(20);
    expectTokens(instance.document, instance.deferred);
    expect(
      instance.tokenizer.getStringCommentRegexpRangesInLine(99)
    ).toBeNull();
  });

  test('deferred jobs remain isolated between editor instances', async () => {
    const first = create(
      Array.from({ length: 100 }, () => 'const x = 1;').join('\n')
    );
    const second = create(
      Array.from({ length: 100 }, () => 'const y = 2;').join('\n')
    );
    first.initialize();
    second.initialize();
    first.update([edit(0, 0, 0, 0, '/*')], renderRange(0, 1));
    second.update([edit(0, 0, 0, 0, '//')], renderRange(0, 1));
    await waitUntil(() => first.deferred.has(99));
    expectTokens(first.document, first.deferred);
    expect(second.deferred.has(99)).toBe(false);
    expectTokens(second.document, second.deferred);
  });

  test('cleanup discards queued work and repeated cleanup is harmless', async () => {
    const instance = create('const x = 1;\nconst y = 2;');
    instance.tokenizer.prebuildTokens();
    instance.tokenizer.cleanUp();
    instance.tokenizer.cleanUp();
    await Bun.sleep(20);
    expect(instance.deferred.size).toBe(0);
  });

  test('theme swaps update styles and deferred colors once', async () => {
    const instance = create('const x = "value";');
    instance.initialize();
    instance.tokenizer.syncTheme({ theme: 'light' });
    instance.tokenizer.syncTheme({ theme: 'light' });
    await waitUntil(() => instance.deferred.has(0));
    expect(instance.tokenizer.themeType).toBe('light');
    expect(instance.themeChanges).toBe(1);
    expectTokens(instance.document, instance.deferred, pierreLight);
    expect(instance.modes).toEqual(['light']);
  });

  test('theme swaps recolor cached rows before and after a bounded viewport', async () => {
    const instance = create(
      Array.from({ length: 8 }, (_, line) => `const x${line} = "value";`).join(
        '\n'
      )
    );
    instance.initialize(renderRange(2, 3));
    await waitUntil(() => instance.deferred.has(7));
    instance.deferred.clear();
    instance.modes.length = 0;
    instance.tokenizer.syncTheme({ theme: 'light' });
    await waitUntil(() => instance.deferred.has(7));
    expect([...instance.deferred.keys()].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(instance.modes.every((mode) => mode === 'light')).toBe(true);
    expectTokens(instance.document, instance.deferred, pierreLight);
  });

  test('changing the line-length limit refreshes tokens and bracket ranges', async () => {
    const instance = create('const value = "string";\nconst x = 1;', {
      codeOptions: { tokenizeMaxLineLength: 100 },
    });
    instance.initialize();
    instance.tokenizer.syncTheme({ theme: 'dark', tokenizeMaxLineLength: 10 });
    await waitUntil(() => instance.deferred.has(0));
    expect(instance.deferred.get(0)).toHaveLength(1);
    expect(instance.tokenizer.getStringCommentRegexpRangesInLine(0)).toBeNull();
    instance.deferred.clear();
    instance.tokenizer.syncTheme({ theme: 'dark', tokenizeMaxLineLength: 100 });
    await waitUntil(() => instance.deferred.has(0));
    expect(
      instance.tokenizer
        .getStringCommentRegexpRangesInLine(0)
        ?.map(([start, end]) =>
          instance.document.getLineText(0).slice(start, end)
        )
    ).toEqual(['"string"']);
    expectTokens(instance.document, instance.deferred);
  });

  test('dual themes honor an explicit appearance and host-forced system changes', async () => {
    document.body.style.colorScheme = 'light';
    const instance = create('const x = 1;', {
      codeOptions: {
        theme: { dark: 'dark', light: 'light' },
        themeType: 'dark',
      },
    });
    expect(instance.tokenizer.themeType).toBe('dark');
    instance.tokenizer.syncTheme({
      theme: { dark: 'dark', light: 'light' },
      themeType: 'system',
    });
    expect(instance.tokenizer.themeType).toBe('light');
    document.body.style.colorScheme = 'dark';
    instance.tokenizer.syncTheme({
      theme: { dark: 'dark', light: 'light' },
      themeType: 'system',
    });
    expect(instance.tokenizer.themeType).toBe('dark');
    await waitUntil(() => instance.deferred.has(0));
    expectTokens(instance.document, instance.deferred);
  });

  test('system observers ignore mutations that do not change the resolved theme', async () => {
    document.body.style.colorScheme = 'light';
    const instance = create('const x = 1;', {
      codeOptions: {
        theme: { dark: 'dark', light: 'light' },
        themeType: 'system',
      },
    });
    document.body.dataset.mode = 'first';
    await Bun.sleep(0);
    expect(instance.themeChanges).toBe(0);
    document.body.style.colorScheme = 'dark';
    document.body.dataset.mode = 'second';
    await waitUntil(() => instance.themeChanges === 1);
    expect(instance.tokenizer.themeType).toBe('dark');
  });

  test.each(['pinned', 'explicit'] as const)(
    'system observers use current options after switching to a %s theme',
    async (mode) => {
      document.body.style.colorScheme = 'light';
      const instance = create('const x = "value";', {
        codeOptions: {
          theme: { dark: 'dark', light: 'light' },
          themeType: 'system',
        },
      });
      instance.initialize();
      instance.tokenizer.syncTheme(
        mode === 'pinned'
          ? { theme: 'dark' }
          : { theme: { dark: 'dark', light: 'light' }, themeType: 'dark' }
      );
      document.body.dataset.mode = 'host-light';
      await Bun.sleep(0);
      expect(instance.tokenizer.themeType).toBe('dark');
      expect(instance.themeChanges).toBe(1);
      await waitUntil(() => instance.deferred.has(0));
      expectTokens(instance.document, instance.deferred);
    }
  );

  test('system observers start following host changes after an explicit theme', async () => {
    document.body.style.colorScheme = 'dark';
    const instance = create('const x = "value";', {
      codeOptions: {
        theme: { dark: 'dark', light: 'light' },
        themeType: 'light',
      },
    });
    instance.initialize();
    instance.tokenizer.syncTheme({
      theme: { dark: 'dark', light: 'light' },
      themeType: 'system',
    });
    expect(instance.tokenizer.themeType).toBe('dark');
    document.body.style.colorScheme = 'light';
    document.body.dataset.mode = 'host-light';
    await waitUntil(() => instance.tokenizer.themeType === 'light');
    await waitUntil(() => instance.modes.at(-1) === 'light');
    expect(instance.themeChanges).toBe(2);
    expectTokens(instance.document, instance.deferred, pierreLight);
  });

  test('system observers read replacement theme names', async () => {
    document.body.style.colorScheme = 'dark';
    const instance = create('const x = "value";', {
      codeOptions: {
        theme: { dark: 'dark', light: 'light' },
        themeType: 'system',
      },
    });
    instance.initialize();
    instance.tokenizer.syncTheme({
      theme: { dark: 'light', light: 'dark' },
      themeType: 'system',
    });
    document.body.style.colorScheme = 'light';
    document.body.dataset.mode = 'host-light';
    await waitUntil(() => instance.tokenizer.themeType === 'light');
    await waitUntil(() => instance.modes.at(-1) === 'light');
    expectTokens(instance.document, instance.deferred, pierreDark);
  });

  test('UTF-16 edits and CRLF lines retain exact content and token offsets', () => {
    const instance = create('const emoji = "😀";\r\nconst x = 1;');
    instance.initialize();
    const lines = instance.update([
      edit(0, 16, 0, 16, 'x'),
      edit(1, 10, 1, 11, '42'),
    ]);
    expectTokens(instance.document, lines);
    expect(lines.get(1)?.[0]?.[0]).toBe(0);
    expect(instance.document.getText()).toContain('\r\n');
  });
});
