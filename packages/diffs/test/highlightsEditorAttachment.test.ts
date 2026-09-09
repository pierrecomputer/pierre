import { afterAll, beforeAll, expect, mock, test } from 'bun:test';

import { File } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { Editor } from '../src/editor/editor';
import type { CodeHighlighter } from '../src/highlighter/code_highlighter';
import { setHighlighter } from '../src/highlighter/code_highlighter';
import { shikiHighlighter } from '../src/highlighter/shiki_highlighter';
import highlightsHighlighter from '../src/highlights';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom, waitFor } from './domHarness';

let dom: ReturnType<typeof installDom>;

beforeAll(async () => {
  dom = installDom();
  await highlightsHighlighter.load({
    langs: ['ts'],
    themes: ['pierre-dark'],
  });
});

afterAll(() => {
  setHighlighter(shikiHighlighter);
  dom.cleanup();
});

for (const type of ['file', 'file-diff'] as const) {
  test(`${type}: an active editor loads new themes on its captured highlighter`, async () => {
    // Preload the palette so a wrong implementation choice fails the assertion
    // without throwing an unrelated unhandled theme error during rendering.
    await highlightsHighlighter.load({
      langs: ['ts'],
      themes: ['one-dark-pro'],
    });
    const loadedThemes = new Set(['pierre-dark']);
    const load = mock<CodeHighlighter['load']>(async ({ themes }) => {
      await Promise.resolve();
      for (const theme of themes) loadedThemes.add(theme);
    });
    const captured: CodeHighlighter = {
      ...highlightsHighlighter,
      load,
      isReady: ({ themes }) => themes.every((theme) => loadedThemes.has(theme)),
    };
    const replacementTokens = mock(highlightsHighlighter.codeToTokens);
    const replacement: CodeHighlighter = {
      ...highlightsHighlighter,
      codeToTokens: replacementTokens,
    };
    setHighlighter(captured);
    const file = { name: 'example.ts', contents: 'const a = 1;' };
    const fileDiff = parseDiffFromFile({ ...file, contents: '' }, file);
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    const options = {
      theme: 'pierre-dark' as const,
      themeType: 'dark' as const,
    };
    const instance =
      type === 'file' ? new File(options) : new FileDiff(options);
    const editor = new Editor(type);
    try {
      if (instance instanceof File) {
        instance.render({ file, fileContainer });
      } else {
        instance.render({ fileDiff, fileContainer });
      }
      editor.edit(instance);
      await waitFor(() => editor.getText() === file.contents);
      setHighlighter(replacement);
      instance.setOptions({ ...options, theme: 'one-dark-pro' });
      if (instance instanceof File) {
        instance.render({ file, forceRender: true });
      } else {
        instance.render({ fileDiff, forceRender: true });
      }
      await waitFor(() => load.mock.calls.length > 0);
      expect(load).toHaveBeenCalled();
      expect(replacementTokens).not.toHaveBeenCalled();
      editor.applyEdits([
        {
          range: {
            start: { line: 0, character: 10 },
            end: { line: 0, character: 11 },
          },
          newText: '2',
        },
      ]);
      expect(editor.getText()).toBe('const a = 2;');
    } finally {
      editor.cleanUp();
      instance.cleanUp();
      fileContainer.remove();
      setHighlighter(shikiHighlighter);
    }
  });

  for (const ready of [true, false]) {
    test(`${type}: edit mode uses the ${ready ? 'loaded' : 'loading'} custom highlighter`, async () => {
      let loaded = ready;
      const createLiveTokenizer = mock(
        highlightsHighlighter.createLiveTokenizer
      );
      setHighlighter({
        ...highlightsHighlighter,
        isReady: () => loaded,
        async load() {
          await Promise.resolve();
          loaded = true;
        },
        createLiveTokenizer,
      });
      const file = {
        name: 'example.ts',
        contents:
          'const html = String.raw\n\nconst page = html`<!doctype html>\n<html lang="en">\n<body><main class="card">Hello &amp; goodbye</main></body>\n</html>\n`',
      };
      const fileContainer = document.createElement('div');
      document.body.appendChild(fileContainer);
      const options = {
        theme: 'pierre-dark' as const,
        themeType: 'dark' as const,
        disableFileHeader: true,
      };
      const editor = new Editor(type);
      const instance =
        type === 'file' ? new File(options) : new FileDiff(options);
      try {
        if (instance instanceof File) {
          instance.render({ file, fileContainer });
        } else {
          instance.render({
            fileDiff: parseDiffFromFile({ ...file, contents: '' }, file),
            fileContainer,
          });
        }
        editor.edit(instance);
        await waitFor(() => editor.getText() === file.contents);
        expect(createLiveTokenizer).toHaveBeenCalled();
        editor.applyEdits([
          {
            range: {
              start: { line: 4, character: 12 },
              end: { line: 4, character: 17 },
            },
            newText: 'title',
          },
        ]);
        await waitFor(() =>
          [
            ...fileContainer.shadowRoot!.querySelectorAll(
              '[data-content] span'
            ),
          ].some((span) => span.textContent === 'title')
        );
        const attribute = [
          ...fileContainer.shadowRoot!.querySelectorAll<HTMLElement>(
            '[data-content] span'
          ),
        ].find((span) => span.textContent === 'title');
        expect(attribute?.style.color).toBe('rgb(96, 209, 153)');
      } finally {
        editor.cleanUp();
        instance.cleanUp();
        fileContainer.remove();
        setHighlighter(shikiHighlighter);
      }
    });
  }
}
