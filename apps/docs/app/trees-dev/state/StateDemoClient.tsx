'use client';

import { expandImplicitParentDirectories, FileTree } from '@pierre/trees';
import type { FileTreeStateConfig } from '@pierre/trees';
import { FileTree as FileTreeReact } from '@pierre/trees/react';
import '@pierre/trees/web-components';
import { useCallback, useMemo, useRef, useState } from 'react';

import { cleanupFileTreeInstance } from '../_components/cleanupFileTreeInstance';
import { ExampleCard } from '../_components/ExampleCard';
import { StateLog, useStateLog } from '../_components/StateLog';
import { useTreesDevSettings } from '../_components/TreesDevSettingsProvider';
import { sharedDemoStateConfig } from '../demo-data';

interface StateDemoClientProps {
  preloadedFileTreeHtml: string;
  preloadedFileTreeContainerHtml: string;
  preloadedControlledFileTreeHtml: string;
}

export function StateDemoClient({
  preloadedFileTreeHtml,
  preloadedFileTreeContainerHtml,
  preloadedControlledFileTreeHtml,
}: StateDemoClientProps) {
  const { fileTreeOptions, reactOptions, reactFiles } = useTreesDevSettings();

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">State</h1>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <VanillaSSRState
          options={fileTreeOptions}
          stateConfig={sharedDemoStateConfig}
          containerHtml={preloadedFileTreeContainerHtml}
        />
        <ReactSSRUncontrolled
          options={reactOptions}
          initialFiles={reactFiles}
          stateConfig={sharedDemoStateConfig}
          prerenderedHTML={preloadedFileTreeHtml}
        />
        <ReactSSRControlled
          options={reactOptions}
          initialFiles={reactFiles}
          stateConfig={{
            ...sharedDemoStateConfig,
            initialSelectedItems: ['Build/assets/images/social/logo.png'],
          }}
          prerenderedHTML={preloadedControlledFileTreeHtml}
        />
      </div>
    </>
  );
}

function VanillaSSRState({
  options,
  stateConfig,
  containerHtml,
}: {
  options: import('@pierre/trees').FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
  containerHtml: string;
}) {
  const instanceRef = useRef<FileTree | null>(null);
  const hasHydratedRef = useRef(false);
  const { log, addLog } = useStateLog();

  const mergedStateConfig = useMemo<FileTreeStateConfig>(
    () => ({
      ...stateConfig,
      onExpandedItemsChange: (items) => {
        addLog(`expanded: [${items.join(', ')}]`);
      },
      onSelectedItemsChange: (items) => {
        addLog(`selected: [${items.join(', ')}]`);
      },
    }),
    [stateConfig, addLog]
  );

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (node == null) {
        return;
      }

      const fileTreeContainer = node.querySelector('file-tree-container');
      if (!(fileTreeContainer instanceof HTMLElement)) return;

      cleanupFileTreeInstance(fileTreeContainer, instanceRef);

      const fileTree = new FileTree(options, mergedStateConfig);

      if (!hasHydratedRef.current) {
        fileTree.hydrate({
          fileTreeContainer,
        });
        hasHydratedRef.current = true;
      } else {
        fileTree.render({ fileTreeContainer });
      }

      instanceRef.current = fileTree;

      return () => {
        fileTree.cleanUp();
        instanceRef.current = null;
      };
    },
    [options, mergedStateConfig]
  );

  return (
    <ExampleCard
      title="Vanilla (SSR) — Imperative State"
      description="Vanilla FileTree hydrated from SSR, with imperative expand/collapse/selection buttons and state change logging"
      controls={
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => instanceRef.current?.expandItem('src/components')}
          >
            Expand src/components
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => instanceRef.current?.collapseItem('src/components')}
          >
            Collapse src/components
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => instanceRef.current?.setSelectedItems(['README.md'])}
          >
            Select README.md
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => instanceRef.current?.setSelectedItems([])}
          >
            Clear Selection
          </button>
        </div>
      }
      footer={
        <StateLog
          entries={log}
          className="mt-3 h-[140px] overflow-y-auto rounded border p-2 font-mono text-xs"
        />
      }
    >
      <div
        ref={ref}
        dangerouslySetInnerHTML={{ __html: containerHtml }}
        suppressHydrationWarning
      />
    </ExampleCard>
  );
}

