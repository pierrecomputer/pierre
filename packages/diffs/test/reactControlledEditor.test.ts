import { afterAll, describe, expect, test } from 'bun:test';
import {
  act,
  type ComponentType,
  createElement,
  type Dispatch,
  type SetStateAction,
  useState,
} from 'react';
import { createRoot as createReactRoot, type Root } from 'react-dom/client';

import { Editor } from '../src/editor/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { EditProvider } from '../src/react/EditContext';
import { File as ReactFile } from '../src/react/File';
import type { FileProps } from '../src/react/types';
import type { FileContents } from '../src/types';
import { installDom, wait } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

const ReactFileComponent = ReactFile as ComponentType<FileProps<undefined>>;

async function waitForEditableContent(
  container: HTMLElement
): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const content = container
      .querySelector('diffs-container')
      ?.shadowRoot?.querySelector('[data-content]');
    if (
      content instanceof HTMLElement &&
      (content.contentEditable === 'true' ||
        content.getAttribute('contenteditable') === 'true')
    ) {
      return content;
    }
    await wait(0);
  }
  throw new Error('editor content did not become editable');
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

describe('React controlled editor', () => {
  test('preserves the selection when onChange echoes edited contents', async () => {
    const { cleanup } = installDom();
    const cleanupActEnvironment = installReactActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root: Root | undefined;
    let setFile: Dispatch<SetStateAction<FileContents>> | undefined;
    const initialFile: FileContents = {
      name: 'controlled.ts',
      contents: 'abc',
      cacheKey: 'revision-0',
    };
    const editor = new Editor<undefined>({
      onChange: (file) => {
        setFile?.({
          ...file,
          cacheKey: `revision-${file.contents}`,
        });
      },
    });

    function ControlledFile(): React.JSX.Element {
      const [file, updateFile] = useState(initialFile);
      setFile = updateFile;
      return createElement(
        EditProvider,
        { editor },
        createElement(ReactFileComponent, {
          file,
          contentEditable: true,
          options: { disableFileHeader: true, disableErrorHandling: true },
        })
      );
    }

    try {
      root = createReactRoot(container);
      await act(async () => {
        root!.render(createElement(ControlledFile));
        await wait(0);
      });
      await waitForEditableContent(container);

      editor.setSelections([
        {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 1 },
          direction: 'none',
        },
      ]);
      editor.focus();

      await act(async () => {
        editor.applyEdits([
          {
            range: {
              start: { line: 0, character: 1 },
              end: { line: 0, character: 1 },
            },
            newText: 'X',
          },
        ]);
        await wait(0);
      });

      expect(editor.getText()).toBe('aXbc');
      expect(editor.getState().selections).toEqual([
        {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
          direction: 0,
        },
      ]);

      await act(async () => {
        setFile?.({
          name: initialFile.name,
          contents: 'external update',
          cacheKey: 'revision-external',
        });
        await wait(0);
      });

      expect(editor.getText()).toBe('external update');
    } finally {
      await act(async () => {
        root?.unmount();
        await wait(0);
      });
      editor.cleanUp();
      cleanupActEnvironment();
      cleanup();
    }
  });
});
