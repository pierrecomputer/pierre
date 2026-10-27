import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test';

import { File, type FileOptions } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { Virtualizer } from '../src/components/Virtualizer';
import { Editor } from '../src/editor/editor';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { createRoot, installDom, wait, waitFor } from './domHarness';

// Each test loads its backend fresh: only one highlighter type can be loaded.
beforeEach(disposeHighlighter);
afterAll(disposeHighlighter);

test.each(['file', 'virtualized'])(
  'Highlights repaints %s rows shifted by edits with no net line-count change',
  async (type) => {
    await getSharedHighlighter({
      preferredHighlighter: 'highlights',
      themes: ['pierre-dark'],
      langs: ['typescript'],
    });
    const dom = installDom();
    const root = createRoot();
    const fileContainer = document.createElement('div');
    root.appendChild(fileContainer);
    const contents = [
      'const x = 1;',
      'const b = 2;',
      'const c = 3;',
      'const d = 4;',
      'const e = 5;',
      'const f = 6;',
    ].join('\n');
    const options: FileOptions<undefined, undefined> = {
      preferredHighlighter: 'highlights',
      theme: 'pierre-dark',
      disableErrorHandling: true,
      disableFileHeader: true,
    };
    const virtualizer = type === 'virtualized' ? new Virtualizer() : undefined;
    virtualizer?.setup(root);
    const file =
      virtualizer != null
        ? new VirtualizedFile(options, virtualizer)
        : new File(options);
    const editor = new Editor('file');
    try {
      const source = { name: 'batch.ts', contents, lang: 'typescript' };
      file.render({
        file: source,
        fileContainer,
        forceRender: true,
        renderRange: {
          startingLine: 0,
          totalLines: 6,
          bufferBefore: 0,
          bufferAfter: 0,
        },
      });
      editor.edit(file);
      await waitFor(() => editor.getText() === contents);
      // Settle the initial tokenization before testing a structural batch.
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 6 },
            end: { line: 0, character: 7 },
          },
          newText: 'a',
        },
      ]);
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: 'const z = 0;\n',
        },
        {
          range: {
            start: { line: 4, character: 0 },
            end: { line: 5, character: 0 },
          },
          newText: '',
        },
      ]);

      const expected = [
        'const z = 0;',
        'const a = 1;',
        'const b = 2;',
        'const c = 3;',
        'const d = 4;',
        'const f = 6;',
      ];
      expect(editor.getText()).toBe(expected.join('\n'));
      // A virtualized file renders in the virtualizer's frame.
      const rowTexts = () =>
        Array.from(
          fileContainer.shadowRoot!.querySelectorAll(
            '[data-content] [data-line]'
          ),
          (row) => row.textContent
        );
      await waitFor(() => rowTexts().join('\n') === expected.join('\n'));
      expect(rowTexts()).toEqual(expected);
    } finally {
      editor.cleanUp();
      file.cleanUp();
      virtualizer?.cleanUp();
      dom.cleanup();
    }
  }
);

test('Highlights finishes every visible line an edit recolors in the same pass', async () => {
  await getSharedHighlighter({
    preferredHighlighter: 'highlights',
    themes: ['pierre-dark'],
    langs: ['typescript'],
  });
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);
  const contents = Array.from(
    { length: 40 },
    (_, i) => `const value${i} = ${i};`
  ).join('\n');
  const file = new File({
    preferredHighlighter: 'highlights',
    theme: 'pierre-dark',
    disableErrorHandling: true,
    disableFileHeader: true,
  });
  const editor = new Editor('file');
  const content = () =>
    fileContainer.shadowRoot?.querySelector('[data-content]')?.innerHTML;
  try {
    file.render({
      file: { name: 'recolor.ts', contents, lang: 'typescript' },
      fileContainer,
      forceRender: true,
      renderRange: {
        startingLine: 0,
        totalLines: 40,
        bufferBefore: 0,
        bufferAfter: 0,
      },
    });
    editor.edit(file);
    await waitFor(() => editor.getText() === contents);
    await wait(100);
    const before = content();
    // Opening a comment recolors every line below it.
    withExhaustedTimeBudget(() =>
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: '/*',
        },
      ])
    );
    const afterEdit = content();
    expect(afterEdit).not.toBe(before);
    // Nothing visible may change once background tokenizing finishes.
    await wait(200);
    expect(content()).toBe(afterEdit);
  } finally {
    editor.cleanUp();
    file.cleanUp();
    dom.cleanup();
  }
});