function ReactSSRUncontrolled({
  options,
  initialFiles,
  stateConfig,
  prerenderedHTML,
}: {
  options: Omit<import('@pierre/trees').FileTreeOptions, 'initialFiles'>;
  initialFiles?: string[];
  stateConfig?: FileTreeStateConfig;
  prerenderedHTML: string;
}) {
  const { log, addLog } = useStateLog();

  return (
    <ExampleCard
      title="React (SSR) — Uncontrolled"
      description="React FileTree with SSR, using onExpandedItemsChange to observe state without controlling it"
      controls={null}
      footer={
        <StateLog
          entries={log}
          className="mt-3 h-[140px] overflow-y-auto rounded border p-2 font-mono text-xs"
        />
      }
    >
      <FileTreeReact
        options={options}
        initialFiles={initialFiles}
        prerenderedHTML={prerenderedHTML}
        initialExpandedItems={stateConfig?.initialExpandedItems}
        initialSelectedItems={stateConfig?.initialSelectedItems}
        onSelection={stateConfig?.onSelection}
        onExpandedItemsChange={(items) => {
          addLog(`expanded: [${items.join(', ')}]`);
        }}
        onSelectedItemsChange={(items) => {
          addLog(`selected: [${items.join(', ')}]`);
        }}
      />
    </ExampleCard>
  );
}

function ReactSSRControlled({
  options,
  initialFiles,
  stateConfig,
  prerenderedHTML,
}: {
  options: Omit<import('@pierre/trees').FileTreeOptions, 'initialFiles'>;
  initialFiles?: string[];
  stateConfig?: FileTreeStateConfig;
  prerenderedHTML: string;
}) {
  const [expandedItems, setExpandedItems] = useState<string[]>(() =>
    expandImplicitParentDirectories(stateConfig?.initialExpandedItems ?? [])
  );
  const [selectedItems, setSelectedItems] = useState<string[]>(
    () => stateConfig?.initialSelectedItems ?? []
  );
  const { log, addLog } = useStateLog();

  const handleExpandedChange = useCallback(
    (items: string[]) => {
      setExpandedItems(items);
      addLog(`expanded: [${items.join(', ')}]`);
    },
    [addLog]
  );

  const handleSelectedChange = useCallback(
    (items: string[]) => {
      setSelectedItems(items);
      addLog(`selected: [${items.join(', ')}]`);
    },
    [addLog]
  );

  return (
    <ExampleCard
      title="React (SSR) — Controlled"
      description="React FileTree with SSR, expandedItems and selectedItems fully controlled by React state"
      controls={
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() =>
              handleExpandedChange(
                expandImplicitParentDirectories([
                  ...expandedItems,
                  'src/components',
                ])
              )
            }
          >
            Expand src/components
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => handleExpandedChange([])}
          >
            Collapse All
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => handleSelectedChange(['README.md'])}
          >
            Select README.md
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => handleSelectedChange([])}
          >
            Clear Selection
          </button>
        </div>
      }
      footer={
        <StateLog
          entries={log}
          className="mt-3 h-[140px] overflow-y-auto rounded border p-2 font-mono text-xs"
        />
      }
    >
      <FileTreeReact
        options={options}
        initialFiles={initialFiles}
        prerenderedHTML={prerenderedHTML}
        onSelection={stateConfig?.onSelection}
        expandedItems={expandedItems}
        onExpandedItemsChange={handleExpandedChange}
        selectedItems={selectedItems}
        onSelectedItemsChange={handleSelectedChange}
      />
    </ExampleCard>
  );
}
