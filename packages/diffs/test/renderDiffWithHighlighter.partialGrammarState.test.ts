import {
  afterAll,
  beforeAll,
  describe,
  expect,
  onTestFinished,
  test,
} from 'bun:test';
import { createTwoFilesPatch } from 'diff';
import type { ElementContent } from 'hast';
import { toHtml } from 'hast-util-to-html';

import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import type {
  DiffsHighlighter,
  RenderDiffOptions,
  SupportedLanguages,
} from '../src/types';
import { processPatch } from '../src/utils/parsePatchFiles';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import { assertDefined } from './testUtils';

const KEYWORD = '#D73A49';
const COMMENT = '#6A737D';

const options: RenderDiffOptions = {
  theme: 'github-light',
  useTokenTransformer: false,
  tokenizeMaxLineLength: 1000,
  lineDiffType: 'none',
  maxLineDiffLength: 1000,
};

const highlighters: Record<string, DiffsHighlighter> = {};
beforeAll(async () => {
  await disposeHighlighter();
  highlighters.shiki = await getSharedHighlighter({
    preferredHighlighter: 'shiki-js',
    themes: ['github-light'],
    langs: ['typescript', 'java'],
  });
});
afterAll(disposeHighlighter);

const TEMPLATE_BEFORE = [
  "const name = 'before';",
  '',
  'const message = `',
  '  Hello ${name},',
  ...Array.from(
    { length: 9 },
    (_, index) => `  Line ${index + 1} of the message.`
  ),
  '  Regards,',
  '`;',
  '',
  'const count = 3;',
  '',
  'export { message, count };',
];

const FILLER = Array.from(
  { length: 9 },
  (_, index) => ` * Detail ${index + 1} of the comment.`
);

// A patch with 3 lines of context, so the lines between its hunks are unknown.
function createPartialDiff(
  name: string,
  before: string[],
  edits: Record<number, string>,
  hunkCount = 2
) {
  const after = before.map((line, index) => edits[index + 1] ?? line);
  const diff = processPatch(
    createTwoFilesPatch(
      name,
      name,
      `${before.join('\n')}\n`,
      `${after.join('\n')}\n`,
      undefined,
      undefined,
      { context: 3 }
    )
  ).files[0];
  assertDefined(diff, 'expected the patch to contain a file');
  expect(diff.isPartial).toBe(true);
  expect(diff.hunks.length).toBe(hunkCount);
  return diff;
}

// The HTML of the addition row with this line number in the new file.
function getAdditionRow(
  lines: (ElementContent | undefined)[],
  lineNumber: number
): string {
  for (const line of lines) {
    if (line == null) continue;
    const html = toHtml(line);
    if (html.includes(`data-line="${lineNumber}"`)) return html;
  }
  throw new Error(`expected an addition row for line ${lineNumber}`);
}

// The color of the first token whose text starts with this word. Tokens with
// one color merge, so a line read as a string is a single token.
function getTokenColor(row: string, word: string): string | undefined {
  for (const [, color, text] of row.matchAll(
    /<span style="color:(#[0-9A-Fa-f]{6})">([^<]*)<\/span>/g
  )) {
    if (text?.trimStart().startsWith(word) === true) {
      return color?.toUpperCase();
    }
  }
  return undefined;
}

function render(
  name: string,
  lang: SupportedLanguages,
  before: string[],
  edits: Record<number, string>,
  hunkCount = 2
) {
  const diff = createPartialDiff(name, before, edits, hunkCount);
  diff.lang = lang;
  return renderDiffWithHighlighter(diff, highlighters.shiki, options).code
    .additionLines;
}

// Like `render`, but returns the deletion rows, whose line numbers come from
// the old file.
function renderDeletions(
  name: string,
  lang: SupportedLanguages,
  before: string[],
  edits: Record<number, string>
) {
  const diff = createPartialDiff(name, before, edits);
  diff.lang = lang;
  return renderDiffWithHighlighter(diff, highlighters.shiki, options).code
    .deletionLines;
}

