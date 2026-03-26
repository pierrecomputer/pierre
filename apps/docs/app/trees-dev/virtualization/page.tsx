'use client';

import { CONTEXT_MENU_SLOT_NAME, FileTree } from '@pierre/trees';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Root as ReactDomRoot } from 'react-dom/client';

import { ExampleCard } from '../_components/ExampleCard';
import {
  clearVanillaContextMenuSlot,
  makeDemoRenamingOptions,
  renderVanillaContextMenuSlot,
} from '../_components/TreeDemoContextMenu';
import { linuxKernelAllFolders, linuxKernelFiles } from '../demo-data';

export default function VirtualizationPage() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">
        Virtualized ({linuxKernelFiles.length.toLocaleString()} files)
      </h1>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <VirtualizedLinuxKernelCard />
        <UnvirtualizedLinuxKernelCard />
      </div>
    </>
  );
}

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
          // TODO: this shouldnt be in a different place than
          // initialExpandedItems (this should probably move to
          // the state config)
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
