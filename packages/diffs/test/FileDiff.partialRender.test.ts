import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import { disposeHighlighter, FileDiff, parseDiffFromFile } from '../src';
import type { DiffLineAnnotation } from '../src/types';

function installDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
  });
  const originalValues = {
    document: Reflect.get(globalThis, 'document'),
    Element: Reflect.get(globalThis, 'Element'),
    HTMLElement: Reflect.get(globalThis, 'HTMLElement'),
    HTMLPreElement: Reflect.get(globalThis, 'HTMLPreElement'),
    HTMLStyleElement: Reflect.get(globalThis, 'HTMLStyleElement'),
    Node: Reflect.get(globalThis, 'Node'),
    ResizeObserver: Reflect.get(globalThis, 'ResizeObserver'),
    SVGElement: Reflect.get(globalThis, 'SVGElement'),
    window: Reflect.get(globalThis, 'window'),
  };

  class MockResizeObserver {
    observe(_target: Element): void {}
    unobserve(_target: Element): void {}
    disconnect(): void {}
  }

  Object.assign(globalThis, {
    document: dom.window.document,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLPreElement: dom.window.HTMLPreElement,
    HTMLStyleElement: dom.window.HTMLStyleElement,
    Node: dom.window.Node,
    ResizeObserver: MockResizeObserver,
    SVGElement: dom.window.SVGElement,
    window: dom.window,
  });

  return {
    cleanup() {
      for (const [key, value] of Object.entries(originalValues)) {
        if (value === undefined) {
          Reflect.deleteProperty(globalThis, key);
        } else {
          Object.assign(globalThis, { [key]: value });
        }
      }
      dom.window.close();
    },
  };
}

async function waitForRenderedCode(container: HTMLElement): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (container.shadowRoot?.querySelector('code') != null) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for FileDiff render');
}

describe('FileDiff partial render', () => {
  test('keeps split columns aligned when trimming annotated deleted lines', async () => {
    const { cleanup } = installDom();
    let instance: FileDiff<string> | undefined;
    try {
      const oldFile = { name: 'x.txt', contents: 'a\nb\nc\nd\n' };
      const newFile = { name: 'x.txt', contents: 'a\nd\n' };
      const fileDiff = parseDiffFromFile(oldFile, newFile);
      const fileContainer = document.createElement('div');
      const lineAnnotations: DiffLineAnnotation<string>[] = [
        { side: 'deletions', lineNumber: 2, metadata: 'annotation' },
      ];
      instance = new FileDiff<string>({
        disableErrorHandling: true,
        disableFileHeader: true,
        diffStyle: 'split',
      });

      instance.render({
        fileContainer,
        fileDiff,
        lineAnnotations,
        deferManagers: true,
        preventEmit: true,
        renderRange: {
          startingLine: 1,
          totalLines: 3,
          bufferBefore: 0,
          bufferAfter: 0,
        },
      });
      await waitForRenderedCode(fileContainer);

      expect(() => {
        instance!.render({
          fileContainer,
          fileDiff,
          lineAnnotations,
          deferManagers: true,
          preventEmit: true,
          renderRange: {
            startingLine: 2,
            totalLines: 2,
            bufferBefore: 0,
            bufferAfter: 0,
          },
        });
      }).not.toThrow();
    } finally {
      instance?.cleanUp();
      cleanup();
      await disposeHighlighter();
    }
  });
});
