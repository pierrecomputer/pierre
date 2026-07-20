'use client';

import type { EditorOptions } from '@pierre/diffs/editor';
import { File } from '@pierre/diffs/react';
import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useMemo } from 'react';

import { MARKER_DEMO_MARKERS } from './constants';

interface MarkerDemoProps {
  // Server-preloaded, highlighted File; hydrating from it avoids a highlight flash on load.
  prerenderedFile: PreloadedFileResult<undefined>;
}

// Demo of the editor's lint markers, applied imperatively via `editor.setMarkers`
// (the same call a real linter integration would make) and shown by default.
export function MarkerDemo({ prerenderedFile }: MarkerDemoProps) {
  const editOptions = useMemo<EditorOptions<undefined>>(
    () => ({
      onAttach(editor) {
        editor.setMarkers(MARKER_DEMO_MARKERS);
      },
    }),
    []
  );

  return (
    <div className="not-prose">
      <File
        {...prerenderedFile}
        className="diff-container"
        edit
        editOptions={editOptions}
      />
    </div>
  );
}
