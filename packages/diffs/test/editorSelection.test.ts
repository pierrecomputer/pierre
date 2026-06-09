import { describe, expect, test } from 'bun:test';

import {
  applyDeleteHardLineForwardToSelections,
  applyDeleteSoftLineBackwardToSelections,
  applyDeleteWordBackwardToSelections,
  applyTextChangeToSelections,
  applyTextReplaceToSelections,
  applyTransposeToSelections,
  convertSelection,
  createSelectionFrom,
  DirectionForward,
  DirectionNone,
  type EditorSelection,
  expandCollapsedSelectionToWord,
  extendSelection,
  findNexMatch,
  getCaretPosition,
  getSelectionAnchor,
  mapCursorMove,
  mapSelectionShift,
  mergeOverlappingSelections,
  resolveIndentEdits,
  selectionIntersects,
} from '../src/editor/selection';
import {
  DirectionBackward,
  type SelectionDirection,
} from '../src/editor/selection';
import { TextDocument } from '../src/editor/textDocument';

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
  test('drops earlier overlapping ranges and keeps later selections', () => {
    expect(
      mergeOverlappingSelections([
        createSelection(2, 0, 2, 4, DirectionForward),
        createSelection(0, 6, 0, 8, DirectionForward),
        createSelection(0, 2, 0, 7, DirectionForward),
      ])
    ).toEqual([
      createSelection(2, 0, 2, 4, DirectionForward),
      createSelection(0, 2, 0, 7, DirectionForward),
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

  test('drops a range when a later caret overlaps its boundary', () => {
    expect(
      mergeOverlappingSelections([
        createSelection(0, 2, 0, 6, DirectionForward),
        createSelection(0, 6, 0, 6, DirectionNone),
      ])
    ).toEqual([createSelection(0, 6, 0, 6, DirectionNone)]);
  });

  test('drops an earlier range when a later overlapping range extends it', () => {
    expect(
      mergeOverlappingSelections([
        createSelection(1, 2, 3, 0, DirectionForward),
        createSelection(2, 0, 3, 0, DirectionForward),
      ])
    ).toEqual([createSelection(2, 0, 3, 0, DirectionForward)]);
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
    expect(findNexMatch(doc, [])).toBeUndefined();
  });

  test('ignores non-collapsed selections with different text', () => {
    const doc = new TextDocument('inmemory://x', 'aa bb');
    const selections: EditorSelection[] = [
      createSelection(0, 0, 0, 2),
      createSelection(0, 3, 0, 5),
    ];
    expect(findNexMatch(doc, selections)).toBeUndefined();
  });

  test('expands a collapsed caret to the surrounding word', () => {
    const doc = new TextDocument('inmemory://x', "'foobar'");
    const caret = createSelection(0, 4, 0, 4);
    const next = findNexMatch(doc, [caret]);
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
    const afterFirst = findNexMatch(doc, [first]);
    expect(afterFirst).toEqual([
      first,
      {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 9 },
        direction: DirectionForward,
      },
    ]);
    expect(findNexMatch(doc, afterFirst!)).toBeUndefined();
  });

  test('wraps to an earlier occurrence after the last match in the file', () => {
    const doc = new TextDocument('inmemory://x', 'foo bar foo');
    const secondFoo = createSelection(0, 8, 0, 11);
    const wrapped = findNexMatch(doc, [secondFoo]);
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
    const third = findNexMatch(doc, two);
    expect(third?.length).toBe(3);
    expect(third?.[2]).toEqual({
      start: { line: 0, character: 6 },
      end: { line: 0, character: 8 },
      direction: DirectionForward,
    });
  });
});
