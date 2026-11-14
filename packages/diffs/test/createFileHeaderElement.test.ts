import { afterEach, describe, expect, test } from 'bun:test';

import { i18n } from '../src/i18n/I18n';
import { createFileHeaderElement } from '../src/utils/createFileHeaderElement';
import { diffAcceptRejectHunk } from '../src/utils/diffAcceptRejectHunk';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { parsePatchFiles } from '../src/utils/parsePatchFiles';
import { assertDefined, collectAllElements } from './testUtils';

describe('createFileHeaderElement', () => {
  afterEach(() => {
    i18n.set();
  });

  test.each([
    ['en', ['-1,200', '+1,234']],
    ['de', ['-1.200', '+1.234']],
  ] as const)('groups the digits of large counts in %s', (locale, expected) => {
    i18n.set({ locale });
    const fileDiff = parseDiffFromFile(
      {
        name: 'large.txt',
        contents: Array.from({ length: 1200 }, (_, i) => `old ${i}\n`).join(''),
      },
      {
        name: 'large.txt',
        contents: Array.from({ length: 1234 }, (_, i) => `new ${i}\n`).join(''),
      }
    );
    const header = createFileHeaderElement({
      fileOrDiff: fileDiff,
      mode: 'default',
      stickyHeader: false,
    });
    const counts = collectAllElements([header]).filter(
      (element) =>
        element.properties['data-additions-count'] != null ||
        element.properties['data-deletions-count'] != null
    );

    expect(counts.map((element) => element.children[0])).toEqual(
      expected.map((value) => ({ type: 'text', value }))
    );
  });

  test.each([
    [
      'unified addition parsed as a change',
      '--- /dev/null\n+++ empty.ts\n',
      ['-0', '+0'],
    ],
    [
      'empty Git addition',
      'diff --git a/empty.ts b/empty.ts\nnew file mode 100644\nindex 000000000000..e69de29bb2d1\n',
      [],
    ],
    ['empty unified deletion', '--- empty.ts\n+++ /dev/null\n', ['-0', '+0']],
    [
      'empty Git deletion',
      'diff --git a/empty.ts b/empty.ts\ndeleted file mode 100644\nindex e69de29bb2d1..000000000000\n',
      ['-0', '+0'],
    ],
    [
      'pure rename',
      'diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n',
      ['-0', '+0'],
    ],
    [
      'binary addition',
      'diff --git a/image.png b/image.png\nnew file mode 100644\nBinary files /dev/null and b/image.png differ\n',
      [],
    ],
    [
      'new file with a blank line',
      'diff --git a/blank.ts b/blank.ts\nnew file mode 100644\n--- /dev/null\n+++ b/blank.ts\n@@ -0,0 +1 @@\n+\n',
      ['+1'],
    ],
    [
      'deleted line',
      '--- deleted.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n',
      ['-1'],
    ],
    [
      'modified line',
      '--- modified.ts\n+++ modified.ts\n@@ -1 +1 @@\n-old\n+new\n',
      ['-1', '+1'],
    ],
  ] as const)(
    'renders counts and preserves the metadata slot: %s',
    (_name, patch, expectedCounts) => {
      const fileDiff = parsePatchFiles(patch)[0]?.files[0];
      assertDefined(fileDiff, 'expected patch to contain one file');
      const header = createFileHeaderElement({
        fileOrDiff: fileDiff,
        mode: 'default',
        stickyHeader: false,
      });
      const elements = collectAllElements([header]);
      const counts = elements.filter(
        (element) =>
          element.properties['data-additions-count'] != null ||
          element.properties['data-deletions-count'] != null
      );

      expect(counts.map((element) => element.children[0])).toEqual(
        expectedCounts.map((value) => ({ type: 'text', value }))
      );
      expect(
        elements.some(
          (element) =>
            element.tagName === 'slot' &&
            element.properties.name === 'header-metadata'
        )
      ).toBe(true);
    }
  );

  test.each(['change', 'new'] as const)(
    'preserves zero counts after resolving a %s diff',
    (type) => {
      const fileDiff = diffAcceptRejectHunk(
        parseDiffFromFile(
          type === 'new' ? null : { name: 'file.ts', contents: 'old\n' },
          { name: 'file.ts', contents: 'new\n' }
        ),
        0,
        'accept'
      );
      expect(fileDiff.type).toBe(type);
      const header = createFileHeaderElement({
        fileOrDiff: fileDiff,
        mode: 'default',
        stickyHeader: false,
      });
      const elements = collectAllElements([header]);
      expect(
        elements.find(
          (element) => element.properties['data-deletions-count'] != null
        )?.children
      ).toEqual([{ type: 'text', value: '-0' }]);
      expect(
        elements.find(
          (element) => element.properties['data-additions-count'] != null
        )?.children
      ).toEqual([{ type: 'text', value: '+0' }]);
    }
  );

  test('renders default file header AST', () => {
    const header = createFileHeaderElement({
      fileOrDiff: {
        name: 'src/index.ts',
        contents: 'export {}\n',
      },
      mode: 'default',
      stickyHeader: false,
    });

    expect(header).toMatchSnapshot();
  });

  test('renders default renamed file header AST', () => {
    const header = createFileHeaderElement({
      fileOrDiff: {
        name: 'src/index.ts',
        prevName: 'src/old-index.ts',
        contents: 'export {}\n',
      },
      mode: 'default',
      stickyHeader: false,
    });

    expect(header).toMatchSnapshot();
  });

  test('renders custom file header AST', () => {
    const header = createFileHeaderElement({
      fileOrDiff: {
        name: 'src/index.ts',
        contents: 'export {}\n',
      },
      mode: 'custom',
      stickyHeader: false,
    });

    expect(header).toMatchSnapshot();
  });

  test('renders sticky file header AST', () => {
    const header = createFileHeaderElement({
      fileOrDiff: {
        name: 'src/index.ts',
        contents: 'export {}\n',
      },
      mode: 'default',
      stickyHeader: true,
    });

    expect(header.properties?.['data-sticky']).toBe('');
    expect(header).toMatchSnapshot();
  });
});
