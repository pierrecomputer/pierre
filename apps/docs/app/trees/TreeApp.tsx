'use client';

import { File } from '@pierre/diffs/react';
import { IconFile } from '@pierre/icons';
import type { FileTreeOptions, FileTreeSelectionItem } from '@pierre/trees';
import { FileTree as FileTreeReact } from '@pierre/trees/react';
import { useCallback, useMemo, useState } from 'react';

export interface TreeAppProps {
  /** Options passed to the FileTree. initialSelectedItems and onSelection are wired from defaultSelectedPath internally. */
  fileTreeOptions: FileTreeOptions;
  /** Optional prerendered HTML for SSR hydration. */
  preloadedFileTreeHtml?: string;
  /** Map of file path → content shown in the right panel. Omit or use empty string for placeholder. */
  fileContentMap?: Record<string, string>;
  /** File path to select and display on initial load (e.g. 'package.json'). */
  defaultSelectedPath?: string;
}

/**
 * Reusable layout: FileTree on the left, selected file content on the right.
 * Mirrors the main docs approach (preload on server, hydrate on client) and
 * can be used with or without prerendered tree HTML.
 */
export function TreeApp({
  fileTreeOptions,
  preloadedFileTreeHtml,
  fileContentMap = {},
  defaultSelectedPath,
}: TreeAppProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(
    defaultSelectedPath ?? null
  );

  // TreeApp always uses dark mode; the rest of the trees docs follow user preference
  const themeType = 'dark';
  const theme = 'pierre-dark';

  const onSelection = useCallback((selection: FileTreeSelectionItem[]) => {
    const file = selection.find((item) => !item.isFolder);
    if (file != null) {
      setSelectedPath(file.path);
    }
    // If selection is only folders (e.g. user clicked a folder to expand/collapse), keep the last open file
  }, []);

  const treeOptions = useMemo(() => {
    const { initialFiles: _f, ...opts } = fileTreeOptions;
    return opts;
  }, [fileTreeOptions]);
  const initialFiles = fileTreeOptions.initialFiles;
  const initialSelectedItems =
    defaultSelectedPath != null ? [defaultSelectedPath] : undefined;

  const content =
    selectedPath != null
      ? (fileContentMap[selectedPath] ??
        `// ${selectedPath}\n// (no content provided)`)
      : null;

  // Wrap in dark context so TreeApp borders, text, and FileTree/File inherit dark mode
  // (page outside TreeApp can stay in user's light/dark preference)
  return (
    <div className="dark rounded-lg" style={{ colorScheme: 'dark' }}>
      <div className="border-border grid min-h-[420px] grid-cols-1 gap-0 overflow-hidden rounded-lg border md:aspect-[16/9] md:grid-cols-[minmax(200px,280px)_1fr]">
        <FileTreeReact
          className="h-full min-h-[200px] overflow-auto border-b border-[var(--trees-border-color)] p-3 md:min-h-0 md:border-r md:border-b-0"
          style={{ colorScheme: 'dark' }}
          options={treeOptions}
          initialFiles={initialFiles}
          initialSelectedItems={initialSelectedItems}
          onSelection={onSelection}
          prerenderedHTML={preloadedFileTreeHtml}
        />
        <div className="min-h-[320px] overflow-auto bg-[#070707]">
          {content != null && selectedPath != null ? (
            <File
              file={{ name: selectedPath, contents: content }}
              options={{ theme, themeType }}
              className="h-full"
            />
          ) : (
            <div className="text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-2 p-4">
              <IconFile />
              <p className="text-sm">
                Select a file from the tree to view its content.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
