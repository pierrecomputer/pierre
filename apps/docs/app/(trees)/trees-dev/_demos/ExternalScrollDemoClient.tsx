'use client';

import { FileTree } from '@pierre/trees/react';
import type {
  FileTreeExternalScrollRequestContext,
  FileTreeExternalScrollSnapshot,
  FileTreeExternalScrollSource,
} from '@pierre/trees/scroll';
import { FileTree as ScrollFileTree } from '@pierre/trees/scroll';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ExampleCard } from '../_components/ExampleCard';
import { useTreesDevSettings } from '../_components/TreesDevSettingsProvider';

const SCROLLER_VIEWPORT_HEIGHT = 360;
const STICKY_TOOLBAR_HEIGHT = 40;
const STICKY_SECTION_HEADER_HEIGHT = 32;
const INITIAL_VIEWPORT_TOP = -1_000;
const INITIAL_TOP_INSET = STICKY_TOOLBAR_HEIGHT + STICKY_SECTION_HEADER_HEIGHT;
const DEMO_FOCUS_PATH =
  'packages/trees/src/render/external/scroll-helper-18.ts';
const EXTERNAL_SCROLL_DEMO_PATHS = [
  'README.md',
  'package.json',
  'bunfig.toml',
  'apps/docs/app/(trees)/docs/Overview/content.mdx',
  ...Array.from(
    { length: 14 },
    (_, index) =>
      `apps/docs/app/(trees)/docs/Guides/Guide-${String(index + 1).padStart(2, '0')}/content.mdx`
  ),
  ...Array.from(
    { length: 14 },
    (_, index) =>
      `apps/docs/app/(trees)/docs/Reference/Topic-${String(index + 1).padStart(2, '0')}/content.mdx`
  ),
  'packages/trees/src/render/FileTree.ts',
  'packages/trees/src/render/FileTreeView.tsx',
  'packages/trees/src/model/layout.ts',
  ...Array.from(
    { length: 18 },
    (_, index) =>
      `packages/trees/src/render/external/scroll-helper-${String(index + 1).padStart(2, '0')}.ts`
  ),
  ...Array.from(
    { length: 16 },
    (_, index) =>
      `packages/trees/test/external-scroll/spec-${String(index + 1).padStart(2, '0')}.test.ts`
  ),
  ...Array.from(
    { length: 12 },
    (_, index) =>
      `workspaces/customer-${String(index + 1).padStart(2, '0')}/notes/section-${String(index + 1).padStart(2, '0')}.md`
  ),
] as const;
const EXTERNAL_SCROLL_EXPANDED_PATHS = [
  'apps/',
  'apps/docs/',
  'apps/docs/app/',
  'apps/docs/app/(trees)/',
  'apps/docs/app/(trees)/docs/',
  'apps/docs/app/(trees)/docs/Guides/',
  'apps/docs/app/(trees)/docs/Reference/',
  'packages/',
  'packages/trees/',
  'packages/trees/src/',
  'packages/trees/src/render/',
  'packages/trees/src/render/external/',
  'packages/trees/test/',
  'packages/trees/test/external-scroll/',
] as const;
const DEMO_INITIAL_SNAPSHOT: FileTreeExternalScrollSnapshot = {
  topInset: INITIAL_TOP_INSET,
  viewportHeight: SCROLLER_VIEWPORT_HEIGHT,
  viewportTop: INITIAL_VIEWPORT_TOP,
};
const SECTION_TONES = {
  below: 'bg-emerald-50/80 border-emerald-200/80',
  neutral: 'bg-slate-50 border-slate-200',
  tree: 'bg-white border-slate-300',
  warning: 'bg-amber-50/80 border-amber-200/80',
} as const;
const DEMO_SECTIONS = {
  above: [
    {
      bodyHeight: 220,
      description:
        'A sticky section header above the tree proves the parent scroller owns the top inset before the tree ever comes into view.',
      id: 'overview',
      sticky: true,
      title: 'Overview',
      tone: 'neutral',
    },
    {
      bodyHeight: 180,
      description:
        'This section is ordinary flow content. It gives the tree real neighbors without adding another sticky layer.',
      id: 'release-notes',
      sticky: false,
      title: 'Release notes',
      tone: 'warning',
    },
    {
      bodyHeight: 220,
      description:
        'This second sticky section header stays caller-owned. When it pins, the tree should still keep its own sticky folders below it.',
      id: 'pinned-artifacts',
      sticky: true,
      title: 'Pinned artifacts',
      tone: 'neutral',
    },
  ],
  below: [
    {
      bodyHeight: 220,
      description:
        'A sticky section below the tree shows that page-owned sticky UI can continue after the tree block without the tree owning the scroll container.',
      id: 'runbook',
      sticky: true,
      title: 'Runbook excerpts',
      tone: 'below',
    },
    {
      bodyHeight: 180,
      description:
        'A normal trailing section keeps plain flow content below the tree as well.',
      id: 'appendix',
      sticky: false,
      title: 'Appendix',
      tone: 'warning',
    },
  ],
} as const;

