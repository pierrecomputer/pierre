import { describe, expect, test } from 'bun:test';

import type { FileDiffMetadata } from '../src/types';
import { iterateOverDiff } from '../src/utils/iterateOverDiff';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import {
  parsePatchFiles,
  processFile,
  processPatch,
} from '../src/utils/parsePatchFiles';
import { assertDefined, verifyFileDiffHunkValues } from './testUtils';

// parseDiffFromFile pairs change-block lines by similarity: the diff library
// orders every deleted line before every added line in a block, and split
// view pairs block lines positionally, so without realignment a blank line
// inserted above an edited line renders across from the old text while the
// edited line faces a gap.

const CONTEXT = 'alpha\nbravo\ncharlie\ndelta\n';

const issue1229Patch = `diff --git a/load.ts b/load.ts
--- a/load.ts
+++ b/load.ts
@@ -1,6 +1,14 @@
 export function load(path: string) {
-  const text = readFileSync(path, 'utf8');
-  const data = JSON.parse(text);
-  validate(data);
-  return data;
+  let lastError: unknown;
+  for (let attempt = 0; attempt < 3; attempt++) {
+    try {
+      const text = readFileSync(path, 'utf8');
+      const data = JSON.parse(text);
+      validate(data);
+      return data;
+    } catch (err) {
+      lastError = err;
+    }
+  }
+  throw lastError;
 }
`;

function parse(oldMiddle: string, newMiddle: string): FileDiffMetadata {
  return parseDiffFromFile(
    { name: 'a.ts', contents: CONTEXT + oldMiddle + CONTEXT },
    { name: 'a.ts', contents: CONTEXT + newMiddle + CONTEXT }
  );
}

function changeBlocks(diff: FileDiffMetadata) {
  return diff.hunks.flatMap((hunk) =>
    hunk.hunkContent.filter((content) => content.type === 'change')
  );
}

