import { getVirtualizationWorkload } from '@pierre/tree-test-data';

import type { ContextMenuItem } from '../../../src/index';

// This fixture uses the real linux-1x workload plus debug hooks so a formerly
// frame-sensitive sticky trigger bug can be reproduced with tiny scroll deltas
// and measured geometrically instead of eyeballed in the demo.

const fileTreeRuntimePath: string = '/dist/index.js';
const { FileTree } = (await import(
  /* @vite-ignore */ fileTreeRuntimePath
)) as typeof import('../../../src/index');

type StickyRectSnapshot = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

type StickyPositioningSnapshot = {
  contain: string | null;
  display: string | null;
  left: string | null;
  marginBottom: string | null;
  marginTop: string | null;
  position: string | null;
  right: string | null;
  top: string | null;
  transform: string | null;
};

type StickyElementIdentity = {
  dataset: {
    fileTreeStickyOverlay?: string;
    fileTreeStickyOverlayContent?: string;
    fileTreeStickyPath?: string;
    fileTreeVirtualizedList?: string;
    fileTreeVirtualizedRoot?: string;
    fileTreeVirtualizedScroll?: string;
    fileTreeVirtualizedSticky?: string;
    itemPath?: string;
    type?: string;
  };
  role: string | null;
  tagName: string;
};

type StickyAncestorSnapshot = {
  identity: StickyElementIdentity;
  offsetTop: number;
  scrollTop: number;
  style: StickyPositioningSnapshot;
};

type StickyLayerSnapshot = {
  identity: StickyElementIdentity;
  rect: StickyRectSnapshot;
  style: StickyPositioningSnapshot;
};

type StickyContextMenuSample = {
  anchorAncestorChain: StickyAncestorSnapshot[];
  anchorComputedStyle: StickyPositioningSnapshot | null;
  anchorInlineStyle: {
    left: string | null;
    position: string | null;
    right: string | null;
    top: string | null;
    transform: string | null;
  };
  anchorOffsetParent: StickyElementIdentity | null;
  anchorOffsetTop: number | null;
  anchorRect: StickyRectSnapshot | null;
  anchorRectTopWithinOffsetParent: number | null;
  anchorRectTopWithinRoot: number | null;
  anchorRectTopWithinScroll: number | null;
  anchorStyleTop: number | null;
  anchorVisible: boolean;
  driftFromRectWithinRoot: number | null;
  driftFromRectWithinScroll: number | null;
  driftFromStyleWithinRoot: number | null;
  driftFromStyleWithinScroll: number | null;
  driftFromTriggerWithinRoot: number | null;
  driftFromTriggerWithinScroll: number | null;
  path: string;
  rootRect: StickyRectSnapshot;
  rowAncestorChain: StickyAncestorSnapshot[];
  rowComputedStyle: StickyPositioningSnapshot | null;
  rowMounted: boolean;
  rowRect: StickyRectSnapshot | null;
  rowTopWithinRoot: number | null;
  rowTopWithinScroll: number | null;
  scrollRect: StickyRectSnapshot;
  scrollTop: number;
  stickyOverlayContent: StickyLayerSnapshot | null;
  stickyPaths: string[];
  stickyWindow: StickyLayerSnapshot | null;
  triggerComputedStyle: StickyPositioningSnapshot | null;
  triggerRect: StickyRectSnapshot | null;
  triggerRectTopWithinRoot: number | null;
  triggerRectTopWithinScroll: number | null;
  triggerVisible: boolean;
  virtualizedList: StickyLayerSnapshot | null;
  visiblePaths: string[];
};

type StickyContextMenuScenarioStep = {
  before: StickyContextMenuSample;
  immediate: StickyContextMenuSample;
  scrollTop: number;
  settled: StickyContextMenuSample;
};

type StickyContextMenuScenarioCandidate = {
  depth: number;
  path: string;
  scrollTop: number;
  stickyCount: number;
  stickyPaths: string[];
};

type StickyHoverSuppressionSample = {
  anchorDisplay: string | null;
  anchorVisible: boolean;
  menuPath: string | null;
  rowBackgroundColor: string | null;
  rowContextHovered: boolean;
  rowMatchesHover: boolean;
  rowMounted: boolean;
  rowPointerEvents: string | null;
  rootIsScrolling: boolean;
  triggerDisplay: string | null;
  triggerVisible: boolean;
  virtualizedListIsScrolling: boolean;
};