type ExternalScrollReadout = {
  mountedPathCount: number;
  requestCount: number;
  stickyPaths: string[];
  topInset: number;
  viewportTop: number;
};

// Measures how much caller-owned sticky UI currently occupies the top edge of
// the parent scroller. The tree uses that value as `topInset` for sticky rows.
function measurePinnedStickyInset(scrollContainer: HTMLElement): number {
  const scrollerTop = scrollContainer.getBoundingClientRect().top;
  let inset = 0;

  for (const element of scrollContainer.querySelectorAll(
    '[data-external-scroll-sticky-source="true"]'
  )) {
    if (!(element instanceof HTMLElement)) {
      continue;
    }

    const rect = element.getBoundingClientRect();
    const computedTop = window.getComputedStyle(element).top;
    const stickyTop = Number.parseFloat(computedTop === '' ? '0' : computedTop);
    const isPinned = Math.abs(rect.top - (scrollerTop + stickyTop)) <= 1.5;
    if (!isPinned) {
      continue;
    }

    inset = Math.max(inset, stickyTop + rect.height);
  }

  return inset;
}

// Keeps the live external-scroll snapshot synchronized with the parent scroller
// and records programmatic reveal requests so the demo can show what happened.
class DemoExternalScrollSource implements FileTreeExternalScrollSource {
  readonly requests: {
    context: FileTreeExternalScrollRequestContext;
    viewportTop: number;
  }[] = [];
  #host: HTMLElement | null = null;
  #listeners = new Set<() => void>();
  #scrollContainer: HTMLElement | null = null;
  #snapshot: FileTreeExternalScrollSnapshot;

  constructor(snapshot: FileTreeExternalScrollSnapshot) {
    this.#snapshot = snapshot;
  }

  attach(host: HTMLElement | null, scrollContainer: HTMLElement | null): void {
    this.#host = host;
    this.#scrollContainer = scrollContainer;
    if (host != null && scrollContainer != null) {
      this.updateFromDom('unknown');
    }
  }

  getSnapshot(): FileTreeExternalScrollSnapshot {
    return this.#snapshot;
  }

  scrollToViewportTop(
    viewportTop: number,
    context: FileTreeExternalScrollRequestContext
  ): void {
    if (this.#host == null || this.#scrollContainer == null) {
      return;
    }

    this.requests.push({ context, viewportTop });
    const currentViewportTop = this.#readViewportTop();
    this.#scrollContainer.scrollTop += viewportTop - currentViewportTop;
    this.updateFromDom('programmatic');
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  updateFromDom(
    scrollOrigin: FileTreeExternalScrollSnapshot['scrollOrigin']
  ): void {
    if (this.#host == null || this.#scrollContainer == null) {
      return;
    }

    this.#snapshot = {
      isScrolling: false,
      scrollOrigin,
      topInset: measurePinnedStickyInset(this.#scrollContainer),
      viewportHeight: this.#scrollContainer.clientHeight,
      viewportTop: this.#readViewportTop(),
    };
    this.#notify();
  }

  #notify(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }

  #readViewportTop(): number {
    if (this.#host == null || this.#scrollContainer == null) {
      return this.#snapshot.viewportTop;
    }

    return (
      this.#scrollContainer.getBoundingClientRect().top -
      this.#host.getBoundingClientRect().top
    );
  }
}

// Reads the tree's mounted rows and sticky rows so the demo can show how the
// external viewport changes the rendered slice as the parent scroller moves.
function readExternalScrollReadout(
  host: HTMLElement | null,
  source: DemoExternalScrollSource
): ExternalScrollReadout {
  const shadowRoot = host?.shadowRoot;
  const mountedPathCount = Array.from(
    shadowRoot?.querySelectorAll(
      'button[data-type="item"]:not([data-file-tree-sticky-row="true"])'
    ) ?? []
  ).filter(
    (element) =>
      element instanceof HTMLElement && element.dataset.itemParked !== 'true'
  ).length;
  const stickyPaths = Array.from(
    shadowRoot?.querySelectorAll('button[data-file-tree-sticky-row="true"]') ??
      []
  )
    .map((element) =>
      element instanceof HTMLElement ? element.dataset.fileTreeStickyPath : null
    )
    .filter((path): path is string => path != null);
  const snapshot = source.getSnapshot();

  return {
    mountedPathCount,
    requestCount: source.requests.length,
    stickyPaths,
    topInset: snapshot.topInset ?? 0,
    viewportTop: snapshot.viewportTop,
  };
}