test('Highlights primes the attached window, so the first edit touches only its line', async () => {
  await getSharedHighlighter({
    preferredHighlighter: 'highlights',
    themes: ['pierre-dark'],
    langs: ['typescript'],
  });
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);
  const contents = Array.from(
    { length: 300 },
    (_, i) => `const value${i} = ${i};`
  ).join('\n');
  const file = new File({
    preferredHighlighter: 'highlights',
    theme: 'pierre-dark',
    disableErrorHandling: true,
    disableFileHeader: true,
    useTokenTransformer: true,
  });
  const editor = new Editor('file');
  // The lines the editor hands the component tokens for, per change.
  const tokenCounts: number[] = [];
  const applyChange = file.applyChange.bind(file);
  file.applyChange = (document, change, options) => {
    tokenCounts.push(options?.tokens?.size ?? 0);
    return applyChange(document, change, options);
  };
  const rows = () =>
    Array.from(
      fileContainer.shadowRoot?.querySelectorAll<HTMLElement>(
        '[data-content] [data-line]'
      ) ?? []
    );
  try {
    file.render({
      file: { name: 'primed.ts', contents, lang: 'typescript' },
      fileContainer,
      forceRender: true,
      renderRange: {
        startingLine: 0,
        totalLines: 100,
        bufferBefore: 0,
        bufferAfter: 0,
      },
    });
    editor.edit(file);
    await waitFor(() => editor.getText() === contents);
    const before = rows();
    const markupBefore = before.map((row) => row.innerHTML);
    // No settling: the window was lexed when the editor attached.
    editor.applyEdits([
      {
        range: {
          start: { line: 50, character: 0 },
          end: { line: 50, character: 0 },
        },
        newText: 'x',
      },
    ]);
    expect(tokenCounts).toEqual([1]);
    const after = rows();
    expect(after).toEqual(before);
    const changed = after.flatMap((row, index) =>
      row.innerHTML === markupBefore[index] ? [] : [index]
    );
    expect(changed).toEqual([50]);

    // A line break adds one row and pushes the last one out of the window;
    // the rows between move and keep their markup. The lexer re-reads the
    // split line's remainder, at most.
    const beforeEnter = rows();
    const markupBeforeEnter = beforeEnter.map((row) => row.innerHTML);
    editor.applyEdits([
      {
        range: {
          start: { line: 60, character: 0 },
          end: { line: 60, character: 0 },
        },
        newText: '\n',
      },
    ]);
    expect(tokenCounts[1]).toBeLessThanOrEqual(2);
    const afterEnter = rows();
    expect(afterEnter.length).toBe(beforeEnter.length);
    const keptChanged = beforeEnter.flatMap((row, index) =>
      row.isConnected && row.innerHTML !== markupBeforeEnter[index]
        ? [index]
        : []
    );
    expect(keptChanged.every((index) => index === 60)).toBe(true);
    const removed = beforeEnter.filter((row) => !row.isConnected);
    expect(removed).toEqual([beforeEnter[beforeEnter.length - 1]]);
  } finally {
    editor.cleanUp();
    file.cleanUp();
    dom.cleanup();
  }
});

test('Highlights colors a file rendered plain for its size once the editor attaches', async () => {
  await getSharedHighlighter({
    preferredHighlighter: 'highlights',
    themes: ['pierre-dark'],
    langs: ['typescript'],
  });
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);
  const contents = Array.from(
    { length: 20 },
    (_, i) => `const value${i} = ${i};`
  ).join('\n');
  const file = new File({
    preferredHighlighter: 'highlights',
    theme: 'pierre-dark',
    disableErrorHandling: true,
    disableFileHeader: true,
    tokenizeMaxLength: 5,
  });
  const editor = new Editor('file');
  // A plain row holds its text in one span; a tokenized row has one per token.
  const coloredRows = () =>
    Array.from(
      fileContainer.shadowRoot?.querySelectorAll(
        '[data-content] [data-line]'
      ) ?? []
    ).filter((row) => row.querySelectorAll('span').length > 1).length;
  try {
    file.render({
      file: { name: 'big.ts', contents, lang: 'typescript' },
      fileContainer,
      forceRender: true,
    });
    expect(coloredRows()).toBe(0);
    editor.edit(file);
    await waitFor(() => editor.getText() === contents);
    // The rows are not highlighted output, so the editor's tokens reach them.
    await waitFor(() => coloredRows() > 0, { timeout: 3_000 });
    expect(coloredRows()).toBeGreaterThan(0);
  } finally {
    editor.cleanUp();
    file.cleanUp();
    dom.cleanup();
  }
});

