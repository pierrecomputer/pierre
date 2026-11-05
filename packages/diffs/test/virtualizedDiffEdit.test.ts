import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  spyOn,
  test,
} from 'bun:test';

import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { Virtualizer } from '../src/components/Virtualizer';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import {
  createRoot,
  type DomHandle,
  installDom,
  wait,
  waitFor,
} from './domHarness';

const FILE_NAME = 'src/edit.ts';
const LINE_COUNT = 12;
const OLD_CONTENTS = Array.from(
  { length: LINE_COUNT },
  (_, index) => `line ${index};`
).join('\n');
const CONTENTS = OLD_CONTENTS.replace('line 5;', 'changed 5;');

let dom: DomHandle;
let virtualizer: Virtualizer;
let fileContainer: HTMLElement;
let consoleError: Mock<typeof console.error>;

beforeEach(async () => {
  await disposeHighlighter();
  consoleError = spyOn(console, 'error').mockImplementation(() => {});
  dom = installDom();
  const root = createRoot();
  fileContainer = document.createElement('diffs-container');
  root.appendChild(fileContainer);
  virtualizer = new Virtualizer();
  virtualizer.setup(root);
  await wait(10);
});

afterEach(async () => {
  virtualizer.cleanUp();
  await wait(10);
  dom.cleanup();
  consoleError.mockRestore();
});

function editableContent(): HTMLElement | undefined {
  return Array.from(
    fileContainer.shadowRoot?.querySelectorAll<HTMLElement>('[data-content]') ??
      []
  ).find(
    (element) =>
      element.contentEditable === 'true' ||
      element.getAttribute('contenteditable') === 'true'
  );
}

// Rows in the editable column, including the separators and buffers that
// surround the lines; the edits below only add and remove lines.
function editableLineCount(): number {
  return editableContent()?.children.length ?? 0;
}

describe('editing a virtualized diff', () => {
  for (const diffStyle of ['unified', 'split'] as const) {
    test(`${diffStyle}: keystrokes render in the virtualizer's frame`, async () => {
      const editor = new Editor('file-diff');
      const instance = new VirtualizedFileDiff<undefined>(
        { diffStyle, disableFileHeader: true, theme: DEFAULT_THEMES },
        virtualizer
      );
      try {
        instance.render({
          fileDiff: parseDiffFromFile(
            { name: FILE_NAME, contents: OLD_CONTENTS },
            { name: FILE_NAME, contents: CONTENTS }
          ),
          fileContainer,
          forceRender: true,
        });
        editor.edit(instance);
        await waitFor(() => editableContent() !== undefined, {
          timeout: 3_000,
        });
        await wait(0);
        const linesBefore = editableLineCount();
        expect(linesBefore).toBeGreaterThan(0);

        // A change that keeps the line count patches its row in place.
        editor.applyEdits([
          {
            range: {
              start: { line: 5, character: 0 },
              end: { line: 5, character: 0 },
            },
            newText: 'typed ',
          },
        ]);
        await waitFor(
          () =>
            editableContent()?.textContent?.includes('typed changed 5;') ===
            true
        );
        expect(editableLineCount()).toBe(linesBefore);

        // A change in line count renders in the virtualizer's frame as well.
        editor.applyEdits([
          {
            range: {
              start: { line: 5, character: 'typed changed 5;'.length },
              end: { line: 5, character: 'typed changed 5;'.length },
            },
            newText: '\nadded line;',
          },
        ]);
        expect(editor.getText()).toContain('typed changed 5;\nadded line;');
        await waitFor(
          () => editableContent()?.textContent?.includes('added line;') === true
        );
        expect(editableLineCount()).toBe(linesBefore + 1);

        editor.undo();
        await waitFor(() => editableLineCount() === linesBefore);
        expect(editableContent()?.textContent).not.toContain('added line;');
        await wait(50);
        expect(consoleError).not.toHaveBeenCalled();
      } finally {
        editor.cleanUp();
        instance.cleanUp();
      }
    });
  }
});
