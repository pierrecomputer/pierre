import { afterAll, describe, expect, test } from 'bun:test';
import { act, type ComponentType, createElement } from 'react';
import { createRoot as createReactRoot, type Root } from 'react-dom/client';

import { File as FileInstance, type FileOptions } from '../src/components/File';
import {
  FileDiff as FileDiffInstance,
  type FileDiffOptions,
} from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import {
  File as ReactFile,
  type FileProps as ReactFileProps,
} from '../src/react';
import { EditProvider } from '../src/react/EditContext';
import {
  FileDiff as ReactFileDiff,
  type FileDiffProps as ReactFileDiffProps,
} from '../src/react/FileDiff';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom, wait } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

const ReactFileComponent = ReactFile as ComponentType<
  ReactFileProps<undefined>
>;
const ReactFileDiffComponent = ReactFileDiff as ComponentType<
  ReactFileDiffProps<undefined>
>;

const EDIT_OPTIONS = {
  enableGutterUtility: true,
  enableLineSelection: true,
  lineHoverHighlight: 'both',
  useTokenTransformer: false,
} as const;

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

async function unmountRoot(root: Root | undefined): Promise<void> {
  if (root == null) {
    return;
  }
  await act(async () => {
    root.unmount();
    await wait(0);
  });
}

function expectEditorOptions(
  options: Pick<
    FileOptions<undefined>,
    | 'enableGutterUtility'
    | 'enableLineSelection'
    | 'lineHoverHighlight'
    | 'useTokenTransformer'
  >
): void {
  expect(options.useTokenTransformer).toBe(true);
  expect(options.enableGutterUtility).toBe(true);
  expect(options.enableLineSelection).toBe(true);
  expect(options.lineHoverHighlight).toBe('both');
}

describe('React editor option normalization', () => {
  test('File preserves interaction options while content editable', async () => {
    const { cleanup } = installDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = new Editor<undefined>();
    let instance: FileInstance<undefined> | undefined;
    let root: Root | undefined;
    const options: FileOptions<undefined> = {
      ...EDIT_OPTIONS,
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      onPostRender(_node, current, phase) {
        if (phase !== 'unmount') {
          instance = current;
        }
      },
    };
    try {
      root = createReactRoot(container);
      await act(async () => {
        root!.render(
          createElement(
            EditProvider,
            { editor },
            createElement(ReactFileComponent, {
              contentEditable: true,
              disableWorkerPool: true,
              file: { name: 'edit.ts', contents: 'const value = 1;\n' },
              options,
            })
          )
        );
        await wait(10);
      });

      expect(instance).toBeDefined();
      expectEditorOptions(instance!.options);
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });

  test('FileDiff preserves interaction options while content editable', async () => {
    const { cleanup } = installDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = new Editor<undefined>();
    let instance: FileDiffInstance<undefined> | undefined;
    let root: Root | undefined;
    const options: FileDiffOptions<undefined> = {
      ...EDIT_OPTIONS,
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
      onPostRender(_node, current, phase) {
        if (phase !== 'unmount') {
          instance = current;
        }
      },
    };
    const fileDiff = parseDiffFromFile(
      { name: 'edit.ts', contents: 'const value = 1;\n' },
      { name: 'edit.ts', contents: 'const value = 2;\n' }
    );
    try {
      root = createReactRoot(container);
      await act(async () => {
        root!.render(
          createElement(
            EditProvider,
            { editor },
            createElement(ReactFileDiffComponent, {
              contentEditable: true,
              disableWorkerPool: true,
              fileDiff,
              options,
            })
          )
        );
        await wait(10);
      });

      expect(instance).toBeDefined();
      expectEditorOptions(instance!.options);
    } finally {
      await unmountRoot(root);
      cleanupActEnvironment();
      cleanup();
    }
  });
});
