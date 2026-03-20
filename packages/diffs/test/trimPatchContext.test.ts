import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { trimPatchContext } from '../src/utils/trimPatchContext';

const buildContext = (count: number, label: string): string[] =>
  Array.from({ length: count }, (_, index) => ` ${label}-${index + 1}`);

describe('trimPatchContext', () => {
  test('trims and splits hunks with large context', () => {
    const hunk1Before = buildContext(40, 'h1-before');
    const hunk1After = buildContext(40, 'h1-after');
    const hunk2Before = buildContext(40, 'h2-before');
    const hunk2Middle = buildContext(36, 'h2-middle');
    const hunk2After = buildContext(40, 'h2-after');

    const patch = [
      'diff --git a/file.txt b/file.txt',
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1,82 +1,84 @@',
      ...hunk1Before,
      '-old-1',
      '-old-2',
      '+new-1',
      '+new-2',
      '+new-3',
      '+new-4',
      ...hunk1After,
      '@@ -200,118 +200,117 @@',
      ...hunk2Before,
      '+only-add',
      ...hunk2Middle,
      '-old-3',
      '-old-4',
      ...hunk2After,
    ].join('\n');

    const trimmed = trimPatchContext(patch, 10);

    const expected = [
      'diff --git a/file.txt b/file.txt',
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -31,22 +31,24 @@',
      ...hunk1Before.slice(30),
      '-old-1',
      '-old-2',
      '+new-1',
      '+new-2',
      '+new-3',
      '+new-4',
      ...hunk1After.slice(0, 10),
      '@@ -230,20 +230,21 @@',
      ...hunk2Before.slice(30),
      '+only-add',
      ...hunk2Middle.slice(0, 10),
      '@@ -266,22 +267,20 @@',
      ...hunk2Middle.slice(26),
      '-old-3',
      '-old-4',
      ...hunk2After.slice(0, 10),
    ].join('\n');

    expect(trimmed).toBe(expected);
  });

  test('omits count when it is 1 to match git formatting', () => {
    const patch = [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,0 +1,1 @@',
      '+hello',
    ].join('\n');

    const trimmed = trimPatchContext(patch, 0);

    const expected = [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,0 +1 @@',
      '+hello',
    ].join('\n');

    expect(trimmed).toBe(expected);
  });

  test('drops context-only hunks', () => {
    const patch = [
      'diff --git a/empty.txt b/empty.txt',
      '--- a/empty.txt',
      '+++ b/empty.txt',
      '@@ -1,4 +1,4 @@',
      ' one',
      ' two',
      ' three',
      ' four',
    ].join('\n');

    const trimmed = trimPatchContext(patch, 10);

    const expected = [
      'diff --git a/empty.txt b/empty.txt',
      '--- a/empty.txt',
      '+++ b/empty.txt',
    ].join('\n');

    expect(trimmed).toBe(expected);
  });

  test('trims trim.patch fixture and matches snapshot', () => {
    const patch = readFileSync(resolve(__dirname, './trim.patch'), 'utf-8');
    const trimmed = trimPatchContext(patch, 10);
    expect(trimmed).toMatchSnapshot('trim.patch trimmed');
  });
});
