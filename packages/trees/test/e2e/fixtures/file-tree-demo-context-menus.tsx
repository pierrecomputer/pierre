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
}: {
  context: DemoContextMenuContext;
  item: DemoContextMenuItem;
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
          data-test-context-menu-variant="radix-portaled"
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
            data-test-menu-action={`portaled:${item.path}`}
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
    id: 'ft-react-context-menu-demo',
    initialExpansion: 'open',
    paths: [
      'README.md',
      'src/index.ts',
      'src/components/Button.tsx',
      'src/components/Button.test.tsx',
    ],
    search: true,
    viewportHeight: 240,
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

const radixMount = document.querySelector(
  '[data-demo-context-menu-mount="radix-portaled"]'
);
const reactMount = document.querySelector(
  '[data-demo-context-menu-mount="react-client"]'
);
if (
  !(radixMount instanceof HTMLDivElement) ||
  !(reactMount instanceof HTMLDivElement)
) {
  throw new Error('Missing demo context-menu fixture mounts.');
}

let slotElement: HTMLDivElement | null = null;
let menuRoot: ContextMenuRoot = null;

const clearPortaledContextMenu = (): void => {
  if (slotElement != null) {
    slotElement.style.display = 'none';
  }
  menuRoot?.render(null);
};

const renderPortaledContextMenu = (
  item: DemoContextMenuItem,
  context: DemoContextMenuContext
): HTMLDivElement => {
  slotElement ??= document.createElement('div');
  slotElement.style.display = 'block';
  menuRoot ??= createRoot(slotElement);
  menuRoot.render(<PortaledRadixContextMenu context={context} item={item} />);
  return slotElement;
};

const portaledTree = new FileTreeModel({
  composition: {
    contextMenu: {
      enabled: true,
      onClose: () => {
        clearPortaledContextMenu();
      },
      render: (item: DemoContextMenuItem, context: DemoContextMenuContext) =>
        renderPortaledContextMenu(item, context),
    },
  },
  id: 'ft-portaled-context-menu-demo',
  initialExpansion: 'open',
  paths: ['README.md', 'src/index.ts', 'src/utils/worker.ts'],
  viewportHeight: 240,
});
portaledTree.render({ containerWrapper: radixMount });

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

await Promise.all([waitForTree(radixMount), waitForTree(reactMount)]);
window.__fileTreeDemoContextMenuFixtureReady = true;
