'use client';

import '@pierre/trees/web-components';
import type { FileTreeOptions, FileTreeStateConfig } from '@pierre/trees';
import { FileTree } from '@pierre/trees';
import { expandImplicitParentDirectories } from '@pierre/trees';
import { FileTree as FileTreeReact } from '@pierre/trees/react';
import {
  startTransition,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  FILE_TREE_COOKIE_FLATTEN,
  FILE_TREE_COOKIE_LAZY,
  FILE_TREE_COOKIE_VERSION,
  FILE_TREE_COOKIE_VERSION_NAME,
} from './cookies';
import { sharedDemoFileTreeOptions, sharedDemoStateConfig } from './demo-data';

interface ClientPageProps {
  preloadedFileTreeHtml: string;
  initialFlattenEmptyDirectories?: boolean;
  initialUseLazyDataLoader?: boolean;
}

export function ClientPage({
  preloadedFileTreeHtml,
  initialFlattenEmptyDirectories,
  initialUseLazyDataLoader,
}: ClientPageProps) {
  const defaultFlattenEmptyDirectories =
    sharedDemoFileTreeOptions.flattenEmptyDirectories ?? false;
  const defaultUseLazyDataLoader =
    sharedDemoFileTreeOptions.useLazyDataLoader ?? false;
  const [flattenEmptyDirectories, setFlattenEmptyDirectories] = useState(
    initialFlattenEmptyDirectories ?? defaultFlattenEmptyDirectories
  );
  const [useLazyDataLoader, setUseLazyDataLoader] = useState(
    initialUseLazyDataLoader ?? defaultUseLazyDataLoader
  );
  const skipCookieWriteRef = useRef(false);

  const fileTreeOptions = useMemo<FileTreeOptions>(
    () => ({
      ...sharedDemoFileTreeOptions,
      flattenEmptyDirectories,
      useLazyDataLoader,
    }),
    [flattenEmptyDirectories, useLazyDataLoader]
  );

  const handleToggleFlatten = () => {
    startTransition(() => {
      setFlattenEmptyDirectories((prev: boolean) => !prev);
    });
  };
  const handleToggleLazyLoader = () => {
    startTransition(() => {
      setUseLazyDataLoader((prev: boolean) => !prev);
    });
  };
  const handleResetControls = () => {
    skipCookieWriteRef.current = true;
    const clearCookie = (name: string) => {
      document.cookie = `${name}=; path=/; max-age=0`;
    };
    clearCookie(FILE_TREE_COOKIE_VERSION_NAME);
    clearCookie(FILE_TREE_COOKIE_FLATTEN);
    clearCookie(FILE_TREE_COOKIE_LAZY);
    startTransition(() => {
      setFlattenEmptyDirectories(defaultFlattenEmptyDirectories);
      setUseLazyDataLoader(defaultUseLazyDataLoader);
    });
  };

  const cookieMaxAge = 60 * 60 * 24 * 365;
  useEffect(() => {
    if (skipCookieWriteRef.current) {
      skipCookieWriteRef.current = false;
      return;
    }
    const cookieSuffix = `; path=/; max-age=${cookieMaxAge}`;
    document.cookie = `${FILE_TREE_COOKIE_VERSION_NAME}=${FILE_TREE_COOKIE_VERSION}${cookieSuffix}`;
    document.cookie = `${FILE_TREE_COOKIE_FLATTEN}=${
      flattenEmptyDirectories ? '1' : '0'
    }${cookieSuffix}`;
    document.cookie = `${FILE_TREE_COOKIE_LAZY}=${
      useLazyDataLoader ? '1' : '0'
    }${cookieSuffix}`;
  }, [cookieMaxAge, flattenEmptyDirectories, useLazyDataLoader]);

  return (
    <div className="m-4 pb-[800px]">
      <h1 className="mb-4 text-2xl font-bold">File Tree Examples</h1>

      {/* Controls */}
      <div
        className="mb-6 rounded-sm border p-4"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <h4 className="text-lg font-bold">Controls</h4>
        <div className="flex flex-row gap-2">
          <label
            htmlFor="flatten-empty-directories"
            className="flex cursor-pointer items-center gap-2 select-none"
          >
            <input
              type="checkbox"
              id="flatten-empty-directories"
              checked={flattenEmptyDirectories}
              className="cursor-pointer"
              onChange={handleToggleFlatten}
            />
            Flatten Empty Directories
          </label>
          <label
            htmlFor="lazy-data-loader"
            className="flex cursor-pointer items-center gap-2 select-none"
          >
            <input
              type="checkbox"
              id="lazy-data-loader"
              checked={useLazyDataLoader}
              className="cursor-pointer"
              onChange={handleToggleLazyLoader}
            />
            Lazy Loader
          </label>
          <button
            type="button"
            className="ml-auto rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={handleResetControls}
          >
            Reset to Defaults
          </button>
        </div>
      </div>

      {/* Examples Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <ExampleCard
          title="Vanilla (Client-Side Rendered)"
          description="FileTree instance created and rendered entirely on the client"
        >
          <VanillaClientRendered
            options={fileTreeOptions}
            stateConfig={sharedDemoStateConfig}
          />
        </ExampleCard>

        <ExampleCard
          title="Vanilla (Server-Side Rendered)"
          description="HTML prerendered on server, hydrated with FileTree instance on client"
        >
          <VanillaServerRendered
            options={fileTreeOptions}
            stateConfig={sharedDemoStateConfig}
            prerenderedHTML={preloadedFileTreeHtml}
          />
        </ExampleCard>

        <ExampleCard
          title="React (Client-Side Rendered)"
          description="React FileTree component rendered entirely on the client"
        >
          <ReactClientRendered
            options={fileTreeOptions}
            stateConfig={sharedDemoStateConfig}
          />
        </ExampleCard>

        <ExampleCard
          title="React (Server-Side Rendered)"
          description="React FileTree with prerendered HTML, hydrated on client"
        >
          <ReactServerRendered
            options={fileTreeOptions}
            stateConfig={sharedDemoStateConfig}
            prerenderedHTML={preloadedFileTreeHtml}
          />
        </ExampleCard>
      </div>

      {/* Divider */}
      <hr className="my-8" style={{ borderColor: 'var(--color-border)' }} />

      {/* State Management Examples */}
      <h2 id="state" className="mb-4 text-2xl font-bold">
        State
      </h2>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <VanillaSSRState
          options={fileTreeOptions}
          stateConfig={sharedDemoStateConfig}
          prerenderedHTML={preloadedFileTreeHtml}
        />
        <ReactSSRUncontrolled
          options={fileTreeOptions}
          stateConfig={sharedDemoStateConfig}
          prerenderedHTML={preloadedFileTreeHtml}
        />
        <ReactSSRControlled
          options={fileTreeOptions}
          stateConfig={sharedDemoStateConfig}
          prerenderedHTML={preloadedFileTreeHtml}
        />
      </div>
    </div>
  );
}

