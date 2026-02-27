'use client';

import { File } from '@pierre/diffs/react';
import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { IconColorDark, IconColorLight } from '@pierre/icons';
import { useMemo, useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

interface MergeConflictProps {
  prerenderedFile: PreloadedFileResult<undefined>;
}

export function MergeConflict({ prerenderedFile }: MergeConflictProps) {
  const [instanceKey, setInstanceKey] = useState(0);
  const [themeType, setThemeType] = useState<'light' | 'dark'>('dark');

  const options = useMemo(
    () => ({
      ...prerenderedFile.options,
      themeType,
      theme: { light: 'pierre-light' as const, dark: 'pierre-dark' as const },
    }),
    [prerenderedFile.options, themeType]
  );

  return (
    <div className="scroll-mt-20 space-y-5" id="merge-conflicts">
      <FeatureHeader
        title="Merge conflict resolution UI"
        description={
          <>
            Render inline merge actions for each conflict block much like VS
            Code. Resolve by choosing current, incoming, or both changes and
            preview the updated file instantly using default behavior.
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" onClick={() => setInstanceKey((v) => v + 1)}>
          Reset
        </Button>
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
        key={instanceKey}
        file={prerenderedFile.file}
        options={options}
        prerenderedHTML={prerenderedFile.prerenderedHTML}
        className={`overflow-hidden rounded-lg border ${themeType === 'light' ? 'border-neutral-200' : 'border-neutral-800'}`}
      />
    </div>
  );
}
