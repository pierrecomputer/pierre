import type {
  FileTreeExternalScrollRequestContext,
  FileTreeExternalScrollSnapshot,
  FileTreeExternalScrollSource,
} from '../../../src/scroll';

const fileTreeRuntimePath: string = '/dist/scroll/index.js';
const { FileTree } = (await import(
  /* @vite-ignore */ fileTreeRuntimePath
)) as typeof import('../../../src/scroll');

type ExternalScrollRequest = {
  context: FileTreeExternalScrollRequestContext;
  viewportTop: number;
};

type ExternalScrollSample = {
  belowTopWithinScroller: number;
  mountedPaths: string[];
  parentScrollTop: number;
  requestCount: number;
  requests: ExternalScrollRequest[];
  stickyPaths: string[];
  stickyTopWithinScroller: number | null;
  topInset: number;
};

type ExternalScrollProbe = {
  focusFirstRow: () => Promise<void>;
  nextFrames: (count?: number) => Promise<void>;
  pressFocusedRowKey: (key: string) => Promise<void>;
  sample: () => ExternalScrollSample;
  setScrollTop: (scrollTop: number) => Promise<void>;
};

type ExternalScrollWindow = Window & {
  __externalScrollFixtureReady?: boolean;
  __externalScrollProbe?: ExternalScrollProbe;
};

class FixtureExternalScrollSource implements FileTreeExternalScrollSource {
  readonly requests: ExternalScrollRequest[] = [];
  #host: HTMLElement | null = null;
  #listeners = new Set<() => void>();
  #snapshot: FileTreeExternalScrollSnapshot = {
    topInset: 40,
    viewportHeight: 360,
    viewportTop: -1_000,
  };

  constructor(private readonly scrollContainer: HTMLElement) {}

  attachHost(host: HTMLElement): void {
    this.#host = host;
    this.updateFromDom('unknown');
  }

  getSnapshot(): FileTreeExternalScrollSnapshot {
    return this.#snapshot;
  }

  scrollToViewportTop(
    viewportTop: number,
    context: FileTreeExternalScrollRequestContext
  ): void {
    this.requests.push({ context, viewportTop });
    const currentViewportTop = this.#readViewportTop();
    this.scrollContainer.scrollTop += viewportTop - currentViewportTop;
    this.updateFromDom('programmatic', false);
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  updateFromDom(
    scrollOrigin: FileTreeExternalScrollSnapshot['scrollOrigin'] = 'user',
    notify: boolean = true
  ): void {
    this.#snapshot = {
      isScrolling: false,
      scrollOrigin,
      topInset: this.#readTopInset(),
      viewportHeight: this.scrollContainer.clientHeight,
      viewportTop: this.#readViewportTop(),
    };
    if (!notify) {
      return;
    }
    for (const listener of this.#listeners) {
      listener();
    }
  }

  #readTopInset(): number {
    const toolbar = this.scrollContainer.querySelector(
      '[data-external-scroll-sticky]'
    );
    return toolbar instanceof HTMLElement
      ? toolbar.getBoundingClientRect().height
      : 0;
  }

  #readViewportTop(): number {
    if (this.#host == null) {
      return this.#snapshot.viewportTop;
    }

    return (
      this.scrollContainer.getBoundingClientRect().top -
      this.#host.getBoundingClientRect().top
    );
  }
}

const scrollContainer = document.querySelector('[data-external-scroll-shell]');
const mount = document.querySelector('[data-external-scroll-mount]');
const below = document.querySelector('[data-external-scroll-below]');
if (
  !(scrollContainer instanceof HTMLElement) ||
  !(mount instanceof HTMLDivElement) ||
  !(below instanceof HTMLElement)
) {
  throw new Error('Missing external scroll fixture shell.');
}

const paths = [
  ...Array.from(
    { length: 40 },
    (_, index) => `src/file_${String(index).padStart(3, '0')}.ts`
  ),
  ...Array.from(
    { length: 16 },
    (_, index) => `src/nested/file_${String(index).padStart(3, '0')}.ts`
  ),
  ...Array.from(
    { length: 24 },
    (_, index) => `test/spec_${String(index).padStart(3, '0')}.ts`
  ),
  ...Array.from(
    { length: 24 },
    (_, index) => `z/file_${String(index).padStart(3, '0')}.ts`
  ),
];

