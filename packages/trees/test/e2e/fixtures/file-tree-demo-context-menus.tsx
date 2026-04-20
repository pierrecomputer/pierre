/** @jsxImportSource react */

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { createRoot, type Root } from 'react-dom/client';

import type {
  ContextMenuItem,
  ContextMenuOpenContext,
} from '../../../src/index';

const fileTreeRuntimePath: string = '/dist/index.js';
const reactRuntimePath: string = '/dist/react/index.js';

const { FileTree: FileTreeModel } = (await import(
  /* @vite-ignore */ fileTreeRuntimePath
)) as typeof import('../../../src/index');
const { FileTree, useFileTree } = (await import(
  /* @vite-ignore */ reactRuntimePath
)) as typeof import('../../../src/react/index');

declare global {
  interface Window {
    __fileTreeDemoContextMenuFixtureReady?: boolean;
  }
}

type ContextMenuRoot = Root | null;
type DemoContextMenuItem = ContextMenuItem;
type DemoContextMenuContext = Pick<
  ContextMenuOpenContext,
  'anchorRect' | 'close' | 'restoreFocus'
>;

const getFloatingTriggerStyle = (
  anchorRect: ContextMenuOpenContext['anchorRect']
) => {
  const anchorCenterX = anchorRect.left + anchorRect.width / 2;
  return {
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: 'none',
    border: 0,
    padding: 0,
    position: 'fixed',
    left: `${anchorCenterX}px`,
    top: `${anchorRect.bottom - 1}px`,
    transform: 'translateX(-50%)',
  } as const;
};

const portaledMenuContentStyle = {
  minWidth: '220px',
  padding: '8px',
  border: '1px solid #d4d4d8',
  borderRadius: '10px',
  background: 'white',
  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.18)',
  display: 'grid',
  gap: '8px',
  zIndex: 1000,
} as const;

const reactMenuContentStyle = {
  minWidth: '220px',
  border: '1px solid #d4d4d8',
  borderRadius: '10px',
  background: 'white',
  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.08)',
  display: 'inline-grid',
  padding: '8px 12px',
  fontSize: '14px',
} as const;

const menuItemStyle = {
  display: 'block',
  width: '100%',
  border: 0,
  borderRadius: '6px',
  background: 'transparent',
  padding: '6px 8px',
  textAlign: 'left',
} as const;

function PortaledRadixContextMenu({
  context,
  item,
  variant,
}: {
  context: DemoContextMenuContext;
  item: DemoContextMenuItem;
  variant: string;
}) {
  return (
    <DropdownMenu.Root
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) {
          context.close();
        }
      }}
    >
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          style={getFloatingTriggerStyle(context.anchorRect)}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          data-test-context-menu="true"
          data-test-context-menu-variant={variant}
          data-file-tree-context-menu-root="true"
          align="center"
          side="bottom"
          sideOffset={4}
          style={portaledMenuContentStyle}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            context.restoreFocus();
          }}
        >
          <DropdownMenu.Label style={{ fontWeight: 600 }}>
            Menu for {item.path}
          </DropdownMenu.Label>
          <DropdownMenu.Separator
            style={{ height: '1px', background: '#e4e4e7' }}
          />
          <DropdownMenu.Item
            data-test-menu-action={`${variant}:${item.path}`}
            style={menuItemStyle}
            onSelect={() => {
              context.close();
            }}
          >
            Rename
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ReactClientFixture() {
  const { model } = useFileTree({
    composition: {
      contextMenu: {
        buttonVisibility: 'always',
        enabled: true,
        triggerMode: 'button',
      },
    },
    id: 'ft-react-context-menu-demo',
    initialExpansion: 'open',
    paths: [
      'README.md',
      'src/index.ts',
      'src/components/Button.tsx',
      'src/components/Button.test.tsx',
    ],
    search: true,
    initialVisibleRowCount: 240 / 30,
  });

  return (
    <FileTree
      model={model}
      renderContextMenu={(item: DemoContextMenuItem) => (
        <div
          data-test-context-menu="true"
          data-test-context-menu-variant="react-client"
          style={reactMenuContentStyle}
        >
          Menu for {item.path}
        </div>
      )}
      style={{ height: '240px' }}
    />
  );
}

interface PortaledMenuController {
  clear: () => void;
  render: (
    item: DemoContextMenuItem,
    context: DemoContextMenuContext
  ) => HTMLDivElement;
}

function createPortaledMenuController(variant: string): PortaledMenuController {
  let slotElement: HTMLDivElement | null = null;
  let menuRoot: ContextMenuRoot = null;

  return {
    clear() {
      if (slotElement != null) {
        slotElement.style.display = 'none';
      }
      menuRoot?.render(null);
    },
    render(item: DemoContextMenuItem, context: DemoContextMenuContext) {
      slotElement ??= document.createElement('div');
      slotElement.style.display = 'block';
      menuRoot ??= createRoot(slotElement);
      menuRoot.render(
        <PortaledRadixContextMenu
          context={context}
          item={item}
          variant={variant}
        />
      );
      return slotElement;
    },
  };
}

const radixMount = document.querySelector(
  '[data-demo-context-menu-mount="radix-portaled"]'
);
const rightClickOnlyMount = document.querySelector(
  '[data-demo-context-menu-mount="right-click-only"]'
);
const reactMount = document.querySelector(
  '[data-demo-context-menu-mount="react-client"]'
);
if (
  !(radixMount instanceof HTMLDivElement) ||
  !(rightClickOnlyMount instanceof HTMLDivElement) ||
  !(reactMount instanceof HTMLDivElement)
) {
  throw new Error('Missing demo context-menu fixture mounts.');
}

const radixPortaledMenu = createPortaledMenuController('radix-portaled');
const rightClickOnlyMenu = createPortaledMenuController('right-click-only');

const portaledTree = new FileTreeModel({
  composition: {
    contextMenu: {
      buttonVisibility: 'always',
      enabled: true,
      onClose: () => {
        radixPortaledMenu.clear();
      },
      render: (item: DemoContextMenuItem, context: DemoContextMenuContext) =>
        radixPortaledMenu.render(item, context),
      triggerMode: 'both',
    },
  },
  id: 'ft-portaled-context-menu-demo',
  initialExpansion: 'open',
  paths: ['README.md', 'src/index.ts', 'src/utils/worker.ts'],
  initialVisibleRowCount: 240 / 30,
});
portaledTree.render({ containerWrapper: radixMount });

const rightClickOnlyTree = new FileTreeModel({
  composition: {
    contextMenu: {
      enabled: true,
      onClose: () => {
        rightClickOnlyMenu.clear();
      },
      render: (item: DemoContextMenuItem, context: DemoContextMenuContext) =>
        rightClickOnlyMenu.render(item, context),
      triggerMode: 'right-click',
    },
  },
  id: 'ft-right-click-only-context-menu-demo',
  initialExpansion: 'open',
  paths: ['README.md', 'src/index.ts', 'src/utils/worker.ts'],
  initialVisibleRowCount: 240 / 30,
});
rightClickOnlyTree.render({ containerWrapper: rightClickOnlyMount });

createRoot(reactMount).render(<ReactClientFixture />);

const waitForTree = async (mount: HTMLDivElement): Promise<void> => {
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
      throw new Error('Timed out waiting for the demo context-menu fixture.');
    }

    await new Promise((resolve) => setTimeout(resolve, 16));
  }
};

await Promise.all([
  waitForTree(radixMount),
  waitForTree(rightClickOnlyMount),
  waitForTree(reactMount),
]);
window.__fileTreeDemoContextMenuFixtureReady = true;
