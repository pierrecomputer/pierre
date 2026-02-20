'use client';

import { expandImplicitParentDirectories, FileTree } from '@pierre/trees';
import type { FileTreeOptions, FileTreeStateConfig } from '@pierre/trees';
import { FileTree as FileTreeReact } from '@pierre/trees/react';
import '@pierre/trees/web-components';
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
import {
  GIT_STATUSES_A,
  GIT_STATUSES_B,
  sharedDemoFileTreeOptions,
  sharedDemoStateConfig,
} from './demo-data';

interface ClientPageProps {
  preloadedFileTreeHtml: string;
  preloadedFileTreeContainerHtml: string;
  preloadedGitStatusFileTreeHtml: string;
  initialFlattenEmptyDirectories?: boolean;
  initialUseLazyDataLoader?: boolean;
}

export function ClientPage({
  preloadedFileTreeHtml,
  preloadedFileTreeContainerHtml,
  preloadedGitStatusFileTreeHtml,
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

  // For React components, separate initialFiles from options
  const { initialFiles: reactFiles, ...reactOptions } = fileTreeOptions;

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
            containerHtml={preloadedFileTreeContainerHtml}
          />
        </ExampleCard>

        <ExampleCard
          title="React (Client-Side Rendered)"
          description="React FileTree component rendered entirely on the client"
        >
          <ReactClientRendered
            options={reactOptions}
            initialFiles={reactFiles}
            stateConfig={sharedDemoStateConfig}
          />
        </ExampleCard>

        <ExampleCard
          title="React (Server-Side Rendered)"
          description="React FileTree with prerendered HTML, hydrated on client"
        >
          <ReactServerRendered
            options={reactOptions}
            initialFiles={reactFiles}
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
          containerHtml={preloadedFileTreeContainerHtml}
        />
        <ReactSSRUncontrolled
          options={reactOptions}
          initialFiles={reactFiles}
          stateConfig={sharedDemoStateConfig}
          prerenderedHTML={preloadedFileTreeHtml}
        />
        <ReactSSRControlled
          options={reactOptions}
          initialFiles={reactFiles}
          stateConfig={sharedDemoStateConfig}
          prerenderedHTML={preloadedFileTreeHtml}
        />
      </div>

      {/* Divider */}
      <hr className="my-8" style={{ borderColor: 'var(--color-border)' }} />

      {/* Dynamic Files Examples */}
      <h2 id="dynamic-files" className="mb-4 text-2xl font-bold">
        Dynamic Files
      </h2>
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

      {/* Divider */}
      <hr className="my-8" style={{ borderColor: 'var(--color-border)' }} />

      {/* Search Modes */}
      <h2 id="search-modes" className="mb-4 text-2xl font-bold">
        Search Modes
      </h2>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <ExampleCard
          title="expand-matches"
          description="Expands folders containing matches but keeps all items visible"
        >
          <ReactClientRendered
            options={{ ...reactOptions, fileTreeSearchMode: 'expand-matches' }}
            initialFiles={reactFiles}
            stateConfig={sharedDemoStateConfig}
          />
        </ExampleCard>
        <ExampleCard
          title="collapse-non-matches"
          description="Collapses folders not containing matches"
        >
          <ReactClientRendered
            options={{
              ...reactOptions,
              fileTreeSearchMode: 'collapse-non-matches',
            }}
            initialFiles={reactFiles}
            stateConfig={sharedDemoStateConfig}
          />
        </ExampleCard>
        <ExampleCard
          title="hide-non-matches"
          description="Hides files and folders that don't contain matches"
        >
          <ReactClientRendered
            options={{
              ...reactOptions,
              fileTreeSearchMode: 'hide-non-matches',
            }}
            initialFiles={reactFiles}
            stateConfig={sharedDemoStateConfig}
          />
        </ExampleCard>
      </div>

      {/* Divider */}
      <hr className="my-8" style={{ borderColor: 'var(--color-border)' }} />

      {/* Drag and Drop Examples */}
      <h2 id="drag-and-drop" className="mb-4 text-2xl font-bold">
        Drag and Drop
      </h2>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <VanillaDnDUncontrolled
          options={fileTreeOptions}
          stateConfig={sharedDemoStateConfig}
        />
        <ReactDnDControlled
          options={reactOptions}
          stateConfig={sharedDemoStateConfig}
        />
        <ReactDnDControlledSSR
          options={reactOptions}
          stateConfig={sharedDemoStateConfig}
          prerenderedHTML={preloadedFileTreeHtml}
        />
      </div>

      {/* Divider */}
      <hr className="my-8" style={{ borderColor: 'var(--color-border)' }} />

      {/* Git Status */}
      <h2 id="git-status" className="mb-4 text-2xl font-bold">
        Git Status
      </h2>
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
 * Uses declarative shadow DOM to prerender HTML, then hydrates with FileTree instance.
 * The preloadFileTree() `html` output is injected into a wrapper div — the consumer
 * doesn't need to know about <file-tree-container> or <template shadowrootmode>.
 */
function VanillaServerRendered({
  options,
  stateConfig,
  containerHtml,
}: {
  options: FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
  containerHtml: string;
}) {
  const instanceRef = useRef<FileTree | null>(null);
  const hasHydratedRef = useRef(false);

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (node == null) {
        return;
      }

      const fileTreeContainer = node.querySelector('file-tree-container');
      if (!(fileTreeContainer instanceof HTMLElement)) return;

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
    <div
      ref={ref}
      dangerouslySetInnerHTML={{ __html: containerHtml }}
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
  initialFiles,
  stateConfig,
}: {
  options: Omit<FileTreeOptions, 'initialFiles'>;
  initialFiles?: string[];
  stateConfig?: FileTreeStateConfig;
}) {
  return (
    <FileTreeReact
      options={options}
      initialFiles={initialFiles}
      initialExpandedItems={stateConfig?.initialExpandedItems}
      initialSelectedItems={stateConfig?.initialSelectedItems}
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
  initialFiles,
  stateConfig,
  prerenderedHTML,
}: {
  options: Omit<FileTreeOptions, 'initialFiles'>;
  initialFiles?: string[];
  stateConfig?: FileTreeStateConfig;
  prerenderedHTML: string;
}) {
  return (
    <FileTreeReact
      options={options}
      initialFiles={initialFiles}
      prerenderedHTML={prerenderedHTML}
      initialExpandedItems={stateConfig?.initialExpandedItems}
      initialSelectedItems={stateConfig?.initialSelectedItems}
      onSelection={stateConfig?.onSelection}
    />
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
  containerHtml,
}: {
  options: FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
  containerHtml: string;
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
    (node: HTMLDivElement | null) => {
      if (node == null) {
        return;
      }

      const fileTreeContainer = node.querySelector('file-tree-container');
      if (!(fileTreeContainer instanceof HTMLElement)) return;

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
      <div
        ref={ref}
        dangerouslySetInnerHTML={{ __html: containerHtml }}
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
  initialFiles,
  stateConfig,
  prerenderedHTML,
}: {
  options: Omit<FileTreeOptions, 'initialFiles'>;
  initialFiles?: string[];
  stateConfig?: FileTreeStateConfig;
  prerenderedHTML: string;
}) {
  const { log, addLog } = useStateLog();

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
      <FileTreeReact
        options={options}
        initialFiles={initialFiles}
        prerenderedHTML={prerenderedHTML}
        initialExpandedItems={stateConfig?.initialExpandedItems}
        initialSelectedItems={stateConfig?.initialSelectedItems}
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
  initialFiles,
  stateConfig,
  prerenderedHTML,
}: {
  options: Omit<FileTreeOptions, 'initialFiles'>;
  initialFiles?: string[];
  stateConfig?: FileTreeStateConfig;
  prerenderedHTML: string;
}) {
  const [expandedItems, setExpandedItems] = useState<string[]>(() =>
    expandImplicitParentDirectories(stateConfig?.initialExpandedItems ?? [])
  );
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const { log, addLog } = useStateLog();

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
      <FileTreeReact
        options={options}
        initialFiles={initialFiles}
        prerenderedHTML={prerenderedHTML}
        onSelection={stateConfig?.onSelection}
        expandedItems={expandedItems}
        onExpandedItemsChange={handleExpandedChange}
        selectedItems={selectedItems}
        onSelectedItemsChange={handleSelectedChange}
      />
    </ExampleCard>
  );
}

