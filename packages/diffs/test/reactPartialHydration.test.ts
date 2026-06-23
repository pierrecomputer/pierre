import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { createTwoFilesPatch } from 'diff';
import { act, createElement, type ComponentType } from 'react';
import { createRoot as createReactRoot, type Root } from 'react-dom/client';

import {
  disposeHighlighter,
  FileDiff as ImperativeFileDiff,
  parsePatchFiles,
} from '../src';
import { HEADER_METADATA_SLOT_ID } from '../src/constants';
import {
  FileDiff as ReactFileDiff,
  type FileDiffProps as ReactFileDiffProps,
} from '../src/react/FileDiff';
import {
  PatchDiff,
  type PatchDiffProps as ReactPatchDiffProps,
} from '../src/react/PatchDiff';
import type { FileContents, FileDiffMetadata } from '../src/types';
import { installDom, wait } from './domHarness';
import { assertDefined } from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

interface PartialChange {
  oldFile: FileContents;
  newFile: FileContents;
  partial: FileDiffMetadata;
  patch: string;
}

interface HydrationCallback {
  sourceFileDiff: FileDiffMetadata;
  hydratedFileDiff: FileDiffMetadata;
  instance: ImperativeFileDiff<undefined>;
}

const ReactFileDiffComponent = ReactFileDiff as ComponentType<
  ReactFileDiffProps<undefined>
>;
const ReactPatchDiffComponent = PatchDiff as ComponentType<
  ReactPatchDiffProps<undefined>
>;

function createPartialChange(name = 'partial.txt'): PartialChange {
  const oldFile: FileContents = {
    name,
    contents: ['keep 1\n', 'old value\n', 'keep 3\n', 'keep 4\n'].join(''),
    cacheKey: `${name}:old`,
  };
  const newFile: FileContents = {
    name,
    contents: ['keep 1\n', 'new value\n', 'keep 3\n', 'keep 4\n'].join(''),
    cacheKey: `${name}:new`,
  };
  const patch = createTwoFilesPatch(
    oldFile.name,
    newFile.name,
    oldFile.contents,
    newFile.contents,
    undefined,
    undefined,
    { context: 0 }
  );
  const partial = parsePatchFiles(patch, name, true)[0]?.files[0];
  assertDefined(partial, 'expected patch to contain one file');
  expect(partial.isPartial).toBe(true);
  return { oldFile, newFile, partial, patch };
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

function getHeaderMetadataText(container: HTMLElement): string | undefined {
  return (
    container.querySelector(`[slot="${HEADER_METADATA_SLOT_ID}"]`)
      ?.textContent ?? undefined
  );
}

function renderHydrationState(fileDiff: FileDiffMetadata): string {
  return fileDiff.isPartial
    ? 'partial'
    : `full:${fileDiff.additionLines.length}`;
}

async function waitForHydration(
  callbackCalls: readonly HydrationCallback[]
): Promise<HydrationCallback> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const callbackCall = callbackCalls[0];
    if (callbackCall != null) {
      return callbackCall;
    }
    await wait(10);
  }
  throw new Error('Timed out waiting for React partial diff hydration');
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

