import { describe, expect, test } from 'bun:test';

import type { FileDiffMetadata } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';

// parseDiffFromFile pairs change-block lines by similarity: the diff library
// orders every deleted line before every added line in a block, and split
// view pairs block lines positionally, so without realignment a blank line
// inserted above an edited line renders across from the old text while the
// edited line faces a gap.

const CONTEXT = 'alpha\nbravo\ncharlie\ndelta\n';

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

describe('blank-run slide canonicalization', () => {
  test('a blank inserted beside an existing blank slides up to the change above', () => {
    // Enter at the end of an edited line inserts a blank before an existing
    // one; the library reports the insert at the run's bottom, the slide
    // anchors it to the edited line (where the caret is).
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
        deletionLineIndex: 5,
        additionLineIndex: 5,
      },
    ]);
  });

  test('a blank removed beside an existing blank slides up', () => {
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
        deletionLineIndex: 5,
        additionLineIndex: 5,
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

  test('slides to the top of a multi-blank run', () => {
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
        deletionLineIndex: 5,
        additionLineIndex: 5,
      },
    ]);
  });
});
