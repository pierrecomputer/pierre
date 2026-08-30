import { describe, expect, spyOn, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { Virtualizer } from '../src/components/Virtualizer';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import type { DiffsHighlighter } from '../src/types';
import { installDom, waitFor } from './domHarness';

const MODEL_LINE_TOP = 20;

function createTestHighlighter(): DiffsHighlighter {
  return {
    getLanguage: () => undefined,
    getLoadedLanguages: () => [],
    getTheme: () => ({ type: 'light', colors: {} }),
    loadLanguage: async () => {},
    setTheme: () => ({ theme: { type: 'light' }, colorMap: [''] }),
  } as unknown as DiffsHighlighter;
}

function createVirtualizedFile(modelLineHeight: number): {
  component: VirtualizedFile<undefined>;
  cleanup(): void;
} {
  const virtualizer = new Virtualizer();
  const instanceChangedSpy = spyOn(
    virtualizer,
    'instanceChanged'
  ).mockImplementation(() => {});
  const reconcileSpy = spyOn(
    virtualizer,
    'requestHeightReconcile'
  ).mockImplementation(() => {});
  const component = new VirtualizedFile<undefined>(
    {
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
    },
    virtualizer
  );
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);
  const file = {
    name: 'virtualized.ts',
    contents: 'first\nsecond\nthird',
    lang: 'text',
  };
  const renderRange = {
    // Render only line 3 so the selected line 2 remains virtualized.
    startingLine: 2,
    totalLines: 1,
    bufferBefore: 0,
    bufferAfter: 0,
  };
  component.updateCodeViewLayout(file, 0);
  component.render({
    file,
    fileContainer,
    forceRender: true,
    renderRange,
  });
  const shadowRoot =
    fileContainer.shadowRoot ?? fileContainer.attachShadow({ mode: 'open' });
  if (shadowRoot.querySelector('[data-content]') == null) {
    const code = document.createElement('div');
    code.dataset.code = '';
    const gutter = document.createElement('div');
    gutter.dataset.gutter = '';
    const content = document.createElement('div');
    content.dataset.content = '';
    const row = document.createElement('div');
    row.dataset.line = '3';
    row.textContent = 'third';
    content.appendChild(row);
    code.append(gutter, content);
    shadowRoot.replaceChildren(code);
  }
  const syncRenderView = (editor: Editor<'file', undefined>) => {
    editor.__syncRenderView({
      highlighter: createTestHighlighter(),
      fileContainer,
      file,
      lineAnnotations: undefined,
      renderRange,
    });
  };
  let attachedEditor: Editor<'file', undefined> | undefined;
  const attach = component.__attachEditor.bind(component);
  component.__attachEditor = (editor) => {
    attachedEditor = editor;
    const detach = attach(editor);
    syncRenderView(editor);
    return () => {
      attachedEditor = undefined;
      detach();
    };
  };
  const rerender = component.rerender.bind(component);
  component.rerender = () => {
    rerender();
    if (attachedEditor != null) {
      syncRenderView(attachedEditor);
    }
  };
  const positionSpy = spyOn(component, 'getLinePosition').mockImplementation(
    (lineNumber) =>
      lineNumber === 2
        ? { top: MODEL_LINE_TOP, height: modelLineHeight }
        : undefined
  );

  return {
    component,
    cleanup() {
      positionSpy.mockRestore();
      instanceChangedSpy.mockRestore();
      reconcileSpy.mockRestore();
      component.cleanUp();
    },
  };
}
async function revealOffscreenLine({
  modelLineHeight = 20,
  rerenderCount = 1,
}: {
  modelLineHeight?: number;
  rerenderCount?: number;
} = {}): Promise<number[]> {
  const dom = installDom();
  const scrollTops: number[] = [];
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value(this: HTMLElement) {
      const top = Number.parseFloat(this.style.top);
      if (Number.isFinite(top)) {
        scrollTops.push(top);
      }
    },
  });

  const editor = new Editor('file');
  const { component, cleanup } = createVirtualizedFile(modelLineHeight);

  try {
    editor.edit(component);
    await waitFor(() => editor.getFile() !== undefined);
    editor.setSelections([
      {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 0 },
        direction: 'none',
      },
    ]);

    // Rerendering retries the reveal while line 2 is still offscreen.
    for (let i = 0; i < rerenderCount; i++) {
      component.rerender();
    }

    return scrollTops;
  } finally {
    editor.cleanUp();
    cleanup();
    dom.cleanup();
  }
}

describe('Editor virtualized reveal', () => {
  test('keeps using model geometry when an offscreen reveal retries', async () => {
    expect(await revealOffscreenLine()).toEqual([
      MODEL_LINE_TOP,
      MODEL_LINE_TOP,
    ]);
  });

  test('stops retrying when model geometry has zero height', async () => {
    expect(
      await revealOffscreenLine({ modelLineHeight: 0, rerenderCount: 2 })
    ).toEqual([MODEL_LINE_TOP]);
  });
});
