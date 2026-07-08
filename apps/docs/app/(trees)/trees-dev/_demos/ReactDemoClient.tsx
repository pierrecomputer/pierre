'use client';

import type {
  ContextMenuItem,
  ContextMenuOpenContext,
  FileTreeOptions as DemoFileTreeOptions,
} from '@pierre/trees';
import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
  useFileTreeSearch,
  useFileTreeSelection,
} from '@pierre/trees/react';
import { useWindowScrollLock } from '@trees/_lib/useWindowScrollLock';
import { useState } from 'react';

import { ExampleCard } from '../_components/ExampleCard';
import {
  getContextMenuSideOffset,
  getFloatingContextMenuTriggerStyle,
} from '../_lib/getFloatingContextMenuTriggerStyle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ReactDemoClientProps {
  flattenEmptyDirectories: boolean;
  paths: readonly string[];
  preloadedData: FileTreePreloadedData;
  viewportHeight: number;
}

// Portals the client demo menu so the right-column example stays visible even
// when the row itself sits close to the viewport edge.
function ClientRenderedContextMenu({
  context,
  item,
}: {
  context: Pick<
    ContextMenuOpenContext,
    'anchorRect' | 'close' | 'restoreFocus'
  >;
  item: ContextMenuItem;
}) {
  // Keep the portaled menu anchored: the tree already blocks its own pane's
  // scroll, and this blocks the window-level scroll the page owns.
  useWindowScrollLock();
  const itemType = item.kind === 'directory' ? 'Folder' : 'File';

  return (
    <DropdownMenu
      open
      modal={false}
      onOpenChange={(open) => !open && context.close()}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          style={getFloatingContextMenuTriggerStyle(context.anchorRect)}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-file-tree-context-menu-root="true"
        data-test-react-context-menu="true"
        align="start"
        side="bottom"
        sideOffset={getContextMenuSideOffset(context.anchorRect)}
        className="min-w-[220px]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          context.restoreFocus();
        }}
      >
        <DropdownMenuLabel className="max-w-[280px] truncate">
          {itemType}: {item.path}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            context.close();
          }}
        >
          Inspect selection
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ClientRenderedExample({
  flattenEmptyDirectories,
  paths,
  viewportHeight,
}: Pick<
  ReactDemoClientProps,
  'flattenEmptyDirectories' | 'paths' | 'viewportHeight'
>) {
  const firstScrollPath = 'src/';
  const middleScrollPath = 'src/components/feature-13.ts';
  const lastScrollPath = 'README.md';
  const initialActivePath = paths.at(-1) ?? null;
  const { model } = useFileTree({
    flattenEmptyDirectories,
    initialExpansion: 'open',
    initialSelectedPaths:
      initialActivePath == null ? undefined : [initialActivePath],
    paths,
    search: true,
    initialVisibleRowCount: viewportHeight / 30,
  });
  const search = useFileTreeSearch(model);
  const selectedPaths = useFileTreeSelection(model);
  const [addedCount, setAddedCount] = useState(0);
  const [headerClicks, setHeaderClicks] = useState(0);
  const [lastAddedPath, setLastAddedPath] = useState<string | null>(null);
  const [lastScrolledPath, setLastScrolledPath] = useState<string | null>(null);
  const [scrollToShouldFocus, setScrollToShouldFocus] = useState(true);
  const scrollToPath = (path: string | null): void => {
    if (path == null) {
      return;
    }
    model.scrollToPath(path, { focus: scrollToShouldFocus, offset: 'center' });
    setLastScrolledPath(path);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-600">
        Initial active path: {initialActivePath ?? '—'}. Selected paths:{' '}
        {selectedPaths.length}. Search value:{' '}
        {search.value.length > 0 ? search.value : '—'}. Last added:{' '}
        {lastAddedPath ?? '—'}. Last scrollTo: {lastScrolledPath ?? '—'}.
      </p>
      <FileTree
        model={model}
        renderContextMenu={(item, context) => (
          <ClientRenderedContextMenu context={context} item={item} />
        )}
        style={{ height: `${String(viewportHeight)}px` }}
        header={
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <strong>Header clicks {headerClicks}</strong>
            <button
              type="button"
              className="rounded-md border px-2 py-1"
              onClick={() => {
                setHeaderClicks((previousCount) => previousCount + 1);
              }}
            >
              Click header
            </button>
            <button
              type="button"
              className="rounded-md border px-2 py-1"
              onClick={() => {
                const nextCount = addedCount + 1;
                const nextPath = `demo-note-${String(nextCount)}.md`;
                setAddedCount(nextCount);
                setLastAddedPath(nextPath);
                model.add(nextPath);
                model.focusPath(nextPath);
              }}
            >
              Add file
            </button>
            <label className="flex items-center gap-1 rounded-md border px-2 py-1">
              <input
                type="checkbox"
                checked={scrollToShouldFocus}
                onChange={(event) => {
                  setScrollToShouldFocus(event.currentTarget.checked);
                }}
              />
              Focus on scroll
            </label>
            <button
              type="button"
              className="rounded-md border px-2 py-1"
              title={firstScrollPath}
              onClick={() => {
                scrollToPath(firstScrollPath);
              }}
            >
              Scroll first
            </button>
            <button
              type="button"
              className="rounded-md border px-2 py-1"
              title={middleScrollPath}
              onClick={() => {
                scrollToPath(middleScrollPath);
              }}
            >
              Scroll middle
            </button>
            <button
              type="button"
              className="rounded-md border px-2 py-1"
              title={lastScrollPath}
              onClick={() => {
                scrollToPath(lastScrollPath);
              }}
            >
              Scroll last
            </button>
            <button
              type="button"
              className="rounded-md border px-2 py-1"
              onClick={() => {
                search.open('button');
              }}
            >
              Search “button”
            </button>
            <button
              type="button"
              className="rounded-md border px-2 py-1"
              onClick={() => {
                search.setValue(null);
              }}
            >
              Clear search
            </button>
          </div>
        }
      />
    </div>
  );
}

