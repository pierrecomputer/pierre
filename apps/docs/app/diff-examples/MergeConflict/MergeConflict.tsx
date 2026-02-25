'use client';

import { File, type LineAnnotation } from '@pierre/diffs/react';
import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useCallback, useMemo, useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';
import type { MergeConflictAnnotation } from './constants';
import { Button } from '@/components/ui/button';

interface MergeConflictProps {
  prerenderedFile: PreloadedFileResult<MergeConflictAnnotation>;
}

type ResolutionMode = 'current' | 'incoming' | 'both';

const START_MARKER = /^<{7,}(?:\s.*)?$/;
const BASE_MARKER = /^\|{7,}(?:\s.*)?$/;
const SEPARATOR_MARKER = /^={7,}(?:\s.*)?$/;
const END_MARKER = /^>{7,}(?:\s.*)?$/;

interface ConflictRegion {
  startIndex: number;
  baseMarkerIndex?: number;
  separatorIndex: number;
  endIndex: number;
}

export function MergeConflict({ prerenderedFile }: MergeConflictProps) {
  const initialContents = prerenderedFile.file.contents;
  const [contents, setContents] = useState(initialContents);
  const lines = useMemo(() => contents.split('\n'), [contents]);
  const conflictRegions = useMemo(() => findConflictRegions(lines), [lines]);
  const hasConflict = conflictRegions.length > 0;
  const lineAnnotations = useMemo(
    () => createConflictAnnotations(conflictRegions),
    [conflictRegions]
  );

  const file = useMemo(
    () => ({ ...prerenderedFile.file, contents }),
    [prerenderedFile.file, contents]
  );
  const prerenderedHTML =
    contents === initialContents ? prerenderedFile.prerenderedHTML : undefined;

  const resolveConflict = useCallback(
    (regionIndex: number, mode: ResolutionMode) => {
      setContents((previous) =>
        applyConflictResolution(previous, regionIndex, mode)
      );
    },
    []
  );

  function reset() {
    setContents(initialContents);
  }

  const renderAnnotation = useCallback(
    (annotation: LineAnnotation<MergeConflictAnnotation>) => {
      const metadata = annotation.metadata;
      return (
        <div className="px-2 font-mono text-xs text-[#fff]">
          <button
            className={MERGE_ACTION_LINK_CLASS}
            onClick={() => resolveConflict(metadata.regionIndex, 'current')}
          >
            Accept current change
          </button>
          <span className="text-[#6a6a6a]"> | </span>
          <button
            className={MERGE_ACTION_LINK_CLASS}
            onClick={() => resolveConflict(metadata.regionIndex, 'incoming')}
          >
            Accept incoming change
          </button>
          <span className="text-[#6a6a6a]"> | </span>
          <button
            className={MERGE_ACTION_LINK_CLASS}
            onClick={() => resolveConflict(metadata.regionIndex, 'both')}
          >
            Accept both
          </button>
        </div>
      );
    },
    [resolveConflict]
  );

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
        <p className="text-muted-foreground ml-1 text-sm">
          {hasConflict
            ? `${conflictRegions.length} unresolved conflict${conflictRegions.length === 1 ? '' : 's'}.`
            : 'No conflicts detected.'}
        </p>
      </div>

      <File
        file={file}
        options={prerenderedFile.options}
        prerenderedHTML={prerenderedHTML}
        lineAnnotations={lineAnnotations}
        renderAnnotation={renderAnnotation}
        className="diff-container"
      />
    </div>
  );
}

const MERGE_ACTION_LINK_CLASS =
  'cursor-pointer py-1 text-[#fff] transition-colors hover:text-[#9bd0ff]';

function applyConflictResolution(
  contents: string,
  regionIndex: number,
  mode: ResolutionMode
): string {
  const lines = contents.split('\n');
  const region = findConflictRegions(lines)[regionIndex];
  if (region == null) {
    return contents;
  }

  const currentEnd = region.baseMarkerIndex ?? region.separatorIndex;
  const currentLines = lines.slice(region.startIndex + 1, currentEnd);
  const incomingLines = lines.slice(region.separatorIndex + 1, region.endIndex);

  const mergedLines =
    mode === 'current'
      ? currentLines
      : mode === 'incoming'
        ? incomingLines
        : [...currentLines, ...incomingLines];

  return [
    ...lines.slice(0, region.startIndex),
    ...mergedLines,
    ...lines.slice(region.endIndex + 1),
  ].join('\n');
}

function createConflictAnnotations(
  regions: ConflictRegion[]
): LineAnnotation<MergeConflictAnnotation>[] {
  const annotations: LineAnnotation<MergeConflictAnnotation>[] = [];
  const totalConflicts = regions.length;

  for (const [regionIndex, region] of regions.entries()) {
    annotations.push({
      lineNumber: Math.max(1, region.startIndex),
      metadata: {
        type: 'actions',
        regionIndex,
        conflictNumber: regionIndex + 1,
        totalConflicts,
      },
    });
  }

  return annotations;
}

function findConflictRegions(lines: string[]): ConflictRegion[] {
  const regions: ConflictRegion[] = [];
  let startIndex = -1;
  let baseMarkerIndex: number | undefined;
  let separatorIndex = -1;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    if (startIndex < 0) {
      if (START_MARKER.test(line)) {
        startIndex = index;
      }
      continue;
    }

    if (
      separatorIndex < 0 &&
      baseMarkerIndex == null &&
      BASE_MARKER.test(line)
    ) {
      baseMarkerIndex = index;
      continue;
    }

    if (separatorIndex < 0 && SEPARATOR_MARKER.test(line)) {
      separatorIndex = index;
      continue;
    }

    if (separatorIndex >= 0 && END_MARKER.test(line)) {
      regions.push({
        startIndex,
        baseMarkerIndex,
        separatorIndex,
        endIndex: index,
      });
      startIndex = -1;
      baseMarkerIndex = undefined;
      separatorIndex = -1;
    }
  }

  return regions;
}
