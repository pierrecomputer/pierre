'use client';

import type { CSSProperties, ElementType, ReactNode } from 'react';

import { useChromeThemeProps } from './useChromeThemeProps';
import type { ChromeMapping } from '@/lib/theme/chromeThemeProps';
import { diffshubChromeMapping } from '@/lib/theme/diffshubChromeMapping';
import type { ThemeInput } from '@/lib/theme/ThemeSource';

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