type StickyContextMenuDispatchResult = {
  defaultPrevented: boolean;
  menuPath: string | null;
};

type StickyContextMenuDriftProbe = {
  clearTrigger: () => void;
  dispatchStickyContextMenu: (path: string) => StickyContextMenuDispatchResult;
  findScenarioCandidate: (options?: {
    maxScrollTop?: number;
    minDepth?: number;
    minStickyCount?: number;
    settleFrames?: number;
    step?: number;
  }) => Promise<StickyContextMenuScenarioCandidate | null>;
  hoverRow: (path: string) => void;
  nextFrames: (count?: number) => Promise<void>;
  runScenario: (
    path: string,
    scrollTops: readonly number[],
    settleFrames?: number
  ) => Promise<StickyContextMenuScenarioStep[]>;
  sample: (path: string) => StickyContextMenuSample;
  sampleHoverSuppression: (path: string) => StickyHoverSuppressionSample;
  setScrollSuppressionDisabled: (disabled: boolean) => void;
  setScrollTop: (scrollTop: number) => void;
  setTriggerPath: (path: string | null) => void;
};

type StickyContextMenuDriftWindow = Window & {
  __stickyContextMenuDriftFixtureReady?: boolean;
  __stickyContextMenuDriftProbe?: StickyContextMenuDriftProbe;
};

const mount = document.querySelector('[data-sticky-drift-mount]');
const report = document.querySelector('[data-sticky-drift-report]');
if (!(mount instanceof HTMLDivElement) || !(report instanceof HTMLPreElement)) {
  throw new Error('Missing sticky context-menu drift fixture shell.');
}

const workload = getVirtualizationWorkload('linux-1x');
const fileTree = new FileTree({
  composition: {
    contextMenu: {
      enabled: true,
      render: (item: ContextMenuItem) => {
        const menu = document.createElement('div');
        menu.dataset.testStickyDriftMenu = item.path;
        menu.textContent = `Menu for ${item.path}`;
        return menu;
      },
      triggerMode: 'both',
    },
  },
  fileTreeSearchMode: 'hide-non-matches',
  flattenEmptyDirectories: true,
  initialExpandedPaths: workload.expandedFolders,
  paths: workload.presortedFiles,
  search: true,
  stickyFolders: true,
  initialVisibleRowCount: 700 / 30,
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
    if (
      host instanceof HTMLElement &&
      host.shadowRoot?.querySelector('button[data-type="item"]') != null
    ) {
      return host;
    }

    if (performance.now() - started > 5_000) {
      throw new Error('Timed out waiting for the sticky drift fixture tree.');
    }

    await new Promise((resolve) => setTimeout(resolve, 16));
  }
};

const host = await waitForTree();
const getShadow = (): ShadowRoot => {
  if (!(host.shadowRoot instanceof ShadowRoot)) {
    throw new Error('Expected open shadow root on sticky drift fixture host.');
  }
  return host.shadowRoot;
};

const getRootElement = (): HTMLElement => {
  const rootElement = getShadow().querySelector(
    '[data-file-tree-virtualized-root="true"]'
  );
  if (!(rootElement instanceof HTMLElement)) {
    throw new Error('Missing sticky drift root element.');
  }
  return rootElement;
};

const getScrollElement = (): HTMLElement => {
  const scrollElement = getShadow().querySelector(
    '[data-file-tree-virtualized-scroll="true"]'
  );
  if (!(scrollElement instanceof HTMLElement)) {
    throw new Error('Missing sticky drift scroll element.');
  }
  return scrollElement;
};

const getAnchorElement = (): HTMLDivElement | null => {
  const anchor = getShadow().querySelector('[data-type="context-menu-anchor"]');
  return anchor instanceof HTMLDivElement ? anchor : null;
};

const getTriggerElement = (): HTMLButtonElement | null => {
  const trigger = getShadow().querySelector(
    '[data-type="context-menu-trigger"]'
  );
  return trigger instanceof HTMLButtonElement ? trigger : null;
};

const getStickyOverlayContentElement = (): HTMLElement | null => {
  const overlayContent = getShadow().querySelector(
    '[data-file-tree-sticky-overlay-content="true"]'
  );
  return overlayContent instanceof HTMLElement ? overlayContent : null;
};

