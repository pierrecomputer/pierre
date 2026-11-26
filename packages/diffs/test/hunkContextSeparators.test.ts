import { createTwoFilesPatch } from '@pierre/patches';
import { afterAll, describe, expect, test } from 'bun:test';

import {
  areHunkDataEqual,
  DiffHunksRenderer,
  disposeHighlighter,
  processFile,
} from '../src';
import type { FileDiffMetadata } from '../src/types';
import { assertDefined } from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

// Two 30-line functions. `func alpha() {` is line 3 and `func beta() {` is
// line 36. One line changes in each body, so the second hunk starts at line
// 42 and the gap above it (lines 10-41) contains `func beta() {`.
function functionBody(name: string): string[] {
  return Array.from({ length: 30 }, (_, i) => `\t${name}(${i})\n`);
}

const oldLines = [
  'package demo\n',
  '\n',
  'func alpha() {\n',
  ...functionBody('a'),
  '}\n',
  '\n',
  'func beta() {\n',
  ...functionBody('b'),
  '}\n',
];
const newLines = oldLines.map((line) =>
  line === '\ta(2)\n' || line === '\tb(8)\n' ? line.replace(')', ', 1)') : line
);

// git writes the scope of each hunk's first line after its `@@` header. The
// patch library doesn't, so the names are added the way git would have.
function parseWithContexts(contexts: (string | undefined)[]): FileDiffMetadata {
  const oldFile = { name: 'demo.go', contents: oldLines.join('') };
  const newFile = { name: 'demo.go', contents: newLines.join('') };
  let hunkIndex = 0;
  const patch = createTwoFilesPatch(
    oldFile.name,
    newFile.name,
    oldFile.contents,
    newFile.contents,
    undefined,
    undefined,
    { context: 3 }
  ).replace(/^(@@ [^@]+ @@).*$/gm, (header: string, specs: string) => {
    const context = contexts[hunkIndex++];
    return context != null ? `${specs} ${context}` : header;
  });
  const diff = processFile(patch, { oldFile, newFile, throwOnError: true });
  assertDefined(diff, 'expected the patch to parse');
  expect(diff.isPartial).toBe(false);
  expect(diff.hunks.length).toBe(2);
  expect(diff.hunks[1]?.deletionStart).toBe(42);
  return diff;
}

async function separatorContexts(
  renderer: DiffHunksRenderer,
  diff: FileDiffMetadata
): Promise<Record<number, string | undefined>> {
  const result = await renderer.asyncRender(diff);
  return Object.fromEntries(
    result.hunkData.map((data) => [data.hunkIndex, data.hunkContext])
  );
}

function createRenderer(): DiffHunksRenderer {
  return new DiffHunksRenderer({
    diffStyle: 'unified',
    hunkSeparators: 'line-info',
    expansionLineCount: 20,
  });
}

describe('hunk context in separators', () => {
  test('shows the name from the hunk header next to the line count', async () => {
    const diff = parseWithContexts(['func alpha() {', 'func beta() {']);
    const renderer = createRenderer();
    const result = await renderer.asyncRender(diff);
    const html = renderer.renderFullHTML(result);

    expect(
      result.hunkData.map(({ hunkIndex, hunkContext }) => ({
        hunkIndex,
        hunkContext,
      }))
    ).toEqual([
      { hunkIndex: 0, hunkContext: 'func alpha() {' },
      { hunkIndex: 1, hunkContext: 'func beta() {' },
      { hunkIndex: 2, hunkContext: undefined },
    ]);
    expect(html).toContain('<span data-hunk-context="">func beta() {</span>');
  });

  test('renders no name when the hunk header has none', async () => {
    const diff = parseWithContexts([undefined, undefined]);
    const renderer = createRenderer();
    const result = await renderer.asyncRender(diff);

    expect(result.hunkData.every((data) => data.hunkContext == null)).toBe(
      true
    );
    expect(renderer.renderFullHTML(result)).not.toContain('data-hunk-context');
  });

  test('keeps the name when lines are revealed below the previous hunk', async () => {
    const diff = parseWithContexts(['func alpha() {', 'func beta() {']);
    const renderer = createRenderer();
    renderer.expandHunk(1, 'up', 28);

    expect((await separatorContexts(renderer, diff))[1]).toBe('func beta() {');
  });

  test('keeps the name while its line is still collapsed', async () => {
    const diff = parseWithContexts(['func alpha() {', 'func beta() {']);
    const renderer = createRenderer();
    renderer.expandHunk(1, 'down', 3);

    expect((await separatorContexts(renderer, diff))[1]).toBe('func beta() {');
  });

  test('uses the scope above once the named line is revealed', async () => {
    const diff = parseWithContexts(['func alpha() {', 'func beta() {']);
    const renderer = createRenderer();
    renderer.expandHunk(1, 'down', 10);

    expect((await separatorContexts(renderer, diff))[1]).toBe('func alpha() {');
  });

  // Custom separators are only rebuilt when their HunkData differs, so a
  // changed name alone has to make it differ.
  test('treats separators with different names as different', async () => {
    const before = await createRenderer().asyncRender(
      parseWithContexts(['func alpha() {', 'func beta() {'])
    );
    const after = await createRenderer().asyncRender(
      parseWithContexts(['func alpha() {', 'func gamma() {'])
    );
    const [beforeData, afterData] = [before.hunkData[1], after.hunkData[1]];
    assertDefined(beforeData, 'expected a separator above the second hunk');
    assertDefined(afterData, 'expected a separator above the second hunk');

    expect(areHunkDataEqual(beforeData, { ...beforeData })).toBe(true);
    expect(areHunkDataEqual(beforeData, afterData)).toBe(false);
  });
});
