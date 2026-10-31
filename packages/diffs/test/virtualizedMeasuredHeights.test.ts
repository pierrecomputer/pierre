import { afterAll, expect, spyOn, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { Virtualizer } from '../src/components/Virtualizer';
import { DEFAULT_THEMES, DEFAULT_VIRTUAL_FILE_METRICS } from '../src/constants';
import { Editor } from '../src/editor/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom, wait, waitFor } from './domHarness';

afterAll(disposeHighlighter);

const { lineHeight } = DEFAULT_VIRTUAL_FILE_METRICS;
const WRAPPED = 'const wrapped = 6;';
const CONTENTS = Array.from({ length: 12 }, (_, index) =>
  index === 5 ? WRAPPED : `const line${index + 1} = ${index + 1};`
).join('\n');
const OLD_CONTENTS = CONTENTS.replace('line9 = 9', 'line9 = nine');

// Every row measures one line high, except the one holding the wrapped text,
// which measures two, whatever line number it has.
function measureRows(): { mockRestore(): void } {
  return spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: Element) {
      const height =
        this instanceof HTMLElement &&
        this.dataset.lineIndex != null &&
        this.textContent?.includes(WRAPPED) === true
          ? lineHeight * 2
          : lineHeight;
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 100,
        bottom: height,
        width: 100,
        height,
        toJSON: () => ({}),
      };
    }
  );
}

test('diff: deleting the rows below a wrapped row drops its measurement', async () => {
  // An added file: every row is an addition, so deleting lines removes rows.
  const dom = installDom();
  const rects = measureRows();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const fileContainer = document.createElement('div');
  root.appendChild(fileContainer);
  const virtualizer = new Virtualizer();
  virtualizer.setup(root);
  const instance = new VirtualizedFileDiff<undefined>(
    {
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      overflow: 'wrap',
      diffStyle: 'unified',
      expandUnchanged: true,
    },
    virtualizer
  );
  const editor = new Editor('file-diff');
  try {
    instance.render({
      fileDiff: parseDiffFromFile(
        { name: 'wrap.ts', contents: '' },
        { name: 'wrap.ts', contents: CONTENTS }
      ),
      fileContainer,
      forceRender: true,
    });
    editor.edit(instance);
    await waitFor(() => editor.getText() === CONTENTS);
    await wait(20);
    instance.reconcileHeights();
    const height = instance.getVirtualizedHeight();
    expect(instance.getLinePosition(6, 'additions')?.height).toBe(
      lineHeight * 2
    );

    // Delete everything after line 1: eleven rows go, the wrapped one among
    // them, and its two lines of height must go with it.
    editor.applyEdits([
      {
        range: {
          start: { line: 0, character: CONTENTS.split('\n')[0].length },
          end: { line: 11, character: CONTENTS.split('\n')[11].length },
        },
        newText: '',
      },
    ]);
    await wait(20);
    expect(instance.getVirtualizedHeight()).toBe(height - lineHeight * 12);
  } finally {
    rects.mockRestore();
    editor.cleanUp();
    instance.cleanUp();
    await wait(0);
    dom.cleanup();
  }
});

for (const surface of ['file', 'diff'] as const) {
  test(`${surface}: an Enter above a wrapped row keeps its measured height`, async () => {
    const dom = installDom();
    const rects = measureRows();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const fileContainer = document.createElement('div');
    root.appendChild(fileContainer);
    const virtualizer = new Virtualizer();
    virtualizer.setup(root);
    const options = {
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      overflow: 'wrap' as const,
    };
    const instance =
      surface === 'file'
        ? new VirtualizedFile<undefined>(options, virtualizer)
        : new VirtualizedFileDiff<undefined>(
            { ...options, diffStyle: 'unified', expandUnchanged: true },
            virtualizer
          );
    const editor = new Editor(surface === 'file' ? 'file' : 'file-diff');
    const position = (lineNumber: number) =>
      instance instanceof VirtualizedFile
        ? instance.getLinePosition(lineNumber)
        : instance.getLinePosition(lineNumber, 'additions');
    try {
      if (instance instanceof VirtualizedFile) {
        instance.render({
          file: { name: 'wrap.ts', contents: CONTENTS },
          fileContainer,
          forceRender: true,
        });
      } else {
        instance.render({
          fileDiff: parseDiffFromFile(
            { name: 'wrap.ts', contents: OLD_CONTENTS },
            { name: 'wrap.ts', contents: CONTENTS }
          ),
          fileContainer,
          forceRender: true,
        });
      }
      editor.edit(instance);
      await waitFor(() => editor.getText() === CONTENTS);
      await wait(20);

      // The attach render may have measured already; measure once more so
      // the wrapped row is known either way.
      instance.reconcileHeights();
      const height = instance.getVirtualizedHeight();
      expect(position(6)?.height).toBe(lineHeight * 2);
      expect(position(7)?.top).toBe(position(6)!.top + lineHeight * 2);

      // Enter at the top moves every row down one line. The measured height
      // is kept, so the surface grows by exactly the new line before any row
      // is measured again, and the render that follows puts the two lines on
      // the wrapped row where it is now.
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: '\n',
        },
      ]);
      expect(instance.getVirtualizedHeight()).toBe(height + lineHeight);

      await wait(20);
      expect(position(7)?.height).toBe(lineHeight * 2);
      expect(position(6)?.height).toBe(lineHeight);
      expect(position(8)?.top).toBe(position(7)!.top + lineHeight * 2);
      expect(instance.getVirtualizedHeight()).toBe(height + lineHeight);
    } finally {
      rects.mockRestore();
      editor.cleanUp();
      instance.cleanUp();
      await wait(0);
      dom.cleanup();
    }
  });
}
