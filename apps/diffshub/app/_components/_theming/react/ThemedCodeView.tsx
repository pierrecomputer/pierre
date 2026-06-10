'use client';

import {
  CodeView,
  type CodeViewHandle,
  type CodeViewProps,
} from '@pierre/diffs/react';
import { type Ref, useMemo } from 'react';

import type { DiffThemeInput } from '../js/diffThemeProps';
import { useDiffThemeProps } from './useDiffThemeProps';
import { useWorkerDiffTheme } from './useWorkerDiffTheme';

type ThemedCodeViewComponent = <LAnnotation = undefined>(
  props: CodeViewProps<LAnnotation> & {
    ref?: Ref<CodeViewHandle<LAnnotation>>;
    theme?: DiffThemeInput;
  }
) => React.JSX.Element;

export const ThemedCodeView: ThemedCodeViewComponent = <
  LAnnotation = undefined,
>({
  disableWorkerPool = false,
  options,
  ref,
  theme,
  ...props
}: CodeViewProps<LAnnotation> & {
  ref?: Ref<CodeViewHandle<LAnnotation>>;
  theme?: DiffThemeInput;
}): React.JSX.Element => {
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
    <CodeView<LAnnotation>
      {...props}
      ref={ref}
      disableWorkerPool={disableWorkerPool}
      options={themedOptions}
    />
  );
};
