'use client';

import { UnresolvedFile } from '@pierre/diffs/react';
import type { PreloadUnresolvedFileResult } from '@pierre/diffs/ssr';
import { IconColorDark, IconColorLight, IconRefresh } from '@pierre/icons';
import { useMemo, useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

interface MergeConflictProps {
  prerenderedFile: PreloadUnresolvedFileResult<undefined>;
}

export function MergeConflict({ prerenderedFile }: MergeConflictProps) {
  const [instanceKey, setInstanceKey] = useState(0);
  const [hasResolved, setHasResolved] = useState(false);
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
    <div className="scroll-mt-20 space-y-5" id="conflicts">
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
        <Button
          variant="outline"
          disabled={!hasResolved}
          onClick={() => {
            setInstanceKey((v) => v + 1);
            setHasResolved(false);
          }}
        >
          <IconRefresh />
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

      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        onClickCapture={(e) => {
          if (hasResolved) return;
          for (const el of e.nativeEvent.composedPath()) {
            if (
              el instanceof HTMLElement &&
              el.hasAttribute('data-merge-conflict-action')
            ) {
              setHasResolved(true);
              break;
            }
          }
        }}
      >
        <UnresolvedFile
          key={instanceKey}
          file={prerenderedFile.file}
          options={options}
          prerenderedHTML={prerenderedFile.prerenderedHTML}
          className={`overflow-hidden rounded-lg border ${themeType === 'light' ? 'border-neutral-200' : 'border-neutral-800'}`}
          // NOTE(amadeus): Test code, I need to better solve the whole server/vanilla/custom js thing with react
          // renderMergeConflictUtility={(action, getInstance) => {
          //   return (
          //     <>
          //       <button
          //         className="cursor-pointer opacity-90 hover:opacity-100"
          //         onClick={() => {
          //           console.log('Clicked', action, getInstance());
          //         }}
          //       >
          //         Resolve with AI
          //       </button>
          //     </>
          //   );
          // }}
        />
      </div>
    </div>
  );
}
