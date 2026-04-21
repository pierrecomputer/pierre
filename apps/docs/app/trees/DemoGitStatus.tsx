'use client';

import {
  IconColorDark,
  IconColorLight,
  IconFolders,
  IconTableRowHeader,
} from '@pierre/icons';
import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { FeatureHeader } from '../diff-examples/FeatureHeader';
import { sampleFileList } from './demo-data';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import {
  TREE_NEW_GIT_STATUS_EXPANDED_PATHS,
  TREE_NEW_GIT_STATUSES,
} from './gitStatusDemoData';
import { getDefaultFileTreePanelClass } from './tree-examples/demo-data';
import { TreeExampleSection } from './tree-examples/TreeExampleSection';
import { PRODUCTS } from '@/app/product-config';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { Switch } from '@/components/ui/switch';
import type { FileTreePathOptions } from '@/lib/fileTreePathOptions';
import type { GitStatusEntry } from '@/lib/treesCompat';

function escapePathForRegex(path: string): string {
  return path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Keep ignored descendants visible when the demo hides unmodified files so the
// inherited ignored styling still has real rows to act on.
function getVisibleGitStatusPaths(
  paths: readonly string[],
  entries: readonly GitStatusEntry[]
): string[] {
  const directPaths = new Set<string>();
  const ignoredDirectoryPaths: string[] = [];

  for (const entry of entries) {
    if (entry.status === 'ignored' && entry.path.endsWith('/')) {
      ignoredDirectoryPaths.push(entry.path);
      continue;
    }

    directPaths.add(entry.path);
  }

  if (ignoredDirectoryPaths.length === 0) {
    return paths.filter((path) => directPaths.has(path));
  }

  const ignoredDirectoryPattern = new RegExp(
    `^(?:${ignoredDirectoryPaths.map(escapePathForRegex).join('|')})`
  );

  return paths.filter(
    (path) => directPaths.has(path) || ignoredDirectoryPattern.test(path)
  );
}

const FILE_TREE_GIT_STATUS_BASE_OPTIONS: Omit<
  FileTreePathOptions,
  'gitStatus' | 'id'
> = {
  flattenEmptyDirectories: true,
  initialExpandedPaths: TREE_NEW_GIT_STATUS_EXPANDED_PATHS,
  paths: sampleFileList,
  search: false,
  initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.gitStatusFull / 30,
};

interface DemoGitStatusProps {
  preloadedData: {
    filteredViewport: FileTreePreloadedData;
    fullViewport: FileTreePreloadedData;
  };
}

export function DemoGitStatus({ preloadedData }: DemoGitStatusProps) {
  const [showUnmodified, setShowUnmodified] = useState(true);
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('dark');
  const [mobileView, setMobileView] = useState<'tree' | 'legend'>('tree');

  const activeGitStatus = TREE_NEW_GIT_STATUSES;
  const isDark = colorMode === 'dark';
  const panelStyle = useMemo(
    () =>
      ({
        colorScheme: colorMode,
        '--trees-search-bg-override': isDark ? 'oklch(14.5% 0 0)' : '#fff',
      }) as CSSProperties,
    [colorMode, isDark]
  );
  const visiblePaths = useMemo(() => {
    if (showUnmodified) {
      return sampleFileList;
    }

    return getVisibleGitStatusPaths(sampleFileList, activeGitStatus);
  }, [activeGitStatus, showUnmodified]);

  const { model: fullViewportModel } = useFileTree({
    ...FILE_TREE_GIT_STATUS_BASE_OPTIONS,
    gitStatus: TREE_NEW_GIT_STATUSES,
    id: 'file-tree-git-status-demo-full',
  });
  const { model: filteredViewportModel } = useFileTree({
    ...FILE_TREE_GIT_STATUS_BASE_OPTIONS,
    gitStatus: TREE_NEW_GIT_STATUSES,
    id: 'file-tree-git-status-demo-filtered',
    initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.gitStatusFiltered / 30,
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
      initialExpandedPaths: TREE_NEW_GIT_STATUS_EXPANDED_PATHS,
    });
    model.setGitStatus(activeGitStatus);
  }, [activeGitStatus, model, visiblePaths]);

  return (
    <TreeExampleSection>
      <FeatureHeader
        id="git-status"
        title="Show Git status on files"
        description={
          <>
            Use the{' '}
            <Link
              href={`${PRODUCTS.trees.docsPath}#show-git-status-and-row-annotations`}
              className="inline-link"
            >
              <code>gitStatus</code>
            </Link>{' '}
            option to show status badges for added, modified, deleted, renamed,
            untracked, and ignored files. Ignored items inherit their styling
            without rendering an indicator while folders with changed
            descendants get a dot indicator automatically.
          </>
        }
      />

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
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
            value={colorMode}
            onValueChange={(value) => setColorMode(value as 'light' | 'dark')}
          >
            <ButtonGroupItem value="light">
              <IconColorLight className="size-4" />
              <span className="hidden md:inline">Light</span>
            </ButtonGroupItem>
            <ButtonGroupItem value="dark">
              <IconColorDark className="size-4" />
              <span className="hidden md:inline">Dark</span>
            </ButtonGroupItem>
          </ButtonGroup>

          <ButtonGroup
            className="min-[500px]:ml-auto md:hidden"
            value={mobileView}
            onValueChange={(value) => setMobileView(value as 'tree' | 'legend')}
          >
            <ButtonGroupItem value="tree">
              <IconFolders /> Tree
            </ButtonGroupItem>
            <ButtonGroupItem value="legend">
              <IconTableRowHeader /> Legend
            </ButtonGroupItem>
          </ButtonGroup>
        </div>

        <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
          <div
            className={mobileView === 'tree' ? undefined : 'hidden md:block'}
          >
            <FileTree
              className={getDefaultFileTreePanelClass(colorMode)}
              model={model}
              preloadedData={activePreloadedData}
              style={{
                ...panelStyle,
                height: `${String(viewportHeight)}px`,
              }}
            />
          </div>
          <div
            className={mobileView === 'legend' ? undefined : 'hidden md:block'}
          >
            <GitStatusLegend colorMode={colorMode} />
          </div>
        </div>
      </div>
    </TreeExampleSection>
  );
}

