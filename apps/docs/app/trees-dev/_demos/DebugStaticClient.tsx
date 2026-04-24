'use client';

import {
  FileTree,
  FileTreeController,
  type FileTreeControllerOptions,
  type FileTreeDirectoryHandle,
  type FileTreeOptions,
} from '@pierre/trees';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ExampleCard } from '../_components/ExampleCard';
import { StateLog, useStateLog } from '../_components/StateLog';
import { createPresortedPreparedInput } from '../_lib/createPresortedPreparedInput';
import {
  DEBUG_STATIC_EXPAND_PATH,
  DEBUG_STATIC_FOCUS_PATH,
  DEBUG_STATIC_PATHS,
} from '../_lib/debugStaticData';
import { FILE_TREE_PROOF_VIEWPORT_HEIGHT } from '../_lib/workloadMeta';
import { ImperativeFileTreeMount } from './ImperativeFileTreeMount';

const DEBUG_STATIC_PREPARED_INPUT =
  createPresortedPreparedInput(DEBUG_STATIC_PATHS);

function getRenderedTreePaths(tree: FileTree | null): string[] {
  const shadowRoot = tree?.getFileTreeContainer()?.shadowRoot;
  if (shadowRoot == null) {
    return [];
  }

  return Array.from(
    shadowRoot.querySelectorAll<HTMLElement>('[data-item-path]')
  )
    .map((element) => element.dataset.itemPath ?? null)
    .filter((path): path is string => path != null);
}

// The FileTree wrapper exposes additive item selection, so this helper clears the
// current wrapper selection first to mirror the controller's selectOnlyPath API.
function selectOnlyInTree(tree: FileTree, path: string): void {
  for (const selectedPath of tree.getSelectedPaths()) {
    tree.getItem(selectedPath)?.deselect();
  }
  tree.getItem(path)?.select();
}

