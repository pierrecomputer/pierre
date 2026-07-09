import { afterAll, describe, expect, test } from 'bun:test';
import {
  act,
  type ComponentType,
  createElement,
  type ReactElement,
} from 'react';
import { createRoot as createReactRoot, type Root } from 'react-dom/client';

import { CodeEditor } from '../src/components/CodeEditor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import {
  type CodeEditorProps,
  CodeEditor as ReactCodeEditor,
} from '../src/react/CodeEditor';
import type { FileContents, LineAnnotation } from '../src/types';
import { installDom, wait } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

const ReactCodeEditorComponent = ReactCodeEditor as ComponentType<
  CodeEditorProps<string>
>;

function makeFile(name: string, contents: string): FileContents {
  return {
    name,
    contents,
    cacheKey: `${name}:${contents}`,
  };
}

function renderAnnotation(annotation: LineAnnotation<string>): HTMLElement {
  const element = document.createElement('span');
  element.dataset.testAnnotation = '';
  element.textContent = annotation.metadata;
  return element;
}

function renderReactAnnotation(
  annotation: LineAnnotation<string>
): ReactElement {
  return createElement(
    'span',
    { 'data-test-annotation': '' },
    annotation.metadata
  );
}

async function waitForRenderedText(
  container: HTMLElement,
  text: string
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (container.shadowRoot?.textContent?.includes(text) === true) {
      return;
    }
    await wait(10);
  }
  throw new Error(`Timed out waiting for rendered text: ${text}`);
}

function installReactActEnvironment(): () => void {
  const hadValue = Reflect.has(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  const previousValue = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  return () => {
    if (hadValue) {
      Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousValue);
    } else {
      Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    }
  };
}

async function renderReactElement(
  root: Root,
  element: ReactElement
): Promise<void> {
  await act(async () => {
    root.render(element);
    await wait(20);
  });
}

async function unmountRoot(root: Root | undefined): Promise<void> {
  if (root == null) {
    return;
  }
  await act(async () => {
    root.unmount();
    await wait(0);
  });
}

async function waitForPendingRenders(): Promise<void> {
  await wait(0);
  await wait(0);
}

describe('CodeEditor', () => {
  test('replaces a placeholder with rendered file content', async () => {
    const { cleanup } = installDom();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const editor = new CodeEditor<string>({
      disableErrorHandling: true,
      renderPlaceholder: () => {
        const placeholder = document.createElement('p');
        placeholder.dataset.placeholder = '';
        placeholder.textContent = 'No file selected';
        return placeholder;
      },
    });

    try {
      editor.render(root);

      const scrollContainer = root.firstElementChild as HTMLElement | null;
      expect(scrollContainer?.textContent).toBe('No file selected');
      expect(
        scrollContainer?.querySelector('[data-placeholder]')
      ).not.toBeNull();

      editor.setFile(makeFile('editor.txt', 'alpha\nbravo\n'));
      const fileContainer = scrollContainer?.querySelector('diffs-container');
      expect(fileContainer).not.toBeNull();
      expect(scrollContainer?.querySelector('[data-placeholder]')).toBeNull();

      await waitForRenderedText(fileContainer!, 'bravo');

      expect(
        fileContainer!.shadowRoot?.querySelectorAll('[data-line]').length
      ).toBe(3);
    } finally {
      editor.cleanUp();
      await waitForPendingRenders();
      cleanup();
    }
  });

  test('updates rendered content and line annotations in place', async () => {
    const { cleanup } = installDom();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const editor = new CodeEditor<string>({
      disableErrorHandling: true,
      renderAnnotation,
    });

    try {
      editor.render(root, makeFile('editor.txt', 'one\ntwo\n'), [
        { lineNumber: 2, metadata: 'initial note' },
      ]);

      const scrollContainer = root.firstElementChild as HTMLElement | null;
      const fileContainer = scrollContainer?.querySelector('diffs-container');
      expect(fileContainer).not.toBeNull();
      await waitForRenderedText(fileContainer!, 'two');

      expect(
        fileContainer!.querySelector('[data-test-annotation]')?.textContent
      ).toBe('initial note');
      expect(
        fileContainer!
          .querySelector('[data-annotation-slot]')
          ?.getAttribute('slot')
      ).toBe('annotation-2');

      editor.setFile(makeFile('editor.txt', 'three\nfour\n'), [
        { lineNumber: 1, metadata: 'updated note' },
      ]);
      await waitForRenderedText(fileContainer!, 'four');

      expect(fileContainer!.shadowRoot?.textContent).not.toContain('two');
      expect(
        fileContainer!.querySelector('[data-test-annotation]')?.textContent
      ).toBe('updated note');
      expect(
        fileContainer!
          .querySelector('[data-annotation-slot]')
          ?.getAttribute('slot')
      ).toBe('annotation-1');

      editor.setLineAnnotations([{ lineNumber: 2, metadata: 'second note' }]);

      expect(
        fileContainer!.querySelector('[data-test-annotation]')?.textContent
      ).toBe('second note');
      expect(
        fileContainer!
          .querySelector('[data-annotation-slot]')
          ?.getAttribute('slot')
      ).toBe('annotation-2');
    } finally {
      editor.cleanUp();
      await waitForPendingRenders();
      cleanup();
    }
  });

  test('cleanup removes the managed scroll container', async () => {
    const { cleanup } = installDom();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const editor = new CodeEditor<string>({ disableErrorHandling: true });

    try {
      editor.render(root, makeFile('editor.txt', 'one\n'));
      expect(root.firstElementChild).not.toBeNull();

      editor.cleanUp();

      expect(root.firstElementChild).toBeNull();
    } finally {
      await waitForPendingRenders();
      cleanup();
    }
  });
});

