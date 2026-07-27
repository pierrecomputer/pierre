import { afterAll, describe, expect, test } from 'bun:test';
import type { ElementContent } from 'hast';

import { TextDocument } from '../src/editor/textDocument';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { FileRenderer } from '../src/renderers/FileRenderer';
import type { FileContents, HighlightedToken } from '../src/types';
import { mockFiles } from './mocks';
import { hastTextContent } from './testUtils';

type FileRendererCacheProbe = {
  renderCache?: {
    result?: {
      code: ElementContent[];
    };
  };
};

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

  test('truncates cached code rows when document lines are deleted', async () => {
    const instance = new FileRenderer();
    const file: FileContents = {
      cacheKey: 'editable-file',
      contents: 'alpha\nbeta\ngamma',
      name: 'editable.txt',
    };

    await instance.asyncRender(file);
    expect(instance.renderFile(file)?.rowCount).toBe(3);

    instance.applyDocumentChange(
      new TextDocument('inmemory://editable-file', 'alpha\ngamma')
    );

    const cache = (instance as unknown as FileRendererCacheProbe).renderCache;
    expect(cache?.result?.code).toHaveLength(2);
    expect(cache?.result?.code.map(hastTextContent)).toEqual([
      'alpha',
      'gamma',
    ]);
  });

  test('realigns cached rows when tokenization settles before EOF', async () => {
    const instance = new FileRenderer();
    const file: FileContents = {
      cacheKey: 'editable-file',
      contents: 'A\nB\nC\nD\n',
      name: 'editable.txt',
    };

    await instance.asyncRender(file);
    instance.renderFile(file);

    const dirtyLines = new Map<number, HighlightedToken[]>([
      [2, [[0, '', 'X']]],
      [3, [[0, '', 'C']]],
    ]);
    instance.updateRenderCache(dirtyLines, 'light');
    instance.applyDocumentChange(
      new TextDocument('inmemory://editable-file', 'A\nB\nX\nC\nD\n')
    );

    const cache = (instance as unknown as FileRendererCacheProbe).renderCache;
    const rows = cache?.result?.code ?? [];
    expect(rows.map(hastTextContent)).toEqual(['A', 'B', 'X', 'C', 'D', '']);
    expect(
      rows.map((row) =>
        row.type === 'element'
          ? [row.properties['data-line'], row.properties['data-line-index']]
          : undefined
      )
    ).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 3],
      [5, 4],
      [6, 5],
    ]);
  });

  test('rebuilds an unkeyed file mutated in place', async () => {
    const instance = new FileRenderer();
    const file: FileContents = {
      contents: 'alpha',
      name: 'mutable.ts',
    };

    await instance.asyncRender(file);
    expect(instance.renderFile(file)?.rowCount).toBe(1);

    file.contents = 'alpha\nbeta\ngamma';
    expect(instance.renderFile(file)?.rowCount).toBe(3);
  });
});