describe('parsed change-block realignment', () => {
  test.each([undefined, false, true])(
    'issue 1229 block and unified row order with disableLineMatching=%p',
    (disableLineMatching) => {
      const options = { disableLineMatching, throwOnError: true };
      const files = [
        processFile(issue1229Patch, options),
        processPatch(issue1229Patch, options).files[0],
        parsePatchFiles(issue1229Patch, options)[0].files[0],
        parseDiffFromFile(
          {
            name: 'load.ts',
            contents: `export function load(path: string) {
  const text = readFileSync(path, 'utf8');
  const data = JSON.parse(text);
  validate(data);
  return data;
}
`,
          },
          {
            name: 'load.ts',
            contents: `export function load(path: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const text = readFileSync(path, 'utf8');
      const data = JSON.parse(text);
      validate(data);
      return data;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
`,
          },
          { disableLineMatching },
          true
        ),
      ];

      for (const file of files) {
        assertDefined(file, 'Expected the issue 1229 patch to parse');
        expect(changeBlocks(file)).toEqual(
          disableLineMatching === true
            ? [
                {
                  type: 'change',
                  deletions: 4,
                  additions: 12,
                  deletionLineIndex: 1,
                  additionLineIndex: 1,
                },
              ]
            : [
                {
                  type: 'change',
                  deletions: 0,
                  additions: 3,
                  deletionLineIndex: 1,
                  additionLineIndex: 1,
                },
                {
                  type: 'change',
                  deletions: 4,
                  additions: 4,
                  deletionLineIndex: 1,
                  additionLineIndex: 4,
                },
                {
                  type: 'change',
                  deletions: 0,
                  additions: 5,
                  deletionLineIndex: 5,
                  additionLineIndex: 8,
                },
              ]
        );

        const rows: string[] = [];
        iterateOverDiff({
          diff: file,
          diffStyle: 'unified',
          callback({ type, deletionLine }) {
            rows.push(
              type !== 'change' ? ' ' : deletionLine != null ? '-' : '+'
            );
          },
        });
        expect(rows.join('')).toBe(
          disableLineMatching === true
            ? ' ----++++++++++++ '
            : ' +++----+++++++++ '
        );
        expect(file.splitLineCount).toBe(14);
        expect(file.unifiedLineCount).toBe(18);
        expect(verifyFileDiffHunkValues(file)).toEqual({
          valid: true,
          errors: [],
        });

        for (const diffStyle of ['split', 'unified'] as const) {
          const allRows: [number | undefined, number | undefined][] = [];
          iterateOverDiff({
            diff: file,
            diffStyle,
            callback({ deletionLine, additionLine }) {
              allRows.push([deletionLine?.lineIndex, additionLine?.lineIndex]);
            },
          });
          expect(allRows).toHaveLength(diffStyle === 'split' ? 14 : 18);
          expect(
            allRows.flatMap(([old]) => (old == null ? [] : [old]))
          ).toEqual(Array.from({ length: 6 }, (_, index) => index));
          expect(
            allRows.flatMap(([, next]) => (next == null ? [] : [next]))
          ).toEqual(Array.from({ length: 14 }, (_, index) => index));

          // Windows begin and end inside the replacement and cross its edges.
          for (const startingLine of [0, 1, 3, 4, 5, 8, 13, 17]) {
            const windowRows: typeof allRows = [];
            iterateOverDiff({
              diff: file,
              diffStyle,
              startingLine,
              totalLines: 4,
              callback({ deletionLine, additionLine }) {
                windowRows.push([
                  deletionLine?.lineIndex,
                  additionLine?.lineIndex,
                ]);
              },
            });
            expect(windowRows).toEqual(
              allRows.slice(startingLine, startingLine + 4)
            );
          }
        }
      }
    }
  );

  test('preserves a deletion-heavy replacement as written', () => {
    const patch = `--- image.html
+++ image.html
@@ -1,3 +1 @@
-<div>
-  <img />
-</div>
+<img />
`;
    const file = processFile(patch, {
      disableLineMatching: true,
      throwOnError: true,
    });
    assertDefined(file, 'Expected the image patch to parse');
    expect(changeBlocks(file)).toEqual([
      {
        type: 'change',
        deletions: 3,
        additions: 1,
        deletionLineIndex: 0,
        additionLineIndex: 0,
      },
    ]);
    expect(file.deletionLines).toEqual(['<div>\n', '  <img />\n', '</div>\n']);
    expect(file.additionLines).toEqual(['<img />\n']);
    const matched = processFile(patch, { throwOnError: true });
    assertDefined(matched, 'Expected the image patch to parse with matching');
    expect(changeBlocks(matched)).toHaveLength(3);
  });

  test.each([
    ['equal counts', 'old\n', 'new\n', 1, 1],
    ['pure addition', '', 'new\n', 0, 1],
    ['pure deletion', 'old\n', '', 1, 0],
  ] as const)(
    'preserves %s with matching disabled',
    (_, oldText, newText, deletions, additions) => {
      const oldFile = { name: 'file.txt', contents: oldText };
      const newFile = { name: 'file.txt', contents: newText };
      const file = parseDiffFromFile(
        oldFile,
        newFile,
        { disableLineMatching: true },
        true
      );
      expect(changeBlocks(file)).toEqual([
        {
          type: 'change',
          deletions,
          additions,
          deletionLineIndex: deletions === 0 ? -1 : 0,
          additionLineIndex: additions === 0 ? -1 : 0,
        },
      ]);
      expect(file).toEqual(
        parseDiffFromFile(oldFile, newFile, undefined, true)
      );
    }
  );

  test('keeps context between separate replacements', () => {
    const file = parseDiffFromFile(
      {
        name: 'file.ts',
        contents: 'top\nconst a = 1;\nmiddle\nconst b = 1;\nbottom\n',
      },
      {
        name: 'file.ts',
        contents: 'top\n\nconst a = 2;\nmiddle\n\nconst b = 2;\nbottom\n',
      },
      { disableLineMatching: true },
      true
    );
    expect(file.hunks).toHaveLength(1);
    expect(file.hunks[0].hunkContent.map((content) => content.type)).toEqual([
      'context',
      'change',
      'context',
      'change',
      'context',
    ]);
    expect(changeBlocks(file)).toEqual([
      {
        type: 'change',
        deletions: 1,
        additions: 2,
        deletionLineIndex: 1,
        additionLineIndex: 1,
      },
      {
        type: 'change',
        deletions: 1,
        additions: 2,
        deletionLineIndex: 3,
        additionLineIndex: 4,
      },
    ]);
    expect(verifyFileDiffHunkValues(file)).toEqual({ valid: true, errors: [] });
  });

  test('retains missing final newlines with matching disabled', () => {
    const patch =
      '--- file.ts\n+++ file.ts\n@@ -1 +1,2 @@\n-const a = 1;\n\\ No newline at end of file\n+\n+const a = 2;\n\\ No newline at end of file\n';
    const file = processFile(patch, {
      disableLineMatching: true,
      throwOnError: true,
    });
    assertDefined(file, 'Expected the no-newline patch to parse');
    expect(file.deletionLines).toEqual(['const a = 1;']);
    expect(file.additionLines).toEqual(['\n', 'const a = 2;']);
    expect(changeBlocks(file)).toEqual([
      {
        type: 'change',
        deletions: 1,
        additions: 2,
        deletionLineIndex: 0,
        additionLineIndex: 0,
      },
    ]);
    expect(file.hunks[0].noEOFCRDeletions).toBe(true);
    expect(file.hunks[0].noEOFCRAdditions).toBe(true);
    const eofRows: [boolean | undefined, boolean | undefined][] = [];
    iterateOverDiff({
      diff: file,
      diffStyle: 'unified',
      callback({ deletionLine, additionLine }) {
        eofRows.push([deletionLine?.noEOFCR, additionLine?.noEOFCR]);
      },
    });
    expect(eofRows).toEqual([
      [true, undefined],
      [undefined, false],
      [undefined, true],
    ]);
  });

  test('disables matching for every file and commit in a patch', () => {
    const twoFiles =
      issue1229Patch + issue1229Patch.replaceAll('load.ts', 'retry.ts');
    const options = { disableLineMatching: true, throwOnError: true };
    const patches = [
      processPatch(twoFiles, options),
      ...parsePatchFiles(
        `From aaaaa first patch\n${twoFiles}From bbbbb second patch\n${twoFiles}`,
        options
      ),
    ];
    expect(patches).toHaveLength(3);
    for (const patch of patches) {
      expect(patch.files).toHaveLength(2);
      for (const file of patch.files) {
        expect(changeBlocks(file)).toEqual([
          {
            type: 'change',
            deletions: 4,
            additions: 12,
            deletionLineIndex: 1,
            additionLineIndex: 1,
          },
        ]);
      }
    }
  });
});

