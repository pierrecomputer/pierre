'use client';

import type { FileContents } from '@pierre/diffs';
import type { FileTreePreloadedData } from '@pierre/trees/react';
import { useFileTree } from '@pierre/trees/react';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import {
  TREE_APP_DEMO_GIT_STATUSES,
  TREE_APP_DEMO_UNSAFE_CSS,
} from './treeAppDemoData';
import { TreeApp } from '@/components/TreeApp';
import type { GitStatusEntry } from '@/lib/treesCompat';

const COMPACT_ITEM_HEIGHT = 24;
const COMPACT_DENSITY = 0.8;

const treePanelStyle = {
  colorScheme: 'dark',
  '--trees-search-bg-override': '#1f2631',
  '--trees-density-override': COMPACT_DENSITY,
  '--trees-row-height-override': `${String(COMPACT_ITEM_HEIGHT)}px`,
} as CSSProperties;

const fileOptions = {
  disableFileHeader: true,
  theme: 'pierre-dark',
  themeType: 'dark',
} as const;

const composition = {
  contextMenu: {
    enabled: true,
    triggerMode: 'right-click',
  },
} as const;

interface DemoTreeAppClientProps {
  files: Readonly<Record<string, FileContents>>;
  initialActivePath: string;
  initialExpandedPaths: readonly string[];
  paths: readonly string[];
  prerenderedHTMLByPath: Readonly<Record<string, string>>;
  treeId: string;
  treePreloadedData: FileTreePreloadedData;
}

// Remaps one path after a tree move so the demo's file-content maps continue
// to line up with the same files after drag-and-drop or inline rename.
function remapMovedPath(
  path: string,
  fromPath: string,
  toPath: string
): string {
  if (path === fromPath) {
    return toPath;
  }

  const descendantPrefix = fromPath.endsWith('/') ? fromPath : `${fromPath}/`;
  if (!path.startsWith(descendantPrefix)) {
    return path;
  }

  return `${toPath}${path.slice(fromPath.length)}`;
}

function basename(path: string): string {
  const lastSlashIndex = path.lastIndexOf('/');
  return lastSlashIndex < 0 ? path : path.slice(lastSlashIndex + 1);
}

function remapFileMap(
  filesByPath: Readonly<Record<string, FileContents>>,
  fromPath: string,
  toPath: string
): Readonly<Record<string, FileContents>> {
  return Object.fromEntries(
    Object.entries(filesByPath).map(([path, file]) => {
      const nextPath = remapMovedPath(path, fromPath, toPath);
      return [
        nextPath,
        nextPath === path ? file : { ...file, name: basename(nextPath) },
      ] as const;
    })
  );
}

function remapHtmlMap(
  htmlByPath: Readonly<Record<string, string>>,
  fromPath: string,
  toPath: string
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(htmlByPath).map(([path, html]) => [
      remapMovedPath(path, fromPath, toPath),
      html,
    ])
  );
}

function remapGitStatusEntries(
  entries: readonly GitStatusEntry[],
  fromPath: string,
  toPath: string
): readonly GitStatusEntry[] {
  const nextEntries = entries.map((entry) => ({
    ...entry,
    path: remapMovedPath(entry.path, fromPath, toPath),
  }));

  const ignoredDirectoryPaths = new Set(
    nextEntries
      .filter((entry) => entry.status === 'ignored' && entry.path.endsWith('/'))
      .map((entry) => entry.path)
  );

  return nextEntries.filter(
    (entry) =>
      (entry.status === 'ignored' && entry.path.endsWith('/')) ||
      !isPathInsideIgnoredDirectory(entry.path, ignoredDirectoryPaths)
  );
}

