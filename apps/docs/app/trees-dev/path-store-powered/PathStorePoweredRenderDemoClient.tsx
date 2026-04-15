'use client';

import {
  PathStoreFileTree,
  type PathStoreFileTreeOptions,
  type PathStoreTreesContextMenuItem,
  type PathStoreTreesContextMenuOpenContext,
  type PathStoreTreesMutationEvent,
} from '@pierre/trees/path-store';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root as ReactDomRoot } from 'react-dom/client';

import { ExampleCard } from '../_components/ExampleCard';
import { StateLog, useStateLog } from '../_components/StateLog';
import { pathStoreCapabilityMatrix } from './capabilityMatrix';
import { createPresortedPreparedInput } from './createPresortedPreparedInput';
import { PATH_STORE_CUSTOM_ICONS } from './pathStoreDemoIcons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface SharedDemoOptions extends Omit<
  PathStoreFileTreeOptions,
  'id' | 'preparedInput'
> {}

interface PathStorePoweredRenderDemoClientProps {
  containerHtml: string;
  sharedOptions: SharedDemoOptions;
}

type PathStoreMutationOperation =
  | { path: string; type: 'add' }
  | { from: string; to: string; type: 'move' };

interface PathStoreMutationDemoTargets {
  batchOperations: readonly PathStoreMutationOperation[];
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
): PathStoreMutationDemoTargets {
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
  const batchOperations: PathStoreMutationOperation[] = [
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

function getFirstVisibleDirectoryPath(tree: PathStoreFileTree): string {
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

function getFirstVisibleFileParentPath(tree: PathStoreFileTree): string {
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

function getAvailableMutationPath(
  tree: PathStoreFileTree,
  basePath: string
): string {
  let candidatePath = basePath;
  let suffix = 1;
  while (tree.getItem(candidatePath) != null) {
    candidatePath = getSuffixedPath(basePath, suffix);
    suffix += 1;
  }
  return candidatePath;
}

function formatMutationEvent(event: PathStoreTreesMutationEvent): string {
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

function PathStoreMutationContextMenu({
  item,
  context,
  onDelete,
  onRename,
}: {
  item: PathStoreTreesContextMenuItem;
  context: Pick<PathStoreTreesContextMenuOpenContext, 'close' | 'restoreFocus'>;
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
          style={{
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: 'none',
            border: 0,
            padding: 0,
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-test-context-menu="true"
        data-path-store-context-menu-root="true"
        align="start"
        side="right"
        sideOffset={8}
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
  item: PathStoreTreesContextMenuItem;
  menuRootRef: { current: ReactDomRoot | null };
  onDelete: () => void;
  onRename: () => void;
  slotElement: HTMLDivElement;
  context: Pick<PathStoreTreesContextMenuOpenContext, 'close' | 'restoreFocus'>;
}): void {
  menuRootRef.current ??= createRoot(slotElement);
  slotElement.style.display = 'block';
  menuRootRef.current.render(
    <PathStoreMutationContextMenu
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
  if (menuRootRef.current == null) {
    return;
  }

  if (unmount) {
    menuRootRef.current.unmount();
    menuRootRef.current = null;
  } else {
    menuRootRef.current.render(null);
  }
  slotElement.style.display = 'none';
}

const HydratedPathStoreExample = memo(function HydratedPathStoreExample({
  containerHtml,
  description,
  onTreeReady,
  options,
  title,
}: {
  containerHtml: string;
  description: string;
  onTreeReady: (fileTree: PathStoreFileTree | null) => void;
  options: Omit<PathStoreFileTreeOptions, 'icons'>;
  title: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (node == null) {
      return;
    }

    const fileTree = new PathStoreFileTree(options);
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
  }, [containerHtml, onTreeReady, options]);

  return (
    <ExampleCard title={title} description={description}>
      <div
        ref={ref}
        style={{ height: `${String(options.viewportHeight ?? 420)}px` }}
        dangerouslySetInnerHTML={{ __html: containerHtml }}
        suppressHydrationWarning
      />
    </ExampleCard>
  );
});

export function PathStorePoweredRenderDemoClient({
  containerHtml,
  sharedOptions,
}: PathStorePoweredRenderDemoClientProps) {
  const { addLog, log } = useStateLog();
  const contextMenuRootRef = useRef<ReactDomRoot | null>(null);
  const contextMenuSlotRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<PathStoreFileTree | null>(null);
  const mutationUnsubscribeRef = useRef<(() => void) | null>(null);
  const [iconMode, setIconMode] = useState<
    'complete' | 'custom' | 'minimal' | 'standard'
  >('complete');
  const preparedInput = useMemo(
    () => createPresortedPreparedInput(sharedOptions.paths),
    [sharedOptions.paths]
  );
  const demoTargets = useMemo(
    () =>
      createMutationDemoTargets(
        sharedOptions.paths,
        sharedOptions.initialExpandedPaths
      ),
    [sharedOptions.initialExpandedPaths, sharedOptions.paths]
  );
  const handleSelectionChange = useCallback(
    (selectedPaths: readonly string[]) => {
      addLog(`selected: [${selectedPaths.join(', ')}]`);
    },
    [addLog]
  );
  const runSearchAction = useCallback(
    (label: string, action: (tree: PathStoreFileTree) => void): void => {
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
    (label: string, mutate: (tree: PathStoreFileTree) => void): void => {
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

  const options = useMemo<Omit<PathStoreFileTreeOptions, 'icons'>>(
    () => ({
      ...sharedOptions,
      composition: {
        ...sharedOptions.composition,
        contextMenu: {
          enabled: true,
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
          render: (
            item: PathStoreTreesContextMenuItem,
            context: PathStoreTreesContextMenuOpenContext
          ) => {
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
            label.textContent = 'Phase 8 path-store header';
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
      id: 'pst-phase8-renaming',
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
      onSearchChange: (value) => {
        addLog(`search: ${value ?? '<closed>'}`);
      },
      onSelectionChange: handleSelectionChange,
      preparedInput,
      renderRowDecoration: ({ item }) =>
        item.path.endsWith('.ts') === true
          ? { text: 'TS', title: 'TypeScript file' }
          : null,
    }),
    [addLog, handleSelectionChange, preparedInput, runMutation, sharedOptions]
  );
  const activeIcons =
    iconMode === 'custom' ? PATH_STORE_CUSTOM_ICONS : iconMode;
  const handleTreeReady = useCallback(
    (fileTree: PathStoreFileTree | null) => {
      mutationUnsubscribeRef.current?.();
      mutationUnsubscribeRef.current = null;
      treeRef.current = fileTree;
      if (fileTree == null) {
        return;
      }

      mutationUnsubscribeRef.current = fileTree.onMutation('*', (event) => {
        addLog(formatMutationEvent(event));
      });
    },
    [addLog]
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
    if (demoTargets.moveFromPath == null || demoTargets.moveToPath == null) {
      addLog('move: no demo move target available');
      return;
    }

    runMutation(
      `move ${demoTargets.moveFromPath} -> ${demoTargets.moveToPath}`,
      (tree) => {
        if (tree.getItem(demoTargets.moveFromPath as string) == null) {
          addLog(
            `move: ${demoTargets.moveFromPath} is already gone; reset to retry`
          );
          return;
        }
        if (tree.getItem(demoTargets.moveToPath as string) != null) {
          addLog(
            `move: ${demoTargets.moveToPath} already exists; reset to retry`
          );
          return;
        }
        tree.move(
          demoTargets.moveFromPath as string,
          demoTargets.moveToPath as string
        );
      }
    );
  }, [addLog, demoTargets.moveFromPath, demoTargets.moveToPath, runMutation]);

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
  }, [addLog, demoTargets.batchOperations, runMutation]);

  const handleReset = useCallback(() => {
    runMutation('reset demo tree', (tree) => {
      tree.resetPaths(sharedOptions.paths, { preparedInput });
    });
  }, [preparedInput, runMutation, sharedOptions.paths]);
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
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Path-store lane · provisional
        </p>
        <h1 className="text-2xl font-bold">
          Mutation API + Search + Inline Rename + Icon Sets
        </h1>
        <p className="text-muted-foreground max-w-3xl text-sm leading-6">
          Phase 6 turns the path-store lane into a mutation-first tree, and
          Phases 7 and 8 now surface baseline built-in search plus inline rename
          directly on this same demo: use the shared handle to add, move, batch,
          and reset paths, use the built-in search input or quick-search buttons
          to drive filtering, and use the existing context menu or <kbd>F2</kbd>{' '}
          for delete/rename actions while the live tree and log stay coherent
          under virtualization.
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            data-path-store-mutation-action="add-file"
            onClick={handleAddFile}
          >
            Add demo file
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            data-path-store-mutation-action="add-folder"
            onClick={handleAddFolder}
          >
            Add demo folder
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            data-path-store-mutation-action="move"
            onClick={handleMove}
          >
            Move demo file
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            data-path-store-mutation-action="batch"
            onClick={handleBatch}
          >
            Batch mutations
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            data-path-store-mutation-action="reset"
            onClick={handleReset}
          >
            Reset tree
          </button>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            data-path-store-search-action="documentation"
            onClick={handleSearchDocumentation}
          >
            Search “documentation”
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            data-path-store-search-action="bootp"
            onClick={handleSearchBootp}
          >
            Search “bootp”
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            data-path-store-search-action="close"
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

      <HydratedPathStoreExample
        containerHtml={containerHtml}
        description="Phase 7 search is instrumented directly in this main demo now, and Phase 8 inline rename now lives beside it: use the built-in search input above the tree or the quick search buttons above to drive the hide-non-matches filter, then use the mutation buttons to confirm the tree stays coherent. Right-click or press Shift+F10 on a row for delete/rename actions, or press F2 on a focused row to start inline rename."
        onTreeReady={handleTreeReady}
        options={options}
        title="Mutation + search + rename tree proof"
      />
      <StateLog entries={log} />

      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="text-lg font-semibold">Capability / phase matrix</h2>
        <p className="text-muted-foreground text-sm leading-6">
          This committed matrix keeps the migration proof surfaces explicit
          while the new lane grows feature by feature.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-3 py-2 font-medium">Current demo</th>
                <th className="px-3 py-2 font-medium">Target phase(s)</th>
                <th className="px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {pathStoreCapabilityMatrix.map((row) => (
                <tr key={row.currentDemo} className="border-t align-top">
                  <td className="px-3 py-2 font-medium">{row.currentDemo}</td>
                  <td className="px-3 py-2">
                    {row.targetPhases
                      .map((phase) => `P${String(phase)}`)
                      .join(', ')}
                  </td>
                  <td className="text-muted-foreground px-3 py-2">
                    {row.notes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
