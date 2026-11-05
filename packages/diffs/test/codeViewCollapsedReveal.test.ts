import { afterAll, expect, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import type { CodeViewCreateEditorOptions } from '../src/components/CodeView';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { Editor } from '../src/editor/editor';
import type { EditorType } from '../src/editor/types';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { CodeViewItem } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import {
  createRoot,
  installDom,
  renderItems,
  wait,
  waitFor,
} from './domHarness';

afterAll(disposeHighlighter);

// A thousand lines with a change near each end, so the middle is a collapsed
// region, and a viewport a few lines tall.
const OLD_LINES = Array.from(
  { length: 1000 },
  (_, index) => `line ${index + 1}`
);
const NEW_LINES = OLD_LINES.map((line, index) =>
  index === 9 || index === 989 ? `${line} changed` : line
);
const CONTENTS = NEW_LINES.join('\n');

test('selecting a line inside a collapsed region expands it and scrolls it into view', async () => {
  const { cleanup } = installDom();
  const viewer = new CodeView({
    createEditor: <EType extends EditorType>(
      type: EType,
      options: CodeViewCreateEditorOptions<EType, undefined, undefined>,
      editStateKey?: string
    ): Editor<EType, undefined> => new Editor(type, options, editStateKey),
  });
  const root = createRoot({ height: 180, width: 1000 });
  const item: CodeViewItem<undefined> = {
    id: 'diff:collapsed',
    type: 'diff',
    edit: true,
    fileDiff: parseDiffFromFile(
      { name: 'a.txt', contents: OLD_LINES.join('\n') },
      { name: 'a.txt', contents: CONTENTS }
    ),
  };
  try {
    viewer.setup(root);
    await renderItems(viewer, [item]);
    await waitFor(
      () => viewer.getEditor('diff:collapsed')?.getText() === CONTENTS
    );
    const editor = viewer.getEditor('diff:collapsed');
    const instance = viewer.getRenderedItems()[0]?.instance;
    if (editor == null || !(instance instanceof VirtualizedFileDiff)) {
      throw new Error('expected an editor on a diff');
    }
    expect(instance.isLineRenderable(500)).toBe(false);

    editor.setSelections([
      {
        start: { line: 499, character: 0 },
        end: { line: 499, character: 0 },
        direction: 'none',
      },
    ]);
    await wait(50);

    expect(instance.isLineRenderable(500)).toBe(true);
    expect(root.scrollTop).toBeGreaterThan(0);
    const row = viewer
      .getRenderedItems()[0]
      ?.element.querySelector('diffs-container')
      ?.shadowRoot?.querySelector('[data-content] > [data-line="500"]');
    expect(row).not.toBeNull();
  } finally {
    viewer.cleanUp();
    cleanup();
  }
});
