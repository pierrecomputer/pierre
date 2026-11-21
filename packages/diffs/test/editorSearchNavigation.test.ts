import { afterAll, describe, expect, test } from 'bun:test';

import { File } from '../src/components/File';
import { Editor } from '../src/editor/editor';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { dispatchPrimaryFind } from './codeViewSearchHarness';
import {
  createRoot,
  getSearchHighlightRanges,
  installDom,
  wait,
  waitFor,
} from './domHarness';

afterAll(disposeHighlighter);

interface SearchFixtureOptions {
  targets: Map<number, string>;
  query?: string;
  height?: number;
  rowTop?: number;
  wrappedLine?: number;
  startingLine?: number;
  totalLines?: number;
}

// Models layout for real editor rows; jsdom supplies the document, search and highlights.
async function withSearchFixture(
  options: SearchFixtureOptions,
  run: (context: {
    current(): { line: number; character: number; text: string };
    label(): string | null | undefined;
  }) => void
): Promise<void> {
  await getSharedHighlighter({
    themes: ['pierre-dark', 'pierre-light'],
    langs: ['text'],
    preferredHighlighter: 'shiki-js',
  });
  const dom = installDom();
  const root = createRoot({ height: options.height ?? 100 });
  root.style.overflowY = 'auto';
  const container = document.createElement('div');
  root.append(container);
  const wrapped = options.wrappedLine != null;
  const file = new File({
    disableFileHeader: true,
    useTokenTransformer: true,
    overflow: wrapped ? 'wrap' : 'scroll',
  });
  const editor = new Editor('file', { matchBrackets: false });
  const contents = Array.from(
    { length: 2000 },
    (_, line) => options.targets.get(line) ?? 'p'
  );
  const rangePrototype: object = Object.getPrototypeOf(document.createRange());
  const rangeRect = Object.getOwnPropertyDescriptor(
    rangePrototype,
    'getBoundingClientRect'
  );
  const rangeRects = Object.getOwnPropertyDescriptor(
    rangePrototype,
    'getClientRects'
  );
  const elementPrototype = dom.window.HTMLElement.prototype;
  const Rect: typeof DOMRect = dom.window.DOMRect;
  const readElementRect: Element['getBoundingClientRect'] =
    elementPrototype.getBoundingClientRect;
  const elementRect = Object.getOwnPropertyDescriptor(
    elementPrototype,
    'getBoundingClientRect'
  );
  try {
    file.render({
      file: { name: 'navigation.txt', contents: contents.join('\n') },
      fileContainer: container,
      renderRange: {
        startingLine: options.startingLine ?? 980,
        totalLines: options.totalLines ?? 60,
        bufferBefore: 0,
        bufferAfter: 0,
      },
    });
    editor.edit(file);
    const getContent = () =>
      Array.from(
        container.shadowRoot?.querySelectorAll<HTMLElement>('[data-content]') ??
          []
      ).find(
        (element) =>
          element.contentEditable === 'true' ||
          element.getAttribute('contenteditable') === 'true'
      );
    await waitFor(() => getContent() != null);
    const content = getContent();
    if (content == null) throw new Error('Missing actual editor content');
    const baseLine = options.wrappedLine ?? 1000;
    const heightAt = (line: number): number =>
      wrapped ? Math.max(1, Math.ceil(contents[line].length / 10)) * 20 : 20;
    const lineTops = [0];
    for (let line = 1; line < contents.length; line++) {
      lineTops.push(lineTops[line - 1] + heightAt(line - 1));
    }
    const viewportOffset = (options.rowTop ?? 0) - lineTops[baseLine];
    const topAt = (line: number): number => lineTops[line] + viewportOffset;
    for (const row of content.children) {
      if (!(row instanceof HTMLElement)) continue;
      const lineNumber = Number(row.dataset.line);
      if (!Number.isFinite(lineNumber)) continue;
      Object.defineProperty(row, 'getBoundingClientRect', {
        configurable: true,
        value: () =>
          new Rect(0, topAt(lineNumber - 1), 96, heightAt(lineNumber - 1)),
      });
    }
    Object.defineProperty(content, 'offsetWidth', {
      configurable: true,
      value: 96,
    });
    if (wrapped) {
      Object.defineProperty(elementPrototype, 'getBoundingClientRect', {
        configurable: true,
        value(this: HTMLElement): DOMRect {
          if (
            this.style.visibility === 'hidden' &&
            this.style.whiteSpace === 'pre-wrap'
          )
            return new Rect(0, 0, 96, 20);
          return readElementRect.call(this);
        },
      });
      const characterRect = (range: Range): DOMRect =>
        new Rect(
          (range.startOffset % 10) * 8 + 8,
          Math.floor(range.startOffset / 10) * 20,
          8,
          20
        );
      Object.defineProperty(rangePrototype, 'getBoundingClientRect', {
        configurable: true,
        value(this: Range): DOMRect {
          return characterRect(this);
        },
      });
      Object.defineProperty(rangePrototype, 'getClientRects', {
        configurable: true,
        value(this: Range) {
          const rects = [characterRect(this)];
          return Object.assign(rects, {
            item: (index: number) => rects[index] ?? null,
          });
        },
      });
    }
    dispatchPrimaryFind(content);
    await wait(0);
    const panelHost = container.shadowRoot?.querySelector<HTMLElement>(
      '[data-search-panel]'
    );
    const panel = panelHost?.shadowRoot;
    const input = panel?.querySelector<HTMLInputElement>('input[data-search]');
    if (input == null) throw new Error('Missing actual editor search input');
    input.value = options.query ?? 'target';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    run({
      current: () => {
        const range = getSearchHighlightRanges(container, true)[0];
        if (range == null) throw new Error('Missing current native highlight');
        const row =
          range.startContainer.parentElement?.closest<HTMLElement>(
            '[data-line]'
          );
        if (row == null)
          throw new Error('Missing current highlighted source row');
        const prefix = document.createRange();
        prefix.selectNodeContents(row);
        prefix.setEnd(range.startContainer, range.startOffset);
        return {
          line: Number(row.dataset.line) - 1,
          character: prefix.toString().length,
          text: range.toString(),
        };
      },
      label: () => panel?.querySelector('[data-matches]')?.textContent,
    });
  } finally {
    editor.cleanUp();
    file.cleanUp();
    if (rangeRect == null)
      Reflect.deleteProperty(rangePrototype, 'getBoundingClientRect');
    else
      Object.defineProperty(rangePrototype, 'getBoundingClientRect', rangeRect);
    if (rangeRects == null)
      Reflect.deleteProperty(rangePrototype, 'getClientRects');
    else Object.defineProperty(rangePrototype, 'getClientRects', rangeRects);
    if (elementRect != null)
      Object.defineProperty(
        elementPrototype,
        'getBoundingClientRect',
        elementRect
      );
    else Reflect.deleteProperty(elementPrototype, 'getBoundingClientRect');
    dom.cleanup();
  }
}