/**
 * Card wrapper for each example
 */
function ExampleCard({
  title,
  description,
  children,
  controls,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  controls?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="@container/card">
      <h2 className="text-sm font-bold">{title}</h2>
      <p className="text-muted-foreground mb-2 min-h-[3rem] text-xs">
        {description}
      </p>
      {controls !== undefined && (
        <div className="mb-2 h-[68px]">{controls}</div>
      )}
      <div
        className="overflow-hidden rounded-md p-5"
        style={{
          boxShadow: '0 0 0 1px var(--color-border), 0 1px 3px #0000000d',
        }}
      >
        {children}
      </div>
      {footer}
    </div>
  );
}

/**
 * Vanilla FileTree - Client-Side Rendered
 * Uses ref callback to create and render FileTree instance on client mount
 */
function VanillaClientRendered({
  options,
  stateConfig,
}: {
  options: FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
}) {
  const instanceRef = useRef<FileTree | null>(null);

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (node == null) {
        return;
      }

      // Clean up previous instance on options change
      if (instanceRef.current != null) {
        instanceRef.current.cleanUp();
        node.innerHTML = '';
      }

      const fileTree = new FileTree(options, stateConfig);
      fileTree.render({ containerWrapper: node });
      instanceRef.current = fileTree;

      return () => {
        fileTree.cleanUp();
        instanceRef.current = null;
      };
    },
    [options, stateConfig]
  );

  return <div ref={ref} />;
}

