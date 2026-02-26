'use client';

import {
  IconColorDark,
  IconColorLight,
  IconSymbolDiffstat,
} from '@pierre/icons';
import type { GitStatusEntry } from '@pierre/trees';
import { FileTree } from '@pierre/trees/react';
import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { baseTreeOptions } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { Switch } from '@/components/ui/switch';

const GIT_STATUSES_A: GitStatusEntry[] = [
  { path: 'src/index.ts', status: 'modified' },
  { path: 'src/components/Button.tsx', status: 'added' },
  { path: '.gitignore', status: 'deleted' },
];

const GIT_STATUSES_B: GitStatusEntry[] = [
  { path: 'README.md', status: 'modified' },
  { path: 'src/lib/utils.ts', status: 'modified' },
  { path: 'src/utils/worker.ts', status: 'added' },
];

export function GitStatusSection() {
  const [enabled, setEnabled] = useState(true);
  const [useSetB, setUseSetB] = useState(false);
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('dark');

  const isDark = colorMode === 'dark';

  const gitStatus = useMemo(
    () => (enabled ? (useSetB ? GIT_STATUSES_B : GIT_STATUSES_A) : undefined),
    [enabled, useSetB]
  );

  const panelClassName = isDark
    ? 'min-h-0 flex-1 overflow-auto rounded-lg bg-neutral-900 p-2'
    : 'min-h-0 flex-1 overflow-auto rounded-lg border border-neutral-200 bg-neutral-50 p-2';

  const panelStyle = {
    colorScheme: colorMode,
    '--ft-search-background': isDark ? 'oklch(14.5% 0 0)' : '#fff',
  } as CSSProperties;

  return (
    <TreeExampleSection id="path-colors">
      <FeatureHeader
        title="Show Git status on files"
        description={
          <>
            Use the <code>gitStatus</code> prop to show indicators on files for
            added, modified, and deleted files. Folders that contain changes get
            their own styling as a hint of nested changes. Toggle between two
            datasets to simulate status updates from your VCS.
          </>
        }
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="gridstack">
            <Button
              variant="outline"
              className="w-full justify-between gap-3 pr-11 pl-3 md:w-auto"
              onClick={() => setEnabled((prev) => !prev)}
            >
              <div className="flex items-center gap-2">
                <IconSymbolDiffstat />
                Show Git status
              </div>
            </Button>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              onClick={(e) => e.stopPropagation()}
              className="pointer-events-none mr-3 place-self-center justify-self-end"
            />
          </div>
          <ButtonGroup
            value={useSetB ? 'set-b' : 'set-a'}
            onValueChange={(value) => setUseSetB(value === 'set-b')}
          >
            <ButtonGroupItem value="set-a">Changeset A</ButtonGroupItem>
            <ButtonGroupItem value="set-b">Changeset B</ButtonGroupItem>
          </ButtonGroup>
          <ButtonGroup
            value={colorMode}
            onValueChange={(value) => setColorMode(value as 'light' | 'dark')}
            className="md:ml-auto"
          >
            <ButtonGroupItem value="light">
              <IconColorLight className="size-4" />
              Light
            </ButtonGroupItem>
            <ButtonGroupItem value="dark">
              <IconColorDark className="size-4" />
              Dark
            </ButtonGroupItem>
          </ButtonGroup>
        </div>

        <div className={isDark ? 'dark' : ''}>
          <FileTree
            className={panelClassName}
            options={{
              ...baseTreeOptions,
              id: 'path-colors-git-status-demo',
            }}
            initialExpandedItems={['src', 'src/components']}
            gitStatus={gitStatus}
            style={panelStyle}
          />
        </div>
      </div>
    </TreeExampleSection>
  );
}
