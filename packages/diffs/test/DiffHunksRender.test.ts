import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { createTwoFilesPatch } from 'diff';
import { JSDOM } from 'jsdom';

import {
  DiffHunksRenderer,
  disposeHighlighter,
  parseDiffFromFile,
  parsePatchFiles,
} from '../src';
import type { FileDiffLoadedFiles, FileDiffMetadata } from '../src/types';
import * as diffDecorations from '../src/utils/parseDiffDecorations';
import { mockDiffs } from './mocks';
import {
  assertDefined,
  collectAllElements,
  countSplitRows,
  projectColumn,
  rowDigests,
  verifyHunkLineValues,
} from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

const loadedFiles: FileDiffLoadedFiles = {
  oldFile: { name: 'file.ts', contents: 'const oldValue = 1;\n' },
  newFile: { name: 'file.ts', contents: 'const newValue = 2;\n' },
};

function countInlineDiffSpans(
  result: Awaited<ReturnType<DiffHunksRenderer['asyncRender']>>
) {
  const additions = result.additionsContentRows ?? [];
  const deletions = result.deletionsContentRows ?? [];
  return [
    ...collectAllElements(additions),
    ...collectAllElements(deletions),
  ].filter((element) => element.properties?.['data-diff-span'] != null).length;
}

// Expected split-alignment buffer sizes, derived from the parsed change
// blocks: a block deleting more lines than it adds leaves a gap in the
// additions column (and vice versa), which the renderer fills with one
// buffer row of the surplus size.
function changeBlockSurpluses(diff: FileDiffMetadata): {
  additionsColumn: number[];
  deletionsColumn: number[];
} {
  const additionsColumn: number[] = [];
  const deletionsColumn: number[] = [];
  for (const hunk of diff.hunks) {
    for (const content of hunk.hunkContent) {
      if (content.type !== 'change') {
        continue;
      }
      if (content.deletions > content.additions) {
        additionsColumn.push(content.deletions - content.additions);
      } else if (content.additions > content.deletions) {
        deletionsColumn.push(content.additions - content.deletions);
      }
    }
  }
  return { additionsColumn, deletionsColumn };
}

function parsePartialDiffWithCollapsedContext(): FileDiffMetadata {
  const oldFile = {
    name: 'partial.txt',
    contents: ['keep 1\n', 'old value\n', 'keep 3\n'].join(''),
  };
  const newFile = {
    name: 'partial.txt',
    contents: ['keep 1\n', 'new value\n', 'keep 3\n'].join(''),
  };
  const file = parsePatchFiles(
    createTwoFilesPatch(
      oldFile.name,
      newFile.name,
      oldFile.contents,
      newFile.contents,
      undefined,
      undefined,
      { context: 0 }
    ),
    'partial',
    true
  )[0]?.files[0];
  assertDefined(file, 'expected patch to contain one file');
  expect(file.isPartial).toBe(true);
  expect(file.hunks[0]?.collapsedBefore).toBeGreaterThan(0);
  return file;
}

function parsePartialNewFile(): FileDiffMetadata {
  const file = parsePatchFiles(
    [
      'diff --git a/created.txt b/created.txt\n',
      'new file mode 100644\n',
      'index 0000000..1234567\n',
      '--- /dev/null\n',
      '+++ b/created.txt\n',
      '@@ -0,0 +1,2 @@\n',
      '+added 1\n',
      '+added 2\n',
    ].join(''),
    'partial-created',
    true
  )[0]?.files[0];
  assertDefined(file, 'expected created patch to contain one file');
  expect(file.isPartial).toBe(true);
  expect(file.type).toBe('new');
  return file;
}