/**
 * Vanilla FileTree - Server-Side Rendered
 * Uses declarative shadow DOM to prerender HTML, then hydrates with FileTree instance
 */
function VanillaServerRendered({
  options,
  stateConfig,
  prerenderedHTML,
}: {
  options: FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
  prerenderedHTML: string;
}) {
  const instanceRef = useRef<FileTree | null>(null);
  const hasHydratedRef = useRef(false);

  const ref = useCallback(
    (node: HTMLElement | null) => {
      if (node == null) {
        return;
      }

      // The ref is on the <file-tree-container> custom element itself
      const fileTreeContainer = node;

      // Clean up previous instance on options change
      if (instanceRef.current != null) {
        instanceRef.current.cleanUp();
        // Clear the shadow root content for re-render
        const shadowRoot = fileTreeContainer.shadowRoot;
        if (shadowRoot !== null) {
          const treeElement = Array.from(shadowRoot.children).find(
            (child): child is HTMLElement =>
              child instanceof HTMLElement && child.dataset?.fileTreeId != null
          );
          treeElement?.replaceChildren();
        }
      }

      const fileTree = new FileTree(options, stateConfig);

      if (!hasHydratedRef.current) {
        // Initial mount - hydrate the prerendered HTML
        fileTree.hydrate({
          fileTreeContainer,
        });
        hasHydratedRef.current = true;
      } else {
        // Options changed - re-render
        fileTree.render({ fileTreeContainer });
      }

      instanceRef.current = fileTree;

      return () => {
        fileTree.cleanUp();
        instanceRef.current = null;
      };
    },
    [options, stateConfig]
  );

  return (
    <file-tree-container
      ref={ref}
      dangerouslySetInnerHTML={{
        __html: `<template shadowrootmode="open">${prerenderedHTML}</template>`,
      }}
      suppressHydrationWarning
    />
  );
}

/**
 * React FileTree - Client-Side Rendered
 * No prerendered HTML, renders entirely on client
 */
function ReactClientRendered({
  options,
  stateConfig,
}: {
  options: FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
}) {
  return (
    <FileTreeReact
      options={options}
      defaultExpandedItems={stateConfig?.defaultExpandedItems}
      defaultSelectedItems={stateConfig?.defaultSelectedItems}
      onSelection={stateConfig?.onSelection}
    />
  );
}

/**
 * React FileTree - Server-Side Rendered
 * Uses prerendered HTML for SSR, hydrates on client
 */
function ReactServerRendered({
  options,
  stateConfig,
  prerenderedHTML,
}: {
  options: FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
  prerenderedHTML: string;
}) {
  const containerId = useId();
  return (
    <>
      <file-tree-container
        id={containerId}
        dangerouslySetInnerHTML={{
          __html: `<template shadowrootmode="open">${prerenderedHTML}</template>`,
        }}
        suppressHydrationWarning
      />
      <FileTreeReact
        containerId={containerId}
        options={options}
        defaultExpandedItems={stateConfig?.defaultExpandedItems}
        defaultSelectedItems={stateConfig?.defaultSelectedItems}
        onSelection={stateConfig?.onSelection}
      />
    </>
  );
}

/**
 * Shared log display component for state change events
 */
