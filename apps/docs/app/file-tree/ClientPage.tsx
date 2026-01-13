'use client';

import { FileTree } from '@pierre/file-tree';
import { FileTree as FileTreeReact } from '@pierre/file-tree/react';
import { useEffect, useRef } from 'react';

import { sharedDemoFileTreeOptions } from './demo-data';

export function ClientPage({
  preloadedFileTreeHtml,
}: {
  preloadedFileTreeHtml: string;
}) {
  const isRendered = useRef(false);
  useEffect(() => {
    if (isRendered.current) return;
    isRendered.current = true;
    const fileTree = new FileTree(sharedDemoFileTreeOptions);
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
          options={sharedDemoFileTreeOptions}
          className="border border-gray-300"
          prerenderedHTML={preloadedFileTreeHtml}
        />
      </div>
    </>
  );
}
