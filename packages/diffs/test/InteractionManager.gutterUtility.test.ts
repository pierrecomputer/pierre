import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import { InteractionManager } from '../src/managers/InteractionManager';
import type { SelectedLineRange } from '../src/types';

function installDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
  });
  const originalValues = {
    cancelAnimationFrame: Reflect.get(globalThis, 'cancelAnimationFrame'),
    document: Reflect.get(globalThis, 'document'),
    Element: Reflect.get(globalThis, 'Element'),
    Event: Reflect.get(globalThis, 'Event'),
    HTMLButtonElement: Reflect.get(globalThis, 'HTMLButtonElement'),
    HTMLDivElement: Reflect.get(globalThis, 'HTMLDivElement'),
    HTMLElement: Reflect.get(globalThis, 'HTMLElement'),
    MouseEvent: Reflect.get(globalThis, 'MouseEvent'),
    Node: Reflect.get(globalThis, 'Node'),
    PointerEvent: Reflect.get(globalThis, 'PointerEvent'),
    requestAnimationFrame: Reflect.get(globalThis, 'requestAnimationFrame'),
    window: Reflect.get(globalThis, 'window'),
  };

  class MockPointerEvent extends dom.window.MouseEvent {
    pointerId: number;
    pointerType: string;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        ...init,
      });
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }

  let nextFrameId = 0;
  const frames = new Map<number, ReturnType<typeof setTimeout>>();
  const pointTargets = new Map<string, Element>();

  Object.defineProperty(dom.window.document, 'elementFromPoint', {
    configurable: true,
    value: (x: number, y: number): Element | null =>
      pointTargets.get(`${x},${y}`) ?? null,
  });

  Object.assign(globalThis, {
    cancelAnimationFrame: ((id: number) => {
      const timeout = frames.get(id);
      if (timeout != null) {
        clearTimeout(timeout);
        frames.delete(id);
      }
    }) as typeof cancelAnimationFrame,
    document: dom.window.document,
    Element: dom.window.Element,
    Event: dom.window.Event,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLElement: dom.window.HTMLElement,
    MouseEvent: dom.window.MouseEvent,
    Node: dom.window.Node,
    PointerEvent: MockPointerEvent,
    requestAnimationFrame: ((callback: FrameRequestCallback) => {
      const id = ++nextFrameId;
      const timeout = setTimeout(() => {
        frames.delete(id);
        callback(performance.now());
      }, 0);
      frames.set(id, timeout);
      return id;
    }) as typeof requestAnimationFrame,
    window: dom.window,
  });
  Object.assign(dom.window, { PointerEvent: MockPointerEvent });

  return {
    setElementFromPoint(x: number, y: number, element: Element): void {
      pointTargets.set(`${x},${y}`, element);
    },
    cleanup() {
      for (const timeout of frames.values()) {
        clearTimeout(timeout);
      }
      frames.clear();

      for (const [key, value] of Object.entries(originalValues)) {
        if (value === undefined) {
          Reflect.deleteProperty(globalThis, key);
        } else {
          Object.assign(globalThis, { [key]: value });
        }
      }
      dom.window.close();
    },
  };
}

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
