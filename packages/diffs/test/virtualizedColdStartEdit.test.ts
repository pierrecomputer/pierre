import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  spyOn,
  test,
} from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { Virtualizer } from '../src/components/Virtualizer';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import type { EditorType } from '../src/editor/types';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { FileContents, FileDiffMetadata } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import {
  createRoot,
  type DomHandle,
  installDom,
  wait,
  waitFor,
} from './domHarness';

const FILE_NAME = 'src/cold.ts';
const CONTENTS = 'alpha();\nnext();\nend();';
const OLD_CONTENTS = 'alpha();\nprevious();\nend();';

function findEditableContent(container: HTMLElement): HTMLElement | undefined {
  return Array.from(
    container.shadowRoot?.querySelectorAll<HTMLElement>('[data-content]') ?? []
  ).find(
    (element) =>
      element.contentEditable === 'true' ||
      element.getAttribute('contenteditable') === 'true'
  );
}

let dom: DomHandle;
let virtualizer: Virtualizer;
let fileContainer: HTMLElement;
let consoleError: Mock<typeof console.error>;

// Every case starts from a cold highlighter so the first render cannot paint
// synchronously and leaves a pending render behind.
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

// The rerender that completes the highlight runs in a queued frame, and the
// render queue reports a throwing frame through console.error instead of
// failing the test on its own, so that channel is asserted explicitly.
async function expectEditableAfterHighlight(): Promise<void> {
  await waitFor(() => findEditableContent(fileContainer) !== undefined, {
    timeout: 3_000,
  });
  await wait(0);
  expect(findEditableContent(fileContainer)).toBeDefined();
  expect(
    fileContainer.shadowRoot?.querySelector('[data-code]:not([data-deletions])')
  ).toBeInstanceOf(HTMLElement);
  expect(consoleError).not.toHaveBeenCalled();
}

describe('editing before a cold first render completes', () => {
  test('VirtualizedFile renders the session file once the highlight lands', async () => {
    const editor = new Editor<EditorType, undefined, undefined>('file');
    const file: FileContents = { name: FILE_NAME, contents: CONTENTS };
    const instance = new VirtualizedFile<undefined>(
      { disableFileHeader: true, theme: DEFAULT_THEMES },
      virtualizer
    );
    expect(instance.render({ file, fileContainer, forceRender: true })).toBe(
      false
    );
    editor.edit(instance);
    await expectEditableAfterHighlight();
    editor.cleanUp();
    instance.cleanUp();
  });

  for (const diffStyle of ['unified', 'split'] as const) {
    test(`VirtualizedFileDiff ${diffStyle} renders the session diff once the highlight lands`, async () => {
      const editor = new Editor<EditorType, undefined, undefined>('file-diff');
      const fileDiff: FileDiffMetadata = parseDiffFromFile(
        { name: FILE_NAME, contents: OLD_CONTENTS },
        { name: FILE_NAME, contents: CONTENTS }
      );
      const instance = new VirtualizedFileDiff<undefined>(
        { diffStyle, disableFileHeader: true, theme: DEFAULT_THEMES },
        virtualizer
      );
      expect(
        instance.render({ fileDiff, fileContainer, forceRender: true })
      ).toBe(false);
      editor.edit(instance);
      await expectEditableAfterHighlight();
      editor.cleanUp();
      instance.cleanUp();
    });
  }
});
