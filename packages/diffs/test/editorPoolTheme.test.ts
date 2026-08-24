import { afterAll, beforeAll, expect, test } from 'bun:test';

import { parseDiffFromFile } from '../src';
import { File } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { Editor } from '../src/editor/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { installDom, wait } from './domHarness';
import {
  createInitializedManager,
  installAnimationFramePolyfill,
} from './workerPoolHarness';

// #1036: a WorkerPool configures the shared highlighter's themes, so an
// attached editor's tokenizer must resolve its theme the same pool-preferring
// way the renderers do. Reading the raw component options pointed it at the
// default pierre-* themes, which the highlighter never loaded, and the
// resulting ShikiError aborted editor setup before contentEditable was
// applied — an edit session with no editable element.

let restoreAnimationFrame: (() => void) | undefined;

beforeAll(() => {
  restoreAnimationFrame = installAnimationFramePolyfill();
});

afterAll(async () => {
  restoreAnimationFrame?.();
  await disposeHighlighter();
});

async function waitForEditable(container: HTMLElement): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const content = Array.from(
      container.shadowRoot?.querySelectorAll<HTMLElement>('[data-content]') ??
        []
    ).find(
      (element) =>
        element.contentEditable === 'true' ||
        element.getAttribute('contenteditable') === 'true'
    );
    if (content != null) {
      return content;
    }
    await wait(10);
  }
  throw new Error('editor content did not become editable');
}

test('File edit mode works when the pool theme differs from component options', async () => {
  const dom = installDom();
  // Fresh shared highlighter so only the pool-configured theme gets loaded —
  // the state a WorkerPoolContextProvider host starts from.
  await disposeHighlighter();
  const { manager } = await createInitializedManager({ theme: 'github-dark' });
  const editor = new Editor<undefined>('file');
  let instance: File<undefined> | undefined;
  try {
    // Component options stay untouched: the default pierre-* themes.
    instance = new File<undefined>({ disableFileHeader: true }, manager);
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    instance.render({
      file: {
        name: 'demo.ts',
        contents: 'const a = 1;\n',
        cacheKey: 'pool-theme:file',
      },
      fileContainer,
      forceRender: true,
    });
    editor.edit(instance);
    const content = await waitForEditable(fileContainer);
    expect(content.getAttribute('role')).toBe('textbox');
  } finally {
    editor.cleanUp();
    instance?.cleanUp();
    manager.terminate();
    dom.cleanup();
  }
});

test('FileDiff edit mode works when the pool theme differs from component options', async () => {
  const dom = installDom();
  await disposeHighlighter();
  const { manager } = await createInitializedManager({ theme: 'github-dark' });
  const editor = new Editor<undefined>('file-diff');
  let instance: FileDiff<undefined> | undefined;
  try {
    instance = new FileDiff<undefined>(
      { disableFileHeader: true, diffStyle: 'split' },
      manager
    );
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const fileDiff = parseDiffFromFile(
      {
        name: 'demo.ts',
        contents: 'const value = "old";\n',
        cacheKey: 'pool-theme:old',
      },
      {
        name: 'demo.ts',
        contents: 'const value = "new";\n',
        cacheKey: 'pool-theme:new',
      }
    );
    instance.render({ fileDiff, fileContainer, forceRender: true });
    editor.edit(instance);
    const content = await waitForEditable(fileContainer);
    expect(content.getAttribute('role')).toBe('textbox');
  } finally {
    editor.cleanUp();
    instance?.cleanUp();
    manager.terminate();
    dom.cleanup();
  }
});
