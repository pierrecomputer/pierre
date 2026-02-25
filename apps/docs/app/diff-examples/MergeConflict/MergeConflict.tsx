'use client';

import {
  getMergeConflictRegions,
  type MergeConflictActionPayload,
  resolveMergeConflict,
} from '@pierre/diffs';
import { File } from '@pierre/diffs/react';
import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import {
  IconCheckCheck,
  IconCiWarningFill,
  IconColorDark,
  IconColorLight,
} from '@pierre/icons';
import { useCallback, useMemo, useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

interface MergeConflictProps {
  prerenderedFile: PreloadedFileResult<undefined>;
}

export function MergeConflict({ prerenderedFile }: MergeConflictProps) {
  const initialContents = prerenderedFile.file.contents;
  const [contents, setContents] = useState(initialContents);
  const [themeType, setThemeType] = useState<'light' | 'dark'>('dark');

  const file = useMemo(
    () => ({ ...prerenderedFile.file, contents }),
    [prerenderedFile.file, contents]
  );
  const conflictRegions = useMemo(
    () => getMergeConflictRegions(contents.split(/(?<=\n)/)),
    [contents]
  );
  const hasConflict = conflictRegions.length > 0;
  const prerenderedHTML =
    contents === initialContents ? prerenderedFile.prerenderedHTML : undefined;

  const onMergeConflictAction = useCallback(
    (payload: MergeConflictActionPayload) => {
      setContents((previous) => resolveMergeConflict(previous, payload));
    },
    []
  );
  const options = useMemo(
    () => ({
      ...prerenderedFile.options,
      onMergeConflictAction,
      themeType,
      theme: { light: 'pierre-light' as const, dark: 'pierre-dark' as const },
    }),
    [prerenderedFile.options, onMergeConflictAction, themeType]
  );

  function reset() {
    setContents(initialContents);
  }

  return (
    <div className="scroll-mt-20 space-y-5" id="merge-conflicts">
      <FeatureHeader
        title="Merge conflict resolution UI"
        description={
          <>
            Render inline merge actions for each conflict block much like VS
            Code. Resolve by choosing current, incoming, or both changes and
            preview the updated file instantly.
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="bg-secondary inline-flex items-center self-start rounded-lg">
          <div className="text-muted-foreground inline-flex items-center gap-1.5 px-3 text-sm">
            {hasConflict ? <IconCiWarningFill /> : <IconCheckCheck />}
            {hasConflict
              ? `${conflictRegions.length} unresolved conflict${conflictRegions.length === 1 ? '' : 's'}`
              : 'No conflicts detected'}
          </div>
          <Button
            variant="outline"
            onClick={reset}
            disabled={contents === initialContents}
          >
            Reset
          </Button>
        </div>
        <ButtonGroup
          value={themeType}
          onValueChange={(value) => setThemeType(value as 'light' | 'dark')}
        >
          <ButtonGroupItem value="light">
            <IconColorLight />
            Light
          </ButtonGroupItem>
          <ButtonGroupItem value="dark">
            <IconColorDark />
            Dark
          </ButtonGroupItem>
        </ButtonGroup>
      </div>

      <File
        file={file}
        options={options}
        prerenderedHTML={prerenderedHTML}
        className={`overflow-hidden rounded-lg border ${themeType === 'light' ? 'border-neutral-200' : 'border-neutral-800'}`}
      />
    </div>
  );
}
