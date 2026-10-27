import { afterAll, describe, expect, test } from 'bun:test';
import type { ElementContent } from 'hast';

import { TextDocument } from '../src/editor/textDocument';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { FileRenderer } from '../src/renderers/FileRenderer';
import type { FileContents, HighlightedToken } from '../src/types';
import { documentEdit, lineEdit } from './editorTestUtils';
import { mockFiles } from './mocks';
import { hastTextContent } from './testUtils';

type FileRendererCacheProbe = {
  model?: { file: FileContents };
  renderCache?: {
    result?: {
      code: ElementContent[];
    };
  };
};

// The editor's document for `contents`, and the change that replaces its
// text with `next`.
function replaceDocument(contents: string, next: string) {
  const document = new TextDocument<'file', undefined>(
    'inmemory://file-renderer',
    contents
  );
  const change = document.applyEdits([
    documentEdit(document, next.split(/(?<=\n)/)),
  ]);
  if (change == null) {
    throw new Error('the edit applied nothing');
  }
  return { document, change };
}

function lineNumbers(rows: ElementContent[]): (string | undefined)[][] {
  return rows.map((row) =>
    row.type === 'element'
      ? [
          String(row.properties['data-line']),
          String(row.properties['data-line-index']),
        ]
      : []
  );
}

afterAll(async () => {
  await disposeHighlighter();
});