describe('renderDiffWithHighlighter partial diffs', () => {
  test('a template literal that spans the gap between hunks closes in the later hunk', () => {
    const lines = render(
      'example.ts',
      'typescript',
      [
        "const name = 'before';",
        '',
        'const message = `',
        '  Hello ${name},',
        ...Array.from(
          { length: 9 },
          (_, index) => `  Line ${index + 1} of the message.`
        ),
        '  Regards,',
        '`;',
        '',
        'const count = 3;',
        '',
        'export { message, count };',
      ],
      { 1: "const name = 'after';", 17: 'const count = 4;' }
    );
    expect(getTokenColor(getAdditionRow(lines, 17), 'const')).toBe(KEYWORD);
  });

  test('a block comment that spans the gap between hunks continues in the later hunk', () => {
    const lines = render(
      'example.ts',
      'typescript',
      [
        'const foo = 1;',
        '',
        '/**',
        ' * Start of a comment.',
        ...FILLER,
        ' * end of a comment.',
        ' **/',
        '',
        'const baz = 3;',
        '',
        'export { foo, baz };',
      ],
      { 1: 'const foo = 2;', 17: 'const baz = 4;' }
    );
    expect(getAdditionRow(lines, 14)).toContain(COMMENT);
    expect(getTokenColor(getAdditionRow(lines, 17), 'const')).toBe(KEYWORD);
  });

  test('a block comment that ends in the gap between hunks does not continue in the later hunk', () => {
    const lines = render(
      'Example.java',
      'java',
      [
        'public class Example {',
        '    private static final String NAME = "example";',
        '',
        '    private static final String LABEL = "before";',
        '',
        '    /**',
        '     * A sample comment.',
        '     * It has several lines.',
        '     * The value is defined below.',
        '     */',
        '    private static final int DEFAULT_VALUE =',
        '        Math.max(',
        '            0,',
        '            1',
        '        );',
        '',
        '',
        '    private static final int VALUE = 0;',
        '',
        '    public int getValue() {',
        '        return VALUE;',
        '    }',
        '',
        '}',
      ],
      {
        4: '    private static final String LABEL = "after";',
        18: '    private static final int VALUE = 1;',
      }
    );
    expect(getTokenColor(getAdditionRow(lines, 18), 'private')).toBe(KEYWORD);
  });

  test('a template literal that spans the gap closes on the deletion side too', () => {
    const lines = renderDeletions('example.ts', 'typescript', TEMPLATE_BEFORE, {
      1: "const name = 'after';",
      17: 'const count = 4;',
    });
    expect(getTokenColor(getAdditionRow(lines, 17), 'const')).toBe(KEYWORD);
  });

  test('a hunk that ends inside the same function it started in keeps highlighting', () => {
    const lines = render(
      'example.ts',
      'typescript',
      [
        'const first = 1;',
        '',
        'function run() {',
        '  const a = 1;',
        '  const b = 2;',
        '  const c = 3;',
        '  const d = 4;',
        '  const e = 5;',
        '  const f = 6;',
        '  const g = 7;',
        '  const h = 8;',
        '  const i = 9;',
        '  const j = 10;',
        '  const k = 11;',
        '  return a + k;',
        '}',
      ],
      { 1: 'const first = 2;', 12: '  const j = 20;' }
    );
    expect(getTokenColor(getAdditionRow(lines, 12), 'const')).toBe(KEYWORD);
  });

  test('a template literal that spans an entire middle hunk still closes in the last hunk', () => {
    const lines = render(
      'example.ts',
      'typescript',
      [
        "const name = 'before';",
        '',
        'const message = `',
        ...Array.from(
          { length: 27 },
          (_, index) => `  Line ${index + 1} of the message.`
        ),
        '`;',
        '',
        'const count = 3;',
      ],
      {
        1: "const name = 'after';",
        15: '  Line 12 of the edited message.',
        33: 'const count = 4;',
      },
      3
    );
    expect(getTokenColor(getAdditionRow(lines, 33), 'const')).toBe(KEYWORD);
  });

  test('a block comment that spans an entire middle hunk still ends in the last hunk', () => {
    const lines = render(
      'example.ts',
      'typescript',
      [
        'const first = 1;',
        '',
        '/**',
        ' * Start of a comment.',
        ...Array.from(
          { length: 18 },
          (_, index) => ` * Detail ${index + 1} of the comment.`
        ),
        ' */',
        '',
        'const last = 3;',
      ],
      {
        1: 'const first = 2;',
        14: ' * Detail 10 of the edited comment.',
        25: 'const last = 4;',
      },
      3
    );
    // The middle hunk is all comment text. A blank start would read it as code
    // and the later hunk would then read the closing `*/` as code too.
    expect(getAdditionRow(lines, 14)).toContain(COMMENT);
    expect(getAdditionRow(lines, 22)).toContain(COMMENT);
    expect(getTokenColor(getAdditionRow(lines, 25), 'const')).toBe(KEYWORD);
  });

  test('the Highlights backend, which returns no grammar state, still renders every hunk', async () => {
    await disposeHighlighter();
    const highlights = await getSharedHighlighter({
      preferredHighlighter: 'highlights',
      themes: ['github-light'],
      langs: ['typescript'],
    });
    // Later tests share `highlighters.shiki`, so restore it afterwards.
    onTestFinished(async () => {
      await disposeHighlighter();
      highlighters.shiki = await getSharedHighlighter({
        preferredHighlighter: 'shiki-js',
        themes: ['github-light'],
        langs: ['typescript', 'java'],
      });
    });
    const diff = createPartialDiff('example.ts', TEMPLATE_BEFORE, {
      1: "const name = 'after';",
      17: 'const count = 4;',
    });
    diff.lang = 'typescript';
    const { additionLines } = renderDiffWithHighlighter(
      diff,
      highlights,
      options
    ).code;
    expect(getAdditionRow(additionLines, 1)).toContain('after');
    expect(getAdditionRow(additionLines, 17)).toContain('count');
  });

  test('plain text rendering does not carry grammar state between hunks', () => {
    const diff = createPartialDiff('example.ts', TEMPLATE_BEFORE, {
      1: "const name = 'after';",
      17: 'const count = 4;',
    });
    diff.lang = 'typescript';
    const { additionLines } = renderDiffWithHighlighter(
      diff,
      highlighters.shiki,
      options,
      { forcePlainText: true }
    ).code;
    expect(getAdditionRow(additionLines, 17)).toContain('count');
  });
});