export function DebugStaticClient({
  mountId,
  mountMode,
  payloadHtml = '',
}: {
  mountId: string;
  mountMode: 'hydrate' | 'render';
  payloadHtml?: string;
}) {
  const { addLog, log } = useStateLog();
  const controllerRef = useRef<FileTreeController | null>(null);
  const controllerUnsubscribeRef = useRef<(() => void) | null>(null);
  const treeRef = useRef<FileTree | null>(null);
  const treeUnsubscribeRef = useRef<(() => void) | null>(null);
  const [revision, setRevision] = useState(0);

  const sharedOptions = useMemo<FileTreeControllerOptions>(
    () => ({
      flattenEmptyDirectories: false,
      paths: DEBUG_STATIC_PATHS,
      preparedInput: DEBUG_STATIC_PREPARED_INPUT,
    }),
    []
  );

  const treeOptions = useMemo<FileTreeOptions>(
    () => ({
      ...sharedOptions,
      id: 'trees-dev-debug-static',
      viewportHeight: FILE_TREE_PROOF_VIEWPORT_HEIGHT,
    }),
    [sharedOptions]
  );

  useEffect(() => {
    const controller = new FileTreeController(sharedOptions);
    controllerRef.current = controller;
    controllerUnsubscribeRef.current = controller.subscribe(() => {
      addLog('controller:update');
      setRevision((value) => value + 1);
    });

    return () => {
      controllerUnsubscribeRef.current?.();
      controllerUnsubscribeRef.current = null;
      controller.destroy();
      controllerRef.current = null;
    };
  }, [addLog, sharedOptions]);

  const handleTreeReady = useCallback(
    (tree: FileTree | null) => {
      treeUnsubscribeRef.current?.();
      treeUnsubscribeRef.current = null;
      treeRef.current = tree;
      if (tree == null) {
        setRevision((value) => value + 1);
        return;
      }

      treeUnsubscribeRef.current = tree.subscribe(() => {
        addLog('tree:update');
        setRevision((value) => value + 1);
      });
      setRevision((value) => value + 1);
    },
    [addLog]
  );

  useEffect(() => {
    return () => {
      treeUnsubscribeRef.current?.();
      treeUnsubscribeRef.current = null;
    };
  }, []);

  const runDualAction = useCallback(
    (
      label: string,
      action: {
        controller: (controller: FileTreeController) => void;
        tree: (tree: FileTree) => void;
      }
    ) => {
      const controller = controllerRef.current;
      const tree = treeRef.current;
      if (controller == null || tree == null) {
        addLog(`error:${label} debug harness not ready`);
        return;
      }

      action.controller(controller);
      action.tree(tree);
      addLog(`action:${label}`);
      setRevision((value) => value + 1);
    },
    [addLog]
  );

  const controller = controllerRef.current;
  const tree = treeRef.current;
  const controllerVisibleRows =
    controller?.getVisibleRows(
      0,
      Math.max(0, controller.getVisibleCount() - 1)
    ) ?? [];
  const renderedTreePaths = getRenderedTreePaths(tree);
  const controllerArtItem =
    controller?.getItem(DEBUG_STATIC_EXPAND_PATH) ?? null;
  let controllerArtExpanded: boolean | null = null;
  if (controllerArtItem != null && controllerArtItem.isDirectory()) {
    controllerArtExpanded = (
      controllerArtItem as FileTreeDirectoryHandle
    ).isExpanded();
  }
  const treeArtItem = tree?.getItem(DEBUG_STATIC_EXPAND_PATH) ?? null;
  let treeArtExpanded: boolean | null = null;
  if (treeArtItem != null && treeArtItem.isDirectory()) {
    treeArtExpanded = (treeArtItem as FileTreeDirectoryHandle).isExpanded();
  }

  return (
    <div className="space-y-6">
      <ExampleCard
        title={`Debug static fixture (${mountMode})`}
        description={
          mountMode === 'hydrate'
            ? 'This tiny fixture removes loading concerns entirely. The sidecar controller shows model truth, the hydrated FileTree shows wrapper truth, and the rendered shadow DOM shows UI truth. If these disagree here, the bug is in generic render/update plumbing rather than bulk or reveal loading.'
            : 'This render-only variant skips SSR host adoption and mounts the FileTree into an empty client container. If this stays in sync while the hydrated variant does not, the hydration path is the broken layer.'
        }
      >
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            className="rounded-sm border px-2 py-1"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => {
              runDualAction('expand art', {
                controller: (nextController) => {
                  const item = nextController.getItem(DEBUG_STATIC_EXPAND_PATH);
                  if (item != null && item.isDirectory()) {
                    (item as FileTreeDirectoryHandle).expand();
                  }
                },
                tree: (nextTree) => {
                  const item = nextTree.getItem(DEBUG_STATIC_EXPAND_PATH);
                  if (item != null && item.isDirectory()) {
                    (item as FileTreeDirectoryHandle).expand();
                  }
                },
              });
            }}
          >
            Expand art/
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => {
              runDualAction('focus art/a.ts', {
                controller: (nextController) => {
                  nextController.focusPath(DEBUG_STATIC_FOCUS_PATH);
                },
                tree: (nextTree) => {
                  nextTree.focusPath(DEBUG_STATIC_FOCUS_PATH);
                },
              });
            }}
          >
            Focus art/a.ts
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => {
              runDualAction('select art/a.ts', {
                controller: (nextController) => {
                  nextController.selectOnlyPath(DEBUG_STATIC_FOCUS_PATH);
                },
                tree: (nextTree) => {
                  selectOnlyInTree(nextTree, DEBUG_STATIC_FOCUS_PATH);
                },
              });
            }}
          >
            Select art/a.ts
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => {
              const treeInstance = treeRef.current;
              if (treeInstance == null) {
                addLog('error:render live tree not ready');
                return;
              }
              const host = treeInstance.getFileTreeContainer();
              if (host == null) {
                addLog('error:render live tree host missing');
                return;
              }
              treeInstance.render({ fileTreeContainer: host });
              addLog('action:render live tree');
              setRevision((value) => value + 1);
            }}
          >
            Render live tree
          </button>
        </div>
        <ImperativeFileTreeMount
          height={FILE_TREE_PROOF_VIEWPORT_HEIGHT}
          mountId={mountId}
          mountMode={mountMode}
          onTreeReady={handleTreeReady}
          options={treeOptions}
          payloadHtml={payloadHtml}
        />
      </ExampleCard>

      <ExampleCard
        title="Controller vs wrapper vs DOM"
        description="Compare the sidecar controller's visible rows to the wrapper-facing focus/selection APIs and the actual rendered row paths in the shadow DOM. The first disagreement identifies the broken layer."
      >
        <div className="grid gap-3 text-xs md:grid-cols-3">
          <div
            className="rounded-sm border px-3 py-2"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <strong>Controller truth</strong>
            <div className="text-muted-foreground mt-1">
              visibleCount={controller?.getVisibleCount() ?? 'null'}
              <br />
              focus={controller?.getFocusedPath() ?? 'null'}
              <br />
              selection={JSON.stringify(controller?.getSelectedPaths() ?? [])}
              <br />
              rows=
              {JSON.stringify(controllerVisibleRows.map((row) => row.path))}
              <br />
              artExpanded={String(controllerArtExpanded)}
            </div>
          </div>
          <div
            className="rounded-sm border px-3 py-2"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <strong>FileTree wrapper</strong>
            <div className="text-muted-foreground mt-1">
              focus={tree?.getFocusedPath() ?? 'null'}
              <br />
              selection={JSON.stringify(tree?.getSelectedPaths() ?? [])}
              <br />
              artExpanded={String(treeArtExpanded)}
            </div>
          </div>
          <div
            className="rounded-sm border px-3 py-2"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <strong>Rendered DOM</strong>
            <div className="text-muted-foreground mt-1">
              renderedRowCount={renderedTreePaths.length}
              <br />
              rows={JSON.stringify(renderedTreePaths)}
            </div>
          </div>
        </div>
      </ExampleCard>

      <ExampleCard
        title="Static debug log"
        description="Each button dispatches the same action to the sidecar controller and the hydrated FileTree wrapper. This log makes it obvious which layer stopped reacting first."
      >
        <StateLog key={revision} entries={log} />
      </ExampleCard>
    </div>
  );
}
