import { afterAll, describe, expect, test } from 'bun:test';
import {
  act,
  type ComponentType,
  createElement,
  type ReactElement,
  StrictMode,
} from 'react';
import { createRoot as createReactRoot, type Root } from 'react-dom/client';

import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { File as ReactFile } from '../src/react/File';
import {
  FileDiff as ReactFileDiff,
  type FileDiffProps as ReactFileDiffProps,
} from '../src/react/FileDiff';
import type { FileProps as ReactFileProps } from '../src/react/types';
import type { FileContents } from '../src/types';
import { getThemes } from '../src/utils/getThemes';
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
const oldRustFile: FileContents = {
  name: 'greet.rs',
  contents:
    'fn greet(name: &str) -> String {\n  format!("Hello {}", name)\n}\n',
};
const newRustFile: FileContents = {
  name: 'greet.rs',
  contents:
    'pub fn greet(name: &str) -> String {\n  format!("Hello, {}!", name)\n}\n',
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

function getShadowRoot(container: HTMLElement): ShadowRoot | null {
  return container.querySelector('diffs-container')?.shadowRoot ?? null;
}

function countRenderedLines(container: HTMLElement): number {
  return getShadowRoot(container)?.querySelectorAll('[data-line]').length ?? 0;
}

function countHighlightedTokens(container: HTMLElement): number {
  return (
    getShadowRoot(container)?.querySelectorAll('[data-line] span[style]')
      .length ?? 0
  );
}

// 'cold' leaves no highlighter loaded, so the first render has nothing to
// render with. 'typescript-only' loads the highlighter without the language
// the test file needs, so the first render is plain text awaiting highlight.
type HighlighterState = 'cold' | 'typescript-only';

async function prepareHighlighter(state: HighlighterState): Promise<void> {
  await disposeHighlighter();
  if (state === 'typescript-only') {
    await getSharedHighlighter({
      themes: getThemes(),
      langs: ['text', 'typescript'],
    });
  }
}

// StrictMode attaches each ref, detaches it, then attaches it again on the
// SAME host node. The first instance is cleaned up mid-render and the second
// hydrates onto whatever the first left in the shadow root. The remount must
// end up with the same output as a plain mount, whatever state the first
// render was in when it was torn down.
async function mountAndMeasure(
  element: ReactElement,
  strict: boolean,
  highlighter: HighlighterState,
  measure: (container: HTMLElement) => number
): Promise<number> {
  await prepareHighlighter(highlighter);
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
    await waitFor(() => measure(container) > 0, { timeout: 3000 });
    return measure(container);
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
  createTestElement: () => ReactElement,
  highlighter: HighlighterState,
  measure: (container: HTMLElement) => number
): Promise<void> {
  const expected = await mountAndMeasure(
    createTestElement(),
    false,
    highlighter,
    measure
  );
  expect(expected).toBeGreaterThan(0);
  expect(
    await mountAndMeasure(createTestElement(), true, highlighter, measure)
  ).toBe(expected);
}

describe('React StrictMode mount', () => {
  test('FileDiff with disableFileHeader renders its lines', async () => {
    await expectStrictModeToMatch(
      () =>
        createElement(ReactFileDiffComponent, {
          fileDiff: parseDiffFromFile(oldFile, newFile),
          options: { disableFileHeader: true },
        }),
      'cold',
      countRenderedLines
    );
  });

  test('FileDiff with a file header renders its lines', async () => {
    await expectStrictModeToMatch(
      () =>
        createElement(ReactFileDiffComponent, {
          fileDiff: parseDiffFromFile(oldFile, newFile),
        }),
      'cold',
      countRenderedLines
    );
  });

  test('File with disableFileHeader renders its lines', async () => {
    await expectStrictModeToMatch(
      () =>
        createElement(ReactFileComponent, {
          file: newFile,
          options: { disableFileHeader: true },
        }),
      'cold',
      countRenderedLines
    );
  });

  test('FileDiff with disableFileHeader highlights a language the highlighter has not loaded', async () => {
    await expectStrictModeToMatch(
      () =>
        createElement(ReactFileDiffComponent, {
          fileDiff: parseDiffFromFile(oldRustFile, newRustFile),
          options: { disableFileHeader: true },
        }),
      'typescript-only',
      countHighlightedTokens
    );
  });

  test('FileDiff with a file header highlights a language the highlighter has not loaded', async () => {
    await expectStrictModeToMatch(
      () =>
        createElement(ReactFileDiffComponent, {
          fileDiff: parseDiffFromFile(oldRustFile, newRustFile),
        }),
      'typescript-only',
      countHighlightedTokens
    );
  });

  test('File with disableFileHeader highlights a language the highlighter has not loaded', async () => {
    await expectStrictModeToMatch(
      () =>
        createElement(ReactFileComponent, {
          file: newRustFile,
          options: { disableFileHeader: true },
        }),
      'typescript-only',
      countHighlightedTokens
    );
  });
});
