import { afterAll, describe, expect, test } from 'bun:test';

import { File } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import { EditStack } from '../src/editor/editStack';
import {
  applyDeleteCharacterToSelections,
  applyDeleteHardLineForwardToSelections,
  applyDeleteSoftLineBackwardToSelections,
  applyDeleteWordBackwardToSelections,
  applyTextChangeToSelections,
  applyTextReplaceToSelections,
  applyTransposeToSelections,
  convertSelection,
  createSelectionFrom,
  type CursorMoveOptions,
  DirectionForward,
  DirectionNone,
  expandCollapsedSelectionToWord,
  extendSelection,
  extendSelections,
  findNextMatch,
  getAutoSurroundReplacementTexts,
  getCaretPosition,
  getDocumentBoundarySelection,
  getDocumentFullSelection,
  getSelectedLineBlocks,
  getSelectionAnchor,
  getSelectionText,
  isLineEditable,
  mapCursorMove,
  mapSelectionShift,
  mergeOverlappingSelections,
  remapSelectionsAfterEdits,
  resolveDeleteCharacterRange,
  resolveIndentEdits,
  resolveSelectionCut,
  selectionIntersects,
  shiftSelectionLines,
} from '../src/editor/selection';
import { DirectionBackward } from '../src/editor/selection';
import { TextDocument } from '../src/editor/textDocument';
import type { ResolvedTextEdit } from '../src/editor/textDocument';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type {
  EditorSelection,
  FileContents,
  SelectionDirection,
} from '../src/types';
import { installDom, wait } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

type MockNode = {
  nodeType: number;
  tagName?: string;
  parentElement?: MockElement | null;
  children?: MockElement[];
  childNodes?: MockNode[];
  textContent?: string | null;
};

type MockElement = MockNode & {
  tagName: string;
  parentElement?: MockElement | null;
  children: MockElement[];
  childNodes: MockNode[];
  dataset: Record<string, string>;
};

function composedRange(
  startContainer: Node,
  startOffset: number,
  endContainer = startContainer,
  endOffset = startOffset
): StaticRange {
  return {
    startContainer,
    startOffset,
    endContainer,
    endOffset,
    collapsed: startContainer === endContainer && startOffset === endOffset,
  } as StaticRange;
}

function editorSelection(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number
): EditorSelection {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
    direction: DirectionForward,
  };
}

function createSelection(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
  direction: SelectionDirection = DirectionNone
): EditorSelection {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
    direction,
  };
}

function pre(line: number, children: MockElement[] = []): MockElement {
  const element: MockElement = {
    nodeType: 1,
    tagName: 'DIV',
    parentElement: null,
    children,
    childNodes: children,
    textContent: null,
    dataset: { line: String(line + 1) },
  };
  for (const child of children) {
    child.parentElement = element;
  }
  return element;
}

function text(textContent: string): MockNode {
  return {
    nodeType: 3,
    textContent,
  };
}

function line(line: number, childNodes: MockNode[]): MockElement {
  const element = pre(
    line,
    childNodes.filter((child): child is MockElement => child.nodeType === 1)
  );
  element.childNodes = childNodes;
  element.textContent = childNodes
    .map((child) => child.textContent ?? '')
    .join('');
  for (const child of childNodes) {
    child.parentElement = element;
  }
  return element;
}

function br(): MockElement {
  return {
    nodeType: 1,
    tagName: 'BR',
    parentElement: null,
    children: [],
    childNodes: [],
    textContent: '',
    dataset: {},
  };
}

function span(text: string, char?: number): MockElement {
  const textNode: MockNode = {
    nodeType: 3,
    textContent: text,
  };
  const element: MockElement = {
    nodeType: 1,
    tagName: 'SPAN',
    parentElement: null,
    children: [],
    childNodes: [textNode],
    textContent: text,
    dataset: {},
  };
  textNode.parentElement = element;
  if (char !== undefined) {
    element.dataset.char = String(char);
  }
  return element;
}

// div > span[data-diff-span] > span[data-char] (nested diff tokens)
function diffSpan(...tokenSpans: MockElement[]): MockElement {
  const element: MockElement = {
    nodeType: 1,
    tagName: 'SPAN',
    parentElement: null,
    children: tokenSpans,
    childNodes: tokenSpans,
    textContent: tokenSpans.map((child) => child.textContent ?? '').join(''),
    dataset: { diffSpan: '' },
  };
  for (const child of tokenSpans) {
    child.parentElement = element;
  }
  return element;
}

function button(text: string): MockElement {
  const textNode: MockNode = {
    nodeType: 3,
    textContent: text,
  };
  const element: MockElement = {
    nodeType: 1,
    tagName: 'BUTTON',
    parentElement: null,
    children: [],
    childNodes: [textNode],
    textContent: text,
    dataset: {},
  };
  textNode.parentElement = element;
  return element;
}

function element(tagName: string, children: MockNode[] = []): MockElement {
  const el: MockElement = {
    nodeType: 1,
    tagName,
    parentElement: null,
    children: children.filter(
      (child): child is MockElement => child.nodeType === 1
    ),
    childNodes: children,
    textContent: children.map((child) => child.textContent ?? '').join(''),
    dataset: {},
  };
  for (const child of children) {
    child.parentElement = el;
  }
  return el;
}

describe('convertSelection', () => {
  test('maps a caret on an empty rendered line to character zero', () => {
    const line = pre(1, [br()]);
    expect(convertSelection(composedRange(line as unknown as Node, 0))).toEqual(
      {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 0 },
        direction: DirectionNone,
      }
    );
  });

  test('treats a placeholder br boundary as the start of the line', () => {
    const line = pre(2, [br()]);
    expect(convertSelection(composedRange(line as unknown as Node, 1))).toEqual(
      {
        start: { line: 2, character: 0 },
        end: { line: 2, character: 0 },
        direction: DirectionNone,
      }
    );
  });

  test('ignores the line number gutter span on an empty line', () => {
    const line = pre(3, [span('4'), br()]);
    expect(convertSelection(composedRange(line as unknown as Node, 1))).toEqual(
      {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 0 },
        direction: DirectionNone,
      }
    );
    expect(convertSelection(composedRange(line as unknown as Node, 2))).toEqual(
      {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 0 },
        direction: DirectionNone,
      }
    );
  });

  test('ignores the fold toggle button in the gutter', () => {
    const line = pre(4, [span('5'), button('>'), span('color', 0)]);
    expect(convertSelection(composedRange(line as unknown as Node, 2))).toEqual(
      {
        start: { line: 4, character: 0 },
        end: { line: 4, character: 0 },
        direction: DirectionNone,
      }
    );
  });

  test('maps a direct line text node to its character offset', () => {
    const textNode = text('abcdef');
    line(6, [textNode]);
    expect(
      convertSelection(composedRange(textNode as unknown as Node, 2))
    ).toEqual({
      start: { line: 6, character: 2 },
      end: { line: 6, character: 2 },
      direction: DirectionNone,
    });
  });

  test('maps div>span token text from data-char', () => {
    const token = span('abcdef', 10);
    const textNode = token.childNodes[0];
    pre(7, [token]);
    expect(
      convertSelection(composedRange(textNode as unknown as Node, 3))
    ).toEqual({
      start: { line: 7, character: 13 },
      end: { line: 7, character: 13 },
      direction: DirectionNone,
    });
  });

  test('maps div>span>span nested diff-span boundaries', () => {
    const diffToken = span('_diff', 15);
    const diff = diffSpan(diffToken, span(':', 20));
    const line = pre(8, [span('  ', 0), span('async', 2), diff]);
    const textNode = diffToken.childNodes[0];

    expect(
      convertSelection(composedRange(textNode as unknown as Node, 2))
    ).toEqual({
      start: { line: 8, character: 17 },
      end: { line: 8, character: 17 },
      direction: DirectionNone,
    });
    expect(convertSelection(composedRange(diff as unknown as Node, 1))).toEqual(
      {
        start: { line: 8, character: 20 },
        end: { line: 8, character: 20 },
        direction: DirectionNone,
      }
    );
    expect(convertSelection(composedRange(line as unknown as Node, 3))).toEqual(
      {
        start: { line: 8, character: 21 },
        end: { line: 8, character: 21 },
        direction: DirectionNone,
      }
    );
  });

  test('ignores newline placeholders in direct line text nodes', () => {
    const textNode = text('\n');
    line(8, [textNode]);
    expect(
      convertSelection(composedRange(textNode as unknown as Node, 1))
    ).toEqual({
      start: { line: 8, character: 0 },
      end: { line: 8, character: 0 },
      direction: DirectionNone,
    });
  });

  test('maps clicks inside a fold button on an empty line to character zero', () => {
    const icon = element('SVG', [element('POLYLINE')]);
    const toggle = element('BUTTON', [icon]);
    pre(5, [span('6'), toggle, br()]);
    expect(
      convertSelection(composedRange(toggle as unknown as Node, 0))
    ).toEqual({
      start: { line: 5, character: 0 },
      end: { line: 5, character: 0 },
      direction: DirectionNone,
    });
    expect(convertSelection(composedRange(icon as unknown as Node, 0))).toEqual(
      {
        start: { line: 5, character: 0 },
        end: { line: 5, character: 0 },
        direction: DirectionNone,
      }
    );
  });

  test('maps a text node inside a nested diff-span token', () => {
    const diffToken = span('_diff', 15);
    const diff = diffSpan(diffToken, span(':', 20), span(' FileMetadata', 22));
    const textNode = diffToken.childNodes[0];
    pre(9, [span('  ', 0), span('async', 2), span(' render', 8), diff]);
    expect(
      convertSelection(composedRange(textNode as unknown as Node, 2))
    ).toEqual({
      start: { line: 9, character: 17 },
      end: { line: 9, character: 17 },
      direction: DirectionNone,
    });
  });

  test('maps a boundary at the start of a nested diff-span wrapper', () => {
    const diff = diffSpan(span('_diff', 15), span(':', 20));
    pre(10, [span(' render', 8), diff]);
    expect(convertSelection(composedRange(diff as unknown as Node, 0))).toEqual(
      {
        start: { line: 10, character: 15 },
        end: { line: 10, character: 15 },
        direction: DirectionNone,
      }
    );
  });

  test('maps a boundary between nested diff-span tokens', () => {
    const diff = diffSpan(span('_diff', 15), span(':', 20));
    pre(11, [diff]);
    expect(convertSelection(composedRange(diff as unknown as Node, 1))).toEqual(
      {
        start: { line: 11, character: 20 },
        end: { line: 11, character: 20 },
        direction: DirectionNone,
      }
    );
  });

  test('maps a text node inside a wrapped token fragment', () => {
    const fragment = span('diff', undefined);
    const token = span('', 15);
    token.childNodes = [fragment];
    token.children = [fragment];
    token.textContent = 'diff';
    fragment.parentElement = token;
    const textNode = fragment.childNodes[0];
    pre(12, [token]);
    expect(
      convertSelection(composedRange(textNode as unknown as Node, 1))
    ).toEqual({
      start: { line: 12, character: 16 },
      end: { line: 12, character: 16 },
      direction: DirectionNone,
    });
  });
});

describe('getSelectionAnchor', () => {
  test('returns a text node offset inside a nested diff-span token', () => {
    const diffToken = span('_diff', 15);
    const line = pre(9, [span('4'), diffSpan(diffToken, span(':', 20))]);
    const [node, offset] = getSelectionAnchor(
      line as unknown as HTMLElement,
      17
    );
    expect(node.nodeType).toBe(3);
    expect(offset).toBe(2);
  });

  test('ignores gutter spans when mapping character positions', () => {
    const token = span('code', 0);
    const line = pre(3, [span('112'), token]);
    const [node, offset] = getSelectionAnchor(
      line as unknown as HTMLElement,
      2
    );
    expect(node).toBe(token.childNodes[0] as unknown as Node);
    expect(offset).toBe(2);
  });

  test('returns br anchor on an empty rendered line', () => {
    const placeholder = br();
    const line = pre(4, [placeholder]);
    const [node, offset] = getSelectionAnchor(
      line as unknown as HTMLElement,
      0
    );
    expect(node).toBe(placeholder as unknown as Node);
    expect(offset).toBe(0);
  });

  test('returns span anchor for an empty pre-tokenized line placeholder', () => {
    const placeholder = span('', 0);
    const line = pre(5, [placeholder]);
    const [node, offset] = getSelectionAnchor(
      line as unknown as HTMLElement,
      0
    );
    expect(node).toBe(placeholder.childNodes[0] as unknown as Node);
    expect(offset).toBe(0);
  });

  test('returns token span when it has no text nodes', () => {
    const placeholder: MockElement = {
      nodeType: 1,
      tagName: 'SPAN',
      parentElement: null,
      children: [],
      childNodes: [],
      textContent: '',
      dataset: { char: '0' },
    };
    const line = pre(8, [placeholder]);
    const [node, offset] = getSelectionAnchor(
      line as unknown as HTMLElement,
      0
    );
    expect(node).toBe(placeholder as unknown as Node);
    expect(offset).toBe(0);
  });

  test('maps direct line text nodes used for whitespace-only lines', () => {
    const textNode = text('   ');
    const lineEl = line(6, [textNode]);
    const [node, offset] = getSelectionAnchor(
      lineEl as unknown as HTMLElement,
      2
    );
    expect(node).toBe(textNode as unknown as Node);
    expect(offset).toBe(2);
  });

  test('falls back to the line element when it has no anchorable children', () => {
    const line = pre(7, []);
    const [node, offset] = getSelectionAnchor(
      line as unknown as HTMLElement,
      0
    );
    expect(node).toBe(line as unknown as Node);
    expect(offset).toBe(0);
  });
});

describe('getCaretPosition', () => {
  test('returns end for forward selections', () => {
    expect(
      getCaretPosition(createSelection(1, 2, 3, 4, DirectionForward))
    ).toEqual({ line: 3, character: 4 });
  });

  test('returns start for backward selections', () => {
    expect(
      getCaretPosition(createSelection(1, 2, 3, 4, DirectionBackward))
    ).toEqual({ line: 1, character: 2 });
  });

  test('returns end for direction-none selections', () => {
    expect(
      getCaretPosition(createSelection(1, 2, 3, 4, DirectionNone))
    ).toEqual({
      line: 3,
      character: 4,
    });
  });

  test('returns start or end for collapsed carets based on direction', () => {
    const pos = { line: 2, character: 5 };
    expect(
      getCaretPosition(createSelection(2, 5, 2, 5, DirectionForward))
    ).toEqual(pos);
    expect(
      getCaretPosition(createSelection(2, 5, 2, 5, DirectionBackward))
    ).toEqual(pos);
    expect(
      getCaretPosition(createSelection(2, 5, 2, 5, DirectionNone))
    ).toEqual(pos);
  });
});

describe('selectionIntersects', () => {
  test('detects overlapping ranges on the same line', () => {
    expect(
      selectionIntersects(
        editorSelection(0, 2, 0, 6),
        editorSelection(0, 4, 0, 8)
      )
    ).toBe(true);
  });

  test('detects overlapping ranges across lines', () => {
    expect(
      selectionIntersects(
        editorSelection(0, 2, 2, 3),
        editorSelection(1, 0, 3, 1)
      )
    ).toBe(true);
  });

  test('does not treat adjacent range boundaries as intersections', () => {
    expect(
      selectionIntersects(
        editorSelection(0, 2, 0, 6),
        editorSelection(0, 6, 0, 8)
      )
    ).toBe(false);
  });

  test('does not intersect separated ranges', () => {
    expect(
      selectionIntersects(
        editorSelection(0, 2, 0, 4),
        editorSelection(1, 0, 1, 2)
      )
    ).toBe(false);
  });

  test('treats a caret inside a range as an intersection', () => {
    expect(
      selectionIntersects(
        editorSelection(0, 2, 0, 6),
        editorSelection(0, 4, 0, 4)
      )
    ).toBe(true);
  });

  test('treats a caret on a range boundary as an intersection', () => {
    expect(
      selectionIntersects(
        editorSelection(0, 2, 0, 6),
        editorSelection(0, 6, 0, 6)
      )
    ).toBe(true);
  });

  test('matches collapsed selections only at the same position', () => {
    expect(
      selectionIntersects(
        editorSelection(0, 2, 0, 2),
        editorSelection(0, 2, 0, 2)
      )
    ).toBe(true);
    expect(
      selectionIntersects(
        editorSelection(0, 2, 0, 2),
        editorSelection(0, 3, 0, 3)
      )
    ).toBe(false);
  });
});

describe('mergeOverlappingSelections', () => {
  test('merges overlapping ranges and keeps disjoint selections', () => {
    expect(
      mergeOverlappingSelections([
        createSelection(2, 0, 2, 4, DirectionForward),
        createSelection(0, 6, 0, 8, DirectionForward),
        createSelection(0, 2, 0, 7, DirectionForward),
      ])
    ).toEqual([
      createSelection(2, 0, 2, 4, DirectionForward),
      createSelection(0, 2, 0, 8, DirectionForward),
    ]);
  });

  test('keeps adjacent non-empty ranges separate', () => {
    expect(
      mergeOverlappingSelections([
        createSelection(0, 2, 0, 6, DirectionForward),
        createSelection(0, 6, 0, 8, DirectionForward),
      ])
    ).toEqual([
      createSelection(0, 2, 0, 6, DirectionForward),
      createSelection(0, 6, 0, 8, DirectionForward),
    ]);
  });

  test('merges a range when a later caret overlaps its boundary', () => {
    expect(
      mergeOverlappingSelections([
        createSelection(0, 2, 0, 6, DirectionForward),
        createSelection(0, 6, 0, 6, DirectionNone),
      ])
    ).toEqual([createSelection(0, 2, 0, 6, DirectionForward)]);
  });

  test('merges an earlier range when a later overlapping range extends it', () => {
    expect(
      mergeOverlappingSelections([
        createSelection(1, 2, 3, 0, DirectionForward),
        createSelection(2, 0, 3, 0, DirectionForward),
      ])
    ).toEqual([createSelection(1, 2, 3, 0, DirectionForward)]);
  });

  test('keeps disjoint selections in their original order', () => {
    expect(
      mergeOverlappingSelections([
        createSelection(3, 0, 3, 1, DirectionForward),
        createSelection(1, 0, 1, 1, DirectionForward),
        createSelection(2, 0, 2, 1, DirectionForward),
      ])
    ).toEqual([
      createSelection(3, 0, 3, 1, DirectionForward),
      createSelection(1, 0, 1, 1, DirectionForward),
      createSelection(2, 0, 2, 1, DirectionForward),
    ]);
  });

  test('merges transitive overlaps into one range', () => {
    expect(
      mergeOverlappingSelections([
        createSelection(0, 0, 0, 3, DirectionForward),
        createSelection(0, 5, 0, 8, DirectionForward),
        createSelection(0, 2, 0, 6, DirectionForward),
      ])
    ).toEqual([createSelection(0, 0, 0, 8, DirectionForward)]);
  });

  test('keeps the latest backward direction when merging overlapping ranges', () => {
    // The later selection is backward and is the most recent, so the merged
    // range stays backward: the caret keeps to the union start and the anchor
    // moves to the union end.
    expect(
      mergeOverlappingSelections([
        createSelection(0, 0, 0, 5, DirectionForward),
        createSelection(0, 3, 0, 8, DirectionBackward),
      ])
    ).toEqual([createSelection(0, 0, 0, 8, DirectionBackward)]);
  });

  test('derives backward direction when a later caret sits at the merged start', () => {
    // The bare caret is the most recent selection and lands on the union
    // start, so the merged range becomes backward to leave the caret in place.
    expect(
      mergeOverlappingSelections([
        createSelection(0, 3, 0, 8, DirectionForward),
        createSelection(0, 3, 0, 3, DirectionNone),
      ])
    ).toEqual([createSelection(0, 3, 0, 8, DirectionBackward)]);
  });
});

