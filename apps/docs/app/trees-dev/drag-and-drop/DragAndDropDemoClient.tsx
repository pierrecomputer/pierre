'use client';

import { FileTree } from '@pierre/trees';
import type { FileTreeOptions, FileTreeStateConfig } from '@pierre/trees';
import { FileTree as FileTreeReact } from '@pierre/trees/react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { ExampleCard } from '../_components/ExampleCard';
import { StateLog, useStateLog } from '../_components/StateLog';
import { useTreesDevSettings } from '../_components/TreesDevSettingsProvider';
import { sharedDemoFileTreeOptions, sharedDemoStateConfig } from '../demo-data';

interface DragAndDropDemoClientProps {
  preloadedFileTreeHtml: string;
}

export function DragAndDropDemoClient({
  preloadedFileTreeHtml,
}: DragAndDropDemoClientProps) {
  const { fileTreeOptions, reactOptions } = useTreesDevSettings();

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Drag and Drop</h1>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <VanillaDnDUncontrolled
          options={fileTreeOptions}
          stateConfig={sharedDemoStateConfig}
        />
        <ReactDnDControlled
          options={reactOptions}
          stateConfig={sharedDemoStateConfig}
        />
        <ReactDnDControlledSSR
          options={reactOptions}
          stateConfig={sharedDemoStateConfig}
          prerenderedHTML={preloadedFileTreeHtml}
        />
      </div>
    </>
  );
}

function VanillaDnDUncontrolled({
  options,
  stateConfig,
}: {
  options: FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
}) {
  const instanceRef = useRef<FileTree | null>(null);
  const { log, addLog } = useStateLog();

  const mergedStateConfig = useMemo<FileTreeStateConfig>(
    () => ({
      ...stateConfig,
      onFilesChange: (files) => {
        addLog(`files: [${files.join(', ')}]`);
      },
    }),
    [stateConfig, addLog]
  );

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (node == null) {
        return;
      }

      if (instanceRef.current != null) {
        instanceRef.current.cleanUp();
        node.innerHTML = '';
      }

      const fileTree = new FileTree(
        {
          ...options,
          dragAndDrop: true,
          initialFiles: sharedDemoFileTreeOptions.initialFiles,
        },
        mergedStateConfig
      );
      fileTree.render({ containerWrapper: node });
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
      title="Vanilla — Uncontrolled DnD"
      description="Drag files and folders between directories. Moves are applied immediately; onFilesChange logs changes."
      footer={
        <StateLog
          entries={log}
          className="mt-3 h-[140px] overflow-y-auto rounded border p-2 font-mono text-xs"
        />
      }
    >
      <div ref={ref} />
    </ExampleCard>
  );
}

function ReactDnDControlled({
  options,
  stateConfig,
}: {
  options: Omit<FileTreeOptions, 'initialFiles'>;
  stateConfig?: FileTreeStateConfig;
}) {
  const [files, setFiles] = useState(sharedDemoFileTreeOptions.initialFiles);
  const [lockGitignore, setLockGitignore] = useState(false);
  const { log, addLog } = useStateLog();

  const handleFilesChange = useCallback(
    (nextFiles: string[]) => {
      if (lockGitignore) {
        const oldGitignore = files.find((f) => f.endsWith('.gitignore'));
        const newGitignore = nextFiles.find((f) => f.endsWith('.gitignore'));
        if (oldGitignore !== newGitignore) {
          addLog('REJECTED: .gitignore is locked');
          return;
        }
      }
      addLog(`files: [${nextFiles.join(', ')}]`);
      setFiles(nextFiles);
    },
    [lockGitignore, files, addLog]
  );

  return (
    <ExampleCard
      title="React — Controlled DnD"
      description="Controlled files with DnD. Toggle lock to prevent .gitignore from being moved."
      controls={
        <div className="flex items-center gap-2">
          <label
            htmlFor="lock-gitignore"
            className="flex cursor-pointer items-center gap-2 select-none"
          >
            <input
              type="checkbox"
              id="lock-gitignore"
              checked={lockGitignore}
              className="cursor-pointer"
              onChange={() => setLockGitignore((prev) => !prev)}
            />
            Lock .gitignore
          </label>
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
        options={{ ...options, dragAndDrop: true }}
        files={files}
        onFilesChange={handleFilesChange}
        initialExpandedItems={stateConfig?.initialExpandedItems}
        onSelection={stateConfig?.onSelection}
      />
    </ExampleCard>
  );
}

function ReactDnDControlledSSR({
  options,
  stateConfig,
  prerenderedHTML,
}: {
  options: Omit<FileTreeOptions, 'initialFiles'>;
  stateConfig?: FileTreeStateConfig;
  prerenderedHTML: string;
}) {
  const [files, setFiles] = useState(sharedDemoFileTreeOptions.initialFiles);
  const [lockGitignore, setLockGitignore] = useState(false);
  const { log, addLog } = useStateLog();

  const handleFilesChange = useCallback(
    (nextFiles: string[]) => {
      if (lockGitignore) {
        const oldGitignore = files.find((f) => f.endsWith('.gitignore'));
        const newGitignore = nextFiles.find((f) => f.endsWith('.gitignore'));
        if (oldGitignore !== newGitignore) {
          addLog('REJECTED: .gitignore is locked');
          return;
        }
      }
      addLog(`files: [${nextFiles.join(', ')}]`);
      setFiles(nextFiles);
    },
    [lockGitignore, files, addLog]
  );

  return (
    <ExampleCard
      title="React (SSR) — Controlled DnD"
      description="SSR-hydrated controlled DnD. Toggle lock to prevent .gitignore from being moved."
      controls={
        <div className="flex items-center gap-2">
          <label
            htmlFor="lock-gitignore-ssr"
            className="flex cursor-pointer items-center gap-2 select-none"
          >
            <input
              type="checkbox"
              id="lock-gitignore-ssr"
              checked={lockGitignore}
              className="cursor-pointer"
              onChange={() => setLockGitignore((prev) => !prev)}
            />
            Lock .gitignore
          </label>
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
        options={{ ...options, dragAndDrop: true }}
        prerenderedHTML={prerenderedHTML}
        files={files}
        onFilesChange={handleFilesChange}
        initialExpandedItems={stateConfig?.initialExpandedItems}
        onSelection={stateConfig?.onSelection}
      />
    </ExampleCard>
  );
}