describe('React CodeEditor', () => {
  test('updates content without recreating the editor for stable options', async () => {
    const { cleanup } = installDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root: Root | undefined;

    try {
      root = createReactRoot(container);
      await renderReactElement(
        root,
        createElement(ReactCodeEditorComponent, {
          disableWorkerPool: true,
          disableErrorHandling: true,
          file: makeFile('react.txt', 'alpha\n'),
          renderAnnotation: renderReactAnnotation,
        })
      );

      const host = container.firstElementChild as HTMLElement | null;
      const firstScrollContainer = host?.firstElementChild;
      const fileContainer =
        firstScrollContainer?.querySelector('diffs-container');
      expect(fileContainer).not.toBeNull();
      await waitForRenderedText(fileContainer!, 'alpha');

      await renderReactElement(
        root,
        createElement(ReactCodeEditorComponent, {
          disableWorkerPool: true,
          disableErrorHandling: true,
          file: makeFile('react.txt', 'bravo\n'),
          lineAnnotations: [{ lineNumber: 1, metadata: 'react note' }],
          renderAnnotation: renderReactAnnotation,
        })
      );
      await waitForRenderedText(fileContainer!, 'bravo');

      expect(host?.firstElementChild).toBe(firstScrollContainer);
      expect(fileContainer!.shadowRoot?.textContent).not.toContain('alpha');
      expect(
        fileContainer!.querySelector('[data-test-annotation]')?.textContent
      ).toBe('react note');
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      await waitForPendingRenders();
      cleanup();
    }
  });

  test('remounts the virtualizer when overscroll changes and clears it on unmount', async () => {
    const { cleanup } = installDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root: Root | undefined;

    try {
      root = createReactRoot(container);
      await renderReactElement(
        root,
        createElement(ReactCodeEditorComponent, {
          disableWorkerPool: true,
          disableErrorHandling: true,
          file: makeFile('react.txt', 'alpha\n'),
          overscrollSize: 0,
        })
      );

      const firstScrollContainer =
        container.firstElementChild as HTMLElement | null;
      expect(firstScrollContainer).not.toBeNull();

      await renderReactElement(
        root,
        createElement(ReactCodeEditorComponent, {
          disableWorkerPool: true,
          disableErrorHandling: true,
          file: makeFile('react.txt', 'alpha\n'),
          overscrollSize: 8,
        })
      );

      expect(container.firstElementChild).not.toBe(firstScrollContainer);

      await unmountRoot(root);
      root = undefined;

      expect(container.firstElementChild).toBeNull();
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      await waitForPendingRenders();
      cleanup();
    }
  });
});
