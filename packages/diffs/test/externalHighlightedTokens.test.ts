import { describe, expect, test } from 'bun:test';

import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import { FileRenderer } from '../src/renderers/FileRenderer';
import { preloadFile } from '../src/ssr/preloadFile';
import type {
  ExternalHighlightedDiff,
  ExternalHighlightedFile,
  FileContents,
} from '../src/types';
import { linesFromFileContents } from '../src/utils/computeFileOffsets';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { renderFileWithHighlightedTokens } from '../src/utils/renderFileWithHighlightedTokens';
import { hastTextContent } from './testUtils';

function highlightFile(file: FileContents): ExternalHighlightedFile {
  const sourceLines = linesFromFileContents(file.contents);
  const lineCount =
    sourceLines.at(-1) === '' ? sourceLines.length - 1 : sourceLines.length;
  return {
    lines: sourceLines.slice(0, lineCount).map((line) => [
      {
        content: line.replace(/(?:\r\n|\r|\n)$/, ''),
        className: 'external-token',
      },
    ]),
  };
}

describe('caller-highlighted tokens', () => {
  test('uses the canonical file line model for CR-only contents', async () => {
    const file = { name: 'file.txt', contents: 'alpha\rbeta\rgamma' };
    const highlighted = highlightFile(file);
    const renderer = new FileRenderer();

    const result = await renderer.asyncRender(file, undefined, highlighted);

    expect(result.contentAST.map(hastTextContent)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
  });

  test('renders editor empty lines with a br element', () => {
    const file = { name: 'file.txt', contents: 'alpha\n\nbeta\n' };
    const highlighted = highlightFile(file);
    const result = renderFileWithHighlightedTokens(
      file,
      linesFromFileContents(file.contents),
      highlighted,
      true
    );
    const emptyLine = result.code[1];

    expect(emptyLine?.type).toBe('element');
    expect(
      emptyLine?.type === 'element' ? emptyLine.children[0] : undefined
    ).toMatchObject({ type: 'element', tagName: 'br' });
  });

  test('passes caller theme styles through file SSR', async () => {
    const file = { name: 'file.txt', contents: 'alpha' };
    const highlighted = {
      ...highlightFile(file),
      themeStyles: '--external-theme:active;',
      baseThemeType: 'dark' as const,
    };

    const result = await preloadFile({ file, highlighted });

    expect(result.highlighted).toBe(highlighted);
    expect(result.prerenderedHTML).toContain('--external-theme:active;');
    expect(result.prerenderedHTML).toContain('external-token');
  });

  test('maps windowed diff rows with collapsed context', async () => {
    const context = Array.from(
      { length: 30 },
      (_, index) => `context ${index}`
    );
    const oldFile = {
      name: 'file.txt',
      contents: [...context, 'old value', ...context].join('\n'),
    };
    const newFile = {
      name: 'file.txt',
      contents: [...context, 'new value', ...context].join('\n'),
    };
    const diff = parseDiffFromFile(oldFile, newFile);
    const highlighted: ExternalHighlightedDiff = {
      deletions: highlightFile(oldFile),
      additions: highlightFile(newFile),
      themeStyles: '--external-diff-theme:active;',
      baseThemeType: 'light',
    };
    diff.highlighted = highlighted;
    const renderer = new DiffHunksRenderer({
      diffStyle: 'unified',
      collapsedContextThreshold: 4,
    });

    const result = await renderer.asyncRender(diff, {
      startingLine: 0,
      totalLines: 6,
      bufferBefore: 0,
      bufferAfter: 0,
    });

    const renderedText = result.unifiedContentAST
      ?.map(hastTextContent)
      .join('\n');
    expect(renderedText).toContain('context 26');
    expect(renderedText).not.toContain('context 0');
    expect(result.themeStyles).toBe('--external-diff-theme:active;');
    expect(result.baseThemeType).toBe('light');
  });

  test('does not schedule worker highlighting during hydration', () => {
    const file = { name: 'file.txt', contents: 'alpha' };
    const highlighted = highlightFile(file);
    let fileHighlights = 0;
    let diffHighlights = 0;
    let cleanups = 0;
    const workerManager = {
      cleanUpTasks: () => cleanups++,
      getDiffRenderOptions: () => ({ theme: 'github-dark' }),
      getFileRenderOptions: () => ({ theme: 'github-dark' }),
      highlightDiffAST: () => diffHighlights++,
      highlightFileAST: () => fileHighlights++,
      isWorkingPool: () => true,
    };
    new FileRenderer({}, undefined, workerManager as never).hydrate(
      file,
      highlighted
    );
    const diff = parseDiffFromFile(file, {
      name: 'file.txt',
      contents: 'beta',
    });
    diff.highlighted = {
      deletions: highlighted,
      additions: highlightFile({ name: 'file.txt', contents: 'beta' }),
    };
    new DiffHunksRenderer({}, undefined, workerManager as never).hydrate(diff);

    expect({ fileHighlights, diffHighlights, cleanups }).toEqual({
      fileHighlights: 0,
      diffHighlights: 0,
      cleanups: 2,
    });
  });
});
