'use client';

import type { FileTreeOptions } from '@pierre/file-tree';
import { FileTree } from '@pierre/file-tree';
import { FileTree as FileTreeReact } from '@pierre/file-tree/react';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { sharedDemoFileTreeOptions } from './demo-data';

export function ClientPage({
  preloadedFileTreeHtml,
}: {
  preloadedFileTreeHtml: string;
}) {
  const [flattenEmptyDirectories, setFlattenEmptyDirectories] =
    useState<boolean>(
      sharedDemoFileTreeOptions.flattenEmptyDirectories ?? false
    );
  const fileTreeOptions = useMemo<FileTreeOptions>(
    () => ({
      ...sharedDemoFileTreeOptions,
      flattenEmptyDirectories,
    }),
    [flattenEmptyDirectories]
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
  }, [flattenEmptyDirectories]);

  return (
    <div
      className="m-4"
      style={
        {
          // '--ft-font-family': 'monospace',
          // '--ft-font-size': '11px',
          // '--ft-row-height': '24px',
          // '--ft-icon-width': '8px',
          // '--ft-icon-nudge': '0px',
        } as CSSProperties
      }
    >
      <div
        className="rounded-sm border p-4"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <h4 className="text-lg font-bold">Controls</h4>
        <div className="flex flex-row gap-2">
          <label
            htmlFor="flatten-empty-directories"
            className="flex cursor-pointer items-center gap-2 select-none"
          >
            <input
              type="checkbox"
              id="flatten-empty-directories"
              checked={flattenEmptyDirectories}
              className="cursor-pointer"
              onChange={() =>
                setFlattenEmptyDirectories(!flattenEmptyDirectories)
              }
            />
            Flatten Empty Directories
          </label>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 p-4">
        <div className="w-2/3">
          <h2 className="text-sm font-bold">Vanilla</h2>
          <div
            id="test-file-tree-elem"
            className="mt-2 overflow-hidden rounded-md p-5"
            style={{
              boxShadow: '0 0 0 1px var(--color-border), 0 1px 3px #0000000d',
            }}
          />
        </div>
        <div className="w-2/3">
          <h2 className="text-sm font-bold">React SSR</h2>
          {/* icon alignment debug helper */}
          {/* <div
            style={{
              position: 'absolute',
              borderLeft: '0.5px solid #d0464666',
              height: 500,
              width: 2,
              marginLeft: '30.5px',
              zIndex: '999',
              pointerEvents: 'none',
            }}
          ></div> */}
          <FileTreeReact
            options={fileTreeOptions}
            className="mt-2 rounded-md p-5"
            style={{
              boxShadow: '0 0 0 1px var(--color-border), 0 1px 3px #0000000d',
            }}
            prerenderedHTML={preloadedFileTreeHtml}
          />
        </div>
      </div>
    </div>
  );
}
