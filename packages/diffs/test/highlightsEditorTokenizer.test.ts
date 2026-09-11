import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { TextDocument } from '../src/editor/textDocument';
import type { TextDocumentChange } from '../src/editor/textDocument';
import {
  createEditorTokenizer,
  type EditorTokenizer,
  HighlightsEditorTokenizer,
} from '../src/editor/tokenizer';
import highlightsHighlighter from '../src/highlights';
import { FileRenderer } from '../src/renderers/FileRenderer';
import type { HighlightedToken, RenderRange, ThemedToken } from '../src/types';
import { installDom, waitFor } from './domHarness';

let dom: ReturnType<typeof installDom>;

beforeAll(async () => {
  dom = installDom();
  await highlightsHighlighter.load({
    langs: [],
    themes: ['pierre-dark', 'pierre-light'],
  });
});

afterAll(() => {
  dom.cleanup();
});

interface Harness {
  tokenizer: EditorTokenizer;
  textDocument: TextDocument;
  styles: string[];
  deferred: Map<number, HighlightedToken[]>[];
}

function createHarness(contents: string, languageId = 'ts'): Harness {
  const textDocument = new TextDocument(
    'inmemory://live',
    contents,
    languageId
  );
  const styles: string[] = [];
  const deferred: Map<number, HighlightedToken[]>[] = [];
  const tokenizer = createEditorTokenizer({
    highlighter: highlightsHighlighter,
    textDocument,
    codeOptions: { theme: 'pierre-dark', themeType: 'dark' },
    matchBrackets: true,
    setStyle: (style) => styles.push(style),
    onDeferTokenize: (lines) => deferred.push(lines),
  });
  return { tokenizer, textDocument, styles, deferred };
}

function viewport(startingLine: number, totalLines: number): RenderRange {
  return { startingLine, totalLines, bufferBefore: 0, bufferAfter: 0 };
}

const lineText = (tokens: HighlightedToken[]) =>
  tokens.map(([, , text]) => text).join('');

/** Wait for the live tokenizer's setTimeout(0) background slices to finish. */
function settleTimers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

/** A whole-document change, like the editor's initial paint. */
function fullChange(textDocument: TextDocument): TextDocumentChange {
  const endLine = textDocument.lineCount - 1;
  return {
    changes: [],
    startLine: 0,
    startCharacter: 0,
    endCharacter: 0,
    endLine,
    endedAtDocumentEnd: true,
    previousLineCount: textDocument.lineCount,
    lineCount: textDocument.lineCount,
    lineDelta: 0,
    changedLineRanges: [[0, endLine]],
  };
}