describe('extendSelection', () => {
  test('extends a collapsed selection forward', () => {
    expect(
      extendSelection(
        createSelection(2, 3, 2, 3, DirectionNone),
        createSelection(2, 10, 2, 10, DirectionNone)
      )
    ).toEqual(createSelection(2, 3, 2, 10, DirectionForward));
  });

  test('extends a collapsed selection backward', () => {
    expect(
      extendSelection(
        createSelection(2, 3, 2, 3, DirectionNone),
        createSelection(2, 1, 2, 1, DirectionNone)
      )
    ).toEqual(createSelection(2, 1, 2, 3, DirectionBackward));
  });

  test('extends forward when shift-click lands after the original anchor', () => {
    expect(
      extendSelection(
        createSelection(2, 3, 2, 8, DirectionForward),
        createSelection(2, 10, 2, 10, DirectionNone)
      )
    ).toEqual(createSelection(2, 3, 2, 10, DirectionForward));
  });

  test('left extend spans from target through original end (forward original)', () => {
    expect(
      extendSelection(
        createSelection(2, 3, 2, 8, DirectionForward),
        createSelection(2, 1, 2, 1, DirectionNone)
      )
    ).toEqual(createSelection(2, 1, 2, 8, DirectionBackward));
  });

  test('right extend spans from original start through target (backward original)', () => {
    expect(
      extendSelection(
        createSelection(2, 3, 2, 8, DirectionBackward),
        createSelection(2, 10, 2, 10, DirectionNone)
      )
    ).toEqual(createSelection(2, 3, 2, 10, DirectionForward));
  });

  test('keeps the original anchored edge when shift-click lands inside the range', () => {
    expect(
      extendSelection(
        createSelection(2, 3, 2, 8, DirectionForward),
        createSelection(2, 5, 2, 5, DirectionNone)
      )
    ).toEqual(createSelection(2, 3, 2, 5, DirectionForward));
  });

  test('keeps the backward anchor stable when shift-click lands inside the range', () => {
    expect(
      extendSelection(
        createSelection(2, 3, 2, 8, DirectionBackward),
        createSelection(2, 5, 2, 5, DirectionNone)
      )
    ).toEqual(createSelection(2, 5, 2, 8, DirectionBackward));
  });

  test('collapses a forward selection when shift-click lands on its anchor', () => {
    expect(
      extendSelection(
        createSelection(2, 3, 2, 8, DirectionForward),
        createSelection(2, 3, 2, 3, DirectionNone)
      )
    ).toEqual(createSelection(2, 3, 2, 3, DirectionNone));
  });

  test('collapses a backward selection when shift-click lands on its anchor', () => {
    expect(
      extendSelection(
        createSelection(2, 3, 2, 8, DirectionBackward),
        createSelection(2, 8, 2, 8, DirectionNone)
      )
    ).toEqual(createSelection(2, 8, 2, 8, DirectionNone));
  });
});

describe('createSelectionFrom', () => {
  test('keeps forward direction when drag focus moves after anchor', () => {
    const start = createSelection(2, 3, 2, 3, DirectionNone);
    const current = createSelection(2, 3, 2, 8, DirectionNone);
    expect(createSelectionFrom(start, current)).toEqual(
      createSelection(2, 3, 2, 8, DirectionForward)
    );
  });

  test('produces backward direction when drag focus moves before anchor', () => {
    const start = createSelection(2, 8, 2, 8, DirectionNone);
    const current = createSelection(2, 3, 2, 8, DirectionNone);
    expect(createSelectionFrom(start, current)).toEqual(
      createSelection(2, 3, 2, 8, DirectionBackward)
    );
  });

  test('uses backward start anchor when selection already has direction', () => {
    const start = createSelection(1, 2, 1, 6, DirectionBackward);
    const current = createSelection(1, 0, 1, 6, DirectionNone);
    expect(createSelectionFrom(start, current)).toEqual(
      createSelection(1, 0, 1, 6, DirectionBackward)
    );
  });
});

describe('getAutoSurroundReplacementTexts', () => {
  test('wraps selected text with matching quote pairs', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello world');
    const selections = [createSelection(0, 0, 0, 5, DirectionForward)];
    expect(
      getAutoSurroundReplacementTexts(textDocument, selections, '"')
    ).toEqual(['"hello"']);
    expect(
      getAutoSurroundReplacementTexts(textDocument, selections, "'")
    ).toEqual(["'hello'"]);
    expect(
      getAutoSurroundReplacementTexts(textDocument, selections, '`')
    ).toEqual(['`hello`']);
  });

  test('wraps selected text with bracket pairs', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello world');
    const selections = [createSelection(0, 0, 0, 5, DirectionForward)];
    expect(
      getAutoSurroundReplacementTexts(textDocument, selections, '{')
    ).toEqual(['{hello}']);
    expect(
      getAutoSurroundReplacementTexts(textDocument, selections, '[')
    ).toEqual(['[hello]']);
    expect(
      getAutoSurroundReplacementTexts(textDocument, selections, '(')
    ).toEqual(['(hello)']);
    expect(
      getAutoSurroundReplacementTexts(textDocument, selections, '<')
    ).toEqual(['<hello>']);
  });

  test('returns undefined for collapsed selections', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello');
    const selections = [createSelection(0, 2, 0, 2)];
    expect(
      getAutoSurroundReplacementTexts(textDocument, selections, '"')
    ).toBeUndefined();
  });

  test('returns undefined for unsupported characters', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello');
    const selections = [createSelection(0, 0, 0, 5, DirectionForward)];
    expect(
      getAutoSurroundReplacementTexts(textDocument, selections, 'x')
    ).toBeUndefined();
  });

  test('applies auto-surround across multiple non-collapsed selections', () => {
    const textDocument = new TextDocument('inmemory://1', 'foo bar baz');
    const selections = [
      createSelection(0, 0, 0, 3, DirectionForward),
      createSelection(0, 4, 0, 7, DirectionForward),
    ];
    const texts = getAutoSurroundReplacementTexts(
      textDocument,
      selections,
      '"'
    );
    expect(texts).toEqual(['"foo"', '"bar"']);
    const { nextSelections } = applyTextReplaceToSelections(
      textDocument,
      selections,
      texts!
    );
    expect(textDocument.getText()).toBe('"foo" "bar" baz');
    expect(nextSelections).toEqual([
      createSelection(0, 1, 0, 4, DirectionForward),
      createSelection(0, 7, 0, 10, DirectionForward),
    ]);
  });

  test('keeps auto-surround paired with descending selections', () => {
    const textDocument = new TextDocument('inmemory://1', 'foo bar');
    const selections = [
      createSelection(0, 4, 0, 7, DirectionForward),
      createSelection(0, 0, 0, 3, DirectionForward),
    ];
    const texts = getAutoSurroundReplacementTexts(
      textDocument,
      selections,
      '"'
    );
    expect(texts).toEqual(['"bar"', '"foo"']);
    const { nextSelections } = applyTextReplaceToSelections(
      textDocument,
      selections,
      texts!
    );

    expect(textDocument.getText()).toBe('"foo" "bar"');
    expect(nextSelections).toEqual([
      createSelection(0, 7, 0, 10, DirectionForward),
      createSelection(0, 1, 0, 4, DirectionForward),
    ]);
  });

  test('reselects wrapped text after auto-surround', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello world');
    const selections = [createSelection(0, 0, 0, 11, DirectionForward)];
    const texts = getAutoSurroundReplacementTexts(
      textDocument,
      selections,
      '"'
    );
    const { nextSelections } = applyTextReplaceToSelections(
      textDocument,
      selections,
      texts!
    );
    expect(textDocument.getText()).toBe('"hello world"');
    expect(nextSelections).toEqual([
      createSelection(0, 1, 0, 12, DirectionForward),
    ]);
  });

  test('reselects the original quote when auto-surrounding a quote', () => {
    const textDocument = new TextDocument('inmemory://1', '"');
    const selections = [createSelection(0, 0, 0, 1, DirectionForward)];
    const texts = getAutoSurroundReplacementTexts(
      textDocument,
      selections,
      '"'
    );
    const { nextSelections } = applyTextReplaceToSelections(
      textDocument,
      selections,
      texts!
    );
    expect(textDocument.getText()).toBe('"""');
    expect(nextSelections).toEqual([
      createSelection(0, 1, 0, 2, DirectionForward),
    ]);
  });

  test('never disables auto-surround for quotes and brackets', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello');
    const selections = [createSelection(0, 0, 0, 5, DirectionForward)];
    expect(
      getAutoSurroundReplacementTexts(textDocument, selections, '"', 'never')
    ).toBeUndefined();
    expect(
      getAutoSurroundReplacementTexts(textDocument, selections, '{', 'never')
    ).toBeUndefined();
  });

  test('languageDefined behaves like default', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello');
    const selections = [createSelection(0, 0, 0, 5, DirectionForward)];
    expect(
      getAutoSurroundReplacementTexts(
        textDocument,
        selections,
        '"',
        'languageDefined'
      )
    ).toEqual(
      getAutoSurroundReplacementTexts(textDocument, selections, '"', 'default')
    );
    expect(
      getAutoSurroundReplacementTexts(
        textDocument,
        selections,
        '{',
        'languageDefined'
      )
    ).toEqual(
      getAutoSurroundReplacementTexts(textDocument, selections, '{', 'default')
    );
  });

  test('brackets mode only auto-surrounds bracket pairs', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello');
    const selections = [createSelection(0, 0, 0, 5, DirectionForward)];
    expect(
      getAutoSurroundReplacementTexts(textDocument, selections, '{', 'brackets')
    ).toEqual(['{hello}']);
    expect(
      getAutoSurroundReplacementTexts(textDocument, selections, '"', 'brackets')
    ).toBeUndefined();
  });

  test('quotes mode only auto-surrounds quote pairs', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello');
    const selections = [createSelection(0, 0, 0, 5, DirectionForward)];
    expect(
      getAutoSurroundReplacementTexts(textDocument, selections, '"', 'quotes')
    ).toEqual(['"hello"']);
    expect(
      getAutoSurroundReplacementTexts(textDocument, selections, '{', 'quotes')
    ).toBeUndefined();
  });
});

describe('applyTextChangeToSelections', () => {
  test('inserts the same text at multiple carets', () => {
    const textDocument = new TextDocument('inmemory://1', 'a\nb\nc');
    const selections = [
      createSelection(0, 1, 0, 1),
      createSelection(1, 1, 1, 1),
      createSelection(2, 1, 2, 1),
    ];
    const { nextSelections } = applyTextChangeToSelections(
      textDocument,
      selections,
      {
        start: 5,
        end: 5,
        text: '!',
      }
    );

    expect(textDocument.getText()).toBe('a!\nb!\nc!');
    expect(nextSelections).toEqual([
      createSelection(0, 2, 0, 2),
      createSelection(1, 2, 1, 2),
      createSelection(2, 2, 2, 2),
    ]);
  });

  test('replaces each selected range with the typed text', () => {
    const textDocument = new TextDocument('inmemory://1', 'foo bar baz');
    const selections = [
      createSelection(0, 0, 0, 3, DirectionForward),
      createSelection(0, 4, 0, 7, DirectionForward),
      createSelection(0, 8, 0, 11, DirectionForward),
    ];
    const { nextSelections } = applyTextChangeToSelections(
      textDocument,
      selections,
      {
        start: 8,
        end: 11,
        text: 'x',
      }
    );

    expect(textDocument.getText()).toBe('x x x');
    expect(nextSelections).toEqual([
      createSelection(0, 1, 0, 1),
      createSelection(0, 3, 0, 3),
      createSelection(0, 5, 0, 5),
    ]);
  });

  test('mirrors backspace for multiple carets', () => {
    const textDocument = new TextDocument('inmemory://1', 'ax\nbx\ncx');
    const selections = [
      createSelection(0, 1, 0, 1),
      createSelection(1, 1, 1, 1),
      createSelection(2, 1, 2, 1),
    ];
    const { nextSelections } = applyTextChangeToSelections(
      textDocument,
      selections,
      {
        start: 6,
        end: 7,
        text: '',
      }
    );

    expect(textDocument.getText()).toBe('x\nx\nx');
    expect(nextSelections).toEqual([
      createSelection(0, 0, 0, 0),
      createSelection(1, 0, 1, 0),
      createSelection(2, 0, 2, 0),
    ]);
  });

  test('mirrors delete for multiple carets', () => {
    const textDocument = new TextDocument('inmemory://1', 'xa\nxb\nxc');
    const selections = [
      createSelection(0, 1, 0, 1),
      createSelection(1, 1, 1, 1),
      createSelection(2, 1, 2, 1),
    ];
    const { nextSelections } = applyTextChangeToSelections(
      textDocument,
      selections,
      {
        start: 7,
        end: 8,
        text: '',
      }
    );

    expect(textDocument.getText()).toBe('x\nx\nx');
    expect(nextSelections).toEqual([
      createSelection(0, 1, 0, 1),
      createSelection(1, 1, 1, 1),
      createSelection(2, 1, 2, 1),
    ]);
  });

  test('deletes explicit ranges across multiple selections', () => {
    const textDocument = new TextDocument('inmemory://1', 'abc def ghi');
    const selections = [
      createSelection(0, 1, 0, 3),
      createSelection(0, 5, 0, 7),
      createSelection(0, 9, 0, 11),
    ];
    const { nextSelections } = applyTextChangeToSelections(
      textDocument,
      selections,
      {
        start: 9,
        end: 11,
        text: '',
      }
    );

    expect(textDocument.getText()).toBe('a d g');
    expect(nextSelections).toEqual([
      createSelection(0, 1, 0, 1),
      createSelection(0, 3, 0, 3),
      createSelection(0, 5, 0, 5),
    ]);
  });

  test('coalesces transformed edits that would overlap', () => {
    const textDocument = new TextDocument('inmemory://1', '    ');
    const selections = [
      createSelection(0, 1, 0, 1),
      createSelection(0, 2, 0, 2),
    ];
    const { nextSelections } = applyTextChangeToSelections(
      textDocument,
      selections,
      {
        start: 0,
        end: 2,
        text: '',
      }
    );

    expect(textDocument.getText()).toBe('  ');
    expect(nextSelections).toEqual([
      createSelection(0, 0, 0, 0),
      createSelection(0, 0, 0, 0),
    ]);
  });

  test('places the caret on the inserted blank line after Enter', () => {
    const textDocument = new TextDocument('inmemory://1', 'foo\nbar');
    const selections = [createSelection(0, 3, 0, 3)];
    const { nextSelections } = applyTextChangeToSelections(
      textDocument,
      selections,
      {
        start: 3,
        end: 3,
        text: '\n',
      }
    );

    expect(textDocument.getText()).toBe('foo\n\nbar');
    expect(nextSelections).toEqual([createSelection(1, 0, 1, 0)]);
  });

  test('copies leading indentation onto the new line after Enter', () => {
    const textDocument = new TextDocument('inmemory://1', '  foo\nbar');
    const selections = [createSelection(0, 5, 0, 5)];
    const { nextSelections } = applyTextChangeToSelections(
      textDocument,
      selections,
      {
        start: 5,
        end: 5,
        text: '\n',
      }
    );

    expect(textDocument.getText()).toBe('  foo\n  \nbar');
    expect(nextSelections).toEqual([createSelection(1, 2, 1, 2)]);
  });

  test("uses each line's indent when inserting a newline at multiple carets", () => {
    const textDocument = new TextDocument('inmemory://1', '  a\n\tb');
    const selections = [
      createSelection(0, 3, 0, 3),
      createSelection(1, 2, 1, 2),
    ];
    const { nextSelections } = applyTextChangeToSelections(
      textDocument,
      selections,
      {
        start: 6,
        end: 6,
        text: '\n',
      }
    );

    expect(textDocument.getText()).toBe('  a\n  \n\tb\n\t');
    expect(nextSelections).toEqual([
      createSelection(1, 2, 1, 2),
      createSelection(3, 1, 3, 1),
    ]);
  });

  test('preserves CRLF when copying indentation after Enter', () => {
    const textDocument = new TextDocument('inmemory://1', '  foo\r\nbar');
    const selections = [createSelection(0, 5, 0, 5)];
    const { nextSelections } = applyTextChangeToSelections(
      textDocument,
      selections,
      {
        start: 5,
        end: 5,
        text: '\r\n',
      }
    );

    expect(textDocument.getText()).toBe('  foo\r\n  \r\nbar');
    expect(nextSelections).toEqual([createSelection(1, 2, 1, 2)]);
  });

  test('moves the caret to the previous line end after deleting a line break', () => {
    const textDocument = new TextDocument('inmemory://1', 'foo\n\nbar');
    const selections = [createSelection(1, 0, 1, 0)];
    const { nextSelections } = applyTextChangeToSelections(
      textDocument,
      selections,
      {
        start: 3,
        end: 4,
        text: '',
      }
    );

    expect(textDocument.getText()).toBe('foo\nbar');
    expect(nextSelections).toEqual([createSelection(0, 3, 0, 3)]);
  });

  test('deletes one hard tab when backspacing in leading indentation', () => {
    const textDocument = new TextDocument('inmemory://1', '\tfoo');
    const selections = [createSelection(0, 1, 0, 1)];
    const { nextSelections } = applyTextChangeToSelections(
      textDocument,
      selections,
      {
        start: 0,
        end: 1,
        text: '',
      },
      undefined,
      2
    );

    expect(textDocument.getText()).toBe('foo');
    expect(nextSelections).toEqual([createSelection(0, 0, 0, 0)]);
  });

  test('deletes one soft tab when backspacing in leading indentation', () => {
    const textDocument = new TextDocument('inmemory://1', '    foo');
    const selections = [createSelection(0, 4, 0, 4)];
    const { nextSelections } = applyTextChangeToSelections(
      textDocument,
      selections,
      {
        start: 3,
        end: 4,
        text: '',
      },
      undefined,
      4
    );

    expect(textDocument.getText()).toBe('foo');
    expect(nextSelections).toEqual([createSelection(0, 0, 0, 0)]);
  });

  test('normalizes backspace indentation per caret context', () => {
    const textDocument = new TextDocument('inmemory://1', '\tfoo\n    bar');
    const selections = [
      createSelection(0, 1, 0, 1),
      createSelection(1, 4, 1, 4),
    ];
    const { nextSelections } = applyTextChangeToSelections(
      textDocument,
      selections,
      {
        start: 8,
        end: 9,
        text: '',
      },
      undefined,
      4
    );

    expect(textDocument.getText()).toBe('foo\nbar');
    expect(nextSelections).toEqual([
      createSelection(0, 0, 0, 0),
      createSelection(1, 0, 1, 0),
    ]);
  });

  test('does not expand deletion outside leading indentation', () => {
    const textDocument = new TextDocument('inmemory://1', '  foo');
    const selections = [createSelection(0, 3, 0, 3)];
    const { nextSelections } = applyTextChangeToSelections(
      textDocument,
      selections,
      {
        start: 2,
        end: 3,
        text: '',
      },
      undefined,
      2
    );

    expect(textDocument.getText()).toBe('  oo');
    expect(nextSelections).toEqual([createSelection(0, 2, 0, 2)]);
  });
});

