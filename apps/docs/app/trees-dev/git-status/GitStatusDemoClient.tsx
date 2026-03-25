'use client';

import { FileTree } from '@pierre/trees';
import type { FileTreeOptions, FileTreeStateConfig } from '@pierre/trees';
import { FileTree as FileTreeReact } from '@pierre/trees/react';
import { useCallback, useRef } from 'react';

import { ExampleCard } from '../_components/ExampleCard';
import { useTreesDevSettings } from '../_components/TreesDevSettingsProvider';
import { useGitStatusControls } from '../_components/useGitStatusControls';
import { sharedDemoStateConfig } from '../demo-data';

interface GitStatusDemoClientProps {
  preloadedGitStatusFileTreeHtml: string;
}

export function GitStatusDemoClient({
  preloadedGitStatusFileTreeHtml,
}: GitStatusDemoClientProps) {
  const { fileTreeOptions, reactOptions, reactFiles } = useTreesDevSettings();

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Git Status</h1>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <VanillaGitStatus
          options={fileTreeOptions}
          stateConfig={sharedDemoStateConfig}
        />
        <GitStatusDemo
          options={reactOptions}
          initialFiles={reactFiles}
          stateConfig={sharedDemoStateConfig}
        />
        <ReactSSRGitStatus
          options={reactOptions}
          initialFiles={reactFiles}
          stateConfig={sharedDemoStateConfig}
          prerenderedHTML={preloadedGitStatusFileTreeHtml}
        />
      </div>
    </>
  );
}

function VanillaGitStatus({
  options,
  stateConfig,
}: {
  options: FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
}) {
  const instanceRef = useRef<FileTree | null>(null);
  const { gitStatus, controls } = useGitStatusControls('vanilla');

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (node == null) {
        return;
      }

      if (instanceRef.current != null) {
        instanceRef.current.cleanUp();
        node.innerHTML = '';
      }

      const fileTree = new FileTree({ ...options, gitStatus }, stateConfig);
      fileTree.render({ containerWrapper: node });
      instanceRef.current = fileTree;

      return () => {
        fileTree.cleanUp();
        instanceRef.current = null;
      };
    },
    [options, stateConfig, gitStatus]
  );

  return (
    <ExampleCard
      title="Vanilla — Git Status"
      description="Vanilla FileTree with imperative setGitStatus() toggling A/M/D indicators"
      controls={controls}
    >
      <div ref={ref} />
    </ExampleCard>
  );
}

function GitStatusDemo({
  options,
  initialFiles,
  stateConfig,
}: {
  options: Omit<FileTreeOptions, 'initialFiles'>;
  initialFiles?: string[];
  stateConfig?: FileTreeStateConfig;
}) {
  const { gitStatus, controls } = useGitStatusControls('react');

  return (
    <ExampleCard
      title="React — Git Status"
      description="Controlled gitStatus prop showing A/M/D indicators on files and middots on folders with changes"
      controls={controls}
    >
      <FileTreeReact
        options={options}
        initialFiles={initialFiles}
        initialExpandedItems={stateConfig?.initialExpandedItems}
        onSelection={stateConfig?.onSelection}
        gitStatus={gitStatus}
      />
    </ExampleCard>
  );
}

function ReactSSRGitStatus({
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
  const { gitStatus, controls } = useGitStatusControls('react-ssr');

  return (
    <ExampleCard
      title="React (SSR) — Git Status"
      description="SSR-hydrated React FileTree with controlled gitStatus prop"
      controls={controls}
    >
      <FileTreeReact
        options={options}
        initialFiles={initialFiles}
        prerenderedHTML={prerenderedHTML}
        initialExpandedItems={stateConfig?.initialExpandedItems}
        onSelection={stateConfig?.onSelection}
        gitStatus={gitStatus}
      />
    </ExampleCard>
  );
}
