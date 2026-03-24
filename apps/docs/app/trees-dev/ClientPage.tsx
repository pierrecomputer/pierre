'use client';

import {
  CONTEXT_MENU_SLOT_NAME,
  expandImplicitParentDirectories,
  FileTree,
  HEADER_SLOT_NAME,
} from '@pierre/trees';
import type {
  ContextMenuOpenContext,
  FileTreeOptions,
  FileTreeStateConfig,
} from '@pierre/trees';
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
import { createRoot, type Root as ReactDomRoot } from 'react-dom/client';

import {
  FILE_TREE_COOKIE_FLATTEN,
  FILE_TREE_COOKIE_LAZY,
  FILE_TREE_COOKIE_VERSION,
  FILE_TREE_COOKIE_VERSION_NAME,
} from './cookies';
import {
  customSpriteSheet,
  GIT_STATUSES_A,
  GIT_STATUSES_B,
  linuxKernelAllFolders,
  linuxKernelFiles,
  sharedDemoFileTreeOptions,
  sharedDemoStateConfig,
} from './demo-data';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function cleanupFileTreeInstance(
  container: HTMLElement,
  instanceRef: { current: FileTree | null }
): void {
  if (instanceRef.current == null) return;
  instanceRef.current.cleanUp();
  const shadowRoot = container.shadowRoot;
  if (shadowRoot !== null) {
    const treeElement = Array.from(shadowRoot.children).find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.dataset?.fileTreeId != null
    );
    treeElement?.replaceChildren();
  }
}

interface ClientPageProps {
  preloadedFileTreeHtml: string;
  preloadedFileTreeContainerHtml: string;
  preloadedControlledFileTreeHtml: string;
  preloadedGitStatusFileTreeHtml: string;
  preloadedContextMenuFileTreeHtml: string;
  preloadedContextMenuFileTreeContainerHtml: string;
  preloadedCustomIconsFileTreeHtml: string;
  initialFlattenEmptyDirectories?: boolean;
  initialUseLazyDataLoader?: boolean;
}

