import { describe, expect, test } from 'bun:test';

import { InteractionManager } from '../src/managers/InteractionManager';
import type { SelectedLineRange } from '../src/types';
import { installDom } from './domHarness';

interface FilePreFixture {
  contentRows: HTMLDivElement[];
  gutterRows: HTMLDivElement[];
  pre: HTMLPreElement;
}

function createFilePre(lineCount: number): FilePreFixture {
  const pre = document.createElement('pre');
  const code = document.createElement('div');
  const gutter = document.createElement('div');
  const content = document.createElement('div');
  const gutterRows: HTMLDivElement[] = [];
  const contentRows: HTMLDivElement[] = [];

  code.setAttribute('data-code', '');
  gutter.setAttribute('data-gutter', '');
  content.setAttribute('data-content', '');

  for (let index = 0; index < lineCount; index += 1) {
    const lineNumber = index + 1;
    const gutterRow = document.createElement('div');
    gutterRow.setAttribute('data-column-number', `${lineNumber}`);
    gutterRow.setAttribute('data-line-index', `${index}`);
    gutterRow.setAttribute('data-line-type', 'context');
    gutterRows.push(gutterRow);
    gutter.appendChild(gutterRow);

    const contentRow = document.createElement('div');
    contentRow.setAttribute('data-line', `${lineNumber}`);
    contentRow.setAttribute('data-line-index', `${index}`);
    contentRow.setAttribute('data-line-type', 'context');
    contentRow.textContent = `line ${lineNumber}`;
    contentRows.push(contentRow);
    content.appendChild(contentRow);
  }

  code.append(gutter, content);
  pre.appendChild(code);
  document.body.appendChild(pre);

  return { contentRows, gutterRows, pre };
}

function prependLineZeroRow(fixture: FilePreFixture): void {
  const code = fixture.pre.querySelector('[data-code]');
  const gutter = fixture.pre.querySelector('[data-gutter]');
  const content = fixture.pre.querySelector('[data-content]');
  if (!(code instanceof HTMLDivElement)) {
    throw new Error('missing code element');
  }
  if (!(gutter instanceof HTMLDivElement)) {
    throw new Error('missing gutter element');
  }
  if (!(content instanceof HTMLDivElement)) {
    throw new Error('missing content element');
  }

  const gutterRow = document.createElement('div');
  gutterRow.setAttribute('data-column-number', '0');
  gutterRow.setAttribute('data-line-index', '-1');
  gutterRow.setAttribute('data-line-type', 'context');

  const contentRow = document.createElement('div');
  contentRow.setAttribute('data-line', '0');
  contentRow.setAttribute('data-line-index', '-1');
  contentRow.setAttribute('data-line-type', 'context');
  contentRow.textContent = 'line 0';

  gutter.prepend(gutterRow);
  content.prepend(contentRow);
}

function createAnnotationRowAfter(
  fixture: FilePreFixture,
  lineIndex: number
): { content: HTMLDivElement; gutter: HTMLDivElement } {
  const gutterRow = fixture.gutterRows[lineIndex];
  const contentRow = fixture.contentRows[lineIndex];
  if (gutterRow == null || contentRow == null) {
    throw new Error('missing annotation owner row');
  }

  const gutterAnnotation = document.createElement('div');
  gutterAnnotation.setAttribute('data-gutter-buffer', 'annotation');
  gutterAnnotation.setAttribute('data-buffer-size', '1');

  const contentAnnotation = document.createElement('div');
  contentAnnotation.setAttribute('data-line-annotation', `0,${lineIndex}`);
  const annotationContent = document.createElement('div');
  annotationContent.setAttribute('data-annotation-content', '');
  contentAnnotation.appendChild(annotationContent);

  gutterRow.after(gutterAnnotation);
  contentRow.after(contentAnnotation);

  return { content: annotationContent, gutter: gutterAnnotation };
}

