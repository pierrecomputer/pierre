import { afterAll, describe, expect, test } from 'bun:test';

import { disposeHighlighter, parseDiffFromFile } from '../src';
import { preloadFile, preloadFileDiff } from '../src/ssr';
import type { FileDiffMetadata } from '../src/types';
import { mockFiles } from './mocks';

afterAll(async () => {
  await disposeHighlighter();
});

function createDiffWithLeadingSeparator(): FileDiffMetadata {
  const oldLines = Array.from({ length: 40 }, (_, index) => `${index + 1}`);
  const newLines = oldLines.map((line, index) =>
    index === 24 ? 'changed-25' : line
  );
  return parseDiffFromFile(
    { name: 'leading-separator.ts', contents: `${oldLines.join('\n')}\n` },
    { name: 'leading-separator.ts', contents: `${newLines.join('\n')}\n` }
  );
}

describe('preloaded annotations', () => {
  test('plain files include file-level annotation slots', async () => {
    const { prerenderedHTML } = await preloadFile({
      file: mockFiles.file1,
      annotations: [{ lineNumber: 0, metadata: 'file' }],
    });

    expect(prerenderedHTML).toContain('slot name="annotation-0"');
  });

  test('diffs include file-level annotation slots before leading separators', async () => {
    const { prerenderedHTML } = await preloadFileDiff({
      fileDiff: createDiffWithLeadingSeparator(),
      options: { diffStyle: 'unified' },
      annotations: [{ side: 'additions', lineNumber: 0, metadata: 'file' }],
    });
    const annotationIndex = prerenderedHTML.indexOf(
      'slot name="annotation-additions-0"'
    );
    const separatorIndex = prerenderedHTML.indexOf(
      'data-separator=',
      annotationIndex
    );

    expect(annotationIndex).toBeGreaterThanOrEqual(0);
    expect(separatorIndex).toBeGreaterThan(annotationIndex);
  });
});
