import { getVirtualizationWorkload } from '@pierre/tree-test-data';

import type { ContextMenuItem } from '../../../src/index';

const fileTreeRuntimePath: string = '/dist/index.js';
const { FileTree, preparePresortedFileTreeInput } = (await import(
  /* @vite-ignore */ fileTreeRuntimePath
)) as typeof import('../../../src/index');

type StickyKeyboardRowSnapshot = {
  bottomWithinScroll: number;
  isFocused: boolean;
  isParked: boolean;
  isSticky: boolean;
  path: string;
  topWithinScroll: number;
};

type StickyKeyboardSample = {
  activeElementPath: string | null;
  activeElementIsParked: boolean;
  activeElementIsSticky: boolean;
  contextMenuPath: string | null;
  focusedPath: string | null;
  focusedRows: StickyKeyboardRowSnapshot[];
  mountedFlowPaths: string[];
  rows: StickyKeyboardRowSnapshot[];
  scrollTop: number;
  stickyOverlayBottomWithinScroll: number;
  stickyPaths: string[];
};

type StickyKeyboardNavigationProbe = {
  focusStickyDomOnly: (path: string) => Promise<void>;
  focusStickyPath: (path: string) => Promise<void>;
  nextFrames: (count?: number) => Promise<void>;
  sample: () => StickyKeyboardSample;
  setScrollTop: (scrollTop: number) => void;
};

type StickyKeyboardNavigationWindow = Window & {
  __stickyKeyboardNavigationFixtureReady?: boolean;
  __stickyKeyboardNavigationProbe?: StickyKeyboardNavigationProbe;
};

type SyntheticBranchWorkload = {
  expandedFolders: string[];
  paths: string[];
};

const createSyntheticBranchWorkload = (): SyntheticBranchWorkload => {
  const letters = ['a', 'b', 'c', 'd'] as const;
  const expandedFolders = new Set<string>();
  const paths: string[] = [];

  const addFiles = (folderPath: string): void => {
    for (let index = 1; index <= 16; index += 1) {
      paths.push(`${folderPath}/file_${String(index)}`);
    }
  };

  const addFolder = (folderPath: string, depth: number): void => {
    expandedFolders.add(`${folderPath}/`);
    addFiles(folderPath);

    const nextLetter = letters[depth + 1];
    if (nextLetter == null) {
      return;
    }

    addFolder(`${folderPath}/${nextLetter}1`, depth + 1);
    addFolder(`${folderPath}/${nextLetter}2`, depth + 1);
  };

  addFolder('a1', 0);
  addFolder('a2', 0);

  return {
    expandedFolders: [...expandedFolders],
    paths,
  };
};

const mount = document.querySelector('[data-sticky-keyboard-mount]');
const report = document.querySelector('[data-sticky-keyboard-report]');
if (!(mount instanceof HTMLDivElement) || !(report instanceof HTMLPreElement)) {
  throw new Error('Missing sticky keyboard navigation fixture shell.');
}

const scenario = new URL(window.location.href).searchParams.get('scenario');
const hasFractionalHeader =
  new URL(window.location.href).searchParams.get('fractional-header') ===
  'true';
const workload = getVirtualizationWorkload('linux-1x');
const syntheticBranchWorkload = createSyntheticBranchWorkload();
const renderContextMenu = (item: ContextMenuItem): HTMLElement => {
  const menu = document.createElement('div');
  menu.dataset.testStickyKeyboardMenu = item.path;
  menu.textContent = `Menu for ${item.path}`;
  return menu;
};
const headerComposition = hasFractionalHeader
  ? {
      html: '<div data-sticky-keyboard-fractional-header style="height:77.5px">Fractional header</div>',
    }
  : undefined;
const fileTree =
  scenario === 'synthetic-branch'
    ? new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
            render: renderContextMenu,
            triggerMode: 'both',
          },
          header: headerComposition,
        },
        fileTreeSearchMode: 'hide-non-matches',
        flattenEmptyDirectories: true,
        initialExpandedPaths: syntheticBranchWorkload.expandedFolders,
        paths: syntheticBranchWorkload.paths,
        search: true,
        stickyFolders: true,
        initialVisibleRowCount: 700 / 30,
      })
    : new FileTree({
        composition: {
          contextMenu: {
            enabled: true,
            render: renderContextMenu,
            triggerMode: 'both',
          },
          header: headerComposition,
        },
        fileTreeSearchMode: 'hide-non-matches',
        flattenEmptyDirectories: true,
        initialExpandedPaths: workload.expandedFolders,
        preparedInput: preparePresortedFileTreeInput(workload.presortedFiles),
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
      throw new Error(
        'Timed out waiting for sticky keyboard navigation fixture tree.'
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 16));
  }
};

const host = await waitForTree();
const getShadow = (): ShadowRoot => {
  if (!(host.shadowRoot instanceof ShadowRoot)) {
    throw new Error(
      'Expected open shadow root on sticky keyboard navigation fixture host.'
    );
  }
  return host.shadowRoot;
};

