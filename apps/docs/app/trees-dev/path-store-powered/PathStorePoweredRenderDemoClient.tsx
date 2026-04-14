'use client';

import {
  PathStoreFileTree,
  type PathStoreFileTreeOptions,
} from '@pierre/trees/path-store';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Root as ReactDomRoot } from 'react-dom/client';

import { ExampleCard } from '../_components/ExampleCard';
import { StateLog, useStateLog } from '../_components/StateLog';
import {
  clearVanillaContextMenuSlot,
  renderVanillaContextMenuSlot,
} from '../_components/TreeDemoContextMenu';
import { pathStoreCapabilityMatrix } from './capabilityMatrix';
import { createPresortedPreparedInput } from './createPresortedPreparedInput';
import { PATH_STORE_CUSTOM_ICONS } from './pathStoreDemoIcons';

interface SharedDemoOptions extends Omit<
  PathStoreFileTreeOptions,
  'id' | 'preparedInput'
> {}

interface PathStorePoweredRenderDemoClientProps {
  containerHtml: string;
  sharedOptions: SharedDemoOptions;
}

const HydratedPathStoreExample = memo(function HydratedPathStoreExample({
  containerHtml,
  description,
  onTreeReady,
  options,
  title,
}: {
  containerHtml: string;
  description: string;
  onTreeReady: (fileTree: PathStoreFileTree | null) => void;
  options: Omit<PathStoreFileTreeOptions, 'icons'>;
  title: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (node == null) {
      return;
    }

    const fileTree = new PathStoreFileTree(options);
    onTreeReady(fileTree);
    const fileTreeContainer = node.querySelector('file-tree-container');
    if (fileTreeContainer instanceof HTMLElement) {
      fileTree.hydrate({ fileTreeContainer });
    } else {
      node.innerHTML = '';
      fileTree.render({ containerWrapper: node });
    }

    return () => {
      fileTree.cleanUp();
      onTreeReady(null);
    };
  }, [containerHtml, onTreeReady, options]);

  return (
    <ExampleCard title={title} description={description}>
      <div
        ref={ref}
        style={{ height: `${String(options.viewportHeight ?? 420)}px` }}
        dangerouslySetInnerHTML={{ __html: containerHtml }}
        suppressHydrationWarning
      />
    </ExampleCard>
  );
});

