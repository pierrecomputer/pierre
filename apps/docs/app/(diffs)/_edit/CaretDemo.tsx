'use client';

import type { EditorOptions } from '@pierre/diffs/edit';
import { File } from '@pierre/diffs/react';
import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useMemo } from 'react';

import { CARET_DEMO_CARETS, type CursorCaretMetadata } from './constants';

interface CaretDemoProps {
  // Server-preloaded, highlighted File; hydrating from it avoids a highlight flash on load.
  prerenderedFile: PreloadedFileResult<undefined>;
}

// Carets render inside the editor's shadow DOM, so the collaborator
// cursors use inline styles rather than page-level Tailwind classes.
export function CaretDemo({ prerenderedFile }: CaretDemoProps) {
  const editorOptions = useMemo<EditorOptions<undefined, CursorCaretMetadata>>(
    () => ({
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
        editor.setCarets(CARET_DEMO_CARETS);
      },
    }),
    []
  );

  return (
    <div className="not-prose">
      <File<undefined, CursorCaretMetadata>
        {...prerenderedFile}
        className="diff-container"
        edit
        editorOptions={editorOptions}
      />
    </div>
  );
}