export function ClientPage({
  preloadedFileTreeHtml,
  preloadedFileTreeContainerHtml,
  preloadedControlledFileTreeHtml,
  preloadedGitStatusFileTreeHtml,
  preloadedContextMenuFileTreeHtml,
  preloadedContextMenuFileTreeContainerHtml,
  preloadedCustomIconsFileTreeHtml,
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
      <h1 className="mb-4 scroll-mt-[6rem] text-2xl font-bold">
        File Tree Examples
      </h1>

      {/* Item State Preview */}
      <ItemStatePreview />

      {/* Controls */}
      <div className="bg-background sticky top-0 z-50 -mx-4 mb-6">
        <div className="bg-muted p-4">
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
      <h2 id="state" className="mb-4 scroll-mt-[6rem] text-2xl font-bold">
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
          stateConfig={{
            ...sharedDemoStateConfig,
            initialSelectedItems: ['Build/assets/images/social/logo.png'],
          }}
          prerenderedHTML={preloadedControlledFileTreeHtml}
        />
      </div>

      {/* Divider */}
      <hr className="my-8" style={{ borderColor: 'var(--color-border)' }} />

      {/* Dynamic Files Examples */}
      <h2
        id="dynamic-files"
        className="mb-4 scroll-mt-[6rem] text-2xl font-bold"
      >
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
      <h2
        id="search-modes"
        className="mb-4 scroll-mt-[6rem] text-2xl font-bold"
      >
        Search Modes
      </h2>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <ExampleCard
          title="expand-matches"
          description="Expands folders containing matches but keeps all items visible"
        >
          <ReactClientRendered
            options={{
              ...reactOptions,
              search: true,
              fileTreeSearchMode: 'expand-matches',
            }}
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
              search: true,
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
              search: true,
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
      <h2
        id="drag-and-drop"
        className="mb-4 scroll-mt-[6rem] text-2xl font-bold"
      >
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
      <h2 id="git-status" className="mb-4 scroll-mt-[6rem] text-2xl font-bold">
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

      {/* Divider */}
      <hr className="my-8" style={{ borderColor: 'var(--color-border)' }} />

      {/* Custom Icons */}
      <h2
        id="custom-icons"
        className="mb-4 scroll-mt-[6rem] text-2xl font-bold"
      >
        Custom Icons
      </h2>
      <div
        style={
          {
            '--trees-icon-width-override': '16px',
          } as React.CSSProperties
        }
        className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
      >
        <VanillaCustomIcons
          options={fileTreeOptions}
          stateConfig={sharedDemoStateConfig}
        />
        <ReactCustomIcons
          options={reactOptions}
          initialFiles={reactFiles}
          stateConfig={sharedDemoStateConfig}
        />
        <ReactSSRCustomIcons
          options={reactOptions}
          initialFiles={reactFiles}
          stateConfig={sharedDemoStateConfig}
          prerenderedHTML={preloadedCustomIconsFileTreeHtml}
        />
      </div>

      {/* Divider */}
      <hr className="my-8" style={{ borderColor: 'var(--color-border)' }} />

      {/* Custom Header Slot */}
      <h2
        id="custom-header-slot"
        className="mb-4 scroll-mt-[6rem] text-2xl font-bold"
      >
        Custom Header Slot
      </h2>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <VanillaSSRHeaderSlot
          options={fileTreeOptions}
          stateConfig={sharedDemoStateConfig}
          containerHtml={preloadedFileTreeContainerHtml}
        />
        <ReactSSRHeaderSlot
          options={reactOptions}
          initialFiles={reactFiles}
          stateConfig={sharedDemoStateConfig}
          prerenderedHTML={preloadedFileTreeHtml}
        />
      </div>

      {/* Divider */}
      <hr className="my-8" style={{ borderColor: 'var(--color-border)' }} />

      {/* Context Menu */}
      <h2
        id="context-menu"
        className="mb-4 scroll-mt-[6rem] text-2xl font-bold"
      >
        Context Menu
      </h2>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <ExampleCard
          title="Context Menu (Vanilla SSR)"
          description="HTML prerendered on the server, hydrated with FileTree on the client, with menu content injected imperatively"
        >
          <VanillaSSRContextMenu
            options={fileTreeOptions}
            stateConfig={sharedDemoStateConfig}
            containerHtml={preloadedContextMenuFileTreeContainerHtml}
          />
        </ExampleCard>
        <ExampleCard
          title="Context Menu (React SSR)"
          description="React FileTree prerendered on the server, hydrated on the client, with menu content rendered through the slot"
        >
          <ReactSSRContextMenu
            options={reactOptions}
            initialFiles={reactFiles}
            stateConfig={sharedDemoStateConfig}
            prerenderedHTML={preloadedContextMenuFileTreeHtml}
          />
        </ExampleCard>
      </div>

      {/* Divider */}
      <hr className="my-8" style={{ borderColor: 'var(--color-border)' }} />

      {/* Virtualized */}
      <h2 id="virtualized" className="mb-4 scroll-mt-[6rem] text-2xl font-bold">
        Virtualized ({linuxKernelFiles.length.toLocaleString()} files)
      </h2>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <VirtualizedLinuxKernelCard />
        <UnvirtualizedLinuxKernelCard />
      </div>
    </div>
  );
}

interface PreviewItemState {
  label: string;
  attrs: Record<string, string>;
  forceHover?: boolean;
}

const ITEM_STATES: PreviewItemState[] = [
  { label: 'Default', attrs: {} },
  { label: 'Hover', attrs: {}, forceHover: true },
  { label: 'Focused', attrs: { 'data-item-focused': 'true' } },
  { label: 'Selected', attrs: { 'data-item-selected': 'true' } },
  {
    label: 'Selected + Focused',
    attrs: { 'data-item-selected': 'true', 'data-item-focused': 'true' },
  },
  { label: 'Search Match', attrs: { 'data-item-search-match': 'true' } },
];