describe('mapSelectionMove', () => {
  test('moves all carets left when pressing left arrow', () => {
    const textDocument = new TextDocument('inmemory://1', 'ab\ncd\nef');
    const selections = [
      createSelection(0, 1, 0, 1),
      createSelection(1, 1, 1, 1),
      createSelection(2, 1, 2, 1),
    ];

    expect(mapCursorMove(textDocument, selections, 'left')).toEqual([
      createSelection(0, 0, 0, 0),
      createSelection(1, 0, 1, 0),
      createSelection(2, 0, 2, 0),
    ]);
  });

  test('collapses all forward selections to their start on left arrow', () => {
    const textDocument = new TextDocument('inmemory://1', 'abcd\nefgh');
    const selections = [
      createSelection(0, 1, 0, 2, DirectionForward),
      createSelection(1, 1, 1, 2, DirectionForward),
    ];

    expect(mapCursorMove(textDocument, selections, 'left')).toEqual([
      createSelection(0, 1, 0, 1, DirectionNone),
      createSelection(1, 1, 1, 1, DirectionNone),
    ]);
  });

  test('moves carets right across line boundaries', () => {
    const textDocument = new TextDocument('inmemory://1', 'ab\ncd');
    const selections = [
      createSelection(0, 2, 0, 2),
      createSelection(1, 2, 1, 2),
    ];

    expect(mapCursorMove(textDocument, selections, 'right')).toEqual([
      createSelection(1, 0, 1, 0),
      createSelection(1, 2, 1, 2),
    ]);
  });

  test('moves to text start and toggles to column zero', () => {
    const textDocument = new TextDocument('inmemory://1', '  foo');
    const firstMove = mapCursorMove(
      textDocument,
      [createSelection(0, 4, 0, 4)],
      'textStart'
    );
    const secondMove = mapCursorMove(textDocument, firstMove, 'textStart');

    expect(firstMove).toEqual([createSelection(0, 2, 0, 2)]);
    expect(secondMove).toEqual([createSelection(0, 0, 0, 0)]);
  });

  test('moves to line start and end', () => {
    const textDocument = new TextDocument('inmemory://1', 'abcd');
    const selections = [createSelection(0, 2, 0, 2)];

    expect(mapCursorMove(textDocument, selections, 'start')).toEqual([
      createSelection(0, 0, 0, 0),
    ]);
    expect(mapCursorMove(textDocument, selections, 'end')).toEqual([
      createSelection(0, 4, 0, 4),
    ]);
  });

  test('collapses backward multi-line selections on the focus line for line moves', () => {
    const textDocument = new TextDocument(
      'inmemory://1',
      '    first\nsecond line\n  third'
    );
    const selections = [createSelection(0, 6, 1, 3, DirectionBackward)];

    expect(mapCursorMove(textDocument, selections, 'start')).toEqual([
      createSelection(0, 0, 0, 0),
    ]);
    expect(mapCursorMove(textDocument, selections, 'end')).toEqual([
      createSelection(0, 9, 0, 9),
    ]);
    expect(mapCursorMove(textDocument, selections, 'textStart')).toEqual([
      createSelection(0, 4, 0, 4),
    ]);
  });

  test('moves left from a goal column past a shorter line end', () => {
    const textDocument = new TextDocument(
      'inmemory://1',
      'this is a much longer line\nshort\n'
    );
    const onShortLine = mapCursorMove(
      textDocument,
      [createSelection(0, 20, 0, 20)],
      'down'
    );

    expect(onShortLine).toEqual([createSelection(1, 20, 1, 20)]);

    expect(mapCursorMove(textDocument, onShortLine, 'left')).toEqual([
      createSelection(1, 4, 1, 4),
    ]);
  });

  test('preserves goal column across short and empty lines', () => {
    const textDocument = new TextDocument(
      'inmemory://1',
      'this is a much longer line here\nshort\n\nanother much longer line here\n'
    );
    const onShortLine = mapCursorMove(
      textDocument,
      [createSelection(0, 20, 0, 20)],
      'down'
    );
    const onEmptyLine = mapCursorMove(textDocument, onShortLine, 'down');
    const onLongLine = mapCursorMove(textDocument, onEmptyLine, 'down');

    expect(onShortLine).toEqual([createSelection(1, 20, 1, 20)]);
    expect(onEmptyLine).toEqual([createSelection(2, 20, 2, 20)]);
    expect(onLongLine).toEqual([createSelection(3, 20, 3, 20)]);
  });

  test('inserts at the clamped caret after moving onto a shorter line', () => {
    const textDocument = new TextDocument(
      'inmemory://1',
      'this is a much longer line\nshort\nnext\n'
    );
    const onShortLine = mapCursorMove(
      textDocument,
      [createSelection(0, 20, 0, 20)],
      'down'
    );
    const { nextSelections, change } = applyTextChangeToSelections(
      textDocument,
      onShortLine,
      {
        start: textDocument.offsetAt(onShortLine[0].start),
        end: textDocument.offsetAt(onShortLine[0].end),
        text: 'X',
      }
    );

    expect(textDocument.getText()).toBe(
      'this is a much longer line\nshortX\nnext\n'
    );
    expect(nextSelections).toEqual([createSelection(1, 6, 1, 6)]);
    expect(change).toBeDefined();
  });

  test('moves right past a whole emoji instead of into the surrogate pair', () => {
    const textDocument = new TextDocument('inmemory://1', 'a😀');
    const afterLetter = [createSelection(0, 1, 0, 1)];

    expect(mapCursorMove(textDocument, afterLetter, 'right')).toEqual([
      createSelection(0, 3, 0, 3),
    ]);
  });

  test('moves left over a whole emoji instead of into the surrogate pair', () => {
    const textDocument = new TextDocument('inmemory://1', 'a😀');
    const lineEnd = [createSelection(0, 3, 0, 3)];

    expect(mapCursorMove(textDocument, lineEnd, 'left')).toEqual([
      createSelection(0, 1, 0, 1),
    ]);
  });

  test('moves vertically by wrapped visual rows', () => {
    const textDocument = new TextDocument(
      'inmemory://1',
      '012345678901234567890123456789\nshort'
    );
    const wrapOptions: CursorMoveOptions = {
      getSoftLineOffsets: (line) =>
        line === 0 ? new Uint32Array([0, 10, 20, 30]) : undefined,
    };
    const middleVisualRow = [createSelection(0, 15, 0, 15)];

    expect(
      mapCursorMove(textDocument, middleVisualRow, 'down', wrapOptions)
    ).toEqual([createSelection(0, 25, 0, 25)]);
    expect(
      mapCursorMove(textDocument, middleVisualRow, 'up', wrapOptions)
    ).toEqual([createSelection(0, 5, 0, 5)]);
    expect(
      mapCursorMove(
        textDocument,
        [createSelection(0, 25, 0, 25)],
        'down',
        wrapOptions
      )
    ).toEqual([createSelection(1, 5, 1, 5)]);
  });

  test('moves to wrapped visual row boundaries', () => {
    const textDocument = new TextDocument(
      'inmemory://1',
      '  abcdefghij  klmnop'
    );
    const wrapOptions: CursorMoveOptions = {
      getSoftLineOffsets: () => new Uint32Array([0, 12, 20]),
    };
    const continuationRow = [createSelection(0, 16, 0, 16)];
    const textStart = mapCursorMove(
      textDocument,
      continuationRow,
      'textStart',
      wrapOptions
    );

    expect(
      mapCursorMove(textDocument, continuationRow, 'start', wrapOptions)
    ).toEqual([createSelection(0, 12, 0, 12)]);
    expect(
      mapCursorMove(textDocument, continuationRow, 'end', wrapOptions)
    ).toEqual([createSelection(0, 20, 0, 20)]);
    expect(textStart).toEqual([createSelection(0, 14, 0, 14)]);
    expect(
      mapCursorMove(textDocument, textStart, 'textStart', wrapOptions)
    ).toEqual([createSelection(0, 12, 0, 12)]);
  });

  test('extends selections by wrapped visual rows', () => {
    const textDocument = new TextDocument(
      'inmemory://1',
      '012345678901234567890123456789'
    );
    const wrapOptions: CursorMoveOptions = {
      getSoftLineOffsets: () => new Uint32Array([0, 10, 20, 30]),
    };

    expect(
      mapSelectionShift(
        textDocument,
        [createSelection(0, 15, 0, 15)],
        'down',
        wrapOptions
      )
    ).toEqual([createSelection(0, 15, 0, 25, DirectionForward)]);
  });
});

describe('getDocumentBoundarySelection', () => {
  test('moves to the end of a one-line document when diff trimming is enabled', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello');

    expect(getDocumentBoundarySelection(textDocument, true, true)).toEqual(
      createSelection(0, 5, 0, 5, DirectionForward)
    );
  });

  test('moves to the end of the last line without a final newline', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello\nworld');

    expect(getDocumentBoundarySelection(textDocument, true, true)).toEqual(
      createSelection(1, 5, 1, 5, DirectionForward)
    );
  });

  test('skips only the extra trailing blank line when trimming diff endings', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello\nworld\n');

    expect(getDocumentBoundarySelection(textDocument, true, true)).toEqual(
      createSelection(1, 5, 1, 5, DirectionForward)
    );
  });
});

describe('mapSelectionRangeMove', () => {
  test('extends all carets one character on shift + right', () => {
    const textDocument = new TextDocument('inmemory://1', 'abcd\nefgh');
    const selections = [
      createSelection(0, 1, 0, 1),
      createSelection(1, 1, 1, 1),
    ];

    expect(mapSelectionShift(textDocument, selections, 'right')).toEqual([
      createSelection(0, 1, 0, 2, DirectionForward),
      createSelection(1, 1, 1, 2, DirectionForward),
    ]);
  });

  test('preserves backward selection direction on shift + left', () => {
    const textDocument = new TextDocument('inmemory://1', 'abcd\nefgh');
    const selections = [
      createSelection(0, 2, 0, 2),
      createSelection(1, 2, 1, 2),
    ];

    expect(mapSelectionShift(textDocument, selections, 'left')).toEqual([
      createSelection(0, 1, 0, 2, DirectionBackward),
      createSelection(1, 1, 1, 2, DirectionBackward),
    ]);
  });

  test('uses existing backward anchor and shrinks with shift + right', () => {
    const textDocument = new TextDocument('inmemory://1', 'abcd\nefgh');
    const selections = [
      createSelection(0, 0, 0, 2, DirectionBackward),
      createSelection(1, 0, 1, 2, DirectionBackward),
    ];
    expect(mapSelectionShift(textDocument, selections, 'right')).toEqual([
      createSelection(0, 1, 0, 2, DirectionBackward),
      createSelection(1, 1, 1, 2, DirectionBackward),
    ]);
  });

  test('extends selection up and down while preserving anchor', () => {
    const textDocument = new TextDocument('inmemory://1', 'abcd\nefgh\nijkl');
    const upSelections = [createSelection(1, 1, 1, 3, DirectionForward)];
    const downSelections = [createSelection(1, 1, 1, 3, DirectionBackward)];

    expect(mapSelectionShift(textDocument, upSelections, 'up')).toEqual([
      createSelection(0, 3, 1, 1, DirectionBackward),
    ]);
    expect(mapSelectionShift(textDocument, downSelections, 'down')).toEqual([
      createSelection(1, 3, 2, 1, DirectionForward),
    ]);
  });

  test('preserves goal column while extending down across a short line', () => {
    const textDocument = new TextDocument(
      'inmemory://1',
      'this is a much longer line here\nshort\nanother much longer line here\n'
    );
    const onShortLine = mapSelectionShift(
      textDocument,
      [createSelection(0, 20, 0, 20)],
      'down'
    );
    const onLongLine = mapSelectionShift(textDocument, onShortLine, 'down');

    expect(onShortLine).toEqual([
      createSelection(0, 20, 1, 20, DirectionForward),
    ]);
    expect(onLongLine).toEqual([
      createSelection(0, 20, 2, 20, DirectionForward),
    ]);
  });

  test('does not copy the trailing newline when the goal column overshoots', () => {
    const textDocument = new TextDocument(
      'inmemory://1',
      'this is a much longer line here\nshort\nanother much longer line here\n'
    );
    const onShortLine = mapSelectionShift(
      textDocument,
      [createSelection(0, 20, 0, 20)],
      'down'
    );

    expect(getSelectionText(textDocument, onShortLine)).toBe(
      'r line here\nshort'
    );
  });

  test('extends the selection across a whole emoji on shift + right', () => {
    const textDocument = new TextDocument('inmemory://1', 'a😀');
    const afterLetter = [createSelection(0, 1, 0, 1)];

    expect(mapSelectionShift(textDocument, afterLetter, 'right')).toEqual([
      createSelection(0, 1, 0, 3, DirectionForward),
    ]);
  });

  test('merges selections after shift movement creates overlap', () => {
    const textDocument = new TextDocument('inmemory://1', 'abcdef');
    const selections = [
      createSelection(0, 1, 0, 3, DirectionForward),
      createSelection(0, 3, 0, 5, DirectionForward),
    ];

    expect(
      mergeOverlappingSelections(
        mapSelectionShift(textDocument, selections, 'right')
      )
    ).toEqual([createSelection(0, 1, 0, 6, DirectionForward)]);
  });
});

describe('applyDeleteCharacterToSelections', () => {
  test('resolves backward delete ranges per selection for multi-cursor edits', () => {
    const textDocument = new TextDocument('inmemory://1', 'ab😀');
    const selections = [
      createSelection(0, 2, 0, 2),
      createSelection(0, 4, 0, 4),
    ];
    const { nextSelections, change } = applyDeleteCharacterToSelections(
      textDocument,
      selections,
      false
    );

    expect(change).toBeDefined();
    expect(textDocument.getText()).toBe('a');
    expect(nextSelections).toEqual([
      createSelection(0, 1, 0, 1),
      createSelection(0, 1, 0, 1),
    ]);
  });

  test('resolves forward delete ranges per selection for multi-cursor edits', () => {
    const textDocument = new TextDocument('inmemory://1', 'a😀b');
    const selections = [
      createSelection(0, 1, 0, 1),
      createSelection(0, 3, 0, 3),
    ];
    const { nextSelections, change } = applyDeleteCharacterToSelections(
      textDocument,
      selections,
      true
    );

    expect(change).toBeDefined();
    expect(textDocument.getText()).toBe('a');
    expect(nextSelections).toEqual([
      createSelection(0, 1, 0, 1),
      createSelection(0, 1, 0, 1),
    ]);
  });

  test('deletes a hard-tab indent on Backspace at a caret', () => {
    const textDocument = new TextDocument('inmemory://1', '\tfoo');
    const selections = [createSelection(0, 1, 0, 1)];
    const { nextSelections } = applyDeleteCharacterToSelections(
      textDocument,
      selections,
      false,
      undefined,
      2
    );

    expect(textDocument.getText()).toBe('foo');
    expect(nextSelections).toEqual([createSelection(0, 0, 0, 0)]);
  });

  test('deletes a soft-tab indent on Backspace at a caret', () => {
    const textDocument = new TextDocument('inmemory://1', '    foo');
    const selections = [createSelection(0, 4, 0, 4)];
    const { nextSelections } = applyDeleteCharacterToSelections(
      textDocument,
      selections,
      false,
      undefined,
      4
    );

    expect(textDocument.getText()).toBe('foo');
    expect(nextSelections).toEqual([createSelection(0, 0, 0, 0)]);
  });

  test('normalizes indent on Backspace for each caret', () => {
    const textDocument = new TextDocument('inmemory://1', '\tfoo\n    bar');
    const selections = [
      createSelection(0, 1, 0, 1),
      createSelection(1, 4, 1, 4),
    ];
    const { nextSelections } = applyDeleteCharacterToSelections(
      textDocument,
      selections,
      false,
      undefined,
      4
    );

    expect(textDocument.getText()).toBe('foo\nbar');
    expect(nextSelections).toEqual([
      createSelection(0, 0, 0, 0),
      createSelection(1, 0, 1, 0),
    ]);
  });

  test('does not expand a Backspace outside leading indentation', () => {
    const textDocument = new TextDocument('inmemory://1', '  foo');
    const selections = [createSelection(0, 3, 0, 3)];
    const { nextSelections } = applyDeleteCharacterToSelections(
      textDocument,
      selections,
      false,
      undefined,
      2
    );

    expect(textDocument.getText()).toBe('  oo');
    expect(nextSelections).toEqual([createSelection(0, 2, 0, 2)]);
  });

  test('does not expand an explicit selection in leading indentation', () => {
    const textDocument = new TextDocument('inmemory://1', '    foo');
    // The caret is not collapsed: only the last indent space is selected.
    const selections = [createSelection(0, 3, 0, 4)];
    const { nextSelections } = applyDeleteCharacterToSelections(
      textDocument,
      selections,
      false,
      undefined,
      4
    );

    expect(textDocument.getText()).toBe('   foo');
    expect(nextSelections).toEqual([createSelection(0, 3, 0, 3)]);
  });
});

