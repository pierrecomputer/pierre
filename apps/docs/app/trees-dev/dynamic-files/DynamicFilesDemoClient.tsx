'use client';

import { FileTree } from '@pierre/trees';
import type { FileTreeOptions, FileTreeStateConfig } from '@pierre/trees';
import { FileTree as FileTreeReact } from '@pierre/trees/react';
import { useCallback, useRef, useState } from 'react';

import { ExampleCard } from '../_components/ExampleCard';
import { useTreesDevSettings } from '../_components/TreesDevSettingsProvider';
import { sharedDemoFileTreeOptions, sharedDemoStateConfig } from '../demo-data';

const EXTRA_FILE = 'Build/assets/images/social/logo2.png';

interface DynamicFilesDemoClientProps {
  preloadedFileTreeHtml: string;
}

export function DynamicFilesDemoClient({
  preloadedFileTreeHtml,
}: DynamicFilesDemoClientProps) {
  const { fileTreeOptions, reactOptions } = useTreesDevSettings();

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Dynamic Files</h1>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <VanillaDynamicFiles
          options={fileTreeOptions}
          stateConfig={sharedDemoStateConfig}
        />
        <ReactControlledFiles
          options={reactOptions}
          stateConfig={sharedDemoStateConfig}
        />
        <ReactSSRControlledFiles
          options={reactOptions}
          stateConfig={sharedDemoStateConfig}
          prerenderedHTML={preloadedFileTreeHtml}
        />
      </div>
    </>
  );
}

function VanillaDynamicFiles({
  options,
  stateConfig,
}: {
  options: FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
}) {
  const instanceRef = useRef<FileTree | null>(null);
  const [hasExtra, setHasExtra] = useState(false);

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
        { ...options, initialFiles: sharedDemoFileTreeOptions.initialFiles },
        stateConfig
      );
      fileTree.render({ containerWrapper: node });
      instanceRef.current = fileTree;

      return () => {
        fileTree.cleanUp();
        instanceRef.current = null;
      };
    },
    [options, stateConfig]
  );

  return (
    <ExampleCard
      title="Vanilla — Dynamic Files"
      description="Uses setFiles() imperatively to add/remove files without recreating the tree"
      controls={
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => {
              instanceRef.current?.setFiles([
                ...sharedDemoFileTreeOptions.initialFiles,
                EXTRA_FILE,
              ]);
              setHasExtra(true);
            }}
          >
            Add logo2.png
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => {
              instanceRef.current?.setFiles(
                sharedDemoFileTreeOptions.initialFiles
              );
              setHasExtra(false);
            }}
          >
            Remove logo2.png
          </button>
        </div>
      }
      footer={
        <p className="mt-2 text-xs text-gray-500">
          {hasExtra ? 'logo2.png added' : 'logo2.png not present'}
        </p>
      }
    >
      <div ref={ref} />
    </ExampleCard>
  );
}

function ReactControlledFiles({
  options,
  stateConfig,
}: {
  options: Omit<FileTreeOptions, 'initialFiles'>;
  stateConfig?: FileTreeStateConfig;
}) {
  const [files, setFiles] = useState(sharedDemoFileTreeOptions.initialFiles);
  const [onFilesChangeCalls, setOnFilesChangeCalls] = useState(0);

  const handleFilesChange = useCallback((nextFiles: string[]) => {
    setOnFilesChangeCalls((count) => count + 1);
    setFiles(nextFiles);
  }, []);

  return (
    <ExampleCard
      title="React — Controlled Files"
      description="files prop is controlled by React state, with onFilesChange wired for full control"
      controls={
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => {
              if (!files.includes(EXTRA_FILE)) {
                setFiles([...files, EXTRA_FILE]);
              }
            }}
          >
            Add logo2.png
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => {
              if (files.includes(EXTRA_FILE)) {
                setFiles(files.filter((f) => f !== EXTRA_FILE));
              }
            }}
          >
            Remove logo2.png
          </button>
        </div>
      }
      footer={
        <p className="mt-2 text-xs text-gray-500">
          {files.includes(EXTRA_FILE)
            ? 'logo2.png added'
            : 'logo2.png not present'}{' '}
          ({onFilesChangeCalls} onFilesChange callbacks)
        </p>
      }
    >
      <FileTreeReact
        options={options}
        files={files}
        onFilesChange={handleFilesChange}
        initialExpandedItems={stateConfig?.initialExpandedItems}
        onSelection={stateConfig?.onSelection}
      />
    </ExampleCard>
  );
}

function ReactSSRControlledFiles({
  options,
  stateConfig,
  prerenderedHTML,
}: {
  options: Omit<FileTreeOptions, 'initialFiles'>;
  stateConfig?: FileTreeStateConfig;
  prerenderedHTML: string;
}) {
  const [files, setFiles] = useState(sharedDemoFileTreeOptions.initialFiles);
  const [onFilesChangeCalls, setOnFilesChangeCalls] = useState(0);

  const handleFilesChange = useCallback((nextFiles: string[]) => {
    setOnFilesChangeCalls((count) => count + 1);
    setFiles(nextFiles);
  }, []);

  return (
    <ExampleCard
      title="React (SSR) — Controlled Files"
      description="SSR hydration with controlled files, using onFilesChange to keep parent state authoritative"
      controls={
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => {
              if (!files.includes(EXTRA_FILE)) {
                setFiles([...files, EXTRA_FILE]);
              }
            }}
          >
            Add logo2.png
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => {
              if (files.includes(EXTRA_FILE)) {
                setFiles(files.filter((f) => f !== EXTRA_FILE));
              }
            }}
          >
            Remove logo2.png
          </button>
        </div>
      }
      footer={
        <p className="mt-2 text-xs text-gray-500">
          {files.includes(EXTRA_FILE)
            ? 'logo2.png added'
            : 'logo2.png not present'}{' '}
          ({onFilesChangeCalls} onFilesChange callbacks)
        </p>
      }
    >
      <FileTreeReact
        options={options}
        prerenderedHTML={prerenderedHTML}
        files={files}
        onFilesChange={handleFilesChange}
        initialExpandedItems={stateConfig?.initialExpandedItems}
        onSelection={stateConfig?.onSelection}
      />
    </ExampleCard>
  );
}
