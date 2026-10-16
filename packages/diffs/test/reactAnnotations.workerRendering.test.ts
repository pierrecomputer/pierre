import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createTwoFilesPatch } from 'diff';
import { act, createElement, createRef, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

import { Editor } from '../src/editor/editor';
import type { EditorFactory } from '../src/editor/types';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { CodeView, type CodeViewHandle } from '../src/react/CodeView';
import { EditProvider } from '../src/react/EditContext';
import { File } from '../src/react/File';
import { FileDiff } from '../src/react/FileDiff';
import { MultiFileDiff } from '../src/react/MultiFileDiff';
import { PatchDiff } from '../src/react/PatchDiff';
import { UnresolvedFile } from '../src/react/UnresolvedFile';
import { Virtualizer } from '../src/react/Virtualizer';
import { WorkerPoolContext } from '../src/react/WorkerPoolContext';
import { preloadFileDiff } from '../src/ssr';
import type {
  CodeViewItem,
  DiffLineAnnotation,
  DiffsHighlighter,
  FileContents,
  FileDiffMetadata,
  PostRenderPhase,
} from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../src/utils/renderFileWithHighlighter';
import type { RenderDiffRequest } from '../src/worker/types';
import { installDom, wait, waitFor } from './domHarness';
import { createInitializedManager, withTimeout } from './workerPoolHarness';

let highlighter: DiffsHighlighter;
beforeAll(async () => {
  highlighter = await getSharedHighlighter({
    themes: ['pierre-dark'],
    langs: ['typescript'],
    preferredHighlighter: 'shiki-js',
  });
});
afterAll(async () => {
  await disposeHighlighter();
});

const files: Record<'A' | 'B' | 'C', FileContents> = {
  A: {
    name: 'pending.ts',
    contents: 'const alpha = 1;\nconst stable = 0;\n',
    cacheKey: 'react:alpha',
  },
  B: {
    name: 'pending.ts',
    contents: 'const stable = 0;\nconst beta = 2;\n',
    cacheKey: 'react:beta',
  },
  C: {
    name: 'pending.ts',
    contents: 'const gamma = 3;\n',
    cacheKey: 'react:gamma',
  },
};
const oldFile: FileContents = {
  name: 'pending.ts',
  contents: 'const before = 0;\n',
  cacheKey: 'react:before',
};
const diffs = {
  A: parseDiffFromFile(oldFile, files.A),
  B: parseDiffFromFile(oldFile, files.B),
  C: parseDiffFromFile(oldFile, files.C),
};
const annotationsA: DiffLineAnnotation<string>[] = [
  { side: 'additions', lineNumber: 1, metadata: 'annotation A' },
];
const annotationsB: DiffLineAnnotation<string>[] = [
  { side: 'additions', lineNumber: 2, metadata: 'annotation B' },
];

// Worker responses drive React updates without another parent render.
async function createFixture() {
  const dom = installDom();
  const previousActEnvironment = Reflect.get(
    globalThis,
    'IS_REACT_ACT_ENVIRONMENT'
  );
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  const { manager, worker } = await createInitializedManager({
    theme: 'pierre-dark',
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const phases: PostRenderPhase[] = [];
  const options = {
    theme: 'pierre-dark',
    disableErrorHandling: true,
    onPostRender(
      _node: HTMLElement,
      _instance: unknown,
      phase: PostRenderPhase
    ) {
      phases.push(phase);
    },
  };
  const render = async (element: ReactElement) => {
    await act(async () => {
      root.render(
        createElement(WorkerPoolContext.Provider, { value: manager }, element)
      );
      await wait(20);
    });
  };
  const respond = async (
    type: 'file' | 'diff',
    version: 'A' | 'B' | 'C',
    count: number
  ) => {
    await waitFor(
      () =>
        (type === 'file' ? worker.fileRequestCount : worker.diffRequestCount) >=
        count
    );
    const request =
      type === 'file'
        ? await withTimeout(worker.waitForFileRequest())
        : await withTimeout(worker.waitForDiffRequest());
    await act(async () => {
      if (type === 'file') {
        const renderOptions = manager.getFileRenderOptions();
        worker.respond({
          type: 'success',
          requestType: 'file',
          id: request.id,
          result: renderFileWithHighlighter(
            files[version],
            highlighter,
            renderOptions
          ),
          options: renderOptions,
          sentAt: Date.now(),
        });
      } else {
        const renderOptions = manager.getDiffRenderOptions();
        worker.respond({
          type: 'success',
          requestType: 'diff',
          id: request.id,
          result: renderDiffWithHighlighter(
            diffs[version],
            highlighter,
            renderOptions
          ),
          options: renderOptions,
          sentAt: Date.now(),
        });
      }
      await wait(30);
    });
  };
  return {
    container,
    manager,
    worker,
    options,
    phases,
    render,
    respond,
    async cleanup() {
      await act(async () => {
        root.unmount();
        await wait(0);
      });
      manager.terminate();
      Reflect.set(
        globalThis,
        'IS_REACT_ACT_ENVIRONMENT',
        previousActEnvironment
      );
      dom.cleanup();
    },
  };
}

for (const type of ['file', 'diff', 'multi', 'patch'] as const) {
  test.each([false, true])(
    `React ${type} retains matching annotation children during delayed movement and removal (virtualized: %s)`,
    async (virtualized) => {
      const fixture = await createFixture();
      const { container, options, respond, phases } = fixture;
      const render = (element: ReactElement) =>
        fixture.render(
          virtualized ? createElement(Virtualizer, null, element) : element
        );
      const displayedContents: (FileContents | FileDiffMetadata)[] = [];
      const shadowContentsBeforeB: (string | null | undefined)[] = [];
      const annotationContentsAfterB: (string | null)[] = [];
      const element = (
        version: 'A' | 'B' | 'C',
        lineAnnotations: DiffLineAnnotation<string>[]
      ) => {
        const shared = {
          options: {
            ...options,
            onPostRender(
              node: HTMLElement,
              instance: unknown,
              phase: PostRenderPhase
            ) {
              options.onPostRender(node, instance, phase);
              if (
                phase !== 'unmount' &&
                node.shadowRoot?.textContent?.includes('const beta = 2;') ===
                  true
              ) {
                annotationContentsAfterB.push(node.textContent);
              }
            },
          },
          lineAnnotations,
          renderAnnotation(
            annotation: DiffLineAnnotation<string>,
            fileOrDiff: FileContents | FileDiffMetadata
          ) {
            displayedContents.push(fileOrDiff);
            if (annotation.metadata === 'annotation B') {
              shadowContentsBeforeB.push(
                container.querySelector('diffs-container')?.shadowRoot
                  ?.textContent
              );
            }
            return annotation.metadata;
          },
        };
        if (type === 'file')
          return createElement(File<string>, {
            ...shared,
            file: files[version],
          });
        if (type === 'diff')
          return createElement(FileDiff<string>, {
            ...shared,
            fileDiff: diffs[version],
          });
        if (type === 'patch')
          return createElement(PatchDiff<string>, {
            ...shared,
            patch: createTwoFilesPatch(
              oldFile.name,
              files[version].name,
              oldFile.contents,
              files[version].contents
            ),
          });
        return createElement(MultiFileDiff<string>, {
          ...shared,
          oldFile,
          newFile: files[version],
        });
      };
      try {
        await render(element('A', annotationsA));
        await respond(type === 'file' ? 'file' : 'diff', 'A', 1);
        expect(container.textContent).toContain('annotation A');
        const displayedA = displayedContents.at(-1);
        if (type === 'file' || type === 'diff') {
          expect(displayedA).toBe(type === 'file' ? files.A : diffs.A);
        }

        await render(element('B', annotationsB));
        expect(container.textContent).toContain('annotation A');
        expect(container.textContent).not.toContain('annotation B');
        expect(displayedContents.at(-1)).toBe(displayedA);
        await respond(type === 'file' ? 'file' : 'diff', 'B', 2);
        expect(container.textContent).not.toContain('annotation A');
        expect(container.textContent).toContain('annotation B');
        expect(shadowContentsBeforeB[0]).toContain('const alpha = 1;');
        expect(annotationContentsAfterB.length).toBeGreaterThan(0);
        expect(
          annotationContentsAfterB.every(
            (content) => content?.includes('annotation B') === true
          )
        ).toBe(true);
        const displayedB = displayedContents.at(-1);
        if (displayedB == null) throw new Error('Expected displayed content');
        if (type === 'file' || type === 'diff') {
          expect(displayedB).toBe(type === 'file' ? files.B : diffs.B);
        }
        expect(
          'contents' in displayedB
            ? displayedB.contents
            : displayedB.additionLines.join('')
        ).toBe(files.B.contents);
        expect(container.querySelector('[slot$="-2"]')?.textContent).toContain(
          'annotation B'
        );

        await render(element('C', []));
        expect(container.textContent).toContain('annotation B');
        expect(displayedContents.at(-1)).toBe(displayedB);
        await respond(type === 'file' ? 'file' : 'diff', 'C', 3);
        expect(container.textContent).not.toContain('annotation B');

        await render(element('C', annotationsA));
        expect(container.textContent).toContain('annotation A');
        expect(phases).toContain('mount');
        expect(phases).toContain('update');
        expect(phases.length).toBeLessThan(15);
      } finally {
        await fixture.cleanup();
      }
      expect(phases.at(-1)).toBe('unmount');
    }
  );
}

for (const type of ['file', 'diff'] as const) {
  test.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    `React CodeView ${type} keeps displayed annotations while the input version advances (header and gutter slots: %s, controlled: %s)`,
    async (withOtherSlots, controlled) => {
      const fixture = await createFixture();
      const { container, options, render, respond } = fixture;
      const ref = createRef<CodeViewHandle<string, undefined>>();
      const contexts: CodeViewItem<string>[] = [];
      const displayedContents: (FileContents | FileDiffMetadata)[] = [];
      const headerContexts: CodeViewItem<string>[] = [];
      const gutterContexts: CodeViewItem<string>[] = [];
      const item = (
        version: 'A' | 'B',
        annotations: DiffLineAnnotation<string>[]
      ): CodeViewItem<string> =>
        type === 'file'
          ? {
              id: 'pending',
              type,
              file: files[version],
              annotations,
              version: version === 'A' ? 0 : 1,
            }
          : {
              id: 'pending',
              type,
              fileDiff: diffs[version],
              annotations,
              version: version === 'A' ? 0 : 1,
            };
      const itemA = item('A', annotationsA);
      const itemB = item('B', []);
      const element = (input: CodeViewItem<string>) =>
        createElement(CodeView<string>, {
          ref,
          ...(controlled ? { items: [input] } : { initialItems: [input] }),
          options: { ...options, stickyHeaders: false },
          renderAnnotation(annotation, fileOrDiff, context) {
            contexts.push(context);
            displayedContents.push(fileOrDiff);
            return annotation.metadata;
          },
          renderHeaderPrefix: withOtherSlots
            ? (context) => {
                headerContexts.push(context);
                return `header:${context.version}`;
              }
            : undefined,
          renderGutterUtility: withOtherSlots
            ? (_getHoveredLine, context) => {
                gutterContexts.push(context);
                return `gutter:${context.version}`;
              }
            : undefined,
        });
      const update = async (item: CodeViewItem<string>) => {
        if (controlled) {
          await render(element(item));
        } else {
          await act(async () => {
            ref.current?.updateItem(item);
            await wait(30);
          });
        }
      };
      try {
        await render(element(itemA));
        await respond(type, 'A', 1);
        expect(container.textContent).toContain('annotation A');
        expect(contexts.at(-1)).toBe(itemA);
        const initialContent = displayedContents.at(-1);
        await update(itemB);
        expect(container.textContent).toContain('annotation A');
        expect(contexts.at(-1)).toBe(itemB);
        expect(displayedContents.at(-1)).toBe(initialContent);
        expect(displayedContents.at(-1)).toBe(
          type === 'file' ? files.A : diffs.A
        );
        expect(ref.current?.getInstance()?.getRenderedItems()[0]?.item).toBe(
          itemB
        );
        if (withOtherSlots) {
          expect(headerContexts.at(-1)).toBe(itemB);
          expect(gutterContexts.at(-1)).toBe(itemB);
        }
        await respond(type, 'B', 2);
        expect(container.textContent).not.toContain('annotation A');
        const annotatedB = { ...itemB, annotations: annotationsB, version: 2 };
        await update(annotatedB);
        expect(container.textContent).toContain('annotation B');
        expect(contexts.at(-1)).toBe(annotatedB);
        expect(displayedContents.at(-1)).toBe(
          type === 'file' ? files.B : diffs.B
        );
      } finally {
        await fixture.cleanup();
      }
    }
  );
}

for (const type of ['file', 'diff'] as const) {
  test(`React CodeView ${type} keeps annotation content unchanged when editing moves its row`, async () => {
    const fixture = await createFixture();
    const { container, options, render } = fixture;
    let editor: Editor<'file' | 'file-diff', string> | undefined;
    const createEditor: EditorFactory<string, undefined> = (
      editorType,
      editorOptions
    ) => {
      const instance = new Editor(editorType, editorOptions);
      editor = instance;
      return instance;
    };
    const item: CodeViewItem<string> =
      type === 'file'
        ? {
            id: 'editing',
            type,
            file: files.A,
            edit: true,
            annotations: [{ lineNumber: 2, metadata: 'note' }],
          }
        : {
            id: 'editing',
            type,
            fileDiff: diffs.A,
            edit: true,
            annotations: [
              { side: 'additions', lineNumber: 2, metadata: 'note' },
            ],
          };
    let annotationRenderCount = 0;
    let callbackItem: CodeViewItem<string> | undefined;
    let displayedContent: FileContents | FileDiffMetadata | undefined;
    try {
      await render(
        createElement(
          EditProvider<string>,
          { createEditor },
          createElement(CodeView<string>, {
            disableWorkerPool: true,
            items: [item],
            options: { ...options, diffStyle: 'unified', stickyHeaders: false },
            renderAnnotation(annotation, fileOrDiff, input) {
              annotationRenderCount++;
              callbackItem = input;
              displayedContent = fileOrDiff;
              return `${annotation.metadata}:${annotation.lineNumber}`;
            },
          })
        )
      );
      await waitFor(() => editor?.getText() === files.A.contents);
      const renderCountBeforeEdit = annotationRenderCount;
      const slotName =
        type === 'file' ? 'annotation-2' : 'annotation-additions-2';
      const annotationElement = container.querySelector(`[slot="${slotName}"]`);
      await act(async () => {
        editor!.applyEdits([
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: 'pad\n',
          },
        ]);
        await wait(30);
      });
      expect(container.textContent).toContain('note:2');
      expect(annotationRenderCount).toBe(renderCountBeforeEdit);
      expect(container.querySelector(`[slot="${slotName}"]`)).toBe(
        annotationElement
      );
      const row = container
        .querySelector('diffs-container')
        ?.shadowRoot?.querySelector('[data-line-annotation]');
      expect(row?.previousElementSibling?.getAttribute('data-line')).toBe('3');
      expect(callbackItem).toBe(item);
      expect(item.annotations?.[0].lineNumber).toBe(2);
      if (displayedContent == null)
        throw new Error('Expected displayed editing content');
      expect(
        'contents' in displayedContent
          ? displayedContent.contents
          : displayedContent.additionLines.join('')
      ).toBe(files.A.contents);
      expect(displayedContent).toBe(type === 'file' ? files.A : diffs.A);
    } finally {
      await fixture.cleanup();
    }
  });

  test(`React CodeView ${type} keeps an edited item's annotation content when another item rerenders`, async () => {
    const fixture = await createFixture();
    const { container, options, render } = fixture;
    let editor: Editor<'file' | 'file-diff', string> | undefined;
    const createEditor: EditorFactory<string, undefined> = (
      editorType,
      editorOptions
    ) => {
      const instance = new Editor(editorType, editorOptions);
      editor = instance;
      return instance;
    };
    const item = (
      id: string,
      version: 'A' | 'B',
      edit: boolean
    ): CodeViewItem<string> =>
      type === 'file'
        ? {
            id,
            type,
            file: files[version],
            edit,
            annotations: [{ lineNumber: 2, metadata: id }],
          }
        : {
            id,
            type,
            fileDiff: diffs[version],
            edit,
            annotations: [{ side: 'additions', lineNumber: 2, metadata: id }],
          };
    const ref = createRef<CodeViewHandle<string, undefined>>();
    const renderCounts = new Map<string, number>();
    try {
      await render(
        createElement(
          EditProvider<string>,
          { createEditor },
          createElement(CodeView<string>, {
            ref,
            disableWorkerPool: true,
            items: [item('editing', 'A', true), item('sibling', 'B', false)],
            options: { ...options, diffStyle: 'unified', stickyHeaders: false },
            renderAnnotation(annotation, _fileOrDiff, input) {
              renderCounts.set(input.id, (renderCounts.get(input.id) ?? 0) + 1);
              return `${annotation.metadata}:${annotation.lineNumber}`;
            },
          })
        )
      );
      await waitFor(() => editor?.getText() === files.A.contents);
      await act(async () => {
        editor!.applyEdits([
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: 'pad\n',
          },
        ]);
        await wait(30);
      });
      const editingCount = renderCounts.get('editing');
      expect(editingCount).toBeGreaterThan(0);
      const sibling = ref.current
        ?.getInstance()
        ?.getRenderedItems()
        .find((rendered) => rendered.id === 'sibling');
      if (sibling == null) throw new Error('Expected the sibling to render');
      await act(async () => {
        sibling.instance.rerender();
        await wait(30);
      });
      expect(renderCounts.get('editing')).toBe(editingCount);
      expect(container.textContent).toContain('editing:2');
    } finally {
      await fixture.cleanup();
    }
  });

  test(`React ${type} resets frozen annotation slots while rejected completion is highlighted`, async () => {
    const fixture = await createFixture();
    const { container, manager, worker, options, render } = fixture;
    let editor: Editor<'file' | 'file-diff', string> | undefined;
    const createEditor: EditorFactory<string, undefined> = (
      editorType,
      editorOptions
    ) => {
      const instance = new Editor(editorType, editorOptions);
      editor = instance;
      return instance;
    };
    const element = (edit: boolean) =>
      createElement(
        EditProvider<string>,
        { createEditor },
        type === 'file'
          ? createElement(File<string>, {
              file: files.A,
              edit,
              options,
              lineAnnotations: [{ lineNumber: 2, metadata: 'note' }],
              onEditComplete: (): 'reject' => 'reject',
              renderAnnotation: (annotation) =>
                `${annotation.metadata}:${annotation.lineNumber}`,
            })
          : createElement(FileDiff<string>, {
              fileDiff: diffs.A,
              edit,
              options: { ...options, diffStyle: 'unified' },
              lineAnnotations: [
                { side: 'additions', lineNumber: 2, metadata: 'note' },
              ],
              onEditComplete: (): 'reject' => 'reject',
              renderAnnotation: (annotation) =>
                `${annotation.metadata}:${annotation.lineNumber}`,
            })
      );
    const respond = async () => {
      const request =
        type === 'file'
          ? await withTimeout(worker.waitForFileRequest())
          : await withTimeout(worker.waitForDiffRequest());
      await act(async () => {
        if (request.type === 'file') {
          const renderOptions = manager.getFileRenderOptions();
          worker.respond({
            type: 'success',
            requestType: 'file',
            id: request.id,
            result: renderFileWithHighlighter(
              request.file,
              highlighter,
              renderOptions
            ),
            options: renderOptions,
            sentAt: Date.now(),
          });
        } else {
          const renderOptions = manager.getDiffRenderOptions();
          worker.respond({
            type: 'success',
            requestType: 'diff',
            id: request.id,
            result: renderDiffWithHighlighter(
              request.diff,
              highlighter,
              renderOptions
            ),
            options: renderOptions,
            sentAt: Date.now(),
          });
        }
        await wait(30);
      });
    };
    const slotPrefix =
      type === 'file' ? 'annotation-' : 'annotation-additions-';
    try {
      await render(element(false));
      await respond();
      await render(element(true));
      await waitFor(() => editor?.getText() === files.A.contents);
      act(() =>
        editor!.applyEdits([
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: 'pad\n',
          },
        ])
      );
      expect(
        container.querySelector(`[slot="${slotPrefix}2"]`)?.textContent
      ).toBe('note:2');
      if (type === 'file') manager.evictFileFromCache(files.A.cacheKey!);
      else manager.evictDiffFromCache(diffs.A.cacheKey!);
      const count =
        type === 'file' ? worker.fileRequestCount : worker.diffRequestCount;
      await render(element(false));
      await waitFor(
        () =>
          (type === 'file'
            ? worker.fileRequestCount
            : worker.diffRequestCount) > count
      );
      expect(
        container.querySelector(`[slot="${slotPrefix}3"]`)?.textContent
      ).toBe('note:3');
      expect(
        container
          .querySelector('diffs-container')
          ?.shadowRoot?.querySelector(`slot[name="${slotPrefix}3"]`)
      ).not.toBeNull();
      await respond();
      expect(
        container.querySelector(`[slot="${slotPrefix}2"]`)?.textContent
      ).toBe('note:2');
    } finally {
      await fixture.cleanup();
    }
  });

  test(`React ${type} shows the edited content's annotations when editing starts during a replacement`, async () => {
    const fixture = await createFixture();
    const { container, options, render, respond } = fixture;
    let editor: Editor<'file' | 'file-diff', string> | undefined;
    const createEditor: EditorFactory<string, undefined> = (
      editorType,
      editorOptions
    ) => {
      const instance = new Editor(editorType, editorOptions);
      editor = instance;
      return instance;
    };
    const element = (version: 'A' | 'B', edit: boolean) => {
      const metadata = `annotation ${version}`;
      return createElement(
        EditProvider<string>,
        { createEditor },
        type === 'file'
          ? createElement(File<string>, {
              file: files[version],
              edit,
              options,
              lineAnnotations: [{ lineNumber: 1, metadata }],
              renderAnnotation: (annotation) => annotation.metadata,
            })
          : createElement(FileDiff<string>, {
              fileDiff: diffs[version],
              edit,
              options: { ...options, diffStyle: 'unified' },
              lineAnnotations: [{ side: 'additions', lineNumber: 1, metadata }],
              renderAnnotation: (annotation) => annotation.metadata,
            })
      );
    };
    try {
      await render(element('A', false));
      await respond(type, 'A', 1);
      expect(container.textContent).toContain('annotation A');
      // B is still highlighting, but the editor shows it once it attaches.
      await render(element('B', true));
      await waitFor(() => editor?.getText() === files.B.contents);
      expect(container.textContent).toContain('annotation B');
      expect(container.textContent).not.toContain('annotation A');
    } finally {
      await fixture.cleanup();
    }
  });
}

