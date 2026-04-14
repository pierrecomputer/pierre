'use client';

import {
  PathStoreFileTree,
  type PathStoreFileTreeOptions,
  type PathStoreTreesContextMenuItem,
  type PathStoreTreesContextMenuOpenContext,
  type PathStoreTreesMutationEvent,
} from '@pierre/trees/path-store';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ExampleCard } from '../_components/ExampleCard';
import { StateLog, useStateLog } from '../_components/StateLog';
import { pathStoreCapabilityMatrix } from './capabilityMatrix';
import { createPresortedPreparedInput } from './createPresortedPreparedInput';
import { PATH_STORE_CUSTOM_ICONS } from './pathStoreDemoIcons';

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
  addFilePath: string;
  addFolderPath: string;
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
  paths: readonly string[]
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
  const firstDirectoryPath = sortedDirectoryPaths[0] ?? '';
  const filePaths = paths.filter((path) => !path.endsWith('/'));
  const addFilePath = getUniquePath(
    `${firstDirectoryPath}phase-6-demo-file.ts`,
    existingPaths
  );
  const addFolderPath = getUniquePath(
    `${firstDirectoryPath}phase-6-demo-folder/`,
    existingPaths
  );

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
    addFilePath,
    addFolderPath,
    batchOperations,
    moveFromPath,
    moveToPath,
  };
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
    () => createMutationDemoTargets(sharedOptions.paths),
    [sharedOptions.paths]
  );
  const handleSelectionChange = useCallback(
    (selectedPaths: readonly string[]) => {
      addLog(`selected: [${selectedPaths.join(', ')}]`);
    },
    [addLog]
  );

  useEffect(() => {
    return () => {
      mutationUnsubscribeRef.current?.();
      mutationUnsubscribeRef.current = null;
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
            addLog('context menu: closed');
          },
          onOpen: (item) => {
            addLog(`context menu: opened for ${item.path}`);
          },
          render: (
            item: PathStoreTreesContextMenuItem,
            context: PathStoreTreesContextMenuOpenContext
          ) => {
            const menu = document.createElement('div');
            menu.dataset.testPathStoreMutationMenu = item.path;
            menu.dataset.testContextMenu = 'true';
            menu.style.display = 'grid';
            menu.style.gap = '8px';
            menu.style.minWidth = '220px';
            menu.style.padding = '8px';
            menu.style.border = '1px solid var(--color-border, #666)';
            menu.style.borderRadius = '8px';
            menu.style.background = 'var(--color-bg, #fff)';
            menu.style.boxShadow = '0 6px 18px rgba(0, 0, 0, 0.2)';

            const label = document.createElement('div');
            label.textContent = `${item.kind === 'directory' ? 'Folder' : 'File'}: ${item.path}`;
            menu.append(label);

            const renameButton = document.createElement('button');
            renameButton.type = 'button';
            renameButton.dataset.pathStoreMenuAction = 'rename';
            renameButton.textContent = 'Rename';
            renameButton.addEventListener('click', () => {
              const nextBasename = window.prompt(
                'Rename path',
                getPathBasename(item.path)
              );
              if (nextBasename == null || nextBasename.trim().length === 0) {
                addLog(`rename: cancelled for ${item.path}`);
                context.close();
                return;
              }

              runMutation(`rename ${item.path}`, (tree) => {
                const nextPath = renamePathSameParent(item.path, nextBasename);
                tree.move(item.path, nextPath);
              });
              context.close();
            });
            menu.append(renameButton);

            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.dataset.pathStoreMenuAction = 'delete';
            deleteButton.textContent = 'Delete';
            deleteButton.addEventListener('click', () => {
              runMutation(`delete ${item.path}`, (tree) => {
                tree.remove(
                  item.path,
                  item.kind === 'directory' ? { recursive: true } : undefined
                );
              });
              context.close();
            });
            menu.append(deleteButton);

            const closeButton = document.createElement('button');
            closeButton.type = 'button';
            closeButton.dataset.pathStoreMenuAction = 'close';
            closeButton.textContent = 'Close';
            closeButton.addEventListener('click', () => {
              context.close();
            });
            menu.append(closeButton);
            return menu;
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
            label.textContent = 'Phase 6 mutation header';
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
      id: 'pst-phase6-mutations',
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
    runMutation(`add ${demoTargets.addFilePath}`, (tree) => {
      if (tree.getItem(demoTargets.addFilePath) != null) {
        addLog(`add: ${demoTargets.addFilePath} already exists`);
        return;
      }
      tree.add(demoTargets.addFilePath);
    });
  }, [addLog, demoTargets.addFilePath, runMutation]);

  const handleAddFolder = useCallback(() => {
    runMutation(`add ${demoTargets.addFolderPath}`, (tree) => {
      if (tree.getItem(demoTargets.addFolderPath) != null) {
        addLog(`add: ${demoTargets.addFolderPath} already exists`);
        return;
      }
      tree.add(demoTargets.addFolderPath);
    });
  }, [addLog, demoTargets.addFolderPath, runMutation]);

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

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Path-store lane · provisional
        </p>
        <h1 className="text-2xl font-bold">
          Mutation API + Context Menu Proof + Icon Sets
        </h1>
        <p className="text-muted-foreground max-w-3xl text-sm leading-6">
          Phase 6 turns the path-store lane into a mutation-first tree: use the
          shared handle to add, move, batch, and reset paths, use the existing
          context menu for low-cost delete and narrow rename proof, and watch
          the live tree plus mutation log stay coherent under virtualization.
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
        description="Use the buttons above to exercise add, move, batch, and coarse reset operations. Right-click or press Shift+F10 on a row to use the low-cost delete and narrow rename proof path. The mutation log should show add/remove/move/batch/reset events while focus, selection, and virtualization stay coherent."
        onTreeReady={handleTreeReady}
        options={options}
        title="Mutation-first tree proof"
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