// Explicit file statuses should not override inherited ignored styling when a
// move drops that entry underneath an ignored directory like node_modules/.
function isPathInsideIgnoredDirectory(
  path: string,
  ignoredDirectoryPaths: ReadonlySet<string>
): boolean {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;
  if (normalizedPath.length === 0) {
    return false;
  }

  const segments = normalizedPath.split('/');
  let ancestorPath = '';
  for (let index = 0; index < segments.length - 1; index += 1) {
    ancestorPath = `${ancestorPath}${segments[index]}/`;
    if (ignoredDirectoryPaths.has(ancestorPath)) {
      return true;
    }
  }

  return false;
}

export function DemoTreeAppClient({
  files,
  initialActivePath,
  initialExpandedPaths,
  paths,
  prerenderedHTMLByPath,
  treeId,
  treePreloadedData,
}: DemoTreeAppClientProps) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null
  );
  const [filesByPath, setFilesByPath] = useState(files);
  const [gitStatusEntries, setGitStatusEntries] = useState(
    TREE_APP_DEMO_GIT_STATUSES
  );
  const [prerenderedHtmlByPathState, setPrerenderedHtmlByPathState] = useState(
    prerenderedHTMLByPath
  );

  useEffect(() => {
    setPortalContainer(document.getElementById('dark-mode-portal-container'));
  }, []);

  useEffect(() => {
    setFilesByPath(files);
  }, [files]);

  useEffect(() => {
    setPrerenderedHtmlByPathState(prerenderedHTMLByPath);
  }, [prerenderedHTMLByPath]);

  const treeOptions = useMemo(
    () => ({
      composition,
      dragAndDrop: true as const,
      fileTreeSearchMode: 'hide-non-matches' as const,
      flattenEmptyDirectories: true,
      gitStatus: TREE_APP_DEMO_GIT_STATUSES,
      id: treeId,
      initialExpandedPaths,
      initialSelectedPaths: [initialActivePath],
      itemHeight: COMPACT_ITEM_HEIGHT,
      paths,
      renaming: true as const,
      search: true as const,
      unsafeCSS: TREE_APP_DEMO_UNSAFE_CSS,
      viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.treeApp,
    }),
    [initialActivePath, initialExpandedPaths, paths, treeId]
  );

  const { model } = useFileTree(treeOptions);

  useEffect(() => {
    model.setGitStatus(gitStatusEntries);
  }, [gitStatusEntries, model]);

  useEffect(
    () =>
      model.onMutation('*', (event) => {
        const moveEvents =
          event.operation === 'move'
            ? [event]
            : event.operation === 'batch'
              ? event.events.filter((entry) => entry.operation === 'move')
              : [];
        if (moveEvents.length === 0) {
          return;
        }

        setFilesByPath((current) => {
          let nextFiles = current;
          for (const moveEvent of moveEvents) {
            nextFiles = remapFileMap(nextFiles, moveEvent.from, moveEvent.to);
          }
          return nextFiles;
        });
        setPrerenderedHtmlByPathState((current) => {
          let nextHtml = current;
          for (const moveEvent of moveEvents) {
            nextHtml = remapHtmlMap(nextHtml, moveEvent.from, moveEvent.to);
          }
          return nextHtml;
        });
        setGitStatusEntries((current) => {
          let nextEntries = current;
          for (const moveEvent of moveEvents) {
            nextEntries = remapGitStatusEntries(
              nextEntries,
              moveEvent.from,
              moveEvent.to
            );
          }
          return nextEntries;
        });
      }),
    [model]
  );

  return (
    <TreeApp
      contextMenuPortalContainer={portalContainer}
      fileOptions={fileOptions}
      files={filesByPath}
      height={TREE_NEW_VIEWPORT_HEIGHTS.treeApp}
      initialActivePath={initialActivePath}
      model={model}
      preloadedTreeData={treePreloadedData}
      prerenderedHTMLByPath={prerenderedHtmlByPathState}
      projectName="acme-components"
      searchEnabled
      treeClassName="dark h-full min-h-0 overflow-auto"
      treeStyle={treePanelStyle}
    />
  );
}
