'use client';

import { FileTree } from '@pierre/trees';
import type { ReactNode } from 'react';
import { memo, useEffect, useMemo, useRef } from 'react';

import { ExampleCard } from '../_components/ExampleCard';
import { StateLog, useStateLog } from '../_components/StateLog';
import type { FileTreePathOptions } from '@/lib/fileTreePathOptions';

interface SearchExampleProps {
  containerHtml: string;
  controls?: ReactNode;
  description: string;
  onTreeReady?: (tree: FileTree | null) => void;
  options: FileTreePathOptions;
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

    const fileTree = new FileTree({
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
        style={{ height: '260px' }}
        dangerouslySetInnerHTML={{ __html: containerHtml }}
        suppressHydrationWarning
      />
      <StateLog entries={log} />
    </ExampleCard>
  );
});

export function SearchDemoClient({
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
    FileTreePathOptions,
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
      initialVisibleRowCount: 260 / 30,
    }),
    [sharedOptions]
  );
  const hiddenTreeRef = useRef<FileTree | null>(null);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Search</h1>
        <p className="text-muted-foreground max-w-3xl text-sm leading-6">
          The canonical tree keeps the three search modes, built-in input,
          session behavior, keyboard navigation, and an observable
          <code>onSearchChange</code> hook on the same file-tree model.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <HydratedSearchExample
          containerHtml={expandHtml}
          description="Expands folders containing matches but keeps all items visible. Type to filter, use Escape to close, and ArrowUp/ArrowDown to move through matches."
          options={{
            ...baseOptions,
            fileTreeSearchMode: 'expand-matches',
            id: 'trees-search-expand',
            search: true,
          }}
          title="expand-matches"
        />
        <HydratedSearchExample
          containerHtml={collapseHtml}
          description="Collapses folders not containing matches while keeping the full tree visible."
          options={{
            ...baseOptions,
            fileTreeSearchMode: 'collapse-non-matches',
            id: 'trees-search-collapse',
            search: true,
          }}
          title="collapse-non-matches"
        />
        <HydratedSearchExample
          containerHtml={hideHtml}
          description="Hides rows that are neither matches nor ancestors of matches."
          options={{
            ...baseOptions,
            fileTreeSearchMode: 'hide-non-matches',
            id: 'trees-search-hide',
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
          description="The built-in input can stay hidden while the underlying programmatic search session remains available."
          onTreeReady={(tree) => {
            hiddenTreeRef.current = tree;
          }}
          options={{
            ...baseOptions,
            fileTreeSearchMode: 'hide-non-matches',
            id: 'trees-search-hidden',
            initialSearchQuery: null,
            search: false,
          }}
          title="hidden built-in input"
        />
      </div>
    </div>
  );
}