// ---------------------------------------------------------------------------
// Dynamic Files Examples
// ---------------------------------------------------------------------------

const EXTRA_FILE = 'Build/assets/images/social/logo2.png';

/**
 * Vanilla FileTree — Dynamic Files
 * Uses setFiles() imperatively to add/remove files.
 */
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

/**
 * React FileTree — Controlled Files
 * files in React state, add/remove buttons, tree reflects changes.
 */
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

/**
 * React FileTree — SSR Controlled Files
 * Same as ReactControlledFiles but with SSR hydration.
 */
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

// ---------------------------------------------------------------------------
// Drag and Drop Examples
// ---------------------------------------------------------------------------

/**
 * Vanilla FileTree — Uncontrolled Drag and Drop
 * Uses dragAndDrop: true with initialFiles. Moves are applied internally
 * via setFiles(), onFilesChange fires as an observer.
 */
function VanillaDnDUncontrolled({
  options,
  stateConfig,
}: {
  options: FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
}) {
  const instanceRef = useRef<FileTree | null>(null);
  const { log, addLog } = useStateLog();

  const mergedStateConfig = useMemo<FileTreeStateConfig>(
    () => ({
      ...stateConfig,
      onFilesChange: (files) => {
        addLog(`files: [${files.join(', ')}]`);
      },
    }),
    [stateConfig, addLog]
  );

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
        {
          ...options,
          dragAndDrop: true,
          initialFiles: sharedDemoFileTreeOptions.initialFiles,
        },
        mergedStateConfig
      );
      fileTree.render({ containerWrapper: node });
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
      title="Vanilla — Uncontrolled DnD"
      description="Drag files and folders between directories. Moves are applied immediately; onFilesChange logs changes."
      footer={
        <StateLog
          entries={log}
          className="mt-3 h-[140px] overflow-y-auto rounded border p-2 font-mono text-xs"
        />
      }
    >
      <div ref={ref} />
    </ExampleCard>
  );
}

