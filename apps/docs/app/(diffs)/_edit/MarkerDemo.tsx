'use client';

import { Edit } from '@pierre/diffs/edit';
import { EditProvider, File } from '@pierre/diffs/react';
import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useEffect, useMemo } from 'react';

import { MARKER_DEMO_MARKERS } from './constants';

interface MarkerDemoProps {
  // Server-preloaded, highlighted File; hydrating from it avoids a highlight flash on load.
  prerenderedFile: PreloadedFileResult<undefined>;
}

// Demo of edit mode's lint markers, applied imperatively via `edit.setMarkers`
// (the same call a real linter integration would make) and shown by default.
export function MarkerDemo({ prerenderedFile }: MarkerDemoProps) {
  const edit = useMemo(() => new Edit({}), []);

  // `setMarkers` throws until edit mode attaches to its surface (async), so
  // retry each frame until the call sticks.
  useEffect(() => {
    let frame = 0;
    const apply = () => {
      try {
        edit.setMarkers(MARKER_DEMO_MARKERS);
      } catch {
        frame = requestAnimationFrame(apply);
      }
    };
    apply();
    return () => cancelAnimationFrame(frame);
  }, [edit]);

  return (
    <div className="not-prose">
      <EditProvider edit={edit}>
        <File {...prerenderedFile} className="diff-container" contentEditable />
      </EditProvider>
    </div>
  );
}
