'use client';

import {
  type ContextMenuItem,
  type ContextMenuOpenContext,
  FileTree,
  type FileTreeDropResult,
  type FileTreeMutationEvent,
} from '@pierre/trees';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { createRoot, type Root as ReactDomRoot } from 'react-dom/client';

import { StateLog, useStateLog } from '../_components/StateLog';
import { createPresortedPreparedInput } from '../_lib/createPresortedPreparedInput';
import { DEMO_FILE_TREE_ICONS } from '../_lib/demoIcons';
import { getFloatingContextMenuTriggerStyle } from '../_lib/getFloatingContextMenuTriggerStyle';
import {
  FILE_TREE_PROOF_VIEWPORT_HEIGHT,
  type TreesWorkloadDataPayload,
  type TreesWorkloadName,
  type TreesWorkloadOption,
} from '../_lib/workloadMeta';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FileTreePathOptions } from '@/lib/fileTreePathOptions';

interface MainDemoClientProps {
  children: ReactNode;
  defaultWorkloadName: TreesWorkloadName;
  expansionMode: 'all' | 'collapsed' | 'workload';
  treeMountId: string;
  workloadData: TreesWorkloadDataPayload;
  workloadOptions: readonly TreesWorkloadOption[];
}

type DemoMutationOperation =
  | { path: string; type: 'add' }
  | { from: string; to: string; type: 'move' };

interface DemoMutationTargets {
  batchOperations: readonly DemoMutationOperation[];
  moveFromPath: string | null;
  moveToPath: string | null;
}

function getParentPath(path: string): string {
  if (path.endsWith('/')) {
    const trimmedPath = path.slice(0, -1);
    const lastSlashIndex = trimmedPath.lastIndexOf('/');
    return lastSlashIndex < 0
      ? ''
      : `${trimmedPath.slice(0, lastSlashIndex + 1)}`;
  }

  const lastSlashIndex = path.lastIndexOf('/');
  return lastSlashIndex < 0 ? '' : path.slice(0, lastSlashIndex + 1);
}

function getPathBasename(path: string): string {
  const trimmedPath = path.endsWith('/') ? path.slice(0, -1) : path;
  const lastSlashIndex = trimmedPath.lastIndexOf('/');
  return lastSlashIndex < 0
    ? trimmedPath
    : trimmedPath.slice(lastSlashIndex + 1);
}

// Creates a stable suffixed path so repeated demo-target derivation can avoid collisions.
function getSuffixedPath(path: string, suffix: number): string {
  if (path.endsWith('/')) {
    return `${path.slice(0, -1)}-${String(suffix)}/`;
  }

  const lastSlashIndex = path.lastIndexOf('/');
  const lastDotIndex = path.lastIndexOf('.');
  if (lastDotIndex > lastSlashIndex) {
    return `${path.slice(0, lastDotIndex)}-${String(suffix)}${path.slice(lastDotIndex)}`;
  }

  return `${path}-${String(suffix)}`;
}

// Picks a unique demo path under the existing tree so mutation buttons can be re-used after reset.
function getUniquePath(
  path: string,
  existingPaths: ReadonlySet<string>
): string {
  let candidatePath = path;
  let suffix = 1;
  while (existingPaths.has(candidatePath)) {
    candidatePath = getSuffixedPath(path, suffix);
    suffix += 1;
  }
  return candidatePath;
}

function renamePathSameParent(path: string, nextBasename: string): string {
  const parentPath = getParentPath(path);
  const trimmedBasename = nextBasename.trim();
  return path.endsWith('/')
    ? `${parentPath}${trimmedBasename}/`
    : `${parentPath}${trimmedBasename}`;
}

