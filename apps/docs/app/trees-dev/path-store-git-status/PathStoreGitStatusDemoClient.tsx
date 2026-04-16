'use client';

import {
  PathStoreFileTree,
  type PathStoreFileTreeOptions,
} from '@pierre/trees/path-store';
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
  const { gitStatus, controls } = useGitStatusControls('path-store');
  const initialGitStatusRef = useRef(gitStatus);
  const options = useMemo<PathStoreFileTreeOptions>(
    () => ({
      ...sharedOptions,
      id: 'pst-phase9-git-status',
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
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Path-store lane · provisional
        </p>
        <h1 className="text-2xl font-bold">Path-store Git Status</h1>
        <p className="text-muted-foreground max-w-3xl text-sm leading-6">
          Phase 9 restores git-status decoration without reviving the legacy
          core feature seam: changed files render A/M/D markers, folders with
          changed descendants render the shared dot indicator, and the controls
          below call <code>setGitStatus()</code> on the live tree instance so
          the row attrs and status slot update without recreating the tree.
        </p>
      </header>

      <ExampleCard
        title="Git-status tree proof"
        description="Toggle git-status off or swap between the two demo sets. The hydrated path-store tree keeps the same instance while the shared status slot and semantic row attrs update in place."
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
