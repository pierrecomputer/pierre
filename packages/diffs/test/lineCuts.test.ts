import { createTwoFilesPatch } from '@pierre/patches';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  test,
} from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import { File } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { Virtualizer } from '../src/components/Virtualizer';
import { Editor } from '../src/editor/editor';
import {
  disposeHighlighter,
  preloadHighlighter,
} from '../src/highlighter/shared_highlighter';
import { i18n } from '../src/i18n/I18n';
import { preloadFile, preloadFileDiff } from '../src/ssr';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { parsePatchFiles } from '../src/utils/parsePatchFiles';
import { WorkerPoolManager } from '../src/worker/WorkerPoolManager';
import {
  createRoot,
  dispatchScroll,
  installDom,
  renderItems,
  waitFor,
} from './domHarness';

const options = {
  disableErrorHandling: true,
  disableFileHeader: true,
  tokenizeMaxLineLength: 4,
  useTokenTransformer: true,
};
const file = { name: 'example.txt', contents: '12345\r\n1234\r\n123😀tail' };
const context = 'shared context';
const oldFile = {
  name: 'example.txt',
  contents: 'old suffix\n' + context + '\nsecond context',
};
const newFile = {
  name: 'example.txt',
  contents: 'new suffix\nextra\n' + context + '\nsecond context',
};
const fileDiff = parseDiffFromFile(oldFile, newFile);

let dom: ReturnType<typeof installDom>;
let container: HTMLElement;
beforeAll(() =>
  preloadHighlighter({
    themes: ['pierre-dark', 'pierre-light'],
    langs: ['text'],
  })
);
afterAll(disposeHighlighter);
beforeEach(() => {
  dom = installDom();
  container = document.createElement('diffs-container');
  document.body.appendChild(container);
});
afterEach(() => {
  dom.cleanup();
  i18n.set();
});

// Reads a rendered content row, optionally from one side of the diff.
function row(line: number, column = ''): HTMLElement {
  const found = container.shadowRoot?.querySelector<HTMLElement>(
    column + ' [data-line="' + line + '"]'
  );
  if (found == null) throw new Error('Missing row ' + line + ' in ' + column);
  return found;
}

// Presses the expansion button as a pointer gesture.
function expand(line: HTMLElement): void {
  const button = line.querySelector('button');
  if (button == null) throw new Error('Missing expansion button');
  button.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      composed: true,
      pointerType: 'mouse',
    })
  );
  button.click();
}

test('a file cuts only longer lines and preserves the other rows on expansion', () => {
  const onLineClick = mock();
  const onTokenClick = mock();
  const onLineNumberClick = mock();
  const onLineSelectionStart = mock();
  const instance = new File({
    ...options,
    onLineClick,
    onTokenClick,
    onLineNumberClick,
    onLineSelectionStart,
    enableLineSelection: true,
  });
  try {
    instance.render({ file, fileContainer: container });
    const exact = row(2);
    const surrogate = row(3);
    expect(row(1).textContent).toBe('1234');
    expect(exact.textContent).toBe('1234');
    expect(exact.querySelector('button')).toBeNull();
    expect(surrogate.textContent).toBe('123');
    expect(surrogate.lastElementChild?.tagName).toBe('BUTTON');
    expand(row(1));
    expect(row(1).textContent).toBe('12345');
    expect(row(1).querySelector('button')).toBeNull();
    expect(row(2)).toBe(exact);
    expect(row(3)).toBe(surrogate);
    for (const callback of [
      onLineClick,
      onLineNumberClick,
      onTokenClick,
      onLineSelectionStart,
    ])
      expect(callback).not.toHaveBeenCalled();
  } finally {
    instance.cleanUp();
  }
});

