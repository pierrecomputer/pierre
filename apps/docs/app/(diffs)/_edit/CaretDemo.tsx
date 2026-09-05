'use client';

import type { Editor, EditorOptions } from '@pierre/diffs/edit';
import { File } from '@pierre/diffs/react';
import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useEffect, useMemo, useRef } from 'react';

import { CARET_DEMO_CARETS, type CursorCaretMetadata } from './constants';

interface CaretDemoProps {
  // Server-preloaded, highlighted File; hydrating from it avoids a highlight flash on load.
  prerenderedFile: PreloadedFileResult<undefined, CursorCaretMetadata>;
}

// Carets render inside the editor's shadow DOM, so the collaborator
// cursors use inline styles rather than page-level Tailwind classes.
export function CaretDemo({ prerenderedFile }: CaretDemoProps) {
  const editors = useRef<
    (Editor<'file', undefined, CursorCaretMetadata> | undefined)[]
  >([]);
  const activeEditor = useRef<number | undefined>(undefined);
  const syncingEdit = useRef(false);
  const editorOptions = useMemo<
    EditorOptions<'file', undefined, CursorCaretMetadata>[]
  >(
    () =>
      CARET_DEMO_CARETS.map((_, index) => ({
        renderCaret({ metadata }) {
          const cursor = document.createElement('span');
          cursor.ariaLabel = `${metadata.name}'s cursor`;
          cursor.style.cssText = `position:relative;display:block;width:2px;height:1lh;background-color:${metadata.color};pointer-events:none;`;

          const label = document.createElement('span');
          label.ariaHidden = 'true';
          label.textContent = metadata.name;
          label.style.cssText = `position:absolute;bottom:100%;left:0;padding:1px 5px;border-radius:4px 4px 4px 0;background-color:${metadata.color};color:#fff;font:500 11px/16px system-ui,sans-serif;white-space:nowrap;`;

          cursor.append(label);
          return cursor;
        },
        onAttach(editor) {
          editors.current[index] = editor;
          editor.setCarets([CARET_DEMO_CARETS[index === 0 ? 1 : 0]]);
        },
        onFocus() {
          activeEditor.current = index;
        },
        onChange({ changes }) {
          if (syncingEdit.current) return;

          const peer = editors.current[index === 0 ? 1 : 0];
          if (peer === undefined) return;

          syncingEdit.current = true;
          try {
            peer.applyEdits(
              changes.map(({ range, text }) => ({ range, newText: text })),
              false
            );
          } finally {
            syncingEdit.current = false;
          }
        },
      })),
    []
  );

  useEffect(() => {
    const handleSelectionChange = () => {
      const index = activeEditor.current;
      if (index === undefined) return;

      const selection = editors.current[index]
        ?.getViewState()
        .selections?.at(-1);
      const peer = editors.current[index === 0 ? 1 : 0];
      if (selection === undefined || peer === undefined) return;

      const backwards = selection.direction === -1;
      peer.setCarets([
        {
          anchor: backwards ? selection.end : selection.start,
          focus: backwards ? selection.start : selection.end,
          metadata: CARET_DEMO_CARETS[index].metadata,
        },
      ]);
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () =>
      document.removeEventListener('selectionchange', handleSelectionChange);
  }, []);

  return (
    <div className="not-prose grid gap-4 md:grid-cols-2">
      {CARET_DEMO_CARETS.map(({ metadata }, index) => (
        <div
          key={metadata.name}
          className="min-w-0"
          role="group"
          aria-label={`${metadata.name}'s editor`}
        >
          <File<undefined, CursorCaretMetadata>
            {...prerenderedFile}
            className="diff-container"
            edit
            editorOptions={editorOptions[index]}
            renderHeaderMetadata={() => (
              <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: metadata.color }}
                />
                Editing as {metadata.name}
              </div>
            )}
          />
        </div>
      ))}
    </div>
  );
}
