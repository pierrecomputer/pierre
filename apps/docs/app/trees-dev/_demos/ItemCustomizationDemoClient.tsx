'use client';

import {
  type ContextMenuItem,
  type ContextMenuOpenContext,
  FileTree,
  type FileTreeOptions,
} from '@pierre/trees';
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createRoot, type Root as ReactDomRoot } from 'react-dom/client';

import { ExampleCard } from '../_components/ExampleCard';
import { getFloatingContextMenuTriggerStyle } from '../_lib/getFloatingContextMenuTriggerStyle';
import {
  getItemCustomizationDecorationPreset,
  getTreesDevGitStatusPreset,
  ITEM_CUSTOMIZATION_DECORATION_PRESETS,
  ITEM_CUSTOMIZATION_DEMO_DEFAULTS,
  type ItemCustomizationDecorationPresetId,
  TREES_DEV_GIT_STATUS_PRESETS,
  type TreesDevGitStatusPresetId,
} from '../_lib/itemCustomizationDemoData';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ItemCustomizationDemoClientProps {
  containerHtml: string;
  fileCountLabel: string;
  sharedOptions: Omit<
    FileTreeOptions,
    | 'composition'
    | 'gitStatus'
    | 'id'
    | 'onSelectionChange'
    | 'renderRowDecoration'
  >;
}

