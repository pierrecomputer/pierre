'use client';

import { IconSymbolDiffstat } from '@pierre/icons';
import type { FileTreeOptions } from '@pierre/trees';
import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { sampleFileList } from '../demo-data';
import {
  DEFAULT_FILE_TREE_PANEL_CLASS,
  GIT_STATUSES_A,
  GIT_STATUSES_B,
} from '../tree-examples/demo-data';
import { TreeExampleSection } from '../tree-examples/TreeExampleSection';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import { PRODUCTS } from '@/app/product-config';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { Switch } from '@/components/ui/switch';

const GIT_STATUS_EXPANDED_PATHS = ['src', 'src/components'] as const;
const gitStatusPanelStyle = {
  colorScheme: 'dark',
  '--trees-search-bg-override': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;

const FILE_TREE_GIT_STATUS_BASE_OPTIONS: Omit<
  FileTreeOptions,
  'gitStatus' | 'id'
> = {
  flattenEmptyDirectories: true,
  initialExpandedPaths: GIT_STATUS_EXPANDED_PATHS,
  paths: sampleFileList,
  search: false,
  viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.gitStatusFull,
};

interface DemoGitStatusProps {
  preloadedData: {
    filteredViewport: FileTreePreloadedData;
    fullViewport: FileTreePreloadedData;
  };
}

export function DemoGitStatus({ preloadedData }: DemoGitStatusProps) {
  const [enabled, setEnabled] = useState(true);
  const [showUnmodified, setShowUnmodified] = useState(true);
  const [useSetB, setUseSetB] = useState(false);

  const activeGitStatus = useMemo(
    () => (useSetB ? GIT_STATUSES_B : GIT_STATUSES_A),
    [useSetB]
  );
  const gitStatus = useMemo(
    () => (enabled ? activeGitStatus : undefined),
    [activeGitStatus, enabled]
  );
  const visiblePaths = useMemo(() => {
    if (!enabled || showUnmodified) {
      return sampleFileList;
    }

    const changedPathSet = new Set(activeGitStatus.map((entry) => entry.path));
    return sampleFileList.filter((path) => changedPathSet.has(path));
  }, [activeGitStatus, enabled, showUnmodified]);

  const { model: fullViewportModel } = useFileTree({
    ...FILE_TREE_GIT_STATUS_BASE_OPTIONS,
    gitStatus: GIT_STATUSES_A,
    id: 'file-tree-git-status-demo-full',
  });
  const { model: filteredViewportModel } = useFileTree({
    ...FILE_TREE_GIT_STATUS_BASE_OPTIONS,
    gitStatus: GIT_STATUSES_A,
    id: 'file-tree-git-status-demo-filtered',
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.gitStatusFiltered,
  });
  const model = showUnmodified ? fullViewportModel : filteredViewportModel;
  const activePreloadedData = showUnmodified
    ? preloadedData.fullViewport
    : preloadedData.filteredViewport;
  const viewportHeight = showUnmodified
    ? TREE_NEW_VIEWPORT_HEIGHTS.gitStatusFull
    : TREE_NEW_VIEWPORT_HEIGHTS.gitStatusFiltered;

  useEffect(() => {
    model.resetPaths(visiblePaths, {
      initialExpandedPaths: GIT_STATUS_EXPANDED_PATHS,
    });
    model.setGitStatus(gitStatus);
  }, [gitStatus, model, visiblePaths]);

  return (
    <TreeExampleSection>
      <FeatureHeader
        id="git-status"
        title="Show Git status on files"
        description={
          <>
            Use the{' '}
            <Link
              href={`${PRODUCTS.trees.docsPath}#git-status`}
              className="inline-link"
            >
              <code>gitStatus</code>
            </Link>{' '}
            option with the file tree model to show indicators for added,
            modified, and deleted files. Folder rows derive a changed-descendant
            hint automatically. Toggle between two status datasets and
            optionally hide unmodified files.
          </>
        }
      />

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="gridstack">
            <Button
              variant="outline"
              className="w-full justify-between gap-3 pr-11 pl-3 md:w-auto"
              onClick={() => setEnabled((previous) => !previous)}
            >
              <div className="flex items-center gap-2">
                <IconSymbolDiffstat />
                Show Git status
              </div>
            </Button>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              onClick={(event) => event.stopPropagation()}
              className="pointer-events-none mr-3 place-self-center justify-self-end"
            />
          </div>

          <div className="gridstack">
            <Button
              variant="outline"
              className="w-full justify-between gap-3 pr-11 pl-3 md:w-auto"
              onClick={() => setShowUnmodified((previous) => !previous)}
            >
              Show unmodified
            </Button>
            <Switch
              checked={showUnmodified}
              onCheckedChange={setShowUnmodified}
              onClick={(event) => event.stopPropagation()}
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
          model={model}
          preloadedData={activePreloadedData}
          style={{
            ...gitStatusPanelStyle,
            height: `${String(viewportHeight)}px`,
          }}
        />
      </div>
    </TreeExampleSection>
  );
}