describe('React partial diff hydration', () => {
  test('FileDiff uses the hydrated full diff for React-owned slots on parent rerender', async () => {
    const { cleanup } = installDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root: Root | undefined;
    try {
      const { oldFile, newFile, partial } = createPartialChange('react.ts');
      const callbackCalls: HydrationCallback[] = [];
      const props: ReactFileDiffProps<undefined> = {
        fileDiff: partial,
        options: {
          disableErrorHandling: true,
          expandUnchanged: true,
          loadDiffFiles: () => Promise.resolve({ oldFile, newFile }),
          onHydratedPartialDiff(
            sourceFileDiff: FileDiffMetadata,
            hydratedFileDiff: FileDiffMetadata,
            instance: ImperativeFileDiff<undefined>
          ) {
            callbackCalls.push({
              sourceFileDiff,
              hydratedFileDiff,
              instance,
            });
          },
        },
        renderHeaderMetadata: renderHydrationState,
      };

      root = createReactRoot(container);
      await act(async () => {
        root!.render(createElement(ReactFileDiffComponent, props));
        await wait(0);
      });

      expect(getHeaderMetadataText(container)).toBe('partial');
      const callbackCall = await waitForHydration(callbackCalls);
      expect(callbackCall.sourceFileDiff).toBe(partial);
      expect(callbackCall.hydratedFileDiff.isPartial).toBe(false);
      expect(callbackCall.instance.fileDiff).toBe(
        callbackCall.hydratedFileDiff
      );

      await act(async () => {
        root!.render(createElement(ReactFileDiffComponent, props));
        await wait(0);
      });

      expect(getHeaderMetadataText(container)).toBe('full:4');
      expect(callbackCall.instance.fileDiff).toBe(
        callbackCall.hydratedFileDiff
      );
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });

  test('PatchDiff keeps the hydrated parsed patch result across parent rerenders', async () => {
    const { cleanup } = installDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root: Root | undefined;
    try {
      const { oldFile, newFile, patch } = createPartialChange('patch.ts');
      const callbackCalls: HydrationCallback[] = [];
      const props: ReactPatchDiffProps<undefined> = {
        patch,
        options: {
          disableErrorHandling: true,
          expandUnchanged: true,
          loadDiffFiles: () => Promise.resolve({ oldFile, newFile }),
          onHydratedPartialDiff(
            sourceFileDiff: FileDiffMetadata,
            hydratedFileDiff: FileDiffMetadata,
            instance: ImperativeFileDiff<undefined>
          ) {
            callbackCalls.push({
              sourceFileDiff,
              hydratedFileDiff,
              instance,
            });
          },
        },
        renderHeaderMetadata: renderHydrationState,
      };

      root = createReactRoot(container);
      await act(async () => {
        root!.render(createElement(ReactPatchDiffComponent, props));
        await wait(0);
      });

      expect(getHeaderMetadataText(container)).toBe('partial');
      const callbackCall = await waitForHydration(callbackCalls);
      expect(callbackCall.sourceFileDiff.isPartial).toBe(true);
      expect(callbackCall.hydratedFileDiff.isPartial).toBe(false);
      expect(callbackCall.instance.fileDiff).toBe(
        callbackCall.hydratedFileDiff
      );

      await act(async () => {
        root!.render(createElement(ReactPatchDiffComponent, props));
        await wait(0);
      });

      expect(getHeaderMetadataText(container)).toBe('full:4');
      expect(callbackCall.instance.fileDiff).toBe(
        callbackCall.hydratedFileDiff
      );
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });

  test('FileDiff rejects a different partial source after hydration', async () => {
    const { cleanup } = installDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root: Root | undefined;
    try {
      const firstChange = createPartialChange('first.ts');
      const secondChange = createPartialChange('second.ts');
      const callbackCalls: HydrationCallback[] = [];
      const props: ReactFileDiffProps<undefined> = {
        fileDiff: firstChange.partial,
        options: {
          disableErrorHandling: true,
          expandUnchanged: true,
          loadDiffFiles: () =>
            Promise.resolve({
              oldFile: firstChange.oldFile,
              newFile: firstChange.newFile,
            }),
          onHydratedPartialDiff(
            sourceFileDiff: FileDiffMetadata,
            hydratedFileDiff: FileDiffMetadata,
            instance: ImperativeFileDiff<undefined>
          ) {
            callbackCalls.push({
              sourceFileDiff,
              hydratedFileDiff,
              instance,
            });
          },
        },
        renderHeaderMetadata: renderHydrationState,
      };

      root = createReactRoot(container);
      await act(async () => {
        root!.render(createElement(ReactFileDiffComponent, props));
        await wait(0);
      });
      await waitForHydration(callbackCalls);

      let thrownError: unknown;
      try {
        await act(async () => {
          root!.render(
            createElement(ReactFileDiffComponent, {
              ...props,
              fileDiff: secondChange.partial,
            })
          );
          await wait(0);
        });
      } catch (error: unknown) {
        thrownError = error;
      }

      expect(thrownError).toBeInstanceOf(Error);
      expect(String(thrownError)).toContain(
        'useFileDiffInstance: Cannot replace a rendered full diff with a different partial diff.'
      );
    } finally {
      consoleError.mockRestore();
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });
});