const getStickyWindowElement = (): HTMLElement | null => {
  const stickyWindow = getShadow().querySelector(
    '[data-file-tree-virtualized-sticky="true"]'
  );
  return stickyWindow instanceof HTMLElement ? stickyWindow : null;
};

const getVirtualizedListElement = (): HTMLElement | null => {
  const listElement = getShadow().querySelector(
    '[data-file-tree-virtualized-list="true"]'
  );
  return listElement instanceof HTMLElement ? listElement : null;
};

const getVisibleRowButtons = (): HTMLButtonElement[] =>
  Array.from(getShadow().querySelectorAll('button[data-type="item"]')).filter(
    (button): button is HTMLButtonElement =>
      button instanceof HTMLButtonElement &&
      button.dataset.itemParked !== 'true' &&
      button.dataset.itemPath != null
  );

const getStickyRowButtons = (): HTMLButtonElement[] =>
  Array.from(
    getShadow().querySelectorAll('button[data-file-tree-sticky-row="true"]')
  ).filter(
    (button): button is HTMLButtonElement =>
      button instanceof HTMLButtonElement &&
      button.dataset.fileTreeStickyPath != null
  );

const getRowButton = (path: string): HTMLButtonElement | null =>
  getStickyRowButtons().find(
    (button) => button.dataset.fileTreeStickyPath === path
  ) ??
  getVisibleRowButtons().find((button) => button.dataset.itemPath === path) ??
  null;

const getStickyPaths = (): string[] =>
  Array.from(getShadow().querySelectorAll('[data-file-tree-sticky-path]'))
    .map((element) =>
      element instanceof HTMLElement ? element.dataset.fileTreeStickyPath : null
    )
    .filter((path): path is string => path != null);

