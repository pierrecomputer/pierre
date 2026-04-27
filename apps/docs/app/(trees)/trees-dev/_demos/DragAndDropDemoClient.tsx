'use client';

import {
  FileTree,
  type FileTreeDropResult,
  type FileTreeMutationEvent,
} from '@pierre/trees';
import type { FileTreePathOptions } from '@trees/_lib/fileTreePathOptions';
import {
  type DragEvent as ReactDragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ExampleCard } from '../_components/ExampleCard';
import { StateLog, useStateLog } from '../_components/StateLog';
import { createPresortedPreparedInput } from '../_lib/createPresortedPreparedInput';

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

// Reads the tree path from a DOM drop payload and ignores empty or root-only values.
function getDroppedPath(dataTransfer: DataTransfer): string | null {
  const rawPath = dataTransfer.getData('text/plain').trim();
  if (rawPath === '') {
    return null;
  }

  const pathWithoutTrailingSlash = rawPath.endsWith('/')
    ? rawPath.slice(0, -1)
    : rawPath;
  return pathWithoutTrailingSlash === '' ? null : pathWithoutTrailingSlash;
}

// Derives the display name from a canonical tree path while leaving logs path-first.
function getFileNameFromPath(path: string): string {
  const lastSlashIndex = path.lastIndexOf('/');
  const fileName = path.slice(lastSlashIndex + 1);
  return fileName === '' ? path : fileName;
}

interface DragAndDropDemoClientProps {
  containerHtml: string;
  sharedOptions: Omit<
    FileTreePathOptions,
    'dragAndDrop' | 'id' | 'preparedInput'
  >;
}

export function DragAndDropDemoClient({
  containerHtml,
  sharedOptions,
}: DragAndDropDemoClientProps) {
  const { addLog, log } = useStateLog();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [blockReadmeDrag, setBlockReadmeDrag] = useState(false);
  const [blockSrcLibDrop, setBlockSrcLibDrop] = useState(false);
  const preparedInput = useMemo(
    () => createPresortedPreparedInput(sharedOptions.paths),
    [sharedOptions.paths]
  );
  const [lastHostDroppedFileName, setLastHostDroppedFileName] = useState<
    string | null
  >(null);

  const handleHostDropzoneDragOver = (
    event: ReactDragEvent<HTMLDivElement>
  ): void => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleHostDropzoneDrop = (
    event: ReactDragEvent<HTMLDivElement>
  ): void => {
    event.preventDefault();
    const droppedPath = getDroppedPath(event.dataTransfer);
    if (droppedPath == null) {
      return;
    }

    setLastHostDroppedFileName(getFileNameFromPath(droppedPath));
    addLog(`external-drop:${droppedPath}`);
  };

  const options = useMemo<FileTreePathOptions>(
    () => ({
      ...sharedOptions,
      preparedInput,
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
    [addLog, blockReadmeDrag, blockSrcLibDrop, preparedInput, sharedOptions]
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
          Drag tree rows inside the tree or out to a host-page dropzone.
          Internal drops commit through the built-in move APIs. External drops
          expose the dragged path through the browser&apos;s text/plain
          DataTransfer payload.
        </p>
      </header>

      <ExampleCard
        title="Hydrated drag-and-drop tree"
        description="Drag with a mouse or long-press touch. Active search blocks drag starts, collapsed folders auto-open, and flattened path segments target their canonical folder. Drop inside the tree to move paths, or on the host box below to read the full path without changing the tree."
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
        <div className="space-y-4">
          <div
            data-test-host-dropzone="true"
            onDragOver={handleHostDropzoneDragOver}
            onDrop={handleHostDropzoneDrop}
            className="bg-muted/30 space-y-2 rounded-md border border-dashed border-[var(--color-border)] p-4 text-sm leading-6"
          >
            <p className="font-medium">Host page dropzone</p>
            <p className="text-muted-foreground">
              Drop a tree row here to read the tree path with a normal DOM drop
              handler.
            </p>
            <p className="text-xs">
              <strong>Last dropped file:</strong>{' '}
              <span
                data-test-host-dropzone-last-file="true"
                className="font-mono"
              >
                {lastHostDroppedFileName ?? 'None'}
              </span>
            </p>
          </div>

          <div
            ref={mountRef}
            style={{ height: '460px' }}
            dangerouslySetInnerHTML={{ __html: containerHtml }}
            suppressHydrationWarning
          />
        </div>
      </ExampleCard>
    </div>
  );
}
