'use client';

import {
  IconColorDark,
  IconColorLight,
  IconSymbolDiffstat,
} from '@pierre/icons';
import { FileTree } from '@pierre/trees/react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import {
  baseTreeOptions,
  DEFAULT_FILE_TREE_PANEL_CLASS,
  GIT_STATUSES_A,
  GIT_STATUSES_B,
} from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { Switch } from '@/components/ui/switch';

export function GitStatusSection() {
  const [enabled, setEnabled] = useState(true);
  const [useSetB, setUseSetB] = useState(false);
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('dark');

  const isDark = colorMode === 'dark';

  const gitStatus = useMemo(
    () => (enabled ? (useSetB ? GIT_STATUSES_B : GIT_STATUSES_A) : undefined),
    [enabled, useSetB]
  );

  const panelStyle = {
    colorScheme: colorMode,
    '--trees-search-bg-override': isDark ? 'oklch(14.5% 0 0)' : '#fff',
  } as CSSProperties;

  return (
    <TreeExampleSection id="git-status">
      <FeatureHeader
        title="Show Git status on files"
        description={
          <>
            Use the{' '}
            <Link href="/trees/docs#git-status" className="inline-link">
              <code>gitStatus</code>
            </Link>{' '}
            prop to show indicators on files for added, modified, and deleted
            files. Folders that contain changed descendants automatically
            receive a change hint. Toggle between two datasets to simulate
            different Git statuses.{' '}
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
            className={DEFAULT_FILE_TREE_PANEL_CLASS}
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
