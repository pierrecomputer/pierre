import { afterAll, describe, expect, test } from 'bun:test';

import {
  DiffHunksRenderer,
  disposeHighlighter,
  parseDiffFromFile,
} from '../src';
import { assertDefined, projectColumn } from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

// Must clear the highest argument limit among the engines this package runs on:
// V8 stops near 124k, JavaScriptCore near 639k.
const MASSIVE_LINE_COUNT = 700_000;

describe('DiffHunksRenderer massive diffs', () => {
  const renderer = new DiffHunksRenderer({
    diffStyle: 'unified',
  });

  // One repeated line is enough. A massive diff renders as plain text, so the
  // content of a line never reaches the code path under test — only the number
  // of lines does.
  const massiveContents = 'const value = 1;\n'.repeat(MASSIVE_LINE_COUNT);

  // Passing no old file makes this an added file, so the patch is one hunk
  // holding every line.
  const massiveDiff = parseDiffFromFile(null, {
    name: 'massive.ts',
    contents: massiveContents,
  });

  test('renders a single hunk larger than the engine argument limit', async () => {
    expect(massiveDiff.hunks.length).toBe(1);
    expect(massiveDiff.additionLines.length).toBe(MASSIVE_LINE_COUNT);

    const result = await renderer.asyncRender(massiveDiff);

    assertDefined(
      result.unifiedContentAST,
      'result.unifiedContentAST should be defined'
    );
    expect(projectColumn(result.unifiedContentAST).length).toBe(
      MASSIVE_LINE_COUNT
    );
  });
});
