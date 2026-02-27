'use client';

import {
  File,
  type MergeConflictActionPayload,
  type MergeConflictRegion,
} from '@pierre/diffs/react';
import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useCallback, useMemo, useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';
import { Button } from '@/components/ui/button';

interface MergeConflictProps {
  prerenderedFile: PreloadedFileResult<undefined>;
}

type ResolutionMode = 'current' | 'incoming' | 'both';

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
    ({ conflict, resolution }: MergeConflictActionPayload) => {
      setContents((previous) =>
        applyConflictResolution(previous, conflict, resolution)
      );
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

function applyConflictResolution(
  contents: string,
  conflict: MergeConflictRegion,
  mode: ResolutionMode
): string {
  const lines = contents.split('\n');
  if (
    conflict.startLineIndex < 0 ||
    conflict.separatorLineIndex <= conflict.startLineIndex ||
    conflict.endLineIndex <= conflict.separatorLineIndex ||
    conflict.endLineIndex >= lines.length
  ) {
    return contents;
  }

  const currentEnd =
    conflict.baseMarkerLineIndex ?? conflict.separatorLineIndex;
  const currentLines = lines.slice(conflict.startLineIndex + 1, currentEnd);
  const incomingLines = lines.slice(
    conflict.separatorLineIndex + 1,
    conflict.endLineIndex
  );

  const mergedLines =
    mode === 'current'
      ? currentLines
      : mode === 'incoming'
        ? incomingLines
        : [...currentLines, ...incomingLines];

  return [
    ...lines.slice(0, conflict.startLineIndex),
    ...mergedLines,
    ...lines.slice(conflict.endLineIndex + 1),
  ].join('\n');
}