function parsePartialDeletedFile(): FileDiffMetadata {
  const file = parsePatchFiles(
    [
      'diff --git a/deleted.txt b/deleted.txt\n',
      'deleted file mode 100644\n',
      'index 1234567..0000000\n',
      '--- a/deleted.txt\n',
      '+++ /dev/null\n',
      '@@ -1,2 +0,0 @@\n',
      '-deleted 1\n',
      '-deleted 2\n',
    ].join(''),
    'partial-deleted',
    true
  )[0]?.files[0];
  assertDefined(file, 'expected deleted patch to contain one file');
  expect(file.isPartial).toBe(true);
  expect(file.type).toBe('deleted');
  return file;
}

describe('DiffHunksRenderer', () => {
  test('proper buffers should be prepended to additions colum in split style', async () => {
    const instance = new DiffHunksRenderer(mockDiffs.diffRowBufferTest.options);
    const diff = parseDiffFromFile(
      mockDiffs.diffRowBufferTest.oldFile,
      mockDiffs.diffRowBufferTest.newFile
    );
    expect(verifyHunkLineValues(diff)).toEqual([]);
    const result = await instance.asyncRender(diff);
    assertDefined(
      result.additionsContentRows,
      'result.additionsContentRows should be defined'
    );
    assertDefined(
      result.deletionsContentRows,
      'result.deletionsContentRows should be defined'
    );
    expect(result.unifiedContentRows).toBeUndefined();

    const additionRows = projectColumn(result.additionsContentRows);
    const deletionRows = projectColumn(result.deletionsContentRows);
    const surpluses = changeBlockSurpluses(diff);
    // The fixture has at least one block deleting more than it adds, so the
    // additions column must receive buffer rows of exactly those sizes
    expect(surpluses.additionsColumn.length).toBeGreaterThan(0);
    expect(
      additionRows
        .filter((row) => row.kind === 'buffer')
        .map((row) => row.bufferSize)
    ).toEqual(surpluses.additionsColumn);
    expect(
      deletionRows
        .filter((row) => row.kind === 'buffer')
        .map((row) => row.bufferSize)
    ).toEqual(surpluses.deletionsColumn);

    expect({
      additions: rowDigests(additionRows),
      deletions: rowDigests(deletionRows),
    }).toMatchSnapshot('rendered rows');
  });

  test('proper buffers should be prepended to deletions colum in split style', async () => {
    const instance = new DiffHunksRenderer(mockDiffs.diffRowBufferTest.options);
    const diff = parseDiffFromFile(
      mockDiffs.diffRowBufferTest.newFile,
      mockDiffs.diffRowBufferTest.oldFile
    );
    expect(verifyHunkLineValues(diff)).toEqual([]);
    const result = await instance.asyncRender(diff);
    assertDefined(
      result.additionsContentRows,
      'result.additionsContentRows should be defined'
    );
    assertDefined(
      result.deletionsContentRows,
      'result.deletionsContentRows should be defined'
    );
    expect(result.unifiedContentRows).toBeUndefined();

    const additionRows = projectColumn(result.additionsContentRows);
    const deletionRows = projectColumn(result.deletionsContentRows);
    const surpluses = changeBlockSurpluses(diff);
    // Reversed fixture: at least one block adds more than it deletes, so the
    // deletions column must receive buffer rows of exactly those sizes
    expect(surpluses.deletionsColumn.length).toBeGreaterThan(0);
    expect(
      deletionRows
        .filter((row) => row.kind === 'buffer')
        .map((row) => row.bufferSize)
    ).toEqual(surpluses.deletionsColumn);
    expect(
      additionRows
        .filter((row) => row.kind === 'buffer')
        .map((row) => row.bufferSize)
    ).toEqual(surpluses.additionsColumn);

    expect({
      additions: rowDigests(additionRows),
      deletions: rowDigests(deletionRows),
    }).toMatchSnapshot('rendered rows');
  });

  test('an insert block above a paired change keeps split columns aligned', async () => {
    // Realignment splits "blank line inserted above an edited line" into an
    // addition-only block directly followed by a paired block. The renderer
    // must flush the pending deletion-side buffer before the paired block's
    // deletion row, so the buffer renders above it and the columns stay
    // index-parallel.
    const instance = new DiffHunksRenderer(mockDiffs.diffRowBufferTest.options);
    const context = 'alpha\nbravo\ncharlie\ndelta\n';
    const diff = parseDiffFromFile(
      {
        name: 'a.ts',
        contents: `${context}const value = compute();\n${context}`,
      },
      {
        name: 'a.ts',
        contents: `${context}\nconst value = computed();\n${context}`,
      }
    );
    expect(verifyHunkLineValues(diff)).toEqual([]);
    const result = await instance.asyncRender(diff);
    assertDefined(
      result.deletionsContentRows,
      'result.deletionsContentRows should be defined'
    );
    assertDefined(
      result.additionsContentRows,
      'result.additionsContentRows should be defined'
    );

    const deletionRows = projectColumn(result.deletionsContentRows);
    const additionRows = projectColumn(result.additionsContentRows);
    // The deletion column renders the gap above the paired old line.
    const bufferIndex = deletionRows.findIndex((row) => row.kind === 'buffer');
    const deletionLineIndex = deletionRows.findIndex((row) =>
      rowDigests([row])[0].includes('const value = compute();')
    );
    expect(bufferIndex).toBeGreaterThan(-1);
    expect(deletionLineIndex).toBe(bufferIndex + 1);
    // Both columns cover the same rendered rows.
    const rowSpan = (rows: ReturnType<typeof projectColumn>) =>
      rows.reduce((total, row) => total + (row.bufferSize ?? 1), 0);
    expect(rowSpan(deletionRows)).toBe(rowSpan(additionRows));
  });

  test('additions and deletions should be empty when unified', async () => {
    const instance = new DiffHunksRenderer({
      ...mockDiffs.diffRowBufferTest.options,
      diffStyle: 'unified',
    });
    const diff = parseDiffFromFile(
      mockDiffs.diffRowBufferTest.oldFile,
      mockDiffs.diffRowBufferTest.newFile
    );
    expect(verifyHunkLineValues(diff)).toEqual([]);
    const result = await instance.asyncRender(diff);
    expect(result.additionsContentRows).toBeUndefined();
    expect(result.deletionsContentRows).toBeUndefined();
    assertDefined(
      result.unifiedContentRows,
      'result.unifiedContentRows should be defined'
    );
    expect(
      rowDigests(projectColumn(result.unifiedContentRows))
    ).toMatchSnapshot('rendered rows');
  });

  test('a diff with only additions should have an empty deletions column', async () => {
    const instance = new DiffHunksRenderer(mockDiffs.diffRowBufferTest.options);
    const diff = parseDiffFromFile(
      { ...mockDiffs.diffRowBufferTest.oldFile, contents: '' },
      mockDiffs.diffRowBufferTest.newFile
    );
    expect(diff.hunks[0]?.collapsedBefore).toBe(0);
    expect(verifyHunkLineValues(diff)).toEqual([]);
    const result = await instance.asyncRender(diff);
    expect(result.preProperties?.['data-diff-type']).toBe('single');
    assertDefined(
      result.additionsContentRows,
      'result.additionsContentRows should be defined'
    );
    expect(countSplitRows(result)).toBe(diff.splitLineCount);
    expect(result.deletionsContentRows).toBeUndefined();
    expect(result.unifiedContentRows).toBeUndefined();
    expect(
      rowDigests(projectColumn(result.additionsContentRows))
    ).toMatchSnapshot('rendered rows');
  });

  test('a diff with only deletions should have an empty additions column', async () => {
    const instance = new DiffHunksRenderer(mockDiffs.diffRowBufferTest.options);
    const diff = parseDiffFromFile(mockDiffs.diffRowBufferTest.oldFile, {
      ...mockDiffs.diffRowBufferTest.newFile,
      contents: '',
    });
    expect(diff.hunks[0]?.collapsedBefore).toBe(0);
    expect(verifyHunkLineValues(diff)).toEqual([]);
    const result = await instance.asyncRender(diff);
    expect(result.preProperties?.['data-diff-type']).toBe('single');
    assertDefined(
      result.deletionsContentRows,
      'result.deletionsContentRows should be defined'
    );
    expect(countSplitRows(result)).toBe(diff.splitLineCount);
    expect(result.additionsContentRows).toBeUndefined();
    expect(result.unifiedContentRows).toBeUndefined();
    expect(
      rowDigests(projectColumn(result.deletionsContentRows))
    ).toMatchSnapshot('rendered rows');
  });

  test('adds data-container-size for line-info separators', async () => {
    const instance = new DiffHunksRenderer({ hunkSeparators: 'line-info' });
    const diff = parseDiffFromFile(
      mockDiffs.diffRowBufferTest.oldFile,
      mockDiffs.diffRowBufferTest.newFile
    );
    const result = await instance.asyncRender(diff);
    const html = instance.renderFullHTML(result);
    expect(html).toContain('data-container-size');
  });

  test('does not add data-container-size for non line-info separators', async () => {
    const instance = new DiffHunksRenderer({
      hunkSeparators: 'line-info-basic',
    });
    const diff = parseDiffFromFile(
      mockDiffs.diffRowBufferTest.oldFile,
      mockDiffs.diffRowBufferTest.newFile
    );
    const result = await instance.asyncRender(diff);
    const html = instance.renderFullHTML(result);
    expect(html).not.toContain('data-container-size');
  });

  test('keeps partial hunk separators non-expandable without a file loader', async () => {
    const instance = new DiffHunksRenderer({ hunkSeparators: 'line-info' });
    const result = await instance.asyncRender(
      parsePartialDiffWithCollapsedContext()
    );

    expect(result.hunkData.length).toBeGreaterThan(0);
    expect(result.hunkData.every((hunk) => hunk.expandable == null)).toBe(true);
  });

  test('marks partial hunk separators expandable with a file loader', async () => {
    const instance = new DiffHunksRenderer({
      hunkSeparators: 'line-info',
      loadDiffFiles: () => Promise.resolve(loadedFiles),
    });
    const result = await instance.asyncRender(
      parsePartialDiffWithCollapsedContext()
    );

    expect(result.hunkData.length).toBeGreaterThan(0);
    expect(result.hunkData.every((hunk) => hunk.expandable != null)).toBe(true);
  });

  test('renders synthetic bottom separator for partial diffs with a file loader', async () => {
    const diff = parsePartialDiffWithCollapsedContext();
    const instance = new DiffHunksRenderer({
      diffStyle: 'unified',
      hunkSeparators: 'line-info',
      loadDiffFiles: () => Promise.resolve(loadedFiles),
    });
    const result = await instance.asyncRender(diff);
    const html = instance.renderFullHTML(result);
    const tailHunkData = result.hunkData.find(
      (hunk) => hunk.hunkIndex === diff.hunks.length
    );

    expect(tailHunkData).toEqual({
      slotName: `hunk-separator-unified-${diff.hunks.length}`,
      hunkIndex: diff.hunks.length,
      lines: 0,
      lineCountKnown: false,
      type: 'unified',
      expandable: { up: true, down: false, chunked: false },
    });
    expect(html).toContain('More unchanged context may be available');
    expect(html).toContain(`data-expand-index="${diff.hunks.length}"`);
    expect(html).not.toContain('0 unmodified lines');
  });

  test('does not render synthetic bottom separator for partial diffs without a file loader', async () => {
    const diff = parsePartialDiffWithCollapsedContext();
    const instance = new DiffHunksRenderer({
      diffStyle: 'unified',
      hunkSeparators: 'line-info',
    });
    const result = await instance.asyncRender(diff);
    const html = instance.renderFullHTML(result);

    expect(
      result.hunkData.some((hunk) => hunk.hunkIndex === diff.hunks.length)
    ).toBe(false);
    expect(html).not.toContain('More unchanged context may be available');
  });

  test('does not render synthetic bottom separator for partial new files with a file loader', async () => {
    const diff = parsePartialNewFile();
    const instance = new DiffHunksRenderer({
      diffStyle: 'unified',
      hunkSeparators: 'line-info',
      loadDiffFiles: () => Promise.resolve(loadedFiles),
    });
    const result = await instance.asyncRender(diff);
    const html = instance.renderFullHTML(result);

    expect(
      result.hunkData.some((hunk) => hunk.hunkIndex === diff.hunks.length)
    ).toBe(false);
    expect(result.hunkData.every((hunk) => hunk.expandable == null)).toBe(true);
    expect(html).not.toContain('More unchanged context may be available');
    expect(html).not.toContain(`data-expand-index="${diff.hunks.length}"`);
  });

  test('does not render synthetic bottom separator for partial deleted files with a file loader', async () => {
    const diff = parsePartialDeletedFile();
    const instance = new DiffHunksRenderer({
      diffStyle: 'unified',
      hunkSeparators: 'line-info',
      loadDiffFiles: () => Promise.resolve(loadedFiles),
    });
    const result = await instance.asyncRender(diff);
    const html = instance.renderFullHTML(result);

    expect(
      result.hunkData.some((hunk) => hunk.hunkIndex === diff.hunks.length)
    ).toBe(false);
    expect(result.hunkData.every((hunk) => hunk.expandable == null)).toBe(true);
    expect(html).not.toContain('More unchanged context may be available');
    expect(html).not.toContain(`data-expand-index="${diff.hunks.length}"`);
  });

  test('skips inline diff decorations for changed lines above maxLineDiffLength', async () => {
    const instance = new DiffHunksRenderer({
      diffStyle: 'split',
      maxLineDiffLength: 5,
    });
    const diff = parseDiffFromFile(
      {
        name: 'example.ts',
        contents: 'const value = "aaaaaaaaaaaa";\n',
      },
      {
        name: 'example.ts',
        contents: 'const value = "bbbbbbbbbbbb";\n',
      }
    );
    const result = await instance.asyncRender(diff);

    expect(countInlineDiffSpans(result)).toBe(0);
  });

  test('keeps inline diff decorations for changed lines below maxLineDiffLength', async () => {
    const instance = new DiffHunksRenderer({
      diffStyle: 'split',
      maxLineDiffLength: 50,
    });
    const diff = parseDiffFromFile(
      {
        name: 'example.ts',
        contents: 'const x = 1;\n',
      },
      {
        name: 'example.ts',
        contents: 'const x = 2;\n',
      }
    );
    const result = await instance.asyncRender(diff);

    expect(countInlineDiffSpans(result)).toBeGreaterThan(0);
  });

  test.each(['split', 'unified'] as const)(
    'keeps word highlights in large collapsed text diffs (%s)',
    async (diffStyle) => {
      const contents =
        Array.from({ length: 1001 }, (_, i) => `constant line ${i}`).join(
          '\n'
        ) + '\n';
      const diff = parseDiffFromFile(
        { name: 'large.txt', contents },
        {
          name: 'large.txt',
          contents: contents.replace('constant line 500', 'constant ROW 500'),
        }
      );
      const instance = new DiffHunksRenderer({
        diffStyle,
        lineDiffType: 'word',
      });
      try {
        const result = await instance.asyncRender(diff);
        expect(result.rowCount).toBeLessThan(20);
        const html = JSDOM.fragment(instance.renderFullHTML(result));
        expect(
          Array.from(
            html.querySelectorAll('[data-diff-span]'),
            (span) => span.textContent
          )
        ).toEqual(['line', 'ROW']);
      } finally {
        instance.cleanUp();
      }
    }
  );

  test('reuses line diffs across windows and recomputes only edited pairs', async () => {
    const instance = new DiffHunksRenderer({ diffStyle: 'split' });
    const diff = parseDiffFromFile(
      { name: 'cached.txt', contents: 'old one\nold two\nold three\n' },
      { name: 'cached.txt', contents: 'new one\nnew two\nnew three\n' }
    );
    const compute = spyOn(diffDecorations, 'computeLineDiffDecorations');
    try {
      await instance.asyncRender(diff);
      expect(compute).toHaveBeenCalledTimes(3);
      for (const startingLine of [0, 1, 2, 0]) {
        const result = instance.renderDiff(diff, {
          startingLine,
          totalLines: 1,
          bufferBefore: 0,
          bufferAfter: 0,
        });
        expect(result).toBeDefined();
        expect(compute).toHaveBeenCalledTimes(3);
      }

      instance.updateRenderCache(
        new Map([[1, [[0, '', 'other two']]]]),
        'dark'
      );
      const edited = instance.renderDiff(diff)!;
      expect(compute).toHaveBeenCalledTimes(4);
      expect(
        JSDOM.fragment(instance.renderFullHTML(edited)).querySelector(
          '[data-additions] [data-line="2"] [data-diff-span]'
        )?.textContent
      ).toBe('other');
      instance.renderDiff(diff);
      expect(compute).toHaveBeenCalledTimes(4);

      // The old side can change too, for example after applying a hunk.
      diff.deletionLines[1] = 'other two\n';
      const matching = await instance.asyncRender(diff);
      expect(compute).toHaveBeenCalledTimes(5);
      expect(
        JSDOM.fragment(instance.renderFullHTML(matching)).querySelector(
          '[data-additions] [data-line="2"] [data-diff-span]'
        )
      ).toBeNull();
    } finally {
      compute.mockRestore();
      instance.cleanUp();
    }
  });

  test('invalidates cached line diffs when options or the file change', async () => {
    const instance = new DiffHunksRenderer({
      diffStyle: 'split',
      lineDiffType: 'word',
    });
    const oldFile = { name: 'cached.txt', contents: 'hello\n' };
    const newFile = { name: 'cached.txt', contents: 'help\n' };
    const diff = parseDiffFromFile(oldFile, newFile);
    const compute = spyOn(diffDecorations, 'computeLineDiffDecorations');
    try {
      const word = await instance.asyncRender(diff);
      expect(compute).toHaveBeenCalledTimes(1);
      expect(
        JSDOM.fragment(instance.renderFullHTML(word)).querySelector(
          '[data-additions] [data-diff-span]'
        )?.textContent
      ).toBe('help');

      instance.mergeOptions({ lineDiffType: 'char' });
      const char = await instance.asyncRender(diff);
      expect(compute).toHaveBeenCalledTimes(2);
      expect(
        JSDOM.fragment(instance.renderFullHTML(char)).querySelector(
          '[data-additions] [data-diff-span]'
        )?.textContent
      ).toBe('p');

      instance.mergeOptions({ maxLineDiffLength: 2 });
      expect(countInlineDiffSpans(await instance.asyncRender(diff))).toBe(0);
      expect(compute).toHaveBeenCalledTimes(3);
      await instance.asyncRender(diff);
      expect(compute).toHaveBeenCalledTimes(3);

      instance.mergeOptions({ lineDiffType: 'none' });
      expect(countInlineDiffSpans(await instance.asyncRender(diff))).toBe(0);
      expect(compute).toHaveBeenCalledTimes(3);

      instance.mergeOptions({ lineDiffType: 'char', maxLineDiffLength: 1000 });
      expect(
        countInlineDiffSpans(await instance.asyncRender(diff))
      ).toBeGreaterThan(0);
      expect(compute).toHaveBeenCalledTimes(4);
      await instance.asyncRender(parseDiffFromFile(oldFile, newFile));
      expect(compute).toHaveBeenCalledTimes(5);

      instance.recycle();
      await instance.asyncRender(diff);
      expect(compute).toHaveBeenCalledTimes(6);
    } finally {
      compute.mockRestore();
      instance.cleanUp();
    }
  });
});
