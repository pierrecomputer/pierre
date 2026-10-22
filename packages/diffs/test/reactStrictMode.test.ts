import { afterAll, describe, expect, test } from 'bun:test';
import {
  act,
  type ComponentType,
  createElement,
  type ReactElement,
  StrictMode,
} from 'react';
import { createRoot as createReactRoot, type Root } from 'react-dom/client';

import { disposeHighlighter } from '../src';
import { File as ReactFile } from '../src/react/File';
import {
  FileDiff as ReactFileDiff,
  type FileDiffProps as ReactFileDiffProps,
} from '../src/react/FileDiff';
import type { FileProps as ReactFileProps } from '../src/react/types';
import type { FileContents } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom, wait, waitFor } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

const ReactFileDiffComponent = ReactFileDiff as ComponentType<
  ReactFileDiffProps<undefined, undefined>
>;
const ReactFileComponent = ReactFile as ComponentType<
  ReactFileProps<undefined, undefined>
>;

const oldFile: FileContents = {
  name: 'greet.ts',
  contents: 'export function greet(name) {\n  return "Hello " + name;\n}\n',
};
const newFile: FileContents = {
  name: 'greet.ts',
  contents:
    'export function greet(name: string) {\n  return `Hello, ${name}!`;\n}\n',
};

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

function countRenderedLines(container: HTMLElement): number {
  return (
    container
      .querySelector('diffs-container')
      ?.shadowRoot?.querySelectorAll('[data-line]').length ?? 0
  );
}

// StrictMode attaches each ref, detaches it, then attaches it again to the
// SAME host node. The first instance's render appends a <pre> before the
// highlighter is ready and returns early; if cleanUp leaves that empty <pre>
// in the shadow root, the second instance's hydrate() adopts it, skips the
// render path, and the follow-up render early-returns because the diff is
// unchanged. With the file header disabled nothing else forces a render, so
// the diff stays blank until its props change.
async function mountAndCountLines(
  element: ReactElement,
  strict: boolean
): Promise<number> {
  // A warm highlighter renders synchronously, which hides the bug.
  await disposeHighlighter();
  const { cleanup } = installDom();
  const cleanupActEnvironment = installReactActEnvironment();
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | undefined;
  try {
    root = createReactRoot(container);
    await act(async () => {
      root!.render(strict ? createElement(StrictMode, null, element) : element);
      await wait(0);
    });
    await waitFor(() => countRenderedLines(container) > 0, { timeout: 3000 });
    return countRenderedLines(container);
  } finally {
    await act(async () => {
      root?.unmount();
      await wait(0);
    });
    cleanupActEnvironment();
    cleanup();
  }
}

async function expectStrictModeToMatch(
  createTestElement: () => ReactElement
): Promise<void> {
  const expected = await mountAndCountLines(createTestElement(), false);
  expect(expected).toBeGreaterThan(0);
  expect(await mountAndCountLines(createTestElement(), true)).toBe(expected);
}

describe('React StrictMode mount', () => {
  test('FileDiff with disableFileHeader renders its lines', async () => {
    await expectStrictModeToMatch(() =>
      createElement(ReactFileDiffComponent, {
        fileDiff: parseDiffFromFile(oldFile, newFile),
        options: { disableFileHeader: true },
      })
    );
  });

  test('FileDiff with a file header renders its lines', async () => {
    await expectStrictModeToMatch(() =>
      createElement(ReactFileDiffComponent, {
        fileDiff: parseDiffFromFile(oldFile, newFile),
      })
    );
  });

  test('File with disableFileHeader renders its lines', async () => {
    await expectStrictModeToMatch(() =>
      createElement(ReactFileComponent, {
        file: newFile,
        options: { disableFileHeader: true },
      })
    );
  });
});