for (const custom of [false, true]) {
  test(`React UnresolvedFile keeps ${custom ? 'custom' : 'default'} actions and annotations during sequential resolutions`, async () => {
    const fixture = await createFixture();
    const { container, options, render, worker, manager } = fixture;
    const actionsAfterResolution: number[] = [];
    const file: FileContents = {
      name: 'conflicts.ts',
      cacheKey: 'react:conflicts',
      contents:
        [
          '<<<<<<< ours',
          'const first = 1;',
          '=======',
          'const first = 2;',
          '>>>>>>> theirs',
          'const middle = 0;',
          '<<<<<<< ours',
          'const second = 3;',
          '=======',
          'const second = 4;',
          '>>>>>>> theirs',
        ].join('\n') + '\n',
    };
    const element = (lineAnnotations: DiffLineAnnotation<string>[]) =>
      createElement(UnresolvedFile<string>, {
        file,
        options: {
          ...options,
          onPostRender(node, instance, phase) {
            options.onPostRender(node, instance, phase);
            if (
              custom &&
              phase !== 'unmount' &&
              node.shadowRoot?.textContent?.includes('const second = 3;') ===
                true &&
              node.shadowRoot?.textContent?.includes('const second = 4;') ===
                false
            ) {
              actionsAfterResolution.push(
                node.querySelectorAll('[data-conflict]').length
              );
            }
          },
        },
        lineAnnotations,
        renderAnnotation: (annotation) => annotation.metadata,
        renderMergeConflictUtility: custom
          ? (action, getInstance) => {
              return createElement(
                'button',
                {
                  'data-conflict': action.conflictIndex,
                  onClick() {
                    const instance = getInstance();
                    instance?.options.onMergeConflictAction?.(
                      { resolution: 'current', conflict: action.conflict },
                      instance
                    );
                  },
                },
                `conflict ${action.conflictIndex}`
              );
            }
          : undefined,
      });
    const respondRequest = async (request: RenderDiffRequest) => {
      const renderOptions = manager.getDiffRenderOptions();
      await act(async () => {
        worker.respond({
          type: 'success',
          requestType: 'diff',
          id: request.id,
          result: renderDiffWithHighlighter(
            request.diff,
            highlighter,
            renderOptions
          ),
          options: renderOptions,
          sentAt: Date.now(),
        });
        await wait(30);
      });
    };
    const respond = async (count: number) => {
      await waitFor(() => worker.diffRequestCount >= count);
      await respondRequest(await withTimeout(worker.waitForDiffRequest()));
    };
    const click = async (index: number) => {
      const button = getButton(index);
      if (button == null) throw new Error(`Missing conflict ${index}`);
      await act(async () => {
        button.click();
        await wait(20);
      });
    };
    const getButton = (index: number) =>
      custom
        ? container.querySelector<HTMLButtonElement>(
            `button[data-conflict="${index}"]`
          )
        : container
            .querySelector('diffs-container')
            ?.shadowRoot?.querySelector<HTMLButtonElement>(
              `button[data-merge-conflict-action="current"][data-merge-conflict-conflict-index="${index}"]`
            );
    try {
      await render(element(annotationsA));
      await respond(1);
      await click(0);
      await render(element(annotationsB));
      expect(getButton(0)).not.toBeNull();
      expect(container.textContent).toContain('annotation A');
      expect(container.textContent).not.toContain('annotation B');
      await waitFor(() => worker.diffRequestCount >= 2);
      const pendingRequest = await withTimeout(worker.waitForDiffRequest());
      const pendingCount = worker.diffRequestCount;
      await click(1);
      await respondRequest(pendingRequest);
      await respond(pendingCount + 1);
      await act(async () => {
        await wait(60);
      });
      expect(getButton(0)).toBeNull();
      expect(getButton(1)).toBeNull();
      if (custom) {
        expect(actionsAfterResolution.length).toBeGreaterThan(0);
        expect(actionsAfterResolution.every((count) => count === 0)).toBe(true);
      }
      expect(container.textContent).toContain('annotation B');
      expect(
        container.querySelector('diffs-container')?.shadowRoot?.textContent
      ).toContain('const second = 3;');
    } finally {
      await fixture.cleanup();
    }
  });
}