function ItemCustomizationContextMenu({
  item,
  context,
  onAction,
}: {
  item: ContextMenuItem;
  context: Pick<
    ContextMenuOpenContext,
    'anchorRect' | 'close' | 'restoreFocus'
  >;
  onAction: (label: string) => void;
}) {
  const itemType = item.kind === 'directory' ? 'Folder' : 'File';

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
          style={getFloatingContextMenuTriggerStyle(context.anchorRect)}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-test-item-customization-menu="true"
        data-file-tree-context-menu-root="true"
        align="center"
        side="bottom"
        sideOffset={4}
        className="min-w-[220px]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          context.restoreFocus();
        }}
      >
        <DropdownMenuLabel className="max-w-[280px] truncate">
          {itemType}: {item.path}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            onAction(`Inspect row: ${item.path}`);
            context.close();
          }}
        >
          Inspect row
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            onAction(
              item.kind === 'directory'
                ? `Preview directory layout: ${item.path}`
                : `Preview file decoration: ${item.path}`
            );
            context.close();
          }}
        >
          {item.kind === 'directory'
            ? 'Preview directory layout'
            : 'Preview file decoration'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Renders a lightweight docs-owned context menu into the file tree's light-DOM
// slot so the menu stays anchored to the row without affecting lane layout.
function renderItemCustomizationContextMenuSlot({
  item,
  menuRootRef,
  onAction,
  slotElement,
  context,
}: {
  item: ContextMenuItem;
  menuRootRef: { current: ReactDomRoot | null };
  onAction: (label: string) => void;
  slotElement: HTMLDivElement;
  context: Pick<
    ContextMenuOpenContext,
    'anchorRect' | 'close' | 'restoreFocus'
  >;
}): void {
  menuRootRef.current ??= createRoot(slotElement);
  slotElement.style.display = 'block';
  menuRootRef.current.render(
    <ItemCustomizationContextMenu
      item={item}
      context={context}
      onAction={onAction}
    />
  );
}

function clearItemCustomizationContextMenuSlot({
  menuRootRef,
  slotElement,
  unmount = false,
}: {
  menuRootRef: { current: ReactDomRoot | null };
  slotElement: HTMLDivElement;
  unmount?: boolean;
}): void {
  const currentRoot = menuRootRef.current;
  if (currentRoot == null) {
    return;
  }

  slotElement.style.display = 'none';
  if (unmount) {
    menuRootRef.current = null;
    queueMicrotask(() => {
      currentRoot.unmount();
    });
    return;
  }

  currentRoot.render(null);
}

// Restores any selected rows after the tree is recreated so decoration presets
// that react to selection keep their signal when composition options change.
function restoreSelectedPaths(
  fileTree: FileTree,
  selectedPaths: readonly string[]
): void {
  for (const path of selectedPaths) {
    fileTree.getItem(path)?.select();
  }
}

function readCheckboxValue(event: ChangeEvent<HTMLInputElement>): boolean {
  return event.currentTarget.checked;
}

function areSamePathLists(
  left: readonly string[],
  right: readonly string[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function HydratedItemCustomizationTree({
  containerHtml,
  contextMenuRootRef,
  contextMenuSlotRef,
  desiredSelectedPaths,
  gitStatus,
  hasHydratedTreeRef,
  isRestoringSelectionRef,
  options,
}: {
  containerHtml: string;
  contextMenuRootRef: { current: ReactDomRoot | null };
  contextMenuSlotRef: { current: HTMLDivElement | null };
  desiredSelectedPaths: readonly string[];
  gitStatus: FileTreeOptions['gitStatus'];
  hasHydratedTreeRef: { current: boolean };
  isRestoringSelectionRef: { current: boolean };
  options: FileTreeOptions;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = mountRef.current;
    if (node == null) {
      return;
    }

    const fileTree = new FileTree({
      ...options,
      gitStatus,
    });
    const fileTreeContainer = node.querySelector('file-tree-container');
    if (
      !hasHydratedTreeRef.current &&
      fileTreeContainer instanceof HTMLElement
    ) {
      fileTree.hydrate({ fileTreeContainer });
    } else {
      node.innerHTML = '';
      fileTree.render({ containerWrapper: node });
    }
    hasHydratedTreeRef.current = true;

    // Selection changes should update rows in place. We only snapshot the
    // current selection when mounting a replacement tree for a structural
    // control change such as a different decoration preset.
    isRestoringSelectionRef.current = desiredSelectedPaths.length > 0;
    const restoreSelectionFrame = requestAnimationFrame(() => {
      restoreSelectedPaths(fileTree, desiredSelectedPaths);
      if (desiredSelectedPaths.length === 0) {
        isRestoringSelectionRef.current = false;
      }
    });

    return () => {
      cancelAnimationFrame(restoreSelectionFrame);
      if (contextMenuSlotRef.current != null) {
        clearItemCustomizationContextMenuSlot({
          menuRootRef: contextMenuRootRef,
          slotElement: contextMenuSlotRef.current,
          unmount: true,
        });
      }
      fileTree.cleanUp();
    };
  }, [
    containerHtml,
    contextMenuRootRef,
    contextMenuSlotRef,
    gitStatus,
    hasHydratedTreeRef,
    isRestoringSelectionRef,
    options,
  ]);

  return (
    <div
      ref={mountRef}
      data-test-item-customization-tree="true"
      style={{ height: `${String(options.viewportHeight ?? 360)}px` }}
      dangerouslySetInnerHTML={{ __html: containerHtml }}
      suppressHydrationWarning
    />
  );
}

export function ItemCustomizationDemoClient({
  containerHtml,
  fileCountLabel,
  sharedOptions,
}: ItemCustomizationDemoClientProps) {
  const desiredSelectedPathsRef = useRef<readonly string[]>([]);
  const hasHydratedTreeRef = useRef(false);
  const isRestoringSelectionRef = useRef(false);
  const contextMenuRootRef = useRef<ReactDomRoot | null>(null);
  const contextMenuSlotRef = useRef<HTMLDivElement | null>(null);
  const [contextMenuEnabled, setContextMenuEnabled] = useState(
    ITEM_CUSTOMIZATION_DEMO_DEFAULTS.contextMenuEnabled
  );
  const [triggerMode, setTriggerMode] = useState(
    ITEM_CUSTOMIZATION_DEMO_DEFAULTS.triggerMode
  );
  const [buttonVisibility, setButtonVisibility] = useState(
    ITEM_CUSTOMIZATION_DEMO_DEFAULTS.buttonVisibility
  );
  const [gitStatusEnabled, setGitStatusEnabled] = useState(
    ITEM_CUSTOMIZATION_DEMO_DEFAULTS.gitStatusEnabled
  );
  const [gitStatusPresetId, setGitStatusPresetId] =
    useState<TreesDevGitStatusPresetId>(
      ITEM_CUSTOMIZATION_DEMO_DEFAULTS.gitStatusPresetId
    );
  const [decorationPresetId, setDecorationPresetId] =
    useState<ItemCustomizationDecorationPresetId>(
      ITEM_CUSTOMIZATION_DEMO_DEFAULTS.decorationPresetId
    );
  const [selectedPaths, setSelectedPaths] = useState<readonly string[]>([]);
  const [lastMenuInteraction, setLastMenuInteraction] = useState(
    'Open the context menu to inspect a row.'
  );

  const activeGitStatusPreset = useMemo(
    () => getTreesDevGitStatusPreset(gitStatusPresetId),
    [gitStatusPresetId]
  );
  const activeDecorationPreset = useMemo(
    () => getItemCustomizationDecorationPreset(decorationPresetId),
    [decorationPresetId]
  );
  const gitStatus = gitStatusEnabled
    ? activeGitStatusPreset.entries
    : undefined;
  const showButtonVisibilityControl =
    contextMenuEnabled && triggerMode !== 'right-click';

  const activeDecorationRenderer = activeDecorationPreset.renderer ?? undefined;

  const handleSelectionChange = useCallback(
    (nextSelectedPaths: readonly string[]) => {
      const desiredSelectedPaths = desiredSelectedPathsRef.current;
      if (isRestoringSelectionRef.current) {
        if (areSamePathLists(nextSelectedPaths, desiredSelectedPaths)) {
          isRestoringSelectionRef.current = false;
          setSelectedPaths(nextSelectedPaths);
        }
        return;
      }

      desiredSelectedPathsRef.current = nextSelectedPaths;
      setSelectedPaths(nextSelectedPaths);
    },
    []
  );

  const handleMenuAction = useCallback((label: string) => {
    setLastMenuInteraction(label);
  }, []);

  const structuralOptions = useMemo<FileTreeOptions>(() => {
    return {
      ...sharedOptions,
      composition: {
        contextMenu: contextMenuEnabled
          ? {
              buttonVisibility:
                triggerMode === 'right-click' ? undefined : buttonVisibility,
              enabled: true,
              onClose: () => {
                if (contextMenuSlotRef.current != null) {
                  clearItemCustomizationContextMenuSlot({
                    menuRootRef: contextMenuRootRef,
                    slotElement: contextMenuSlotRef.current,
                  });
                }
              },
              onOpen: (item) => {
                setLastMenuInteraction(`Opened menu for ${item.path}`);
              },
              render: (
                item: ContextMenuItem,
                context: ContextMenuOpenContext
              ) => {
                contextMenuSlotRef.current ??= document.createElement('div');
                renderItemCustomizationContextMenuSlot({
                  context,
                  item,
                  menuRootRef: contextMenuRootRef,
                  onAction: handleMenuAction,
                  slotElement: contextMenuSlotRef.current,
                });
                return contextMenuSlotRef.current;
              },
              triggerMode,
            }
          : { enabled: false },
      },
      id: 'trees-dev-item-customization',
      onSelectionChange: handleSelectionChange,
      renderRowDecoration: activeDecorationRenderer,
    };
  }, [
    activeDecorationRenderer,
    buttonVisibility,
    contextMenuEnabled,
    handleMenuAction,
    handleSelectionChange,
    sharedOptions,
    triggerMode,
  ]);

  const selectedPathSummary =
    selectedPaths.length === 0
      ? 'None yet. Click a file row to exercise the selected-file icon preset.'
      : selectedPaths.join(', ');
  const treeMountKey = [
    contextMenuEnabled ? 'context-menu-on' : 'context-menu-off',
    triggerMode,
    buttonVisibility,
    gitStatusEnabled ? gitStatusPresetId : 'git-status-off',
    decorationPresetId,
  ].join(':');

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Item Customization</h1>
        <p className="text-muted-foreground max-w-3xl text-sm leading-6">
          This route fixes the content base to the demo-small workload so the
          same {fileCountLabel} can be viewed through different context-menu,
          decoration, and git-status combinations. Toggle the controls to see
          how the custom decoration lane, built-in git lane, and action
          affordance coexist on realistic rows.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <section className="space-y-5 rounded-lg border border-[var(--color-border)] bg-white p-4 text-sm shadow-xs dark:bg-black">
          <div className="space-y-1">
            <h2 className="text-sm font-bold">Controls</h2>
            <p className="text-muted-foreground text-xs leading-5">
              State stays local to this page. Change the controls, then click
              rows to compare the combined right-side lanes.
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Context menu
            </h3>
            <label className="flex items-center gap-2">
              <input
                data-test-item-customization-context-menu-enabled="true"
                type="checkbox"
                checked={contextMenuEnabled}
                onChange={(event) => {
                  setContextMenuEnabled(readCheckboxValue(event));
                }}
              />
              Enable context menu
            </label>
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">Trigger mode</span>
              <select
                data-test-item-customization-trigger-mode="true"
                className="h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 text-sm"
                value={triggerMode}
                disabled={!contextMenuEnabled}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  if (
                    value === 'both' ||
                    value === 'button' ||
                    value === 'right-click'
                  ) {
                    setTriggerMode(value);
                  }
                }}
              >
                <option value="both">both</option>
                <option value="button">button</option>
                <option value="right-click">right-click</option>
              </select>
            </label>
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">Button visibility</span>
              <select
                data-test-item-customization-button-visibility="true"
                className="h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                value={buttonVisibility}
                disabled={!showButtonVisibilityControl}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  if (value === 'always' || value === 'when-needed') {
                    setButtonVisibility(value);
                  }
                }}
              >
                <option value="always">always</option>
                <option value="when-needed">when-needed</option>
              </select>
            </label>
            <p className="text-muted-foreground text-xs leading-5">
              {triggerMode === 'right-click'
                ? 'Right-click mode removes the action lane, so button visibility is disabled.'
                : 'Button-capable modes keep the action lane mounted and let you compare decorative versus hover-only affordances.'}
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Row decoration
            </h3>
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">Decoration preset</span>
              <select
                data-test-item-customization-decoration-preset="true"
                className="h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 text-sm"
                value={decorationPresetId}
                onChange={(event) => {
                  setDecorationPresetId(
                    event.currentTarget
                      .value as ItemCustomizationDecorationPresetId
                  );
                }}
              >
                {ITEM_CUSTOMIZATION_DECORATION_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <p
              data-test-item-customization-decoration-description="true"
              className="text-muted-foreground text-xs leading-5"
            >
              {activeDecorationPreset.description}
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Git status
            </h3>
            <label className="flex items-center gap-2">
              <input
                data-test-item-customization-git-status-enabled="true"
                type="checkbox"
                checked={gitStatusEnabled}
                onChange={(event) => {
                  setGitStatusEnabled(readCheckboxValue(event));
                }}
              />
              Enable git status lane
            </label>
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">Preset</span>
              <select
                data-test-item-customization-git-status-preset="true"
                className="h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                value={gitStatusPresetId}
                disabled={!gitStatusEnabled}
                onChange={(event) => {
                  setGitStatusPresetId(
                    event.currentTarget.value as TreesDevGitStatusPresetId
                  );
                }}
              >
                {TREES_DEV_GIT_STATUS_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <p
              data-test-item-customization-git-status-description="true"
              className="text-muted-foreground text-xs leading-5"
            >
              {activeGitStatusPreset.description}
            </p>
          </div>

          <div className="space-y-2 rounded-md border border-dashed border-[var(--color-border)] p-3 text-xs leading-5">
            <p>
              <strong>Selected rows:</strong>{' '}
              <span data-test-item-customization-selected-paths="true">
                {selectedPathSummary}
              </span>
            </p>
            <p>
              <strong>Last menu interaction:</strong>{' '}
              <span data-test-item-customization-last-menu-action="true">
                {lastMenuInteraction}
              </span>
            </p>
          </div>
        </section>

        <ExampleCard
          title="Hydrated customization tree"
          description="One tree instance visualizes how context-menu affordances, custom row decoration, and built-in git status share the right side of each row. Click rows, open menus, and flip presets to compare the resulting lane composition."
          footer={
            <div className="text-muted-foreground mt-3 space-y-1 text-xs leading-5">
              <p>
                Active decoration preset:{' '}
                <strong>{activeDecorationPreset.label}</strong>
              </p>
              <p>
                Active git-status preset:{' '}
                <strong>{activeGitStatusPreset.label}</strong>
              </p>
            </div>
          }
        >
          <HydratedItemCustomizationTree
            key={treeMountKey}
            containerHtml={containerHtml}
            contextMenuRootRef={contextMenuRootRef}
            contextMenuSlotRef={contextMenuSlotRef}
            desiredSelectedPaths={desiredSelectedPathsRef.current}
            gitStatus={gitStatus}
            hasHydratedTreeRef={hasHydratedTreeRef}
            isRestoringSelectionRef={isRestoringSelectionRef}
            options={structuralOptions}
          />
        </ExampleCard>
      </div>
    </div>
  );
}
