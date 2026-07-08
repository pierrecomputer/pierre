import { afterAll, describe, expect, test } from 'bun:test';

import { File } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import type { Marker } from '../src/editor/marker';
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
});