describe('resolveDeleteCharacterRange', () => {
  test('backward delete removes a whole emoji', () => {
    const textDocument = new TextDocument('inmemory://1', 'a😀');
    const caret = createSelection(0, 3, 0, 3);

    expect(resolveDeleteCharacterRange(textDocument, caret, false)).toEqual([
      { line: 0, character: 1 },
      { line: 0, character: 3 },
    ]);
  });

  test('forward delete removes a whole emoji', () => {
    const textDocument = new TextDocument('inmemory://1', 'a😀');
    const caret = createSelection(0, 1, 0, 1);

    expect(resolveDeleteCharacterRange(textDocument, caret, true)).toEqual([
      { line: 0, character: 1 },
      { line: 0, character: 3 },
    ]);
  });

  test('returns the selected range for non-collapsed selections', () => {
    const textDocument = new TextDocument('inmemory://1', 'a😀b');
    const selection = createSelection(0, 1, 0, 3, DirectionForward);

    expect(resolveDeleteCharacterRange(textDocument, selection, false)).toEqual(
      [
        { line: 0, character: 1 },
        { line: 0, character: 3 },
      ]
    );
  });

  test('backward delete clamps a goal column past a shorter line end', () => {
    const textDocument = new TextDocument(
      'inmemory://1',
      'this is a much longer line\nshort\n'
    );
    const caret = createSelection(1, 20, 1, 20);

    expect(resolveDeleteCharacterRange(textDocument, caret, false)).toEqual([
      { line: 1, character: 4 },
      { line: 1, character: 5 },
    ]);

    const { nextSelections, change } = applyDeleteCharacterToSelections(
      textDocument,
      [caret],
      false
    );

    expect(change).toBeDefined();
    expect(textDocument.getText()).toBe('this is a much longer line\nshor\n');
    expect(nextSelections).toEqual([createSelection(1, 4, 1, 4)]);
  });
});

describe('applyDeleteHardLineForwardToSelections', () => {
  test('deletes from the caret to the end of the line', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello world');
    const selections = [createSelection(0, 5, 0, 5)];
    const { nextSelections, change } = applyDeleteHardLineForwardToSelections(
      textDocument,
      selections
    );

    expect(change).toBeDefined();
    expect(textDocument.getText()).toBe('hello');
    expect(nextSelections).toEqual([createSelection(0, 5, 0, 5)]);
  });

  test('deletes the newline when the caret is at the end of a line', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello\nworld');
    const selections = [createSelection(0, 5, 0, 5)];
    const { nextSelections } = applyDeleteHardLineForwardToSelections(
      textDocument,
      selections
    );

    expect(textDocument.getText()).toBe('helloworld');
    expect(nextSelections).toEqual([createSelection(0, 5, 0, 5)]);
  });

  test('is a no-op at the end of the final line', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello');
    const selections = [createSelection(0, 5, 0, 5)];
    const { nextSelections, change } = applyDeleteHardLineForwardToSelections(
      textDocument,
      selections
    );

    expect(change).toBeUndefined();
    expect(textDocument.getText()).toBe('hello');
    expect(nextSelections).toEqual([createSelection(0, 5, 0, 5)]);
  });

  test('deletes an explicit selection instead of the rest of the line', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello world');
    const selections = [createSelection(0, 0, 0, 5, DirectionForward)];
    const { nextSelections } = applyDeleteHardLineForwardToSelections(
      textDocument,
      selections
    );

    expect(textDocument.getText()).toBe(' world');
    expect(nextSelections).toEqual([createSelection(0, 0, 0, 0)]);
  });

  test('applies independently across multiple carets', () => {
    const textDocument = new TextDocument('inmemory://1', 'ax\nby\ncz');
    const selections = [
      createSelection(0, 1, 0, 1),
      createSelection(1, 1, 1, 1),
      createSelection(2, 1, 2, 1),
    ];
    const { nextSelections } = applyDeleteHardLineForwardToSelections(
      textDocument,
      selections
    );

    expect(textDocument.getText()).toBe('a\nb\nc');
    expect(nextSelections).toEqual([
      createSelection(0, 1, 0, 1),
      createSelection(1, 1, 1, 1),
      createSelection(2, 1, 2, 1),
    ]);
  });

  test('merges overlapping delete ranges from multiple carets on the same line', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello world');
    const selections = [
      createSelection(0, 5, 0, 5),
      createSelection(0, 8, 0, 8),
    ];
    const { nextSelections, change } = applyDeleteHardLineForwardToSelections(
      textDocument,
      selections
    );

    expect(change).toBeDefined();
    expect(textDocument.getText()).toBe('hello');
    expect(nextSelections).toEqual([
      createSelection(0, 5, 0, 5),
      createSelection(0, 5, 0, 5),
    ]);
  });
});

describe('applyDeleteSoftLineBackwardToSelections', () => {
  test('deletes from the caret to the start of the line', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello world');
    const selections = [createSelection(0, 5, 0, 5)];
    const { nextSelections, change } = applyDeleteSoftLineBackwardToSelections(
      textDocument,
      selections
    );

    expect(change).toBeDefined();
    expect(textDocument.getText()).toBe(' world');
    expect(nextSelections).toEqual([createSelection(0, 0, 0, 0)]);
  });

  test('deletes the newline when the caret is at the start of a line', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello\nworld');
    const selections = [createSelection(1, 0, 1, 0)];
    const { nextSelections } = applyDeleteSoftLineBackwardToSelections(
      textDocument,
      selections
    );

    expect(textDocument.getText()).toBe('helloworld');
    expect(nextSelections).toEqual([createSelection(0, 5, 0, 5)]);
  });

  test('is a no-op at the start of the first line', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello');
    const selections = [createSelection(0, 0, 0, 0)];
    const { nextSelections, change } = applyDeleteSoftLineBackwardToSelections(
      textDocument,
      selections
    );

    expect(change).toBeUndefined();
    expect(textDocument.getText()).toBe('hello');
    expect(nextSelections).toEqual([createSelection(0, 0, 0, 0)]);
  });

  test('deletes an explicit selection instead of the rest of the line', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello world');
    const selections = [createSelection(0, 0, 0, 5, DirectionForward)];
    const { nextSelections } = applyDeleteSoftLineBackwardToSelections(
      textDocument,
      selections
    );

    expect(textDocument.getText()).toBe(' world');
    expect(nextSelections).toEqual([createSelection(0, 0, 0, 0)]);
  });

  test('uses a soft-line start callback for wrapped visual lines', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello world');
    const selections = [createSelection(0, 11, 0, 11)];
    const getSoftLineStart = (line: number, character: number) =>
      line === 0 && character > 6 ? 6 : 0;
    const { nextSelections } = applyDeleteSoftLineBackwardToSelections(
      textDocument,
      selections,
      getSoftLineStart
    );

    expect(textDocument.getText()).toBe('hello ');
    expect(nextSelections).toEqual([createSelection(0, 6, 0, 6)]);
  });

  test('merges overlapping delete ranges from multiple carets on the same line', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello world');
    const selections = [
      createSelection(0, 8, 0, 8),
      createSelection(0, 11, 0, 11),
    ];
    const { nextSelections, change } = applyDeleteSoftLineBackwardToSelections(
      textDocument,
      selections
    );

    expect(change).toBeDefined();
    expect(textDocument.getText()).toBe('');
    expect(nextSelections).toEqual([
      createSelection(0, 0, 0, 0),
      createSelection(0, 0, 0, 0),
    ]);
  });
});

describe('applyDeleteWordBackwardToSelections', () => {
  test('deletes the word before the caret', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello world');
    const selections = [createSelection(0, 11, 0, 11)];
    const { nextSelections, change } = applyDeleteWordBackwardToSelections(
      textDocument,
      selections
    );

    expect(change).toBeDefined();
    expect(textDocument.getText()).toBe('hello ');
    expect(nextSelections).toEqual([createSelection(0, 6, 0, 6)]);
  });

  test('deletes from the start of the current word when the caret is inside it', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello world');
    const selections = [createSelection(0, 8, 0, 8)];
    const { nextSelections } = applyDeleteWordBackwardToSelections(
      textDocument,
      selections
    );

    expect(textDocument.getText()).toBe('hello rld');
    expect(nextSelections).toEqual([createSelection(0, 6, 0, 6)]);
  });

  test('deletes the preceding word and whitespace when the caret is after them', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello world');
    const selections = [createSelection(0, 6, 0, 6)];
    const { nextSelections } = applyDeleteWordBackwardToSelections(
      textDocument,
      selections
    );

    expect(textDocument.getText()).toBe('world');
    expect(nextSelections).toEqual([createSelection(0, 0, 0, 0)]);
  });

  test('deletes the preceding word and single trailing tab', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello\tworld');
    const selections = [createSelection(0, 6, 0, 6)];
    const { nextSelections } = applyDeleteWordBackwardToSelections(
      textDocument,
      selections
    );

    expect(textDocument.getText()).toBe('world');
    expect(nextSelections).toEqual([createSelection(0, 0, 0, 0)]);
  });

  test('deletes a multi-space run as its own group', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello  world');
    const selections = [createSelection(0, 7, 0, 7)];
    const { nextSelections } = applyDeleteWordBackwardToSelections(
      textDocument,
      selections
    );

    expect(textDocument.getText()).toBe('helloworld');
    expect(nextSelections).toEqual([createSelection(0, 5, 0, 5)]);
  });

  test('deletes a multi-tab run as its own group', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello\t\tworld');
    const selections = [createSelection(0, 7, 0, 7)];
    const { nextSelections } = applyDeleteWordBackwardToSelections(
      textDocument,
      selections
    );

    expect(textDocument.getText()).toBe('helloworld');
    expect(nextSelections).toEqual([createSelection(0, 5, 0, 5)]);
  });

  test('deletes punctuation and a single preceding space together before a word', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello, world');
    const selections = [createSelection(0, 7, 0, 7)];
    const { nextSelections } = applyDeleteWordBackwardToSelections(
      textDocument,
      selections
    );

    expect(textDocument.getText()).toBe('helloworld');
    expect(nextSelections).toEqual([createSelection(0, 5, 0, 5)]);
  });

  test('deletes only the current word group when the caret is on whitespace', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello, world');
    const selections = [createSelection(0, 5, 0, 5)];
    const { nextSelections } = applyDeleteWordBackwardToSelections(
      textDocument,
      selections
    );

    expect(textDocument.getText()).toBe(', world');
    expect(nextSelections).toEqual([createSelection(0, 0, 0, 0)]);
  });

  test('deletes the newline when the caret is at the start of a line', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello\nworld');
    const selections = [createSelection(1, 0, 1, 0)];
    const { nextSelections } = applyDeleteWordBackwardToSelections(
      textDocument,
      selections
    );

    expect(textDocument.getText()).toBe('helloworld');
    expect(nextSelections).toEqual([createSelection(0, 5, 0, 5)]);
  });

  test('is a no-op at the start of the first line', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello');
    const selections = [createSelection(0, 0, 0, 0)];
    const { nextSelections, change } = applyDeleteWordBackwardToSelections(
      textDocument,
      selections
    );

    expect(change).toBeUndefined();
    expect(textDocument.getText()).toBe('hello');
    expect(nextSelections).toEqual([createSelection(0, 0, 0, 0)]);
  });

  test('deletes an explicit selection instead of the preceding word', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello world');
    const selections = [createSelection(0, 0, 0, 5, DirectionForward)];
    const { nextSelections } = applyDeleteWordBackwardToSelections(
      textDocument,
      selections
    );

    expect(textDocument.getText()).toBe(' world');
    expect(nextSelections).toEqual([createSelection(0, 0, 0, 0)]);
  });

  test('merges overlapping delete ranges from multiple carets in the same word', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello world');
    const selections = [
      createSelection(0, 8, 0, 8),
      createSelection(0, 11, 0, 11),
    ];
    const { nextSelections, change } = applyDeleteWordBackwardToSelections(
      textDocument,
      selections
    );

    expect(change).toBeDefined();
    expect(textDocument.getText()).toBe('hello ');
    expect(nextSelections).toEqual([
      createSelection(0, 6, 0, 6),
      createSelection(0, 6, 0, 6),
    ]);
  });
});

describe('applyTransposeToSelections', () => {
  test('swaps the characters on either side of a collapsed caret', () => {
    const textDocument = new TextDocument('inmemory://1', 'abc');
    const selections = [createSelection(0, 1, 0, 1)];
    const { nextSelections, change } = applyTransposeToSelections(
      textDocument,
      selections
    );

    expect(change).toBeDefined();
    expect(textDocument.getText()).toBe('bac');
    expect(nextSelections).toEqual([createSelection(0, 2, 0, 2)]);
  });

  test('swaps the last two characters when the caret is at end-of-line', () => {
    const textDocument = new TextDocument('inmemory://1', 'abc');
    const selections = [createSelection(0, 3, 0, 3)];
    const { nextSelections } = applyTransposeToSelections(
      textDocument,
      selections
    );

    expect(textDocument.getText()).toBe('acb');
    expect(nextSelections).toEqual([createSelection(0, 3, 0, 3)]);
  });

  test('swaps across a line boundary when the caret is at start-of-line', () => {
    const textDocument = new TextDocument('inmemory://1', 'abc\ndef');
    const selections = [createSelection(1, 0, 1, 0)];
    const { nextSelections } = applyTransposeToSelections(
      textDocument,
      selections
    );

    expect(textDocument.getText()).toBe('abd\ncef');
    expect(nextSelections).toEqual([createSelection(1, 1, 1, 1)]);
  });

  test('is a no-op when transpose is not possible', () => {
    const textDocument = new TextDocument('inmemory://1', 'a');
    const selections = [createSelection(0, 0, 0, 0)];
    const { nextSelections, change } = applyTransposeToSelections(
      textDocument,
      selections
    );

    expect(change).toBeUndefined();
    expect(textDocument.getText()).toBe('a');
    expect(nextSelections).toEqual([createSelection(0, 0, 0, 0)]);
  });

  test('skips non-collapsed selections', () => {
    const textDocument = new TextDocument('inmemory://1', 'abc');
    const selections = [
      createSelection(0, 0, 0, 2, DirectionForward),
      createSelection(0, 2, 0, 2),
    ];
    const { nextSelections, change } = applyTransposeToSelections(
      textDocument,
      selections
    );

    expect(change).toBeDefined();
    expect(textDocument.getText()).toBe('acb');
    expect(nextSelections).toEqual([
      createSelection(0, 0, 0, 2, DirectionForward),
      createSelection(0, 3, 0, 3),
    ]);
  });

  test('applies independently across multiple carets', () => {
    const textDocument = new TextDocument('inmemory://1', 'ax\nby\ncz');
    const selections = [
      createSelection(0, 1, 0, 1),
      createSelection(1, 1, 1, 1),
      createSelection(2, 1, 2, 1),
    ];
    const { nextSelections } = applyTransposeToSelections(
      textDocument,
      selections
    );

    expect(textDocument.getText()).toBe('xa\nyb\nzc');
    expect(nextSelections).toEqual([
      createSelection(0, 2, 0, 2),
      createSelection(1, 2, 1, 2),
      createSelection(2, 2, 2, 2),
    ]);
  });

  test('swaps a letter and an emoji without splitting the surrogate pair', () => {
    const textDocument = new TextDocument('inmemory://1', 'a😀b');
    const selections = [createSelection(0, 1, 0, 1)];
    const { nextSelections, change } = applyTransposeToSelections(
      textDocument,
      selections
    );

    expect(change).toBeDefined();
    expect(textDocument.getText()).toBe('😀ab');
    expect(nextSelections).toEqual([createSelection(0, 3, 0, 3)]);
  });

  test('swaps the last two graphemes when the line ends with an emoji', () => {
    const textDocument = new TextDocument('inmemory://1', 'a😀');
    const selections = [createSelection(0, 3, 0, 3)];
    const { nextSelections } = applyTransposeToSelections(
      textDocument,
      selections
    );

    expect(textDocument.getText()).toBe('😀a');
    expect(nextSelections).toEqual([createSelection(0, 3, 0, 3)]);
  });

  test('is a no-op at end-of-line when the line is a single emoji', () => {
    const textDocument = new TextDocument('inmemory://1', '😀');
    const selections = [createSelection(0, 2, 0, 2)];
    const { nextSelections, change } = applyTransposeToSelections(
      textDocument,
      selections
    );

    expect(change).toBeUndefined();
    expect(textDocument.getText()).toBe('😀');
    expect(nextSelections).toEqual([createSelection(0, 2, 0, 2)]);
  });

  test('carries an emoji across the line break when transposing at start-of-line', () => {
    const textDocument = new TextDocument('inmemory://1', 'x😀\ny');
    const selections = [createSelection(1, 0, 1, 0)];
    const { nextSelections } = applyTransposeToSelections(
      textDocument,
      selections
    );

    expect(textDocument.getText()).toBe('xy\n😀');
    expect(nextSelections).toEqual([createSelection(1, 2, 1, 2)]);
  });
});

describe('applyTextReplaceToSelections', () => {
  test('replaces each selection with its own pasted text', () => {
    const textDocument = new TextDocument('inmemory://1', 'x\ny\nz');
    const selections = [
      createSelection(0, 1, 0, 1),
      createSelection(1, 1, 1, 1),
      createSelection(2, 1, 2, 1),
    ];
    const { nextSelections } = applyTextReplaceToSelections(
      textDocument,
      selections,
      ['a', 'b', 'c']
    );

    expect(textDocument.getText()).toBe('xa\nyb\nzc');
    expect(nextSelections).toEqual([
      createSelection(0, 2, 0, 2),
      createSelection(1, 2, 1, 2),
      createSelection(2, 2, 2, 2),
    ]);
  });

  test('matches pasted text by document order for descending selections', () => {
    const textDocument = new TextDocument('inmemory://1', 'x\ny\nz');
    const selections = [
      createSelection(2, 1, 2, 1),
      createSelection(1, 1, 1, 1),
      createSelection(0, 1, 0, 1),
    ];
    const { nextSelections } = applyTextReplaceToSelections(
      textDocument,
      selections,
      ['a', 'b', 'c'],
      undefined,
      false,
      'document'
    );

    expect(textDocument.getText()).toBe('xa\nyb\nzc');
    expect(nextSelections).toEqual([
      createSelection(2, 2, 2, 2),
      createSelection(1, 2, 1, 2),
      createSelection(0, 2, 0, 2),
    ]);
  });

  test('keeps different-length replacement texts paired with unordered selections', () => {
    const textDocument = new TextDocument('inmemory://1', 'abcdef');
    const selections = [
      createSelection(0, 4, 0, 6, DirectionForward),
      createSelection(0, 0, 0, 1, DirectionForward),
    ];
    const { nextSelections } = applyTextReplaceToSelections(
      textDocument,
      selections,
      ['Z', 'long']
    );

    expect(textDocument.getText()).toBe('longbcdZ');
    expect(nextSelections).toEqual([
      createSelection(0, 8, 0, 8),
      createSelection(0, 4, 0, 4),
    ]);
  });

  test('throws when replacement count does not match selections', () => {
    const textDocument = new TextDocument('inmemory://1', 'x\ny');
    const selections = [
      createSelection(0, 1, 0, 1),
      createSelection(1, 1, 1, 1),
    ];

    expect(() =>
      applyTextReplaceToSelections(textDocument, selections, ['a'])
    ).toThrow('Selection text replacements must match the selection count');
  });

  test('throws on overlapping selection ranges', () => {
    const textDocument = new TextDocument('inmemory://1', 'abcd');
    const selections = [
      createSelection(0, 0, 0, 2, DirectionForward),
      createSelection(0, 1, 0, 3, DirectionForward),
    ];

    expect(() =>
      applyTextReplaceToSelections(textDocument, selections, ['x', 'y'])
    ).toThrow('Overlapping multi-selection edits are not supported');
  });
});