const parsePixelValue = (value: string | null | undefined): number | null => {
  if (value == null || value === '') {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const serializeRect = (rect: DOMRect | DOMRectReadOnly): StickyRectSnapshot => {
  return {
    bottom: rect.bottom,
    height: rect.height,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    width: rect.width,
  };
};

const emptyStringToNull = (value: string): string | null => {
  return value === '' ? null : value;
};

const serializePositioningStyle = (
  style: CSSStyleDeclaration
): StickyPositioningSnapshot => {
  return {
    contain: emptyStringToNull(style.contain),
    display: emptyStringToNull(style.display),
    left: emptyStringToNull(style.left),
    marginBottom: emptyStringToNull(style.marginBottom),
    marginTop: emptyStringToNull(style.marginTop),
    position: emptyStringToNull(style.position),
    right: emptyStringToNull(style.right),
    top: emptyStringToNull(style.top),
    transform: emptyStringToNull(style.transform),
  };
};

const getElementIdentity = (
  element: HTMLElement | null
): StickyElementIdentity | null => {
  if (element == null) {
    return null;
  }

  return {
    dataset: {
      fileTreeStickyOverlay: element.dataset.fileTreeStickyOverlay,
      fileTreeStickyOverlayContent:
        element.dataset.fileTreeStickyOverlayContent,
      fileTreeStickyPath: element.dataset.fileTreeStickyPath,
      fileTreeVirtualizedList: element.dataset.fileTreeVirtualizedList,
      fileTreeVirtualizedRoot: element.dataset.fileTreeVirtualizedRoot,
      fileTreeVirtualizedScroll: element.dataset.fileTreeVirtualizedScroll,
      fileTreeVirtualizedSticky: element.dataset.fileTreeVirtualizedSticky,
      itemPath: element.dataset.itemPath,
      type: element.dataset.type,
    },
    role: element.getAttribute('role'),
    tagName: element.tagName.toLowerCase(),
  };
};

const serializeLayer = (
  element: HTMLElement | null
): StickyLayerSnapshot | null => {
  if (element == null) {
    return null;
  }

  const identity = getElementIdentity(element);
  if (identity == null) {
    return null;
  }

  return {
    identity,
    rect: serializeRect(element.getBoundingClientRect()),
    style: serializePositioningStyle(getComputedStyle(element)),
  };
};

// Capture the full positioned ancestor chain so a single sample shows which
// container establishes each coordinate system and whether any transform is live.
const collectAncestorChain = (
  element: HTMLElement | null,
  stopAt: HTMLElement
): StickyAncestorSnapshot[] => {
  const chain: StickyAncestorSnapshot[] = [];

  for (
    let current = element;
    current != null;
    current = current.parentElement
  ) {
    const identity = getElementIdentity(current);
    if (identity != null) {
      chain.push({
        identity,
        offsetTop: current.offsetTop,
        scrollTop: current.scrollTop,
        style: serializePositioningStyle(getComputedStyle(current)),
      });
    }

    if (current === stopAt) {
      break;
    }
  }

  return chain;
};

const getPathDepth = (path: string): number => {
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;
  if (normalizedPath.length === 0) {
    return 0;
  }

  return normalizedPath.split('/').length - 1;
};

const writeReport = (value: unknown): void => {
  report.textContent = JSON.stringify(value, null, 2);
};

const setTriggerPath = (path: string | null): void => {
  getRootElement().dispatchEvent(
    new CustomEvent('file-tree-debug-set-context-menu-trigger', {
      detail: { path },
    })
  );
};

const clearTrigger = (): void => {
  setTriggerPath(null);
};

const hoverRow = (path: string): void => {
  const row = getRowButton(path);
  if (!(row instanceof HTMLButtonElement)) {
    throw new Error(`Expected visible row for ${path}`);
  }

  row.dispatchEvent(
    new PointerEvent('pointerover', { bubbles: true, composed: true })
  );
};

const getRenderedMenuPath = (): string | null => {
  const menu = document.querySelector('[data-test-sticky-drift-menu]');
  return menu instanceof HTMLElement
    ? (menu.dataset.testStickyDriftMenu ?? null)
    : null;
};

// Samples the sticky row, root scroll-suppression flags, and floating trigger
// together so the test can catch one-frame disagreements between them.
const sampleHoverSuppression = (path: string): StickyHoverSuppressionSample => {
  const row = getRowButton(path);
  const rowStyle = row == null ? null : getComputedStyle(row);
  const anchor = getAnchorElement();
  const anchorStyle = anchor == null ? null : getComputedStyle(anchor);
  const trigger = getTriggerElement();
  const triggerStyle = trigger == null ? null : getComputedStyle(trigger);
  const virtualizedList = getVirtualizedListElement();

  return {
    anchorDisplay: emptyStringToNull(anchorStyle?.display ?? ''),
    anchorVisible: anchor?.dataset.visible === 'true',
    menuPath: getRenderedMenuPath(),
    rowBackgroundColor: emptyStringToNull(rowStyle?.backgroundColor ?? ''),
    rowContextHovered: row?.dataset.itemContextHover === 'true',
    rowMatchesHover: row?.matches(':hover') === true,
    rowMounted: row instanceof HTMLButtonElement,
    rowPointerEvents: emptyStringToNull(rowStyle?.pointerEvents ?? ''),
    rootIsScrolling: getRootElement().dataset.isScrolling != null,
    triggerDisplay: emptyStringToNull(triggerStyle?.display ?? ''),
    triggerVisible: trigger?.dataset.visible === 'true',
    virtualizedListIsScrolling: virtualizedList?.dataset.isScrolling != null,
  };
};

// Bypasses browser hit-testing to prove late contextmenu events still cannot
// open a sticky-row menu while the tree is suppressing scroll interactions.
const dispatchStickyContextMenu = (
  path: string
): StickyContextMenuDispatchResult => {
  const row = getRowButton(path);
  if (!(row instanceof HTMLButtonElement)) {
    throw new Error(`Expected visible row for ${path}`);
  }

  const rect = row.getBoundingClientRect();
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    button: 2,
    cancelable: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    composed: true,
  });
  const dispatched = row.dispatchEvent(event);

  return {
    defaultPrevented: event.defaultPrevented || !dispatched,
    menuPath: getRenderedMenuPath(),
  };
};

const setScrollSuppressionDisabled = (disabled: boolean): void => {
  getRootElement().dispatchEvent(
    new CustomEvent('file-tree-debug-set-scroll-suppression', {
      detail: { disabled },
    })
  );
};

const setScrollTop = (scrollTop: number): void => {
  const scrollElement = getScrollElement();
  scrollElement.scrollTop = scrollTop;
  scrollElement.dispatchEvent(new Event('scroll'));
};

