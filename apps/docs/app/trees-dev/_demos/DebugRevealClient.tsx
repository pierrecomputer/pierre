'use client';

import {
  type FileTreeDirectoryHandle,
  type FileTreeOptions,
  type FileTreeRevealDirectoryBatchResult,
  type FileTreeRevealDirectorySnapshot,
} from '@pierre/trees';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ExampleCard } from '../_components/ExampleCard';
import { StateLog, useStateLog } from '../_components/StateLog';
import { createPresortedPreparedInput } from '../_lib/createPresortedPreparedInput';
import {
  DEBUG_REVEAL_ROOT_PATHS,
  DEBUG_REVEAL_SNAPSHOTS,
} from '../_lib/debugRevealData';
import { FILE_TREE_PROOF_VIEWPORT_HEIGHT } from '../_lib/workloadMeta';
import { ImperativeFileTreeMount } from './ImperativeFileTreeMount';

const INFO_PATHS = DEBUG_REVEAL_ROOT_PATHS.flatMap((rootPath) => {
  const descendantPaths = Object.keys(DEBUG_REVEAL_SNAPSHOTS).filter(
    (path) =>
      path !== rootPath && path.endsWith('/') && path.startsWith(rootPath)
  );
  return [rootPath, ...descendantPaths];
});
const DEBUG_REVEAL_PREPARED_INPUT = createPresortedPreparedInput(
  DEBUG_REVEAL_ROOT_PATHS
);
const MAX_DEBUG_REVEAL_BATCH_CALLS = 20;

function getDebugRevealSnapshot(path: string): FileTreeRevealDirectorySnapshot {
  const snapshot =
    DEBUG_REVEAL_SNAPSHOTS[path as keyof typeof DEBUG_REVEAL_SNAPSHOTS];
  if (snapshot == null) {
    throw new Error(`Unknown debug reveal path: ${path}`);
  }
  return snapshot as FileTreeRevealDirectorySnapshot;
}

function getDirectoryHandle(
  tree: import('@pierre/trees').FileTree | null,
  path: string
): FileTreeDirectoryHandle | null {
  if (tree == null) {
    return null;
  }
  const item = tree.getItem(path);
  if (item == null || !item.isDirectory()) {
    return null;
  }
  return item as FileTreeDirectoryHandle;
}

