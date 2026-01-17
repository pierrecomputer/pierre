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
    <div className="m-4">
      <div
        className="rounded-sm border p-4"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <h4 className="text-lg font-bold">Controls</h4>
        <div className="flex flex-row gap-2">
          <label
            htmlFor="collapse-folders"
            className="flex cursor-pointer items-center gap-2 select-none"
          >
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
      <div className="grid grid-cols-2 gap-4 p-4">
        <div className="w-2/3">
          <h2 className="text-sm font-bold">Vanilla</h2>
          <div
            id="test-file-tree-elem"
            className="mt-2 rounded-md border"
            style={{ borderColor: 'var(--color-border)' }}
          />
        </div>
        <div className="w-2/3">
          <h2 className="text-sm font-bold">React SSR</h2>
          <FileTreeReact
            options={fileTreeOptions}
            className="mt-2 rounded-md border"
            style={{ borderColor: 'var(--color-border)' }}
            prerenderedHTML={preloadedFileTreeHtml}
          />
        </div>
      </div>
    </div>
  );
}