const sample = (path: string): StickyContextMenuSample => {
  const rootElement = getRootElement();
  const scrollElement = getScrollElement();
  const stickyOverlayContentElement = getStickyOverlayContentElement();
  const stickyWindowElement = getStickyWindowElement();
  const virtualizedListElement = getVirtualizedListElement();
  const rootRect = rootElement.getBoundingClientRect();
  const scrollRect = scrollElement.getBoundingClientRect();
  const row = getRowButton(path);
  const anchor = getAnchorElement();
  const trigger = getTriggerElement();
  const rowRect = row?.getBoundingClientRect() ?? null;
  const anchorRect = anchor?.getBoundingClientRect() ?? null;
  const triggerRect = trigger?.getBoundingClientRect() ?? null;
  const rowTopWithinRoot = rowRect == null ? null : rowRect.top - rootRect.top;
  const rowTopWithinScroll =
    rowRect == null ? null : rowRect.top - scrollRect.top;
  const anchorRectTopWithinRoot =
    anchorRect == null ? null : anchorRect.top - rootRect.top;
  const anchorRectTopWithinScroll =
    anchorRect == null ? null : anchorRect.top - scrollRect.top;
  const triggerRectTopWithinRoot =
    triggerRect == null ? null : triggerRect.top - rootRect.top;
  const triggerRectTopWithinScroll =
    triggerRect == null ? null : triggerRect.top - scrollRect.top;
  const anchorStyleTop = parsePixelValue(anchor?.style.top);
  const anchorOffsetParent =
    anchor?.offsetParent instanceof HTMLElement ? anchor.offsetParent : null;
  const anchorOffsetParentRect =
    anchorOffsetParent?.getBoundingClientRect() ?? null;
  const anchorRectTopWithinOffsetParent =
    anchorRect == null || anchorOffsetParentRect == null
      ? null
      : anchorRect.top - anchorOffsetParentRect.top;
  const rowComputedStyle =
    row == null ? null : serializePositioningStyle(getComputedStyle(row));
  const anchorComputedStyle =
    anchor == null ? null : serializePositioningStyle(getComputedStyle(anchor));
  const triggerComputedStyle =
    trigger == null
      ? null
      : serializePositioningStyle(getComputedStyle(trigger));

  return {
    anchorAncestorChain: collectAncestorChain(anchor, rootElement),
    anchorComputedStyle,
    anchorInlineStyle: {
      left: emptyStringToNull(anchor?.style.left ?? ''),
      position: emptyStringToNull(anchor?.style.position ?? ''),
      right: emptyStringToNull(anchor?.style.right ?? ''),
      top: emptyStringToNull(anchor?.style.top ?? ''),
      transform: emptyStringToNull(anchor?.style.transform ?? ''),
    },
    anchorOffsetParent: getElementIdentity(anchorOffsetParent),
    anchorOffsetTop: anchor?.offsetTop ?? null,
    anchorRect: anchorRect == null ? null : serializeRect(anchorRect),
    anchorRectTopWithinOffsetParent,
    anchorRectTopWithinRoot,
    anchorRectTopWithinScroll,
    anchorStyleTop,
    anchorVisible: anchor?.dataset.visible === 'true',
    driftFromRectWithinRoot:
      anchorRectTopWithinRoot == null || rowTopWithinRoot == null
        ? null
        : anchorRectTopWithinRoot - rowTopWithinRoot,
    driftFromRectWithinScroll:
      anchorRectTopWithinScroll == null || rowTopWithinScroll == null
        ? null
        : anchorRectTopWithinScroll - rowTopWithinScroll,
    driftFromStyleWithinRoot:
      anchorStyleTop == null || rowTopWithinRoot == null
        ? null
        : anchorStyleTop - rowTopWithinRoot,
    driftFromStyleWithinScroll:
      anchorStyleTop == null || rowTopWithinScroll == null
        ? null
        : anchorStyleTop - rowTopWithinScroll,
    driftFromTriggerWithinRoot:
      triggerRectTopWithinRoot == null || rowTopWithinRoot == null
        ? null
        : triggerRectTopWithinRoot - rowTopWithinRoot,
    driftFromTriggerWithinScroll:
      triggerRectTopWithinScroll == null || rowTopWithinScroll == null
        ? null
        : triggerRectTopWithinScroll - rowTopWithinScroll,
    path,
    rootRect: serializeRect(rootRect),
    rowAncestorChain: collectAncestorChain(row, rootElement),
    rowComputedStyle,
    rowMounted: row instanceof HTMLButtonElement,
    rowRect: rowRect == null ? null : serializeRect(rowRect),
    rowTopWithinRoot,
    rowTopWithinScroll,
    scrollRect: serializeRect(scrollRect),
    scrollTop: scrollElement.scrollTop,
    stickyOverlayContent: serializeLayer(stickyOverlayContentElement),
    stickyPaths: getStickyPaths(),
    stickyWindow: serializeLayer(stickyWindowElement),
    triggerComputedStyle,
    triggerRect: triggerRect == null ? null : serializeRect(triggerRect),
    triggerRectTopWithinRoot,
    triggerRectTopWithinScroll,
    triggerVisible: trigger?.dataset.visible === 'true',
    virtualizedList: serializeLayer(virtualizedListElement),
    visiblePaths: getVisibleRowButtons()
      .map((button) => button.dataset.itemPath)
      .filter((nextPath): nextPath is string => nextPath != null),
  };
};