// Runs `run` with every tokenizing time budget running out at once, so only
// lines finished in the same pass get their colors.
function withExhaustedTimeBudget(run: () => void): void {
  let now = 0;
  const clock = spyOn(performance, 'now').mockImplementation(
    () => (now += 100)
  );
  try {
    run();
  } finally {
    clock.mockRestore();
  }
}

test('Highlights colors lines an edit brings into view in the same pass', async () => {
  await getSharedHighlighter({
    preferredHighlighter: 'highlights',
    themes: ['pierre-dark'],
    langs: ['typescript'],
  });
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);
  const rest = Array.from(
    { length: 40 },
    (_, i) => `const value${i} = ${i};`
  ).join('\n');
  const fileDiff = new FileDiff({
    preferredHighlighter: 'highlights',
    theme: 'pierre-dark',
    diffStyle: 'unified',
    disableErrorHandling: true,
    disableFileHeader: true,
  });
  const editor = new Editor('file-diff');
  const content = () =>
    Array.from(
      fileContainer.shadowRoot?.querySelectorAll(
        '[data-content] > [data-line]'
      ) ?? [],
      (row) => row.outerHTML
    );
  try {
    fileDiff.render({
      oldFile: { name: 'reveal.ts', contents: `/*\n${rest}` },
      newFile: { name: 'reveal.ts', contents: `/x\n${rest}` },
      fileContainer,
      forceRender: true,
      renderRange: {
        startingLine: 0,
        totalLines: 3,
        bufferBefore: 0,
        bufferAfter: 0,
      },
    });
    editor.edit(fileDiff);
    await waitFor(() => editor.getText() === `/x\n${rest}`);
    await wait(100);
    // Turning '/x' back into '/*' removes the old line's row, so one more
    // line comes into view, and comments out every line below it.
    withExhaustedTimeBudget(() =>
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 2 },
          },
          newText: '*',
        },
      ])
    );
    const afterEdit = content();
    expect(afterEdit).toHaveLength(3);
    // Nothing visible may change once background tokenizing finishes.
    await wait(200);
    expect(content()).toEqual(afterEdit);
  } finally {
    editor.cleanUp();
    fileDiff.cleanUp();
    dom.cleanup();
  }
});

test('Highlights colors lines scrolled into view before background tokenizing reaches them', async () => {
  await getSharedHighlighter({
    preferredHighlighter: 'highlights',
    themes: ['pierre-dark'],
    langs: ['typescript'],
  });
  const dom = installDom();
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);
  const contents = Array.from(
    { length: 200 },
    (_, i) => `const value${i} = ${i};`
  ).join('\n');
  const file = new File({
    preferredHighlighter: 'highlights',
    theme: 'pierre-dark',
    disableErrorHandling: true,
    disableFileHeader: true,
  });
  const editor = new Editor('file');
  const renderWindow = (startingLine: number) =>
    file.render({
      file: { name: 'scroll.ts', contents, lang: 'typescript' },
      fileContainer,
      renderRange: {
        startingLine,
        totalLines: 10,
        bufferBefore: 0,
        bufferAfter: 0,
      },
    });
  const content = () =>
    fileContainer.shadowRoot?.querySelector('[data-content]')?.innerHTML;
  try {
    renderWindow(0);
    editor.edit(file);
    await waitFor(() => editor.getText() === contents);
    await wait(100);
    // Opening a comment at the top recolors every line below it, but only the
    // visible ones are finished right away.
    withExhaustedTimeBudget(() =>
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: '/*',
        },
      ])
    );
    renderWindow(100);
    const afterScroll = content();
    // Nothing visible may change once background tokenizing finishes.
    await wait(200);
    expect(content()).toBe(afterScroll);
  } finally {
    editor.cleanUp();
    file.cleanUp();
    dom.cleanup();
  }
});
