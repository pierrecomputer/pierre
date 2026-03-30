'use client';

import { CONTEXT_MENU_SLOT_NAME, FileTree } from '@pierre/trees';
import type { FileTreeOptions, FileTreeStateConfig } from '@pierre/trees';
import { FileTree as FileTreeReact } from '@pierre/trees/react';
import '@pierre/trees/web-components';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Root as ReactDomRoot } from 'react-dom/client';

import { cleanupFileTreeInstance } from '../_components/cleanupFileTreeInstance';
import { ExampleCard } from '../_components/ExampleCard';
import {
  clearVanillaContextMenuSlot,
  makeDemoRenamingOptions,
  renderVanillaContextMenuSlot,
  TreeDemoContextMenu,
} from '../_components/TreeDemoContextMenu';
import { useTreesDevSettings } from '../_components/TreesDevSettingsProvider';
import { sharedDemoStateConfig } from '../demo-data';

interface ContextMenuDemoClientProps {
  preloadedContextMenuFileTreeHtml: string;
  preloadedContextMenuFileTreeContainerHtml: string;
}

export function ContextMenuDemoClient({
  preloadedContextMenuFileTreeHtml,
  preloadedContextMenuFileTreeContainerHtml,
}: ContextMenuDemoClientProps) {
  const { fileTreeOptions, reactOptions, reactFiles } = useTreesDevSettings();

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Context Menu</h1>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <ExampleCard
          title="Context Menu (Vanilla SSR)"
          description="HTML prerendered on the server, hydrated with FileTree on the client, with menu content injected imperatively"
        >
          <VanillaSSRContextMenu
            options={fileTreeOptions}
            stateConfig={sharedDemoStateConfig}
            containerHtml={preloadedContextMenuFileTreeContainerHtml}
          />
        </ExampleCard>
        <ExampleCard
          title="Context Menu (React SSR)"
          description="React FileTree prerendered on the server, hydrated on the client, with menu content rendered through the slot"
        >
          <ReactSSRContextMenu
            options={reactOptions}
            initialFiles={reactFiles}
            stateConfig={sharedDemoStateConfig}
            prerenderedHTML={preloadedContextMenuFileTreeHtml}
          />
        </ExampleCard>
      </div>
    </>
  );
}

function VanillaSSRContextMenu({
  options,
  stateConfig,
  containerHtml,
}: {
  options: FileTreeOptions;
  stateConfig?: FileTreeStateConfig;
  containerHtml: string;
}) {
  const instanceRef = useRef<FileTree | null>(null);
  const hasHydratedRef = useRef(false);
  const menuRootRef = useRef<ReactDomRoot | null>(null);
  const [files, setFiles] = useState<string[]>(options.initialFiles);
  const filesRef = useRef(files);
  const renamingOptions = useMemo(
    () => makeDemoRenamingOptions('vanilla-ssr'),
    []
  );

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (node == null) {
        return;
      }

      const fileTreeContainer = node.querySelector('file-tree-container');
      if (!(fileTreeContainer instanceof HTMLElement)) return;

      cleanupFileTreeInstance(fileTreeContainer, instanceRef);

      const slotElement = document.createElement('div');
      slotElement.setAttribute('slot', CONTEXT_MENU_SLOT_NAME);
      slotElement.style.display = 'none';
      fileTreeContainer.appendChild(slotElement);

      const closeMenu = () => {
        clearVanillaContextMenuSlot({
          slotElement,
          menuRootRef,
        });
      };

      const fileTree = new FileTree(
        {
          ...options,
          initialFiles: filesRef.current,
          renaming: renamingOptions,
        },
        {
          ...stateConfig,
          onFilesChange: (nextFiles) => {
            filesRef.current = nextFiles;
            setFiles(nextFiles);
            stateConfig?.onFilesChange?.(nextFiles);
          },
          onContextMenuOpen: (item, context) => {
            renderVanillaContextMenuSlot({
              slotElement,
              menuRootRef,
              item,
              context,
            });
          },
          onContextMenuClose: () => {
            closeMenu();
          },
        }
      );

      if (!hasHydratedRef.current) {
        fileTree.hydrate({
          fileTreeContainer,
        });
        hasHydratedRef.current = true;
      } else {
        fileTree.render({ fileTreeContainer });
      }

      instanceRef.current = fileTree;

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
    [options, renamingOptions, stateConfig]
  );

  return (
    <div
      ref={ref}
      dangerouslySetInnerHTML={{ __html: containerHtml }}
      suppressHydrationWarning
    />
  );
}

function ReactSSRContextMenu({
  options,
  initialFiles,
  stateConfig,
  prerenderedHTML,
}: {
  options: Omit<FileTreeOptions, 'initialFiles'>;
  initialFiles?: string[];
  stateConfig?: FileTreeStateConfig;
  prerenderedHTML: string;
}) {
  const [files, setFiles] = useState<string[]>(() => initialFiles ?? []);
  const renamingOptions = useMemo(
    () => makeDemoRenamingOptions('react-ssr'),
    []
  );

  return (
    <FileTreeReact
      options={{ ...options, renaming: renamingOptions }}
      files={files}
      onFilesChange={setFiles}
      prerenderedHTML={prerenderedHTML}
      initialExpandedItems={stateConfig?.initialExpandedItems}
      onSelection={stateConfig?.onSelection}
      renderContextMenu={(item, context) => (
        <TreeDemoContextMenu item={item} context={context} />
      )}
    />
  );
}