const findScenarioCandidate: StickyContextMenuDriftProbe['findScenarioCandidate'] =
  async (options) => {
    const {
      maxScrollTop,
      minDepth = 4,
      minStickyCount = 3,
      settleFrames = 2,
      step = 30,
    } = options ?? {};
    const scrollElement = getScrollElement();
    const finalScrollTop = Math.min(
      maxScrollTop ?? Number.POSITIVE_INFINITY,
      Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight)
    );

    for (let scrollTop = 0; scrollTop <= finalScrollTop; scrollTop += step) {
      setScrollTop(scrollTop);
      await nextFrames(settleFrames);

      const stickyPaths = getStickyPaths();
      if (stickyPaths.length < minStickyCount) {
        continue;
      }

      const stickyPathSet = new Set(stickyPaths);
      const scrollRect = scrollElement.getBoundingClientRect();
      const candidate = getVisibleRowButtons()
        .map((button) => {
          const buttonPath = button.dataset.itemPath ?? '';
          const rowRect = button.getBoundingClientRect();
          const rowTopWithinScroll = rowRect.top - scrollRect.top;
          const rowBottomWithinScroll = rowRect.bottom - scrollRect.top;
          return {
            depth: getPathDepth(buttonPath),
            path: buttonPath,
            rowBottomWithinScroll,
            rowTopWithinScroll,
          };
        })
        .filter((row) => {
          return (
            row.path !== '' &&
            !stickyPathSet.has(row.path) &&
            row.depth >= minDepth &&
            row.rowTopWithinScroll >= 0 &&
            row.rowBottomWithinScroll <= scrollElement.clientHeight
          );
        })
        .sort((left, right) => {
          const rowTopDelta =
            left.rowTopWithinScroll - right.rowTopWithinScroll;
          if (rowTopDelta !== 0) {
            return rowTopDelta;
          }

          return right.depth - left.depth;
        })[0];

      if (candidate != null) {
        const result = {
          depth: candidate.depth,
          path: candidate.path,
          scrollTop,
          stickyCount: stickyPaths.length,
          stickyPaths,
        } satisfies StickyContextMenuScenarioCandidate;
        writeReport({ candidate: result });
        return result;
      }
    }

    writeReport({ candidate: null });
    return null;
  };

const runScenario: StickyContextMenuDriftProbe['runScenario'] = async (
  path,
  scrollTops,
  settleFrames = 2
) => {
  const steps: StickyContextMenuScenarioStep[] = [];

  for (const scrollTop of scrollTops) {
    setTriggerPath(path);
    await nextFrames(1);
    const before = sample(path);
    setScrollTop(scrollTop);
    const immediate = sample(path);
    await nextFrames(settleFrames);
    const settled = sample(path);
    steps.push({ before, immediate, scrollTop, settled });
  }

  writeReport({ path, steps });
  return steps;
};

const stickyContextMenuDriftWindow = window as StickyContextMenuDriftWindow;

stickyContextMenuDriftWindow.__stickyContextMenuDriftProbe = {
  clearTrigger,
  dispatchStickyContextMenu,
  findScenarioCandidate,
  hoverRow,
  nextFrames,
  runScenario,
  sample,
  sampleHoverSuppression,
  setScrollSuppressionDisabled,
  setScrollTop,
  setTriggerPath,
};
stickyContextMenuDriftWindow.__stickyContextMenuDriftFixtureReady = true;
writeReport({ ready: true, workload: workload.name });
