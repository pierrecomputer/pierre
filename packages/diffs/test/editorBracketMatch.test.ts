import { afterAll, describe, expect, spyOn, test } from 'bun:test';

import { File } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor, type EditorOptions } from '../src/editor/editor';
import { findBracketMatchRanges } from '../src/editor/matchBrackets';
import { TextDocument } from '../src/editor/textDocument';
import { EditorTokenizer } from '../src/editor/tokenzier';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { FileContents } from '../src/types';
import { installDom, wait } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

async function waitForEditableContent(
  container: HTMLElement
): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const content = container.shadowRoot?.querySelector('[data-content]');
    if (
      content instanceof HTMLElement &&
      (content.contentEditable === 'true' ||
        content.getAttribute('contenteditable') === 'true')
    ) {
      return content;
    }
    await wait(0);
  }

  throw new Error('editor content did not become editable');
}

interface BracketMatchFixture {
  cleanup(): void;
  content: HTMLElement;
  editor: Editor<undefined>;
}

async function createBracketMatchFixture(
  contents: string,
  editorOptions: EditorOptions<undefined> = {}
): Promise<BracketMatchFixture> {
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);

  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
  });
  const editor = new Editor<undefined>(editorOptions);
  const initialFile: FileContents = { name: 'brackets.ts', contents };

  file.render({ file: initialFile, fileContainer, forceRender: true });
  editor.edit(file);

  const content = await waitForEditableContent(fileContainer);

  return {
    cleanup() {
      editor.cleanUp();
      file.cleanUp();
      dom.cleanup();
    },
    content,
    editor,
  };
}

function bracketMatchCount(content: HTMLElement): number {
  const root = content.getRootNode() as ShadowRoot;
  return root.querySelectorAll('[data-bracket-match-range]').length;
}