/**
 * React FileTree — Controlled Drag and Drop
 * Parent owns `files` state. onFilesChange proposes moves; parent can
 * accept or reject (e.g. lock .gitignore from being moved).
 */
function ReactDnDControlled({
  options,
  stateConfig,
}: {
  options: Omit<FileTreeOptions, 'initialFiles'>;
  stateConfig?: FileTreeStateConfig;
}) {
  const [files, setFiles] = useState(sharedDemoFileTreeOptions.initialFiles);
  const [lockGitignore, setLockGitignore] = useState(false);
  const { log, addLog } = useStateLog();

  const handleFilesChange = useCallback(
    (nextFiles: string[]) => {
      if (lockGitignore) {
        // Check if .gitignore moved
        const oldGitignore = files.find((f) => f.endsWith('.gitignore'));
        const newGitignore = nextFiles.find((f) => f.endsWith('.gitignore'));
        if (oldGitignore !== newGitignore) {
          addLog('REJECTED: .gitignore is locked');
          return;
        }
      }
      addLog(`files: [${nextFiles.join(', ')}]`);
      setFiles(nextFiles);
    },
    [lockGitignore, files, addLog]
  );

  return (
    <ExampleCard
      title="React — Controlled DnD"
      description="Controlled files with DnD. Toggle lock to prevent .gitignore from being moved."
      controls={
        <div className="flex items-center gap-2">
          <label
            htmlFor="lock-gitignore"
            className="flex cursor-pointer items-center gap-2 select-none"
          >
            <input
              type="checkbox"
              id="lock-gitignore"
              checked={lockGitignore}
              className="cursor-pointer"
              onChange={() => setLockGitignore((prev) => !prev)}
            />
            Lock .gitignore
          </label>
        </div>
      }
      footer={
        <StateLog
          entries={log}
          className="mt-3 h-[140px] overflow-y-auto rounded border p-2 font-mono text-xs"
        />
      }
    >
      <FileTreeReact
        options={{ ...options, dragAndDrop: true }}
        files={files}
        onFilesChange={handleFilesChange}
        initialExpandedItems={stateConfig?.initialExpandedItems}
        onSelection={stateConfig?.onSelection}
      />
    </ExampleCard>
  );
}