function buildPreviewItemHtml(state: PreviewItemState): string {
  const attrs = Object.entries(state.attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
  const forceStyle =
    state.forceHover === true
      ? ' style="background-color: var(--trees-bg-muted)"'
      : '';
  return `<button data-type="item" data-item-type="file" ${attrs}${forceStyle} tabindex="-1">
    <div data-item-section="icon">
      <svg data-icon-name="file-tree-icon-file" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <use href="#file-tree-icon-file" />
      </svg>
    </div>
    <div data-item-section="content">${state.label}</div>
  </button>`;
}

const PREVIEW_SPRITE = `<svg data-icon-sprite aria-hidden="true" width="0" height="0" style="position:absolute">
  <symbol id="file-tree-icon-file" viewBox="0 0 16 16">
    <path fill="currentcolor" d="M10.75 0c.199 0 .39.08.53.22l3.5 3.5c.14.14.22.331.22.53v9A2.75 2.75 0 0 1 12.25 16h-8.5A2.75 2.75 0 0 1 1 13.25V2.75A2.75 2.75 0 0 1 3.75 0zm-7 1.5c-.69 0-1.25.56-1.25 1.25v10.5c0 .69.56 1.25 1.25 1.25h8.5c.69 0 1.25-.56 1.25-1.25V5h-1.25A2.25 2.25 0 0 1 10 2.75V1.5z" />
  </symbol>
</svg>`;

function useItemStatePreviewRef(colorScheme: 'light' | 'dark') {
  return useCallback(
    (node: HTMLDivElement | null) => {
      if (node == null) return;
      const container = node.querySelector('file-tree-container');
      if (!(container instanceof HTMLElement)) return;
      container.style.colorScheme = colorScheme;
      const shadowRoot =
        container.shadowRoot ?? container.attachShadow({ mode: 'open' });

      const itemsHtml = ITEM_STATES.map((s) => buildPreviewItemHtml(s)).join(
        ''
      );
      shadowRoot.innerHTML = `${PREVIEW_SPRITE}<div role="tree">${itemsHtml}</div>`;
    },
    [colorScheme]
  );
}

function ItemStatePreview() {
  const lightRef = useItemStatePreviewRef('light');
  const darkRef = useItemStatePreviewRef('dark');

  return (
    <div
      className="mb-6 rounded-sm border p-4"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <h4 className="text-lg font-bold">Item States</h4>
      <p className="text-muted-foreground mb-3 text-xs">
        Static preview of every tree item visual state in light and dark mode
      </p>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div ref={lightRef}>
          <p className="text-muted-foreground mb-1 text-xs font-medium">
            Light
          </p>
          <file-tree-container
            className="rounded-lg border p-3"
            style={{ '--trees-gap-override': '2px' } as React.CSSProperties}
          />
        </div>
        <div ref={darkRef}>
          <p className="text-muted-foreground mb-1 text-xs font-medium">Dark</p>
          <file-tree-container
            className="rounded-lg border p-3"
            style={{ '--trees-gap-override': '2px' } as React.CSSProperties}
          />
        </div>
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

      cleanupFileTreeInstance(fileTreeContainer, instanceRef);

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
  const [selectedItems, setSelectedItems] = useState<string[]>(
    () => stateConfig?.initialSelectedItems ?? []
  );
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

// ---------------------------------------------------------------------------
// Custom Icons Examples
// ---------------------------------------------------------------------------

const CUSTOM_ICONS_REMAP = {
  'file-tree-icon-file': 'custom-hamburger-icon',
  'file-tree-icon-chevron': {
    name: 'custom-chevron-icon',
    width: 16,
    height: 16,
  },
} as const;

/**
 * Vanilla FileTree — Custom Icons (CSR)
 */
function VanillaCustomIcons({
  options,
  stateConfig,
}: {
  options: FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
}) {
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (node == null) return;
      node.innerHTML = '';
      const fileTree = new FileTree(
        {
          ...options,
          icons: { spriteSheet: customSpriteSheet, remap: CUSTOM_ICONS_REMAP },
        },
        stateConfig
      );
      fileTree.render({ containerWrapper: node });
      return () => {
        fileTree.cleanUp();
      };
    },
    [options, stateConfig]
  );

  return (
    <ExampleCard
      title="Vanilla — Custom Icons"
      description="Vanilla CSR tree with a custom spritesheet replacing the file icon with a custom file icon"
    >
      <div ref={ref} />
    </ExampleCard>
  );
}

/**
 * React FileTree — Custom Icons (CSR)
 */
function ReactCustomIcons({
  options,
  initialFiles,
  stateConfig,
}: {
  options: Omit<FileTreeOptions, 'initialFiles'>;
  initialFiles?: string[];
  stateConfig?: FileTreeStateConfig;
}) {
  return (
    <ExampleCard
      title="React — Custom Icons"
      description="React CSR tree with a custom spritesheet replacing the file icon with a custom file icon"
    >
      <FileTreeReact
        options={{
          ...options,
          icons: { spriteSheet: customSpriteSheet, remap: CUSTOM_ICONS_REMAP },
        }}
        initialFiles={initialFiles}
        initialExpandedItems={stateConfig?.initialExpandedItems}
        onSelection={stateConfig?.onSelection}
      />
    </ExampleCard>
  );
}

/**
 * React FileTree — Custom Icons (SSR)
 */
function ReactSSRCustomIcons({
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
    <ExampleCard
      title="React (SSR) — Custom Icons"
      description="SSR-hydrated React tree with a custom spritesheet replacing the chevron with a folder icon"
    >
      <FileTreeReact
        options={{
          ...options,
          icons: { spriteSheet: customSpriteSheet, remap: CUSTOM_ICONS_REMAP },
        }}
        initialFiles={initialFiles}
        prerenderedHTML={prerenderedHTML}
        initialExpandedItems={stateConfig?.initialExpandedItems}
        onSelection={stateConfig?.onSelection}
      />
    </ExampleCard>
  );
}

type ContextMenuDemoItem = { path: string; isFolder: boolean };

function makeDemoRenamingOptions(label: string) {
  return {
    onError: (error: string) => {
      window.alert(error);
    },
    onRename: (event: {
      sourcePath: string;
      destinationPath: string;
      isFolder: boolean;
    }) => {
      console.log(
        `[trees-dev][${label}] rename ${event.isFolder ? 'folder' : 'file'}: ${event.sourcePath} -> ${event.destinationPath}`
      );
    },
  };
}

function TreeDemoContextMenu({
  item,
  context,
}: {
  item: ContextMenuDemoItem;
  context: ContextMenuOpenContext;
}) {
  const itemType = item.isFolder ? 'Folder' : 'File';
  const handleRenameSelect = () => context.startRenaming?.();

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
          style={{
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: 'none',
            border: 0,
            padding: 0,
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="right"
        sideOffset={8}
        className="min-w-[220px]"
      >
        <DropdownMenuLabel className="max-w-[280px] truncate">
          {itemType}: {item.path}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={context.close}>Open</DropdownMenuItem>
        <DropdownMenuItem
          onSelect={handleRenameSelect}
          disabled={context.canRename !== true}
        >
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={context.close}
          className="text-destructive focus:text-destructive"
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function renderVanillaContextMenuSlot({
  slotElement,
  menuRootRef,
  item,
  context,
}: {
  slotElement: HTMLDivElement;
  menuRootRef: { current: ReactDomRoot | null };
  item: ContextMenuDemoItem;
  context: ContextMenuOpenContext;
}): void {
  menuRootRef.current ??= createRoot(slotElement);
  slotElement.style.display = 'block';
  menuRootRef.current.render(
    <TreeDemoContextMenu item={item} context={context} />
  );
}

function clearVanillaContextMenuSlot({
  slotElement,
  menuRootRef,
  unmount = false,
}: {
  slotElement: HTMLDivElement;
  menuRootRef: { current: ReactDomRoot | null };
  unmount?: boolean;
}): void {
  if (menuRootRef.current == null) {
    return;
  }
  if (unmount) {
    menuRootRef.current.unmount();
    menuRootRef.current = null;
  } else {
    menuRootRef.current.render(null);
  }
  slotElement.style.display = 'none';
}

function injectSlotMarkup(containerHtml: string, slotMarkup: string): string {
  return containerHtml.replace(
    '</file-tree-container>',
    `${slotMarkup}</file-tree-container>`
  );
}

function DemoHeaderContent({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '8px 12px',
        borderBottom:
          '1px solid color-mix(in srgb, var(--color-border) 80%, transparent)',
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--color-bg) 96%, white), color-mix(in srgb, var(--color-bg) 88%, white))',
      }}
    >
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em' }}>
          {label}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-fg-muted, #666)' }}>
          Click to log and verify the slotted subtree hydrated
        </div>
      </div>
      <button
        type="button"
        className="rounded-sm border px-2 py-1 text-xs"
        style={{ borderColor: 'var(--color-border)' }}
        onClick={onClick}
      >
        Log Header Click
      </button>
    </div>
  );
}

