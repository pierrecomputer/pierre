'use client';

import type { FileTreeOptions } from '@pierre/file-tree';
import { FileTree } from '@pierre/file-tree';
import { FileTree as FileTreeReact } from '@pierre/file-tree/react';
import {
  startTransition,
  useCallback,
  useEffect,
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
import { sharedDemoFileTreeOptions } from './demo-data';

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
    <div className="m-4">
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
      <div className="grid grid-cols-2 gap-6">
        <ExampleCard
          title="Vanilla (Client-Side Rendered)"
          description="FileTree instance created and rendered entirely on the client"
        >
          <VanillaClientRendered options={fileTreeOptions} />
        </ExampleCard>

        <ExampleCard
          title="Vanilla (Server-Side Rendered)"
          description="HTML prerendered on server, hydrated with FileTree instance on client"
        >
          <VanillaServerRendered
            options={fileTreeOptions}
            prerenderedHTML={preloadedFileTreeHtml}
          />
        </ExampleCard>

        <ExampleCard
          title="React (Client-Side Rendered)"
          description="React FileTree component rendered entirely on the client"
        >
          <ReactClientRendered options={fileTreeOptions} />
        </ExampleCard>

        <ExampleCard
          title="React (Server-Side Rendered)"
          description="React FileTree with prerendered HTML, hydrated on client"
        >
          <ReactServerRendered
            options={fileTreeOptions}
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
      <div className="grid grid-cols-3 gap-6">
        <ExampleCard
          title="Vanilla (SSR) — Imperative State"
          description="Vanilla FileTree hydrated from SSR, with imperative expand/collapse and state change logging"
        >
          <VanillaSSRState
            options={fileTreeOptions}
            prerenderedHTML={preloadedFileTreeHtml}
          />
        </ExampleCard>

        <ExampleCard
          title="React (SSR) — Uncontrolled"
          description="React FileTree with SSR, using onExpandedItemsChange to observe state without controlling it"
        >
          <ReactSSRUncontrolled
            options={fileTreeOptions}
            prerenderedHTML={preloadedFileTreeHtml}
          />
        </ExampleCard>

        <ExampleCard
          title="React (SSR) — Controlled"
          description="React FileTree with SSR, expandedItems fully controlled by React state"
        >
          <ReactSSRControlled
            options={fileTreeOptions}
            prerenderedHTML={preloadedFileTreeHtml}
          />
        </ExampleCard>
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
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="text-sm font-bold">{title}</h2>
      <p className="text-muted-foreground mb-2 text-xs">{description}</p>
      <div
        className="overflow-hidden rounded-md p-5"
        style={{
          boxShadow: '0 0 0 1px var(--color-border), 0 1px 3px #0000000d',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Vanilla FileTree - Client-Side Rendered
 * Uses ref callback to create and render FileTree instance on client mount
 */
function VanillaClientRendered({ options }: { options: FileTreeOptions }) {
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

      const fileTree = new FileTree(options);
      fileTree.render({ containerWrapper: node });
      instanceRef.current = fileTree;

      return () => {
        fileTree.cleanUp();
        instanceRef.current = null;
      };
    },
    [options]
  );

  return <div ref={ref} />;
}

/**
 * Vanilla FileTree - Server-Side Rendered
 * Uses declarative shadow DOM to prerender HTML, then hydrates with FileTree instance
 */
function VanillaServerRendered({
  options,
  prerenderedHTML,
}: {
  options: FileTreeOptions;
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

      const fileTree = new FileTree(options);

      if (!hasHydratedRef.current) {
        // Initial mount - hydrate the prerendered HTML
        fileTree.hydrate({
          fileTreeContainer,
          prerenderedHTML,
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
    [options, prerenderedHTML]
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
function ReactClientRendered({ options }: { options: FileTreeOptions }) {
  return <FileTreeReact options={options} />;
}

/**
 * React FileTree - Server-Side Rendered
 * Uses prerendered HTML for SSR, hydrates on client
 */
function ReactServerRendered({
  options,
  prerenderedHTML,
}: {
  options: FileTreeOptions;
  prerenderedHTML: string;
}) {
  return <FileTreeReact options={options} prerenderedHTML={prerenderedHTML} />;
}

/**
 * Shared log display component for state change events
 */
function StateLog({ entries }: { entries: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [entries]);
  return (
    <div
      ref={ref}
      className="mt-2 h-24 overflow-y-auto rounded border p-2 font-mono text-xs"
      style={{ borderColor: 'var(--color-border)' }}
    >
      {entries.length === 0 ? (
        <span className="text-muted-foreground italic">
          Interact with the tree to see state changes…
        </span>
      ) : (
        entries.map((entry, i) => <div key={i}>{entry}</div>)
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
  prerenderedHTML,
}: {
  options: FileTreeOptions;
  prerenderedHTML: string;
}) {
  const instanceRef = useRef<FileTree | null>(null);
  const hasHydratedRef = useRef(false);
  const [log, setLog] = useState<string[]>([]);

  const addLog = useCallback((msg: string) => {
    setLog((prev) => [...prev.slice(-49), msg]);
  }, []);

  const stateOptions = useMemo<FileTreeOptions>(
    () => ({
      ...options,
      onExpandedItemsChange: (items) =>
        addLog(`expanded: [${items.join(', ')}]`),
      onSelectedItemsChange: (items) =>
        addLog(`selected: [${items.join(', ')}]`),
    }),
    [options, addLog]
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

      const fileTree = new FileTree(stateOptions);

      if (!hasHydratedRef.current) {
        fileTree.hydrate({
          fileTreeContainer,
          prerenderedHTML,
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
    [stateOptions, prerenderedHTML]
  );

  return (
    <>
      <div className="mb-2 flex gap-2">
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
      </div>
      <file-tree-container
        ref={ref}
        dangerouslySetInnerHTML={{
          __html: `<template shadowrootmode="open">${prerenderedHTML}</template>`,
        }}
        suppressHydrationWarning
      />
      <StateLog entries={log} />
    </>
  );
}

/**
 * React FileTree - SSR Uncontrolled
 * Uses onExpandedItemsChange/onSelectedItemsChange to observe state
 * without controlling it — tree manages its own state internally.
 */
function ReactSSRUncontrolled({
  options,
  prerenderedHTML,
}: {
  options: FileTreeOptions;
  prerenderedHTML: string;
}) {
  const [log, setLog] = useState<string[]>([]);
  const addLog = useCallback((msg: string) => {
    setLog((prev) => [...prev.slice(-49), msg]);
  }, []);

  return (
    <>
      <FileTreeReact
        options={options}
        prerenderedHTML={prerenderedHTML}
        onExpandedItemsChange={(items) =>
          addLog(`expanded: [${items.join(', ')}]`)
        }
        onSelectedItemsChange={(items) =>
          addLog(`selected: [${items.join(', ')}]`)
        }
      />
      <StateLog entries={log} />
    </>
  );
}

/**
 * React FileTree - SSR Controlled
 * Parent React component owns expandedItems state.
 * onExpandedItemsChange updates the React state, which flows back into the tree.
 * Buttons allow programmatic state changes from outside the tree.
 */
function ReactSSRControlled({
  options,
  prerenderedHTML,
}: {
  options: FileTreeOptions;
  prerenderedHTML: string;
}) {
  const [expandedItems, setExpandedItems] = useState<string[]>(
    options.defaultExpandedItems ?? []
  );
  const [log, setLog] = useState<string[]>([]);
  const addLog = useCallback((msg: string) => {
    setLog((prev) => [...prev.slice(-49), msg]);
  }, []);

  const handleExpandedChange = useCallback(
    (items: string[]) => {
      setExpandedItems(items);
      addLog(`expanded: [${items.join(', ')}]`);
    },
    [addLog]
  );

  return (
    <>
      <div className="mb-2 flex gap-2">
        <button
          type="button"
          className="rounded-sm border px-2 py-1 text-xs"
          style={{ borderColor: 'var(--color-border)' }}
          onClick={() =>
            handleExpandedChange([...expandedItems, 'src/components'])
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
      </div>
      <FileTreeReact
        options={options}
        prerenderedHTML={prerenderedHTML}
        expandedItems={expandedItems}
        onExpandedItemsChange={handleExpandedChange}
      />
      <StateLog entries={log} />
    </>
  );
}