/**
 * React FileTree — Controlled Drag and Drop with SSR
 * Same as ReactDnDControlled but hydrated from prerendered HTML.
 */
function ReactDnDControlledSSR({
  options,
  stateConfig,
  prerenderedHTML,
}: {
  options: Omit<FileTreeOptions, 'initialFiles'>;
  stateConfig?: FileTreeStateConfig;
  prerenderedHTML: string;
}) {
  const [files, setFiles] = useState(sharedDemoFileTreeOptions.initialFiles);
  const [lockGitignore, setLockGitignore] = useState(false);
  const { log, addLog } = useStateLog();

  const handleFilesChange = useCallback(
    (nextFiles: string[]) => {
      if (lockGitignore) {
        const oldGitignore = files.find((f) => f.endsWith('.gitignore'));
        const newGitignore = nextFiles.find((f) => f.endsWith('.gitignore'));
        if (oldGitignore !== newGitignore) {
          addLog('REJECTED: .gitignore is locked');
          return;
        }
      }
      addLog(`files: [${nextFiles.join(', ')}]`);
      setFiles(nextFiles);
    },
    [lockGitignore, files, addLog]
  );

  return (
    <ExampleCard
      title="React (SSR) — Controlled DnD"
      description="SSR-hydrated controlled DnD. Toggle lock to prevent .gitignore from being moved."
      controls={
        <div className="flex items-center gap-2">
          <label
            htmlFor="lock-gitignore-ssr"
            className="flex cursor-pointer items-center gap-2 select-none"
          >
            <input
              type="checkbox"
              id="lock-gitignore-ssr"
              checked={lockGitignore}
              className="cursor-pointer"
              onChange={() => setLockGitignore((prev) => !prev)}
            />
            Lock .gitignore
          </label>
        </div>
      }
      footer={
        <StateLog
          entries={log}
          className="mt-3 h-[140px] overflow-y-auto rounded border p-2 font-mono text-xs"
        />
      }
    >
      <FileTreeReact
        options={{ ...options, dragAndDrop: true }}
        prerenderedHTML={prerenderedHTML}
        files={files}
        onFilesChange={handleFilesChange}
        initialExpandedItems={stateConfig?.initialExpandedItems}
        onSelection={stateConfig?.onSelection}
      />
    </ExampleCard>
  );
}

// ---------------------------------------------------------------------------
// Git Status Example
// ---------------------------------------------------------------------------

function useGitStatusControls(idSuffix: string) {
  const [enabled, setEnabled] = useState(true);
  const [useSetB, setUseSetB] = useState(false);

  const gitStatus = enabled
    ? useSetB
      ? GIT_STATUSES_B
      : GIT_STATUSES_A
    : undefined;

  const controls = (
    <div className="flex items-center gap-4">
      <label
        htmlFor={`git-status-enabled-${idSuffix}`}
        className="flex cursor-pointer items-center gap-2 select-none"
      >
        <input
          type="checkbox"
          id={`git-status-enabled-${idSuffix}`}
          checked={enabled}
          className="cursor-pointer"
          onChange={() => setEnabled((prev) => !prev)}
        />
        Enable
      </label>
      <button
        type="button"
        className="rounded-sm border px-2 py-1 text-xs"
        style={{ borderColor: 'var(--color-border)' }}
        onClick={() => setUseSetB((prev) => !prev)}
      >
        {useSetB ? 'Use Set A' : 'Use Set B'}
      </button>
    </div>
  );

  return { gitStatus, controls };
}

/**
 * Vanilla FileTree — Git Status
 * Uses setGitStatus() imperatively to toggle git status indicators.
 */
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

/**
 * React FileTree — SSR Git Status
 * Hydrated from prerendered HTML with controlled gitStatus prop.
 */
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