function vanillaHeaderSlotMarkup(label: string): string {
  return `
    <div
      slot="${HEADER_SLOT_NAME}"
      style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;border-bottom:1px solid color-mix(in srgb, var(--color-border) 80%, transparent);background:linear-gradient(180deg, color-mix(in srgb, var(--color-bg) 96%, white), color-mix(in srgb, var(--color-bg) 88%, white));"
    >
      <div>
        <div style="font-size:12px;font-weight:700;letter-spacing:0.04em;">${label}</div>
        <div style="font-size:12px;color:var(--color-fg-muted, #666);">Click to log and verify the slotted subtree hydrated</div>
      </div>
      <button
        type="button"
        data-demo-header-button="true"
        class="rounded-sm border px-2 py-1 text-xs"
        style="border-color:var(--color-border);"
      >
        Log Header Click
      </button>
    </div>
  `;
}

/**
 * Vanilla FileTree - Server-Side Rendered custom header slot
 */
function VanillaSSRHeaderSlot({
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
  const containerHtmlWithHeader = useMemo(
    () =>
      injectSlotMarkup(
        containerHtml,
        vanillaHeaderSlotMarkup('Vanilla SSR Header')
      ),
    [containerHtml]
  );

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (node == null) {
        return;
      }

      const fileTreeContainer = node.querySelector('file-tree-container');
      if (!(fileTreeContainer instanceof HTMLElement)) return;

      cleanupFileTreeInstance(fileTreeContainer, instanceRef);

      const headerButton = fileTreeContainer.querySelector(
        '[data-demo-header-button="true"]'
      );
      const handleHeaderClick = () => {
        addLog('header: clicked');
      };
      headerButton?.addEventListener('click', handleHeaderClick);

      const fileTree = new FileTree(options, stateConfig);

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
        headerButton?.removeEventListener('click', handleHeaderClick);
        fileTree.cleanUp();
        instanceRef.current = null;
      };
    },
    [addLog, options, stateConfig]
  );

  return (
    <ExampleCard
      title="Header Slot (Vanilla SSR)"
      description="SSR markup includes a slotted light-DOM header; the click log verifies the imperative hydration path attached correctly"
      footer={
        <StateLog
          entries={log}
          className="mt-3 h-[96px] overflow-y-auto rounded border p-2 font-mono text-xs"
        />
      }
    >
      <div
        ref={ref}
        dangerouslySetInnerHTML={{ __html: containerHtmlWithHeader }}
        suppressHydrationWarning
      />
    </ExampleCard>
  );
}