test('the default is 1000 and zero disables cutting', () => {
  const instance = new File({ disableFileHeader: true });
  const longFile = { name: 'long.txt', contents: 'a'.repeat(1001) };
  try {
    instance.render({ file: longFile, fileContainer: container });
    expect(row(1).textContent).toHaveLength(1000);
    instance.setOptions({ disableFileHeader: true, tokenizeMaxLineLength: 0 });
    instance.rerender();
    expect(row(1).textContent).toBe(longFile.contents);
    expect(row(1).querySelector('button')).toBeNull();
  } finally {
    instance.cleanUp();
  }
});

test('a working pool supplies the cut length for both components', async () => {
  const pool = new WorkerPoolManager(
    {
      poolSize: 1,
      workerFactory: () =>
        new Worker(new URL('../src/worker/worker.ts', import.meta.url)),
    },
    { theme: 'pierre-dark', tokenizeMaxLineLength: 2 }
  );
  const instance = new File(options, pool);
  const diff = new FileDiff(options, pool);
  try {
    await pool.initialize();
    instance.render({ file, fileContainer: container });
    expect(row(1).textContent).toBe('12');
    const other = document.createElement('diffs-container');
    diff.render({ fileDiff, fileContainer: other });
    expect(
      other.shadowRoot?.querySelector(
        '[data-line][data-line-type="change-deletion"]'
      )?.textContent
    ).toBe('ol');
  } finally {
    diff.cleanUp();
    instance.cleanUp();
    pool.terminate();
  }
});

test('new limits keep expansions and replacement contents forget them', () => {
  const instance = new File(options);
  try {
    instance.render({ file, fileContainer: container });
    expand(row(1));
    instance.setOptions({ ...options, tokenizeMaxLineLength: 2 });
    instance.rerender();
    expect(row(1).textContent).toBe('12345');
    expect(row(2).textContent).toBe('12');
    instance.render({ file: { ...file, contents: 'abcde' } });
    expect(row(1).textContent).toBe('ab');
    expect(row(1).querySelector('button')).not.toBeNull();
  } finally {
    instance.cleanUp();
  }
});

test('a diff keeps expansion across limits and forgets it for a new diff', () => {
  const instance = new FileDiff(options);
  try {
    instance.render({ fileDiff, fileContainer: container });
    expand(row(1, '[data-deletions]'));
    instance.setOptions({ ...options, tokenizeMaxLineLength: 2 });
    instance.rerender();
    expect(row(1, '[data-deletions]').textContent).toBe('old suffix');
    expect(row(1, '[data-additions]').textContent).toBe('ne');
    instance.render({
      fileDiff: parseDiffFromFile(
        { ...oldFile, contents: 'another old line' },
        newFile
      ),
    });
    expect(row(1, '[data-deletions]').textContent).toBe('an');
    expect(row(1, '[data-deletions]').querySelector('button')).not.toBeNull();
  } finally {
    instance.cleanUp();
  }
});

test('a cut inside a word-diff mark leaves the button outside the mark', () => {
  const instance = new FileDiff({
    ...options,
    lineDiffType: 'word-alt',
    maxLineDiffLength: 100,
  });
  try {
    instance.render({
      fileDiff: parseDiffFromFile(
        { name: 'marked.txt', contents: 'different ending' },
        { name: 'marked.txt', contents: 'replacement ending' }
      ),
      fileContainer: container,
    });
    const cut = row(1, '[data-additions]');
    expect(cut.textContent).toBe('repl');
    expect(cut.querySelector('[data-diff-span]')?.textContent).toBe('repl');
    expect(cut.lastChild).toBe(cut.querySelector('button'));
    expand(cut);
    expect(row(1, '[data-additions]').textContent).toBe('replacement ending');
  } finally {
    instance.cleanUp();
  }
});

test('changing the messages updates the button label and keeps expanded lines', () => {
  const instance = new File(options);
  try {
    instance.render({ file, fileContainer: container });
    expect(row(1).lastElementChild?.getAttribute('aria-label')).toBe(
      'Show full line'
    );
    expand(row(3));
    i18n.set({ messages: { expandLine: 'Afficher la ligne entière' } });
    expect(row(3).textContent).toBe('123😀tail');
    expect(row(3).querySelector('button')).toBeNull();
    expect(row(1).lastElementChild?.getAttribute('aria-label')).toBe(
      'Afficher la ligne entière'
    );
  } finally {
    instance.cleanUp();
  }
});

