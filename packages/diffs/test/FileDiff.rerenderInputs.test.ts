import { afterAll, expect, test } from 'bun:test';

import { disposeHighlighter, FileDiff, parseDiffFromFile } from '../src';
import type {
  DiffsEditor,
  FileDiffMetadata,
  HighlightedToken,
} from '../src/types';
import { installDom, wait, waitFor } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

// Waits until the first rendered row keeps the same DOM node across several
// consecutive samples, so late async highlight rerenders (which rebuild rows)
// cannot race the identity assertions below.
async function waitForStableRow(
  fileContainer: HTMLElement
): Promise<Element | null> {
  let row: Element | null = null;
  let stableSamples = 0;
  for (let attempt = 0; attempt < 80; attempt++) {
    const current =
      fileContainer.shadowRoot?.querySelector('[data-line="1"]') ?? null;
    if (current != null && current === row) {
      stableSamples++;
      if (stableSamples >= 4) {
        return current;
      }
    } else {
      row = current;
      stableSamples = 0;
    }
    await wait(25);
  }
  return row;
}

function createEditorStub(): DiffsEditor<undefined> {
  return {
    cleanUp() {},
    edit: () => () => {},
    __captureFocusForDOMReplacement() {},
    __getDocumentContents: () => undefined,
    __postponeBgTokenizeToNextFrame() {},
    __syncRenderView() {},
  };
}

function createDiff(name: string, marker: string): FileDiffMetadata {
  return parseDiffFromFile(
    { name, contents: 'const base = 0;\n' },
    { name, contents: `const ${marker} = 1;\n` }
  );
}

// FileDiff.render stored deletionFile/additionFile from the render input even
// when none was passed. Internal rerenders (highlight completions, hunk
// expansion) pass no input, so they wiped the stored pair, and every later
// host render on the oldFile/newFile API saw filesDidChange — defeating the
// early-return with a full Myers reparse and DOM rebuild each time.
// File.rerender re-passes its stored file, so the file twin never had this.
test('a host render after an internal rerender takes the early-return path', async () => {
  const { cleanup } = installDom();
  let instance: FileDiff<undefined> | undefined;
  try {
    const oldFile = { name: 'x.ts', contents: 'alpha\nbravo\ncharlie\n' };
    const newFile = { name: 'x.ts', contents: 'alpha\nBRAVO\ncharlie\n' };
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    instance = new FileDiff<undefined>({
      disableFileHeader: true,
      diffStyle: 'split',
    });

    instance.render({ oldFile, newFile, fileContainer });
    await waitForStableRow(fileContainer);

    // An internal input-less rerender — what every worker highlight
    // completion and hunk expansion triggers.
    instance.rerender();
    const rowBefore = await waitForStableRow(fileContainer);
    expect(rowBefore != null).toBe(true);

    // Host render re-passing the same file objects (the documented
    // oldFile/newFile API shape): same inputs, no force, no theme or
    // annotation change. It must early-return and leave the DOM untouched.
    instance.render({ oldFile, newFile, fileContainer });
    const rowAfter =
      fileContainer.shadowRoot?.querySelector('[data-line="1"]') ?? null;
    expect(rowAfter === rowBefore).toBe(true);
  } finally {
    instance?.cleanUp();
    cleanup();
  }
});

test('parsed unkeyed diffs with the same filename render fresh contents', async () => {
  const { cleanup } = installDom();
  let instance: FileDiff<undefined> | undefined;
  try {
    const firstDiff = parseDiffFromFile(
      { name: 'same.ts', contents: 'const base = 0;\n' },
      { name: 'same.ts', contents: 'const firstMarker = 1;\n' }
    );
    const secondDiff = parseDiffFromFile(
      { name: 'same.ts', contents: 'const base = 0;\n' },
      { name: 'same.ts', contents: 'const secondMarker = 2;\n' }
    );
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    instance = new FileDiff<undefined>({
      disableFileHeader: true,
      diffStyle: 'unified',
    });

    expect(firstDiff.cacheKey).toBeUndefined();
    expect(secondDiff.cacheKey).toBeUndefined();

    instance.render({ fileDiff: firstDiff, fileContainer });
    await waitFor(
      () =>
        fileContainer.shadowRoot?.textContent?.includes('firstMarker') === true
    );
    expect(fileContainer.shadowRoot?.textContent).toContain('firstMarker');

    instance.render({ fileDiff: secondDiff, fileContainer });
    await waitFor(
      () =>
        fileContainer.shadowRoot?.textContent?.includes('secondMarker') === true
    );

    expect(fileContainer.shadowRoot?.textContent).toContain('secondMarker');
    expect(fileContainer.shadowRoot?.textContent).not.toContain('firstMarker');
    expect(firstDiff.cacheKey).toBeUndefined();
    expect(secondDiff.cacheKey).toBeUndefined();
  } finally {
    instance?.cleanUp();
    cleanup();
  }
});

test('a dirty unkeyed session remains authoritative when the same object is re-passed', async () => {
  const { cleanup } = installDom();
  const externalDiff = createDiff('same.ts', 'firstMarker');
  const externalAdditionLines = externalDiff.additionLines;
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);
  const instance = new FileDiff<undefined>({ disableFileHeader: true });

  try {
    instance.render({ fileDiff: externalDiff, fileContainer });
    await waitForStableRow(fileContainer);
    const detach = instance.attachEditor(createEditorStub());
    instance.updateRenderCache(
      new Map<number, HighlightedToken[]>([
        [0, [[0, '', 'const editedMarker = 3;']]],
      ]),
      'light'
    );

    instance.render({
      fileDiff: externalDiff,
      fileContainer,
      forceRender: true,
    });
    await waitFor(
      () =>
        fileContainer.shadowRoot?.textContent?.includes('editedMarker') === true
    );

    expect(instance.fileDiff).toBe(externalDiff);
    expect(externalDiff.additionLines).toBe(externalAdditionLines);
    expect(externalDiff.additionLines.join('')).toContain('firstMarker');
    expect(externalDiff.additionLines.join('')).not.toContain('editedMarker');
    detach(false, {});
  } finally {
    instance.cleanUp();
    cleanup();
  }
});
