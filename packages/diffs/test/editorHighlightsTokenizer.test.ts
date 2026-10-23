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
import { installDom, wait, waitFor } from './domHarness';

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
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
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
    const file =
      type === 'virtualized'
        ? new VirtualizedFile(options, new Virtualizer())
        : new File(options);
    const editor = new Editor('file');
    try {
      const source = { name: 'batch.ts', contents, lang: 'typescript' };
      if (file instanceof VirtualizedFile) file.updateCodeViewLayout(source, 0);
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
      expect(
        Array.from(
          fileContainer.shadowRoot!.querySelectorAll(
            '[data-content] [data-line]'
          ),
          (row) => row.textContent
        )
      ).toEqual(expected);
    } finally {
      editor.cleanUp();
      file.cleanUp();
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