describe('resolveIndentEdits', () => {
  test('outdent removes one tab or one soft-tab width per line', () => {
    const textDocument = new TextDocument(
      'inmemory://1',
      '\tfoo\n    bar\nbaz'
    );
    const selection = createSelection(0, 1, 2, 0, DirectionForward);
    const [edits, nextSelection] = resolveIndentEdits(
      textDocument,
      selection,
      4,
      true
    );

    expect(edits).toEqual([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        newText: '',
      },
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 4 },
        },
        newText: '',
      },
    ]);
    expect(nextSelection).toEqual(
      createSelection(0, 0, 2, 0, DirectionForward)
    );
  });

  test('indent inserts a tab when the line already starts with a tab', () => {
    const textDocument = new TextDocument('inmemory://1', '\tfoo');
    const selection = createSelection(0, 1, 0, 2, DirectionForward);
    const [edits, nextSelection] = resolveIndentEdits(
      textDocument,
      selection,
      4,
      false
    );

    expect(edits).toEqual([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: '\t',
      },
    ]);
    // Both edges shift right by the single column the inserted tab occupies.
    expect(nextSelection).toEqual(
      createSelection(0, 2, 0, 3, DirectionForward)
    );
  });

  test('indent inserts soft-tab spaces and skips a trailing column-zero line', () => {
    const textDocument = new TextDocument('inmemory://1', 'foo\nbar\nbaz');
    // The selection ends at the very start of line 2, so line 2 is not indented.
    const selection = createSelection(0, 0, 2, 0, DirectionForward);
    const [edits, nextSelection] = resolveIndentEdits(
      textDocument,
      selection,
      2,
      false
    );

    expect(edits).toEqual([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: '  ',
      },
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
        },
        newText: '  ',
      },
    ]);
    // Only the start edge sits on an indented line, so only it shifts right.
    expect(nextSelection).toEqual(
      createSelection(0, 2, 2, 0, DirectionForward)
    );
  });

  test('outdent removes only the leading spaces that exist and skips unindented lines', () => {
    const textDocument = new TextDocument('inmemory://1', '  foo\nbaz');
    const selection = createSelection(0, 2, 1, 3, DirectionForward);
    const [edits, nextSelection] = resolveIndentEdits(
      textDocument,
      selection,
      4,
      true
    );

    // Line 0 has only two leading spaces (fewer than tabSize), so only those two
    // are removed; line 1 has no indentation and produces no edit at all.
    expect(edits).toEqual([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 2 },
        },
        newText: '',
      },
    ]);
    expect(nextSelection).toEqual(
      createSelection(0, 0, 1, 3, DirectionForward)
    );
  });
});

describe('expandCollapsedSelectionToWord', () => {
  // Document content: "hello world!" (14 characters, quotes included)
  // Segment positions:  hello → [1, 6),  world → [7, 12)
  const doc = new TextDocument('inmemory://x', '"hello world!"');
  const collapsed = (ch: number) => createSelection(0, ch, 0, ch);

  test('expands when cursor is inside a word', () => {
    // "h<cursor>ello world!"
    expect(expandCollapsedSelectionToWord(doc, collapsed(3))).toEqual({
      start: { line: 0, character: 1 },
      end: { line: 0, character: 6 },
      direction: DirectionForward,
    });
  });

  test('expands when cursor is at the start of a word ("<cursor>hello)', () => {
    // cursor immediately before 'h'
    expect(expandCollapsedSelectionToWord(doc, collapsed(1))).toEqual({
      start: { line: 0, character: 1 },
      end: { line: 0, character: 6 },
      direction: DirectionForward,
    });
  });

  test('expands when cursor is at the end of a word (hello<cursor> )', () => {
    // cursor immediately after 'o' of hello
    expect(expandCollapsedSelectionToWord(doc, collapsed(6))).toEqual({
      start: { line: 0, character: 1 },
      end: { line: 0, character: 6 },
      direction: DirectionForward,
    });
  });

  test('expands when cursor is at the start of the second word ( <cursor>world)', () => {
    // cursor immediately before 'w'
    expect(expandCollapsedSelectionToWord(doc, collapsed(7))).toEqual({
      start: { line: 0, character: 7 },
      end: { line: 0, character: 12 },
      direction: DirectionForward,
    });
  });

  test('expands when cursor is at the end of the second word (world<cursor>!)', () => {
    // cursor immediately after 'd' of world
    expect(expandCollapsedSelectionToWord(doc, collapsed(12))).toEqual({
      start: { line: 0, character: 7 },
      end: { line: 0, character: 12 },
      direction: DirectionForward,
    });
  });

  test('does not expand when cursor is before the opening quote (<cursor>"hello)', () => {
    // cursor before the first ", separated from any word
    expect(expandCollapsedSelectionToWord(doc, collapsed(0))).toEqual(
      collapsed(0)
    );
  });

  test('does not expand when cursor is after the closing exclamation (world!<cursor>")', () => {
    // cursor after '!', separated from the nearest word by '!'
    expect(expandCollapsedSelectionToWord(doc, collapsed(13))).toEqual(
      collapsed(13)
    );
  });

  test('does not expand when cursor is after the closing quote ("hello world!"<cursor>)', () => {
    // cursor past the last character
    expect(expandCollapsedSelectionToWord(doc, collapsed(14))).toEqual(
      collapsed(14)
    );
  });
});

describe('findNextMatch', () => {
  test('returns undefined for empty selections', () => {
    const doc = new TextDocument('inmemory://x', 'hello');
    expect(findNextMatch(doc, [])).toBeUndefined();
  });

  test('ignores non-collapsed selections with different text', () => {
    const doc = new TextDocument('inmemory://x', 'aa bb');
    const selections: EditorSelection[] = [
      createSelection(0, 0, 0, 2),
      createSelection(0, 3, 0, 5),
    ];
    expect(findNextMatch(doc, selections)).toBeUndefined();
  });

  test('expands a collapsed caret to the surrounding word', () => {
    const doc = new TextDocument('inmemory://x', "'foobar'");
    const caret = createSelection(0, 4, 0, 4);
    const next = findNextMatch(doc, [caret]);
    expect(next).toEqual([
      {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 7 },
        direction: DirectionForward,
      },
    ]);
  });

  test('adds the next matching range when one occurrence is selected', () => {
    const doc = new TextDocument('inmemory://x', 'foo x foo');
    const first = createSelection(0, 0, 0, 3);
    const afterFirst = findNextMatch(doc, [first]);
    expect(afterFirst).toEqual([
      first,
      {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 9 },
        direction: DirectionForward,
      },
    ]);
    expect(findNextMatch(doc, afterFirst!)).toBeUndefined();
  });

  test('wraps to an earlier occurrence after the last match in the file', () => {
    const doc = new TextDocument('inmemory://x', 'foo bar foo');
    const secondFoo = createSelection(0, 8, 0, 11);
    const wrapped = findNextMatch(doc, [secondFoo]);
    expect(wrapped).toEqual([
      secondFoo,
      {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 3 },
        direction: DirectionForward,
      },
    ]);
  });

  test('allows multiple selections when every range has the same text', () => {
    const doc = new TextDocument('inmemory://x', 'ab ab ab');
    const a = createSelection(0, 0, 0, 2);
    const b = createSelection(0, 3, 0, 5);
    const two = [a, b];
    const third = findNextMatch(doc, two);
    expect(third?.length).toBe(3);
    expect(third?.[2]).toEqual({
      start: { line: 0, character: 6 },
      end: { line: 0, character: 8 },
      direction: DirectionForward,
    });
  });
});

describe('isLineEditable', () => {
  test('permits editing context and addition lines only', () => {
    expect(isLineEditable('context')).toBe(true);
    expect(isLineEditable('context-expanded')).toBe(true);
    expect(isLineEditable('change-addition')).toBe(true);
    expect(isLineEditable('change-deletion')).toBe(false);
    expect(isLineEditable('spacer')).toBe(false);
    expect(isLineEditable('')).toBe(false);
  });
});

describe('getDocumentFullSelection', () => {
  test('spans from the document start to the end of the last line', () => {
    const textDocument = new TextDocument(
      'inmemory://1',
      'alpha\nbravo\ncharlie'
    );
    expect(getDocumentFullSelection(textDocument)).toEqual(
      createSelection(0, 0, 2, 7, DirectionForward)
    );
  });

  test('collapses to an empty range for an empty document', () => {
    const textDocument = new TextDocument('inmemory://1', '');
    expect(getDocumentFullSelection(textDocument)).toEqual(
      createSelection(0, 0, 0, 0, DirectionForward)
    );
  });
});

describe('getSelectedLineBlocks', () => {
  test('drops the trailing line when a ranged selection ends at column zero', () => {
    expect(
      getSelectedLineBlocks([createSelection(1, 2, 3, 0, DirectionForward)])
    ).toEqual([{ startLine: 1, endLine: 2 }]);
  });

  test('keeps the line for a collapsed caret at column zero', () => {
    expect(getSelectedLineBlocks([createSelection(2, 0, 2, 0)])).toEqual([
      { startLine: 2, endLine: 2 },
    ]);
  });

  test('sorts blocks, merges adjacent ones, and keeps gaps split', () => {
    const blocks = getSelectedLineBlocks([
      createSelection(4, 0, 4, 3, DirectionForward),
      createSelection(0, 0, 1, 2, DirectionForward),
      createSelection(2, 0, 2, 1, DirectionForward),
    ]);
    // Lines 0-1 and line 2 are directly adjacent and merge into one block; line
    // 4 is separated from line 2 by the gap at line 3 and stays its own block.
    expect(blocks).toEqual([
      { startLine: 0, endLine: 2 },
      { startLine: 4, endLine: 4 },
    ]);
  });
});

describe('shiftSelectionLines', () => {
  const lineLengths = [5, 6, 7];
  const getLineLength = (line: number) => lineLengths[line] ?? 0;

  test('moves both edges down one line and keeps their columns', () => {
    expect(
      shiftSelectionLines(
        createSelection(0, 2, 0, 4, DirectionForward),
        1,
        3,
        getLineLength
      )
    ).toEqual(createSelection(1, 2, 1, 4, DirectionForward));
  });

  test('clamps to the end of the last line when moving past the bottom', () => {
    expect(
      shiftSelectionLines(
        createSelection(2, 1, 2, 3, DirectionForward),
        1,
        3,
        getLineLength
      )
    ).toEqual(createSelection(2, 7, 2, 7, DirectionForward));
  });

  test('clamps to the document start when moving past the top', () => {
    expect(
      shiftSelectionLines(
        createSelection(0, 3, 0, 5, DirectionBackward),
        -1,
        3,
        getLineLength
      )
    ).toEqual(createSelection(0, 0, 0, 0, DirectionBackward));
  });
});

describe('extendSelections', () => {
  test('extends every selection to the target and merges the overlaps', () => {
    const result = extendSelections(
      [createSelection(0, 1, 0, 1), createSelection(0, 4, 0, 4)],
      createSelection(0, 0, 0, 6, DirectionForward)
    );
    // Both carets extend their focus to column 6, so the two resulting ranges
    // overlap and merge into a single selection.
    expect(result).toEqual([createSelection(0, 1, 0, 6, DirectionForward)]);
  });
});

describe('remapSelectionsAfterEdits', () => {
  test('shifts a caret right past an earlier insertion', () => {
    // "hello" with "XYZ" inserted at offset 0 becomes "XYZhello"; the caret that
    // sat at offset 2 now sits at offset 5.
    const textDocument = new TextDocument('inmemory://1', 'XYZhello');
    const remapped = remapSelectionsAfterEdits(
      textDocument,
      [createSelection(0, 2, 0, 2)],
      [[2, 2]],
      [{ start: 0, end: 0, text: 'XYZ' }]
    );
    expect(remapped).toEqual([createSelection(0, 5, 0, 5)]);
  });

  test('collapses a caret inside a replaced range to the end of the replacement', () => {
    // "abcde" with offsets [1,4) ("bcd") replaced by "XY" becomes "aXYe"; a caret
    // that sat inside the replaced text lands just after it, at offset 3.
    const textDocument = new TextDocument('inmemory://1', 'aXYe');
    const remapped = remapSelectionsAfterEdits(
      textDocument,
      [createSelection(0, 2, 0, 2)],
      [[2, 2]],
      [{ start: 1, end: 4, text: 'XY' }]
    );
    expect(remapped).toEqual([createSelection(0, 3, 0, 3)]);
  });

  test('preserves selection direction while remapping both edges', () => {
    // Deleting offsets [0,2) of "abcdef" leaves "cdef"; a backward selection over
    // offsets 2..5 shifts to 0..3 and stays backward.
    const textDocument = new TextDocument('inmemory://1', 'cdef');
    const remapped = remapSelectionsAfterEdits(
      textDocument,
      [createSelection(0, 2, 0, 5, DirectionBackward)],
      [[2, 5]],
      [{ start: 0, end: 2, text: '' }]
    );
    expect(remapped).toEqual([createSelection(0, 0, 0, 3, DirectionBackward)]);
  });
});

describe('resolveSelectionCut', () => {
  test('cuts only the selected text for a ranged selection', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello world');
    expect(
      resolveSelectionCut(textDocument, [
        createSelection(0, 0, 0, 5, DirectionForward),
      ])
    ).toEqual({
      text: 'hello',
      edits: [{ start: 0, end: 5, text: '' }],
      nextSelectionOffsets: [0],
    });
  });

  test('cuts a whole non-final line, including its trailing break, for a caret', () => {
    const textDocument = new TextDocument(
      'inmemory://1',
      'alpha\nbravo\ncharlie'
    );
    expect(
      resolveSelectionCut(textDocument, [createSelection(0, 2, 0, 2)])
    ).toEqual({
      text: 'alpha\n',
      edits: [{ start: 0, end: 6, text: '' }],
      nextSelectionOffsets: [0],
    });
  });

  test('removes the preceding break instead of the trailing one when cutting the final line', () => {
    const textDocument = new TextDocument('inmemory://1', 'alpha\nbravo');
    // The clipboard text is just the line content, but the deletion also removes
    // the newline before it so no blank line is left behind.
    expect(
      resolveSelectionCut(textDocument, [createSelection(1, 1, 1, 1)])
    ).toEqual({
      text: 'bravo',
      edits: [{ start: 5, end: 11, text: '' }],
      nextSelectionOffsets: [5],
    });
  });

  test('deletes content only when the caret is on the sole line', () => {
    const textDocument = new TextDocument('inmemory://1', 'hello');
    expect(
      resolveSelectionCut(textDocument, [createSelection(0, 2, 0, 2)])
    ).toEqual({
      text: 'hello',
      edits: [{ start: 0, end: 5, text: '' }],
      nextSelectionOffsets: [0],
    });
  });

  test('merges two carets on the same line into a single deletion', () => {
    const textDocument = new TextDocument('inmemory://1', 'alpha\nbravo');
    expect(
      resolveSelectionCut(textDocument, [
        createSelection(0, 1, 0, 1),
        createSelection(0, 3, 0, 3),
      ])
    ).toEqual({
      text: 'alpha\n',
      edits: [{ start: 0, end: 6, text: '' }],
      nextSelectionOffsets: [0, 0],
    });
  });
});

// ---------------------------------------------------------------------------
// Consolidated selection/word-operation suites (migrated).
// ---------------------------------------------------------------------------

function doc(text: string) {
  return new TextDocument('inmemory://1', text, 'plain');
}

function caret(line: number, character: number): EditorSelection {
  const position = { line, character };
  return { start: position, end: position, direction: DirectionNone };
}

// Flat single-line selection helper: every fixture below that uses it lives
// on line 0, so `character` doubles as the flat offset.
function sel(
  startCharacter: number,
  endCharacter: number,
  direction: SelectionDirection = DirectionForward
): EditorSelection {
  return {
    start: { line: 0, character: startCharacter },
    end: { line: 0, character: endCharacter },
    direction,
  };
}

// Runs one Backspace at the given selections and returns the selections that
// result, mutating `d` in place.
function backspace(d: ReturnType<typeof doc>, selections: EditorSelection[]) {
  return applyDeleteCharacterToSelections(d, selections, false).nextSelections;
}

