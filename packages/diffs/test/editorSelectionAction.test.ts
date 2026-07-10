import { afterAll, describe, expect, test } from 'bun:test';

import { File } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor, type EditorOptions } from '../src/editor/editor';
import { PopoverManager } from '../src/editor/popover';
import { DirectionBackward, getCaretPosition } from '../src/editor/selection';
import type { SelectionActionContext } from '../src/editor/selectionAction';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { FileContents, RenderRange } from '../src/types';
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

interface SelectionActionFixture {
  cleanup(): void;
  content: HTMLElement;
  editor: Editor<undefined>;
  triggerResizeObserver(target: Element): void;
  window: Window & {
    CompositionEvent: {
      new (
        type: string,
        eventInitDict?: CompositionEventInit
      ): CompositionEvent;
    };
  };
}

async function createSelectionActionFixture(
  contents: string,
  editorOptions: EditorOptions<undefined>,
  renderRange?: RenderRange
): Promise<SelectionActionFixture> {
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);

  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
  });
  const editor = new Editor<undefined>(editorOptions);
  const initialFile: FileContents = { name: 'edits.ts', contents };

  file.render({
    file: initialFile,
    fileContainer,
    forceRender: true,
    renderRange,
  });
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
    triggerResizeObserver: dom.triggerResizeObserver,
    window: dom.window as unknown as SelectionActionFixture['window'],
  };
}

// Returns the floating popover that hosts the selection action, mounted into the
// editor's overlay layer as soon as a ranged selection settles.
function findSelectionActionPopover(content: HTMLElement): HTMLElement {
  const root = content.getRootNode() as ShadowRoot;
  const popover = root.querySelector<HTMLElement>(
    '[data-selection-action-popover]'
  );
  if (popover === null) {
    throw new Error('selection action popover was not rendered');
  }
  return popover;
}

