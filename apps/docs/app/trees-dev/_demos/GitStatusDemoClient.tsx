'use client';

import { FileTree } from '@pierre/trees';
import { useEffect, useMemo, useRef } from 'react';

import { ExampleCard } from '../_components/ExampleCard';
import { useGitStatusControls } from '../_components/useGitStatusControls';
import {
  ITEM_CUSTOMIZATION_DEMO_DEFAULTS,
  TREES_DEV_GIT_STATUS_PRESETS,
} from '../_lib/itemCustomizationDemoData';
import type { FileTreePathOptions } from '@/lib/fileTreePathOptions';

interface GitStatusDemoClientProps {
  containerHtml: string;
  fileCountLabel: string;
  sharedOptions: Omit<FileTreePathOptions, 'gitStatus' | 'id'>;
}

export function GitStatusDemoClient({
  containerHtml,
  fileCountLabel,
  sharedOptions,
}: GitStatusDemoClientProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<FileTree | null>(null);
  const { activePreset, gitStatus, controls } = useGitStatusControls({
    defaultPresetId: ITEM_CUSTOMIZATION_DEMO_DEFAULTS.gitStatusPresetId,
    idSuffix: 'canonical',
    presets: TREES_DEV_GIT_STATUS_PRESETS,
  });
  const initialGitStatusRef = useRef(gitStatus);
  const options = useMemo<FileTreePathOptions>(
    () => ({
      ...sharedOptions,
      id: 'trees-git-status',
    }),
    [sharedOptions]
  );

  useEffect(() => {
    const node = mountRef.current;
    if (node == null) {
      return;
    }

    const fileTree = new FileTree({
      ...options,
      gitStatus: initialGitStatusRef.current,
    });
    treeRef.current = fileTree;

    const fileTreeContainer = node.querySelector('file-tree-container');
    if (fileTreeContainer instanceof HTMLElement) {
      fileTree.hydrate({ fileTreeContainer });
    } else {
      node.innerHTML = '';
      fileTree.render({ containerWrapper: node });
    }

    return () => {
      treeRef.current = null;
      fileTree.cleanUp();
    };
  }, [containerHtml, options]);

  useEffect(() => {
    treeRef.current?.setGitStatus(gitStatus);
  }, [gitStatus]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Git Status</h1>
        <p className="text-muted-foreground max-w-3xl text-sm leading-6">
          This route now shares the same demo-small {fileCountLabel} and preset
          source as Item Customization. The controls below swap between direct
          file badges, ignored-directory inheritance with overrides, and
          descendant-dot scenarios while <code>setGitStatus()</code> updates the
          hydrated tree in place.
        </p>
      </header>

      <ExampleCard
        title="Git-status tree"
        description="Toggle git status off or switch between the shared preset sets. The canonical tree instance stays mounted while the git lane and semantic row attributes update live."
        controls={controls}
        footer={
          <div className="text-muted-foreground mt-3 space-y-1 text-xs leading-5">
            <p>
              Active preset: <strong>{activePreset.label}</strong>
            </p>
            <p data-test-git-status-active-description="true">
              {activePreset.description}
            </p>
          </div>
        }
      >
        <div
          ref={mountRef}
          style={{ height: `${String(options.viewportHeight ?? 280)}px` }}
          dangerouslySetInnerHTML={{ __html: containerHtml }}
          suppressHydrationWarning
        />
      </ExampleCard>
    </div>
  );
}
