'use client';

import {
  FileTree,
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
  REVEAL_DEMO_BATCH_FAILURE_PATH,
  REVEAL_DEMO_ROOT_PATHS,
  REVEAL_DEMO_SNAPSHOTS,
} from '../_lib/revealLoadingDemoData';
import { FILE_TREE_PROOF_VIEWPORT_HEIGHT } from '../_lib/workloadMeta';
import { ImperativeFileTreeMount } from './ImperativeFileTreeMount';

const INFO_PATHS = [
  'apps/',
  'packages/',
  REVEAL_DEMO_BATCH_FAILURE_PATH,
  'packages/trees/',
] as const;

const REVEAL_PREPARED_INPUT = createPresortedPreparedInput(
  REVEAL_DEMO_ROOT_PATHS
);

function getDirectoryHandle(
  tree: FileTree,
  path: string
): FileTreeDirectoryHandle | null {
  const item = tree.getItem(path);
  if (item == null || !item.isDirectory()) {
    return null;
  }
  return item as FileTreeDirectoryHandle;
}

export function RevealLoadingDemoClient({
  mountId,
  payloadHtml,
}: {
  mountId: string;
  payloadHtml: string;
}) {
  const { addLog, log } = useStateLog();
  const treeRef = useRef<FileTree | null>(null);
  const revealUnsubscribeRef = useRef<(() => void) | null>(null);
  const treeSubscribeRef = useRef<(() => void) | null>(null);
  const revealBatchCallCountRef = useRef(0);
  const [revision, setRevision] = useState(0);

  const options = useMemo<FileTreeOptions>(
    () => ({
      flattenEmptyDirectories: false,
      id: 'trees-dev-reveal-demo',
      loading: {
        mode: 'reveal',
        policy: {
          maxSpeculativeBatchSize: 3,
        },
        source: {
          loadDirectories(paths) {
            revealBatchCallCountRef.current += 1;
            addLog(`source:batch [${paths.join(', ')}]`);
            if (revealBatchCallCountRef.current > 20) {
              throw new Error('Reveal demo loop guard tripped.');
            }
            return Promise.resolve(
              paths.map((path) => {
                if (path === REVEAL_DEMO_BATCH_FAILURE_PATH) {
                  return {
                    errorMessage:
                      'Background prefetch intentionally fails once here. Expand the folder to trigger the explicit foreground retry.',
                  } satisfies FileTreeRevealDirectoryBatchResult;
                }

                const snapshot =
                  REVEAL_DEMO_SNAPSHOTS[
                    path as keyof typeof REVEAL_DEMO_SNAPSHOTS
                  ];
                return snapshot == null
                  ? ({
                      errorMessage: `Unknown reveal demo path: ${path}`,
                    } satisfies FileTreeRevealDirectoryBatchResult)
                  : ({ snapshot } satisfies FileTreeRevealDirectoryBatchResult);
              })
            );
          },
          loadDirectory(path) {
            addLog(`source:single ${path}`);
            const snapshot =
              REVEAL_DEMO_SNAPSHOTS[path as keyof typeof REVEAL_DEMO_SNAPSHOTS];
            if (snapshot == null) {
              throw new Error(`Unknown reveal demo path: ${path}`);
            }
            return Promise.resolve(snapshot as FileTreeRevealDirectorySnapshot);
          },
        },
      },

      paths: REVEAL_DEMO_ROOT_PATHS,
      preparedInput: REVEAL_PREPARED_INPUT,
      search: true,
      viewportHeight: FILE_TREE_PROOF_VIEWPORT_HEIGHT,
    }),
    [addLog]
  );

  const handleTreeReady = useCallback(
    (tree: FileTree | null) => {
      revealUnsubscribeRef.current?.();
      revealUnsubscribeRef.current = null;
      treeSubscribeRef.current?.();
      treeSubscribeRef.current = null;
      treeRef.current = tree;
      if (tree == null) {
        return;
      }

      revealUnsubscribeRef.current = tree.onRevealLoading('*', (event) => {
        addLog(
          `reveal:${event.type} ${event.path} -> ${event.info.state}${event.info.errorMessage == null ? '' : ` (${event.info.errorMessage})`}`
        );
      });
      treeSubscribeRef.current = tree.subscribe(() => {
        setRevision((value) => value + 1);
      });
    },
    [addLog]
  );

  useEffect(() => {
    return () => {
      revealUnsubscribeRef.current?.();
      treeSubscribeRef.current?.();
    };
  }, []);

  const revealInfo = INFO_PATHS.map((path) => ({
    info: treeRef.current?.getRevealLoadingInfo(path) ?? null,
    path,
  }));

  const runTreeAction = useCallback(
    (label: string, action: (tree: FileTree) => void) => {
      const tree = treeRef.current;
      if (tree == null) {
        addLog(`error:${label} tree not ready`);
        return;
      }

      action(tree);
      setRevision((value) => value + 1);
    },
    [addLog]
  );

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] xl:items-start">
      <ExampleCard
        className="max-w-none"
        title="Reveal loading"
        description="The tree starts with a few root directories whose children are unknown. The overscanned window speculative-prefetches visible directories in bounded batches, while explicit expand uses single-directory foreground loads. The packages/path-store folder intentionally fails in the background batch and succeeds when explicitly expanded."
      >
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            className="rounded-sm border px-2 py-1"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => {
              runTreeAction('expand packages', (tree) => {
                getDirectoryHandle(tree, 'packages/')?.expand();
              });
            }}
          >
            Expand packages/
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => {
              runTreeAction('expand retry path', (tree) => {
                getDirectoryHandle(
                  tree,
                  REVEAL_DEMO_BATCH_FAILURE_PATH
                )?.expand();
              });
            }}
          >
            Expand packages/path-store/
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => {
              addLog('reveal: reset demo');
              revealBatchCallCountRef.current = 0;
              runTreeAction('reset reveal demo', (tree) => {
                tree.resetPaths(REVEAL_DEMO_ROOT_PATHS, {
                  preparedInput: REVEAL_PREPARED_INPUT,
                });
              });
            }}
          >
            Reset reveal demo
          </button>
        </div>
        <ImperativeFileTreeMount
          height={FILE_TREE_PROOF_VIEWPORT_HEIGHT}
          mountId={mountId}
          mountMode="hydrate"
          onTreeReady={handleTreeReady}
          options={options}
          payloadHtml={payloadHtml}
        />
      </ExampleCard>

      <div className="space-y-6">
        <ExampleCard
          className="max-w-none"
          title="Tracked reveal info"
          description="These rows expose the public reveal query surface. Packages/path-store fails in the background batch, then switches back to loading and loaded after an explicit expand triggers the foreground retry."
        >
          <div className="space-y-2 text-xs">
            {revealInfo.map(({ info, path }) => (
              <div
                key={`${path}-${revision}`}
                className="rounded-sm border px-2 py-2"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <strong>{path}</strong>
                <div className="text-muted-foreground mt-1">
                  {info == null
                    ? 'null'
                    : `state=${info.state}${info.knownChildCount == null ? '' : ` knownChildCount=${String(info.knownChildCount)}`}${info.errorMessage == null ? '' : ` error=${info.errorMessage}`}`}
                </div>
              </div>
            ))}
          </div>
        </ExampleCard>

        <ExampleCard
          className="max-w-none"
          title="Reveal event log"
          description="Watch the public reveal lifecycle events and the source request traces as the demo prefetches, fails the background batch for packages/path-store, and then succeeds on explicit retry."
        >
          <StateLog entries={log} />
        </ExampleCard>
      </div>
    </div>
  );
}
