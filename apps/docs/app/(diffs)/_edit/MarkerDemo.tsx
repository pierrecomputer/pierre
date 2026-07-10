'use client';

import { Editor } from '@pierre/diffs/editor';
import { EditProvider, File } from '@pierre/diffs/react';
import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useEffect, useMemo } from 'react';

import { MARKER_DEMO_MARKERS } from './constants';

interface MarkerDemoProps {
  // Server-preloaded, highlighted File; hydrating from it avoids a highlight flash on load.
  prerenderedFile: PreloadedFileResult<undefined>;
}

// Demo of the editor's lint markers, applied imperatively via `editor.setMarkers`
// (the same call a real linter integration would make) and shown by default.
export function MarkerDemo({ prerenderedFile }: MarkerDemoProps) {
  const editor = useMemo(() => new Editor({}), []);

  // `setMarkers` throws until the editor attaches to its surface (async), so
  // retry each frame until the call sticks.
  useEffect(() => {
    let frame = 0;
    const apply = () => {
      try {
        editor.setMarkers(MARKER_DEMO_MARKERS);
      } catch {
        frame = requestAnimationFrame(apply);
      }
    };
    apply();
    return () => cancelAnimationFrame(frame);
  }, [editor]);

  return (
    <div className="not-prose">
      <EditProvider editor={editor}>
        <File {...prerenderedFile} className="diff-container" contentEditable />
      </EditProvider>
    </div>
  );
}