function getRenderedTreePaths(
  tree: import('@pierre/trees').FileTree | null
): string[] {
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

export function DebugRevealClient({ mountId }: { mountId: string }) {
  const { addLog, log } = useStateLog();
  const treeRef = useRef<import('@pierre/trees').FileTree | null>(null);
  const revealUnsubscribeRef = useRef<(() => void) | null>(null);
  const treeUnsubscribeRef = useRef<(() => void) | null>(null);
  const batchCallsRef = useRef<string[][]>([]);
  const singleCallsRef = useRef<string[]>([]);
  const [revision, setRevision] = useState(0);

  const recordUpdate = useCallback(() => {
    setRevision((value) => value + 1);
  }, []);

  const options = useMemo<FileTreeOptions>(() => {
    const recordBatchCall = (paths: readonly string[]) => {
      batchCallsRef.current.push([...paths]);
      addLog(`source:batch [${paths.join(', ')}]`);
      recordUpdate();
      if (batchCallsRef.current.length > MAX_DEBUG_REVEAL_BATCH_CALLS) {
        throw new Error('Debug reveal loop guard tripped.');
      }
    };
    const recordSingleCall = (path: string) => {
      singleCallsRef.current.push(path);
      addLog(`source:single ${path}`);
      recordUpdate();
    };

    return {
      flattenEmptyDirectories: false,
      id: 'trees-dev-debug-reveal',
      loading: {
        mode: 'reveal',
        policy: { maxSpeculativeBatchSize: 2 },
        source: {
          loadDirectories(paths) {
            recordBatchCall(paths);
            return Promise.resolve(
              paths.map((path) => {
                const snapshot = getDebugRevealSnapshot(path);
                return {
                  snapshot,
                } satisfies FileTreeRevealDirectoryBatchResult;
              })
            );
          },
          loadDirectory(path) {
            recordSingleCall(path);
            return Promise.resolve(getDebugRevealSnapshot(path));
          },
        },
      },
      paths: DEBUG_REVEAL_ROOT_PATHS,
      preparedInput: DEBUG_REVEAL_PREPARED_INPUT,
      viewportHeight: FILE_TREE_PROOF_VIEWPORT_HEIGHT,
    };
  }, [addLog, recordUpdate]);

  const handleTreeReady = useCallback(
    (tree: import('@pierre/trees').FileTree | null) => {
      revealUnsubscribeRef.current?.();
      revealUnsubscribeRef.current = null;
      treeUnsubscribeRef.current?.();
      treeUnsubscribeRef.current = null;
      treeRef.current = tree;
      if (tree == null) {
        recordUpdate();
        return;
      }

      revealUnsubscribeRef.current = tree.onRevealLoading('*', (event) => {
        addLog(`reveal:${event.type} ${event.path} -> ${event.info.state}`);
        recordUpdate();
      });
      treeUnsubscribeRef.current = tree.subscribe(() => {
        recordUpdate();
      });
      recordUpdate();
    },
    [addLog, recordUpdate]
  );

  useEffect(() => {
    return () => {
      revealUnsubscribeRef.current?.();
      treeUnsubscribeRef.current?.();
    };
  }, []);

  const runExpandAction = useCallback(
    (path: string) => {
      const handle = getDirectoryHandle(treeRef.current, path);
      if (handle == null) {
        addLog(`error:expand ${path} handle missing`);
        return;
      }

      handle.expand();
      addLog(`action:expand ${path}`);
      recordUpdate();
    },
    [addLog, recordUpdate]
  );

  const revealInfo = INFO_PATHS.map((path) => ({
    info: treeRef.current?.getRevealLoadingInfo(path) ?? null,
    path,
  }));
  const renderedPaths = getRenderedTreePaths(treeRef.current);

  return (
    <div className="space-y-6">
      <ExampleCard
        title="Debug reveal fixture"
        description="This tiny reveal fixture removes the heavyweight docs page and the network route. The source is an in-memory callback with a loop guard, so any repeated batch calls come from reveal scheduling itself rather than transport noise."
      >
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            className="rounded-sm border px-2 py-1"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => {
              runExpandAction('packages/');
            }}
          >
            Expand packages/
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => {
              runExpandAction('apps/');
            }}
          >
            Expand apps/
          </button>
        </div>
        <ImperativeFileTreeMount
          height={FILE_TREE_PROOF_VIEWPORT_HEIGHT}
          mountId={mountId}
          mountMode="render"
          onTreeReady={handleTreeReady}
          options={options}
        />
      </ExampleCard>

      <ExampleCard
        title="Reveal scheduling state"
        description="Watch the source call counters and current per-path reveal info. If the batch count keeps rising after the visible rows settle, the reveal scheduler is looping on its own."
      >
        <div className="grid gap-3 text-xs md:grid-cols-3">
          <div
            className="rounded-sm border px-3 py-2"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <strong>Source calls</strong>
            <div className="text-muted-foreground mt-1">
              batchCalls={batchCallsRef.current.length}
              <br />
              singleCalls={singleCallsRef.current.length}
              <br />
              batches={JSON.stringify(batchCallsRef.current)}
              <br />
              singles={JSON.stringify(singleCallsRef.current)}
            </div>
          </div>
          <div
            className="rounded-sm border px-3 py-2"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <strong>Reveal info</strong>
            <div className="text-muted-foreground mt-1">
              {revealInfo.map(({ info, path }) => (
                <div key={`${path}-${revision}`}>
                  {path}: {info == null ? 'null' : info.state}
                </div>
              ))}
            </div>
          </div>
          <div
            className="rounded-sm border px-3 py-2"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <strong>Rendered rows</strong>
            <div className="text-muted-foreground mt-1">
              {JSON.stringify(renderedPaths)}
            </div>
          </div>
        </div>
      </ExampleCard>

      <ExampleCard
        title="Reveal debug log"
        description="The log combines direct action labels, source callback traces, and public reveal lifecycle events."
      >
        <StateLog key={revision} entries={log} />
      </ExampleCard>
    </div>
  );
}
