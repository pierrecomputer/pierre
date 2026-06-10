'use client';

import { createThemeResolver } from '@pierre/theming';
import type { TreeThemeStyles } from '@pierre/trees';
import { useMemo } from 'react';

import { fixedSource, type ThemeInput } from '../js/ThemeSource';
import {
  treeThemeProps,
  type TreeThemePropsOptions,
} from '../js/treeThemeProps';
import { useThemeResolver, useThemeSource } from './useThemeSource';

// Returns the spreadable FileTree style props for the active theme (provider, or
// the per-component `theme` override). Pass reconcileForegroundFromChrome to
// preserve diffshub's contrast-based foreground upgrade.
export function useTreeThemeProps(
  theme?: ThemeInput,
  options?: TreeThemePropsOptions
): { style: TreeThemeStyles } {
  const providerSource = useThemeSource();
  const contextResolver = useThemeResolver();
  const colorScheme = providerSource.activeTheme.colorScheme;
  const localResolver = useMemo(() => createThemeResolver(), []);
  const resolver = contextResolver ?? localResolver;
  // A local override source shadows the provider; constructed only when a `theme`
  // prop is given. Pair overrides use the provider color scheme to pick a slot;
  // for a single value the scheme is ignored, and for a name the resolved
  // object's own type wins once loaded.
  const override = useMemo(() => {
    if (theme == null) return undefined;
    return fixedSource(theme, { resolver, colorScheme });
  }, [theme, resolver, colorScheme]);
  const { activeTheme } = useThemeSource(override);
  const reconcile = options?.reconcileForegroundFromChrome ?? false;
  return useMemo(
    () =>
      treeThemeProps(activeTheme, { reconcileForegroundFromChrome: reconcile }),
    [activeTheme, reconcile]
  );
}