function useStateLog() {
  const [log, setLog] = useState<string[]>([]);

  const addLog = useCallback((msg: string) => {
    setLog((prev) => [...prev.slice(-49), msg]);
  }, []);

  return { log, addLog };
}

function StateLog({
  entries,
  className,
}: {
  entries: string[];
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current != null) ref.current.scrollTop = ref.current.scrollHeight;
  }, [entries]);

  const boldIndices = useMemo(() => {
    const indices = new Set<number>();
    const seen = new Set<string>();
    for (let i = entries.length - 1; i >= 0; i--) {
      const prefix = entries[i].split(':')[0];
      if (!seen.has(prefix)) {
        seen.add(prefix);
        indices.add(i);
      }
    }
    return indices;
  }, [entries]);

  return (
    <div
      ref={ref}
      className={
        className ??
        'mt-2 h-24 overflow-y-auto rounded border p-2 font-mono text-xs'
      }
      style={{ borderColor: 'var(--color-border)' }}
    >
      {entries.length === 0 ? (
        <span className="text-muted-foreground italic">
          Interact with the tree to see state changes…
        </span>
      ) : (
        entries.map((entry, i) => (
          <div key={i} className={boldIndices.has(i) ? 'font-bold' : ''}>
            {entry}
          </div>
        ))
      )}
    </div>
  );
}

/**
 * Vanilla FileTree - SSR with imperative state management
 * Hydrates from SSR, attaches state change callbacks, and provides
 * buttons to expand/collapse programmatically.
 */
function VanillaSSRState({
  options,
  stateConfig,
  prerenderedHTML,
}: {
  options: FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
  prerenderedHTML: string;
}) {
  const instanceRef = useRef<FileTree | null>(null);
  const hasHydratedRef = useRef(false);
  const { log, addLog } = useStateLog();

  const mergedStateConfig = useMemo<FileTreeStateConfig>(
    () => ({
      ...stateConfig,
      onExpandedItemsChange: (items) => {
        addLog(`expanded: [${items.join(', ')}]`);
      },
      onSelectedItemsChange: (items) => {
        addLog(`selected: [${items.join(', ')}]`);
      },
    }),
    [stateConfig, addLog]
  );

  const ref = useCallback(
    (node: HTMLElement | null) => {
      if (node == null) {
        return;
      }

      const fileTreeContainer = node;

      if (instanceRef.current != null) {
        instanceRef.current.cleanUp();
        const shadowRoot = fileTreeContainer.shadowRoot;
        if (shadowRoot !== null) {
          const treeElement = Array.from(shadowRoot.children).find(
            (child): child is HTMLElement =>
              child instanceof HTMLElement && child.dataset?.fileTreeId != null
          );
          treeElement?.replaceChildren();
        }
      }

      const fileTree = new FileTree(options, mergedStateConfig);

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
        fileTree.cleanUp();
        instanceRef.current = null;
      };
    },
    [options, mergedStateConfig]
  );

  return (
    <ExampleCard
      title="Vanilla (SSR) — Imperative State"
      description="Vanilla FileTree hydrated from SSR, with imperative expand/collapse/selection buttons and state change logging"
      controls={
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => instanceRef.current?.expandItem('src/components')}
          >
            Expand src/components
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => instanceRef.current?.collapseItem('src/components')}
          >
            Collapse src/components
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => instanceRef.current?.setSelectedItems(['README.md'])}
          >
            Select README.md
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => instanceRef.current?.setSelectedItems([])}
          >
            Clear Selection
          </button>
        </div>
      }
      footer={
        <StateLog
          entries={log}
          className="mt-3 h-[140px] overflow-y-auto rounded border p-2 font-mono text-xs"
        />
      }
    >
      <file-tree-container
        ref={ref}
        dangerouslySetInnerHTML={{
          __html: `<template shadowrootmode="open">${prerenderedHTML}</template>`,
        }}
        suppressHydrationWarning
      />
    </ExampleCard>
  );
}

