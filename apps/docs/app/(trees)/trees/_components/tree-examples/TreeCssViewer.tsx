'use client';

import { File } from '@pierre/diffs/react';

import { useTheme } from '@/components/theme-provider';

export function TreeCssViewer({
  contents,
  filename = 'tree.css',
}: {
  contents: string;
  filename?: string;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const theme = isDark ? 'pierre-dark' : 'pierre-light';
  const themeType = isDark ? 'dark' : 'light';

  return (
    <File
      file={{ name: filename, contents }}
      options={{
        theme,
        themeType,
        disableLineNumbers: true,
        disableFileHeader: true,
      }}
      className="mt-3 overflow-auto rounded-lg border p-2 text-[13px]"
    />
  );
}
