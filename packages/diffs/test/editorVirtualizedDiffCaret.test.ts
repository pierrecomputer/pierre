import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { FileDiff } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import type { FileContents } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom, wait } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

beforeAll(async () => {
  await disposeHighlighter();
});

function findAdditionContent(container: HTMLElement): HTMLElement {
  const shadow = container.shadowRoot;
  if (shadow == null) {
    throw new Error('missing shadow root');
  }
  for (const code of shadow.querySelectorAll<HTMLElement>('[data-code]')) {
    if (code.dataset.deletions !== undefined) {
      continue;
    }
    for (const child of code.children) {
      const el = child as HTMLElement;
      if (el.dataset.content !== undefined) {
        return el;
      }
    }
  }
  throw new Error('missing additions content');
}

function caretCount(container: HTMLElement): number {
  return container.shadowRoot?.querySelectorAll('[data-caret]').length ?? 0;
}

describe('virtualized diff editor caret', () => {
  // Diff render ranges count dense rendered rows, not document lines. A
  // virtualized scroll sync can therefore publish a startingLine that is far
  // below the caret's document line even while the row is still in the DOM.
  test('keeps the caret visible when the synced render range uses row indices', async () => {
    const dom = installDom();
    const container = document.createElement('div');
    document.body.appendChild(container);

    const oldLines = Array.from({ length: 120 }, (_, i) => `old ${i + 1}`);
    const newLines = oldLines.map((line, i) =>
      i === 59 ? 'changed-60' : line
    );
    const oldFile: FileContents = {
      name: 'edit.ts',
      contents: `${oldLines.join('\n')}\n`,
    };
    const newFile: FileContents = {
      name: 'edit.ts',
      contents: `${newLines.join('\n')}\n`,
    };

    const fileDiff = new FileDiff<undefined>({
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      diffStyle: 'split',
    });
    const editor = new Editor<undefined>();

    fileDiff.render({
      oldFile,
      newFile,
      fileContainer: container,
      forceRender: true,
      renderRange: {
        startingLine: 0,
        totalLines: 120,
        bufferBefore: 0,
        bufferAfter: 0,
      },
    });
    await wait(10);
    editor.edit(fileDiff);

    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const content = findAdditionContent(container);
        if (content.getAttribute('contenteditable') === 'true') {
          break;
        }
      } catch {
        // render still in flight
      }
      await wait(0);
    }
    const content = findAdditionContent(container);

    try {
      const caretLine = 59;
      editor.setSelections([
        {
          start: { line: caretLine, character: 0 },
          end: { line: caretLine, character: 0 },
          direction: 'none',
        },
      ]);
      editor.applyEdits(
        [
          {
            range: {
              start: { line: caretLine, character: 0 },
              end: { line: caretLine, character: 0 },
            },
            newText: 'X',
          },
        ],
        true
      );
      await wait(10);

      expect(
        content.querySelector(`[data-line="${caretLine + 1}"]`)
      ).not.toBeNull();
      expect(caretCount(container)).toBeGreaterThan(0);

      const highlighter = await getSharedHighlighter({
        themes: ['pierre-dark'],
        langs: ['text'],
      });
      const metadata = parseDiffFromFile(oldFile, newFile);

      // Mimic a post-scroll virtualizer sync: the row is still rendered, but
      // startingLine is a rendered-row index that is numerically below the
      // caret's document line.
      editor.__syncRenderView(highlighter, container, metadata, undefined, {
        startingLine: 10,
        totalLines: 80,
        bufferBefore: 400,
        bufferAfter: 800,
      });
      await wait(0);

      expect(
        content.querySelector(`[data-line="${caretLine + 1}"]`)
      ).not.toBeNull();
      expect(caretCount(container)).toBeGreaterThan(0);
    } finally {
      editor.cleanUp();
      fileDiff.cleanUp();
      dom.cleanup();
    }
  });
});
