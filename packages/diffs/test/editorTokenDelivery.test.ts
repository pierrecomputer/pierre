import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test';

import { File, type FileOptions } from '../src/components/File';
import { Editor } from '../src/editor/editor';
import type { TextEdit } from '../src/editor/types';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import type { HighlighterTypes, RenderRange, ThemeTypes } from '../src/types';
import { installDom, wait, waitFor } from './domHarness';

// Each test loads its backend fresh: only one highlighter type can be loaded.
beforeEach(disposeHighlighter);
afterAll(disposeHighlighter);

// Every token a backend produces for an edit must reach the rows, including
// the ones it finishes later or hands over around an edit, a recycle or a
// theme change. Each scenario edits a file with lines 10–19 on screen, lets
// the background pass settle, then compares every row's colors with a fresh
// render of the edited text.
const backends: HighlighterTypes[] = ['highlights', 'shiki-js'];
const lineCount = 40;
const contents = Array.from(
  { length: lineCount },
  (_, line) => `const value${line} = (${line});`
).join('\n');
const source = { name: 'delivery.ts', contents, lang: 'typescript' };

interface Scenario {
  themeType: ThemeTypes;
  run(
    editor: Editor<'file'>,
    file: File,
    root: HTMLDivElement
  ): void | Promise<void>;
}

function viewport(startingLine: number, totalLines = 10): RenderRange {
  return { startingLine, totalLines, bufferBefore: 0, bufferAfter: 0 };
}

function edit(
  line: number,
  newText: string,
  endLine = line,
  endCharacter = 0
): TextEdit {
  return {
    range: {
      start: { line, character: 0 },
      end: { line: endLine, character: endCharacter },
    },
    newText,
  };
}

const scenarios: Record<string, Scenario> = {
  'a line inserted above the window': {
    themeType: 'dark',
    run(editor) {
      editor.applyEdits([edit(0, '/*\n')]);
    },
  },
  'a net-zero batch above and below the window': {
    themeType: 'dark',
    run(editor) {
      editor.applyEdits([edit(0, '/*\n'), edit(30, '', 31)]);
    },
  },
  'a second edit while the first still tokenizes': {
    themeType: 'dark',
    run(editor) {
      editor.applyEdits([edit(0, '/*')]);
      editor.applyEdits([edit(25, 'x')]);
    },
  },
  'an edit whose pass ran out of time, then another edit': {
    themeType: 'dark',
    run(editor) {
      let now = 0;
      const clock = spyOn(performance, 'now').mockImplementation(
        () => (now += 100)
      );
      try {
        editor.applyEdits([edit(0, '/*')]);
      } finally {
        clock.mockRestore();
      }
      editor.applyEdits([edit(25, 'x')]);
    },
  },
  'a recycle between an edit and its background pass': {
    themeType: 'dark',
    run(editor, file, root) {
      editor.applyEdits([edit(0, '/*')]);
      recycle(file, root);
      reattach(editor, file, root, 25);
    },
  },
  'a background pass that runs while recycled': {
    themeType: 'dark',
    async run(editor, file, root) {
      editor.applyEdits([edit(0, '/*')]);
      recycle(file, root);
      await wait(100);
      reattach(editor, file, root, 25);
    },
  },
  'an edit while recycled': {
    themeType: 'dark',
    async run(editor, file, root) {
      recycle(file, root);
      await wait(100);
      editor.applyEdits([edit(10, '/*')]);
      await wait(100);
      reattach(editor, file, root, 10);
    },
  },
  'a theme change after an edit': {
    themeType: 'light',
    run(editor, file) {
      editor.applyEdits([edit(10, 'export ')]);
      file.setThemeType('light');
    },
  },
};

// Drops the file's rows the way a virtualizer does when it scrolls out of
// view; the editor keeps its document.
function recycle(file: File, root: HTMLDivElement): void {
  file.cleanUp(true);
  root.shadowRoot?.replaceChildren();
}