describe('backward delete over grapheme clusters', () => {
  test('backspace removes a whole ZWJ family emoji without splitting the cluster', () => {
    // DIVERGENCE: the conventional behavior peels one ZWJ component off the
    // end per keystroke (family → couple → single person → empty, one
    // Backspace each). pierre-fe steps by Intl.Segmenter grapheme clusters,
    // so the entire family emoji is one unit and a single Backspace removes
    // it all. Both policies agree on the invariant this regression was about:
    // no keystroke may split a surrogate pair or strand a lone ZWJ/modifier
    // in the buffer.
    const family = '\u{1F469}‍\u{1F469}‍\u{1F466}‍\u{1F466}'; // 👩‍👩‍👦‍👦
    expect(family.length).toBe(11); // 4 surrogate pairs + 3 ZWJs

    const d = doc(`hi${family}!`);
    // Caret between the family emoji and the trailing '!'.
    const range = resolveDeleteCharacterRange(d, caret(0, 13), false);
    expect(range).toEqual([
      { line: 0, character: 2 },
      { line: 0, character: 13 },
    ]);

    const next = backspace(d, [caret(0, 13)]);
    expect(d.getText()).toBe('hi!');
    expect(next).toEqual([caret(0, 2)]);
  });

  test('backspace removes base emoji and skin-tone modifier as one unit', () => {
    const thumbs = '\u{1F44D}\u{1F3FD}'; // 👍🏽 = base + Fitzpatrick modifier
    expect(thumbs.length).toBe(4);

    const d = doc(`ok ${thumbs}`);
    const range = resolveDeleteCharacterRange(d, caret(0, 7), false);
    expect(range).toEqual([
      { line: 0, character: 3 },
      { line: 0, character: 7 },
    ]);

    const next = backspace(d, [caret(0, 7)]);
    // One keystroke removes the modifier together with its base — the buffer
    // never holds a bare modifier or half a surrogate pair.
    expect(d.getText()).toBe('ok ');
    expect(next).toEqual([caret(0, 3)]);
  });

  test('backspace steps over Thai combining marks one grapheme cluster at a time', () => {
    // DIVERGENCE: the conventional behavior deliberately deletes one UTF-16
    // code unit per Backspace in combining-mark scripts (Thai users filed the
    // regressions this pins because they expect to erase a tone/vowel mark
    // without losing the base consonant; that fixture needs six keystrokes
    // for six code units). pierre-fe deletes whole Intl.Segmenter grapheme
    // clusters everywhere, so a base consonant and its attached marks always
    // leave together. Never splitting a cluster also means no keystroke can
    // strand a combining mark.
    const thai = 'น้ำใจ'; // น + ◌้ + ◌ำ (one cluster), ใ, จ
    expect(thai.length).toBe(5);

    const d = doc(thai);
    let selections = [caret(0, 5)];

    // จ is a single-unit cluster.
    expect(resolveDeleteCharacterRange(d, selections[0], false)).toEqual([
      { line: 0, character: 4 },
      { line: 0, character: 5 },
    ]);
    selections = backspace(d, selections);
    expect(d.getText()).toBe('น้ำใ');

    selections = backspace(d, selections);
    expect(d.getText()).toBe('น้ำ');

    // The remaining three code units are one cluster: base consonant plus two
    // combining marks are removed by a single keystroke.
    expect(resolveDeleteCharacterRange(d, selections[0], false)).toEqual([
      { line: 0, character: 0 },
      { line: 0, character: 3 },
    ]);
    selections = backspace(d, selections);
    expect(d.getText()).toBe('');
    expect(selections).toEqual([caret(0, 0)]);
  });
});

describe('select next occurrence with touching matches', () => {
  test('finds a repeat that touches the current selection with zero gap', () => {
    const d = doc('abcabc');
    const first = createSelection(0, 0, 0, 3, DirectionForward);

    // The second "abc" starts exactly where the selected one ends. It must be
    // returned as the next match, not skipped as overlapping.
    const next = findNextMatch(d, [first]);
    expect(next).toEqual([
      first,
      createSelection(0, 3, 0, 6, DirectionForward),
    ]);

    // Both occurrences are now held; nothing is left to add.
    expect(findNextMatch(d, next!)).toBeUndefined();
  });

  test('repeated next-occurrence walks through touching matches across lines', () => {
    const d = doc('rowrow\nrow\nrowrow');
    let selections: EditorSelection[] | undefined = [
      createSelection(0, 0, 0, 3, DirectionForward),
    ];

    const expected = [
      createSelection(0, 3, 0, 6, DirectionForward), // touching repeat on the same line
      createSelection(1, 0, 1, 3, DirectionForward),
      createSelection(2, 0, 2, 3, DirectionForward),
      createSelection(2, 3, 2, 6, DirectionForward), // touching repeat on the last line
    ];
    for (const added of expected) {
      selections = findNextMatch(d, selections!);
      expect(selections![selections!.length - 1]).toEqual(added);
    }
    expect(selections!.length).toBe(5);

    // All five occurrences selected — the next request finds nothing new.
    expect(findNextMatch(d, selections!)).toBeUndefined();
  });
});

describe('carets converging through a delete', () => {
  test('carets that converge via backspace merge and type the next character once', () => {
    // The regression this pins reproduces the double-insert users saw when
    // merge-on-overlap is disabled; with merging on (like pierre-fe's
    // always-on mergeOverlappingSelections) the two converged carets collapse
    // to one and the typed character is inserted once.
    const d = doc('name = ""');
    // One caret after each quote.
    const afterDelete = backspace(d, [caret(0, 8), caret(0, 9)]);

    // Each caret deleted its own quote; both land on the same position.
    expect(d.getText()).toBe('name = ');
    expect(afterDelete).toEqual([caret(0, 7), caret(0, 7)]);

    const merged = mergeOverlappingSelections(afterDelete);
    expect(merged).toEqual([caret(0, 7)]);

    // Type a single quote at the merged caret: it must appear exactly once.
    const { nextSelections } = applyTextChangeToSelections(d, merged, {
      start: 7,
      end: 7,
      text: "'",
    });
    expect(d.getText()).toBe("name = '");
    expect(nextSelections).toEqual([caret(0, 8)]);
  });
});

describe('auto-surround next to an astral character', () => {
  test('surrounding a selection just before an emoji survives undo intact', () => {
    // The owl is a surrogate pair at characters 1-2; the wrapped selection is
    // the double quote at character 0, so the inserted closing quote lands
    // immediately before the high surrogate.
    const d = doc('"🦉"');
    const selections = [createSelection(0, 0, 0, 1, DirectionForward)];

    const texts = getAutoSurroundReplacementTexts(d, selections, "'");
    expect(texts).toEqual(["'\"'"]);

    const { nextSelections } = applyTextReplaceToSelections(
      d,
      selections,
      texts!
    );
    expect(d.getText()).toBe('\'"\'🦉"');
    // The originally selected text stays selected inside the new pair.
    expect(nextSelections).toEqual([
      createSelection(0, 1, 0, 2, DirectionForward),
    ]);

    // Undo must restore the buffer byte-for-byte — the emoji is not mangled.
    expect(d.canUndo).toBe(true);
    d.undo();
    expect(d.getText()).toBe('"🦉"');

    // And the round trip keeps working in both directions.
    d.redo();
    expect(d.getText()).toBe('\'"\'🦉"');
    d.undo();
    expect(d.getText()).toBe('"🦉"');
  });

  test('surrounding a selection just after an emoji survives undo intact', () => {
    // Mirror case: the wrapped selection is the closing quote at character 3,
    // so the inserted opening bracket lands immediately after the low
    // surrogate.
    const d = doc('"🦉"');
    const selections = [createSelection(0, 3, 0, 4, DirectionForward)];

    const texts = getAutoSurroundReplacementTexts(d, selections, '(');
    expect(texts).toEqual(['(")']);

    const { nextSelections } = applyTextReplaceToSelections(
      d,
      selections,
      texts!
    );
    expect(d.getText()).toBe('"🦉(")');
    expect(nextSelections).toEqual([
      createSelection(0, 4, 0, 5, DirectionForward),
    ]);

    d.undo();
    expect(d.getText()).toBe('"🦉"');
  });
});

// Word-granularity segments the runtime's ICU reports as word-like for a
// fixture. Used to gate segmenter-side pins: isWordLike classification
// varies across ICU builds (dictionary-based CJK segmentation especially),
// so each pin runs only where the runtime agrees with the segmentation our
// dev and CI environments ship, and skips visibly elsewhere.
function wordLikeSegments(text: string): string[] {
  return [
    ...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text),
  ]
    .filter((seg) => seg.isWordLike === true)
    .map((seg) => seg.segment);
}

// Explicit escapes so source normalization (NFC/NFD) can never change the
// fixture: a ZWJ family sequence (7 code points, 11 UTF-16 units) and a
// baby emoji with a Fitzpatrick skin-tone modifier (2 code points, 4 units).
const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}'; // 👨‍👩‍👧‍👦
const TONED_BABY = '\u{1F476}\u{1F3FE}'; // 👶🏾

describe('word delete vs word select on CJK and mixed-script runs', () => {
  // Both halves of this describe block pin an internal inconsistency on
  // purpose: deleteWordBackward's classifier groups every contiguous
  // \p{Alphabetic} grapheme into ONE run (Han/Hiragana/Katakana are all
  // Alphabetic), while double-click word expansion uses Intl.Segmenter and
  // splits the very same text into words. The tests make the inconsistency
  // visible; they do not pick a winner.

  test('delete word backward swallows an unbroken Chinese run in one stroke', () => {
    // DIVERGENCE: the conventional behavior segments CJK per-word only when
    // word-segmenter locales are explicitly configured (and then Ctrl+Backspace
    // removes one segment at a time); pierre-fe's delete-word classifier
    // treats the whole Alphabetic run as one word, so a single stroke deletes
    // the entire sentence — and this disagrees with pierre-fe's own
    // double-click segmentation below.
    const d = doc('你好世界');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 4),
    ]);
    expect(d.getText()).toBe('');
    expect(nextSelections).toEqual([caret(0, 0)]);
  });

  const segmenterSplitsChineseRun =
    wordLikeSegments('你好世界').join('|') === '你好|世界';

  test.skipIf(!segmenterSplitsChineseRun)(
    'double-click word expansion splits the same Chinese run into segments',
    () => {
      // DIVERGENCE: the conventional default (no word-segmenter locales
      // configured) selects the whole CJK run on double-click; pierre-fe
      // always runs Intl.Segmenter, so the exact text deleteWordBackward
      // treats as one word splits in two here.
      const d = doc('你好世界');
      expect(expandCollapsedSelectionToWord(d, caret(0, 2))).toEqual({
        start: { line: 0, character: 0 },
        end: { line: 0, character: 2 },
        direction: DirectionForward,
      });
      expect(expandCollapsedSelectionToWord(d, caret(0, 4))).toEqual({
        start: { line: 0, character: 2 },
        end: { line: 0, character: 4 },
        direction: DirectionForward,
      });
    }
  );

  test('delete word backward swallows a whole Japanese sentence in one stroke', () => {
    // DIVERGENCE: Hiragana and Han are both \p{Alphabetic}, so the classifier
    // sees one uninterrupted word run across the whole sentence. The
    // conventional behavior, with segmentation enabled, stops at each
    // particle/word boundary.
    const d = doc('私は猫が好き');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 6),
    ]);
    expect(d.getText()).toBe('');
    expect(nextSelections).toEqual([caret(0, 0)]);
  });

  const segmenterIsolatesTheNoun =
    wordLikeSegments('私は猫が好き').includes('猫');

  test.skipIf(!segmenterIsolatesTheNoun)(
    'double-click word expansion segments the same Japanese sentence',
    () => {
      // DIVERGENCE: Intl.Segmenter (dictionary-based, engine/ICU dependent)
      // isolates 猫 as its own word here, while deleteWordBackward above
      // erases the entire sentence as a single unit.
      const d = doc('私は猫が好き');
      expect(expandCollapsedSelectionToWord(d, caret(0, 3))).toEqual({
        start: { line: 0, character: 2 },
        end: { line: 0, character: 3 },
        direction: DirectionForward,
      });
    }
  );

  test('delete word backward swallows a mixed Latin-Katakana run in one stroke', () => {
    // DIVERGENCE: Latin letters and Katakana are both \p{Alphabetic}, so the
    // script boundary inside "helloワールド" is invisible to the delete-word
    // classifier and one stroke removes both halves.
    const d = doc('helloワールド');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 9),
    ]);
    expect(d.getText()).toBe('');
    expect(nextSelections).toEqual([caret(0, 0)]);
  });

  const segmenterSplitsKatakanaRun =
    wordLikeSegments('helloワールド').join('|') === 'hello|ワールド';

  test.skipIf(!segmenterSplitsKatakanaRun)(
    'double-click word expansion splits the mixed run at the script boundary',
    () => {
      // DIVERGENCE: Intl.Segmenter breaks "helloワールド" at the
      // Latin/Katakana boundary, so double-click selects only one script's
      // half while deleteWordBackward above removes both in a single stroke.
      const d = doc('helloワールド');
      expect(expandCollapsedSelectionToWord(d, caret(0, 2))).toEqual({
        start: { line: 0, character: 0 },
        end: { line: 0, character: 5 },
        direction: DirectionForward,
      });
      expect(expandCollapsedSelectionToWord(d, caret(0, 7))).toEqual({
        start: { line: 0, character: 5 },
        end: { line: 0, character: 9 },
        direction: DirectionForward,
      });
    }
  );

  test('delete word backward treats Latin, Han, and digits as one run', () => {
    // DIVERGENCE: the classifier lumps \p{Alphabetic}, \p{Number}, and _ into
    // the same class, so accented Latin + Han + digits form one deletable
    // run.
    const d = doc('naïve東京42'); // "naïve東京42", 9 UTF-16 units
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 9),
    ]);
    expect(d.getText()).toBe('');
    expect(nextSelections).toEqual([caret(0, 0)]);
  });

  // Intl.Segmenter's isWordLike classification varies across ICU builds
  // (whether bare digit runs and Han segments count as word-like differs
  // between engines and platforms). Gate the segmenter-side pin on the
  // runtime agreeing with the segmentation our dev and CI environments ship,
  // so a divergent ICU skips visibly instead of going red.
  const segmenterSplitsMixedRun =
    wordLikeSegments('naïve東京42').join('|') === 'naïve|東京|42';

  test.skipIf(!segmenterSplitsMixedRun)(
    'double-click word expansion splits Latin, Han, and digits into three words',
    () => {
      // DIVERGENCE: the same string that deleteWordBackward erases whole
      // yields three distinct double-click words (Latin, Han, digits).
      const d = doc('naïve東京42');
      expect(expandCollapsedSelectionToWord(d, caret(0, 2))).toEqual({
        start: { line: 0, character: 0 },
        end: { line: 0, character: 5 },
        direction: DirectionForward,
      });
      expect(expandCollapsedSelectionToWord(d, caret(0, 6))).toEqual({
        start: { line: 0, character: 5 },
        end: { line: 0, character: 7 },
        direction: DirectionForward,
      });
      expect(expandCollapsedSelectionToWord(d, caret(0, 8))).toEqual({
        start: { line: 0, character: 7 },
        end: { line: 0, character: 9 },
        direction: DirectionForward,
      });
    }
  );
});

describe('word delete around emoji and grapheme clusters', () => {
  // Probed against the current implementation: every case below removes whole
  // grapheme clusters — no surrogate halves, orphan ZWJs, lone modifiers, or
  // stranded combining marks are ever left behind — so these pin the coherent
  // current behavior rather than flagging bugs.

  test('deletes a lone emoji as its own run without splitting the surrogate pair', () => {
    const d = doc('word🎉');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 6),
    ]);
    expect(d.getText()).toBe('word');
    expect(nextSelections).toEqual([caret(0, 4)]);
  });

  test('stops a word delete at an adjacent emoji and leaves it intact', () => {
    const d = doc('x 🎉party');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 9),
    ]);
    expect(d.getText()).toBe('x 🎉');
    expect(nextSelections).toEqual([caret(0, 4)]);
  });

  test('deletes a ZWJ family emoji as one grapheme cluster', () => {
    const d = doc(`crew ${FAMILY}`);
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 5 + FAMILY.length),
    ]);
    expect(d.getText()).toBe('crew ');
    expect(nextSelections).toEqual([caret(0, 5)]);
  });

  test('deletes only the ZWJ cluster when it directly follows a word', () => {
    const d = doc(`name${FAMILY}`);
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 4 + FAMILY.length),
    ]);
    expect(d.getText()).toBe('name');
    expect(nextSelections).toEqual([caret(0, 4)]);
  });

  test('deletes a word without disturbing a preceding ZWJ cluster', () => {
    const d = doc(`${FAMILY}crew`);
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, FAMILY.length + 4),
    ]);
    expect(d.getText()).toBe(FAMILY);
    expect(nextSelections).toEqual([caret(0, FAMILY.length)]);
  });

  test('deletes a skin-tone modified emoji together with its base', () => {
    const d = doc(`hug${TONED_BABY}`);
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 3 + TONED_BABY.length),
    ]);
    expect(d.getText()).toBe('hug');
    expect(nextSelections).toEqual([caret(0, 3)]);
  });

  test('removes a word containing a combining mark without leaving an orphan mark', () => {
    // "mañana" in decomposed form: the ñ is n + U+0303 combining tilde.
    const d = doc('mañana');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 7),
    ]);
    expect(d.getText()).toBe('');
    expect(nextSelections).toEqual([caret(0, 0)]);
  });

  test('removes a word ending in a combining-mark cluster in one piece', () => {
    // "go piña" in decomposed form; the final cluster is n + U+0303 + a.
    const d = doc('go piña');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 8),
    ]);
    expect(d.getText()).toBe('go ');
    expect(nextSelections).toEqual([caret(0, 3)]);
  });
});

describe('multi-cursor word delete across shifting line numbers', () => {
  test('joins lines at one caret while remapping a second caret on a lower line', () => {
    // Caret 1 sits at column 0 of line 1, so its delete consumes the newline
    // after "alpha"; caret 2 deletes the word on line 2, which becomes line 1.
    const d = doc('alpha\nbravo\ncharlie');
    const { nextSelections, change } = applyDeleteWordBackwardToSelections(d, [
      caret(1, 0),
      caret(2, 7),
    ]);
    expect(change).toBeDefined();
    expect(d.getText()).toBe('alphabravo\n');
    expect(nextSelections).toEqual([caret(0, 5), caret(1, 0)]);
  });

  test('word delete on a shifted line lands mid-line after an upstream join', () => {
    // The second caret deletes only the trailing word, so its remapped caret
    // must land mid-line on the renumbered line, not at column 0.
    const d = doc('first\nsecond\nthird word');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(1, 0),
      caret(2, 10),
    ]);
    expect(d.getText()).toBe('firstsecond\nthird ');
    expect(nextSelections).toEqual([caret(0, 5), caret(1, 6)]);
  });
});

describe('word delete at column zero preserves whitespace byte-for-byte', () => {
  test('keeps the joined line leading spaces intact', () => {
    // Joining must remove exactly the newline: the four leading spaces on the
    // second line survive untouched, with no collapse to a single space.
    const d = doc('first line stops.\n    indented next');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(1, 0),
    ]);
    expect(d.getText()).toBe('first line stops.    indented next');
    expect(nextSelections).toEqual([caret(0, 17)]);
  });

  test('keeps leading tabs intact when joining', () => {
    const d = doc('top\n\t\tkeep tabs');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(1, 0),
    ]);
    expect(d.getText()).toBe('top\t\tkeep tabs');
    expect(nextSelections).toEqual([caret(0, 3)]);
  });

  test('keeps trailing spaces on the surviving line intact when joining', () => {
    const d = doc('padded out   \nnext');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(1, 0),
    ]);
    expect(d.getText()).toBe('padded out   next');
    expect(nextSelections).toEqual([caret(0, 13)]);
  });
});

