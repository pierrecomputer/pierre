import { describe, expect, test } from 'bun:test';

import { FileDiff, parseDiffFromFile } from '../src';
import { installDom, wait } from './domHarness';
import {
  createEditorInstance,
  createTextDocumentFromLines,
} from './editorTestUtils';

const fileDiff = parseDiffFromFile(
  { name: 'example.txt', contents: 'value 1\n' },
  { name: 'example.txt', contents: 'value 2\n' }
);

function createSlotContent(text: string): HTMLElement {
  const element = document.createElement('span');
  element.textContent = text;
  return element;
}

async function waitForSlotText(
  container: HTMLElement,
  slot: string,
  expected: string | null
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const element = container.querySelector(`[slot="${slot}"]`);
    if ((element?.textContent ?? null) === expected) {
      return;
    }
    await wait(10);
  }
  expect(container.querySelector(`[slot="${slot}"]`)?.textContent ?? null).toBe(
    expected
  );
}

async function waitForHeaderCount(
  container: HTMLElement,
  selector: string,
  expected: string
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (
      container.shadowRoot?.querySelector(selector)?.textContent === expected
    ) {
      return;
    }
    await wait(10);
  }
  expect(container.shadowRoot?.querySelector(selector)?.textContent).toBe(
    expected
  );
}

describe('FileDiff header slots', () => {
  test('updates default header counts from the private session', async () => {
    const { cleanup } = installDom();
    const externalDiff = parseDiffFromFile(
      { name: 'session.txt', contents: 'old\n' },
      { name: 'session.txt', contents: 'new\n' }
    );
    const externalAdditionLines = externalDiff.additionLines;
    const fileContainer = document.createElement('div');
    const instance = new FileDiff({
      collapsed: true,
      disableErrorHandling: true,
    });
    let detach: ReturnType<FileDiff<undefined>['__attachEditor']> | undefined;

    try {
      instance.render({ fileDiff: externalDiff, fileContainer });
      await waitForHeaderCount(fileContainer, '[data-additions-count]', '+1');

      detach = instance.__attachEditor(createEditorInstance('file-diff'));
      instance.applyDocumentChange(
        createTextDocumentFromLines(
          'file-diff',
          ['new\n', 'extra\n'],
          'inmemory://file-diff-header'
        )
      );

      await waitForHeaderCount(fileContainer, '[data-additions-count]', '+2');
      expect(externalDiff.additionLines).toBe(externalAdditionLines);
      expect(externalDiff.additionLines).toEqual(['new\n']);
    } finally {
      detach?.();
      instance.cleanUp();
      cleanup();
    }
  });

  test('renders, updates, and removes the filename suffix slot', async () => {
    const { cleanup } = installDom();
    const fileContainer = document.createElement('div');
    const instance = new FileDiff({
      collapsed: true,
      disableErrorHandling: true,
      renderHeaderFilenameSuffix: () => createSlotContent('initial suffix'),
    });

    try {
      instance.render({ fileDiff, fileContainer, preventEmit: true });

      await waitForSlotText(
        fileContainer,
        'header-filename-suffix',
        'initial suffix'
      );

      instance.setOptions({
        ...instance.options,
        renderHeaderFilenameSuffix: () => createSlotContent('updated suffix'),
      });
      instance.render({
        fileDiff,
        fileContainer,
        forceRender: true,
        preventEmit: true,
      });

      await waitForSlotText(
        fileContainer,
        'header-filename-suffix',
        'updated suffix'
      );

      instance.setOptions({
        ...instance.options,
        renderHeaderFilenameSuffix: () => undefined,
      });
      instance.render({
        fileDiff,
        fileContainer,
        forceRender: true,
        preventEmit: true,
      });

      await waitForSlotText(fileContainer, 'header-filename-suffix', null);
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });

  test('removes the filename suffix slot when a custom header is active', async () => {
    const { cleanup } = installDom();
    const fileContainer = document.createElement('div');
    const instance = new FileDiff({
      collapsed: true,
      disableErrorHandling: true,
      renderHeaderFilenameSuffix: () => createSlotContent('suffix'),
    });

    try {
      instance.render({ fileDiff, fileContainer, preventEmit: true });
      await waitForSlotText(fileContainer, 'header-filename-suffix', 'suffix');

      instance.setOptions({
        ...instance.options,
        renderCustomHeader: () => createSlotContent('custom header'),
      });
      instance.render({
        fileDiff,
        fileContainer,
        forceRender: true,
        preventEmit: true,
      });

      await waitForSlotText(fileContainer, 'header-filename-suffix', null);
      await waitForSlotText(fileContainer, 'header-custom', 'custom header');
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });
});