const GIT_STATUS_LEGEND: ReadonlyArray<{
  status:
    | 'modified'
    | 'added'
    | 'deleted'
    | 'renamed'
    | 'untracked'
    | 'ignored'
    | 'descendant';
  badge: string | null;
  light: string;
  dark: string;
  badgeOpacity?: number;
  description: string;
}> = [
  {
    status: 'modified',
    badge: 'M',
    light: '#1ca1c7',
    dark: '#08c0ef',
    description: 'Tracked file with uncommitted changes',
  },
  {
    status: 'added',
    badge: 'A',
    light: '#16a994',
    dark: '#00cab1',
    description: 'New file staged in the working tree',
  },
  {
    status: 'deleted',
    badge: 'D',
    light: '#ff2e3f',
    dark: '#ff6762',
    description: 'Tracked file removed from the working tree',
  },
  {
    status: 'renamed',
    badge: 'R',
    light: '#d5a910',
    dark: '#ffd452',
    description: 'Tracked file moved or renamed',
  },
  {
    status: 'untracked',
    badge: 'U',
    light: '#16a994',
    dark: '#00cab1',
    description: 'New file not yet tracked by Git',
  },
  {
    status: 'ignored',
    badge: null,
    light: '#adadb1',
    dark: '#4a4a4e',
    description: 'Path excluded by gitignore; inherits muted styling',
  },
  {
    status: 'descendant',
    badge: '●',
    light: '#1ca1c7',
    dark: '#08c0ef',
    badgeOpacity: 0.5,
    description: 'Folder contains changed descendants',
  },
];

function GitStatusLegend({ colorMode }: { colorMode: 'light' | 'dark' }) {
  const isDark = colorMode === 'dark';
  const containerClass = [
    'bg-background text-foreground w-full overflow-hidden rounded-lg border border-[var(--color-border)] md:flex-none dark:bg-[#141415] order-first md:order-last',
    isDark ? 'dark' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={containerClass} style={{ colorScheme: colorMode }}>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 border-b border-[var(--color-border)] dark:bg-[#070707] dark:text-neutral-400">
            <th className="w-14 px-4 py-2.5 text-left font-medium">
              Indicator
            </th>
            <th className="w-14 px-4 py-2.5 text-left font-medium">State</th>
            <th className="px-4 py-2.5 text-left font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {GIT_STATUS_LEGEND.map((entry) => {
            const statusColor = isDark ? entry.dark : entry.light;
            return (
              <tr
                key={entry.status}
                className="border-b border-[var(--color-border)] last:border-b-0"
              >
                <td className="px-4 py-2">
                  {entry.badge == null ? (
                    <div className="text-muted-foreground w-6 text-center text-xs">
                      None
                    </div>
                  ) : (
                    <span
                      aria-label={entry.status}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold tabular-nums shadow-[inset_0_0_0_1px_rgb(0_0_0_/_0.05)]"
                      style={{
                        color: statusColor,
                        opacity: entry.badgeOpacity,
                      }}
                    >
                      {entry.badge}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <code className="dark:text-neutral-300">{entry.status}</code>
                </td>
                <td className="text-muted-foreground px-4 py-2 dark:text-neutral-400">
                  {entry.description}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