export function PathStorePoweredRenderDemoClient({
  containerHtml,
  sharedOptions,
}: PathStorePoweredRenderDemoClientProps) {
  const { addLog, log } = useStateLog();
  const contextMenuRootRef = useRef<ReactDomRoot | null>(null);
  const contextMenuSlotRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<PathStoreFileTree | null>(null);
  const [iconMode, setIconMode] = useState<
    'complete' | 'custom' | 'minimal' | 'standard'
  >('complete');
  const preparedInput = useMemo(
    () => createPresortedPreparedInput(sharedOptions.paths),
    [sharedOptions.paths]
  );
  const handleSelectionChange = useCallback(
    (selectedPaths: readonly string[]) => {
      addLog(`selected: [${selectedPaths.join(', ')}]`);
    },
    [addLog]
  );
  useEffect(
    () => () => {
      if (contextMenuSlotRef.current == null) {
        return;
      }

      clearVanillaContextMenuSlot({
        menuRootRef: contextMenuRootRef,
        slotElement: contextMenuSlotRef.current,
        unmount: true,
      });
    },
    []
  );
  const options = useMemo<Omit<PathStoreFileTreeOptions, 'icons'>>(
    () => ({
      ...sharedOptions,
      composition: {
        ...sharedOptions.composition,
        contextMenu: {
          enabled: true,
          onClose: () => {
            if (contextMenuSlotRef.current != null) {
              clearVanillaContextMenuSlot({
                menuRootRef: contextMenuRootRef,
                slotElement: contextMenuSlotRef.current,
              });
            }
            addLog('context menu: closed');
          },
          onOpen: (item) => {
            addLog(`context menu: opened for ${item.path}`);
          },
          render: (item, context) => {
            contextMenuSlotRef.current ??= document.createElement('div');
            renderVanillaContextMenuSlot({
              context,
              item: {
                isFolder: item.kind === 'directory',
                path: item.path,
              },
              menuRootRef: contextMenuRootRef,
              slotElement: contextMenuSlotRef.current,
            });
            return contextMenuSlotRef.current;
          },
        },
        header: {
          ...sharedOptions.composition?.header,
          render: () => {
            const header = document.createElement('div');
            header.style.alignItems = 'center';
            header.style.display = 'flex';
            header.style.gap = '12px';
            header.style.padding = '8px 12px';

            const label = document.createElement('strong');
            label.textContent = 'Provisional header slot';
            header.append(label);

            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = 'Log header action';
            button.addEventListener('click', () => {
              addLog('header action: clicked');
            });
            header.append(button);

            return header;
          },
        },
      },
      id: 'pst-phase5-icons',
      onSelectionChange: handleSelectionChange,
      preparedInput,
      renderRowDecoration: ({ item }) =>
        item.path.endsWith('.ts')
          ? { text: 'TS', title: 'TypeScript file' }
          : null,
    }),
    [addLog, handleSelectionChange, preparedInput, sharedOptions]
  );
  const activeIcons =
    iconMode === 'custom' ? PATH_STORE_CUSTOM_ICONS : iconMode;
  const handleTreeReady = useCallback((fileTree: PathStoreFileTree | null) => {
    treeRef.current = fileTree;
  }, []);

  useEffect(() => {
    treeRef.current?.setIcons(activeIcons);
  }, [activeIcons]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Path-store lane · provisional
        </p>
        <h1 className="text-2xl font-bold">
          Focus + Selection + Header Slot + Icon Sets
        </h1>
        <p className="text-muted-foreground max-w-3xl text-sm leading-6">
          The path-store lane keeps the landed focus and selection model,
          preserves the header slot, proves the built-in Minimal, Standard, and
          Complete icon sets, and now restores the Phase 5 context-menu shell
          plus simple row decorations.
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            aria-pressed={iconMode === 'complete'}
            onClick={() => {
              setIconMode('complete');
              addLog('icons: complete');
            }}
          >
            Show Complete icons
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            aria-pressed={iconMode === 'standard'}
            onClick={() => {
              setIconMode('standard');
              addLog('icons: standard');
            }}
          >
            Show Standard icons
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            aria-pressed={iconMode === 'minimal'}
            onClick={() => {
              setIconMode('minimal');
              addLog('icons: minimal');
            }}
          >
            Show Minimal icons
          </button>
        </div>
      </header>

      <HydratedPathStoreExample
        containerHtml={containerHtml}
        description="Click a row to select it, use Ctrl/Cmd-click and Shift-click for multi-selection, try the slotted header button above the tree, switch between the Complete, Standard, and Minimal icon modes, and right-click or press Shift+F10 to open the slotted context menu. Expansion, selection, and focus should stay intact while only the icons change."
        onTreeReady={handleTreeReady}
        options={options}
        title="Focus + Selection + Header Slot + Icon Sets + Context Menu"
      />
      <StateLog entries={log} />

      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="text-lg font-semibold">Capability / phase matrix</h2>
        <p className="text-muted-foreground text-sm leading-6">
          This committed matrix keeps the migration proof surfaces explicit
          while the new lane grows feature by feature.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-3 py-2 font-medium">Current demo</th>
                <th className="px-3 py-2 font-medium">Target phase(s)</th>
                <th className="px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {pathStoreCapabilityMatrix.map((row) => (
                <tr key={row.currentDemo} className="border-t align-top">
                  <td className="px-3 py-2 font-medium">{row.currentDemo}</td>
                  <td className="px-3 py-2">
                    {row.targetPhases
                      .map((phase) => `P${String(phase)}`)
                      .join(', ')}
                  </td>
                  <td className="text-muted-foreground px-3 py-2">
                    {row.notes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
