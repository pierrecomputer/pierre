'use client';

import {
  CodeView,
  type CodeViewHandle,
  type CodeViewProps,
} from '@pierre/diffs/react';
import { type Ref, useMemo } from 'react';

import { useDiffThemeProps } from './useDiffThemeProps';
import { useHighlightTheme } from './useHighlightTheme';
import { useWorkerDiffTheme } from './useWorkerDiffTheme';
import { getPreferredHighlighter } from '@/lib/preferredHighlighter';
import type { DiffThemeInput } from '@/lib/theme/diffThemeProps';

type ThemedCodeViewComponent = <LAnnotation = undefined, Caret = undefined>(
  props: CodeViewProps<LAnnotation, Caret> & {
    ref?: Ref<CodeViewHandle<LAnnotation, Caret>>;
    theme?: DiffThemeInput;
  }
) => React.JSX.Element;

export const ThemedCodeView: ThemedCodeViewComponent = <
  LAnnotation = undefined,
  Caret = undefined,
>({
  options,
  ref,
  theme,
  style,
  ...props
}: CodeViewProps<LAnnotation, Caret> & {
  ref?: Ref<CodeViewHandle<LAnnotation, Caret>>;
  theme?: DiffThemeInput;
}): React.JSX.Element => {
  const diffTheme = useDiffThemeProps(theme);
  const highlightTheme = useHighlightTheme(diffTheme.theme);
  useWorkerDiffTheme(highlightTheme.theme);
  const themedOptions = useMemo(
    () => ({
      ...options,
      preferredHighlighter: getPreferredHighlighter(),
      theme: highlightTheme.theme,
      themeType: options?.themeType ?? diffTheme.themeType,
    }),
    [highlightTheme.theme, diffTheme.themeType, options]
  );
  return (
    <CodeView<LAnnotation, Caret>
      {...props}
      ref={ref}
      options={themedOptions}
      style={{ ...highlightTheme.style, ...style }}
    />
  );
};
