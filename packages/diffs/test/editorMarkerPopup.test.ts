import { afterAll, describe, expect, test } from 'bun:test';

import { File } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import { type Marker, MarkerRenderer } from '../src/editor/marker';
import { PopoverManager } from '../src/editor/popover';
import type { TextDocument } from '../src/editor/textDocument';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { FileContents, Position } from '../src/types';
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

interface MarkerFixture {
  cleanup(): void;
  content: HTMLElement;
  editor: Editor<undefined>;
}

async function createMarkerFixture(contents: string): Promise<MarkerFixture> {
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);

  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
  });
  const editor = new Editor<undefined>();
  const initialFile: FileContents = { name: 'edits.ts', contents };

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

// Hovers the marker covering `oneIndexedLine` by dispatching a mouseover on
// the first tokenized span in that line's row. composedPath() is stubbed
// directly since jsdom doesn't reliably report it across shadow boundaries.
function hoverMarkerLine(content: HTMLElement, oneIndexedLine: number): void {
  const lineElements = Array.from(
    content.querySelectorAll<HTMLElement>('[data-line]')
  );
  const lineElement = lineElements.find(
    (el) => el.dataset.line === String(oneIndexedLine)
  );
  const charSpan = lineElement?.querySelector<HTMLElement>('[data-char]');
  if (charSpan === undefined || charSpan === null) {
    throw new Error(`no tokenized span found on line ${oneIndexedLine}`);
  }
  const event = new Event('mouseover', { bubbles: true, composed: true });
  Object.defineProperty(event, 'composedPath', {
    value: () => [charSpan],
  });
  content.dispatchEvent(event);
}

function findMarkerPopup(content: HTMLElement): HTMLElement {
  const root = content.getRootNode() as ShadowRoot;
  const popup = root.querySelector<HTMLElement>('[data-marker-popup]');
  if (popup === null) {
    throw new Error('marker popup was not rendered');
  }
  return popup;
}

function makeRect({
  height,
  left,
  top,
  width,
}: {
  height: number;
  left: number;
  top: number;
  width: number;
}): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON() {
      return {};
    },
  } as DOMRect;
}

function installMarkerPopupHeight(height: number): () => void {
  const original = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'offsetHeight'
  );
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return (this as HTMLElement).dataset.markerPopup !== undefined
        ? height
        : 0;
    },
  });
  return () => {
    if (original === undefined) {
      delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
    } else {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original);
    }
  };
}

interface DirectMarkerFixture {
  cleanup(): void;
  content: HTMLElement;
  scrollRoot: HTMLElement;
}

function createDirectMarkerFixture({
  gutterWidth = 40,
  initialScrollLeft = 0,
  initialScrollTop = 0,
  lineHeight = 20,
  markerX = 80,
  rowTop = 70,
  viewportHeight = 100,
  viewportWidth = 200,
}: {
  gutterWidth?: number;
  initialScrollLeft?: number;
  initialScrollTop?: number;
  lineHeight?: number;
  markerX?: number;
  rowTop?: number;
  viewportHeight?: number;
  viewportWidth?: number;
} = {}): DirectMarkerFixture {
  const dom = installDom();
  const scrollRoot = document.createElement('div');
  scrollRoot.style.overflowX = 'auto';
  scrollRoot.style.overflowY = 'auto';
  scrollRoot.scrollLeft = initialScrollLeft;
  scrollRoot.scrollTop = initialScrollTop;
  Object.defineProperty(scrollRoot, 'getBoundingClientRect', {
    configurable: true,
    value: () =>
      makeRect({
        height: viewportHeight,
        left: 0,
        top: 0,
        width: viewportWidth,
      }),
  });

  const fileContainer = document.createElement('div');
  const codeElement = document.createElement('div');
  codeElement.scrollLeft = initialScrollLeft;
  Object.defineProperty(codeElement, 'clientWidth', {
    configurable: true,
    get: () => viewportWidth,
  });
  Object.defineProperty(codeElement, 'getBoundingClientRect', {
    configurable: true,
    value: () =>
      makeRect({
        height: 1000,
        left: 0,
        top: -scrollRoot.scrollTop,
        width: viewportWidth,
      }),
  });

  const overlay = document.createElement('div');
  const content = document.createElement('div');
  const line = document.createElement('div');
  line.dataset.line = '5';
  const span = document.createElement('span');
  span.dataset.char = '0';
  span.textContent = 'x';
  line.appendChild(span);
  content.appendChild(line);

  fileContainer.append(codeElement, content, overlay);
  scrollRoot.appendChild(fileContainer);
  document.body.appendChild(scrollRoot);

  const rendererRef: { current?: MarkerRenderer } = {};
  const popoverManager = new PopoverManager({
    hasActivePopover: () => rendererRef.current?.isPopupVisible() === true,
    updateActivePopover: () => rendererRef.current?.updatePopupPosition(),
  });
  popoverManager.setViewportElements(fileContainer, codeElement);

  rendererRef.current = new MarkerRenderer({
    popoverManager,
    getLineHeight: () => lineHeight,
    getOverlayElement: () => overlay,
    getGutterWidth: () => gutterWidth,
    getCharX: () => [markerX, 0],
    getLineY: () => rowTop,
    isMouseDown: () => false,
  });
  rendererRef.current.setMarkers(
    [
      {
        start: { line: 4, character: 0 },
        end: { line: 4, character: 1 },
        severity: 'error',
        message: 'marker message',
      },
    ],
    {
      lineCount: 20,
      normalizePosition(position: Position): Position {
        return position;
      },
    } as unknown as TextDocument<undefined>
  );
  rendererRef.current.listenHover(content);

  return {
    cleanup() {
      rendererRef.current?.cleanup();
      popoverManager.cleanUp();
      dom.cleanup();
    },
    content,
    scrollRoot,
  };
}