const source = new FixtureExternalScrollSource(scrollContainer);
const fileTree = new FileTree({
  externalScroll: {
    initialSnapshot: source.getSnapshot(),
    source,
  },
  flattenEmptyDirectories: false,
  initialExpansion: 'open',
  overscan: 1,
  paths,
  stickyFolders: true,
});
fileTree.render({ containerWrapper: mount });

const nextFrames = async (count: number = 2): Promise<void> => {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
};

const waitForTree = async (): Promise<HTMLElement> => {
  const started = performance.now();
  while (true) {
    const host = mount.querySelector('file-tree-container');
    if (host instanceof HTMLElement && host.shadowRoot != null) {
      return host;
    }

    if (performance.now() - started > 5_000) {
      throw new Error('Timed out waiting for external scroll fixture tree.');
    }

    await new Promise((resolve) => setTimeout(resolve, 16));
  }
};

const host = await waitForTree();
source.attachHost(host);
await nextFrames(2);

scrollContainer.addEventListener('scroll', () => {
  source.updateFromDom('user');
});

const getShadow = (): ShadowRoot => {
  if (!(host.shadowRoot instanceof ShadowRoot)) {
    throw new Error(
      'Expected open shadow root on external scroll fixture host.'
    );
  }
  return host.shadowRoot;
};

const getMountedPaths = (): string[] =>
  Array.from(
    getShadow().querySelectorAll(
      'button[data-type="item"]:not([data-file-tree-sticky-row="true"])'
    )
  )
    .filter((element): element is HTMLElement => element instanceof HTMLElement)
    .filter((element) => element.dataset.itemParked !== 'true')
    .map((element) => element.dataset.itemPath)
    .filter((path): path is string => path != null);

const getStickyRows = (): HTMLElement[] =>
  Array.from(
    getShadow().querySelectorAll('button[data-file-tree-sticky-row="true"]')
  ).filter((element): element is HTMLElement => element instanceof HTMLElement);

const sample = (): ExternalScrollSample => {
  const scrollRect = scrollContainer.getBoundingClientRect();
  const stickyRows = getStickyRows();
  const firstStickyRow = stickyRows[0] ?? null;
  return {
    belowTopWithinScroller: below.getBoundingClientRect().top - scrollRect.top,
    mountedPaths: getMountedPaths(),
    parentScrollTop: scrollContainer.scrollTop,
    requestCount: source.requests.length,
    requests: [...source.requests],
    stickyPaths: stickyRows
      .map((element) => element.dataset.fileTreeStickyPath)
      .filter((path): path is string => path != null),
    stickyTopWithinScroller:
      firstStickyRow == null
        ? null
        : firstStickyRow.getBoundingClientRect().top - scrollRect.top,
    topInset: source.getSnapshot().topInset ?? 0,
  };
};

const setScrollTop: ExternalScrollProbe['setScrollTop'] = async (scrollTop) => {
  scrollContainer.scrollTop = scrollTop;
  source.updateFromDom('user');
  await nextFrames(2);
};

const focusFirstRow: ExternalScrollProbe['focusFirstRow'] = async () => {
  const firstRow = getShadow().querySelector(
    'button[data-type="item"]:not([data-file-tree-sticky-row="true"])'
  );
  if (!(firstRow instanceof HTMLButtonElement)) {
    throw new Error('Missing first mounted external scroll row.');
  }
  firstRow.focus({ preventScroll: true });
  await nextFrames(1);
};

const pressFocusedRowKey: ExternalScrollProbe['pressFocusedRowKey'] = async (
  key
) => {
  const focused = getShadow().activeElement;
  if (!(focused instanceof HTMLButtonElement)) {
    throw new Error(`Expected focused row before pressing ${key}.`);
  }
  focused.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key })
  );
  await nextFrames(2);
};

(window as ExternalScrollWindow).__externalScrollProbe = {
  focusFirstRow,
  nextFrames,
  pressFocusedRowKey,
  sample,
  setScrollTop,
};
(window as ExternalScrollWindow).__externalScrollFixtureReady = true;