/**
 * React FileTree - Server-Side Rendered custom header slot
 */
function ReactSSRHeaderSlot({
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
      title="Header Slot (React SSR)"
      description="React server-renders the slotted header into the host element and hydrates its click handler on the client"
      footer={
        <StateLog
          entries={log}
          className="mt-3 h-[96px] overflow-y-auto rounded border p-2 font-mono text-xs"
        />
      }
    >
      <FileTreeReact
        options={options}
        initialFiles={initialFiles}
        prerenderedHTML={prerenderedHTML}
        initialExpandedItems={stateConfig?.initialExpandedItems}
        onSelection={stateConfig?.onSelection}
        header={
          <DemoHeaderContent
            label="React SSR Header"
            onClick={() => addLog('header: clicked')}
          />
        }
      />
    </ExampleCard>
  );
}

/**
 * Vanilla FileTree - Server-Side Rendered context menu
 */
function VanillaSSRContextMenu({
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
  const menuRootRef = useRef<ReactDomRoot | null>(null);
  const [files, setFiles] = useState<string[]>(options.initialFiles);
  const filesRef = useRef(files);
  const renamingOptions = useMemo(
    () => makeDemoRenamingOptions('vanilla-ssr'),
    []
  );

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (node == null) {
        return;
      }

      const fileTreeContainer = node.querySelector('file-tree-container');
      if (!(fileTreeContainer instanceof HTMLElement)) return;

      cleanupFileTreeInstance(fileTreeContainer, instanceRef);

      const slotElement = document.createElement('div');
      slotElement.setAttribute('slot', CONTEXT_MENU_SLOT_NAME);
      slotElement.style.display = 'none';
      fileTreeContainer.appendChild(slotElement);

      const closeMenu = () => {
        clearVanillaContextMenuSlot({
          slotElement,
          menuRootRef,
        });
      };

      const fileTree = new FileTree(
        {
          ...options,
          initialFiles: filesRef.current,
          renaming: renamingOptions,
        },
        {
          ...stateConfig,
          onFilesChange: (nextFiles) => {
            filesRef.current = nextFiles;
            setFiles(nextFiles);
            stateConfig?.onFilesChange?.(nextFiles);
          },
          onContextMenuOpen: (item, context) => {
            renderVanillaContextMenuSlot({
              slotElement,
              menuRootRef,
              item,
              context,
            });
          },
          onContextMenuClose: () => {
            closeMenu();
          },
        }
      );

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
        clearVanillaContextMenuSlot({
          slotElement,
          menuRootRef,
          unmount: true,
        });
        slotElement.remove();
        fileTree.cleanUp();
        instanceRef.current = null;
      };
    },
    [options, renamingOptions, stateConfig]
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
 * React FileTree - Server-Side Rendered context menu
 */
