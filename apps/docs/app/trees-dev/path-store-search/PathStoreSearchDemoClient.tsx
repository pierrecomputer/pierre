'use client';

import {
  PathStoreFileTree,
  type PathStoreFileTreeOptions,
} from '@pierre/trees/path-store';
import type { ReactNode } from 'react';
import { memo, useEffect, useMemo, useRef } from 'react';

import { ExampleCard } from '../_components/ExampleCard';
import { StateLog, useStateLog } from '../_components/StateLog';

interface SearchExampleProps {
  containerHtml: string;
  controls?: ReactNode;
  description: string;
  onTreeReady?: (tree: PathStoreFileTree | null) => void;
  options: PathStoreFileTreeOptions;
  title: string;
}

const HydratedSearchExample = memo(function HydratedSearchExample({
  containerHtml,
  controls,
  description,
  onTreeReady,
  options,
  title,
}: SearchExampleProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { addLog, log } = useStateLog();

  useEffect(() => {
    const node = ref.current;
    if (node == null) {
      return;
    }

    const fileTree = new PathStoreFileTree({
      ...options,
      onSearchChange: (value) => {
        addLog(`search: ${value ?? '<closed>'}`);
      },
    });
    onTreeReady?.(fileTree);
    const fileTreeContainer = node.querySelector('file-tree-container');
    if (fileTreeContainer instanceof HTMLElement) {
      fileTree.hydrate({ fileTreeContainer });
    } else {
      node.innerHTML = '';
      fileTree.render({ containerWrapper: node });
    }

    return () => {
      fileTree.cleanUp();
      onTreeReady?.(null);
    };
  }, [addLog, containerHtml, onTreeReady, options]);

  return (
    <ExampleCard title={title} description={description} controls={controls}>
      <div
        ref={ref}
        style={{ height: `${String(options.viewportHeight ?? 320)}px` }}
        dangerouslySetInnerHTML={{ __html: containerHtml }}
        suppressHydrationWarning
      />
      <StateLog entries={log} />
    </ExampleCard>
  );
});

export function PathStoreSearchDemoClient({
  collapseHtml,
  expandHtml,
  hideHtml,
  hiddenHtml,
  sharedOptions,
}: {
  collapseHtml: string;
  expandHtml: string;
  hideHtml: string;
  hiddenHtml: string;
  sharedOptions: Omit<
    PathStoreFileTreeOptions,
    | 'fileTreeSearchMode'
    | 'id'
    | 'initialSearchQuery'
    | 'preparedInput'
    | 'search'
  >;
}) {
  const baseOptions = useMemo(
    () => ({
      ...sharedOptions,
      viewportHeight: 260,
    }),
    [sharedOptions]
  );
  const hiddenTreeRef = useRef<PathStoreFileTree | null>(null);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Path-store lane · provisional
        </p>
        <h1 className="text-2xl font-bold">Path-store Search</h1>
        <p className="text-muted-foreground max-w-3xl text-sm leading-6">
          Phase 7 restores the existing baseline search behavior in the
          path-store lane: the three legacy modes, built-in input/session UX,
          open/close and hotkey behavior, plus an observational onSearchChange
          hook — all on the main thread.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <HydratedSearchExample
          containerHtml={expandHtml}
          description="Expands folders containing matches but keeps all items visible. Type to filter, use Escape to close, and ArrowUp/ArrowDown to move through matches."
          options={{
            ...baseOptions,
            fileTreeSearchMode: 'expand-matches',
            id: 'pst-search-expand',
            search: true,
          }}
          title="expand-matches"
        />
        <HydratedSearchExample
          containerHtml={collapseHtml}
          description="Collapses folders not containing matches while keeping the full tree visible. This mirrors the current baseline behavior in older trees."
          options={{
            ...baseOptions,
            fileTreeSearchMode: 'collapse-non-matches',
            id: 'pst-search-collapse',
            search: true,
          }}
          title="collapse-non-matches"
        />
        <HydratedSearchExample
          containerHtml={hideHtml}
          description="Hides rows that are neither matches nor ancestors of matches. This is the path-store parity target for the existing hide-non-matches mode."
          options={{
            ...baseOptions,
            fileTreeSearchMode: 'hide-non-matches',
            id: 'pst-search-hide',
            search: true,
          }}
          title="hide-non-matches"
        />
        <HydratedSearchExample
          containerHtml={hiddenHtml}
          controls={
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-sm border px-2 py-1 text-xs"
                style={{ borderColor: 'var(--color-border)' }}
                onClick={() => {
                  hiddenTreeRef.current?.openSearch('worker');
                }}
              >
                Open hidden search
              </button>
              <button
                type="button"
                className="rounded-sm border px-2 py-1 text-xs"
                style={{ borderColor: 'var(--color-border)' }}
                onClick={() => {
                  hiddenTreeRef.current?.closeSearch();
                }}
              >
                Close hidden search
              </button>
            </div>
          }
          description="Built-in input hidden, but the underlying programmatic session still works. This proves the legacy hidden-input behavior remains available without a fully controlled input model."
          onTreeReady={(tree) => {
            hiddenTreeRef.current = tree;
          }}
          options={{
            ...baseOptions,
            fileTreeSearchMode: 'hide-non-matches',
            id: 'pst-search-hidden',
            initialSearchQuery: null,
            search: false,
          }}
          title="hidden built-in input"
        />
      </div>
    </div>
  );
}
