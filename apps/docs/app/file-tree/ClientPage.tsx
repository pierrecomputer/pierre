'use client';

import type { FileTreeOptions } from '@pierre/file-tree';
import { FileTree } from '@pierre/file-tree';
import { FileTree as FileTreeReact } from '@pierre/file-tree/react';
import { useEffect, useMemo, useState } from 'react';

import { sharedDemoFileTreeOptions } from './demo-data';

export function ClientPage({
  preloadedFileTreeHtml,
}: {
  preloadedFileTreeHtml: string;
}) {
  const [collapseFolders, setCollapseFolders] = useState<boolean>(
    sharedDemoFileTreeOptions.collapseFolders ?? false
  );
  const fileTreeOptions = useMemo<FileTreeOptions>(
    () => ({
      ...sharedDemoFileTreeOptions,
      collapseFolders,
    }),
    [collapseFolders]
  );

  useEffect(() => {
    const injectionDiv = document.getElementById('test-file-tree-elem');
    if (injectionDiv == null) {
      return;
    }
    injectionDiv.innerHTML = '';
    const fileTree = new FileTree(fileTreeOptions);
    fileTree.render({
      containerWrapper:
        document.getElementById('test-file-tree-elem') ?? undefined,
    });
  }, [collapseFolders]);

  return (
    <>
      <div className="w-2/3">
        <h2>React SSR File Tree</h2>
        <FileTreeReact
          options={fileTreeOptions}
          className="border border-gray-300"
          prerenderedHTML={preloadedFileTreeHtml}
        />
        <div className="mt-4">
          <label htmlFor="collapse-folders">
            <input
              type="checkbox"
              id="collapse-folders"
              checked={collapseFolders}
              onChange={() => setCollapseFolders(!collapseFolders)}
            />
            Collapse Folders
          </label>
        </div>
      </div>
    </>
  );
}
