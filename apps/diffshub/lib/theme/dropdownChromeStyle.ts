// Shared styling for chrome dropdown/popover surfaces (theme picker, display
// settings, the sidebar's Git-status filter). Radix renders DropdownMenuContent
// in a portal at the document root, so the chrome CSS variables applied to the
// header/sidebar wrapper don't cascade to the menu.
import type { CSSProperties } from 'react';

// Re-applies the resolved chrome style on the portaled content element itself,
// since the chrome variables on the wrapper don't reach it. Spreading the full
// chrome style keeps the menu internals (hover, separators, checkmarks) on the
// theme, while the overrides swap the wrapper's sidebar background for the
// elevated popover surface tokens. The base DropdownMenuContent classes
// (border/shadow/bg-popover) cover the brief window before the theme resolves,
// so this returns undefined until the chrome is ready.
export function getDropdownThemeStyle(
  themeChromeStyle: CSSProperties | undefined
): CSSProperties | undefined {
  if (themeChromeStyle == null) {
    return undefined;
  }

  return {
    ...themeChromeStyle,
    backgroundColor: 'var(--diffshub-popover-bg, var(--color-popover))',
    borderColor: 'var(--diffshub-popover-border, var(--color-border))',
    boxShadow: 'var(--diffshub-popover-shadow, 0 4px 8px rgb(0 0 0 / 0.07))',
    color: 'var(--diffshub-popover-fg, var(--color-popover-foreground))',
  };
}