for (const diffStyle of ['unified', 'split'] as const) {
  test(
    diffStyle +
      ' expands changed lines independently and shared lines together',
    () => {
      const instance = new FileDiff({
        ...options,
        diffStyle,
        lineDiffType: 'char',
        maxLineDiffLength: 100,
      });
      const added = '[data-line-type="change-addition"]';
      const removed = '[data-line-type="change-deletion"]';
      try {
        instance.render({ fileDiff, fileContainer: container });
        const changed = (selector: string) =>
          container.shadowRoot?.querySelector<HTMLElement>(
            '[data-line="1"]' + selector
          );
        const oldRow = changed(removed);
        const newRow = changed(added);
        if (oldRow == null || newRow == null)
          throw new Error('Missing changed row');
        expect(oldRow.textContent).toBe('old ');
        expect(newRow.textContent).toBe('new ');
        expect(oldRow.querySelector('[data-diff-span]')?.textContent).toBe(
          'old'
        );
        expand(oldRow);
        expect(changed(removed)?.textContent).toBe('old suffix');
        expect(changed(added)?.textContent).toBe('new ');
        const additions = diffStyle === 'split' ? '[data-additions]' : '';
        expand(row(3, additions));
        expect(row(3, additions).textContent).toBe(context);
        if (diffStyle === 'split') {
          expect(row(2, '[data-deletions]').textContent).toBe(context);
          expand(row(3, '[data-deletions]'));
          expect(row(4, additions).textContent).toBe('second context');
        } else {
          instance.setOptions({ ...options, diffStyle: 'split' });
          instance.rerender();
          expect(row(2, '[data-deletions]').textContent).toBe(context);
        }
      } finally {
        instance.cleanUp();
      }
    }
  );

  test(
    diffStyle +
      ' shows both sides in full while editing and keeps expanded lines on discard',
    async () => {
      const instance = new FileDiff({ ...options, diffStyle });
      const editor = new Editor('file-diff');
      const oldRow = '[data-line][data-line-type="change-deletion"]';
      const newRow = '[data-line][data-line-type="change-addition"]';
      try {
        instance.render({ fileDiff, fileContainer: container });
        const shadow = container.shadowRoot;
        expect(shadow?.querySelector(oldRow)?.textContent).toBe('old ');
        expect(shadow?.querySelector(newRow)?.textContent).toBe('new ');
        const additions = diffStyle === 'split' ? '[data-additions]' : '';
        expand(row(3, additions));
        const finish = editor.edit(instance);
        await waitFor(
          () => shadow?.querySelector(newRow)?.textContent === 'new suffix'
        );
        expect(shadow?.querySelector(oldRow)?.textContent).toBe('old suffix');
        expect(shadow?.querySelector(newRow)?.textContent).toBe('new suffix');
        expect(shadow?.querySelector('[data-expand-line]')).toBeNull();
        finish();
        expect(row(3, additions).textContent).toBe(context);
        expect(row(3, additions).querySelector('button')).toBeNull();
        expect(shadow?.querySelector(oldRow)?.textContent).toBe('old ');
        expect(shadow?.querySelector(newRow)?.textContent).toBe('new ');
      } finally {
        editor.cleanUp();
        instance.cleanUp();
      }
    }
  );
}

