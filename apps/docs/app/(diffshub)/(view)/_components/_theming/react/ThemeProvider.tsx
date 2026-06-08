'use client';

import {
  createThemeResolver,
  type ThemeController,
  type ThemeResolver,
} from '@pierre/theme-kit';
import { type ReactNode, useMemo } from 'react';

import {
  controllerSource,
  fixedSource,
  type ThemeInput,
} from '../js/ThemeSource';
import {
  ThemeControllerContext,
  ThemeResolverContext,
  ThemeSourceContext,
  useThemeResolver,
  useThemeSource,
} from './useThemeSource';

interface ControllerProviderProps {
  controller: ThemeController;
  theme?: never;
  children: ReactNode;
}

interface OverrideProviderProps {
  controller?: never;
  resolver?: ThemeResolver;
  // A name, a resolved theme object, or a { light, dark } pair (names/objects).
  theme?: ThemeInput;
  children: ReactNode;
}

type ThemeProviderProps = ControllerProviderProps | OverrideProviderProps;

// Carries the current ThemeSource to the subtree. `controller=` makes the
// default, follows-the-selector source. `theme=` (no controller) makes a frozen
// override source that shadows whatever provider source is above it — its
// colorScheme is read from the parent provider so a { light, dark } pair picks
// the slot matching the current mode. Precedence falls out of context nesting:
// nearest provider wins, and a per-component `theme` prop (in the prop hooks)
// bypasses the context entirely.
export function ThemeProvider(props: ThemeProviderProps) {
  if (props.controller != null) {
    return (
      <ControllerThemeProvider controller={props.controller}>
        {props.children}
      </ControllerThemeProvider>
    );
  }
  if (props.theme == null) return <>{props.children}</>;
  return (
    <OverrideThemeProvider resolver={props.resolver} theme={props.theme}>
      {props.children}
    </OverrideThemeProvider>
  );
}

function ControllerThemeProvider({
  controller,
  children,
}: {
  controller: ThemeController;
  children: ReactNode;
}) {
  const source = useMemo(() => controllerSource(controller), [controller]);
  return (
    <ThemeControllerContext.Provider value={controller}>
      <ThemeResolverContext.Provider value={controller.resolver}>
        <ThemeSourceContext.Provider value={source}>
          {children}
        </ThemeSourceContext.Provider>
      </ThemeResolverContext.Provider>
    </ThemeControllerContext.Provider>
  );
}

function OverrideThemeProvider({
  resolver,
  theme,
  children,
}: {
  resolver?: ThemeResolver;
  theme: ThemeInput;
  children: ReactNode;
}) {
  // The parent provider's mode feeds slot selection for a { light, dark } pair override.
  const parentSource = useThemeSource();
  const parentResolver = useThemeResolver();
  const colorScheme = parentSource.activeTheme.colorScheme;
  const localResolver = useMemo(() => createThemeResolver(), []);
  const selectedResolver = resolver ?? parentResolver ?? localResolver;
  const source = useMemo(() => {
    return fixedSource(theme, { resolver: selectedResolver, colorScheme });
  }, [theme, selectedResolver, colorScheme]);
  return (
    <ThemeResolverContext.Provider value={selectedResolver}>
      <ThemeSourceContext.Provider value={source}>
        {children}
      </ThemeSourceContext.Provider>
    </ThemeResolverContext.Provider>
  );
}