describe('parseDiffFromFile change-block realignment', () => {
  test('a blank line inserted above an edited line becomes its own insert block', () => {
    const diff = parse(
      '  const user = await db.users.findUnique({\n',
      '\n  const user = await db.users.findUniques({\n'
    );
    expect(changeBlocks(diff)).toEqual([
      {
        type: 'change',
        deletions: 0,
        additions: 1,
        deletionLineIndex: 4,
        additionLineIndex: 4,
      },
      {
        type: 'change',
        deletions: 1,
        additions: 1,
        deletionLineIndex: 4,
        additionLineIndex: 5,
      },
    ]);
  });

  test('a blank line inserted below an edited line keeps the single block', () => {
    // Positional pairing is already right here (edited line first), so the
    // block stays canonical.
    const diff = parse(
      '  const user = await db.users.findUnique({\n',
      '  const user = await db.users.findUniques({\n\n'
    );
    expect(changeBlocks(diff)).toEqual([
      {
        type: 'change',
        deletions: 1,
        additions: 2,
        deletionLineIndex: 4,
        additionLineIndex: 4,
      },
    ]);
  });

  test('a blank line removed above an edited line becomes its own delete block', () => {
    const diff = parse(
      '\n  const user = await db.users.findUnique({\n',
      '  const user = await db.users.findUniques({\n'
    );
    expect(changeBlocks(diff)).toEqual([
      {
        type: 'change',
        deletions: 1,
        additions: 0,
        deletionLineIndex: 4,
        additionLineIndex: 4,
      },
      {
        type: 'change',
        deletions: 1,
        additions: 1,
        deletionLineIndex: 5,
        additionLineIndex: 4,
      },
    ]);
  });

  test('whitespace-only differences pair as the same line', () => {
    // Unwrapping a container re-indents the kept line; similarity ignores
    // whitespace, so the img lines pair and the removed wrapper renders as
    // delete rows above and below.
    const diff = parse('<div>\n  <img />\n</div>\n', '<img />\n');
    expect(changeBlocks(diff)).toEqual([
      {
        type: 'change',
        deletions: 1,
        additions: 0,
        deletionLineIndex: 4,
        additionLineIndex: 4,
      },
      {
        type: 'change',
        deletions: 1,
        additions: 1,
        deletionLineIndex: 5,
        additionLineIndex: 4,
      },
      {
        type: 'change',
        deletions: 1,
        additions: 0,
        deletionLineIndex: 6,
        additionLineIndex: 5,
      },
    ]);
  });

  test('near-tie similarity keeps the canonical positional pairing', () => {
    // Both additions share an import shape with the deletion; neither is a
    // decisive winner, so the block must not be re-split.
    const diff = parse(
      "import Header from './Header';\n",
      "import HeaderSimple from '../components/HeaderSimple';\nimport Hero from '../components/Hero';\n"
    );
    expect(changeBlocks(diff)).toEqual([
      {
        type: 'change',
        deletions: 1,
        additions: 2,
        deletionLineIndex: 4,
        additionLineIndex: 4,
      },
    ]);
  });

  test('several inserted lines above an edited pair split at the right offset', () => {
    const diff = parse(
      'function work() {\n  return compute(value);\n}\n',
      '// note\n// more\nfunction work() {\n  return compute(values);\n}\n'
    );
    // The three old lines pair against the last three new lines; the two
    // comment lines become a leading insert block. (The identical lines end
    // up as context via the library; only the changed pair stays in a block,
    // so assert the paired block's indexes reflect the offset.)
    const blocks = changeBlocks(diff);
    for (const block of blocks) {
      if (block.type !== 'change') {
        continue;
      }
      if (block.deletions > 0 && block.additions > 0) {
        expect(block.additionLineIndex - block.deletionLineIndex).toBe(2);
      }
    }
    expect(diff.additionLines[4]).toBe('// note\n');
  });
});