// Applies `edits` (resolved, pre-edit offsets) to a fresh document built from
// `preText` and returns the post-edit document, ready to be handed to
// remapSelectionsAfterEdits. Going through applyEdits keeps the fixture honest:
// the expected post text asserted in each test is produced by the real edit
// path, not by hand-splicing.
function applyBatch(preText: string, edits: ResolvedTextEdit[]) {
  const pre = doc(preText);
  const post = doc(preText);
  post.applyEdits(
    edits.map((edit) => ({
      range: {
        start: pre.positionAt(edit.start),
        end: pre.positionAt(edit.end),
      },
      newText: edit.text,
    }))
  );
  return post;
}

// Remaps one selection, given as a pre-edit [start, end] offset pair, through
// `edits`. All fixtures are single-line, so the returned offsets are the
// post-edit character columns.
function remapPair(
  preText: string,
  pair: readonly [number, number],
  edits: ResolvedTextEdit[],
  direction: SelectionDirection = DirectionNone
) {
  const pre = doc(preText);
  const post = applyBatch(preText, edits);
  const selection: EditorSelection = {
    start: pre.positionAt(pair[0]),
    end: pre.positionAt(pair[1]),
    direction,
  };
  const [result] = remapSelectionsAfterEdits(post, [selection], [pair], edits);
  return {
    post,
    result,
    offsets: [post.offsetAt(result.start), post.offsetAt(result.end)] as const,
  };
}

describe('remap through replacements', () => {
  test('caret at the start boundary of a replaced range lands after the replacement', () => {
    // DIVERGENCE: the conventional behavior maps a position sitting exactly
    // at the start of a replaced span back to the span's start regardless of
    // which side it's associated with (a position at that boundary never
    // moves through the replacement). pierre-fe's remapOffsetThroughEdits
    // applies uniform right gravity to every offset at or after an edit's
    // start — a documented policy on the function — so the caret lands just
    // AFTER the replacement text instead. Disorienting by that other
    // convention, but the caret stays at a valid buffer position and the
    // policy matches the typing case (text inserted at the caret pushes the
    // caret past it); the main suite already pins the interior-caret variant
    // of the same rule.
    const { post, offsets, result } = remapPair(
      'papaya mango salad',
      [7, 7], // caret exactly at the 'm' of the replaced word
      [{ start: 7, end: 12, text: 'fig' }]
    );
    expect(post.getText()).toBe('papaya fig salad');
    // The conventional behavior would report 7 (the replacement start);
    // pierre reports 10, after 'fig'.
    expect(offsets).toEqual([10, 10]);
    expect(result.direction).toBe(DirectionNone);
  });

  test('carets at the start and end boundaries of one replacement converge after it', () => {
    // DIVERGENCE (same right-gravity policy as above): the start-boundary
    // caret goes through the "inside the edit" branch and the end-boundary
    // caret through the "past the edit" delta branch, yet both come out at
    // the same offset — the two sides of a replacement are not kept apart
    // the way an assoc-aware mapping convention keeps them ([start -> start,
    // end -> after]).
    const edits: ResolvedTextEdit[] = [{ start: 4, end: 9, text: 'DOWN' }];
    const preText = 'shutproof latch';
    const atStart = remapPair(preText, [4, 4], edits);
    const atEnd = remapPair(preText, [9, 9], edits);
    expect(atStart.post.getText()).toBe('shutDOWN latch');
    expect(atStart.offsets).toEqual([8, 8]);
    expect(atEnd.offsets).toEqual([8, 8]);
  });

  test('caret between two adjacent replacements lands after the second one', () => {
    // DIVERGENCE: the conventional behavior keeps a caret at the seam of two
    // touching replacements exactly at that seam (regardless of association
    // side). pierre-fe's right-gravity branch treats offset == start of the
    // second replacement as "inside" it, so the caret is carried past the
    // second replacement's inserted text. Coherent (valid offset, same
    // documented policy), but the caret does not stay between the two spans.
    const { post, offsets } = remapPair(
      'ppqqrr',
      [2, 2], // caret at the seam between the two replaced spans
      [
        { start: 0, end: 2, text: '11' },
        { start: 2, end: 4, text: '2233' },
      ]
    );
    expect(post.getText()).toBe('112233rr');
    // The conventional behavior would report 2 (the seam, unchanged by the
    // equal-length first replacement); pierre reports 6, after '2233'.
    expect(offsets).toEqual([6, 6]);
  });
});

describe('insertion at range-selection boundaries', () => {
  const preText = 'stormcloud';
  // Selection over offsets [3, 7] — the letters 'rmcl'.
  const pair: [number, number] = [3, 7];

  test('insertion exactly at the selection end is absorbed into the selection', () => {
    // DIVERGENCE: the conventional behavior maps a non-empty range's edges
    // with outward bias (excluding insertions at either edge), so an
    // insertion touching either boundary is never absorbed and the selected
    // text stays the same. pierre-fe remaps both edges with the same right
    // gravity, so an insertion exactly at the END boundary lands inside the
    // selection and grows it.
    const edits: ResolvedTextEdit[] = [{ start: 7, end: 7, text: '__' }];

    const forward = remapPair(preText, pair, edits, DirectionForward);
    expect(forward.post.getText()).toBe('stormcl__oud');
    expect(forward.offsets).toEqual([3, 9]); // 'rmcl__' — the insert is inside
    expect(forward.result.direction).toBe(DirectionForward);

    const backward = remapPair(preText, pair, edits, DirectionBackward);
    expect(backward.offsets).toEqual([3, 9]);
    expect(backward.result.direction).toBe(DirectionBackward);
  });

  test('insertion exactly at the selection start shifts the selection without absorbing', () => {
    // The other half of the asymmetry: at the START boundary the same right
    // gravity pushes the start edge past the inserted text, so the whole
    // selection slides right and keeps covering exactly the original letters.
    // (This half agrees with the outward-bias convention of mapping the
    // `from` edge.)
    const edits: ResolvedTextEdit[] = [{ start: 3, end: 3, text: '__' }];

    const forward = remapPair(preText, pair, edits, DirectionForward);
    expect(forward.post.getText()).toBe('sto__rmcloud');
    expect(forward.offsets).toEqual([5, 9]); // still exactly 'rmcl'
    expect(forward.post.getTextSlice(5, 9)).toBe('rmcl');
    expect(forward.result.direction).toBe(DirectionForward);

    const backward = remapPair(preText, pair, edits, DirectionBackward);
    expect(backward.offsets).toEqual([5, 9]);
    expect(backward.result.direction).toBe(DirectionBackward);
  });
});

describe('remap through deletions', () => {
  // Deleting offsets [3, 7) — the letters 'rotc' of 'carrotcake'.
  const preText = 'carrotcake';
  const edits: ResolvedTextEdit[] = [{ start: 3, end: 7, text: '' }];

  test('carets at deletion start, strictly inside, and at deletion end all converge to the deletion start', () => {
    // Matches the conventional plain mapping behavior (no map-mode variants):
    // every position touching the deleted span collapses to where the span
    // used to begin. That convention can still distinguish the three via
    // explicit tracking modes; pierre-fe has no map-mode equivalent, so plain
    // convergence is the whole contract.
    const atStart = remapPair(preText, [3, 3], edits);
    const inside = remapPair(preText, [5, 5], edits);
    const atEnd = remapPair(preText, [7, 7], edits);

    expect(atStart.post.getText()).toBe('carake');
    expect(atStart.offsets).toEqual([3, 3]);
    expect(inside.offsets).toEqual([3, 3]);
    expect(atEnd.offsets).toEqual([3, 3]);
  });

  test('a backward selection exactly spanning the deleted range collapses to a direction-none caret', () => {
    // Both edges converge to the deletion start, and
    // createSelectionFromAnchorAndFocusOffsets re-derives direction from the
    // remapped offsets — equal anchor and focus must yield DirectionNone, not a
    // stale backward direction on a zero-length range.
    const { offsets, result } = remapPair(
      preText,
      [3, 7],
      edits,
      DirectionBackward
    );
    expect(offsets).toEqual([3, 3]);
    expect(result.direction).toBe(DirectionNone);
  });
});

describe('remap through multi-edit batches', () => {
  test('caret after an insert + delete + replace batch accumulates every delta', () => {
    // Digits/letters make the offsets self-documenting: the caret sits on 'E'
    // (offset 14) and must still sit on 'E' after all three edits before it.
    const preText = '0123456789ABCDEF';
    const { post, offsets } = remapPair(
      preText,
      [14, 14],
      [
        { start: 2, end: 2, text: '+++' }, // insert, +3
        { start: 5, end: 7, text: '' }, // delete '56', -2
        { start: 9, end: 11, text: 'WXYZ' }, // replace '9A', +2
      ]
    );
    expect(post.getText()).toBe('01+++23478WXYZBCDEF');
    expect(offsets).toEqual([17, 17]); // 14 + 3 - 2 + 2
    expect(post.getTextSlice(17, 18)).toBe('E');
  });

  test('edits must be sorted ascending by start: unsorted input silently drops earlier edits', () => {
    // DIVERGENCE / contract pin: the conventional behavior accepts change
    // specs in any order and normalizes them internally, so every change is
    // always seen regardless of input order. pierre-fe's remap walks the edit
    // array once and stops at the first edit whose start lies past the
    // offset — a documented precondition ("sorted ascending and
    // non-overlapping" on remapOffsetThroughEdits). When a caller violates
    // it, edits listed after the early-exit point are silently ignored, even
    // though they sit before the offset. This test pins the precondition by
    // contrasting sorted and unsorted calls over the same batch; it is the
    // caller's job to sort, not corruption inside the remap.
    const preText = '0123456789ABCDEF';
    const edits: ResolvedTextEdit[] = [
      { start: 0, end: 0, text: 'YY' },
      { start: 10, end: 10, text: 'XX' },
    ];

    const sorted = remapPair(preText, [5, 5], edits);
    expect(sorted.post.getText()).toBe('YY0123456789XXABCDEF');
    // Only the insert at 0 precedes the caret: 5 + 2.
    expect(sorted.offsets).toEqual([7, 7]);

    // Same batch listed descending: the walk sees the edit at 10 first,
    // breaks (5 < 10), and never applies the insert at 0 — the caret keeps
    // its stale pre-edit offset.
    const unsorted = remapPair(preText, [5, 5], [edits[1], edits[0]]);
    expect(unsorted.post.getText()).toBe('YY0123456789XXABCDEF');
    expect(unsorted.offsets).toEqual([5, 5]);
  });
});

describe('caret at the shared boundary of touching ranges', () => {
  test('boundary caret is absorbed into the left neighbor and the ranges stay separate', () => {
    // Two non-empty ranges touch at character 10 with a caret sitting exactly
    // on the seam. Non-empty touching ranges never merge with each other, but
    // the caret intersects both; it must be absorbed exactly once. Both
    // pierre-fe and the conventional behavior fold it into the LEFT range
    // (8-10): the caret's character equals the left range's end, and the
    // single merge pass reaches it while the left range is still current.
    const merged = mergeOverlappingSelections([
      sel(8, 10),
      caret(0, 10),
      sel(10, 12),
    ]);
    expect(merged).toEqual([
      // The caret was the latest of the merged pair, so direction is
      // re-derived from its side: the caret sits at the merged range's end,
      // making the result forward.
      sel(8, 10, DirectionForward),
      sel(10, 12, DirectionForward),
    ]);
  });

  test('absorbing the boundary caret overrides a backward left neighbor to forward', () => {
    // Same geometry with a backward 8-10 range. The caret is the later entry
    // in the merged pair, so its (recomputed) direction wins: the caret lands
    // at the merged end => forward. The conventional behavior derives the
    // same answer — the later range's anchor/head order decides, and a
    // cursor is never backward.
    const merged = mergeOverlappingSelections([
      sel(8, 10, DirectionBackward),
      caret(0, 10),
      sel(10, 12),
    ]);
    expect(merged).toEqual([
      sel(8, 10, DirectionForward),
      sel(10, 12, DirectionForward),
    ]);
  });
});

describe('normalization stress from scrambled input', () => {
  test('one range transitively swallows contained ranges while touching ranges stay separate', () => {
    // Eight shuffled ranges. 0-6 contains 3-4 and 4-5 outright; 6-7 touches
    // 0-6's end but is non-empty, so it stays separate (as do 7-8 and 13-14
    // against their neighbors). 9-13 contains 10-12. Five ranges survive:
    // {0-6, 6-7, 7-8, 9-13, 13-14} — the same set the conventional
    // normalization produces.
    const merged = mergeOverlappingSelections([
      sel(10, 12), // index 0: swallowed by 9-13
      sel(6, 7), //   index 1
      sel(4, 5), //   index 2: swallowed by 0-6
      sel(3, 4), //   index 3: swallowed by 0-6
      sel(0, 6), //   index 4
      sel(7, 8), //   index 5
      sel(9, 13), //  index 6
      sel(13, 14), // index 7
    ]);
    // DIVERGENCE: the conventional behavior returns ranges re-sorted by
    // position (0/6,6/7,7/8,9/13,13/14) and tracks the primary via a separate
    // index. pierre-fe's primary selection is "last element of the array",
    // so mergeOverlappingSelections restores the caller's original index
    // order instead, with each merged group keeping the LATEST participating
    // index: the 0-6 group keeps index 4, the 9-13 group keeps index 6.
    // Hence 6-7 (index 1) precedes 0-6 (index 4) in the output.
    expect(merged).toEqual([
      sel(6, 7),
      sel(0, 6),
      sel(7, 8),
      sel(9, 13),
      sel(13, 14),
    ]);
  });
});

describe('per-range replacements of different lengths on one line', () => {
  test('every later selection shifts by the cumulative length delta of preceding replacements', () => {
    // Four single-character selections on one line, each replaced by a
    // different-length string. Each replacement lands at its original offset
    // plus the summed growth of everything before it on the same line.
    const d = doc('a b c d');
    const selections = [sel(0, 1), sel(2, 3), sel(4, 5), sel(6, 7)];
    const texts = ['x', 'yy', 'zzz', 'wwww'];

    const { nextSelections } = applyTextReplaceToSelections(
      d,
      selections,
      texts
    );

    expect(d.getText()).toBe('x yy zzz wwww');

    // Cumulative deltas per slot: +0, +0, +1, +3. The conventional per-range
    // remap reports the spans 0-1 / 2-4 / 5-8 / 9-13; pierre-fe collapses
    // each result to a caret after the inserted text, i.e. at those spans'
    // ends.
    expect(nextSelections).toEqual([
      caret(0, 1),
      caret(0, 4),
      caret(0, 8),
      caret(0, 13),
    ]);
    // The caret offsets are exactly originalStart + cumulativeDelta + inserted
    // length.
    let delta = 0;
    for (let index = 0; index < selections.length; index++) {
      const start = selections[index].start.character;
      const inserted = texts[index].length;
      expect(nextSelections[index].end.character).toBe(
        start + delta + inserted
      );
      delta += inserted - 1; // each replacement consumed one character
    }
  });

  test('replacement texts stay paired with their selection when input is not in document order', () => {
    // Same replacement set handed over in reverse document order: texts must
    // travel with their selection, and results must come back in the caller's
    // input order (not sorted document order).
    const d = doc('a b c d');
    const { nextSelections } = applyTextReplaceToSelections(
      d,
      [sel(6, 7), sel(4, 5), sel(2, 3), sel(0, 1)],
      ['wwww', 'zzz', 'yy', 'x']
    );

    expect(d.getText()).toBe('x yy zzz wwww');
    expect(nextSelections).toEqual([
      caret(0, 13),
      caret(0, 8),
      caret(0, 4),
      caret(0, 1),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Public Editor.setSelections scenarios: these need the real Editor, mounted
// through the same File-backed harness the editorPublicApi suite uses.
// ---------------------------------------------------------------------------

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

interface EditorFixture {
  cleanup(): void;
  editor: Editor<undefined>;
}

async function createEditorFixture(contents: string): Promise<EditorFixture> {
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);

  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
  });
  const editor = new Editor<undefined>();
  const initialFile: FileContents = { name: 'selections.txt', contents };

  file.render({ file: initialFile, fileContainer, forceRender: true });
  editor.edit(file);
  await waitForEditableContent(fileContainer);

  return {
    cleanup() {
      editor.cleanUp();
      file.cleanUp();
      dom.cleanup();
    },
    editor,
  };
}

describe('Editor.setSelections position clamping', () => {
  test('positions past a line length or past the last line clamp instead of throwing', async () => {
    // DIVERGENCE: a stricter contract would reject out-of-range selections
    // with a RangeError; pierre-fe's setSelections routes every position
    // through TextDocument.normalizePosition, clamping line to the last line
    // and character to that line's length. Out-of-bounds input is accepted
    // and the caret lands on real content.
    const { cleanup, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );
    try {
      // Character overshoots line 1 ("bravo", length 5): clamps to the line
      // end, keeping the line.
      editor.setSelections([
        {
          start: { line: 1, character: 99 },
          end: { line: 1, character: 99 },
          direction: 'none',
        },
      ]);
      expect(editor.getState().selections).toEqual([caret(1, 5)]);

      // Both line and character overshoot: the primary caret lands exactly at
      // the document end ("charlie" is line 2, length 7).
      editor.setSelections([
        {
          start: { line: 99, character: 99 },
          end: { line: 99, character: 99 },
          direction: 'none',
        },
      ]);
      expect(editor.getState().selections).toEqual([caret(2, 7)]);
    } finally {
      cleanup();
    }
  });

  test('a range whose end overshoots the document clamps only the overshooting edge', async () => {
    const { cleanup, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );
    try {
      editor.setSelections([
        {
          start: { line: 0, character: 2 },
          end: { line: 99, character: 99 },
          direction: 'forward',
        },
      ]);
      // The valid start edge is untouched; the end edge clamps to doc end and
      // the direction survives.
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 0, character: 2 },
          end: { line: 2, character: 7 },
          direction: DirectionForward,
        },
      ]);
    } finally {
      cleanup();
    }
  });
});

describe('Editor.setSelections with a reversed range', () => {
  test('a start-after-end selection is stored with ordered edges and backward direction', async () => {
    const { cleanup, editor } = await createEditorFixture(
      'alpha\nbravo\ncharlie'
    );
    try {
      editor.setSelections([
        {
          start: { line: 1, character: 3 },
          end: { line: 0, character: 2 },
          direction: 'forward',
        },
      ]);
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 0, character: 2 },
          end: { line: 1, character: 3 },
          direction: DirectionBackward,
        },
      ]);
    } finally {
      cleanup();
    }
  });
});

