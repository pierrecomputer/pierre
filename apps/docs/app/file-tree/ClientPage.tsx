'use client';

import { FileTree, type FileTreeOptions } from '@pierre/file-tree';
import { FileTree as FileTreeReact } from '@pierre/file-tree/react';
import { useEffect, useRef } from 'react';

const sharedFileTreeOptions: FileTreeOptions<any> = {
  config: {
    rootItemId: 'root-item',
    getItemName: (item: any) => item.itemName,
    isItemFolder: (_item) => true,
    dataLoader: {
      getItem: (itemId) => {
        return {
          id: itemId,
          itemName: `item ${itemId}`,
          isFolder: false,
          childrenIds: [],
        };
      },
      getChildren: (_itemId) => [],
    },
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
