'use client';

import { File, type FileProps } from '@pierre/diffs/react';
import { useMemo } from 'react';

import { useDiffThemeProps } from './useDiffThemeProps';
import { useWorkerDiffTheme } from './useWorkerDiffTheme';
import type { DiffThemeInput } from '@/lib/theme/diffThemeProps';

interface ThemedFileProps<
  LAnnotation = undefined,
> extends FileProps<LAnnotation> {
  // Names-now override (omitted => follow the provider/source).
  theme?: DiffThemeInput;
}

// Sugar over useDiffThemeProps: applies the active theme names + themeType to
// the React <File> options and keeps the worker pool in step when present.
export function ThemedFile<LAnnotation = undefined>({
  disableWorkerPool = false,
  options,
  theme,
  ...props
}: ThemedFileProps<LAnnotation>) {
  const diffTheme = useDiffThemeProps(theme);
  useWorkerDiffTheme(diffTheme.theme, disableWorkerPool);
  const themedOptions = useMemo(
    () => ({
      ...options,
      theme: diffTheme.theme,
      themeType: options?.themeType ?? diffTheme.themeType,
    }),
    [diffTheme, options]
  );
  return (
    <File<LAnnotation>
      {...props}
      disableWorkerPool={disableWorkerPool}
      options={themedOptions}
    />
  );
}