test('an accepted diff forgets expansion even when the text is unchanged', async () => {
  const instance = new FileDiff({ ...options, onEditComplete: () => 'accept' });
  try {
    instance.render({ fileDiff, fileContainer: container });
    for (const change of [false, true]) {
      expand(row(2, '[data-deletions]'));
      const editor = new Editor('file-diff');
      const finish = editor.edit(instance);
      await waitFor(() => editor.getText() === newFile.contents);
      if (change) {
        editor.applyEdits([
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: 'x',
          },
        ]);
      }
      finish();
      expect(row(2, '[data-deletions]').textContent).toBe('shar');
      expect(row(3, '[data-additions]').textContent).toBe('shar');
    }
  } finally {
    instance.cleanUp();
  }
});

test('an accepted file starts with nothing expanded even when the text is unchanged', async () => {
  const instance = new File({ ...options, onEditComplete: () => 'accept' });
  try {
    instance.render({ file, fileContainer: container });
    for (const change of [false, true]) {
      expand(row(1));
      expect(row(3).querySelector('button')).not.toBeNull();
      const editor = new Editor('file');
      const finish = editor.edit(instance);
      await waitFor(() => editor.getText() === file.contents);
      expect(row(3).textContent).toBe('123😀tail');
      expect(row(3).querySelector('button')).toBeNull();
      if (change)
        editor.applyEdits([
          {
            range: {
              start: { line: 1, character: 0 },
              end: { line: 1, character: 0 },
            },
            newText: 'x',
          },
        ]);
      finish();
      expect(row(1).textContent).toBe('1234');
      expect(row(3).textContent).toBe('123');
    }
  } finally {
    instance.cleanUp();
  }
});

test('CodeView remembers an expanded line after recycling the item', async () => {
  const viewer = new CodeView(options);
  const root = createRoot({ height: 120 });
  try {
    const items = ['first', 'second'].map((id) => ({
      type: 'file' as const,
      id,
      file: { name: id + '.txt', contents: (id + ' long line\n').repeat(100) },
    }));
    viewer.setup(root);
    await renderItems(viewer, items);
    const first = viewer.getRenderedItems()[0];
    expect(first.id).toBe('first');
    container = first.element;
    expect(row(1).textContent).toBe('firs');
    expand(row(1));
    await waitFor(() => row(1).textContent === 'first long line');
    expect(row(1).textContent).toBe('first long line');
    for (const [top, id] of [
      [2400, 'second'],
      [0, 'first'],
    ] as const) {
      root.scrollTop = top;
      dispatchScroll(root);
      viewer.render(true);
      await waitFor(() => viewer.getRenderedItems()[0]?.id === id);
      expect(viewer.getRenderedItems().map((item) => item.id)).toEqual([id]);
    }
    container = viewer.getRenderedItems()[0].element;
    expect(row(1).textContent).toBe('first long line');
    expect(row(2).textContent).toBe('firs');
  } finally {
    viewer.cleanUp();
  }
});

test('discarding an editor cuts long lines again and keeps expanded ones', async () => {
  const instance = new File(options);
  const editor = new Editor('file');
  try {
    instance.render({ file, fileContainer: container });
    expand(row(3));
    editor.edit(instance);
    await waitFor(() => row(1).textContent === '12345');
    expect(row(1).textContent).toBe('12345');
    editor.cleanUp();
    await waitFor(() => row(1).textContent === '1234');
    expect(row(1).textContent).toBe('1234');
    expect(row(1).querySelector('button')).not.toBeNull();
    expect(row(3).textContent).toBe('123😀tail');
    expect(row(3).querySelector('button')).toBeNull();
  } finally {
    instance.cleanUp();
  }
});

