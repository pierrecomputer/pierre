'use client';

import { FileTree } from '@pierre/trees';
import type { FileTreeOptions, FileTreeStateConfig } from '@pierre/trees';
import { FileTree as FileTreeReact } from '@pierre/trees/react';
import '@pierre/trees/web-components';
import { useCallback, useMemo, useRef } from 'react';

import { cleanupFileTreeInstance } from '../_components/cleanupFileTreeInstance';
import {
  DemoHeaderContent,
  injectSlotMarkup,
  vanillaHeaderSlotMarkup,
} from '../_components/DemoHeaderContent';
import { ExampleCard } from '../_components/ExampleCard';
import { StateLog, useStateLog } from '../_components/StateLog';
import { useTreesDevSettings } from '../_components/TreesDevSettingsProvider';
import { sharedDemoStateConfig } from '../demo-data';

interface HeaderSlotDemoClientProps {
  preloadedFileTreeHtml: string;
  preloadedFileTreeContainerHtml: string;
}

export function HeaderSlotDemoClient({
  preloadedFileTreeHtml,
  preloadedFileTreeContainerHtml,
}: HeaderSlotDemoClientProps) {
  const { fileTreeOptions, reactOptions, reactFiles } = useTreesDevSettings();

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Custom Header Slot</h1>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <VanillaSSRHeaderSlot
          options={fileTreeOptions}
          stateConfig={sharedDemoStateConfig}
          containerHtml={preloadedFileTreeContainerHtml}
        />
        <ReactSSRHeaderSlot
          options={reactOptions}
          initialFiles={reactFiles}
          stateConfig={sharedDemoStateConfig}
          prerenderedHTML={preloadedFileTreeHtml}
        />
      </div>
    </>
  );
}

function VanillaSSRHeaderSlot({
  options,
  stateConfig,
  containerHtml,
}: {
  options: FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
  containerHtml: string;
}) {
  const instanceRef = useRef<FileTree | null>(null);
  const hasHydratedRef = useRef(false);
  const { log, addLog } = useStateLog();
  const containerHtmlWithHeader = useMemo(
    () =>
      injectSlotMarkup(
        containerHtml,
        vanillaHeaderSlotMarkup('Vanilla SSR Header')
      ),
    [containerHtml]
  );

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (node == null) {
        return;
      }

      const fileTreeContainer = node.querySelector('file-tree-container');
      if (!(fileTreeContainer instanceof HTMLElement)) return;

      cleanupFileTreeInstance(fileTreeContainer, instanceRef);

      const headerButton = fileTreeContainer.querySelector(
        '[data-demo-header-button="true"]'
      );
      const handleHeaderClick = () => {
        addLog('header: clicked');
      };
      headerButton?.addEventListener('click', handleHeaderClick);

      const fileTree = new FileTree(options, stateConfig);

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
        headerButton?.removeEventListener('click', handleHeaderClick);
        fileTree.cleanUp();
        instanceRef.current = null;
      };
    },
    [addLog, options, stateConfig]
  );

  return (
    <ExampleCard
      title="Header Slot (Vanilla SSR)"
      description="SSR markup includes a slotted light-DOM header; the click log verifies the imperative hydration path attached correctly"
      footer={
        <StateLog
          entries={log}
          className="mt-3 h-[96px] overflow-y-auto rounded border p-2 font-mono text-xs"
        />
      }
    >
      <div
        ref={ref}
        dangerouslySetInnerHTML={{ __html: containerHtmlWithHeader }}
        suppressHydrationWarning
      />
    </ExampleCard>
  );
}

function ReactSSRHeaderSlot({
  options,
  initialFiles,
  stateConfig,
  prerenderedHTML,
}: {
  options: Omit<FileTreeOptions, 'initialFiles'>;
  initialFiles?: string[];
  stateConfig?: FileTreeStateConfig;
  prerenderedHTML: string;
}) {
  const { log, addLog } = useStateLog();

  return (
    <ExampleCard
      title="Header Slot (React SSR)"
      description="React server-renders the slotted header into the host element and hydrates its click handler on the client"
      footer={
        <StateLog
          entries={log}
          className="mt-3 h-[96px] overflow-y-auto rounded border p-2 font-mono text-xs"
        />
      }
    >
      <FileTreeReact
        options={options}
        initialFiles={initialFiles}
        prerenderedHTML={prerenderedHTML}
        initialExpandedItems={stateConfig?.initialExpandedItems}
        onSelection={stateConfig?.onSelection}
        header={
          <DemoHeaderContent
            label="React SSR Header"
            onClick={() => addLog('header: clicked')}
          />
        }
      />
    </ExampleCard>
  );
}