describe('LiveEditorTokenizer', () => {
  test('the factory picks the live tokenizer for highlights', () => {
    const { tokenizer, styles } = createHarness('const a = 1;');
    expect(tokenizer).toBeInstanceOf(HighlightsEditorTokenizer);
    expect(tokenizer.themeType).toBe('dark');
    // editor chrome CSS applied on construction from the Zed theme's editor
    // colors, mapped onto VS Code color keys by the highlights adapter
    expect(styles).toHaveLength(1);
    expect(styles[0]).toContain('--diffs-editor-selection-bg: #009fff4d;');
    expect(styles[0]).toContain('--diffs-editor-cursor-fg: #009fff;');
    expect(styles[0]).toContain('--diffs-editor-active-line-source-mix: 85%;');
    tokenizer.cleanUp();
  });

  test('the first tokenize paints the viewport with colored tokens', () => {
    const { tokenizer, textDocument } = createHarness(
      'const a = 1;\nlet b = 2;\n'
    );
    const dirty = tokenizer.tokenize(fullChange(textDocument));
    expect([...dirty.keys()]).toEqual([0, 1, 2]);
    const first = dirty.get(0)!;
    expect(lineText(first)).toBe('const a = 1;');
    // pierre-dark keyword.declaration
    expect(first[0][1]).toBe('#ff678d');
    expect(first[0][2].startsWith('const')).toBe(true);
    tokenizer.cleanUp();
  });

  test('unchanged lines are not reported dirty on a same-line edit', () => {
    const { tokenizer, textDocument } = createHarness(
      'const a = 1;\nlet b = 2;\nlet c = 3;'
    );
    // initial pass paints everything
    tokenizer.tokenize(fullChange(textDocument));
    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 1, character: 8 },
          end: { line: 1, character: 9 },
        },
        newText: '9',
      },
    ]);
    const dirty = tokenizer.tokenize(change!);
    expect([...dirty.keys()]).toEqual([1]);
    expect(lineText(dirty.get(1)!)).toBe('let b = 9;');
    tokenizer.cleanUp();
  });

  test('coincident inserts preserve batch order without resetting the document', () => {
    const { tokenizer, textDocument } = createHarness(
      'const a = 1;\nlet b = 2;\nlet c = 3;'
    );
    tokenizer.tokenize(fullChange(textDocument));
    const position = { line: 1, character: 4 };
    const change = textDocument.applyEdits([
      { range: { start: position, end: position }, newText: 'X' },
      { range: { start: position, end: position }, newText: 'Y' },
      { range: { start: position, end: position }, newText: 'Z' },
    ]);
    const dirty = tokenizer.tokenize(change!);
    expect([...dirty.keys()]).toEqual([1]);
    expect(lineText(dirty.get(1)!)).toBe('let XYZb = 2;');
    expect(lineText(dirty.get(1)!)).toBe(textDocument.getLineText(1));
    tokenizer.cleanUp();
  });

  test('a custom highlighter without edit support fails explicitly', () => {
    expect(() =>
      createEditorTokenizer({
        highlighter: {
          ...highlightsHighlighter,
          createLiveTokenizer: undefined,
          getShikiInstance: undefined,
        },
        textDocument: new TextDocument(
          'inmemory://unsupported',
          'const a = 1;'
        ),
        codeOptions: { theme: 'pierre-dark' },
        setStyle() {},
        onDeferTokenize() {},
      })
    ).toThrow('must provide createLiveTokenizer or getShikiInstance');
  });

  test('edits inside multi-line constructs re-color later lines', () => {
    const { tokenizer, textDocument } = createHarness(
      'const s = `abc\nrest`; let x = 1;'
    );
    tokenizer.tokenize(fullChange(textDocument));
    // ranges on line 1 start inside the template literal
    expect(tokenizer.getStringCommentRegexpRangesInLine(1)?.[0][0]).toBe(0);
    // close the template on line 0
    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 0, character: 14 },
          end: { line: 0, character: 14 },
        },
        newText: '`',
      },
    ]);
    const dirty = tokenizer.tokenize(change!);
    // line 1 leaves the string, so it must repaint even though its own text
    // did not change
    expect(dirty.has(1)).toBe(true);
    expect(tokenizer.getStringCommentRegexpRangesInLine(1)?.[0][0]).not.toBe(0);
    tokenizer.cleanUp();
  });

  test('bracket-ignored ranges cover strings and comments', () => {
    const { tokenizer } = createHarness('const s = "a { b"; // c(d)');
    expect(tokenizer.getStringCommentRegexpRangesInLine(0)).toEqual([
      [10, 17],
      [19, 26],
    ]);
    tokenizer.cleanUp();
  });

  test('a structural edit without host realignment repaints the rest of the viewport', () => {
    const { tokenizer, textDocument } = createHarness(
      Array.from({ length: 8 }, (_, i) => `const v${i} = ${i};`).join('\n')
    );
    tokenizer.tokenize(fullChange(textDocument), viewport(0, 8));
    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 0 },
        },
        newText: 'let inserted = 0;\n',
      },
    ]);
    const dirty = tokenizer.tokenize(change!, viewport(0, 9), false);
    // rows 2.. all shifted under unmoved DOM, so each repaints
    for (let line = 2; line < 9; line++) {
      expect(dirty.has(line)).toBe(true);
      expect(lineText(dirty.get(line)!)).toBe(textDocument.getLineText(line));
    }
    tokenizer.cleanUp();
  });

  test('with host realignment only re-tokenized lines report dirty', () => {
    const { tokenizer, textDocument } = createHarness(
      Array.from({ length: 8 }, (_, i) => `const v${i} = ${i};`).join('\n')
    );
    tokenizer.tokenize(fullChange(textDocument), viewport(0, 8));
    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 0 },
        },
        newText: 'let inserted = 0;\n',
      },
    ]);
    const dirty = tokenizer.tokenize(change!, viewport(0, 9), true);
    expect(dirty.has(2)).toBe(true);
    // shifted-but-unchanged rows moved with the host's realignment
    expect(dirty.has(5)).toBe(false);
    tokenizer.cleanUp();
  });

  test('off-viewport re-tokenization flows through deferred deliveries', async () => {
    const contents = Array.from(
      { length: 20 },
      (_, i) => `const v${i} = ${i};`
    ).join('\n');
    const { tokenizer, deferred, textDocument } = createHarness(contents);
    tokenizer.tokenize(fullChange(textDocument), viewport(0, 5));
    // open a template literal on line 0: every later line becomes a string
    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: 'const s = `',
      },
    ]);
    tokenizer.tokenize(change!, viewport(0, 5));
    await settleTimers();
    const deferredLines = new Set(deferred.flatMap((map) => [...map.keys()]));
    for (let line = 5; line < 20; line++) {
      expect(deferredLines.has(line)).toBe(true);
    }
    tokenizer.cleanUp();
  });

  test('an edit above the viewport delivers those lines untranslated', () => {
    const contents = Array.from(
      { length: 20 },
      (_, i) => `const v${i} = ${i};`
    ).join('\n');
    const { tokenizer, deferred, textDocument } = createHarness(contents);
    tokenizer.tokenize(fullChange(textDocument), viewport(10, 5));
    deferred.length = 0;
    // a neutral edit on line 0 converges immediately; its re-tokenized line
    // is flushed as finished off-range work during the update and must land
    // in post-edit coordinates (here: unchanged), not be remapped away
    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 0, character: 13 },
          end: { line: 0, character: 14 },
        },
        newText: '9',
      },
    ]);
    tokenizer.tokenize(change!, viewport(10, 5));
    const delivered = new Map(deferred.flatMap((map) => [...map.entries()]));
    expect(delivered.has(0)).toBe(true);
    expect(lineText(delivered.get(0)!)).toBe(textDocument.getLineText(0));
    tokenizer.cleanUp();
  });

  test.each(['one insertion', 'two insertions', 'balanced edits'])(
    '%s: offscreen structural tokens reach the file cache after its rows realign',
    async (batch) => {
      const contents = Array.from(
        { length: 100 },
        (_, i) => `const v${i} = ${i};`
      ).join('\n');
      const file = { name: 'offscreen.ts', contents };
      const renderer = new FileRenderer(
        { theme: 'pierre-dark' },
        undefined,
        undefined,
        undefined,
        highlightsHighlighter
      );
      renderer.beginEditSession(file);
      await renderer.asyncRender(file);
      renderer.renderFile(file);
      const textDocument = new TextDocument<'file', undefined>(
        'inmemory://offscreen',
        contents,
        'ts'
      );
      let deliveriesDuringEdit = 0;
      let editing = false;
      const tokenizer = createEditorTokenizer({
        highlighter: highlightsHighlighter,
        textDocument,
        codeOptions: { theme: 'pierre-dark' },
        setStyle() {},
        onDeferTokenize(lines, themeType) {
          if (editing) deliveriesDuringEdit++;
          renderer.updateRenderCache(lines, themeType);
        },
      });
      tokenizer.prebuildStateStack(viewport(50, 30));
      await settleTimers();
      const cache = (
        renderer as unknown as {
          renderCache: { result: { code: ThemedToken[][] } };
        }
      ).renderCache;
      const retainedRow = cache.result.code[20];
      const change = textDocument.applyEdits([
        {
          range: {
            start: { line: 3, character: 0 },
            end: { line: 3, character: 0 },
          },
          newText: 'let inserted = 1;\n',
        },
        ...(batch === 'one insertion'
          ? []
          : [
              {
                range: {
                  start: { line: 90, character: 0 },
                  end: {
                    line: batch === 'balanced edits' ? 91 : 90,
                    character: 0,
                  },
                },
                newText: batch === 'balanced edits' ? '' : 'let second = 2;\n',
              },
            ]),
      ]);
      editing = true;
      const dirty = tokenizer.tokenize(change!, viewport(50, 30), true);
      renderer.updateRenderCache(
        dirty,
        tokenizer.themeType,
        true,
        change!.changedLineChanges
      );
      renderer.applyDocumentChange(textDocument);
      editing = false;
      await settleTimers();

      expect(deliveriesDuringEdit).toBe(0);
      const rows = cache.result.code;
      expect(rows[21]).toBe(retainedRow);
      expect(file.contents).toBe(textDocument.getText());
      for (let line = 0; line < textDocument.lineCount; line++) {
        expect(rows[line].map((token) => token.content).join('')).toBe(
          textDocument.getLineText(line)
        );
        expect(rows[line].length).toBeGreaterThan(1);
        expect(rows[line][0].color).toBeDefined();
      }
      tokenizer.cleanUp();
      renderer.cleanUp();
    }
  );

  test('deferred lines settled by a following edit arrive remapped', async () => {
    const contents = Array.from(
      { length: 20 },
      (_, i) => `const v${i} = ${i};`
    ).join('\n');
    const { tokenizer, deferred, textDocument } = createHarness(contents);
    tokenizer.tokenize(fullChange(textDocument), viewport(0, 3));
    // leave deferred work pending: everything below line 3 re-tokenizes in
    // background slices after this edit
    const openTemplate = textDocument.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: 'const s = `',
      },
    ]);
    tokenizer.tokenize(openTemplate!, viewport(0, 3));
    deferred.length = 0;
    // an immediate second edit inserts one line at the top; the first
    // batch's settled lines must arrive shifted to post-edit numbers
    const insertTop = textDocument.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: '// top\n',
      },
    ]);
    tokenizer.tokenize(insertTop!, viewport(0, 3));
    await settleTimers();
    let delivered = 0;
    for (const map of deferred) {
      for (const [line, tokens] of map) {
        delivered++;
        expect(lineText(tokens)).toBe(textDocument.getLineText(line));
      }
    }
    expect(delivered).toBeGreaterThan(0);
    tokenizer.cleanUp();
  });

  test('CRLF documents stay on the incremental path', () => {
    const { tokenizer, textDocument } = createHarness(
      'const a = 1;\r\nlet b = 2;\r\nlet c = 3;'
    );
    tokenizer.tokenize(fullChange(textDocument));
    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 1, character: 8 },
          end: { line: 1, character: 9 },
        },
        newText: '7',
      },
    ]);
    const dirty = tokenizer.tokenize(change!);
    expect([...dirty.keys()]).toEqual([1]);
    expect(lineText(dirty.get(1)!)).toBe('let b = 7;');
    tokenizer.cleanUp();
  });

  test('lone-CR documents stay on the incremental path', () => {
    const { tokenizer, textDocument } = createHarness(
      'let a = 1;\rlet b = 2;\rlet c = 3;'
    );
    expect(textDocument.lineCount).toBe(3);
    tokenizer.tokenize(fullChange(textDocument));
    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 1, character: 8 },
          end: { line: 1, character: 9 },
        },
        newText: '7',
      },
    ]);
    const dirty = tokenizer.tokenize(change!);
    expect([...dirty.keys()]).toEqual([1]);
    expect(lineText(dirty.get(1)!)).toBe('let b = 7;');
    tokenizer.cleanUp();
  });

  test('a lone CR joining a newline matches the piece table line model', () => {
    const { tokenizer, textDocument } = createHarness('let a = 1;\nlet b = 2;');
    tokenizer.tokenize(fullChange(textDocument));
    // inserting `\r` right before the existing `\n` joins into one `\r\n`
    // break in both the piece table and the live tokenizer
    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 0, character: 10 },
          end: { line: 0, character: 10 },
        },
        newText: '\r',
      },
    ]);
    expect(change!.lineCount).toBe(2);
    const dirty = tokenizer.tokenize(change!);
    // the terminator change re-lexes line 0; convergence may take line 1 too
    expect([...dirty.keys()]).toContain(0);
    for (const [line, tokens] of dirty) {
      expect(lineText(tokens)).toBe(textDocument.getLineText(line));
    }
    // the whole document stays line-for-line in sync afterwards
    const after = textDocument.applyEdits([
      {
        range: {
          start: { line: 1, character: 8 },
          end: { line: 1, character: 9 },
        },
        newText: '5',
      },
    ]);
    const afterDirty = tokenizer.tokenize(after!);
    expect(lineText(afterDirty.get(1)!)).toBe('let b = 5;');
    tokenizer.cleanUp();
  });

  test('empty lines produce the plain sentinel tuple', () => {
    const { tokenizer, textDocument } = createHarness('a\n\n   \nb');
    const dirty = tokenizer.tokenize(fullChange(textDocument));
    expect(dirty.get(1)).toEqual([[0, '', '']]);
    // whitespace-only lines keep whatever run highlights emitted; only the
    // text content matters since whitespace renders no glyphs
    expect(lineText(dirty.get(2)!)).toBe('   ');
    tokenizer.cleanUp();
  });

  test('pause buffers deferred deliveries until resume', async () => {
    const contents = Array.from(
      { length: 20 },
      (_, i) => `const v${i} = ${i};`
    ).join('\n');
    const { tokenizer, deferred, textDocument } = createHarness(contents);
    tokenizer.tokenize(fullChange(textDocument), viewport(0, 3));
    tokenizer.pauseBackgroundTokenize();
    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: 'const s = `',
      },
    ]);
    tokenizer.tokenize(change!, viewport(0, 3));
    deferred.length = 0;
    await settleTimers();
    expect(deferred).toHaveLength(0);
    tokenizer.resumeBackgroundTokenize();
    expect(deferred.length).toBeGreaterThan(0);
    for (const map of deferred) {
      for (const [line, tokens] of map) {
        expect(lineText(tokens)).toBe(textDocument.getLineText(line));
      }
    }
    tokenizer.cleanUp();
  });

  test('prebuildStateStack bounds initial tokenization to the viewport', async () => {
    const contents = Array.from(
      { length: 50 },
      (_, i) => `const v${i} = ${i};`
    ).join('\n');
    const { tokenizer, deferred } = createHarness(contents);
    tokenizer.prebuildStateStack(viewport(0, 3));
    // only the viewport tokenized synchronously; the tail converges in
    // background slices and refreshes the host cache through onDeferTokenize
    expect(deferred).toHaveLength(0);
    await settleTimers();
    const delivered = new Set(deferred.flatMap((map) => [...map.keys()]));
    for (let line = 3; line < 50; line++) {
      expect(delivered.has(line)).toBe(true);
    }
    tokenizer.cleanUp();
  });

  test('prebuild delivers the lines above its initial viewport', async () => {
    const contents = Array.from(
      { length: 20 },
      (_, i) => `const v${i} = ${i};`
    ).join('\n');
    const { tokenizer, deferred, textDocument } = createHarness(contents);
    tokenizer.prebuildStateStack(viewport(10, 5));
    await settleTimers();
    const delivered = new Map(deferred.flatMap((map) => [...map]));
    for (const line of [...Array(10).keys(), 15, 16, 17, 18, 19]) {
      expect(lineText(delivered.get(line)!)).toBe(
        textDocument.getLineText(line)
      );
      expect(delivered.get(line)![0][1]).toBe('#ff678d');
    }
    tokenizer.cleanUp();
  });

  test('pause and stop suspend the underlying background slices', async () => {
    const contents = Array.from(
      { length: 30 },
      (_, i) => `const v${i} = ${i};`
    ).join('\n');
    const { tokenizer, deferred, textDocument } = createHarness(contents);
    tokenizer.tokenize(fullChange(textDocument), viewport(0, 3));
    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: 'const s = `',
      },
    ]);
    tokenizer.tokenize(change!, viewport(0, 3));
    deferred.length = 0;
    tokenizer.pauseBackgroundTokenize();
    await settleTimers();
    expect(deferred).toHaveLength(0);
    tokenizer.resumeBackgroundTokenize();
    // the underlying slices were halted, not just their deliveries buffered:
    // nothing arrives synchronously on resume, everything after it
    expect(deferred).toHaveLength(0);
    await settleTimers();
    const delivered = new Set(deferred.flatMap((map) => [...map.keys()]));
    for (let line = 3; line < 30; line++) {
      expect(delivered.has(line)).toBe(true);
    }
    tokenizer.cleanUp();
  });

  test('a theme change repaints the document through deferred slices', async () => {
    const { tokenizer, styles, deferred, textDocument } = createHarness(
      'const a = 1;\nlet b = 2;'
    );
    try {
      const initial = tokenizer.tokenize(fullChange(textDocument));
      expect(initial.get(0)?.[0][1]).toBe('#ff678d');
      styles.length = 0;
      deferred.length = 0;
      tokenizer.syncTheme({ theme: 'pierre-light', themeType: 'light' });
      expect(tokenizer.themeType).toBe('light');
      expect(styles).toHaveLength(1);
      await waitFor(
        () => new Map(deferred.flatMap((map) => [...map])).size === 2
      );
      const repainted = new Map(deferred.flatMap((map) => [...map]));
      expect([...repainted.keys()]).toEqual([0, 1]);
      for (const [line, tokens] of repainted) {
        expect(lineText(tokens)).toBe(textDocument.getLineText(line));
        expect(tokens[0][1]).toBe('#d32a61');
      }
    } finally {
      tokenizer.cleanUp();
    }
  });

  test('cleanUp drops pending deferred deliveries', async () => {
    const contents = Array.from(
      { length: 50 },
      (_, i) => `const v${i} = ${i};`
    ).join('\n');
    const { tokenizer, deferred, textDocument } = createHarness(contents);
    tokenizer.tokenize(fullChange(textDocument), viewport(0, 2));
    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: 'const s = `',
      },
    ]);
    tokenizer.tokenize(change!, viewport(0, 2));
    deferred.length = 0;
    tokenizer.cleanUp();
    await settleTimers();
    expect(deferred).toHaveLength(0);
  });

  test('surrogate-pair edits keep UTF-16 columns aligned', () => {
    const { tokenizer, textDocument } = createHarness(
      'const emoji = "a😀b";\nlet c = 1;'
    );
    tokenizer.tokenize(fullChange(textDocument));
    // replace `b` (after the astral pair) using UTF-16 units
    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 0, character: 18 },
          end: { line: 0, character: 19 },
        },
        newText: 'z',
      },
    ]);
    const dirty = tokenizer.tokenize(change!);
    expect(lineText(dirty.get(0)!)).toBe('const emoji = "a😀z";');
    expect(lineText(dirty.get(0)!)).toBe(textDocument.getLineText(0));
    tokenizer.cleanUp();
  });
});