// Derives deterministic proof paths from the current workload instead of hardcoding one repo shape.
function createMutationDemoTargets(
  paths: readonly string[],
  initialExpandedPaths: readonly string[] | undefined
): DemoMutationTargets {
  const existingPaths = new Set(paths);
  const directoryPaths = new Set<string>();
  for (const path of paths) {
    let currentParentPath = getParentPath(path);
    while (currentParentPath.length > 0) {
      directoryPaths.add(currentParentPath);
      currentParentPath = getParentPath(currentParentPath);
    }
    if (path.endsWith('/')) {
      directoryPaths.add(path);
    }
  }

  const sortedDirectoryPaths = [...directoryPaths].sort();
  const firstDirectoryPath =
    initialExpandedPaths?.toSorted()[0] ?? sortedDirectoryPaths[0] ?? '';
  const filePaths = paths.filter((path) => !path.endsWith('/'));
  let moveFromPath: string | null = null;
  let moveToPath: string | null = null;
  for (const sourcePath of filePaths) {
    const sourceParentPath = getParentPath(sourcePath);
    const sourceBasename = getPathBasename(sourcePath);
    const siblingRenameTarget = getUniquePath(
      renamePathSameParent(sourcePath, `moved-${sourceBasename}`),
      existingPaths
    );

    const alternateDirectoryTarget = sortedDirectoryPaths
      .filter((directoryPath) => directoryPath !== sourceParentPath)
      .map((directoryPath) => `${directoryPath}${sourceBasename}`)
      .find((candidatePath) => !existingPaths.has(candidatePath));

    moveFromPath = sourcePath;
    moveToPath = alternateDirectoryTarget ?? siblingRenameTarget;
    break;
  }

  const batchFolderPath = getUniquePath(
    `${firstDirectoryPath}phase-6-batch-folder/`,
    existingPaths
  );
  const batchFilePath = `${batchFolderPath}batch-note.md`;
  const batchOperations: DemoMutationOperation[] = [
    { path: batchFolderPath, type: 'add' },
    { path: batchFilePath, type: 'add' },
  ];
  if (moveFromPath != null && moveToPath != null) {
    batchOperations.push({ from: moveFromPath, to: moveToPath, type: 'move' });
  }

  return {
    batchOperations,
    moveFromPath,
    moveToPath,
  };
}

function getFirstVisibleDirectoryPath(tree: FileTree): string {
  const firstVisiblePath =
    tree
      .getFileTreeContainer()
      ?.shadowRoot?.querySelector<HTMLButtonElement>('button[data-type="item"]')
      ?.dataset.itemPath ?? '';
  if (firstVisiblePath.endsWith('/')) {
    return firstVisiblePath;
  }

  return getParentPath(firstVisiblePath);
}

function getFirstVisibleFileParentPath(tree: FileTree): string {
  const visibleButtons =
    tree
      .getFileTreeContainer()
      ?.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        'button[data-type="item"]'
      ) ?? [];
  for (const button of visibleButtons) {
    const itemPath = button.dataset.itemPath;
    if (itemPath != null && itemPath.endsWith('/') === false) {
      return getParentPath(itemPath);
    }
  }

  return getFirstVisibleDirectoryPath(tree);
}

function getAvailableMutationPath(tree: FileTree, basePath: string): string {
  let candidatePath = basePath;
  let suffix = 1;
  while (tree.getItem(candidatePath) != null) {
    candidatePath = getSuffixedPath(basePath, suffix);
    suffix += 1;
  }
  return candidatePath;
}

interface UpgradePayload {
  allExpandedPaths: readonly string[];
  paths: readonly string[];
}

// Fetches a gzipped upgrade payload from the CDN, gunzips it in the browser
// via DecompressionStream, and parses it. This is how the AOSP workload avoids
// shipping 130 MB of uncompressed JSON through the Vercel serverless function
// — the client downloads ~11 MB from the edge instead, and the expansion list
// is precomputed so we don't walk 1.6 M paths after decompression.
async function fetchUpgradePayload(
  url: string,
  signal: AbortSignal
): Promise<UpgradePayload> {
  const response = await fetch(url, { signal });
  if (!response.ok || response.body == null) {
    throw new Error(
      `Failed to fetch upgrade path list (${String(response.status)})`
    );
  }

  const decompressedStream = response.body.pipeThrough(
    new DecompressionStream('gzip')
  );
  const decompressedText = await new Response(decompressedStream).text();
  return JSON.parse(decompressedText) as UpgradePayload;
}