describe('editor bracket matching', () => {
  test('highlights the matching pair when the caret is after an opening bracket', async () => {
    const { cleanup, content, editor } =
      await createBracketMatchFixture('a(b[c]{d})');
    try {
      editor.setSelections([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 'none',
        },
      ]);

      expect(bracketMatchCount(content)).toBe(2);
    } finally {
      cleanup();
    }
  });

  test('highlights the matching pair when the caret is after a closing bracket', async () => {
    const { cleanup, content, editor } =
      await createBracketMatchFixture('a(b[c]{d})');
    try {
      editor.setSelections([
        {
          start: { line: 0, character: 10 },
          end: { line: 0, character: 10 },
          direction: 'none',
        },
      ]);

      expect(bracketMatchCount(content)).toBe(2);
    } finally {
      cleanup();
    }
  });

  test('does not render bracket matches when disabled', async () => {
    const { cleanup, content, editor } = await createBracketMatchFixture(
      'a(b)',
      { matchBrackets: false }
    );
    try {
      editor.setSelections([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 'none',
        },
      ]);

      expect(bracketMatchCount(content)).toBe(0);
    } finally {
      cleanup();
    }
  });

  test('does not read ignored token ranges when disabled', async () => {
    const getIgnoredRangesSpy = spyOn(
      EditorTokenizer.prototype,
      'getStringCommentRegexpRangesInLine'
    );
    const { cleanup, editor } = await createBracketMatchFixture('{ /{/ }', {
      matchBrackets: false,
    });
    try {
      editor.setSelections([
        {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 1 },
          direction: 'none',
        },
      ]);

      expect(getIgnoredRangesSpy).not.toHaveBeenCalled();
    } finally {
      cleanup();
      getIgnoredRangesSpy.mockRestore();
    }
  });

  test('does not render bracket matches for unmatched brackets', async () => {
    const { cleanup, content, editor } = await createBracketMatchFixture('a(b');
    try {
      editor.setSelections([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 'none',
        },
      ]);

      expect(bracketMatchCount(content)).toBe(0);
    } finally {
      cleanup();
    }
  });

  test('ignores brackets inside quoted strings and template literals', async () => {
    const { cleanup, content, editor } = await createBracketMatchFixture(
      '[ \'abc[\' ]\n[ "abc[" ]\n[ `abc[` ]'
    );
    try {
      for (const line of [0, 1, 2]) {
        editor.setSelections([
          {
            start: { line, character: 7 },
            end: { line, character: 7 },
            direction: 'none',
          },
        ]);

        expect(bracketMatchCount(content)).toBe(0);
      }
    } finally {
      cleanup();
    }
  });

  test('ignores brackets inside block comments', async () => {
    const { cleanup, content, editor } =
      await createBracketMatchFixture('{ /*{*/ }');
    try {
      editor.setSelections([
        {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 5 },
          direction: 'none',
        },
      ]);

      expect(bracketMatchCount(content)).toBe(0);

      editor.setSelections([
        {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 1 },
          direction: 'none',
        },
      ]);

      expect(bracketMatchCount(content)).toBe(2);
    } finally {
      cleanup();
    }
  });

  test('findBracketMatchRanges ignores brackets inside regex ranges', () => {
    const textDocument = new TextDocument('inmemory://1', '{ /{/ }', 'ts');
    const tokenizer = {
      getStringCommentRegexpRangesInLine(
        lineIndex: number
      ): [number, number][] {
        return lineIndex === 0 ? [[2, 5]] : [];
      },
    } as EditorTokenizer;

    expect(
      findBracketMatchRanges(textDocument, tokenizer, {
        line: 0,
        character: 4,
      })
    ).toBeUndefined();

    expect(
      findBracketMatchRanges(textDocument, tokenizer, {
        line: 0,
        character: 1,
      })
    ).toEqual([
      {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 7 },
      },
    ]);
  });

  test('does not match a bracket before a column-zero caret', () => {
    const textDocument = new TextDocument(
      'inmemory://1',
      'if (ok) {\nreturn ok;\n}',
      'ts'
    );
    const tokenizer = {
      getStringCommentRegexpRangesInLine() {
        return null;
      },
    } as unknown as EditorTokenizer;

    expect(
      findBracketMatchRanges(textDocument, tokenizer, {
        line: 1,
        character: 0,
      })
    ).toBeUndefined();
  });

  test('bounds forward scans for unmatched opening brackets', () => {
    const contents = ['(', ...Array.from({ length: 1_199 }, () => 'x')].join(
      '\n'
    );
    const textDocument = new TextDocument('inmemory://1', contents, 'ts');
    const checkedLines = new Set<number>();
    const tokenizer = {
      getStringCommentRegexpRangesInLine(lineIndex: number) {
        checkedLines.add(lineIndex);
        return null;
      },
    } as EditorTokenizer;

    expect(
      findBracketMatchRanges(textDocument, tokenizer, {
        line: 0,
        character: 1,
      })
    ).toBeUndefined();
    expect(checkedLines.size).toBeLessThan(textDocument.lineCount);
  });

  test('bounds backward scans for unmatched closing brackets', () => {
    const contents = [...Array.from({ length: 1_199 }, () => 'x'), ')'].join(
      '\n'
    );
    const textDocument = new TextDocument('inmemory://1', contents, 'ts');
    const checkedLines = new Set<number>();
    const tokenizer = {
      getStringCommentRegexpRangesInLine(lineIndex: number) {
        checkedLines.add(lineIndex);
        return null;
      },
    } as EditorTokenizer;

    expect(
      findBracketMatchRanges(textDocument, tokenizer, {
        line: textDocument.lineCount - 1,
        character: 1,
      })
    ).toBeUndefined();
    expect(checkedLines.size).toBeLessThan(textDocument.lineCount);
  });

  test('loads ignored ranges once per scanned line', () => {
    const contents = `(${Array.from({ length: 1_000 }, () => 'x').join('')}`;
    const textDocument = new TextDocument('inmemory://1', contents, 'ts');
    let getIgnoredRangesCount = 0;
    const tokenizer = {
      getStringCommentRegexpRangesInLine() {
        getIgnoredRangesCount++;
        return Array.from({ length: 250 }, (_, index) => {
          const start = index * 4 + 2;
          return [start, start + 1] as [number, number];
        });
      },
    } as unknown as EditorTokenizer;

    expect(
      findBracketMatchRanges(textDocument, tokenizer, {
        line: 0,
        character: 1,
      })
    ).toBeUndefined();
    expect(getIgnoredRangesCount).toBe(2);
  });
});