const getScrollElement = (): HTMLElement => {
  const scrollElement = getShadow().querySelector(
    '[data-file-tree-virtualized-scroll="true"]'
  );
  if (!(scrollElement instanceof HTMLElement)) {
    throw new Error('Missing sticky keyboard navigation scroll element.');
  }
  return scrollElement;
};

const getStickyOverlayContentElement = (): HTMLElement | null => {
  const overlayContent = getShadow().querySelector(
    '[data-file-tree-sticky-overlay-content="true"]'
  );
  return overlayContent instanceof HTMLElement ? overlayContent : null;
};

const getStickyRowButton = (path: string): HTMLButtonElement => {
  const button = getShadow().querySelector(
    `button[data-file-tree-sticky-row="true"][data-file-tree-sticky-path="${path}"]`
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing sticky keyboard row for ${path}`);
  }
  return button;
};

const getRows = (): HTMLButtonElement[] =>
  Array.from(getShadow().querySelectorAll('button[data-type="item"]')).filter(
    (button): button is HTMLButtonElement => button instanceof HTMLButtonElement
  );

const getStickyPaths = (): string[] =>
  Array.from(
    getShadow().querySelectorAll('button[data-file-tree-sticky-row="true"]')
  )
    .map((element) =>
      element instanceof HTMLElement ? element.dataset.fileTreeStickyPath : null
    )
    .filter((path): path is string => path != null);

const writeReport = (value: unknown): void => {
  report.textContent = JSON.stringify(value, null, 2);
};

const setScrollTop = (scrollTop: number): void => {
  const scrollElement = getScrollElement();
  scrollElement.scrollTop = scrollTop;
  scrollElement.dispatchEvent(new Event('scroll'));
};

const focusStickyPath: StickyKeyboardNavigationProbe['focusStickyPath'] =
  async (path) => {
    fileTree.focusPath(path);
    await nextFrames(1);
    getStickyRowButton(path).focus({ preventScroll: true });
    await nextFrames(1);
  };

const focusStickyDomOnly: StickyKeyboardNavigationProbe['focusStickyDomOnly'] =
  async (path) => {
    getStickyRowButton(path).focus({ preventScroll: true });
    await nextFrames(1);
  };

const getRowPath = (element: HTMLElement): string | null =>
  element.dataset.fileTreeStickyPath ?? element.dataset.itemPath ?? null;

const sample = (): StickyKeyboardSample => {
  const scrollElement = getScrollElement();
  const scrollRect = scrollElement.getBoundingClientRect();
  const overlayRect = getStickyOverlayContentElement()?.getBoundingClientRect();
  const activeElement = getShadow().activeElement;
  const activeHtmlElement =
    activeElement instanceof HTMLElement ? activeElement : null;
  const contextMenu = host.querySelector('[data-test-sticky-keyboard-menu]');
  const rows = getRows()
    .map((button): StickyKeyboardRowSnapshot | null => {
      const path = getRowPath(button);
      if (path == null) {
        return null;
      }

      const rect = button.getBoundingClientRect();
      return {
        bottomWithinScroll: rect.bottom - scrollRect.top,
        isFocused: button.dataset.itemFocused === 'true',
        isParked: button.dataset.itemParked === 'true',
        isSticky: button.dataset.fileTreeStickyRow === 'true',
        path,
        topWithinScroll: rect.top - scrollRect.top,
      };
    })
    .filter((row): row is StickyKeyboardRowSnapshot => row != null);
  const focusedRows = rows.filter((row) => row.isFocused);
  const mountedFlowPaths = rows
    .filter((row) => !row.isSticky && !row.isParked)
    .map((row) => row.path);
  const result = {
    activeElementPath:
      activeHtmlElement == null ? null : getRowPath(activeHtmlElement),
    activeElementIsParked:
      activeHtmlElement?.dataset.itemParked === 'true' ? true : false,
    activeElementIsSticky:
      activeHtmlElement?.dataset.fileTreeStickyRow === 'true' ? true : false,
    contextMenuPath:
      contextMenu instanceof HTMLElement
        ? (contextMenu.dataset.testStickyKeyboardMenu ?? null)
        : null,
    focusedPath: fileTree.getFocusedPath(),
    focusedRows,
    mountedFlowPaths,
    rows,
    scrollTop: scrollElement.scrollTop,
    stickyOverlayBottomWithinScroll:
      overlayRect == null ? 0 : overlayRect.bottom - scrollRect.top,
    stickyPaths: getStickyPaths(),
  } satisfies StickyKeyboardSample;
  writeReport(result);
  return result;
};

const stickyKeyboardNavigationWindow = window as StickyKeyboardNavigationWindow;
stickyKeyboardNavigationWindow.__stickyKeyboardNavigationProbe = {
  focusStickyDomOnly,
  focusStickyPath,
  nextFrames,
  sample,
  setScrollTop,
};
stickyKeyboardNavigationWindow.__stickyKeyboardNavigationFixtureReady = true;
writeReport({ ready: true, scenario: scenario ?? 'linux-1x' });