function SsrHydratedHeader() {
  const [count, setCount] = useState(0);

  return (
    <button
      data-trees-react-ssr-header
      type="button"
      className="rounded-md border px-2 py-1 text-sm"
      onClick={() => {
        setCount((previousCount) => previousCount + 1);
      }}
    >
      Header clicks {count}
    </button>
  );
}

function ServerRenderedExample({
  flattenEmptyDirectories,
  paths,
  preloadedData,
  viewportHeight,
}: ReactDemoClientProps) {
  const { model } = useFileTree({
    flattenEmptyDirectories,
    initialExpansion: 'open',
    paths,
    search: true,
    initialVisibleRowCount: viewportHeight / 30,
  } satisfies DemoFileTreeOptions);

  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-600">
        The server preloads declarative shadow DOM, and the colocated React
        file-tree client hydrates it from one packaged{' '}
        <code>preloadedData</code>
        prop.
      </p>
      <FileTree
        header={<SsrHydratedHeader />}
        model={model}
        preloadedData={preloadedData}
      />
    </div>
  );
}

export function ReactDemoClient(props: ReactDemoClientProps) {
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">React</h1>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ExampleCard
          title="Server rendered"
          description="The server preloads the tree once, and the React wrapper hydrates the same DOM without a parallel API surface."
        >
          <ServerRenderedExample {...props} />
        </ExampleCard>
        <ExampleCard
          title="Client rendered"
          description="Model-first React hook usage with selector hooks, direct mutations, and the same composition surface the server-rendered example hydrates."
        >
          <ClientRenderedExample
            flattenEmptyDirectories={props.flattenEmptyDirectories}
            paths={props.paths}
            viewportHeight={props.viewportHeight}
          />
        </ExampleCard>
      </div>
    </>
  );
}