test('an expanded line stays expanded when a partial diff loads its files', async () => {
  const numbered = (changed: string) =>
    ['l1', 'l2', 'l3', 'long line four', 'l5', 'l6', 'l7', changed, 'l9']
      .map((line) => line + '\n')
      .join('');
  const loadedOld = { name: 'example.txt', contents: numbered('old eight') };
  const loadedNew = { name: 'example.txt', contents: numbered('new eight') };
  const partial = parsePatchFiles(
    createTwoFilesPatch(
      loadedOld.name,
      loadedNew.name,
      loadedOld.contents,
      loadedNew.contents,
      undefined,
      undefined,
      { context: 2 }
    )
  )[0].files[0];
  const instance = new FileDiff({
    ...options,
    diffStyle: 'split',
    loadDiffFiles: () =>
      Promise.resolve({ oldFile: loadedOld, newFile: loadedNew }),
  });
  try {
    instance.render({ fileDiff: partial, fileContainer: container });
    expand(row(8, '[data-additions]'));
    expect(row(8, '[data-additions]').textContent).toBe('new eight');

    // Line 4 is above the patch. It arrives with the full files, cut off.
    instance.expandHunk(0, 'up');
    await waitFor(
      () =>
        container.shadowRoot?.querySelector(
          '[data-additions] [data-line="4"]'
        ) != null
    );
    expect(row(4, '[data-additions]').textContent).toBe('long');
    expect(row(4, '[data-additions]').querySelector('button')).not.toBeNull();
    expect(row(8, '[data-additions]').textContent).toBe('new eight');
    expect(row(8, '[data-additions]').querySelector('button')).toBeNull();
  } finally {
    instance.cleanUp();
  }
});

test('hovering the button keeps its line hovered', () => {
  const onLineEnter = mock();
  const onLineLeave = mock();
  const instance = new File({
    ...options,
    lineHoverHighlight: 'both',
    onLineEnter,
    onLineLeave,
  });
  const move = (element: Element) =>
    element.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        composed: true,
        pointerType: 'mouse',
      })
    );
  try {
    instance.render({ file, fileContainer: container });
    const line = row(1);
    const button = line.querySelector('button');
    if (button == null) throw new Error('Missing expansion button');
    move(line);
    move(button);
    move(line);
    expect(onLineEnter).toHaveBeenCalledTimes(1);
    expect(onLineLeave).not.toHaveBeenCalled();
  } finally {
    instance.cleanUp();
  }
});

test('Virtualizer renders the expanded file line', async () => {
  const virtualizer = new Virtualizer();
  const root = createRoot();
  root.appendChild(container);
  virtualizer.setup(root);
  const instance = new VirtualizedFile(options, virtualizer);
  try {
    instance.render({ file, fileContainer: container });
    await waitFor(
      () =>
        container.shadowRoot?.querySelector('button[data-expand-line]') != null
    );
    expect(row(1).textContent).toBe('1234');
    expand(row(1));
    await waitFor(() => row(1).textContent === '12345');
    expect(row(1).textContent).toBe('12345');
  } finally {
    instance.cleanUp();
    virtualizer.cleanUp();
  }
});

for (const kind of ['file', 'diff']) {
  test(
    kind + ' adopts a prerendered cut row and expands on the first click',
    async () => {
      const html =
        kind === 'file'
          ? await preloadFile({ file, options })
          : await preloadFileDiff({ fileDiff, options });
      const shadow = container.attachShadow({ mode: 'open' });
      shadow.innerHTML = html.prerenderedHTML;
      const button = shadow.querySelector('button[data-expand-line]');
      if (!(button instanceof HTMLButtonElement))
        throw new Error('Missing prerendered button');
      const expected = kind === 'file' ? '12345' : 'old suffix';
      expect(button.parentElement?.textContent).toBe(expected.slice(0, 4));
      const instance =
        kind === 'file' ? new File(options) : new FileDiff(options);
      try {
        if (instance instanceof File)
          instance.hydrate({ file, fileContainer: container });
        else instance.hydrate({ fileDiff, fileContainer: container });
        expect(shadow.querySelector('button[data-expand-line]')).toBe(button);
        button.click();
        await waitFor(() =>
          Array.from(shadow.querySelectorAll('[data-line]')).some(
            (el) => el.textContent === expected
          )
        );
        expect(
          Array.from(
            shadow.querySelectorAll('[data-line]'),
            (el) => el.textContent
          )
        ).toContain(expected);
      } finally {
        instance.cleanUp();
      }
    }
  );
}
