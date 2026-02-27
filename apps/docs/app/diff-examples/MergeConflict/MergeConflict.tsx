'use client';

import {
  type MergeConflictActionPayload,
  resolveMergeConflict,
} from '@pierre/diffs';
import { File } from '@pierre/diffs/react';
import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useCallback, useMemo, useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';
import { Button } from '@/components/ui/button';

interface MergeConflictProps {
  prerenderedFile: PreloadedFileResult<undefined>;
}

export function MergeConflict({ prerenderedFile }: MergeConflictProps) {
  const initialContents = prerenderedFile.file.contents;
  const [contents, setContents] = useState(initialContents);

  const file = useMemo(
    () => ({ ...prerenderedFile.file, contents }),
    [prerenderedFile.file, contents]
  );
  const prerenderedHTML =
    contents === initialContents ? prerenderedFile.prerenderedHTML : undefined;

  const onMergeConflictAction = useCallback(
    (payload: MergeConflictActionPayload) => {
      setContents((previous) => resolveMergeConflict(previous, payload));
    },
    []
  );
  const options = useMemo(
    () => ({ ...prerenderedFile.options, onMergeConflictAction }),
    [prerenderedFile.options, onMergeConflictAction]
  );

  function reset() {
    setContents(initialContents);
  }

  return (
    <div className="scroll-mt-[20px] space-y-5" id="merge-conflict-resolution">
      <FeatureHeader
        title="Merge conflict resolution UI"
        description={
          <>
            VS Code-style merge actions are rendered inline for each conflict
            block. Resolve by choosing current, incoming, or both changes and
            preview the updated file instantly.
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={reset}
          disabled={contents === initialContents}
        >
          Reset
        </Button>
      </div>

      <File
        file={file}
        options={options}
        prerenderedHTML={prerenderedHTML}
        className="diff-container"
      />
    </div>
  );
}
