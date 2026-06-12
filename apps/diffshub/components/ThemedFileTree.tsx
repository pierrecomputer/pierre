'use client';

import { FileTree, type FileTreeProps } from '@pierre/trees/react';
import type { CSSProperties } from 'react';
import { useMemo } from 'react';

import { useTreeThemeProps } from './useTreeThemeProps';
import type { ThemeInput } from '@/lib/theme/ThemeSource';

interface ThemedFileTreeProps extends FileTreeProps {
  // Per-component override (omitted => follow the provider).
  theme?: ThemeInput;
  reconcileForegroundFromChrome?: boolean;
}

// Sugar over useTreeThemeProps: applies the active theme's tree styles to the
// React <FileTree>. Caller `style` (spread after) still wins on key collisions.
export function ThemedFileTree({
  theme,
  reconcileForegroundFromChrome,
  style,
  ...props
}: ThemedFileTreeProps) {
  const themeProps = useTreeThemeProps(theme, {
    reconcileForegroundFromChrome,
  });
  const mergedStyle = useMemo(
    () => ({ ...themeProps.style, ...style }) as CSSProperties,
    [themeProps.style, style]
  );
  return <FileTree {...props} style={mergedStyle} />;
}
