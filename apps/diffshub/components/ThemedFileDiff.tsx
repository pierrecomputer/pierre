'use client';

import { FileDiff, type FileDiffProps } from '@pierre/diffs/react';
import { useMemo } from 'react';

import { useDiffThemeProps } from './useDiffThemeProps';
import { PREFERRED_HIGHLIGHTER } from '@/lib/preferredHighlighter';
import type { DiffThemeInput } from '@/lib/theme/diffThemeProps';

interface ThemedFileDiffProps<LAnnotation, Caret> extends FileDiffProps<
  LAnnotation,
  Caret
> {
  // Names-now override (omitted => follow the provider/source).
  theme?: DiffThemeInput;
}

// Sugar over useDiffThemeProps: applies the active theme names + themeType to
// the React <FileDiff> options.
export function ThemedFileDiff<LAnnotation = undefined, Caret = undefined>({
  options,
  theme,
  ...props
}: ThemedFileDiffProps<LAnnotation, Caret>) {
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
  return <FileDiff<LAnnotation, Caret> {...props} options={themedOptions} />;
}