function dispatchPointer(
  target: EventTarget,
  type: string,
  init: PointerEventInit = {}
): PointerEvent {
  const event = new window.PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function getUtilityButton(row: HTMLElement): HTMLButtonElement {
  const button = row.querySelector('[data-utility-button]');
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('missing gutter utility button');
  }
  return button;
}

function isSelected(row: HTMLElement): boolean {
  return row.hasAttribute('data-selected-line');
}

describe('InteractionManager editor active-line state', () => {
  test('keeps editor active-line writes out of selected lines and gutter utility state', () => {
    const { cleanup } = installDom();
    const committedRanges: (SelectedLineRange | null)[] = [];
    const manager = new InteractionManager('file', {
      enableGutterUtility: true,
      onLineSelected: (range) => committedRanges.push(range),
    });
    try {
      const { contentRows, gutterRows, pre } = createFilePre(4);
      manager.setup(pre);
      manager.setSelection({ start: 1, end: 2 });
      committedRanges.length = 0;

      manager.setEditorActiveLine(4, { side: 'additions' });

      expect(manager.getSelection()).toEqual({ start: 1, end: 2 });
      expect(committedRanges).toEqual([]);
      expect(isSelected(contentRows[0])).toBe(true);
      expect(isSelected(contentRows[1])).toBe(true);
      expect(isSelected(contentRows[3])).toBe(false);
      expect(
        gutterRows[1].querySelector('[data-gutter-utility-slot]')
      ).not.toBe(null);

      manager.setSelection(null, { notify: false });

      expect(manager.getSelection()).toBe(null);
      expect(isSelected(contentRows[0])).toBe(false);
      expect(isSelected(contentRows[1])).toBe(false);
      expect(isSelected(contentRows[3])).toBe(true);
      expect(pre.querySelector('[data-gutter-utility-slot]')).toBe(null);
    } finally {
      manager.cleanUp();
      cleanup();
    }
  });

  test('invalidates equal ranges when the render source or style changes', () => {
    const { cleanup } = installDom();
    const manager = new InteractionManager('file', {});
    try {
      const { contentRows, gutterRows, pre } = createFilePre(3);
      manager.setup(pre);
      manager.setEditorAttached(true);

      manager.setEditorActiveLine(2, { side: 'additions' });
      expect(isSelected(contentRows[1])).toBe(true);

      manager.setEditorActiveLine(2, {
        lineNumberOnly: true,
        side: 'additions',
      });
      expect(isSelected(gutterRows[1])).toBe(true);
      expect(isSelected(contentRows[1])).toBe(false);

      manager.setEditorActiveLine(2, { side: 'additions' });
      expect(isSelected(contentRows[1])).toBe(true);

      manager.setSelection({ start: 2, end: 2 }, { notify: false });
      expect(isSelected(gutterRows[1])).toBe(true);
      expect(isSelected(contentRows[1])).toBe(false);

      manager.setSelection(null, { notify: false });
      expect(isSelected(contentRows[1])).toBe(true);
    } finally {
      manager.cleanUp();
      cleanup();
    }
  });

  test('changes selected-line rendering when the editor attaches', () => {
    const { cleanup } = installDom();
    const manager = new InteractionManager('file', {});
    try {
      const { contentRows, gutterRows, pre } = createFilePre(3);
      manager.setup(pre);
      manager.setSelection({ start: 2, end: 2 }, { notify: false });

      expect(isSelected(gutterRows[1])).toBe(true);
      expect(isSelected(contentRows[1])).toBe(true);

      manager.setEditorAttached(true);
      expect(isSelected(gutterRows[1])).toBe(true);
      expect(isSelected(contentRows[1])).toBe(false);

      manager.setEditorAttached(false);
      expect(isSelected(gutterRows[1])).toBe(true);
      expect(isSelected(contentRows[1])).toBe(true);
    } finally {
      manager.cleanUp();
      cleanup();
    }
  });

  test('preserves a controlled gutter gesture across editor writes', () => {
    const { cleanup } = installDom();
    const events: Array<[string, SelectedLineRange | null]> = [];
    const manager = new InteractionManager('file', {
      controlledSelection: true,
      enableGutterUtility: true,
      enableLineSelection: true,
      onLineSelected: (range) => {
        events.push(['committed', range]);
        manager.setSelection(range, { notify: false });
      },
      onLineSelectionEnd: (range) => events.push(['end', range]),
      onLineSelectionStart: (range) => events.push(['start', range]),
    });
    try {
      const { contentRows, gutterRows, pre } = createFilePre(4);
      manager.setup(pre);
      manager.setSelection({ start: 1, end: 1 }, { notify: false });

      dispatchPointer(gutterRows[2], 'pointerdown', {
        pointerId: 13,
        pointerType: 'mouse',
      });
      manager.setEditorActiveLine(4, { side: 'additions' });
      dispatchPointer(document, 'pointerup', {
        pointerId: 13,
        pointerType: 'mouse',
      });

      const selectedLine = { start: 3, end: 3 };
      expect(events).toEqual([
        ['start', selectedLine],
        ['end', selectedLine],
        ['committed', selectedLine],
      ]);
      expect(manager.getSelection()).toEqual(selectedLine);
      expect(isSelected(contentRows[2])).toBe(true);
      expect(
        gutterRows[2].querySelector('[data-gutter-utility-slot]')
      ).not.toBe(null);

      manager.setSelection(null, { notify: false });
      expect(isSelected(contentRows[3])).toBe(true);
    } finally {
      manager.cleanUp();
      cleanup();
    }
  });
});