function ReactSSRContextMenu({
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
  const [files, setFiles] = useState<string[]>(() => initialFiles ?? []);
  const renamingOptions = useMemo(
    () => makeDemoRenamingOptions('react-ssr'),
    []
  );

  return (
    <FileTreeReact
      options={{ ...options, renaming: renamingOptions }}
      files={files}
      onFilesChange={setFiles}
      prerenderedHTML={prerenderedHTML}
      initialExpandedItems={stateConfig?.initialExpandedItems}
      onSelection={stateConfig?.onSelection}
      renderContextMenu={(item, context) => (
        <TreeDemoContextMenu item={item} context={context} />
      )}
    />
  );
}

/**
 * Virtualized vanilla FileTree with the full Linux kernel file list.
 * Gated behind a button so the page loads quickly.
 */
function VirtualizedLinuxKernelCard() {
  const [mounted, setMounted] = useState(false);
  const menuRootRef = useRef<ReactDomRoot | null>(null);
  const instanceRef = useRef<FileTree | null>(null);
  const renamingOptions = useMemo(
    () => makeDemoRenamingOptions('vanilla-virtualized'),
    []
  );

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (node == null) return;

      const slotElement = document.createElement('div');
      slotElement.setAttribute('slot', CONTEXT_MENU_SLOT_NAME);
      slotElement.style.display = 'none';

      const fileTree = new FileTree(
        {
          initialFiles: linuxKernelFiles,
          virtualize: { threshold: 0 },
          flattenEmptyDirectories: true,
          sort: false,
          renaming: renamingOptions,
        },
        {
          initialExpandedItems: linuxKernelAllFolders,
          onContextMenuOpen: (item, context) => {
            renderVanillaContextMenuSlot({
              slotElement,
              menuRootRef,
              item,
              context,
            });
          },
          onContextMenuClose: () => {
            clearVanillaContextMenuSlot({
              slotElement,
              menuRootRef,
            });
          },
        }
      );
      fileTree.render({ containerWrapper: node });
      instanceRef.current = fileTree;

      const container = fileTree.getFileTreeContainer();
      if (container != null) {
        container.appendChild(slotElement);
      }

      return () => {
        clearVanillaContextMenuSlot({
          slotElement,
          menuRootRef,
          unmount: true,
        });
        slotElement.remove();
        fileTree.cleanUp();
        instanceRef.current = null;
      };
    },
    [renamingOptions]
  );

  return (
    <ExampleCard
      title="Vanilla Virtualized (Linux Kernel)"
      description={`${linuxKernelFiles.length.toLocaleString()} files with opt-in virtualization`}
    >
      {mounted ? (
        <div ref={ref} style={{ height: '500px' }} />
      ) : (
        <div
          style={{
            height: '500px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <button
            type="button"
            className="rounded-sm border px-4 py-2 text-sm"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => setMounted(true)}
          >
            Render
          </button>
        </div>
      )}
    </ExampleCard>
  );
}

/**
 * Unvirtualized vanilla FileTree with the full Linux kernel file list.
 * Gated behind a button because rendering ~93k DOM nodes will freeze the page.
 */
function UnvirtualizedLinuxKernelCard() {
  const [mounted, setMounted] = useState(false);

  const ref = useCallback((node: HTMLDivElement | null) => {
    if (node == null) return;
    const fileTree = new FileTree(
      {
        initialFiles: linuxKernelFiles,
        virtualize: false,
        flattenEmptyDirectories: true,
      },
      { initialExpandedItems: linuxKernelAllFolders }
    );
    fileTree.render({ containerWrapper: node });
    return () => fileTree.cleanUp();
  }, []);

  return (
    <ExampleCard
      title="Vanilla Unvirtualized (Linux Kernel)"
      description={`${linuxKernelFiles.length.toLocaleString()} files without virtualization`}
    >
      {mounted ? (
        <div ref={ref} style={{ height: '500px', overflowY: 'auto' }} />
      ) : (
        <div
          style={{
            height: '500px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <button
            type="button"
            className="rounded-sm border px-4 py-2 text-sm"
            style={{ borderColor: 'var(--color-border)' }}
            onClick={() => setMounted(true)}
          >
            Render (will freeze page)
          </button>
        </div>
      )}
    </ExampleCard>
  );
}