function DemoSection({
  bodyHeight,
  description,
  sticky,
  title,
  tone,
}: {
  bodyHeight: number;
  description: string;
  sticky: boolean;
  title: string;
  tone: keyof typeof SECTION_TONES;
}) {
  return (
    <section className={`border-b px-4 py-4 ${SECTION_TONES[tone]}`}>
      <div
        className={`border-b px-3 text-xs font-semibold tracking-wide uppercase ${SECTION_TONES[tone]} ${
          sticky ? 'sticky z-10' : ''
        }`}
        data-external-scroll-sticky-source={sticky ? 'true' : undefined}
        style={{
          height: `${String(STICKY_SECTION_HEADER_HEIGHT)}px`,
          lineHeight: `${String(STICKY_SECTION_HEADER_HEIGHT)}px`,
          top: `${String(STICKY_TOOLBAR_HEIGHT)}px`,
        }}
      >
        {title}
      </div>
      <div
        className="pt-3 text-sm leading-6 text-neutral-700"
        style={{ minHeight: `${String(bodyHeight)}px` }}
      >
        <p>{description}</p>
        <p className="mt-3">
          Lorem ipsum text stands in for caller-owned content here so the tree
          has real neighbors inside the parent scroller.
        </p>
      </div>
    </section>
  );
}

