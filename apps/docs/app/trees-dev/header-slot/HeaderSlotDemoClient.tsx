'use client';

import { FileTree } from '@pierre/trees';
import type { FileTreeOptions, FileTreeStateConfig } from '@pierre/trees';
import { FileTree as FileTreeReact } from '@pierre/trees/react';
import '@pierre/trees/web-components';
import { useCallback, useMemo, useRef, useState } from 'react';

import { cleanupFileTreeInstance } from '../_components/cleanupFileTreeInstance';
import {
  injectSlotMarkup,
  ProjectHeader,
  vanillaProjectHeaderMarkup,
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
  const fileCounterRef = useRef(0);
  const folderCounterRef = useRef(0);
  const { log, addLog } = useStateLog();
  const containerHtmlWithHeader = useMemo(
    () =>
      injectSlotMarkup(
        containerHtml,
        vanillaProjectHeaderMarkup('Vanilla SSR Header')
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

      const addFileBtn = fileTreeContainer.querySelector(
        '[data-header-add-file="true"]'
      );
      const addFolderBtn = fileTreeContainer.querySelector(
        '[data-header-add-folder="true"]'
      );
      const handleAddFile = () => {
        const ft = instanceRef.current;
        if (ft == null) return;
        const name = `new-file-${++fileCounterRef.current}.ts`;
        ft.setFiles([...ft.getFiles(), name]);
        addLog(`added file: ${name}`);
      };
      const handleAddFolder = () => {
        const ft = instanceRef.current;
        if (ft == null) return;
        const name = `new-folder-${++folderCounterRef.current}/placeholder`;
        ft.setFiles([...ft.getFiles(), name]);
        addLog(`added folder: new-folder-${folderCounterRef.current}`);
      };
      addFileBtn?.addEventListener('click', handleAddFile);
      addFolderBtn?.addEventListener('click', handleAddFolder);

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
        addFileBtn?.removeEventListener('click', handleAddFile);
        addFolderBtn?.removeEventListener('click', handleAddFolder);
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
  const [files, setFiles] = useState(initialFiles);
  const fileCounterRef = useRef(0);
  const folderCounterRef = useRef(0);
  const { log, addLog } = useStateLog();

  const handleAddFile = useCallback(() => {
    const name = `new-file-${++fileCounterRef.current}.ts`;
    setFiles((prev) => [...(prev ?? []), name]);
    addLog(`added file: ${name}`);
  }, [addLog]);

  const handleAddFolder = useCallback(() => {
    const name = `new-folder-${++folderCounterRef.current}/placeholder`;
    setFiles((prev) => [...(prev ?? []), name]);
    addLog(`added folder: new-folder-${folderCounterRef.current}`);
  }, [addLog]);

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
        files={files}
        onFilesChange={setFiles}
        prerenderedHTML={prerenderedHTML}
        initialExpandedItems={stateConfig?.initialExpandedItems}
        onSelection={stateConfig?.onSelection}
        header={
          <ProjectHeader
            projectName="React SSR Header"
            onAddFile={handleAddFile}
            onAddFolder={handleAddFolder}
          />
        }
      />
    </ExampleCard>
  );
}