test('React FileDiff keeps hydrated annotations while a replacement is highlighted', async () => {
  const fixture = await createFixture();
  const { container, options, render, respond } = fixture;
  const { prerenderedHTML } = await preloadFileDiff({
    fileDiff: diffs.A,
    options,
    annotations: annotationsA,
  });
  const element = (version: 'A' | 'B') =>
    createElement(FileDiff<string>, {
      fileDiff: diffs[version],
      options,
      prerenderedHTML,
      lineAnnotations: version === 'A' ? annotationsA : annotationsB,
      renderAnnotation: (annotation) => annotation.metadata,
    });
  const hasAnnotationRow = (line: number) =>
    container
      .querySelector('diffs-container')
      ?.shadowRoot?.querySelector(
        `slot[name="annotation-additions-${line}"]`
      ) != null;
  try {
    await render(element('A'));
    expect(container.textContent).toContain('annotation A');

    await render(element('B'));
    expect(container.textContent).toContain('annotation A');
    expect(container.textContent).not.toContain('annotation B');
    expect(hasAnnotationRow(1)).toBe(true);
    expect(hasAnnotationRow(2)).toBe(false);

    // Hydration requests A's highlight first; B is requested after it.
    await respond('diff', 'A', 1);
    expect(container.textContent).toContain('annotation A');
    await respond('diff', 'B', 2);
    await waitFor(
      () => container.textContent?.includes('annotation B') === true
    );
    expect(container.textContent).not.toContain('annotation A');
    expect(hasAnnotationRow(1)).toBe(false);
    expect(hasAnnotationRow(2)).toBe(true);
  } finally {
    await fixture.cleanup();
  }
});