function ExternalScrollDemoInstance({
  flattenEmptyDirectories,
}: {
  flattenEmptyDirectories: boolean;
}) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const treeHostRef = useRef<HTMLElement | null>(null);
  const source = useMemo(
    () => new DemoExternalScrollSource(DEMO_INITIAL_SNAPSHOT),
    []
  );
  const model = useMemo(
    () =>
      new ScrollFileTree({
        externalScroll: { initialSnapshot: source.getSnapshot() },
        flattenEmptyDirectories,
        id: 'trees-dev-external-scroll',
        initialExpandedPaths: EXTERNAL_SCROLL_EXPANDED_PATHS,
        paths: EXTERNAL_SCROLL_DEMO_PATHS,
        search: true,
        stickyFolders: true,
      }),
    [flattenEmptyDirectories, source]
  );
  useEffect(() => {
    return () => {
      model.cleanUp();
    };
  }, [model]);

  const [readout, setReadout] = useState<ExternalScrollReadout>(() =>
    readExternalScrollReadout(treeHostRef.current, source)
  );

  const syncReadout = useCallback(() => {
    setReadout(readExternalScrollReadout(treeHostRef.current, source));
  }, [source]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const host = treeHostRef.current;
    if (scrollContainer == null || host == null) {
      return;
    }

    source.attach(host, scrollContainer);
    model.setExternalScrollSource(source);
    const unsubscribe = source.subscribe(syncReadout);
    const resizeObserver = new ResizeObserver(() => {
      source.updateFromDom('unknown');
    });
    resizeObserver.observe(scrollContainer);
    resizeObserver.observe(host);
    syncReadout();

    return () => {
      resizeObserver.disconnect();
      unsubscribe();
      model.setExternalScrollSource(undefined);
    };
  }, [model, source, syncReadout]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer == null) {
      return;
    }

    const handleScroll = (): void => {
      source.updateFromDom('user');
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
    };
  }, [source]);

  const jumpTo = useCallback((selector: string) => {
    const scrollContainer = scrollContainerRef.current;
    const target = scrollContainer?.querySelector(selector);
    if (scrollContainer == null || !(target instanceof HTMLElement)) {
      return;
    }

    scrollContainer.scrollTo({
      behavior: 'smooth',
      top: Math.max(0, target.offsetTop - STICKY_TOOLBAR_HEIGHT - 8),
    });
  }, []);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">External Scroll</h1>
        <p className="text-muted-foreground max-w-3xl text-sm leading-6">
          This proof puts the tree inside a caller-owned scroller with section
          content above and below it. The parent scroller owns the viewport, the
          sticky section headers, and the top inset. The tree keeps its own
          virtualization, search, sticky folders, and focus reveal behavior.
        </p>
      </header>

      <ExampleCard
        title="Caller-owned scroller"
        description="Scroll the parent container, not the tree. The sticky toolbar and selected section headers stay caller-owned while the tree block sits in ordinary flow between them."
        controls={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-sm border px-2 py-1 text-xs"
              style={{ borderColor: 'var(--color-border)' }}
              onClick={() => {
                scrollContainerRef.current?.scrollTo({
                  behavior: 'smooth',
                  top: 0,
                });
              }}
            >
              Scroll to top
            </button>
            <button
              type="button"
              className="rounded-sm border px-2 py-1 text-xs"
              style={{ borderColor: 'var(--color-border)' }}
              onClick={() => {
                jumpTo('[data-external-scroll-tree-section="true"]');
              }}
            >
              Jump to tree
            </button>
            <button
              type="button"
              className="rounded-sm border px-2 py-1 text-xs"
              style={{ borderColor: 'var(--color-border)' }}
              onClick={() => {
                jumpTo('[data-external-scroll-below-target="true"]');
              }}
            >
              Jump below tree
            </button>
            <button
              type="button"
              className="rounded-sm border px-2 py-1 text-xs"
              style={{ borderColor: 'var(--color-border)' }}
              onClick={() => {
                model.focusPath(DEMO_FOCUS_PATH);
              }}
            >
              Focus deep file
            </button>
          </div>
        }
        footer={
          <dl className="text-muted-foreground mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] leading-5 sm:grid-cols-4">
            <div>
              <dt className="font-semibold">viewportTop</dt>
              <dd>{readout.viewportTop.toFixed(0)}px</dd>
            </div>
            <div>
              <dt className="font-semibold">topInset</dt>
              <dd>{readout.topInset.toFixed(0)}px</dd>
            </div>
            <div>
              <dt className="font-semibold">mounted rows</dt>
              <dd>{readout.mountedPathCount}</dd>
            </div>
            <div>
              <dt className="font-semibold">scroll requests</dt>
              <dd>{readout.requestCount}</dd>
            </div>
            <div className="sm:col-span-4">
              <dt className="font-semibold">sticky folders</dt>
              <dd>
                {readout.stickyPaths.length > 0
                  ? readout.stickyPaths.join(' → ')
                  : '—'}
              </dd>
            </div>
          </dl>
        }
      >
        <div
          ref={scrollContainerRef}
          className="overflow-y-auto rounded-lg border border-[var(--color-border)] bg-neutral-50"
          style={{ height: `${String(SCROLLER_VIEWPORT_HEIGHT)}px` }}
        >
          <div
            className="sticky top-0 z-20 border-b bg-neutral-950 px-4 text-sm font-semibold text-white"
            data-external-scroll-sticky-source="true"
            style={{
              height: `${String(STICKY_TOOLBAR_HEIGHT)}px`,
              lineHeight: `${String(STICKY_TOOLBAR_HEIGHT)}px`,
            }}
          >
            Caller sticky toolbar
          </div>

          {DEMO_SECTIONS.above.map((section) => (
            <DemoSection key={section.id} {...section} />
          ))}

          <section
            className={`border-y px-4 py-4 ${SECTION_TONES.tree}`}
            data-external-scroll-tree-section="true"
          >
            <div className="mb-3 space-y-1">
              <h2 className="text-sm font-semibold tracking-wide uppercase">
                Tree section
              </h2>
              <p className="text-sm leading-6 text-neutral-700">
                The tree itself is not wrapped in an internal scroller here. Its
                header and search UI move with the surrounding document flow.
              </p>
            </div>
            <FileTree
              ref={treeHostRef}
              model={model}
              className="block rounded-md border border-slate-300 bg-white"
              header={
                <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <strong>Project files</strong>
                  <span className="text-xs text-neutral-500">
                    Parent scroller owns the viewport
                  </span>
                </div>
              }
            />
          </section>

          {DEMO_SECTIONS.below.map((section, index) => (
            <div
              key={section.id}
              data-external-scroll-below-target={
                index === 0 ? 'true' : undefined
              }
            >
              <DemoSection {...section} />
            </div>
          ))}
        </div>
      </ExampleCard>
    </div>
  );
}

export function ExternalScrollDemoClient() {
  const { flattenEmptyDirectories } = useTreesDevSettings();

  return (
    <ExternalScrollDemoInstance
      key={flattenEmptyDirectories ? 'flattened' : 'hierarchical'}
      flattenEmptyDirectories={flattenEmptyDirectories}
    />
  );
}