describe('parsed blank-run positions', () => {
  test('a blank inserted beside an existing blank keeps its parsed position', () => {
    const diff = parse('const a = 1;\n\nrest\n', 'const a = 2;\n\n\nrest\n');
    expect(changeBlocks(diff)).toEqual([
      {
        type: 'change',
        deletions: 1,
        additions: 1,
        deletionLineIndex: 4,
        additionLineIndex: 4,
      },
      {
        type: 'change',
        deletions: 0,
        additions: 1,
        deletionLineIndex: 6,
        additionLineIndex: 6,
      },
    ]);
  });

  test('a blank removed beside an existing blank keeps its parsed position', () => {
    const diff = parse('const a = 1;\n\n\nrest\n', 'const a = 2;\n\nrest\n');
    expect(changeBlocks(diff)).toEqual([
      {
        type: 'change',
        deletions: 1,
        additions: 1,
        deletionLineIndex: 4,
        additionLineIndex: 4,
      },
      {
        type: 'change',
        deletions: 1,
        additions: 0,
        deletionLineIndex: 6,
        additionLineIndex: 6,
      },
    ]);
  });

  test('identical non-blank lines never slide', () => {
    // Adding a function before an identical closing brace: the canonical
    // position (insert after the existing `}`) must be preserved.
    const diff = parse(
      'function a() {\n}\n',
      'function a() {\n}\nfunction b() {\n}\n'
    );
    expect(changeBlocks(diff)).toEqual([
      {
        type: 'change',
        deletions: 0,
        additions: 2,
        deletionLineIndex: 6,
        additionLineIndex: 6,
      },
    ]);
  });

  test('whitespace-only but unequal lines do not slide', () => {
    // The context line holds a single space; the inserted line is empty.
    // They are not identical, so sliding would change the diff's meaning.
    const diff = parse('x = 1;\n \nrest\n', 'x = 2;\n \n\nrest\n');
    expect(changeBlocks(diff)).toEqual([
      {
        type: 'change',
        deletions: 1,
        additions: 1,
        deletionLineIndex: 4,
        additionLineIndex: 4,
      },
      {
        type: 'change',
        deletions: 0,
        additions: 1,
        deletionLineIndex: 6,
        additionLineIndex: 6,
      },
    ]);
  });

  test('keeps the parsed position at the bottom of a multi-blank run', () => {
    const diff = parse('head;\n\n\n\ntail;\n', 'head!;\n\n\n\n\ntail;\n');
    expect(changeBlocks(diff)).toEqual([
      {
        type: 'change',
        deletions: 1,
        additions: 1,
        deletionLineIndex: 4,
        additionLineIndex: 4,
      },
      {
        type: 'change',
        deletions: 0,
        additions: 1,
        deletionLineIndex: 8,
        additionLineIndex: 8,
      },
    ]);
  });

  test('keeps the parsed blank-line position across separate hunks', () => {
    // A blank run longer than the diff context splits the change and the
    // insert into separate hunks, with the run continuing through the
    // collapsed gap. The insert keeps the library's bottom-of-run position
    // against the content below.
    const oldContents = 'first\n' + '\n'.repeat(9) + 'last\n';
    const newContents = 'changed\n' + '\n'.repeat(10) + 'last\n';
    const diff = parseDiffFromFile(
      { name: 'blank-run.ts', contents: oldContents },
      { name: 'blank-run.ts', contents: newContents }
    );
    expect(diff.hunks).toHaveLength(2);
    expect(changeBlocks(diff)).toEqual([
      {
        type: 'change',
        deletions: 1,
        additions: 1,
        deletionLineIndex: 0,
        additionLineIndex: 0,
      },
      {
        type: 'change',
        deletions: 0,
        additions: 1,
        deletionLineIndex: 10,
        additionLineIndex: 10,
      },
    ]);
  });
});
