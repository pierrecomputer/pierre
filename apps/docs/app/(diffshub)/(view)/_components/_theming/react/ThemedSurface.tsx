'use client';

import type { CSSProperties, ElementType, ReactNode } from 'react';

import type { ChromeMapping } from '../js/chromeThemeProps';
import { diffshubChromeMapping } from '../js/diffshubChromeMapping';
import type { ThemeInput } from '../js/ThemeSource';
import { useChromeThemeProps } from './useChromeThemeProps';

interface ThemedSurfaceProps {
  as?: ElementType;
  children?: ReactNode;
  className?: string;
  mapping?: ChromeMapping;
  style?: CSSProperties;
  theme?: ThemeInput;
}

// A themed chrome host. Renders `as` (default div) with the chrome style applied
// from the active theme via the given mapping (default diffshubChromeMapping).
// Caller `style` (spread after) still wins on key collisions.
export function ThemedSurface({
  as,
  children,
  className,
  mapping = diffshubChromeMapping,
  style,
  theme,
}: ThemedSurfaceProps) {
  const Component = as ?? 'div';
  const themeProps = useChromeThemeProps(mapping, theme);
  return (
    <Component className={className} style={{ ...themeProps.style, ...style }}>
      {children}
    </Component>
  );
}