function reattach(
  editor: Editor<'file'>,
  file: File,
  root: HTMLDivElement,
  startingLine: number
): void {
  document.body.append(root);
  file.virtualizedSetup();
  file.render({
    file: source,
    fileContainer: root,
    renderRange: viewport(startingLine),
  });
  editor.edit(file);
}

// Every non-blank character of a row with the color it is shown in.
function rowColors(
  row: Element,
  themeType: ThemeTypes,
  foreground: string
): string {
  const colors: string[] = [];
  for (const span of row.querySelectorAll('span')) {
    const { style } = document.createElement('span');
    const token = span.style.getPropertyValue(`--diffs-token-${themeType}`);
    style.color =
      token !== ''
        ? token
        : span.style.color !== ''
          ? span.style.color
          : foreground;
    for (const char of span.textContent) {
      if (char.trim() !== '') colors.push(`${char}:${style.color}`);
    }
  }
  return colors.join(' ');
}

function rows(root: HTMLDivElement): Element[] {
  return [
    ...(root.shadowRoot?.querySelectorAll('[data-content] > [data-line]') ??
      []),
  ];
}

for (const backend of backends) {
  for (const [name, scenario] of Object.entries(scenarios)) {
    test(`${backend}: rows match a fresh render after ${name}`, async () => {
      const highlighter = await getSharedHighlighter({
        preferredHighlighter: backend,
        themes: ['pierre-dark', 'pierre-light'],
        langs: ['typescript'],
      });
      const dom = installDom();
      // Shiki schedules its background pass through window messages.
      const saved = {
        addEventListener: globalThis.addEventListener,
        removeEventListener: globalThis.removeEventListener,
        postMessage: globalThis.postMessage,
      };
      const { window } = dom;
      globalThis.addEventListener = window.addEventListener.bind(window);
      globalThis.removeEventListener = window.removeEventListener.bind(window);
      globalThis.postMessage = (message: unknown) =>
        window.postMessage(message, '*');
      const root = document.createElement('div');
      const expectedRoot = document.createElement('div');
      document.body.append(root, expectedRoot);
      const options: FileOptions<undefined, undefined> = {
        preferredHighlighter: backend,
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
        themeType: 'dark',
        useTokenTransformer: true,
        disableErrorHandling: true,
        disableFileHeader: true,
      };
      const file = new File(options);
      const expectedFile = new File(options);
      const editor = new Editor('file');
      try {
        file.render({
          file: source,
          fileContainer: root,
          renderRange: viewport(10),
        });
        editor.edit(file);
        await waitFor(() => editor.getText() === contents);
        // Let the attach pass finish before the scenario edits.
        await wait(200);

        await scenario.run(editor, file, root);

        const { themeType } = scenario;
        const theme = highlighter.getTheme(
          themeType === 'light' ? 'pierre-light' : 'pierre-dark'
        );
        const foreground = theme.colors?.['editor.foreground'] ?? '';
        expectedFile.setThemeType(themeType);
        expectedFile.render({
          file: { ...source, contents: editor.getText() },
          fileContainer: expectedRoot,
          forceRender: true,
        });
        const expected = rows(expectedRoot).map((row) =>
          rowColors(row, themeType, foreground)
        );
        const mismatches = (): number[] => {
          file.render({
            file: source,
            renderRange: viewport(0, lineCount + 1),
            forceRender: true,
          });
          const actual = rows(root).map((row) =>
            rowColors(row, themeType, foreground)
          );
          const lines: number[] = [];
          for (const [line, colors] of actual.entries()) {
            if (colors !== expected[line]) lines.push(line);
          }
          return lines;
        };
        // The background pass delivers the rest of the lines on its own time.
        await wait(100);
        await waitFor(() => mismatches().length === 0, { timeout: 2000 });
        expect(mismatches()).toEqual([]);
      } finally {
        editor.cleanUp();
        file.cleanUp();
        expectedFile.cleanUp();
        Object.assign(globalThis, saved);
        dom.cleanup();
      }
    });
  }
}