describe('InteractionManager gutter utility', () => {
  test('does not reveal the gutter utility while touch dragging from content', () => {
    const { cleanup } = installDom();
    const manager = new InteractionManager('file', {
      enableGutterUtility: true,
    });
    try {
      const { contentRows, pre } = createFilePre(3);
      manager.setup(pre);

      dispatchPointer(contentRows[1], 'pointerdown', { pointerType: 'touch' });
      dispatchPointer(contentRows[1], 'pointermove', { pointerType: 'touch' });

      expect(pre.querySelector('[data-gutter-utility-slot]')).toBe(null);
      expect(manager.getHoveredLine()).toBe(undefined);
    } finally {
      manager.cleanUp();
      cleanup();
    }
  });

  test('reveals the gutter utility after a touch tap on a gutter row', () => {
    const { cleanup } = installDom();
    const manager = new InteractionManager('file', {
      enableGutterUtility: true,
    });
    try {
      const { gutterRows, pre } = createFilePre(3);
      manager.setup(pre);

      dispatchPointer(gutterRows[2], 'pointerdown', { pointerType: 'touch' });

      expect(
        gutterRows[2].querySelector('[data-gutter-utility-slot]')
      ).not.toBe(null);
      expect(manager.getHoveredLine()).toEqual({ lineNumber: 3 });
    } finally {
      manager.cleanUp();
      cleanup();
    }
  });

  test('does not reveal the gutter utility from mouse down alone', () => {
    const { cleanup } = installDom();
    const manager = new InteractionManager('file', {
      enableGutterUtility: true,
    });
    try {
      const { contentRows, pre } = createFilePre(3);
      manager.setup(pre);

      dispatchPointer(contentRows[1], 'pointerdown', { pointerType: 'mouse' });

      expect(pre.querySelector('[data-gutter-utility-slot]')).toBe(null);
      expect(manager.getHoveredLine()).toBe(undefined);
    } finally {
      manager.cleanUp();
      cleanup();
    }
  });

  test('anchors selected gutter utility to the bottom-most selected row', () => {
    const { cleanup } = installDom();
    const manager = new InteractionManager('file', {
      enableGutterUtility: true,
    });
    try {
      const { gutterRows, pre } = createFilePre(4);
      manager.setup(pre);

      manager.setSelection({ start: 3, end: 1 });

      expect(
        gutterRows[2].querySelector('[data-gutter-utility-slot]')
      ).not.toBe(null);
      expect(manager.getHoveredLine()).toEqual({ lineNumber: 3 });
    } finally {
      manager.cleanUp();
      cleanup();
    }
  });

  test('pressing the selected gutter utility uses the whole selection', () => {
    const { cleanup } = installDom();
    const clickedRanges: SelectedLineRange[] = [];
    const manager = new InteractionManager('file', {
      enableGutterUtility: true,
      onGutterUtilityClick: (range) => clickedRanges.push(range),
    });
    try {
      const { gutterRows, pre } = createFilePre(4);
      manager.setup(pre);
      manager.setSelection({ start: 3, end: 1 });
      const button = getUtilityButton(gutterRows[2]);

      dispatchPointer(button, 'pointerdown', {
        pointerId: 7,
        pointerType: 'touch',
      });
      dispatchPointer(button, 'pointerup', {
        pointerId: 7,
        pointerType: 'touch',
      });

      expect(clickedRanges).toEqual([{ start: 1, end: 3 }]);
    } finally {
      manager.cleanUp();
      cleanup();
    }
  });

  test('dragging the selected gutter utility extends selection on touch', () => {
    const { cleanup, setElementFromPoint } = installDom();
    const clickedRanges: SelectedLineRange[] = [];
    const manager = new InteractionManager('file', {
      enableGutterUtility: true,
      enableLineSelection: true,
      onGutterUtilityClick: (range) => clickedRanges.push(range),
    });
    try {
      const { gutterRows, pre } = createFilePre(4);
      manager.setup(pre);
      manager.setSelection({ start: 1, end: 2 });
      const button = getUtilityButton(gutterRows[1]);
      setElementFromPoint(8, 80, gutterRows[3]);

      const pointerDown = dispatchPointer(button, 'pointerdown', {
        clientX: 8,
        clientY: 40,
        pointerId: 9,
        pointerType: 'touch',
      });
      const pointerMove = dispatchPointer(button, 'pointermove', {
        clientX: 8,
        clientY: 80,
        pointerId: 9,
        pointerType: 'touch',
      });
      dispatchPointer(button, 'pointerup', {
        clientX: 8,
        clientY: 80,
        pointerId: 9,
        pointerType: 'touch',
      });

      expect(pointerDown.defaultPrevented).toBe(true);
      expect(pointerMove.defaultPrevented).toBe(true);
      expect(manager.getSelection()).toEqual({ start: 1, end: 4 });
      expect(clickedRanges).toEqual([{ start: 1, end: 4 }]);
      expect(
        gutterRows[3].querySelector('[data-gutter-utility-slot]')
      ).not.toBe(null);
    } finally {
      manager.cleanUp();
      cleanup();
    }
  });

  test('normal touch line selection follows coordinates when the pointer target is captured', () => {
    const { cleanup, setElementFromPoint } = installDom();
    const manager = new InteractionManager('file', {
      enableGutterUtility: true,
      enableLineSelection: true,
    });
    try {
      const { contentRows, gutterRows, pre } = createFilePre(4);
      manager.setup(pre);
      setElementFromPoint(8, 80, contentRows[3]);

      dispatchPointer(gutterRows[0], 'pointerdown', {
        clientX: 8,
        clientY: 20,
        pointerId: 11,
        pointerType: 'touch',
      });
      const pointerMove = dispatchPointer(gutterRows[0], 'pointermove', {
        clientX: 8,
        clientY: 80,
        pointerId: 11,
        pointerType: 'touch',
      });
      dispatchPointer(gutterRows[0], 'pointerup', {
        clientX: 8,
        clientY: 80,
        pointerId: 11,
        pointerType: 'touch',
      });

      expect(pointerMove.defaultPrevented).toBe(true);
      expect(manager.getSelection()).toEqual({ start: 1, end: 4 });
      expect(
        gutterRows[3].querySelector('[data-gutter-utility-slot]')
      ).not.toBe(null);
    } finally {
      manager.cleanUp();
      cleanup();
    }
  });

  test('normal touch line selection normalizes lateral hits to selectable rows', () => {
    const { cleanup, setElementFromPoint } = installDom();
    const manager = new InteractionManager('file', {
      enableGutterUtility: true,
      enableLineSelection: true,
    });
    try {
      const { contentRows, gutterRows, pre } = createFilePre(4);
      const token = document.createElement('span');
      token.setAttribute('data-char', '0');
      token.textContent = 'line';
      contentRows[3].replaceChildren(token);
      const lineNumber = document.createElement('span');
      lineNumber.setAttribute('data-line-number-content', '');
      lineNumber.textContent = '3';
      gutterRows[2].appendChild(lineNumber);
      manager.setup(pre);
      setElementFromPoint(80, 80, token);
      setElementFromPoint(4, 60, lineNumber);

      dispatchPointer(gutterRows[0], 'pointerdown', {
        clientX: 8,
        clientY: 20,
        pointerId: 12,
        pointerType: 'touch',
      });
      dispatchPointer(gutterRows[0], 'pointermove', {
        clientX: 80,
        clientY: 80,
        pointerId: 12,
        pointerType: 'touch',
      });

      expect(manager.getSelection()).toEqual({ start: 1, end: 4 });

      dispatchPointer(gutterRows[0], 'pointermove', {
        clientX: 4,
        clientY: 60,
        pointerId: 12,
        pointerType: 'touch',
      });

      expect(manager.getSelection()).toEqual({ start: 1, end: 3 });
    } finally {
      manager.cleanUp();
      cleanup();
    }
  });

  test('normal touch line selection follows annotation rows', () => {
    const { cleanup, setElementFromPoint } = installDom();
    const manager = new InteractionManager('file', {
      enableGutterUtility: true,
      enableLineSelection: true,
    });
    try {
      const fixture = createFilePre(4);
      const { gutterRows, pre } = fixture;
      const annotation = createAnnotationRowAfter(fixture, 2);
      manager.setup(pre);
      setElementFromPoint(80, 60, annotation.content);

      dispatchPointer(gutterRows[0], 'pointerdown', {
        clientX: 8,
        clientY: 20,
        pointerId: 16,
        pointerType: 'touch',
      });
      const pointerMove = dispatchPointer(gutterRows[0], 'pointermove', {
        clientX: 80,
        clientY: 60,
        pointerId: 16,
        pointerType: 'touch',
      });

      expect(pointerMove.defaultPrevented).toBe(true);
      expect(manager.getSelection()).toEqual({ start: 1, end: 3 });
      expect(
        gutterRows[2].querySelector('[data-gutter-utility-slot]')
      ).not.toBe(null);
    } finally {
      manager.cleanUp();
      cleanup();
    }
  });

  test('normal touch line selection follows slotted annotation content', () => {
    const { cleanup, setElementFromPoint } = installDom();
    const manager = new InteractionManager('file', {
      enableGutterUtility: true,
      enableLineSelection: true,
    });
    try {
      const { gutterRows, pre } = createFilePre(4);
      const annotationSlotContent = document.createElement('div');
      annotationSlotContent.slot = 'annotation-3';
      const annotationButton = document.createElement('button');
      annotationButton.type = 'button';
      annotationSlotContent.appendChild(annotationButton);
      document.body.appendChild(annotationSlotContent);
      manager.setup(pre);
      setElementFromPoint(80, 60, annotationButton);

      dispatchPointer(gutterRows[0], 'pointerdown', {
        clientX: 8,
        clientY: 20,
        pointerId: 17,
        pointerType: 'touch',
      });
      const pointerMove = dispatchPointer(gutterRows[0], 'pointermove', {
        clientX: 80,
        clientY: 60,
        pointerId: 17,
        pointerType: 'touch',
      });

      expect(pointerMove.defaultPrevented).toBe(true);
      expect(manager.getSelection()).toEqual({ start: 1, end: 3 });
      expect(
        gutterRows[2].querySelector('[data-gutter-utility-slot]')
      ).not.toBe(null);
    } finally {
      manager.cleanUp();
      cleanup();
    }
  });

  test('normal touch line selection ignores slotted file-level annotation content', () => {
    const { cleanup, setElementFromPoint } = installDom();
    const manager = new InteractionManager('file', {
      enableGutterUtility: true,
      enableLineSelection: true,
    });
    try {
      const fixture = createFilePre(4);
      prependLineZeroRow(fixture);
      const { gutterRows, pre } = fixture;
      const annotationSlotContent = document.createElement('div');
      annotationSlotContent.slot = 'annotation-0';
      const annotationButton = document.createElement('button');
      annotationButton.type = 'button';
      annotationSlotContent.appendChild(annotationButton);
      document.body.appendChild(annotationSlotContent);
      manager.setup(pre);
      setElementFromPoint(8, 80, gutterRows[3]);
      setElementFromPoint(80, 60, annotationButton);

      dispatchPointer(gutterRows[0], 'pointerdown', {
        clientX: 8,
        clientY: 20,
        pointerId: 18,
        pointerType: 'touch',
      });
      dispatchPointer(gutterRows[0], 'pointermove', {
        clientX: 8,
        clientY: 80,
        pointerId: 18,
        pointerType: 'touch',
      });
      expect(manager.getSelection()).toEqual({ start: 1, end: 4 });

      dispatchPointer(gutterRows[0], 'pointermove', {
        clientX: 80,
        clientY: 60,
        pointerId: 18,
        pointerType: 'touch',
      });

      expect(manager.getSelection()).toEqual({ start: 1, end: 4 });
    } finally {
      manager.cleanUp();
      cleanup();
    }
  });

  test('normal touch line selection holds range while dragging over hunk separators', () => {
    const { cleanup, setElementFromPoint } = installDom();
    const manager = new InteractionManager('file', {
      enableGutterUtility: true,
      enableLineSelection: true,
    });
    try {
      const { gutterRows, pre } = createFilePre(4);
      const separator = document.createElement('div');
      separator.setAttribute('data-expand-index', '0');
      separator.setAttribute('data-expand-button', '');
      pre.appendChild(separator);
      manager.setup(pre);
      setElementFromPoint(8, 80, gutterRows[3]);
      setElementFromPoint(8, 48, separator);

      dispatchPointer(gutterRows[0], 'pointerdown', {
        clientX: 8,
        clientY: 20,
        pointerId: 13,
        pointerType: 'touch',
      });
      dispatchPointer(gutterRows[0], 'pointermove', {
        clientX: 8,
        clientY: 80,
        pointerId: 13,
        pointerType: 'touch',
      });
      expect(manager.getSelection()).toEqual({ start: 1, end: 4 });

      dispatchPointer(gutterRows[0], 'pointermove', {
        clientX: 8,
        clientY: 48,
        pointerId: 13,
        pointerType: 'touch',
      });

      expect(manager.getSelection()).toEqual({ start: 1, end: 4 });
    } finally {
      manager.cleanUp();
      cleanup();
    }
  });

  test('normal touch line selection holds range while dragging over the gutter utility', () => {
    const { cleanup, setElementFromPoint } = installDom();
    const manager = new InteractionManager('file', {
      enableGutterUtility: true,
      enableLineSelection: true,
    });
    try {
      const { gutterRows, pre } = createFilePre(4);
      manager.setup(pre);
      setElementFromPoint(8, 20, gutterRows[0]);

      dispatchPointer(gutterRows[3], 'pointerdown', {
        clientX: 8,
        clientY: 80,
        pointerId: 15,
        pointerType: 'touch',
      });
      dispatchPointer(gutterRows[3], 'pointermove', {
        clientX: 8,
        clientY: 20,
        pointerId: 15,
        pointerType: 'touch',
      });
      expect(manager.getSelection()).toEqual({ start: 4, end: 1 });

      const button = getUtilityButton(gutterRows[3]);
      setElementFromPoint(8, 80, button);
      dispatchPointer(gutterRows[3], 'pointermove', {
        clientX: 8,
        clientY: 80,
        pointerId: 15,
        pointerType: 'touch',
      });

      expect(manager.getSelection()).toEqual({ start: 4, end: 1 });
    } finally {
      manager.cleanUp();
      cleanup();
    }
  });
});
