import type {
  ContextMenuItem,
  ContextMenuOpenContext,
  FileTree as FileTreeModelType,
} from '../../../src/index';

const fileTreeRuntimePath: string = '/dist/index.js';

const { FileTree } = (await import(
  /* @vite-ignore */ fileTreeRuntimePath
)) as typeof import('../../../src/index');

declare global {
  interface Window {
    __fileTreeRenameFixtureReady?: boolean;
  }
}

type PortaledRenameContext = Pick<
  ContextMenuOpenContext,
  'anchorRect' | 'close' | 'restoreFocus'
>;

type PortaledRenameItem = Pick<ContextMenuItem, 'path'>;

const mount = document.querySelector('[data-file-tree-portaled-rename-mount]');
const log = document.querySelector('[data-file-tree-portaled-rename-log]');
if (!(mount instanceof HTMLDivElement) || !(log instanceof HTMLDivElement)) {
  throw new Error('Missing portaled rename fixture mounts.');
}

const appendLog = (message: string): void => {
  const row = document.createElement('div');
  row.textContent = message;
  log.append(row);
  log.scrollTop = log.scrollHeight;
};

let tree: FileTreeModelType | null = null;
let activeMenu: HTMLDivElement | null = null;
let slotElement: HTMLDivElement | null = null;

const clearPortaledMenu = (): void => {
  activeMenu?.remove();
  activeMenu = null;
  if (slotElement != null) {
    slotElement.style.display = 'none';
  }
};

const renderPortaledContextMenu = (
  item: PortaledRenameItem,
  context: PortaledRenameContext
): HTMLDivElement => {
  clearPortaledMenu();
  slotElement ??= document.createElement('div');
  slotElement.style.display = 'block';

  const menu = document.createElement('div');
  menu.setAttribute('data-test-context-menu', 'true');
  menu.setAttribute('data-test-context-menu-mode', 'portaled');
  menu.setAttribute('data-file-tree-context-menu-root', 'true');
  menu.style.position = 'fixed';
  menu.style.left = `${String((context.anchorRect.right ?? context.anchorRect.left ?? 16) + 8)}px`;
  menu.style.top = `${String(context.anchorRect.top ?? context.anchorRect.bottom ?? 16)}px`;
  menu.style.display = 'inline-flex';
  menu.style.gap = '8px';
  menu.style.padding = '8px';
  menu.style.border = '1px solid #ccc';
  menu.style.borderRadius = '8px';
  menu.style.background = 'white';
  menu.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.12)';
  menu.style.zIndex = '1000';

  const renameButton = document.createElement('button');
  renameButton.type = 'button';
  renameButton.textContent = 'Rename';
  renameButton.setAttribute('data-test-menu-rename', item.path);
  renameButton.addEventListener('click', () => {
    context.close({ restoreFocus: false });
    const started = tree?.startRenaming(item.path) ?? false;
    appendLog(
      started ? `rename:start ${item.path}` : `rename:unavailable ${item.path}`
    );
    queueMicrotask(() => {
      context.close();
      context.restoreFocus();
      clearPortaledMenu();
    });
  });

  menu.append(renameButton);
  document.body.append(menu);
  activeMenu = menu;
  return slotElement;
};

tree = new FileTree({
  composition: {
    contextMenu: {
      enabled: true,
      onClose: () => {
        appendLog('context menu:closed');
        if (slotElement != null) {
          slotElement.style.display = 'none';
        }
      },
      onOpen: (item: PortaledRenameItem) => {
        appendLog(`context menu:opened ${item.path}`);
      },
      render: (item: PortaledRenameItem, context: PortaledRenameContext) =>
        renderPortaledContextMenu(item, context),
    },
  },
  id: 'ft-portaled-rename',
  initialExpansion: 'open',
  paths: ['README.md', 'src/index.ts', 'src/utils/worker.ts'],
  renaming: true,
  viewportHeight: 300,
});
tree.render({ containerWrapper: mount });

const waitForTree = async (): Promise<void> => {
  const started = performance.now();
  while (true) {
    const host = mount.querySelector('file-tree-container');
    if (
      host instanceof HTMLElement &&
      host.shadowRoot?.querySelector('button[data-type="item"]') != null
    ) {
      return;
    }

    if (performance.now() - started > 5000) {
      throw new Error('Timed out waiting for the portaled rename fixture.');
    }

    await new Promise((resolve) => setTimeout(resolve, 16));
  }
};

await waitForTree();
window.__fileTreeRenameFixtureReady = true;