describe('Editor initial search navigation', () => {
  test('chooses the first fully visible match with mounted buffers above and below', async () => {
    await withSearchFixture(
      {
        targets: new Map([
          [990, 'target above'],
          [1001, 'target visible'],
          [1010, 'target below'],
          [1500, 'target unmounted'],
        ]),
      },
      ({ current, label }) => {
        expect(current().line).toBe(1001);
        expect(label()).toBe('2/4');
      }
    );
  });

  test('chooses the first after the visible area including the lower mounted buffer', async () => {
    await withSearchFixture(
      {
        targets: new Map([
          [990, 'target above'],
          [1010, 'target below'],
          [1500, 'target unmounted'],
        ]),
      },
      ({ current, label }) => {
        expect(current().line).toBe(1010);
        expect(label()).toBe('2/3');
      }
    );
  });

  test('chooses the very first match when nothing is visible or later', async () => {
    await withSearchFixture(
      {
        targets: new Map([
          [500, 'target first'],
          [990, 'target upper buffer'],
        ]),
      },
      ({ label }) => {
        expect(label()).toBe('1/2');
      }
    );
  });

  test('treats a top-clipped match as above the visible area', async () => {
    await withSearchFixture(
      {
        rowTop: -10,
        targets: new Map([
          [990, 'target above'],
          [1000, 'target clipped top'],
          [1006, 'target below'],
        ]),
      },
      ({ current }) => {
        expect(current().line).toBe(1006);
      }
    );
  });

  test('chooses a bottom-clipped match before the lower buffer', async () => {
    await withSearchFixture(
      {
        rowTop: -10,
        targets: new Map([
          [990, 'target above'],
          [1005, 'target clipped bottom'],
          [1007, 'target below'],
        ]),
      },
      ({ current }) => {
        expect(current().line).toBe(1005);
      }
    );
  });

  test('keeps the visibility helper meaning for a visible wrapped fragment', async () => {
    await withSearchFixture(
      {
        wrappedLine: 1000,
        rowTop: -10,
        height: 55,
        targets: new Map([
          [990, 'target'],
          [1000, `${'x'.repeat(14)}target${'x'.repeat(30)}`],
          [1002, 'target'],
        ]),
      },
      ({ current }) => {
        expect(current().line).toBe(1000);
        expect(current().character).toBe(14);
      }
    );
  });

  test('chooses a wrapped match crossing the bottom edge before a later match', async () => {
    await withSearchFixture(
      {
        wrappedLine: 1000,
        height: 55,
        targets: new Map([
          [990, 'target'],
          [1000, `${'x'.repeat(17)}targetxxxtarget${'x'.repeat(20)}`],
          [1002, 'target'],
        ]),
      },
      ({ current }) => {
        expect(current().line).toBe(1000);
        expect(current().character).toBe(17);
      }
    );
  });

  test('uses the next source line when a wrapped row begins above the viewport', async () => {
    await withSearchFixture(
      {
        wrappedLine: 1000,
        rowTop: -10,
        height: 45,
        targets: new Map([
          [990, 'target'],
          [1000, `${'x'.repeat(17)}target${'x'.repeat(20)}`],
          [1001, 'target'],
        ]),
      },
      ({ current }) => {
        expect(current().line).toBe(1001);
      }
    );
  });

  test('keeps a match spanning both viewport edges in the above category', async () => {
    const query = 'target spans bottom edge';
    await withSearchFixture(
      {
        wrappedLine: 1000,
        rowTop: -10,
        height: 35,
        query,
        targets: new Map([
          [990, query],
          [1000, `xxxxx${query}${'x'.repeat(12)}`],
          [1001, query],
        ]),
      },
      ({ current }) => {
        expect(current().line).toBe(1001);
      }
    );
  });

  test('chooses an unmounted later result after a shorter visible source window', async () => {
    await withSearchFixture(
      {
        startingLine: 1000,
        totalLines: 2,
        targets: new Map([
          [990, 'target above'],
          [1500, 'target after window'],
        ]),
      },
      ({ label }) => {
        expect(label()).toBe('2/2');
      }
    );
  });

  test('finds the first editable row below a viewport with no intersecting rows', async () => {
    await withSearchFixture(
      {
        startingLine: 1010,
        totalLines: 5,
        targets: new Map([
          [990, 'target above'],
          [1010, 'target below'],
        ]),
      },
      ({ current }) => {
        expect(current().line).toBe(1010);
      }
    );
  });
});
