import { afterAll, describe, expect, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { FileDiffMetadata, SemanticDiffOperation } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import {
  createRoot,
  installDom,
  renderItems,
  wait,
  waitFor,
} from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

// A diff whose first line moved to the end, with a connector for the move.
// `last` is the text of the file's last unchanged line.
function movedDiff(name: string, last: string): FileDiffMetadata {
  const fileDiff = parseDiffFromFile(
    { name, contents: `moved\na\nb\nc\n${last}\n` },
    { name, contents: `a\nb\nc\n${last}\nmoved\n` }
  );
  const operation: SemanticDiffOperation = {
    type: 'moved',
    spans: [
      {
        role: 'root',
        relation: 'moved',
        old: [
          { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } },
        ],
        new: [
          { start: { line: 5, character: 0 }, end: { line: 6, character: 0 } },
        ],
        linePairs: [{ old: { start: 1, end: 1 }, new: { start: 5, end: 5 } }],
      },
    ],
    lines: {
      old: [{ start: 1, end: 1, spanIndex: 0 }],
      new: [{ start: 5, end: 5, spanIndex: 0 }],
    },
  };
  fileDiff.semanticOperations = [operation];
  return fileDiff;
}

describe('CodeView semantic connector batching', () => {
  test('every diff measures its connector column before any connector is drawn', async () => {
    const dom = installDom();
    // jsdom does no layout. Every element reports a box with a size, so the
    // connector column counts as laid out, and the reads and writes on the
    // connector columns are recorded in order.
    const events: string[] = [];
    const { getBoundingClientRect } = Element.prototype;
    const { setAttribute } = Element.prototype;
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
    const viewer = new CodeView<undefined>({
      disableFileHeader: true,
      diffStyle: 'split',
    });
    const root = createRoot({ height: 600 });
    const connectorLayers = () =>
      viewer
        .getRenderedItems()
        .filter(
          (item) =>
            item.element.shadowRoot?.querySelector(
              '[data-semantic-connectors] svg'
            ) != null
        ).length;
    try {
      viewer.setup(root);
      await renderItems(viewer, [
        { id: 'one', type: 'diff', fileDiff: movedDiff('one.txt', 'd') },
        { id: 'two', type: 'diff', fileDiff: movedDiff('two.txt', 'd') },
      ]);
      // The first draw waits a frame for its entrance. Let both diffs get
      // their connector layer.
      await waitFor(() => connectorLayers() === 2);
      await wait(30);

      // Change both diffs, so both render again in one frame.
      events.length = 0;
      await renderItems(viewer, [
        {
          id: 'one',
          type: 'diff',
          fileDiff: movedDiff('one.txt', 'e'),
          version: 1,
        },
        {
          id: 'two',
          type: 'diff',
          fileDiff: movedDiff('two.txt', 'e'),
          version: 1,
        },
      ]);

      const reads = events.filter((event) => event === 'read').length;
      expect(reads).toBe(2);
      expect(events).toContain('write');
      // No read after the first write.
      expect(events.slice(events.indexOf('write'))).not.toContain('read');
    } finally {
      Element.prototype.getBoundingClientRect = getBoundingClientRect;
      Element.prototype.setAttribute = setAttribute;
      viewer.cleanUp();
      await wait(0);
      dom.cleanup();
    }
  });
});