/**
 * React FileTree - SSR Uncontrolled
 * Uses onExpandedItemsChange/onSelectedItemsChange to observe state
 * without controlling it — tree manages its own state internally.
 */
function ReactSSRUncontrolled({
  options,
  stateConfig,
  prerenderedHTML,
}: {
  options: FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
  prerenderedHTML: string;
}) {
  const { log, addLog } = useStateLog();
  const containerId = useId();

  return (
    <ExampleCard
      title="React (SSR) — Uncontrolled"
      description="React FileTree with SSR, using onExpandedItemsChange to observe state without controlling it"
      controls={null}
      footer={
        <StateLog
          entries={log}
          className="mt-3 h-[140px] overflow-y-auto rounded border p-2 font-mono text-xs"
        />
      }
    >
      <file-tree-container
        id={containerId}
        dangerouslySetInnerHTML={{
          __html: `<template shadowrootmode="open">${prerenderedHTML}</template>`,
        }}
        suppressHydrationWarning
      />
      <FileTreeReact
        containerId={containerId}
        options={options}
        defaultExpandedItems={stateConfig?.defaultExpandedItems}
        defaultSelectedItems={stateConfig?.defaultSelectedItems}
        onSelection={stateConfig?.onSelection}
        onExpandedItemsChange={(items) => {
          addLog(`expanded: [${items.join(', ')}]`);
        }}
        onSelectedItemsChange={(items) => {
          addLog(`selected: [${items.join(', ')}]`);
        }}
      />
    </ExampleCard>
  );
}

/**
 * React FileTree - SSR Controlled
 * Parent React component owns expandedItems and selectedItems state.
 * onChange callbacks update React state, which flows back into the tree.
 * Buttons allow programmatic state changes from outside the tree.
 */
function ReactSSRControlled({
  options,
  stateConfig,
  prerenderedHTML,
}: {
  options: FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
  prerenderedHTML: string;
}) {
  const [expandedItems, setExpandedItems] = useState<string[]>(() =>
    expandImplicitParentDirectories(stateConfig?.defaultExpandedItems ?? [])
  );
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const { log, addLog } = useStateLog();
  const containerId = useId();

  const handleExpandedChange = useCallback(
    (items: string[]) => {
      setExpandedItems(items);
      addLog(`expanded: [${items.join(', ')}]`);
    },
    [addLog]
  );

  const handleSelectedChange = useCallback(
    (items: string[]) => {
      setSelectedItems(items);
      addLog(`selected: [${items.join(', ')}]`);
    },
    [addLog]
  );

  return (
    <ExampleCard
      title="React (SSR) — Controlled"
      description="React FileTree with SSR, expandedItems and selectedItems fully controlled by React state"
      controls={
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() =>
              handleExpandedChange(
                expandImplicitParentDirectories([
                  ...expandedItems,
                  'src/components',
                ])
              )
            }
          >
            Expand src/components
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => handleExpandedChange([])}
          >
            Collapse All
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => handleSelectedChange(['README.md'])}
          >
            Select README.md
          </button>
          <button
            type="button"
            className="rounded-sm border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => handleSelectedChange([])}
          >
            Clear Selection
          </button>
        </div>
      }
      footer={
        <StateLog
          entries={log}
          className="mt-3 h-[140px] overflow-y-auto rounded border p-2 font-mono text-xs"
        />
      }
    >
      <file-tree-container
        id={containerId}
        dangerouslySetInnerHTML={{
          __html: `<template shadowrootmode="open">${prerenderedHTML}</template>`,
        }}
        suppressHydrationWarning
      />
      <FileTreeReact
        containerId={containerId}
        options={options}
        onSelection={stateConfig?.onSelection}
        expandedItems={expandedItems}
        onExpandedItemsChange={handleExpandedChange}
        selectedItems={selectedItems}
        onSelectedItemsChange={handleSelectedChange}
      />
    </ExampleCard>
  );
}
