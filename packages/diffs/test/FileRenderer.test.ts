import { afterAll, describe, expect, test } from 'bun:test';

import { TextDocument } from '../src/editor/textDocument';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { FileRenderer } from '../src/renderers/FileRenderer';
import type { FileContents, HighlightedToken, ThemedToken } from '../src/types';
import { mockFiles } from './mocks';
import { rowProperties } from './testUtils';

type FileRendererCacheProbe = {
  renderCache?: {
    result?: {
      code: ThemedToken[][];
    };
  };
};

function createEditSessionFile(file: FileContents): FileContents {
  const editSessionFile = { ...file };
  delete editSessionFile.cacheKey;
  return editSessionFile;
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
    expect(instance.renderFullHTML(result)).toMatchSnapshot();
  });

  test('truncates cached code rows when document lines are deleted', async () => {
    const instance = new FileRenderer();
    const file: FileContents = {
      cacheKey: 'editable-file',
      contents: 'alpha\nbeta\ngamma',
      name: 'editable.txt',
    };

    const editSessionFile = createEditSessionFile(file);
    instance.beginEditSession(editSessionFile);
    await instance.asyncRender(editSessionFile);
    expect(instance.renderFile(editSessionFile)?.rowCount).toBe(3);

    instance.applyDocumentChange(
      new TextDocument('inmemory://editable-file', 'alpha\ngamma')
    );

    const cache = (instance as unknown as FileRendererCacheProbe).renderCache;
    expect(cache?.result?.code).toHaveLength(2);
    expect(
      cache?.result?.code.map((line) =>
        line.map((token) => token.content).join('')
      )
    ).toEqual(['alpha', 'gamma']);
  });

  test('realigns cached rows when tokenization settles before EOF', async () => {
    const instance = new FileRenderer();
    const file: FileContents = {
      cacheKey: 'editable-file',
      contents: 'A\nB\nC\nD\n',
      name: 'editable.txt',
    };

    const editSessionFile = createEditSessionFile(file);
    instance.beginEditSession(editSessionFile);
    await instance.asyncRender(editSessionFile);
    instance.renderFile(editSessionFile);
    instance.updateRenderCache(new Map([[3, [[0, '#ff0000', 'D']]]]), 'light');
    const retainedRow = (instance as unknown as FileRendererCacheProbe)
      .renderCache!.result!.code[3];

    const dirtyLines = new Map<number, HighlightedToken[]>([
      [2, [[0, '', 'X']]],
      [3, [[0, '', 'C']]],
    ]);
    instance.updateRenderCache(dirtyLines, 'light', true);
    instance.applyDocumentChange(
      new TextDocument('inmemory://editable-file', 'A\nB\nX\nC\nD\n')
    );

    const cache = (instance as unknown as FileRendererCacheProbe).renderCache;
    const rows = cache?.result?.code ?? [];
    expect(
      rows.map((line) => line.map((token) => token.content).join(''))
    ).toEqual(['A', 'B', 'X', 'C', 'D', '']);
    expect(rows[4][0].color).toBe('#ff0000');
    expect(rows[4]).toBe(retainedRow);
    expect(rows[4][0]).toBe(retainedRow[0]);
    expect(
      instance.renderFile(editSessionFile)?.contentRows.map((row) => {
        const props = rowProperties(row);
        return [props['data-line'], props['data-line-index']];
      })
    ).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 3],
      [5, 4],
      [6, 5],
    ]);
  });

  test('length-changing edits preserve every unchanged cached token row', async () => {
    const instance = new FileRenderer();
    const file = {
      name: 'editable.ts',
      contents: 'const a = 1;\nconst b = 2;\nconst c = 3;',
    };
    instance.beginEditSession(file);
    await instance.asyncRender(file);
    instance.renderFile(file);
    const cache = (instance as unknown as FileRendererCacheProbe).renderCache!;
    const originalRows = cache.result!.code.slice();
    instance.updateRenderCache(
      new Map([[0, [[0, '#ff0000', 'const longer = 1;']]]]),
      'light'
    );
    expect(cache.result!.code[0]).not.toBe(originalRows[0]);
    for (let line = 1; line < originalRows.length; line++) {
      expect(cache.result!.code[line]).toBe(originalRows[line]);
      expect(cache.result!.code[line][0]).toBe(originalRows[line][0]);
    }
    expect(instance.renderFullHTML(instance.renderFile(file)!)).toContain(
      'data-char="0"'
    );
    instance.cleanUp();
  });

  test('reuses editor-compatible markup for a retained edit session', async () => {
    const instance = new FileRenderer({
      theme: 'pierre-light',
      useTokenTransformer: true,
    });
    const editSessionFile = createEditSessionFile({
      cacheKey: 'external-file',
      contents: 'const value = 1;\n',
      name: 'editable.ts',
    });

    instance.beginEditSession(editSessionFile);
    await instance.asyncRender(editSessionFile);
    instance.renderFile(editSessionFile);
    instance.endEditSession();

    instance.renderFile(editSessionFile);
    const cacheBeforeReattach = (instance as unknown as FileRendererCacheProbe)
      .renderCache;
    expect(cacheBeforeReattach?.result).toBeDefined();

    instance.beginEditSession(editSessionFile);

    expect((instance as unknown as FileRendererCacheProbe).renderCache).toBe(
      cacheBeforeReattach
    );
    expect(instance.editorRenderReady()).toBe(true);
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
    'preserves the tokenized final row when $change a terminal newline',
    async ({ change, previousText, nextText, dirtyLines }) => {
      const instance = new FileRenderer();
      const file: FileContents = {
        cacheKey: `terminal-newline-${change}`,
        contents: previousText,
        name: 'terminal.ts',
      };

      const editSessionFile = createEditSessionFile(file);
      instance.beginEditSession(editSessionFile);
      await instance.asyncRender(editSessionFile);
      instance.renderFile(editSessionFile);
      instance.updateRenderCache(dirtyLines, 'light', true);
      instance.applyDocumentChange(
        new TextDocument('inmemory://terminal-newline', nextText, 'typescript')
      );

      const cache = (instance as unknown as FileRendererCacheProbe).renderCache;
      expect(cache?.result?.code[0][0].color).toBe('#ff0000');
    }
  );

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
