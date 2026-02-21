'use client';

import { IconSymbolDiffstat } from '@pierre/icons';
import type { GitStatusEntry } from '@pierre/trees';
import { FileTree } from '@pierre/trees/react';
import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import {
  baseTreeOptions,
  DEFAULT_FILE_TREE_PANEL_CLASS,
  DEFAULT_FILE_TREE_PANEL_STYLE,
} from './demo-data';
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

const pathColorsStyle = {
  ...DEFAULT_FILE_TREE_PANEL_STYLE,
  '--ft-search-background': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;

export function GitStatusSection() {
  const [enabled, setEnabled] = useState(true);
  const [useSetB, setUseSetB] = useState(false);

  const gitStatus = useMemo(
    () => (enabled ? (useSetB ? GIT_STATUSES_B : GIT_STATUSES_A) : undefined),
    [enabled, useSetB]
  );

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
        <div className="flex items-center gap-4">
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
        </div>

        <FileTree
          className={DEFAULT_FILE_TREE_PANEL_CLASS}
          options={{
            ...baseTreeOptions,
            id: 'path-colors-git-status-demo',
          }}
          initialExpandedItems={['src', 'src/components']}
          gitStatus={gitStatus}
          style={pathColorsStyle}
        />
      </div>
    </TreeExampleSection>
  );
}
