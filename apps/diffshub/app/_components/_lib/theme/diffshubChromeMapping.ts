// Stays app-local. The diffshub-specific mapping from neutral ChromeTokens to
// the app's CSS variables — preserved byte-for-byte from the previous
// buildThemeChromeStyle (the --diffshub-*/--color-*/--foreground vocabulary plus
// the app-only --diffshub-card-* (6/12/12) and annotation-hover-border (28%)
// mixes). Only the handful of diffshub-specific surfaces the neutral set does
// not carry are derived locally from the same foreground/surface pair.
import type { ThemeLike } from '@pierre/theming';
import { normalizeThemeColors } from '@pierre/theming/color';
import type { CSSProperties } from 'react';

import type { ChromeTokens } from './deriveChromeTokens';

// A ChromeMapping turns the neutral chrome tokens (or undefined when the theme
// has no legible foreground) plus the source theme into a host CSS style. The
// theme is passed so a mapping can read the sidebar background for the surface
// the mixes blend into.
export type ChromeMapping = (
  chrome: ChromeTokens | undefined,
  theme: ThemeLike
) => CSSProperties | undefined;

export const diffshubChromeMapping: ChromeMapping = (chrome, theme) => {
  // Mirror the previous behavior: the chrome background is the resolved theme's
  // sidebar background, read straight from the shared normalizeThemeColors
  // surface derivation (the same key trees and deriveChromeTokens read).
  const sidebarBg = normalizeThemeColors(theme).colors?.['sideBar.background'];
  const bg =
    typeof sidebarBg === 'string' && sidebarBg !== '' ? sidebarBg : undefined;

  // No chrome means deriveChromeTokens found no legible foreground (degenerate
  // bg-only theme). Mirror the previous behavior: paint just the background when
  // we have one, otherwise contribute nothing.
  if (chrome == null) {
    return bg != null ? ({ backgroundColor: bg } as CSSProperties) : undefined;
  }

  const fg = chrome.fg;
  // The base the diffshub-specific card mixes blend the foreground into. Mirror
  // the previous `bg ?? 'transparent'` fallback exactly.
  const base = bg ?? 'transparent';
  const style: CSSProperties & Record<string, string> = {};
  if (bg != null) style.backgroundColor = bg;
  style.color = fg;
  style['--color-foreground'] = fg;
  style['--foreground'] = fg;
  style['--color-muted-foreground'] = chrome.mutedFg;
  style['--muted-foreground'] = chrome.mutedFg;
  style['--color-border'] = chrome.border;
  style['--border'] = chrome.border;
  style['--color-border-opaque'] = chrome.borderOpaque;
  style['--border-opaque'] = chrome.borderOpaque;
  // diffshub-specific card surfaces: a touch softer than the popover (6/12/12
  // vs the neutral 7/14/20 set), so they read as quiet inline rows rather than
  // floating menus. Not part of the shared ChromeTokens.
  style['--diffshub-card-bg'] = `color-mix(in srgb, ${fg} 6%, ${base})`;
  style['--diffshub-card-hover-bg'] = `color-mix(in srgb, ${fg} 12%, ${base})`;
  style['--diffshub-card-border'] = `color-mix(in srgb, ${fg} 12%, ${base})`;
  style['--diffshub-popover-bg'] = chrome.surface;
  style['--diffshub-popover-fg'] = fg;
  style['--diffshub-popover-muted-fg'] = chrome.mutedFg;
  style['--diffshub-popover-hover-bg'] = chrome.surfaceHover;
  style['--diffshub-popover-selected-bg'] = chrome.surfaceSelected;
  style['--diffshub-popover-border'] = chrome.surfaceBorder;
  style['--diffshub-popover-shadow'] = chrome.surfaceShadow;
  style['--diffshub-annotation-bg'] = chrome.surface;
  style['--diffshub-annotation-fg'] = fg;
  style['--diffshub-annotation-border'] = chrome.surfaceBorder;
  style['--diffshub-annotation-hover-border'] =
    `color-mix(in srgb, ${fg} 28%, ${base})`;
  style['--diffshub-annotation-shadow'] = chrome.surfaceShadow;
  style['--color-popover'] = chrome.surface;
  style['--popover'] = chrome.surface;
  style['--color-popover-foreground'] = fg;
  style['--popover-foreground'] = fg;
  style['--color-card'] = chrome.surface;
  style['--card'] = chrome.surface;
  style['--color-card-foreground'] = fg;
  style['--card-foreground'] = fg;
  style['--color-background'] = chrome.background;
  style['--background'] = chrome.background;
  style['--color-accent'] = chrome.surfaceHover;
  style['--accent'] = chrome.surfaceHover;
  style['--color-accent-foreground'] = fg;
  style['--accent-foreground'] = fg;
  // `secondary` is the segmented-control (ButtonGroup) track. It must sit
  // visibly behind the buttons so the Auto/Light/Dark options read as one
  // connected control, so it reuses the slightly stronger hover mix.
  style['--color-secondary'] = chrome.surfaceHover;
  style['--secondary'] = chrome.surfaceHover;
  style['--color-secondary-foreground'] = fg;
  style['--secondary-foreground'] = fg;
  style['--color-input'] = chrome.surfaceHover;
  style['--input'] = chrome.surfaceHover;
  style['--color-muted'] = chrome.surfaceHover;
  style['--muted'] = chrome.surfaceHover;
  style['--color-primary'] = fg;
  style['--primary'] = fg;
  style['--color-primary-foreground'] = chrome.background;
  style['--primary-foreground'] = chrome.background;
  style['--color-ring'] = chrome.ring;
  style['--ring'] = chrome.ring;
  style['--diffshub-comment-add-fg'] = chrome.additionFg;
  style['--diffshub-comment-del-fg'] = chrome.deletionFg;
  style['--diffshub-diff-separator'] = chrome.separator;
  if (chrome.scrollbarThumb != null) {
    style['--diffshub-scrollbar-thumb-bg'] = chrome.scrollbarThumb;
  }
  if (chrome.scrollbarTrack != null) {
    style['--diffshub-scrollbar-track-bg'] = chrome.scrollbarTrack;
  }
  return style as CSSProperties;
};