describe('Editor marker popup placement', () => {
  // Default, unchanged by the viewport-aware flip: anchor below the marker.
  test('places the popup below the marker by default', async () => {
    const MULTILINE = 'l0\nl1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9';
    const { cleanup, editor, content } = await createMarkerFixture(MULTILINE);

    try {
      const markers: Marker[] = [
        {
          start: { line: 4, character: 0 },
          end: { line: 4, character: 2 },
          severity: 'error',
          message: 'mid-document error',
        },
      ];
      editor.setMarkers(markers);

      hoverMarkerLine(content, 5);
      await wait(350);

      const popup = findMarkerPopup(content);
      expect(popup.style.getPropertyValue('--popover-y-shift').trim()).toBe(
        '0px'
      );
    } finally {
      cleanup();
    }
  });

  // A marker within POPOVER_BOUNDARY_LINES of the document's last row hits
  // the no-viewport document-edge fallback (the only path reachable in this
  // DOM harness), so the popup must flip above instead of below.
  test('flips the popup above a marker near the document`s bottom edge', async () => {
    const MULTILINE = 'l0\nl1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9';
    const { cleanup, editor, content } = await createMarkerFixture(MULTILINE);

    try {
      const markers: Marker[] = [
        {
          start: { line: 9, character: 0 },
          end: { line: 9, character: 2 },
          severity: 'warning',
          message: 'last-line warning',
        },
      ];
      editor.setMarkers(markers);

      hoverMarkerLine(content, 10);
      await wait(350);

      const popup = findMarkerPopup(content);
      expect(popup.style.getPropertyValue('--popover-y-shift').trim()).toBe(
        '-100%'
      );
    } finally {
      cleanup();
    }
  });

  test('re-flips an open marker popup when the scroll viewport changes', async () => {
    const { cleanup, content, scrollRoot } = createDirectMarkerFixture({
      initialScrollTop: 50,
      rowTop: 70,
      viewportHeight: 100,
    });
    const restoreHeight = installMarkerPopupHeight(60);

    try {
      hoverMarkerLine(content, 5);
      await wait(350);

      const popup = findMarkerPopup(content);
      expect(popup.style.getPropertyValue('--popover-y-shift').trim()).toBe(
        '0px'
      );

      scrollRoot.scrollTop = 0;
      scrollRoot.dispatchEvent(new Event('scroll'));
      await wait(0);

      expect(popup.style.getPropertyValue('--popover-y-shift').trim()).toBe(
        '-100%'
      );
    } finally {
      restoreHeight();
      cleanup();
    }
  });

  test('sets horizontal clamp bounds from the visible scroll viewport', async () => {
    const { cleanup, content } = createDirectMarkerFixture({
      gutterWidth: 40,
      initialScrollLeft: 600,
      markerX: 900,
      viewportWidth: 160,
    });

    try {
      hoverMarkerLine(content, 5);
      await wait(350);

      const popup = findMarkerPopup(content);
      expect(
        popup.style.getPropertyValue('--popover-viewport-left').trim()
      ).toBe('600px');
      expect(
        popup.style.getPropertyValue('--popover-viewport-right').trim()
      ).toBe('760px');
      expect(popup.style.getPropertyValue('--popover-x').trim()).toBe('900px');
      expect(popup.style.getPropertyValue('--gutter-width').trim()).toBe(
        '40px'
      );
    } finally {
      cleanup();
    }
  });
});
