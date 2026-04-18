'use client';

import {
  FileTree as PathStoreFileTree,
  type FileTreeOptions as PathStoreFileTreeOptions,
} from '@pierre/trees';
import { useEffect, useMemo, useRef } from 'react';

import { ExampleCard } from '../_components/ExampleCard';
import { useGitStatusControls } from '../_components/useGitStatusControls';

interface PathStoreGitStatusDemoClientProps {
  containerHtml: string;
  sharedOptions: Omit<PathStoreFileTreeOptions, 'gitStatus' | 'id'>;
}

export function PathStoreGitStatusDemoClient({
  containerHtml,
  sharedOptions,
}: PathStoreGitStatusDemoClientProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<PathStoreFileTree | null>(null);
  const { gitStatus, controls } = useGitStatusControls('canonical');
  const initialGitStatusRef = useRef(gitStatus);
  const options = useMemo<PathStoreFileTreeOptions>(
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

    const fileTree = new PathStoreFileTree({
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
          Changed files render A/M/D markers, folders with changed descendants
          keep their shared dot indicator, and the controls below call
          <code>setGitStatus()</code> on the live tree without recreating it.
        </p>
      </header>

      <ExampleCard
        title="Git-status tree"
        description="Toggle git status off or swap between the two demo sets. The hydrated tree keeps the same instance while the shared status slot and semantic row attrs update in place."
        controls={controls}
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
