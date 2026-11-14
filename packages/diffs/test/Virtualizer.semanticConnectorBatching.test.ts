import { afterAll, describe, expect, test } from 'bun:test';

import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { Virtualizer } from '../src/components/Virtualizer';
import { DEFAULT_THEMES } from '../src/constants';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { FileDiffMetadata } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom, wait, waitFor } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

// Three removed lines under one closed semantic fold.
function foldedDiff(name: string): FileDiffMetadata {
  const fileDiff = parseDiffFromFile(
    { name, contents: 'keep\nmoved1\nmoved2\nmoved3\nlast\n' },
    { name, contents: 'keep\nlast\n' }
  );
  fileDiff.semanticOperations = [];
  fileDiff.semanticFolds = [
    {
      old: { start: 2, end: 4 },
      operations: [],
      counts: { moved: 3, edited: 0, removed: 0 },
    },
  ];
  return fileDiff;
}

describe('Virtualizer semantic connector batching', () => {
  test('every diff measures its connector column before any connector is drawn', async () => {
    const dom = installDom();
    // jsdom does no layout. Every element reports a box with a size, so the
    // connector column counts as laid out, and the reads and writes on the
    // connector columns are recorded in order, frame by frame.
    const events: string[] = [];
    const { getBoundingClientRect, setAttribute } = Element.prototype;
    const { requestAnimationFrame } = globalThis;
    const box: DOMRect = {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 400,
      bottom: 20,
      width: 400,
      height: 20,
      toJSON: () => ({}),
    };
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.hasAttribute('data-semantic-connectors')) {
        events.push('read');
      }
      return box;
    };
    Element.prototype.setAttribute = function (
      this: Element,
      name: string,
      value: string
    ) {
      if (this.closest('[data-semantic-connectors]') != null) {
        events.push('write');
      }
      setAttribute.call(this, name, value);
    };
    globalThis.requestAnimationFrame = (callback) =>
      requestAnimationFrame((time) => {
        events.push('frame');
        callback(time);
      });

    const root = document.createElement('div');
    document.body.appendChild(root);
    const virtualizer = new Virtualizer();
    virtualizer.setup(root);
    const diffs = ['one.txt', 'two.txt'].map((name) => {
      const fileContainer = document.createElement('div');
      root.appendChild(fileContainer);
      const instance = new VirtualizedFileDiff<undefined>(
        {
          disableFileHeader: true,
          theme: DEFAULT_THEMES,
          diffStyle: 'split',
          expandUnchanged: true,
        },
        virtualizer
      );
      instance.render({
        fileDiff: foldedDiff(name),
        fileContainer,
        forceRender: true,
      });
      return { instance, fileContainer };
    });
    const count = (selector: string) =>
      diffs.filter(
        ({ fileContainer }) =>
          fileContainer.shadowRoot?.querySelector(selector) != null
      ).length;
    try {
      await waitFor(() => count('[data-semantic-fold]') === 2);
      await waitFor(() => count('[data-semantic-connectors] svg') === 2);
      await wait(30);

      // Open both folds, so the Virtualizer renders both diffs in one frame.
      events.length = 0;
      for (const { fileContainer } of diffs) {
        fileContainer.shadowRoot
          ?.querySelector('[data-semantic-fold-toggle]')
          ?.dispatchEvent(
            new window.MouseEvent('click', { bubbles: true, composed: true })
          );
      }
      await waitFor(() => count('[data-semantic-fold]') === 0);
      await wait(30);

      // What happened in each frame.
      const frames = events
        .join(' ')
        .split('frame')
        .map((frame) => frame.trim().split(' ').filter(Boolean));
      // Both diffs were measured in one of them.
      expect(
        frames.some(
          (frame) => frame.filter((event) => event === 'read').length === 2
        )
      ).toBe(true);
      // In no frame does a read come after a write.
      for (const frame of frames) {
        const firstWrite = frame.indexOf('write');
        const reads = firstWrite === -1 ? [] : frame.slice(firstWrite);
        expect(reads).not.toContain('read');
      }
    } finally {
      Element.prototype.getBoundingClientRect = getBoundingClientRect;
      Element.prototype.setAttribute = setAttribute;
      globalThis.requestAnimationFrame = requestAnimationFrame;
      for (const { instance } of diffs) {
        instance.cleanUp();
      }
      dom.cleanup();
    }
  });
});
