'use client';

import {
  CodeView,
  type CodeViewHandle,
  type CodeViewProps,
} from '@pierre/diffs/react';
import { type Ref, useMemo } from 'react';

import { useDiffThemeProps } from './useDiffThemeProps';
import { useWorkerDiffTheme } from './useWorkerDiffTheme';
import { PREFERRED_HIGHLIGHTER } from '@/lib/preferredHighlighter';
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
  ...props
}: CodeViewProps<LAnnotation, Caret> & {
  ref?: Ref<CodeViewHandle<LAnnotation, Caret>>;
  theme?: DiffThemeInput;
}): React.JSX.Element => {
  const diffTheme = useDiffThemeProps(theme);
  useWorkerDiffTheme(diffTheme.theme);
  const themedOptions = useMemo(
    () => ({
      ...options,
      preferredHighlighter: PREFERRED_HIGHLIGHTER,
      theme: diffTheme.theme,
      themeType: options?.themeType ?? diffTheme.themeType,
    }),
    [diffTheme, options]
  );
  return (
    <CodeView<LAnnotation, Caret>
      {...props}
      ref={ref}
      options={themedOptions}
    />
  );
};
