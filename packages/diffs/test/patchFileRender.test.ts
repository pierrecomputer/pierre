import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import { parsePatchFiles } from '../src/utils/parsePatchFiles';
import {
  assertDefined,
  patchDigest,
  projectColumn,
  rowDigests,
  verifyHunkLineValues,
} from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

// NOTE(amadeus): This was a known tricky patch that our renderer would break
// on at one point
const patchFixture = readFileSync(resolve(__dirname, './file.patch'), 'utf-8');

describe('file.patch fixture', () => {
  test('parses and renders the patch file', async () => {
    const parsed = parsePatchFiles(patchFixture, 'file-patch');
    expect(parsed.length).toBe(1);
    const file = parsed.at(0)?.files[0];
    assertDefined(file, 'file should be defined');
    // The parsed hunk metadata must be internally consistent, and the digest
    // pins the geometry (a single hunk replacing a block deep in the file)
    // that originally broke the renderer
    expect(verifyHunkLineValues(file)).toEqual([]);
    expect(patchDigest(parsed)).toMatchSnapshot('patch digest');

    const renderer = new DiffHunksRenderer({ diffStyle: 'split' });
    const result = await renderer.asyncRender(file);
    assertDefined(
      result.additionsContentAST,
      'additionsContentAST should be defined'
    );
    assertDefined(
      result.deletionsContentAST,
      'deletionsContentAST should be defined'
    );
    expect({
      additions: rowDigests(projectColumn(result.additionsContentAST)),
      deletions: rowDigests(projectColumn(result.deletionsContentAST)),
    }).toMatchSnapshot('rendered rows');
  });
});
