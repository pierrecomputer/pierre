/* eslint-disable @typescript-eslint/no-unsafe-return */
'use client';

import {
  type DemoItem,
  FileTree,
  type FileTreeOptions,
  syncDataLoader,
} from '@pierre/file-tree';
import { FileTree as FileTreeReact } from '@pierre/file-tree/react';
import { useEffect, useRef } from 'react';

const sharedFileTreeOptions: FileTreeOptions<DemoItem> = {
  config: {
    initialState: {
      expandedItems: ['packages', 'file-tree', 'file-tree-src'],
      selectedItems: ['file-tree-ts', 'file-tree-react-tsx'],
    },
    rootItemId: 'root',

    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => {
      const children = item.getItemData()?.children;
      return children != null;
    },
    dataLoader: syncDataLoader,
  },
};

export function ClientPage({
  preloadedFileTreeHtml,
}: {
  preloadedFileTreeHtml: string;
}) {
  const isRendered = useRef(false);
  useEffect(() => {
    if (isRendered.current) return;
    isRendered.current = true;
    const fileTree = new FileTree(sharedFileTreeOptions);
    fileTree.render({
      containerWrapper:
        document.getElementById('test-file-tree-elem') ?? undefined,
    });
  }, []);

  return (
    <>
      <div className="w-2/3">
        <h2>React SSR File Tree</h2>
        <FileTreeReact
          options={sharedFileTreeOptions}
          className="border border-gray-300"
          prerenderedHTML={preloadedFileTreeHtml}
        />
      </div>
    </>
  );
}
