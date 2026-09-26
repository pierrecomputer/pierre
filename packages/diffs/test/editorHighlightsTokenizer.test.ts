import { afterAll, expect, test } from 'bun:test';

import { File, type FileOptions } from '../src/components/File';
import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { Virtualizer } from '../src/components/Virtualizer';
import { Editor } from '../src/editor/editor';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { installDom, waitFor } from './domHarness';

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
