'use client';

import {
  FileTree,
  type FileTreeDropResult,
  type FileTreeMutationEvent,
} from '@pierre/trees';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ExampleCard } from '../_components/ExampleCard';
import { StateLog, useStateLog } from '../_components/StateLog';
import type { FileTreePathOptions } from '@/lib/fileTreePathOptions';

function formatMutationEvent(event: FileTreeMutationEvent): string {
  switch (event.operation) {
    case 'add':
      return `mutation:add ${event.path}`;
    case 'remove':
      return `mutation:remove ${event.path}`;
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

interface DragAndDropDemoClientProps {
  containerHtml: string;
  sharedOptions: Omit<FileTreePathOptions, 'dragAndDrop' | 'id'>;
}

export function DragAndDropDemoClient({
  containerHtml,
  sharedOptions,
}: DragAndDropDemoClientProps) {
  const { addLog, log } = useStateLog();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [blockReadmeDrag, setBlockReadmeDrag] = useState(false);
  const [blockSrcLibDrop, setBlockSrcLibDrop] = useState(false);

  const options = useMemo<FileTreePathOptions>(
    () => ({
      ...sharedOptions,
      dragAndDrop: {
        canDrag: (paths) => !blockReadmeDrag || !paths.includes('README.md'),
        canDrop: (event) => {
          if (!blockSrcLibDrop) {
            return true;
          }

          return event.target.directoryPath !== 'src/lib/';
        },
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
      id: 'trees-drag-and-drop',
      onSearchChange: (value) => {
        addLog(`search:${value ?? '<closed>'}`);
      },
    }),
    [addLog, blockReadmeDrag, blockSrcLibDrop, sharedOptions]
  );

  useEffect(() => {
    const node = mountRef.current;
    if (node == null) {
      return;
    }

    const fileTree = new FileTree(options);
    const unsubscribe = fileTree.onMutation('*', (event) => {
      addLog(formatMutationEvent(event));
    });
    const fileTreeContainer = node.querySelector('file-tree-container');
    if (fileTreeContainer instanceof HTMLElement) {
      fileTree.hydrate({ fileTreeContainer });
    } else {
      node.innerHTML = '';
      fileTree.render({ containerWrapper: node });
    }

    return () => {
      unsubscribe();
      fileTree.cleanUp();
    };
  }, [addLog, containerHtml, options]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Drag and Drop</h1>
        <p className="text-muted-foreground max-w-3xl text-sm leading-6">
          Pointer and touch drag and drop now runs on the same mutation-first
          tree as search, rename, and runtime resets. Drops resolve to canonical
          folder paths and commit through the built-in move or batch APIs.
        </p>
      </header>

      <ExampleCard
        title="Hydrated drag-and-drop tree"
        description="Drag with a mouse or long-press touch. Active filtered search blocks drag starts, hovering a collapsed folder auto-opens it, and flattened path segments target their exact canonical folder path."
        controls={
          <div className="flex flex-col gap-2 text-xs leading-5">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={blockReadmeDrag}
                onChange={(event) => {
                  setBlockReadmeDrag(event.currentTarget.checked);
                }}
              />
              Block dragging README.md
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={blockSrcLibDrop}
                onChange={(event) => {
                  setBlockSrcLibDrop(event.currentTarget.checked);
                }}
              />
              Block drops into src/lib/
            </label>
            <p className="text-muted-foreground">
              The log below shows both mutation events and drop observer hooks
              so the demo stays path-first and mutation-first.
            </p>
          </div>
        }
        footer={
          <StateLog
            entries={log}
            className="mt-3 h-32 overflow-y-auto rounded border p-2 font-mono text-xs"
          />
        }
      >
        <div
          ref={mountRef}
          style={{ height: '460px' }}
          dangerouslySetInnerHTML={{ __html: containerHtml }}
          suppressHydrationWarning
        />
      </ExampleCard>
    </div>
  );
}