function formatMutationEvent(event: FileTreeMutationEvent): string {
  switch (event.operation) {
    case 'add':
      return `mutation:add ${event.path}`;
    case 'remove':
      return `mutation:remove ${event.path}${event.recursive === true ? ' (recursive)' : ''}`;
    case 'move':
      return `mutation:move ${event.from} -> ${event.to}`;
    case 'batch':
      return `mutation:batch [${event.events.map((entry) => entry.operation).join(', ')}]`;
    case 'reset':
      return `mutation:reset ${String(event.pathCountBefore)} -> ${String(event.pathCountAfter)} paths`;
  }
}

function formatDropResult(event: FileTreeDropResult): string {
  const targetLabel =
    event.target.kind === 'root'
      ? 'root'
      : (event.target.directoryPath ?? 'unknown');
  const flattenedSegmentLabel =
    event.target.flattenedSegmentPath == null
      ? ''
      : ` via ${event.target.flattenedSegmentPath}`;
  return `drop:${event.operation} [${event.draggedPaths.join(', ')}] -> ${targetLabel}${flattenedSegmentLabel}`;
}

function DemoMutationContextMenu({
  item,
  context,
  onDelete,
  onRename,
}: {
  item: ContextMenuItem;
  context: Pick<
    ContextMenuOpenContext,
    'anchorRect' | 'close' | 'restoreFocus'
  >;
  onDelete: () => void;
  onRename: () => void;
}) {
  const itemType = item.kind === 'directory' ? 'Folder' : 'File';

  return (
    <DropdownMenu
      open
      modal={false}
      onOpenChange={(open) => !open && context.close()}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          style={getFloatingContextMenuTriggerStyle(context.anchorRect)}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-test-context-menu="true"
        data-file-tree-context-menu-root="true"
        align="center"
        side="bottom"
        sideOffset={4}
        className="min-w-[220px]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          context.restoreFocus();
        }}
      >
        <DropdownMenuLabel className="max-w-[280px] truncate">
          {itemType}: {item.path}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-test-menu-rename={item.path}
          onSelect={() => {
            context.close({ restoreFocus: false });
            onRename();
          }}
        >
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          data-test-menu-delete={item.path}
          className="text-destructive focus:text-destructive"
          onSelect={() => {
            onDelete();
            context.close();
          }}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Renders the mutation proof menu through a slotted React root so the dropdown
// keeps the Phase 5 anchoring behavior without layout-shifting the trigger.
function renderMutationContextMenuSlot({
  item,
  menuRootRef,
  onDelete,
  onRename,
  slotElement,
  context,
}: {
  item: ContextMenuItem;
  menuRootRef: { current: ReactDomRoot | null };
  onDelete: () => void;
  onRename: () => void;
  slotElement: HTMLDivElement;
  context: Pick<
    ContextMenuOpenContext,
    'anchorRect' | 'close' | 'restoreFocus'
  >;
}): void {
  menuRootRef.current ??= createRoot(slotElement);
  slotElement.style.display = 'block';
  menuRootRef.current.render(
    <DemoMutationContextMenu
      item={item}
      context={context}
      onDelete={onDelete}
      onRename={onRename}
    />
  );
}

function clearMutationContextMenuSlot({
  menuRootRef,
  slotElement,
  unmount = false,
}: {
  menuRootRef: { current: ReactDomRoot | null };
  slotElement: HTMLDivElement;
  unmount?: boolean;
}): void {
  const currentRoot = menuRootRef.current;
  if (currentRoot == null) {
    return;
  }

  slotElement.style.display = 'none';
  if (unmount) {
    menuRootRef.current = null;
    // Route transitions can unmount this helper while React is still rendering
    // the next page. Defer the nested root teardown until the current render
    // completes so React does not warn about a synchronous root unmount.
    queueMicrotask(() => {
      currentRoot.unmount();
    });
    return;
  }

  currentRoot.render(null);
}

