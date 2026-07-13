'use client';

import { Edit } from '@pierre/diffs/edit';
import { EditProvider, File } from '@pierre/diffs/react';
import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useMemo, useState } from 'react';

interface EditDemoProps {
  // Server-preloaded, already-highlighted file. Spreading it into <File> ships
  // the highlighted surface in the initial SSR HTML and hydrates from it, so
  // the demo paints instantly instead of flashing in after the client attaches
  // the edit.
  prerenderedFile: PreloadedFileResult<undefined>;
}

export function EditDemo({ prerenderedFile }: EditDemoProps) {
  const [changeCount, setChangeCount] = useState(0);

  const edit = useMemo(
    () =>
      new Edit({
        onChange() {
          setChangeCount((count) => count + 1);
        },
      }),
    []
  );

  return (
    <div className="not-prose bg-card overflow-hidden rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h5 className="text-sm font-medium">Edit mode demo</h5>
          <p className="text-muted-foreground text-xs">
            Click into the code and type to try edit mode.
          </p>
        </div>
        <div className="text-muted-foreground text-xs">
          Changes: {changeCount}
        </div>
      </div>
      <EditProvider edit={edit}>
        <File
          {...prerenderedFile}
          className="max-h-[480px] overflow-auto rounded-none border-0"
          contentEditable
        />
      </EditProvider>
    </div>
  );
}