// Splices `edits` (pre-edit offsets, sorted ascending, non-overlapping) into
// `text` at the string level. The seeded sweep below cross-checks this against
// the real applyEdits path on every random case, so the fixed fixtures can use
// it directly without losing honesty.
function spliceString(text: string, edits: readonly ResolvedTextEdit[]) {
  let result = '';
  let consumed = 0;
  for (const edit of edits) {
    result += text.slice(consumed, edit.start) + edit.text;
    consumed = edit.end;
  }
  return result + text.slice(consumed);
}

// Remaps one single-line selection, given as pre-edit offsets, through `edits`
// and reports the post-edit offsets plus the re-derived direction.
function remapRange(
  preText: string,
  selStart: number,
  selEnd: number,
  direction: SelectionDirection,
  edits: readonly ResolvedTextEdit[]
) {
  const pre = doc(preText);
  const postText = spliceString(preText, edits);
  const post = doc(postText);
  const selection: EditorSelection = {
    start: pre.positionAt(selStart),
    end: pre.positionAt(selEnd),
    direction,
  };
  const [next] = remapSelectionsAfterEdits(
    post,
    [selection],
    [[selStart, selEnd]],
    edits
  );
  return {
    post,
    postText,
    start: post.offsetAt(next.start),
    end: post.offsetAt(next.end),
    direction: next.direction,
  };
}

// remapOffsetThroughEdits is module-private, so single offsets travel through
// remapSelectionsAfterEdits as a collapsed selection. The input selection's
// positions are never read by the remap (only its direction is), so a dummy
// caret suffices; `target` must already reflect `edits`.
function mapOffset(
  target: TextDocument<unknown>,
  offset: number,
  edits: readonly ResolvedTextEdit[]
): number {
  const probe: EditorSelection = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
    direction: DirectionNone,
  };
  const [mapped] = remapSelectionsAfterEdits(
    target,
    [probe],
    [[offset, offset]],
    edits
  );
  return target.offsetAt(mapped.start);
}

// Deterministic 32-bit PRNG (mulberry32) so the seeded sweep is reproducible.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

describe('replacement overlapping one selection edge', () => {
  test('start-edge overlap clips the selection start to the replacement end and shifts the end by the delta', () => {
    // 'thicket' [8,15) is selected; the replacement covers 'r th' [6,10) —
    // text before the selection plus its first two letters — and is one
    // character shorter than what it removed. The conventional default
    // marker bias and pierre's right gravity agree here: the start lands
    // right after the new text and the end just absorbs the -1 length delta.
    const preText = 'juniper thicket';
    const edits: ResolvedTextEdit[] = [{ start: 6, end: 10, text: 'y w' }];

    const forward = remapRange(preText, 8, 15, DirectionForward, edits);
    expect(forward.postText).toBe('junipey wicket');
    expect([forward.start, forward.end]).toEqual([9, 14]);
    // Only the un-replaced tail of the original word stays selected.
    expect(forward.post.getTextSlice(9, 14)).toBe('icket');
    expect(forward.direction).toBe(DirectionForward);

    const backward = remapRange(preText, 8, 15, DirectionBackward, edits);
    expect([backward.start, backward.end]).toEqual([9, 14]);
    expect(backward.direction).toBe(DirectionBackward);
  });

  test('end-edge overlap keeps the selection start and carries the end to the end of the new text', () => {
    // 'lantern' [7,14) is selected; the replacement covers 'rn g' [12,16) —
    // the word's last two letters plus text after it — and is one character
    // longer. The start edge sits strictly before the edit so it never moves;
    // the end edge rides to the end of the replacement, so the selection
    // absorbs ALL of the new text (also the conventional default bias).
    const preText = 'harbor lantern glow';
    const edits: ResolvedTextEdit[] = [{ start: 12, end: 16, text: '&&&&&' }];

    const forward = remapRange(preText, 7, 14, DirectionForward, edits);
    expect(forward.postText).toBe('harbor lante&&&&&low');
    expect([forward.start, forward.end]).toEqual([7, 17]);
    expect(forward.post.getTextSlice(7, 17)).toBe('lante&&&&&');
    expect(forward.direction).toBe(DirectionForward);

    const backward = remapRange(preText, 7, 14, DirectionBackward, edits);
    expect([backward.start, backward.end]).toEqual([7, 17]);
    expect(backward.direction).toBe(DirectionBackward);
  });
});

describe('replacement surrounding the whole selection', () => {
  test('a surrounding replacement collapses the selection to a caret after the new text and resets direction', () => {
    // 'two' [4,7) is selected; the replacement ' two t' [3,9) swallows the
    // selection on both sides. Both edges collapse to the offset just past the
    // replacement text ('#' occupies [3,4), caret at 4), and because
    // createSelectionFromAnchorAndFocusOffsets re-derives direction from the
    // remapped offsets, a stale forward/backward direction cannot survive on
    // the zero-length result — probed: it really does come back DirectionNone.
    const preText = 'one two three';
    const edits: ResolvedTextEdit[] = [{ start: 3, end: 9, text: '#' }];

    const forward = remapRange(preText, 4, 7, DirectionForward, edits);
    expect(forward.postText).toBe('one#hree');
    expect([forward.start, forward.end]).toEqual([4, 4]);
    expect(forward.direction).toBe(DirectionNone);

    const backward = remapRange(preText, 4, 7, DirectionBackward, edits);
    expect([backward.start, backward.end]).toEqual([4, 4]);
    expect(backward.direction).toBe(DirectionNone);
  });
});

describe('replacement anchored at the selection start', () => {
  test('a contained replacement starting exactly at the selection start shrinks the selection to the un-replaced tail', () => {
    // DIVERGENCE: the conventional default marker bias treats a change that
    // begins exactly at a tailed marker's start as INSIDE the marker — the
    // start stays anchored and the range absorbs the new text (here [7,12)
    // would grow to [7,13)). pierre's uniform right gravity pushes any offset
    // at or inside an edit past the replacement, so the selection start lands
    // after the new text and only the un-replaced tail stays selected — the
    // exact shape that convention reserves for its 'inside'-strategy markers.
    // Coherent policy, pinned here.
    const preText = 'silver maple grove';
    // 'maple' [7,12) selected; 'ma' [7,9) replaced by three characters.
    const edits: ResolvedTextEdit[] = [{ start: 7, end: 9, text: 'STE' }];

    const forward = remapRange(preText, 7, 12, DirectionForward, edits);
    expect(forward.postText).toBe('silver STEple grove');
    expect([forward.start, forward.end]).toEqual([10, 13]);
    expect(forward.post.getTextSlice(10, 13)).toBe('ple');
    expect(forward.direction).toBe(DirectionForward);

    const backward = remapRange(preText, 7, 12, DirectionBackward, edits);
    expect([backward.start, backward.end]).toEqual([10, 13]);
    expect(backward.direction).toBe(DirectionBackward);
  });
});

describe('seeded sweep against a splice reference model', () => {
  test('200 seeded single-edit remaps match the right-gravity reference model', () => {
    // Reference model for one edit, applied independently to each endpoint:
    //   strictly before the edit -> unchanged
    //   at or after the edit end -> shifted by the net length delta
    //   otherwise (inside)       -> the offset just past the replacement text
    // An endpoint EXACTLY at the edit start is the one genuinely
    // bias-ambiguous spot (the conventional anchoring keeps it in place,
    // pierre pushes it past the new text — see the anchored-start test
    // above), so the generator nudges endpoints off that offset and the
    // model stays unambiguous. An endpoint exactly at the edit END is not
    // ambiguous: the shift branch and the inside branch produce the same
    // offset there.
    const random = seededRandom(0xa70b1a5);
    const randomInt = (bound: number) => Math.floor(random() * bound);
    const lower = () => String.fromCharCode(97 + randomInt(26));
    const upper = () => String.fromCharCode(65 + randomInt(26));

    const problems: string[] = [];
    for (let round = 0; round < 200; round++) {
      const length = 8 + randomInt(25);
      let preText = '';
      for (let i = 0; i < length; i++) {
        preText += lower();
      }

      const editStart = randomInt(length + 1);
      const editEnd = editStart + randomInt(length - editStart + 1);
      let newText = '';
      const newLength = randomInt(7);
      for (let i = 0; i < newLength; i++) {
        newText += upper();
      }
      const edit: ResolvedTextEdit = {
        start: editStart,
        end: editEnd,
        text: newText,
      };
      const delta = newText.length - (editEnd - editStart);

      const nudge = (offset: number) =>
        offset === editStart
          ? offset === length
            ? offset - 1
            : offset + 1
          : offset;
      const a = nudge(randomInt(length + 1));
      const b = nudge(randomInt(length + 1));
      const selStart = Math.min(a, b);
      const selEnd = Math.max(a, b);
      const direction: SelectionDirection =
        selStart === selEnd
          ? DirectionNone
          : random() < 0.5
            ? DirectionForward
            : DirectionBackward;

      const refMap = (offset: number) =>
        offset < editStart
          ? offset
          : offset >= editEnd
            ? offset + delta
            : editStart + newText.length;
      const wantStart = refMap(selStart);
      const wantEnd = refMap(selEnd);
      const wantDirection = wantStart === wantEnd ? DirectionNone : direction;

      const pre = doc(preText);
      const post = doc(preText);
      post.applyEdits([
        {
          range: {
            start: pre.positionAt(editStart),
            end: pre.positionAt(editEnd),
          },
          newText,
        },
      ]);
      const spliced =
        preText.slice(0, editStart) + newText + preText.slice(editEnd);
      if (post.getText() !== spliced) {
        problems.push(
          `#${round}: applyEdits produced '${post.getText()}', splice reference '${spliced}'`
        );
        continue;
      }

      const selection: EditorSelection = {
        start: pre.positionAt(selStart),
        end: pre.positionAt(selEnd),
        direction,
      };
      const [next] = remapSelectionsAfterEdits(
        post,
        [selection],
        [[selStart, selEnd]],
        [edit]
      );
      const gotStart = post.offsetAt(next.start);
      const gotEnd = post.offsetAt(next.end);
      const label = `#${round} text='${preText}' edit=[${editStart},${editEnd})->'${newText}' sel=[${selStart},${selEnd}] dir=${direction}`;
      if (gotStart > gotEnd || gotStart < 0 || gotEnd > spliced.length) {
        problems.push(
          `${label}: out-of-order or out-of-bounds result [${gotStart},${gotEnd}]`
        );
      }
      if (gotStart !== wantStart || gotEnd !== wantEnd) {
        problems.push(
          `${label}: remapped to [${gotStart},${gotEnd}], reference [${wantStart},${wantEnd}]`
        );
      }
      if (next.direction !== wantDirection) {
        problems.push(
          `${label}: direction ${next.direction}, reference ${wantDirection}`
        );
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('bidirectional round-trip through history inverse edits', () => {
  // Three hunks with unequal old/new lengths: a growing replacement, a pure
  // insertion, and a shrinking replacement that crosses a line break.
  const baseText = 'cedar\nbirch\noak\nwillow';
  const hunks: ResolvedTextEdit[] = [
    { start: 1, end: 4, text: 'OPPER' }, // 'eda' -> 'OPPER' (+2)
    { start: 8, end: 8, text: '-tree' }, // insertion (+5)
    { start: 12, end: 20, text: 'elm' }, // 'oak\nwill' -> 'elm' (-5)
  ];

  // Applies the batch through the history-tracked path with an injected
  // EditStack, so the inverse edits come from the real undo entry rather than
  // being hand-built. The entry's inverseEdits are expressed in POST-edit
  // offsets, which is exactly the coordinate space the return leg needs.
  function buildHistoryEntry() {
    const stack = new EditStack<unknown>();
    const post = new TextDocument<unknown>(
      'inmemory://1',
      baseText,
      'plain',
      0,
      stack
    );
    post.applyResolvedEdits(hunks, true);
    const entry = stack.peekUndo();
    if (entry === undefined) {
      throw new Error('expected a history entry after the tracked batch');
    }
    return { post, entry };
  }

  test('offsets outside every hunk round-trip exactly through forward then inverse edits', () => {
    const { post, entry } = buildHistoryEntry();
    const preDoc = doc(baseText);
    expect(post.getText()).toBe('cOPPERr\nbi-treerch\nelmow');
    expect(entry.inverseEdits).toEqual([
      { start: 1, end: 6, text: 'eda' },
      { start: 10, end: 15, text: '' },
      { start: 19, end: 22, text: 'oak\nwill' },
    ]);

    // "Outside" means before a hunk's start or at/after its end. That includes
    // the zero-width insertion hunk's own offset 8: right gravity pushes it
    // past '-tree' on the way forward and the inverse deletion pulls it back.
    expect(mapOffset(post, 8, entry.forwardEdits)).toBe(15);

    const outside = [0, 4, 5, 6, 7, 8, 9, 10, 11, 20, 21, 22];
    const trips = outside.map((offset) => {
      const mapped = mapOffset(post, offset, entry.forwardEdits);
      return mapOffset(preDoc, mapped, entry.inverseEdits);
    });
    expect(trips).toEqual(outside);
  });

  test('offsets inside a replaced hunk clamp to the hunk trailing edge instead of round-tripping', () => {
    // Interior offsets are lossy by construction — the text they addressed is
    // gone. Forward they collapse to the end of that hunk's replacement text;
    // the return leg then clamps to the hunk's PRE-edit end offset, never
    // resurrecting the original interior position. The conventional patch
    // translation is likewise lossy inside a change, clamping to the change's
    // boundary.
    const { post, entry } = buildHistoryEntry();
    const preDoc = doc(baseText);

    const insideFirstHunk = [1, 2, 3].map((offset) =>
      mapOffset(post, offset, entry.forwardEdits)
    );
    expect(insideFirstHunk).toEqual([6, 6, 6]); // just past 'OPPER'
    const insideLastHunk = [12, 15, 19].map((offset) =>
      mapOffset(post, offset, entry.forwardEdits)
    );
    expect(insideLastHunk).toEqual([22, 22, 22]); // just past 'elm'

    expect(mapOffset(preDoc, 6, entry.inverseEdits)).toBe(4); // hunk 1 pre-edit end
    expect(mapOffset(preDoc, 22, entry.inverseEdits)).toBe(20); // hunk 3 pre-edit end
  });
});

describe('delete word backward at whitespace and newline boundaries', () => {
  test('after a single leading space it deletes only the line-local space', () => {
    // The scan is strictly per-line: even though only one space separates the
    // caret from column 0, the delete stops at the line start instead of
    // crossing the break into the previous line's word.
    const d = doc('apex \n mono');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(1, 1),
    ]);
    expect(d.getText()).toBe('apex \nmono');
    expect(nextSelections).toEqual([caret(1, 0)]);
  });

  test('after a multi-space leading run it deletes the run and stops at column 0', () => {
    const d = doc('gate\n   crux');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(1, 3),
    ]);
    expect(d.getText()).toBe('gate\ncrux');
    expect(nextSelections).toEqual([caret(1, 0)]);
  });

  test('at column 0 it deletes exactly the break and keeps the trailing space above', () => {
    // Joining consumes only the newline: the previous line's trailing space
    // survives byte-for-byte and the caret lands after it.
    const d = doc('apex \nmono');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(1, 0),
    ]);
    expect(d.getText()).toBe('apex mono');
    expect(nextSelections).toEqual([caret(0, 5)]);
  });
});

describe('delete word backward character groups', () => {
  test('a multi-character punctuation run deletes as one group', () => {
    const d = doc('stop...halt');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 7),
    ]);
    expect(d.getText()).toBe('stophalt');
    expect(nextSelections).toEqual([caret(0, 4)]);
  });

  test('a mixed space-and-tab run deletes as one whitespace group', () => {
    // ' \t ' is heterogeneous whitespace; the category loop must treat spaces
    // and tabs as the same group and stop at the word character before them.
    const d = doc('left \t right');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 7),
    ]);
    expect(d.getText()).toBe('leftright');
    expect(nextSelections).toEqual([caret(0, 4)]);
  });

  test('digits and underscore are word characters, so an identifier deletes whole', () => {
    const d = doc('v = net_port2');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 13),
    ]);
    expect(d.getText()).toBe('v = ');
    expect(nextSelections).toEqual([caret(0, 4)]);
  });

  test("'<' and '/' share the punctuation category and delete as one run", () => {
    const d = doc('tag</');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 5),
    ]);
    expect(d.getText()).toBe('tag');
    expect(nextSelections).toEqual([caret(0, 3)]);
  });

  test('a lone slash between words deletes alone, not with the word before it', () => {
    // Punctuation is its own category: the group ends where the word
    // characters start, so only the '/' goes.
    const d = doc('up/down');
    const { nextSelections } = applyDeleteWordBackwardToSelections(d, [
      caret(0, 3),
    ]);
    expect(d.getText()).toBe('updown');
    expect(nextSelections).toEqual([caret(0, 2)]);
  });

  // Intl.Segmenter's isWordLike classification varies across ICU builds
  // (underscore joining and bare-digit word-ness differ between engines and
  // platforms). Gate the segmenter-side pin on the runtime agreeing with the
  // UAX #29 behavior our dev and CI environments ship, so a divergent ICU
  // skips visibly instead of going red.
  const segmenterJoinsIdentifier = [
    ...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(
      'v = net_port2;'
    ),
  ].some((seg) => seg.segment === 'net_port2' && seg.isWordLike === true);

  test.skipIf(!segmenterJoinsIdentifier)(
    'double-click word expansion agrees the identifier is one word',
    () => {
      // Pierre-fe encodes word-ness twice: the delete-word regex
      // (\p{Alphabetic}|\p{Number}|_) and Intl.Segmenter's isWordLike in
      // expandCollapsedSelectionToWord. On CJK text those two disagree
      // (pinned as DIVERGENCE in the CJK word-delete tests above in this
      // file); on ASCII identifiers they agree — UAX #29 joins letters,
      // digits, and underscore (ExtendNumLet) into a single word segment —
      // so this pins the consistent half of the dual definition.
      const d = doc('v = net_port2;');
      const expected: EditorSelection = {
        start: { line: 0, character: 4 },
        end: { line: 0, character: 13 },
        direction: DirectionForward,
      };
      expect(expandCollapsedSelectionToWord(d, caret(0, 4))).toEqual(expected);
      expect(expandCollapsedSelectionToWord(d, caret(0, 9))).toEqual(expected);
      expect(expandCollapsedSelectionToWord(d, caret(0, 13))).toEqual(expected);
    }
  );
});