describe('FileRenderer', () => {
  // This is the suite's single full-fidelity snapshot: it pins the complete
  // highlighted AST (token spans, theme style variables, gutter structure)
  // for one small real-world fixture. Every other test asserts or snapshots
  // only its own behavioral slice, so theme/tokenizer changes should churn
  // exactly this one snapshot — review it line by line rather than blindly
  // regenerating.
  test('should render TypeScript code to AST matching snapshot', async () => {
    const instance = new FileRenderer();
    const result = await instance.asyncRender(mockFiles.file1);
    expect(instance.renderCodeAST(result)).toMatchSnapshot();
  });

  test('drops the rows of deleted lines', async () => {
    const instance = new FileRenderer();
    const file: FileContents = {
      cacheKey: 'editable-file',
      contents: 'alpha\nbeta\ngamma',
      name: 'editable.txt',
    };

    const session = instance.startEditSession(file);
    await instance.asyncRender(session);
    expect(instance.renderFile(session)?.rowCount).toBe(3);

    const { document, change } = replaceDocument(
      session.contents,
      'alpha\ngamma'
    );
    instance.applyChange(change, document);

    const result = instance.renderFile(session);
    expect(result?.rowCount).toBe(2);
    expect(result?.contentAST.map(hastTextContent)).toEqual(['alpha', 'gamma']);
    expect(session.contents).toBe('alpha\ngamma');
  });

  test('rows keep their tokens and renumber when a line is inserted above', async () => {
    const instance = new FileRenderer();
    const file: FileContents = {
      cacheKey: 'editable-file',
      contents: 'A\nB\nC\nD\n',
      name: 'editable.txt',
    };

    const session = instance.startEditSession(file);
    await instance.asyncRender(session);
    instance.renderFile(session);
    instance.setTokens(new Map([[3, [[0, '#ff0000', 'D']]]]));

    const document = new TextDocument<'file', undefined>(
      'inmemory://file-renderer',
      session.contents
    );
    const change = document.applyEdits([
      {
        range: {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 0 },
        },
        newText: 'X\n',
      },
    ]);
    if (change == null) {
      throw new Error('the edit applied nothing');
    }
    instance.applyChange(
      change,
      document,
      new Map<number, HighlightedToken[]>([
        [2, [[0, '', 'X']]],
        [3, [[0, '', 'C']]],
      ])
    );

    const rows = instance.renderFile(session)?.contentAST ?? [];
    expect(rows.map(hastTextContent)).toEqual(['A', 'B', 'X', 'C', 'D', '']);
    expect(rows[4]).toMatchObject({
      children: [
        {
          properties: {
            style: 'color:#ff0000;',
          },
        },
      ],
    });
    expect(lineNumbers(rows)).toEqual([
      ['1', '0'],
      ['2', '1'],
      ['3', '2'],
      ['4', '3'],
      ['5', '4'],
      ['6', '5'],
    ]);
  });

  test("a session reuses a read-only highlight but never a session's", async () => {
    const instance = new FileRenderer({
      theme: 'pierre-light',
      useTokenTransformer: true,
    });
    const file: FileContents = {
      cacheKey: 'external-file',
      contents: 'const value = 1;\n',
      name: 'editable.ts',
    };
    const probe = instance as unknown as FileRendererCacheProbe;

    // The input's own rows, rendered editor-compatible, become the session's.
    await instance.asyncRender(file);
    instance.renderFile(file);
    const readOnlyResult = probe.renderCache?.result;
    expect(readOnlyResult).toBeDefined();
    const session = instance.startEditSession(file);
    expect(probe.renderCache?.result).toBe(readOnlyResult);
    expect(instance.editorRenderReady()).toBe(true);

    // A result highlighted while the file was edited may be behind its text,
    // so the next session starts from a fresh highlight.
    instance.renderFile(session);
    instance.endEditSession();
    instance.startEditSession(session);
    expect(probe.renderCache).toBeUndefined();
  });

  test('keeps edited rows and document line counts across an active recycle', async () => {
    const instance = new FileRenderer();
    const session = instance.startEditSession({
      contents: 'alpha\nbeta',
      name: 'editable.txt',
    });
    await instance.asyncRender(session);
    instance.renderFile(session);
    const { document, change } = replaceDocument(
      session.contents,
      'alpha\nnew\nbeta'
    );
    instance.applyChange(change, document);
    const cachedResult = (instance as unknown as FileRendererCacheProbe)
      .renderCache?.result;

    instance.recycle();

    expect(
      (instance as unknown as FileRendererCacheProbe).renderCache?.result
    ).toBe(cachedResult);
    expect(instance.renderFile(session)?.rowCount).toBe(3);
  });

  test('releases an offscreen session and invalidates a replacement', async () => {
    const instance = new FileRenderer();
    const first = instance.startEditSession({
      contents: 'first',
      name: 'editable.txt',
    });
    await instance.asyncRender(first);
    instance.renderFile(first);
    instance.recycle();
    expect(
      (instance as unknown as FileRendererCacheProbe).renderCache?.result
    ).toBeDefined();

    const replacement = instance.startEditSession({
      contents: 'replacement',
      name: 'editable.txt',
    });
    expect(
      (instance as unknown as FileRendererCacheProbe).renderCache?.result
    ).toBeUndefined();

    await instance.asyncRender(replacement);
    instance.renderFile(replacement);
    instance.recycle();
    instance.endEditSession();
    expect(
      (instance as unknown as FileRendererCacheProbe).renderCache?.result
    ).toBeUndefined();
  });

  test('discards non-editable highlights on recycle', async () => {
    const instance = new FileRenderer();
    const file: FileContents = {
      contents: 'const value = 1;',
      name: 'ordinary.ts',
    };
    await instance.asyncRender(file);
    instance.renderFile(file);
    expect(
      (instance as unknown as FileRendererCacheProbe).renderCache?.result
    ).toBeDefined();

    instance.recycle();

    expect(
      (instance as unknown as FileRendererCacheProbe).renderCache?.result
    ).toBeUndefined();
  });

  test.each([
    {
      change: 'adding',
      previousText: 'const value = 1;',
      nextText: 'const value = 1;\n',
      dirtyLines: new Map<number, HighlightedToken[]>([
        [0, [[0, '#ff0000', 'const value = 1;']]],
        [1, [[0, '', '']]],
      ]),
    },
    {
      change: 'removing',
      previousText: 'const value = 1;\n',
      nextText: 'const value = 1;',
      dirtyLines: new Map<number, HighlightedToken[]>([
        [0, [[0, '#ff0000', 'const value = 1;']]],
      ]),
    },
  ])(
    'keeps the tokenized final row when $change a terminal newline',
    async ({ change: name, previousText, nextText, dirtyLines }) => {
      const instance = new FileRenderer();
      const session = instance.startEditSession({
        cacheKey: `terminal-newline-${name}`,
        contents: previousText,
        name: 'terminal.ts',
      });
      await instance.asyncRender(session);
      instance.renderFile(session);
      const { document, change } = replaceDocument(session.contents, nextText);
      instance.applyChange(change, document, dirtyLines);

      const rows = instance.renderFile(session)?.contentAST ?? [];
      expect(rows[0]).toMatchObject({
        children: [
          {
            properties: {
              style: 'color:#ff0000;',
            },
          },
        ],
      });
    }
  );

  test('edits give a line new text through the editor tokens for it', async () => {
    const instance = new FileRenderer();
    const session = instance.startEditSession({
      contents: 'const a = 1;\nconst b = 2;\n',
      name: 'edited.ts',
    });
    await instance.asyncRender(session);
    instance.renderFile(session);
    const document = new TextDocument<'file', undefined>(
      'inmemory://edited',
      session.contents
    );
    const change = document.applyEdits([
      lineEdit(document, 0, 'const edited = 1;'),
    ]);
    if (change == null) {
      throw new Error('the edit applied nothing');
    }
    instance.applyChange(
      change,
      document,
      new Map([[0, [[0, '#ff0000', 'const edited = 1;']]]])
    );
    const rows = instance.renderFile(session)?.contentAST ?? [];
    expect(rows.map(hastTextContent)).toEqual([
      'const edited = 1;',
      'const b = 2;',
      '',
    ]);
  });

  test('typing in a plain-text file keeps its result and untouched rows', async () => {
    const instance = new FileRenderer();
    const session = instance.startEditSession({
      contents: 'alpha\nbravo\ncharlie\n',
      name: 'notes.txt',
    });
    await instance.asyncRender(session);
    const first = instance.renderFile(session);
    const document = new TextDocument<'file', undefined>(
      'inmemory://notes',
      session.contents
    );
    const change = document.applyEdits([lineEdit(document, 1, 'bravo!')]);
    if (change == null) {
      throw new Error('the edit applied nothing');
    }
    instance.applyChange(change, document);
    const second = instance.renderFile(session);
    // The reconciler leaves a row alone while its cells are the same objects.
    expect(second?.allRowsChanged).toBe(false);
    expect(second?.column[0].content).toBe(first?.column[0].content);
    expect(second?.column[0].gutter).toBe(first?.column[0].gutter);
    expect(second?.column[1].content).not.toBe(first?.column[1].content);
    expect(second?.column[2].content).toBe(first?.column[2].content);
    expect(second?.contentAST.map(hastTextContent)).toEqual([
      'alpha',
      'bravo!',
      'charlie',
      '',
    ]);
  });

  test('a finished session releases its model once another file renders', async () => {
    const instance = new FileRenderer();
    const session = instance.startEditSession({
      contents: 'alpha\nbravo\n',
      name: 'large.ts',
    });
    await instance.asyncRender(session);
    instance.renderFile(session);
    instance.endEditSession();
    const probe = instance as unknown as FileRendererCacheProbe;
    expect(probe.model?.file).toBe(session);

    const next: FileContents = { contents: 'small', name: 'small.ts' };
    await instance.asyncRender(next);
    instance.renderFile(next);
    expect(probe.model?.file).toBe(next);
  });

  test('restarting a session from its edited text highlights that text', async () => {
    const instance = new FileRenderer();
    const session = instance.startEditSession({
      contents: 'a\nb\nc',
      name: 'restart.ts',
    });
    await instance.asyncRender(session);
    instance.renderFile(session);
    const document = new TextDocument<'file', undefined>(
      'inmemory://restart',
      session.contents
    );
    const change = document.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: '/*\n',
      },
    ]);
    if (change == null) {
      throw new Error('the edit applied nothing');
    }
    instance.applyChange(change, document);
    instance.renderFile(session);

    // The edited text comes back as the next input, as a caller that feeds
    // onChange into its state does.
    const restarted = instance.startEditSession({
      contents: session.contents,
      name: 'restart.ts',
    });
    expect(
      instance.renderFile(restarted)?.contentAST.map(hastTextContent)
    ).toEqual(['/*', 'a', 'b', 'c']);
  });

  test('clearing the cache drops the tokens a session holds', async () => {
    const instance = new FileRenderer();
    const session = instance.startEditSession({
      contents: 'alpha\nbravo\n',
      name: 'tokens.ts',
    });
    await instance.asyncRender(session);
    instance.renderFile(session);
    instance.setTokens(new Map([[0, [[0, '#ff0000', 'alpha']]]]));
    expect(instance.renderFile(session)?.contentAST[0]).toMatchObject({
      children: [{ properties: { style: 'color:#ff0000;' } }],
    });

    instance.clearRenderCache();
    const row = instance.renderFile(session)?.contentAST[0];
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain('color:#ff0000;');
  });

  test('renders a distinct unkeyed file with new contents', async () => {
    const instance = new FileRenderer();
    const firstFile: FileContents = {
      contents: 'alpha',
      name: 'mutable.ts',
    };

    await instance.asyncRender(firstFile);
    expect(instance.renderFile(firstFile)?.rowCount).toBe(1);

    const nextFile = { ...firstFile, contents: 'alpha\nbeta\ngamma' };
    expect(instance.renderFile(nextFile)?.rowCount).toBe(3);
  });
});