describe('Editor selection action', () => {
  // The popover element is created once when the selection settles and kept open
  // across selection changes, so its handlers must read the current primary
  // selection rather than the snapshot taken when it was first created. During a
  // drag the popover is first created from the initial single-character
  // selection.
  test('forward-grown selection: acts on the full selection, not the first character', async () => {
    let captured: SelectionActionContext<undefined> | undefined;
    const { cleanup, editor, content } = await createSelectionActionFixture(
      'hello world',
      {
        enabledSelectionAction: true,
        renderSelectionAction(context) {
          captured = context;
          return document.createElement('div');
        },
      }
    );

    try {
      // First selection (single character) creates the popover.
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
          direction: 'forward',
        },
      ]);

      // The selection grows on the same line; the popover stays open.
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
          direction: 'forward',
        },
      ]);

      expect(() => findSelectionActionPopover(content)).not.toThrow();
      expect(captured).toBeDefined();
      expect(captured!.getSelectionText()).toBe('hello');

      captured!.replaceSelectionText(`TODO(${captured!.getSelectionText()})`);
      expect(editor.getText()).toBe('TODO(hello) world');
    } finally {
      cleanup();
    }
  });

  // Mirror of the forward case: a backward drag first creates the popover from
  // the last character, so a stale snapshot would be the selection's last
  // letter.
  test('backward-grown selection: acts on the full selection, not the last character', async () => {
    let captured: SelectionActionContext<undefined> | undefined;
    const { cleanup, editor, content } = await createSelectionActionFixture(
      'hello world',
      {
        enabledSelectionAction: true,
        renderSelectionAction(context) {
          captured = context;
          return document.createElement('div');
        },
      }
    );

    try {
      // First selection is the last character of the word being selected.
      editor.setSelections([
        {
          start: { line: 0, character: 4 },
          end: { line: 0, character: 5 },
          direction: 'backward',
        },
      ]);

      // The selection grows backward on the same line; the popover stays open.
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
          direction: 'backward',
        },
      ]);

      expect(() => findSelectionActionPopover(content)).not.toThrow();
      expect(captured).toBeDefined();
      expect(captured!.getSelectionText()).toBe('hello');
    } finally {
      cleanup();
    }
  });

  // A ten-line document used by the placement tests so a selection's head can
  // sit clear of the first/last rows where the editor flips placement.
  const MULTILINE = 'l0\nl1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9';

  // A bottom-up (backward) selection has its head at the top, so the popover
  // must sit above the selection (shifted up by its own height) instead of
  // covering its first line. The shift is expressed via --popover-y-shift.
  test('backward selection places the popover above the selection', async () => {
    const { cleanup, editor, content } = await createSelectionActionFixture(
      MULTILINE,
      {
        enabledSelectionAction: true,
        renderSelectionAction() {
          return document.createElement('div');
        },
      }
    );

    try {
      editor.setSelections([
        {
          start: { line: 5, character: 0 },
          end: { line: 7, character: 2 },
          direction: 'backward',
        },
      ]);

      const popover = findSelectionActionPopover(content);
      expect(popover.style.getPropertyValue('--popover-y-shift').trim()).toBe(
        '-100%'
      );
    } finally {
      cleanup();
    }
  });

  // A top-down (forward) selection has its head at the bottom, so the popover
  // keeps the original below-placement with no self-shift.
  test('forward selection places the popover below the selection', async () => {
    const { cleanup, editor, content } = await createSelectionActionFixture(
      MULTILINE,
      {
        enabledSelectionAction: true,
        renderSelectionAction() {
          return document.createElement('div');
        },
      }
    );

    try {
      editor.setSelections([
        {
          start: { line: 2, character: 0 },
          end: { line: 4, character: 2 },
          direction: 'forward',
        },
      ]);

      const popover = findSelectionActionPopover(content);
      expect(popover.style.getPropertyValue('--popover-y-shift').trim()).toBe(
        '0px'
      );
    } finally {
      cleanup();
    }
  });

  // A backward selection touching the document's first rows has no room above,
  // so the popover flips to below the selection's bottom edge (no self-shift)
  // instead of being clipped above the scrollport.
  test('backward selection near the top flips the popover below', async () => {
    const { cleanup, editor, content } = await createSelectionActionFixture(
      MULTILINE,
      {
        enabledSelectionAction: true,
        renderSelectionAction() {
          return document.createElement('div');
        },
      }
    );

    try {
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 2 },
          direction: 'backward',
        },
      ]);

      const popover = findSelectionActionPopover(content);
      expect(popover.style.getPropertyValue('--popover-y-shift').trim()).toBe(
        '0px'
      );
    } finally {
      cleanup();
    }
  });

  // A forward selection touching the document's last rows has no room below, so
  // the popover flips to above the selection's top edge (shifted up by its own
  // height) instead of being clipped below the scrollport.
  test('forward selection near the bottom flips the popover above', async () => {
    const { cleanup, editor, content } = await createSelectionActionFixture(
      MULTILINE,
      {
        enabledSelectionAction: true,
        renderSelectionAction() {
          return document.createElement('div');
        },
      }
    );

    try {
      editor.setSelections([
        {
          start: { line: 8, character: 0 },
          end: { line: 9, character: 2 },
          direction: 'forward',
        },
      ]);

      const popover = findSelectionActionPopover(content);
      expect(popover.style.getPropertyValue('--popover-y-shift').trim()).toBe(
        '-100%'
      );
    } finally {
      cleanup();
    }
  });

  // Regression test for a coordinate-space bug: the viewport check used to
  // measure #overlayElement (`display: contents`, so getBoundingClientRect is
  // always a zero rect in real browsers) instead of the `[data-code]` element
  // that actually anchors overlay children. jsdom's default zero rects masked
  // this — every element returns one — so this test stubs real, non-zero
  // layout geometry to exercise the path the way a real browser would.
  //
  // A backward selection's head sits on line 10 of a 30-line document: far
  // from the document's first/last 3 rows, so the older document-edge-only
  // heuristic never flips it. The document is scrolled so the head row sits
  // right at the top of a 200px viewport, leaving no room to place the
  // popover above it — the viewport-aware check must flip to below instead.
  test('flips a mid-document popover clipped by a scrolled viewport, not just document edges', async () => {
    const LINE_COUNT = 30;
    const contents = Array.from(
      { length: LINE_COUNT },
      (_, i) => `line${i}`
    ).join('\n');
    const { cleanup, editor, content } = await createSelectionActionFixture(
      contents,
      {
        enabledSelectionAction: true,
        renderSelectionAction() {
          return document.createElement('div');
        },
      }
    );

    const ROW_HEIGHT = 20;
    const POPOVER_HEIGHT = 40;
    const originalOffsetTop = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetTop'
    );
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetHeight'
    );
    const realGetComputedStyle = globalThis.getComputedStyle;

    // jsdom performs no real layout, so offsetTop/offsetHeight default to 0
    // and getBoundingClientRect to an all-zero rect on every element. Stub
    // each line's offsetTop from its own `data-line` attribute (stacking rows
    // ROW_HEIGHT apart, mirroring real layout), give the popover a real
    // measured height, and make every element report a scrollable
    // `overflow-y` so the file container's wrapping div resolves as the
    // scroll container.
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      configurable: true,
      get(this: HTMLElement) {
        const lineAttr = this.dataset.line;
        return lineAttr != null ? Number(lineAttr) * ROW_HEIGHT : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        return POPOVER_HEIGHT;
      },
    });
    globalThis.getComputedStyle = (() =>
      ({
        overflowY: 'auto',
      }) as CSSStyleDeclaration) as typeof getComputedStyle;

    try {
      const shadowRoot = content.getRootNode() as ShadowRoot;
      const fileContainer = shadowRoot.host as HTMLElement;
      const scrollContainer = document.createElement('div');
      document.body.appendChild(scrollContainer);
      scrollContainer.appendChild(fileContainer);

      const stubRect = (top: number, bottom: number): DOMRect =>
        ({
          top,
          bottom,
          left: 0,
          right: 0,
          width: 0,
          height: bottom - top,
          x: 0,
          y: top,
          toJSON() {
            return {};
          },
        }) as DOMRect;

      // A 200px-tall viewport fixed at the screen's top edge.
      Object.defineProperty(scrollContainer, 'getBoundingClientRect', {
        configurable: true,
        value: () => stubRect(0, 200),
      });

      const lineElements = Array.from(
        content.querySelectorAll<HTMLElement>('[data-line]')
      );
      const headLineElement = lineElements[10];
      const fallbackLineElement = lineElements[12];
      const headY = Number(headLineElement.dataset.line) * ROW_HEIGHT;

      // Scroll the document so the head row's content-space Y lands exactly at
      // the viewport's screen top: the `[data-code]` element's own screen top
      // is `headY` pixels above the viewport.
      const codeElement = content.closest<HTMLElement>('[data-code]')!;
      Object.defineProperty(codeElement, 'getBoundingClientRect', {
        configurable: true,
        value: () => stubRect(-headY, -headY + LINE_COUNT * ROW_HEIGHT),
      });

      editor.setSelections([
        {
          start: { line: 10, character: 0 },
          end: { line: 12, character: 2 },
          direction: 'backward',
        },
      ]);

      // Sanity check the fallback candidate's row actually differs from the
      // head's, so the assertion below isn't vacuously true.
      expect(fallbackLineElement.dataset.line).not.toBe(
        headLineElement.dataset.line
      );

      const popover = findSelectionActionPopover(content);
      expect(popover.style.getPropertyValue('--popover-y-shift').trim()).toBe(
        '0px'
      );
    } finally {
      if (originalOffsetTop !== undefined) {
        Object.defineProperty(
          HTMLElement.prototype,
          'offsetTop',
          originalOffsetTop
        );
      }
      if (originalOffsetHeight !== undefined) {
        Object.defineProperty(
          HTMLElement.prototype,
          'offsetHeight',
          originalOffsetHeight
        );
      }
      globalThis.getComputedStyle = realGetComputedStyle;
      cleanup();
    }
  });

  // Regression test: consumer-rendered action content can change height after
  // mount (async content, loaded icons, wrapping). A resize must re-run the
  // placement decision, not only refresh the cached height, otherwise a popover
  // that grew near the scrollport edge can remain clipped until another scroll
  // or selection update happens.
  test('recomputes popover placement when selection action content resizes', async () => {
    const LINE_COUNT = 30;
    const contents = Array.from(
      { length: LINE_COUNT },
      (_, i) => `line${i}`
    ).join('\n');
    const { cleanup, editor, content, triggerResizeObserver } =
      await createSelectionActionFixture(contents, {
        enabledSelectionAction: true,
        renderSelectionAction() {
          const action = document.createElement('div');
          action.textContent = 'action';
          return action;
        },
      });

    const ROW_HEIGHT = 20;
    let popoverHeight = 20;
    const originalOffsetTop = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetTop'
    );
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetHeight'
    );
    const realGetComputedStyle = globalThis.getComputedStyle;

    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      configurable: true,
      get(this: HTMLElement) {
        const lineAttr = this.dataset.line;
        return lineAttr != null ? Number(lineAttr) * ROW_HEIGHT : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.selectionActionPopover != null
          ? popoverHeight
          : ROW_HEIGHT;
      },
    });
    globalThis.getComputedStyle = (() =>
      ({
        overflowY: 'auto',
      }) as CSSStyleDeclaration) as typeof getComputedStyle;

    try {
      const shadowRoot = content.getRootNode() as ShadowRoot;
      const fileContainer = shadowRoot.host as HTMLElement;
      const scrollContainer = document.createElement('div');
      document.body.appendChild(scrollContainer);
      scrollContainer.appendChild(fileContainer);

      const stubRect = (top: number, bottom: number): DOMRect =>
        ({
          top,
          bottom,
          left: 0,
          right: 0,
          width: 0,
          height: bottom - top,
          x: 0,
          y: top,
          toJSON() {
            return {};
          },
        }) as DOMRect;

      Object.defineProperty(scrollContainer, 'getBoundingClientRect', {
        configurable: true,
        value: () => stubRect(0, 200),
      });

      const codeElement = content.closest<HTMLElement>('[data-code]')!;
      const lineElements = Array.from(
        content.querySelectorAll<HTMLElement>('[data-line]')
      );
      const headLineElement = lineElements[10];
      const headY = Number(headLineElement.dataset.line) * ROW_HEIGHT;
      Object.defineProperty(codeElement, 'getBoundingClientRect', {
        configurable: true,
        value: () =>
          stubRect(
            -(headY - popoverHeight),
            -(headY - popoverHeight) + LINE_COUNT * ROW_HEIGHT
          ),
      });

      editor.setSelections([
        {
          start: { line: 10, character: 0 },
          end: { line: 12, character: 2 },
          direction: 'backward',
        },
      ]);

      const popover = findSelectionActionPopover(content);
      // The initial 20px height fits above the head row: top is 10px inside
      // the viewport.
      expect(popover.style.getPropertyValue('--popover-y-shift').trim()).toBe(
        '-100%'
      );

      popoverHeight = 40;
      triggerResizeObserver(popover);

      // After the resize, above-placement would paint from -10px and clip, so
      // the popover must flip below the selection's other edge.
      expect(popover.style.getPropertyValue('--popover-y-shift').trim()).toBe(
        '0px'
      );
    } finally {
      if (originalOffsetTop !== undefined) {
        Object.defineProperty(
          HTMLElement.prototype,
          'offsetTop',
          originalOffsetTop
        );
      }
      if (originalOffsetHeight !== undefined) {
        Object.defineProperty(
          HTMLElement.prototype,
          'offsetHeight',
          originalOffsetHeight
        );
      }
      globalThis.getComputedStyle = realGetComputedStyle;
      cleanup();
    }
  });

  // Regression test: the document-edge heuristic flips to the fallback (the
  // selection's other edge) whenever the head is near a document edge, even
  // if that fallback edge is outside the virtualized render window and has no
  // DOM row. Without a visibility guard, the popover would anchor to a line
  // #getLineY can't measure instead of staying on the (visible) head.
  test('keeps the popover on the head when the fallback anchor is outside the render window', async () => {
    const LINE_COUNT = 200;
    const contents = Array.from(
      { length: LINE_COUNT },
      (_, i) => `line${i}`
    ).join('\n');
    // Renders only lines 0..49; the fallback anchor below (line 150) has no
    // DOM row.
    const { cleanup, editor, content } = await createSelectionActionFixture(
      contents,
      {
        enabledSelectionAction: true,
        renderSelectionAction() {
          return document.createElement('div');
        },
      },
      { startingLine: 0, totalLines: 50, bufferBefore: 0, bufferAfter: 0 }
    );

    try {
      editor.setSelections([
        {
          start: { line: 1, character: 0 },
          end: { line: 150, character: 2 },
          direction: 'backward',
        },
      ]);

      const popover = findSelectionActionPopover(content);
      // Preferred (head-anchored, placed above) must win: the fallback's
      // anchor line isn't rendered, so it can never be chosen.
      expect(popover.style.getPropertyValue('--popover-y-shift').trim()).toBe(
        '-100%'
      );
    } finally {
      cleanup();
    }
  });

  // getComposedRanges only reports an ordered, direction-less range, so the
  // selectionchange a refocus fires (after tabbing away and back) would flip a
  // backward selection to DirectionNone and snap the caret/popover to the
  // bottom. With the bounds unchanged the prior direction must be preserved.
  test('refocus keeps a backward selection backward', async () => {
    const { cleanup, editor, content } = await createSelectionActionFixture(
      'hello\nworld',
      {
        enabledSelectionAction: true,
        renderSelectionAction() {
          return document.createElement('div');
        },
      }
    );

    const originalGetSelection = document.getSelection.bind(document);
    try {
      // Focus before selecting so #contentHasFocus is set without the focus
      // handler re-syncing a not-yet-existing selection.
      content.dispatchEvent(new Event('focus'));

      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 0 },
          direction: 'backward',
        },
      ]);
      expect(editor.getState().selections?.[0]?.direction).toBe(
        DirectionBackward
      );
      // setSelections ends by re-focusing the caret, which sets
      // #shouldIgnoreSelectionChange for two nested rAFs before clearing it.
      // Flush those first, or the dispatch below would be ignored regardless
      // of the fix under test.
      await wait(0);
      await wait(0);

      const lineElements = Array.from(
        content.querySelectorAll<HTMLElement>('[data-line]')
      );
      const lineElement0 = lineElements.find((el) => el.dataset.line === '1')!;
      const lineElement1 = lineElements.find((el) => el.dataset.line === '2')!;
      // A direction-less, bounds-identical range, mirroring what a refocus
      // selectionchange reports through getComposedRanges.
      const refocusRange = {
        startContainer: lineElement0,
        startOffset: 0,
        endContainer: lineElement1,
        endOffset: 0,
      } as unknown as StaticRange;
      document.getSelection = (() => ({
        getComposedRanges: () => [refocusRange],
      })) as unknown as typeof document.getSelection;

      document.dispatchEvent(new Event('selectionchange'));

      const primarySelection = editor.getState().selections?.at(-1);
      expect(primarySelection?.direction).toBe(DirectionBackward);
      expect(getCaretPosition(primarySelection!)).toEqual({
        line: 0,
        character: 0,
      });
    } finally {
      document.getSelection = originalGetSelection;
      cleanup();
    }
  });

  // IME candidate windows can fire selectionchange events mid-composition with
  // the same direction-less range shape a refocus produces (see the test
  // above). Composition sets #shouldIgnoreSelectionChange for its whole
  // duration, so these must be ignored outright rather than reaching the
  // bounds-comparison branch — confirms the two fixes don't interact badly.
  test('composition-time selectionchange does not affect a backward selection', async () => {
    const { cleanup, editor, content, window } =
      await createSelectionActionFixture('hello\nworld', {
        enabledSelectionAction: true,
        renderSelectionAction() {
          return document.createElement('div');
        },
      });

    const originalGetSelection = document.getSelection.bind(document);
    try {
      content.dispatchEvent(new Event('focus'));

      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 0 },
          direction: 'backward',
        },
      ]);
      expect(editor.getState().selections?.[0]?.direction).toBe(
        DirectionBackward
      );
      // Flush setSelections' own re-focus (see the refocus test above) so the
      // ignore below is solely due to compositionstart.
      await wait(0);
      await wait(0);

      content.dispatchEvent(
        new window.CompositionEvent('compositionstart', {
          bubbles: true,
          composed: true,
        })
      );

      const lineElements = Array.from(
        content.querySelectorAll<HTMLElement>('[data-line]')
      );
      const lineElement1 = lineElements.find((el) => el.dataset.line === '2')!;
      // A range collapsed at the start of line 2 ({1, 0}) — genuinely
      // different bounds from the current selection's start ({0, 0}).
      // Reaching the bounds-comparison branch at all would collapse the
      // selection there; only ignoring the event outright keeps it intact.
      const compositionRange = {
        startContainer: lineElement1,
        startOffset: 0,
        endContainer: lineElement1,
        endOffset: 0,
      } as unknown as StaticRange;
      document.getSelection = (() => ({
        getComposedRanges: () => [compositionRange],
      })) as unknown as typeof document.getSelection;

      document.dispatchEvent(new Event('selectionchange'));

      // Ignored: the pre-composition backward selection must be untouched.
      const primarySelection = editor.getState().selections?.at(-1);
      expect(primarySelection?.direction).toBe(DirectionBackward);
      expect(primarySelection?.start).toEqual({ line: 0, character: 0 });
      expect(primarySelection?.end).toEqual({ line: 1, character: 0 });

      content.dispatchEvent(
        new window.CompositionEvent('compositionend', {
          bubbles: true,
          composed: true,
          data: '',
        })
      );
    } finally {
      document.getSelection = originalGetSelection;
      cleanup();
    }
  });

  // The popover only exists while a range is selected; collapsing the selection
  // (clicking elsewhere, arrowing away) tears it down.
  test('collapsing the selection removes the popover', async () => {
    const { cleanup, editor, content } = await createSelectionActionFixture(
      'hello world',
      {
        enabledSelectionAction: true,
        renderSelectionAction() {
          return document.createElement('div');
        },
      }
    );

    try {
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
          direction: 'forward',
        },
      ]);
      expect(() => findSelectionActionPopover(content)).not.toThrow();

      editor.setSelections([
        {
          start: { line: 0, character: 5 },
          end: { line: 0, character: 5 },
          direction: 'none',
        },
      ]);
      const root = content.getRootNode() as ShadowRoot;
      expect(root.querySelector('[data-selection-action-popover]')).toBeNull();
    } finally {
      cleanup();
    }
  });

  // The placement decision is exercised directly here: the DOM harness performs
  // no layout, so the popover-update path can only reach the document-edge
  // fallback, while these cases cover the viewport-aware branch with explicit
  // geometry.
  describe('choosePlacement', () => {
    // A 200px-tall viewport in overlay coordinate space, shared by the
    // viewport-aware cases below.
    const viewport = { top: 0, bottom: 200 };
    const POPOVER_HEIGHT = 60;
    const createPopoverManager = (): PopoverManager =>
      new PopoverManager({
        hasActivePopover: () => false,
        updateActivePopover: () => {},
      });

    test('keeps the preferred side when it fits the viewport', () => {
      expect(
        createPopoverManager().choosePlacement({
          preferred: { top: 80, bottom: 140 },
          fallback: { top: 200, bottom: 260 },
          viewport,
          popoverHeight: POPOVER_HEIGHT,
          atDocumentEdge: false,
        })
      ).toBe('preferred');
    });

    test('flips to the fallback when the preferred side is clipped but the fallback fits', () => {
      // Backward selection scrolled so its head sits at the top of the viewport:
      // placing above clips past the scrollport top, below has room.
      expect(
        createPopoverManager().choosePlacement({
          preferred: { top: -40, bottom: 20 },
          fallback: { top: 40, bottom: 100 },
          viewport,
          popoverHeight: POPOVER_HEIGHT,
          atDocumentEdge: false,
        })
      ).toBe('fallback');
    });

    test('keeps the preferred side when neither side fits the viewport', () => {
      expect(
        createPopoverManager().choosePlacement({
          preferred: { top: -40, bottom: 20 },
          fallback: { top: 180, bottom: 240 },
          viewport,
          popoverHeight: POPOVER_HEIGHT,
          atDocumentEdge: false,
        })
      ).toBe('preferred');
    });

    // Hysteresis only biases flipping *back* to preferred once already on
    // fallback; without the manager's prior fallback placement this would
    // resolve to 'preferred'.
    test('sticks with the fallback side while preferred only barely fits', () => {
      const popoverManager = createPopoverManager();
      popoverManager.setPlacement('fallback');
      expect(
        popoverManager.choosePlacement({
          // Fits at margin 0 (top: 2 >= 0), but not within the 4px hysteresis
          // margin (2 < 4) — too close to the edge to trust yet.
          preferred: { top: 2, bottom: 62 },
          fallback: { top: 120, bottom: 180 },
          viewport,
          popoverHeight: POPOVER_HEIGHT,
          atDocumentEdge: false,
        })
      ).toBe('fallback');
    });

    test('flips back to preferred once it clears the hysteresis margin', () => {
      const popoverManager = createPopoverManager();
      popoverManager.setPlacement('fallback');
      expect(
        popoverManager.choosePlacement({
          // Clears the 4px margin (top: 10 >= 4), so it's safe to flip back.
          preferred: { top: 10, bottom: 70 },
          fallback: { top: 120, bottom: 180 },
          viewport,
          popoverHeight: POPOVER_HEIGHT,
          atDocumentEdge: false,
        })
      ).toBe('preferred');
    });

    test('uses the document-edge signal when viewport geometry is unavailable', () => {
      const bounds = { top: 0, bottom: 0 };
      expect(
        createPopoverManager().choosePlacement({
          preferred: bounds,
          fallback: bounds,
          viewport: undefined,
          popoverHeight: POPOVER_HEIGHT,
          atDocumentEdge: true,
        })
      ).toBe('fallback');
      expect(
        createPopoverManager().choosePlacement({
          preferred: bounds,
          fallback: bounds,
          viewport: undefined,
          popoverHeight: POPOVER_HEIGHT,
          atDocumentEdge: false,
        })
      ).toBe('preferred');
    });

    test('uses the document-edge signal when the popover has not laid out yet', () => {
      // popoverHeight 0 means no measured geometry, so even with a viewport the
      // decision falls back to the document-edge signal.
      expect(
        createPopoverManager().choosePlacement({
          preferred: { top: -40, bottom: 20 },
          fallback: { top: 40, bottom: 100 },
          viewport,
          popoverHeight: 0,
          atDocumentEdge: true,
        })
      ).toBe('fallback');
    });
  });

  // Without `enabledSelectionAction`, a ranged selection renders nothing and the
  // consumer's callback is never invoked.
  test('renders no popover when the feature is disabled', async () => {
    let rendered = false;
    const { cleanup, editor, content } = await createSelectionActionFixture(
      'hello world',
      {
        renderSelectionAction() {
          rendered = true;
          return document.createElement('div');
        },
      }
    );

    try {
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
          direction: 'forward',
        },
      ]);
      const root = content.getRootNode() as ShadowRoot;
      expect(root.querySelector('[data-selection-action-popover]')).toBeNull();
      expect(rendered).toBe(false);
    } finally {
      cleanup();
    }
  });
});
