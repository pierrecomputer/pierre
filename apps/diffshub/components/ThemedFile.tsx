'use client';

import { File, type FileProps } from '@pierre/diffs/react';
import { useMemo } from 'react';

import { useDiffThemeProps } from './useDiffThemeProps';
import { PREFERRED_HIGHLIGHTER } from '@/lib/preferredHighlighter';
import type { DiffThemeInput } from '@/lib/theme/diffThemeProps';

interface ThemedFileProps<LAnnotation, Caret> extends FileProps<
  LAnnotation,
  Caret
> {
  // Names-now override (omitted => follow the provider/source).
  theme?: DiffThemeInput;
}

// Sugar over useDiffThemeProps: applies the active theme names + themeType to
// the React <File> options.
export function ThemedFile<LAnnotation = undefined, Caret = undefined>({
  options,
  theme,
  ...props
}: ThemedFileProps<LAnnotation, Caret>) {
  const diffTheme = useDiffThemeProps(theme);
  const themedOptions = useMemo(
    () => ({
      ...options,
      preferredHighlighter: PREFERRED_HIGHLIGHTER,
      theme: diffTheme.theme,
      themeType: options?.themeType ?? diffTheme.themeType,
    }),
    [diffTheme, options]
  );
  return <File<LAnnotation, Caret> {...props} options={themedOptions} />;
}
