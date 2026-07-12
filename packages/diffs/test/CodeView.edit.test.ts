import { describe, expect, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import { Editor } from '../src/editor/editor';
import type {
  CodeViewCreateEditorOptions,
  CodeViewItem,
  DiffLineAnnotation,
  DiffsEditableComponent,
  DiffsEditor,
  FileContents,
  HighlightedToken,
} from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import {
  createRoot,
  dispatchScroll,
  installDom,
  makeFile,
  renderItems,
  wait,
} from './domHarness';

interface StubEditor extends DiffsEditor<undefined> {
  /** Instances passed to edit(), in order. */
  edits: DiffsEditableComponent<undefined>[];
  fullCleanUps: number;
  recycleCleanUps: number;
  /** The CodeView-built onChange handed to the factory. */
  emitChange(
    file: FileContents,
    lineAnnotations?: DiffLineAnnotation<undefined>[]
  ): void;
}

// Recording stand-in for the Editor class. It attaches to the instance like
// the real editor does (so virtualization release reaches editor.cleanUp via
// the instance) but performs no document or DOM work.
function createEditorHarness() {
  const editors: StubEditor[] = [];
  const createEditor = (
    options: CodeViewCreateEditorOptions<undefined>
  ): StubEditor => {
    let detach: ((recycle?: boolean) => void) | undefined;
    const editor: StubEditor = {
      edits: [],
      fullCleanUps: 0,
      recycleCleanUps: 0,
      emitChange: options.onChange,
      edit(instance) {
        editor.edits.push(instance);
        detach = instance.attachEditor(editor);
        return () => editor.cleanUp();
      },
      cleanUp(recycle = false) {
        if (recycle) {
          editor.recycleCleanUps += 1;
        } else {
          editor.fullCleanUps += 1;
        }
        // Like the real editor, the detach closure learns whether this is a
        // virtualized recycle or a genuine session end.
        detach?.(recycle);
        detach = undefined;
      },
      __postponeBgTokenizeToNextFrame() {},
      __syncRenderView() {},
    };
    editors.push(editor);
    return editor;
  };
  return { editors, createEditor };
}

function makeEditFileItem(
  id: string,
  edit = true,
  lineCount = 20
): CodeViewItem<undefined> {
  return {
    id,
    type: 'file',
    file: makeFile(`${id}.ts`, lineCount),
    version: 0,
    edit,
  };
}

function makeEditDiffItem(id: string, edit = true): CodeViewItem<undefined> {
  return {
    id,
    type: 'diff',
    fileDiff: parseDiffFromFile(
      { name: `${id}.txt`, contents: 'one\ntwo\nthree\n' },
      { name: `${id}.txt`, contents: 'one\ntwo changed\nthree\n' }
    ),
    version: 0,
    edit,
  };
}

// Applies an item update and flushes the render pass that performs editor
// attachment.
async function applyItemUpdate(
  viewer: CodeView,
  item: CodeViewItem<undefined>
): Promise<void> {
  expect(viewer.updateItem(item)).toBe(true);
  viewer.render(true);
  await wait(0);
}

describe('CodeView item edit mode', () => {
  test('attaches factory editors to edit-mode items on mount', async () => {
    const { cleanup } = installDom();
    const { editors, createEditor } = createEditorHarness();
    const viewer = new CodeView({ createEditor });
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [
        makeEditFileItem('a'),
        makeEditFileItem('b', false),
      ]);

      expect(editors.length).toBe(1);
      const renderedA = viewer
        .getRenderedItems()
        .find((item) => item.id === 'a');
      expect(editors[0].edits).toEqual([renderedA!.instance]);
      expect(viewer.getEditor('a')).toBe(editors[0]);
      expect(viewer.getEditor('b')).toBeUndefined();
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('supports multiple simultaneously edited items', async () => {
    const { cleanup } = installDom();
    const { editors, createEditor } = createEditorHarness();
    const viewer = new CodeView({ createEditor });
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [makeEditFileItem('a'), makeEditDiffItem('b')]);

      expect(editors.length).toBe(2);
      expect(viewer.getEditor('a')).toBeDefined();
      expect(viewer.getEditor('b')).toBeDefined();
      expect(viewer.getEditor('a')).not.toBe(viewer.getEditor('b')!);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('serves editor-required option values while an item is edited', async () => {
    const { cleanup } = installDom();
    const { createEditor } = createEditorHarness();
    const viewer = new CodeView({
      createEditor,
      enableLineSelection: true,
      enableGutterUtility: true,
      lineHoverHighlight: 'both',
      expandUnchanged: false,
      useTokenTransformer: false,
    });
    const editedFile = makeEditFileItem('a');
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [
        editedFile,
        makeEditDiffItem('b'),
        makeEditFileItem('c', false),
      ]);

      const [renderedA, renderedB, renderedC] = viewer.getRenderedItems();
      // Edited items read the values Editor.edit requires...
      for (const rendered of [renderedA, renderedB]) {
        expect(rendered.instance.options.useTokenTransformer).toBe(true);
        expect(rendered.instance.options.enableLineSelection).toBe(false);
        expect(rendered.instance.options.enableGutterUtility).toBe(false);
        expect(rendered.instance.options.lineHoverHighlight).toBe('disabled');
      }
      if (renderedB.type !== 'diff') {
        throw new Error('expected a rendered diff item');
      }
      // expandUnchanged is not edit-forced: collapsed unchanged regions stay
      // collapsed during editing, so the item serves the pass-through value.
      expect(renderedB.instance.options.expandUnchanged).toBe(false);
      // ...while non-edited siblings keep the parent options.
      expect(renderedC.instance.options.useTokenTransformer).toBe(false);
      expect(renderedC.instance.options.enableLineSelection).toBe(true);
      expect(renderedC.instance.options.enableGutterUtility).toBe(true);
      expect(renderedC.instance.options.lineHoverHighlight).toBe('both');

      // Toggling edit off restores the pass-through values.
      await applyItemUpdate(viewer, { ...editedFile, edit: false, version: 1 });
      const restoredA = viewer.getRenderedItems()[0];
      expect(restoredA.instance.options.useTokenTransformer).toBe(false);
      expect(restoredA.instance.options.enableLineSelection).toBe(true);
      expect(restoredA.instance.options.enableGutterUtility).toBe(true);
      expect(restoredA.instance.options.lineHoverHighlight).toBe('both');
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('toggling edit off discards the editor; re-toggling creates a fresh one', async () => {
    const { cleanup } = installDom();
    const { editors, createEditor } = createEditorHarness();
    const viewer = new CodeView({ createEditor });
    const item = makeEditFileItem('a');
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [item]);
      expect(editors.length).toBe(1);

      await applyItemUpdate(viewer, { ...item, edit: false, version: 1 });
      expect(editors[0].fullCleanUps).toBe(1);
      expect(viewer.getEditor('a')).toBeUndefined();

      await applyItemUpdate(viewer, { ...item, edit: true, version: 2 });
      expect(editors.length).toBe(2);
      expect(viewer.getEditor('a')).toBe(editors[1]);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('collapsed wins over edit', async () => {
    const { cleanup } = installDom();
    const { editors, createEditor } = createEditorHarness();
    const viewer = new CodeView({ createEditor });
    const item = makeEditFileItem('a');
    try {
      viewer.setup(createRoot());
      // A collapsed edit-mode item never attaches an editor.
      await renderItems(viewer, [{ ...item, collapsed: true }]);
      expect(editors.length).toBe(0);

      // Expanding it attaches; collapsing it again detaches and discards.
      await applyItemUpdate(viewer, { ...item, collapsed: false, version: 1 });
      expect(editors.length).toBe(1);
      expect(viewer.getEditor('a')).toBe(editors[0]);

      await applyItemUpdate(viewer, { ...item, collapsed: true, version: 2 });
      expect(editors[0].fullCleanUps).toBe(1);
      expect(viewer.getEditor('a')).toBeUndefined();
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('entering edit mode clears the item line selection', async () => {
    const { cleanup } = installDom();
    const { createEditor } = createEditorHarness();
    const viewer = new CodeView({
      createEditor,
      enableLineSelection: true,
      onLineSelectionChange() {},
    });
    const item = makeEditFileItem('a', false);
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [item]);

      viewer.setSelectedLines({ id: 'a', range: { start: 1, end: 2 } });
      expect(viewer.getSelectedLines()).not.toBeNull();
      const rendered = viewer.getRenderedItems()[0];
      expect(rendered.instance.options.onLineSelectionChange).toBeDefined();

      await applyItemUpdate(viewer, { ...item, edit: true, version: 1 });
      expect(viewer.getSelectedLines()).toBeNull();
      // Edited items also stop resolving selection callbacks.
      expect(rendered.instance.options.onLineSelectionChange).toBeUndefined();
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('removing an edited item cleans up its editor', async () => {
    const { cleanup } = installDom();
    const { editors, createEditor } = createEditorHarness();
    const viewer = new CodeView({ createEditor });
    const kept = makeEditFileItem('kept', false);
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [makeEditFileItem('a'), kept]);
      expect(editors.length).toBe(1);

      await renderItems(viewer, [kept]);
      expect(editors[0].fullCleanUps).toBeGreaterThanOrEqual(1);
      expect(viewer.getEditor('a')).toBeUndefined();
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('reuses the same editor across virtualization unmount and remount', async () => {
    const { cleanup } = installDom();
    const { editors, createEditor } = createEditorHarness();
    const viewer = new CodeView({ createEditor });
    const items: CodeViewItem<undefined>[] = [
      makeEditFileItem('edited', true, 30),
      ...Array.from({ length: 39 }, (_, index) =>
        makeEditFileItem(`file-${index}`, false, 30)
      ),
    ];
    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, items);
      expect(editors.length).toBe(1);
      const [editor] = editors;
      expect(editor.edits.length).toBe(1);

      // Scroll the edited item out of the render window: the instance recycles
      // and detaches the editor non-destructively.
      root.scrollTop = 20_000;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);
      expect(editor.recycleCleanUps).toBe(1);
      expect(editor.fullCleanUps).toBe(0);
      expect(viewer.getEditor('edited')).toBe(editor);

      // Scrolling back re-attaches the same editor to the same instance.
      root.scrollTop = 0;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);
      expect(editors.length).toBe(1);
      expect(editor.edits.length).toBe(2);
      expect(editor.edits[1]).toBe(editor.edits[0]);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('remounts an edited file whose document grew without crashing', async () => {
    const { cleanup } = installDom();
    const { createEditor } = createEditorHarness();
    const viewer = new CodeView({ createEditor });
    const items: CodeViewItem<undefined>[] = [
      makeEditFileItem('edited', true, 30),
      ...Array.from({ length: 39 }, (_, index) =>
        makeEditFileItem(`file-${index}`, false, 30)
      ),
    ];
    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, items);

      // Mimic an edit session that grew the document: the editor pushes the
      // larger document into the host, which patches its render caches and
      // remembers the document's line count.
      const edited = viewer.getRenderedItems()[0];
      const lineCount = 40;
      const documentText = Array.from(
        { length: lineCount },
        (_, i) => `edited ${i}`
      ).join('\n');
      edited.instance.applyDocumentChange({
        lineCount,
        getLineText: (lineNumber: number) => `edited ${lineNumber}`,
        getText: () => documentText,
      });

      // Scroll the edited item out (recycle) and back in. The recycle
      // persists the session document into the item's file (diff parity via
      // FileRenderer.syncEditedContentsToFile), so the remount renders the
      // grown 40-line contents instead of the pre-edit 30 lines — and no
      // longer throws "FileRenderer.processFileResult: Line doesnt exist"
      // from a retained document line count disagreeing with the render.
      root.scrollTop = 20_000;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);

      root.scrollTop = 0;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);

      const remounted = viewer.getRenderedItems()[0];
      expect(remounted.id).toBe('edited');
      // Render errors are caught and rendered as an error wrapper instead of
      // propagating, so assert on the rendered result: no error panel, and
      // the session's 40 lines rendered.
      const shadowRoot = remounted.element.shadowRoot;
      expect(shadowRoot?.querySelector('[data-error-wrapper]')).toBeNull();
      expect(shadowRoot?.querySelectorAll('[data-line]').length).toBe(
        lineCount
      );
      expect(items[0].type === 'file' && items[0].file.contents).toBe(
        documentText
      );
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('remounts an edited file with the session text after a recycle', async () => {
    const { cleanup } = installDom();
    const { createEditor } = createEditorHarness();
    const viewer = new CodeView({ createEditor });
    const items: CodeViewItem<undefined>[] = [
      makeEditFileItem('edited', true, 30),
      ...Array.from({ length: 39 }, (_, index) =>
        makeEditFileItem(`file-${index}`, false, 30)
      ),
    ];
    try {
      const root = createRoot();
      viewer.setup(root);
      await renderItems(viewer, items);

      // Mimic a same-line-count edit: the editor pushes the dirty line's
      // tokens into the host render caches, exactly like #applyChange does
      // after a keystroke.
      const edited = viewer.getRenderedItems()[0];
      const tokens: HighlightedToken[] = [[0, '', 'edited marker line']];
      edited.instance.updateRenderCache(new Map([[0, tokens]]), 'light', false);

      // Scroll the edited item out (recycle) and back in. The recycle joins
      // the session-synced line cache back into the item's file, so the
      // remount paints the edited text instead of the pre-edit contents.
      root.scrollTop = 20_000;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);

      root.scrollTop = 0;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);

      const remounted = viewer.getRenderedItems()[0];
      expect(remounted.id).toBe('edited');
      const shadowRoot = remounted.element.shadowRoot;
      expect(shadowRoot?.querySelector('[data-error-wrapper]')).toBeNull();
      expect(shadowRoot?.textContent).toContain('edited marker line');
      // The remaining lines are untouched and the item's file object now
      // carries the session text.
      const file = items[0].type === 'file' ? items[0].file : undefined;
      expect(file?.contents.startsWith('edited marker line\n')).toBe(true);
      expect(file?.contents).toContain('line 2');
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('entering edit mode keeps the collapsed layout height', async () => {
    const { cleanup } = installDom();
    const { createEditor } = createEditorHarness();
    const viewer = new CodeView({ createEditor });
    // A diff with a large unchanged region: collapsed regions stay collapsed
    // during editing, so entering edit mode must not change the layout.
    const oldContents = Array.from(
      { length: 60 },
      (_, index) => `line ${index}`
    ).join('\n');
    const newContents = oldContents.replace('line 30', 'line 30 changed');
    const item: CodeViewItem<undefined> = {
      id: 'd',
      type: 'diff',
      fileDiff: parseDiffFromFile(
        { name: 'd.txt', contents: oldContents },
        { name: 'd.txt', contents: newContents }
      ),
      version: 0,
      edit: false,
    };
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [item]);
      const collapsedHeight = viewer.getScrollHeight();

      await applyItemUpdate(viewer, { ...item, edit: true, version: 1 });
      expect(viewer.getScrollHeight()).toBe(collapsedHeight);

      await applyItemUpdate(viewer, { ...item, edit: false, version: 2 });
      expect(viewer.getScrollHeight()).toBe(collapsedHeight);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('user-space onItemEditComplete handler commits a finished session', async () => {
    const { cleanup } = installDom();
    // Committing is a user-space concern: CodeView never writes item data
    // itself, it only ends the editor session and reports the final contents.
    // This handler models the recommended app shape — one combined item write
    // carrying the new file (with a fresh cacheKey, since the contents
    // changed) and `edit: false`.
    const viewer: CodeView = new CodeView({
      createEditor: (options) => new Editor<undefined>({ ...options }),
      onItemEditComplete(item, file) {
        if (item.type !== 'file') {
          return;
        }
        const version = (item.version ?? 0) + 1;
        viewer.updateItem({
          ...item,
          file: {
            ...item.file,
            contents: file.contents,
            cacheKey: `${item.id}:v${version}`,
          },
          edit: false,
          version,
        });
      },
    });
    const item = makeEditFileItem('edited', true, 30);
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [item]);
      await wait(10);

      const editor = viewer.getEditor('edited') as Editor<undefined>;
      expect(editor).toBeDefined();
      // Insert ten lines at the top of the document.
      editor.applyEdits(
        [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText:
              Array.from({ length: 10 }, (_, i) => `inserted ${i}`).join('\n') +
              '\n',
          },
        ],
        true
      );
      await wait(10);

      // Turning edit off ends the session; the completion handler above
      // commits the final contents back into the item.
      await applyItemUpdate(viewer, { ...item, edit: false, version: 1 });
      expect(viewer.getEditor('edited')).toBeUndefined();
      const committed = viewer.getItem('edited');
      expect(committed?.type === 'file' && committed.file.contents).toContain(
        'inserted 0'
      );

      // The committed contents render in review mode, error-free.
      viewer.render(true);
      await wait(10);
      const rendered = viewer.getRenderedItems()[0];
      const shadowRoot = rendered.element.shadowRoot;
      expect(shadowRoot?.querySelector('[data-error-wrapper]')).toBeNull();
      expect(shadowRoot?.querySelectorAll('[data-line]').length).toBe(40);
      expect(shadowRoot?.textContent).toContain('inserted 0');
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('updateItemId keeps the editor and routes changes to the renamed item', async () => {
    const { cleanup } = installDom();
    const { editors, createEditor } = createEditorHarness();
    const changes: string[] = [];
    const viewer = new CodeView({
      createEditor,
      onItemEditChange(item) {
        changes.push(item.id);
      },
    });
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [makeEditFileItem('a')]);

      expect(viewer.updateItemId('a', 'a2')).toBe(true);
      expect(viewer.getEditor('a')).toBeUndefined();
      expect(viewer.getEditor('a2')).toBe(editors[0]);

      editors[0].emitChange(makeFile('a2.ts'));
      expect(changes).toEqual(['a2']);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('onItemEditChange receives the owning item and contents', async () => {
    const { cleanup } = installDom();
    const { editors, createEditor } = createEditorHarness();
    const changes: Array<[string, string]> = [];
    const viewer = new CodeView({
      createEditor,
      onItemEditChange(item, file) {
        changes.push([item.id, file.contents]);
      },
    });
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [makeEditFileItem('a')]);

      editors[0].emitChange({ name: 'a.ts', contents: 'edited' });
      expect(changes).toEqual([['a', 'edited']]);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  describe('edit-session hunks across virtualization', () => {
    // A diff item whose session state is observable: two separated changes
    // (lines 10 and 40 of 60) produce two hunks, and reverting one of them
    // mid-session leaves a context-only hunk that only the genuine-exit
    // recompute may collapse away.
    function makeSessionDiffItem(id: string): CodeViewItem<undefined> {
      const oldContents =
        Array.from({ length: 60 }, (_, index) => `line ${index}`).join('\n') +
        '\n';
      const newContents = oldContents
        .replace('line 10\n', 'line 10 changed\n')
        .replace('line 40\n', 'line 40 changed\n');
      return {
        id,
        type: 'diff',
        fileDiff: parseDiffFromFile(
          { name: `${id}.txt`, contents: oldContents, cacheKey: `${id}:old` },
          { name: `${id}.txt`, contents: newContents, cacheKey: `${id}:new` }
        ),
        version: 0,
        edit: true,
      };
    }

    function revertLineTen(item: CodeViewItem<undefined>, viewer: CodeView) {
      const rendered = viewer
        .getRenderedItems()
        .find((entry) => entry.id === item.id);
      expect(rendered).toBeDefined();
      const tokens: HighlightedToken[] = [[0, '', 'line 10']];
      rendered!.instance.updateRenderCache(
        new Map([[10, tokens]]),
        'light',
        false
      );
    }

    test('session-shaped hunks survive a recycle and remount', async () => {
      const { cleanup } = installDom();
      const { editors, createEditor } = createEditorHarness();
      const viewer = new CodeView({ createEditor });
      const edited = makeSessionDiffItem('edited');
      const items: CodeViewItem<undefined>[] = [
        edited,
        ...Array.from({ length: 39 }, (_, index) =>
          makeEditFileItem(`file-${index}`, false, 30)
        ),
      ];
      try {
        const root = createRoot();
        viewer.setup(root);
        await renderItems(viewer, items);
        await wait(10);

        // Revert one hunk mid-session: it persists as a context-only region.
        revertLineTen(edited, viewer);
        expect(edited.type === 'diff' && edited.fileDiff.hunks.length).toBe(2);
        expect(
          edited.type === 'diff' && edited.fileDiff.hunks[0].hunkContent[0].type
        ).toBe('context');
        expect(edited.type === 'diff' && edited.fileDiff.editSessionDirty).toBe(
          true
        );

        // Scroll out (recycle): no exit recompute may run.
        root.scrollTop = 30_000;
        dispatchScroll(root);
        viewer.render(true);
        await wait(0);
        expect(editors[0].recycleCleanUps).toBe(1);
        expect(edited.type === 'diff' && edited.fileDiff.hunks.length).toBe(2);
        expect(edited.type === 'diff' && edited.fileDiff.editSessionDirty).toBe(
          true
        );

        // Scroll back: the same editor re-attaches and the session-shaped
        // hunks are still in place.
        root.scrollTop = 0;
        dispatchScroll(root);
        viewer.render(true);
        await wait(0);
        expect(editors[0].edits.length).toBe(2);
        expect(edited.type === 'diff' && edited.fileDiff.hunks.length).toBe(2);
        expect(
          edited.type === 'diff' && edited.fileDiff.hunks[0].hunkContent[0].type
        ).toBe('context');
      } finally {
        viewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });

    test('ending a session reconciles the item layout height', async () => {
      const { cleanup } = installDom();
      const { createEditor } = createEditorHarness();
      const viewer = new CodeView({ createEditor });
      const edited = makeSessionDiffItem('edited');
      const below = makeEditFileItem('below', false, 10);
      try {
        viewer.setup(createRoot());
        await renderItems(viewer, [edited, below]);
        await wait(10);
        const heightDuring = viewer.getScrollHeight();

        // Reverting one hunk keeps it rendered as a context-only region, so
        // the mid-session layout height is unchanged.
        revertLineTen(edited, viewer);
        viewer.render(true);
        await wait(20);
        expect(viewer.getScrollHeight()).toBe(heightDuring);

        // Exit runs the recompute: the reverted region collapses away and
        // the layout must shrink with it — a stale estimated height here is
        // what made items overlap.
        expect(viewer.updateItem({ ...edited, edit: false, version: 1 })).toBe(
          true
        );
        viewer.render(true);
        await wait(30);
        expect(edited.type === 'diff' && edited.fileDiff.hunks.length).toBe(1);
        expect(viewer.getScrollHeight()).toBeLessThan(heightDuring);
      } finally {
        viewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });

    test('ending a session after its instance was released still recomputes', async () => {
      const { cleanup } = installDom();
      const { editors, createEditor } = createEditorHarness();
      const viewer = new CodeView({ createEditor });
      const edited = makeSessionDiffItem('edited');
      const items: CodeViewItem<undefined>[] = [
        edited,
        ...Array.from({ length: 39 }, (_, index) =>
          makeEditFileItem(`file-${index}`, false, 30)
        ),
      ];
      try {
        const root = createRoot();
        viewer.setup(root);
        await renderItems(viewer, items);
        await wait(10);

        revertLineTen(edited, viewer);
        expect(edited.type === 'diff' && edited.fileDiff.hunks.length).toBe(2);

        // Scroll the edited item out: its instance recycles and the detach
        // closure is consumed non-destructively.
        root.scrollTop = 30_000;
        dispatchScroll(root);
        viewer.render(true);
        await wait(0);
        expect(editors[0].recycleCleanUps).toBe(1);

        // Ending the session while released must still run the exit
        // recompute: the reverted, context-only region collapses away.
        expect(viewer.updateItem({ ...edited, edit: false, version: 1 })).toBe(
          true
        );
        viewer.render(true);
        await wait(0);
        expect(editors[0].fullCleanUps).toBeGreaterThanOrEqual(1);
        expect(edited.type === 'diff' && edited.fileDiff.hunks.length).toBe(1);
        expect(
          edited.type === 'diff' && edited.fileDiff.editSessionDirty
        ).toBeUndefined();

        // Scrolling back renders the recomputed diff without errors.
        root.scrollTop = 0;
        dispatchScroll(root);
        viewer.render(true);
        await wait(0);
        const remounted = viewer
          .getRenderedItems()
          .find((entry) => entry.id === 'edited');
        expect(
          remounted?.element.shadowRoot?.querySelector('[data-error-wrapper]')
        ).toBeNull();
      } finally {
        viewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });
  });

  describe('onItemEditComplete', () => {
    test('fires once with the final contents when edit is turned off', async () => {
      const { cleanup } = installDom();
      const { editors, createEditor } = createEditorHarness();
      const completions: Array<{
        item: CodeViewItem<undefined>;
        contents: string;
      }> = [];
      const viewer = new CodeView({
        createEditor,
        onItemEditComplete(item, file) {
          completions.push({ item, contents: file.contents });
        },
      });
      const item = makeEditFileItem('a');
      try {
        viewer.setup(createRoot());
        await renderItems(viewer, [item]);

        editors[0].emitChange({ name: 'a.ts', contents: 'draft' });
        editors[0].emitChange({ name: 'a.ts', contents: 'final' });
        expect(completions.length).toBe(0);

        await applyItemUpdate(viewer, { ...item, edit: false, version: 1 });
        expect(completions.length).toBe(1);
        expect(completions[0].contents).toBe('final');
        // The item handed to the callback is the one that ended the session.
        expect(completions[0].item.edit).toBe(false);
        expect(completions[0].item.version).toBe(1);
      } finally {
        viewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });

    test('fires with the last-change snapshot when the item is removed', async () => {
      const { cleanup } = installDom();
      const { editors, createEditor } = createEditorHarness();
      const completions: Array<{ id: string; contents: string }> = [];
      const viewer = new CodeView({
        createEditor,
        onItemEditComplete(item, file) {
          completions.push({ id: item.id, contents: file.contents });
        },
      });
      const kept = makeEditFileItem('kept', false);
      try {
        viewer.setup(createRoot());
        await renderItems(viewer, [makeEditFileItem('a'), kept]);

        editors[0].emitChange({ name: 'a.ts', contents: 'unsaved' });
        await renderItems(viewer, [kept]);

        expect(completions).toEqual([{ id: 'a', contents: 'unsaved' }]);
      } finally {
        viewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });

    test('does not fire for sessions without changes', async () => {
      const { cleanup } = installDom();
      const { createEditor } = createEditorHarness();
      let completions = 0;
      const viewer = new CodeView({
        createEditor,
        onItemEditComplete() {
          completions += 1;
        },
      });
      const item = makeEditFileItem('a');
      try {
        viewer.setup(createRoot());
        await renderItems(viewer, [item]);

        await applyItemUpdate(viewer, { ...item, edit: false, version: 1 });
        expect(completions).toBe(0);
      } finally {
        viewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });

    test('fires when a controlled empty list removes the edited item', async () => {
      const { cleanup } = installDom();
      const { editors, createEditor } = createEditorHarness();
      const completions: Array<{ id: string; contents: string }> = [];
      const viewer = new CodeView({
        createEditor,
        onItemEditComplete(item, file) {
          completions.push({ id: item.id, contents: file.contents });
        },
      });
      try {
        viewer.setup(createRoot());
        await renderItems(viewer, [makeEditFileItem('a')]);

        // setItems([]) is a removal like any other controlled update, so the
        // session completes with its last-change snapshot even though the
        // internal path is a full reset.
        editors[0].emitChange({ name: 'a.ts', contents: 'unsaved' });
        await renderItems(viewer, []);

        expect(completions).toEqual([{ id: 'a', contents: 'unsaved' }]);
        expect(editors[0].fullCleanUps).toBeGreaterThanOrEqual(1);
      } finally {
        viewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });

    test('does not fire on a direct cleanUp teardown', async () => {
      const { cleanup } = installDom();
      const { editors, createEditor } = createEditorHarness();
      let completions = 0;
      const viewer = new CodeView({
        createEditor,
        onItemEditComplete() {
          completions += 1;
        },
      });
      try {
        viewer.setup(createRoot());
        await renderItems(viewer, [makeEditFileItem('a')]);

        editors[0].emitChange({ name: 'a.ts', contents: 'unsaved' });
        viewer.cleanUp();
        await wait(0);

        expect(completions).toBe(0);
        expect(editors[0].fullCleanUps).toBeGreaterThanOrEqual(1);
      } finally {
        viewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });

    test('does not fire on a direct reset', async () => {
      const { cleanup } = installDom();
      const { editors, createEditor } = createEditorHarness();
      let completions = 0;
      const viewer = new CodeView({
        createEditor,
        onItemEditComplete() {
          completions += 1;
        },
      });
      try {
        viewer.setup(createRoot());
        await renderItems(viewer, [makeEditFileItem('a')]);

        editors[0].emitChange({ name: 'a.ts', contents: 'unsaved' });
        viewer.reset();
        await wait(0);

        expect(completions).toBe(0);
        expect(editors[0].fullCleanUps).toBeGreaterThanOrEqual(1);
      } finally {
        viewer.cleanUp();
        await wait(0);
        cleanup();
      }
    });
  });
});