const HydratedMainDemoController = memo(function HydratedMainDemoController({
  onTreeReady,
  options,
  treeMountId,
}: {
  onTreeReady: (fileTree: FileTree | null) => void;
  options: Omit<FileTreePathOptions, 'icons'>;
  treeMountId: string;
}) {
  useEffect(() => {
    const node = document.getElementById(treeMountId);
    if (!(node instanceof HTMLDivElement)) {
      return;
    }

    const fileTree = new FileTree(options);
    onTreeReady(fileTree);
    const fileTreeContainer = node.querySelector('file-tree-container');
    if (fileTreeContainer instanceof HTMLElement) {
      fileTree.hydrate({ fileTreeContainer });
    } else {
      node.innerHTML = '';
      fileTree.render({ containerWrapper: node });
    }

    return () => {
      fileTree.cleanUp();
      onTreeReady(null);
    };
  }, [onTreeReady, options, treeMountId]);

  return null;
});

export function MainDemoClient({
  children,
  defaultWorkloadName,
  expansionMode,
  treeMountId,
  workloadData,
  workloadOptions,
}: MainDemoClientProps) {
  const { addLog, log } = useStateLog();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isNavigatingDemoState, startDemoStateTransition] = useTransition();
  const contextMenuRootRef = useRef<ReactDomRoot | null>(null);
  const contextMenuSlotRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<FileTree | null>(null);
  const mutationUnsubscribeRef = useRef<(() => void) | null>(null);
  const upgradeAbortRef = useRef<AbortController | null>(null);
  const hasUpgradedRef = useRef(false);
  const [iconMode, setIconMode] = useState<
    'complete' | 'custom' | 'minimal' | 'standard'
  >('complete');
  const [pendingWorkloadName, setPendingWorkloadName] = useState(
    workloadData.selectedWorkload.name
  );

  useEffect(() => {
    setPendingWorkloadName(workloadData.selectedWorkload.name);
  }, [workloadData.selectedWorkload.name]);

  const preparedInput = useMemo(
    () =>
      workloadData.pathsArePresorted
        ? createPresortedPreparedInput(workloadData.paths)
        : undefined,
    [workloadData]
  );
  const sharedOptions = useMemo<
    Omit<FileTreePathOptions, 'id' | 'preparedInput'>
  >(
    () => ({
      composition: {
        contextMenu: {
          enabled: true,
          triggerMode: 'both',
        },
      },
      dragAndDrop: true,
      flattenEmptyDirectories: true,
      fileTreeSearchMode: 'hide-non-matches',
      initialExpandedPaths: workloadData.initialExpandedPaths,
      paths: workloadData.paths,
      search: true,
      stickyFolders: true,
      viewportHeight: FILE_TREE_PROOF_VIEWPORT_HEIGHT,
    }),
    [workloadData]
  );
  const currentPaths = sharedOptions.paths ?? workloadData.paths;
  const demoTargets = useMemo(
    () =>
      createMutationDemoTargets(
        currentPaths,
        sharedOptions.initialExpandedPaths
      ),
    [currentPaths, sharedOptions]
  );
  const activeWorkloadSummary = workloadData.selectedWorkload;

  const handleWorkloadChange = useCallback(
    (nextWorkloadName: string) => {
      const nextSearchParams = new URLSearchParams(searchParams.toString());
      setPendingWorkloadName(nextWorkloadName as TreesWorkloadName);
      if (nextWorkloadName === defaultWorkloadName) {
        nextSearchParams.delete('workload');
      } else {
        nextSearchParams.set('workload', nextWorkloadName);
      }

      const nextUrl =
        nextSearchParams.size > 0
          ? `${pathname}?${nextSearchParams.toString()}`
          : pathname;
      startDemoStateTransition(() => {
        router.replace(nextUrl, { scroll: false });
      });
    },
    [
      defaultWorkloadName,
      pathname,
      router,
      searchParams,
      startDemoStateTransition,
    ]
  );

  const handleExpansionChange = useCallback(
    (nextExpansionMode: 'all' | 'collapsed') => {
      const nextSearchParams = new URLSearchParams(searchParams.toString());
      nextSearchParams.set('expansion', nextExpansionMode);
      const nextUrl = `${pathname}?${nextSearchParams.toString()}`;
      startDemoStateTransition(() => {
        router.replace(nextUrl, { scroll: false });
      });
    },
    [pathname, router, searchParams, startDemoStateTransition]
  );
  const handleSelectionChange = useCallback(
    (selectedPaths: readonly string[]) => {
      addLog(`selected: [${selectedPaths.join(', ')}]`);
    },
    [addLog]
  );
  const runSearchAction = useCallback(
    (label: string, action: (tree: FileTree) => void): void => {
      const tree = treeRef.current;
      if (tree == null) {
        addLog(`error: tree not ready for ${label}`);
        return;
      }

      action(tree);
    },
    [addLog]
  );

  useEffect(() => {
    return () => {
      mutationUnsubscribeRef.current?.();
      mutationUnsubscribeRef.current = null;
      upgradeAbortRef.current?.abort();
      upgradeAbortRef.current = null;
      if (contextMenuSlotRef.current == null) {
        return;
      }

      clearMutationContextMenuSlot({
        menuRootRef: contextMenuRootRef,
        slotElement: contextMenuSlotRef.current,
        unmount: true,
      });
    };
  }, []);

  const runMutation = useCallback(
    (label: string, mutate: (tree: FileTree) => void): void => {
      const tree = treeRef.current;
      if (tree == null) {
        addLog(`error: tree not ready for ${label}`);
        return;
      }

      try {
        mutate(tree);
      } catch (error) {
        addLog(`error:${label} ${(error as Error).message ?? String(error)}`);
      }
    },
    [addLog]
  );

  const options = useMemo<Omit<FileTreePathOptions, 'icons'>>(() => {
    return {
      ...sharedOptions,
      composition: {
        ...sharedOptions.composition,
        contextMenu: {
          ...sharedOptions.composition?.contextMenu,
          onClose: () => {
            if (contextMenuSlotRef.current != null) {
              clearMutationContextMenuSlot({
                menuRootRef: contextMenuRootRef,
                slotElement: contextMenuSlotRef.current,
              });
            }
            addLog('context menu: closed');
          },
          onOpen: (item) => {
            addLog(`context menu: opened for ${item.path}`);
          },
          render: (item: ContextMenuItem, context: ContextMenuOpenContext) => {
            contextMenuSlotRef.current ??= document.createElement('div');
            renderMutationContextMenuSlot({
              context,
              item,
              menuRootRef: contextMenuRootRef,
              onDelete: () => {
                runMutation(`delete ${item.path}`, (tree) => {
                  tree.remove(
                    item.path,
                    item.kind === 'directory' ? { recursive: true } : undefined
                  );
                });
              },
              onRename: () => {
                const tree = treeRef.current;
                if (tree == null) {
                  addLog(`error: tree not ready for rename ${item.path}`);
                  return;
                }

                const started = tree.startRenaming(item.path);
                addLog(
                  started
                    ? `rename: started for ${item.path}`
                    : `rename: unavailable for ${item.path}`
                );
              },
              slotElement: contextMenuSlotRef.current,
            });
            return contextMenuSlotRef.current;
          },
        },
        header: {
          ...sharedOptions.composition?.header,
          render: () => {
            const header = document.createElement('div');
            header.style.alignItems = 'center';
            header.style.display = 'flex';
            header.style.gap = '12px';
            header.style.padding = '8px 12px';

            const label = document.createElement('strong');
            label.textContent = 'Trees demo header';
            header.append(label);

            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = 'Log header action';
            button.addEventListener('click', () => {
              addLog('header action: clicked');
            });
            header.append(button);

            return header;
          },
        },
      },
      dragAndDrop: {
        onDropComplete: (event) => {
          addLog(formatDropResult(event));
        },
        onDropError: (error, event) => {
          const targetLabel =
            event.target.kind === 'root'
              ? 'root'
              : (event.target.directoryPath ?? 'unknown');
          addLog(`drop:error ${error} -> ${targetLabel}`);
        },
        openOnDropDelay: 800,
      },
      id: `trees-dev-main-${workloadData.selectedWorkload.name}`,
      onSearchChange: (value) => {
        addLog(`search: ${value ?? '<closed>'}`);
      },
      onSelectionChange: handleSelectionChange,
      preparedInput,
      renaming: {
        onError: (error) => {
          addLog(`rename:error ${error}`);
        },
        onRename: (event) => {
          addLog(
            `rename:commit ${event.sourcePath} -> ${event.destinationPath}`
          );
        },
      },
      renderRowDecoration: ({ item }) =>
        item.path.endsWith('.ts') === true
          ? { text: 'TS', title: 'TypeScript file' }
          : null,
    };
  }, [
    addLog,
    handleSelectionChange,
    preparedInput,
    runMutation,
    sharedOptions,
    workloadData.selectedWorkload.name,
  ]);
  const activeIcons = iconMode === 'custom' ? DEMO_FILE_TREE_ICONS : iconMode;
  const upgradeDataUrl = workloadData.upgradeDataUrl;

  // Runs the gzip → decompress → resetPaths pipeline for a given tree. Used on
  // initial mount and whenever the user asks to reset a tree that started as a
  // server-side preview. We deliberately don't keep the parsed path arrays
  // alive after handing them to the file tree — that retention was ~115 MB on
  // AOSP and pushed iOS WKWebView over its per-tab memory cap.
  const runUpgrade = useCallback(
    (fileTree: FileTree): AbortController | null => {
      if (upgradeDataUrl == null) {
        return null;
      }

      const abortController = new AbortController();
      upgradeAbortRef.current?.abort();
      upgradeAbortRef.current = abortController;
      addLog(`upgrade: fetching ${upgradeDataUrl}`);
      const fetchStartedAt = performance.now();
      void fetchUpgradePayload(upgradeDataUrl, abortController.signal)
        .then(({ allExpandedPaths, paths: fullPaths }) => {
          if (abortController.signal.aborted || treeRef.current !== fileTree) {
            return;
          }

          const fetchedAt = performance.now();
          addLog(
            `upgrade: fetched ${fullPaths.length.toLocaleString()} paths + ${allExpandedPaths.length.toLocaleString()} expandable folders in ${Math.round(fetchedAt - fetchStartedAt).toString()}ms`
          );
          fileTree.resetPaths(fullPaths, {
            initialExpandedPaths:
              expansionMode === 'all' ? allExpandedPaths : [],
            preparedInput: createPresortedPreparedInput(fullPaths),
          });
          hasUpgradedRef.current = true;
          addLog(
            `upgrade: reset tree in ${Math.round(performance.now() - fetchedAt).toString()}ms`
          );
        })
        .catch((error: unknown) => {
          if (abortController.signal.aborted) {
            return;
          }

          addLog(
            `upgrade:error ${error instanceof Error ? error.message : String(error)}`
          );
        });
      return abortController;
    },
    [addLog, expansionMode, upgradeDataUrl]
  );

  const handleTreeReady = useCallback(
    (fileTree: FileTree | null) => {
      mutationUnsubscribeRef.current?.();
      mutationUnsubscribeRef.current = null;
      upgradeAbortRef.current?.abort();
      upgradeAbortRef.current = null;
      hasUpgradedRef.current = false;
      treeRef.current = fileTree;
      if (fileTree == null) {
        return;
      }

      mutationUnsubscribeRef.current = fileTree.onMutation('*', (event) => {
        addLog(formatMutationEvent(event));
      });

      runUpgrade(fileTree);
    },
    [addLog, runUpgrade]
  );

  useEffect(() => {
    treeRef.current?.setIcons(activeIcons);
  }, [activeIcons]);

  const handleAddFile = useCallback(() => {
    runMutation('add demo file', (tree) => {
      const firstVisibleDirectoryPath = getFirstVisibleFileParentPath(tree);
      const nextPath = getAvailableMutationPath(
        tree,
        `${firstVisibleDirectoryPath}000-phase-6-demo-file.ts`
      );
      tree.add(nextPath);
    });
  }, [runMutation]);

  const handleAddFolder = useCallback(() => {
    runMutation('add demo folder', (tree) => {
      const firstVisibleDirectoryPath = getFirstVisibleDirectoryPath(tree);
      const nextPath = getAvailableMutationPath(
        tree,
        `${firstVisibleDirectoryPath}000-phase-6-demo-folder/`
      );
      tree.add(nextPath);
    });
  }, [runMutation]);

  const handleMove = useCallback(() => {
    const { moveFromPath, moveToPath } = demoTargets;
    if (moveFromPath == null || moveToPath == null) {
      addLog('move: no demo move target available');
      return;
    }

    runMutation(`move ${moveFromPath} -> ${moveToPath}`, (tree) => {
      if (tree.getItem(moveFromPath) == null) {
        addLog(`move: ${moveFromPath} is already gone; reset to retry`);
        return;
      }
      if (tree.getItem(moveToPath) != null) {
        addLog(`move: ${moveToPath} already exists; reset to retry`);
        return;
      }
      tree.move(moveFromPath, moveToPath);
    });
  }, [addLog, demoTargets, runMutation]);

  const handleBatch = useCallback(() => {
    runMutation('batch demo', (tree) => {
      const nextBatchIsBlocked = demoTargets.batchOperations.some(
        (operation) => {
          if (operation.type === 'add') {
            return tree.getItem(operation.path) != null;
          }
          if (operation.type === 'move') {
            return (
              tree.getItem(operation.from) == null ||
              tree.getItem(operation.to) != null
            );
          }
          return false;
        }
      );
      if (nextBatchIsBlocked) {
        addLog(
          'batch: current tree state no longer matches the demo assumptions; reset to retry'
        );
        return;
      }

      tree.batch(demoTargets.batchOperations);
    });
  }, [addLog, demoTargets, runMutation]);

  const handleReset = useCallback(() => {
    // For upgraded workloads we re-fetch the gzip payload instead of holding
    // the ~115 MB decoded arrays in memory — browser HTTP caching keeps this
    // snappy in practice and the transient peak is shorter-lived than the
    // steady-state retention was.
    if (upgradeDataUrl != null) {
      const tree = treeRef.current;
      if (tree == null) {
        addLog('error: tree not ready for reset demo tree');
        return;
      }

      runUpgrade(tree);
      return;
    }

    runMutation('reset demo tree', (tree) => {
      tree.resetPaths(currentPaths, { preparedInput });
    });
  }, [
    addLog,
    preparedInput,
    runMutation,
    runUpgrade,
    sharedOptions,
    upgradeDataUrl,
  ]);
  const handleSearchDocumentation = useCallback(() => {
    runSearchAction('search documentation', (tree) => {
      tree.setSearch('documentation');
    });
  }, [runSearchAction]);
  const handleSearchBootp = useCallback(() => {
    runSearchAction('search bootp', (tree) => {
      tree.setSearch('bootp');
    });
  }, [runSearchAction]);
  const handleCloseSearch = useCallback(() => {
    runSearchAction('close search', (tree) => {
      tree.closeSearch();
    });
  }, [runSearchAction]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Main Demo</h1>
        <p className="text-muted-foreground max-w-3xl text-sm leading-6">
          One hydrated tree exercises mutation APIs, built-in search, inline
          rename, drag and drop, and icon switching across the current workload.
          Change the workload, rerun the same proof actions, and keep the log
          visible while virtualization stays in place.
        </p>
        <div className="bg-muted/30 flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">Current workload</p>
              <p className="text-muted-foreground text-sm leading-6">
                {activeWorkloadSummary.label} ·{' '}
                {activeWorkloadSummary.fileCountLabel} ·{' '}
                {activeWorkloadSummary.rootCount.toLocaleString()} root
                {activeWorkloadSummary.rootCount === 1 ? '' : 's'} ·{' '}
                {expansionMode === 'all'
                  ? 'fully expanded'
                  : expansionMode === 'collapsed'
                    ? 'fully collapsed'
                    : 'workload defaults'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={pendingWorkloadName}
                onValueChange={handleWorkloadChange}
              >
                <SelectTrigger
                  className="w-full min-w-[240px] sm:w-[320px]"
                  size="sm"
                  disabled={isNavigatingDemoState}
                  data-tree-demo-workload-select="true"
                >
                  <SelectValue placeholder="Select a workload" />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectGroup>
                    <SelectLabel>Available workloads</SelectLabel>
                    {workloadOptions.map((workload) => (
                      <SelectItem key={workload.name} value={workload.name}>
                        {workload.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {isNavigatingDemoState ? (
                <span className="text-muted-foreground text-xs">Loading…</span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-sm font-medium"
              aria-pressed={expansionMode === 'all'}
              disabled={isNavigatingDemoState || expansionMode === 'all'}
              data-tree-demo-expansion-action="expand-all"
              onClick={() => {
                handleExpansionChange('all');
              }}
            >
              Expand all
            </button>
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-sm font-medium"
              aria-pressed={expansionMode === 'collapsed'}
              disabled={isNavigatingDemoState || expansionMode === 'collapsed'}
              data-tree-demo-expansion-action="collapse-all"
              onClick={() => {
                handleExpansionChange('collapsed');
              }}
            >
              Collapse all
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            data-tree-demo-mutation-action="add-file"
            onClick={handleAddFile}
          >
            Add demo file
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            data-tree-demo-mutation-action="add-folder"
            onClick={handleAddFolder}
          >
            Add demo folder
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            data-tree-demo-mutation-action="move"
            onClick={handleMove}
          >
            Move demo file
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            data-tree-demo-mutation-action="batch"
            onClick={handleBatch}
          >
            Batch mutations
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            data-tree-demo-mutation-action="reset"
            onClick={handleReset}
          >
            Reset tree
          </button>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            data-tree-demo-search-action="documentation"
            onClick={handleSearchDocumentation}
          >
            Search “documentation”
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            data-tree-demo-search-action="bootp"
            onClick={handleSearchBootp}
          >
            Search “bootp”
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            data-tree-demo-search-action="close"
            onClick={handleCloseSearch}
          >
            Close search
          </button>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            aria-pressed={iconMode === 'complete'}
            onClick={() => {
              setIconMode('complete');
              addLog('icons: complete');
            }}
          >
            Show Complete icons
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            aria-pressed={iconMode === 'standard'}
            onClick={() => {
              setIconMode('standard');
              addLog('icons: standard');
            }}
          >
            Show Standard icons
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            aria-pressed={iconMode === 'minimal'}
            onClick={() => {
              setIconMode('minimal');
              addLog('icons: minimal');
            }}
          >
            Show Minimal icons
          </button>
        </div>
      </header>

      <HydratedMainDemoController
        onTreeReady={handleTreeReady}
        options={options}
        treeMountId={treeMountId}
      />
      {children}
      <StateLog entries={log} />
    </div>
  );
}
