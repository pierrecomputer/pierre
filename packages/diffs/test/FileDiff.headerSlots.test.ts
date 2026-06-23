import { describe, expect, test } from 'bun:test';

import { FileDiff, parseDiffFromFile } from '../src';
import { installDom, wait } from './domHarness';

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

describe('FileDiff header slots', () => {
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
