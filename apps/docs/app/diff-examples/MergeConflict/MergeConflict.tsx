'use client';

import { MergeConflictDiff } from '@pierre/diffs/react';
import type { PreloadMergeConflictDiffResult } from '@pierre/diffs/ssr';
import { IconColorDark, IconColorLight } from '@pierre/icons';
import { useMemo, useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

interface MergeConflictProps {
  prerenderedFile: PreloadMergeConflictDiffResult<undefined>;
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
            Render conflicts through a dedicated diff primitive that treats
            current and incoming sections as structured additions/deletions
            without running text diffing. Resolve by choosing current, incoming,
            or both changes and preview the updated file instantly.
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

      <MergeConflictDiff
        key={instanceKey}
        file={prerenderedFile.file}
        options={options}
        prerenderedHTML={prerenderedFile.prerenderedHTML}
        className={`overflow-hidden rounded-lg border ${themeType === 'light' ? 'border-neutral-200' : 'border-neutral-800'}`}
      />
    </div>
  );
}
