/**
 * Theme-like shape compatible with Shiki/VS Code theme format (e.g. from
 * highlighter.getTheme() or resolveTheme()). No dependency on shiki; use with
 * resolved themes from @pierre/diffs or shiki. Mirrors the token keys and
 * fallbacks used by diffs (e.g. gitDecoration.* with terminal.ansi* fallback).
 */
export interface TreeThemeInput {
  type?: 'light' | 'dark';
  bg?: string;
  fg?: string;
  colors?: Record<string, string>;
}

/**
 * CSS custom properties (--trees-theme-*) and layout styles for the tree host/panel.
 * Compatible with React inline style and the trees stylesheet fallback chain.
 */
export type TreeThemeStyles = Record<string, string>;

/**
 * Maps a Shiki/VS Code–style theme to CSS for FileTree. Uses the same token
 * semantics as @pierre/diffs getHighlighterThemeStyles (theme.fg/bg,
 * theme.colors with gitDecoration.* and terminal.ansi* fallback). The trees
 * stylesheet uses --trees-theme-* in its fallback chain
 * (--trees-*-override → --trees-theme-* → default).
 *
 * Use with a resolved theme from shiki or @pierre/diffs:
 *
 *   const theme = await resolveTheme('dracula');
 *   const styles = themeToTreeStyles(theme);
 *   <FileTree style={styles} options={...} />
 */
const HEX_TRANSPARENT_RE = /^#(?:[0-9a-f]{3}0|[0-9a-f]{6}00)$/i;
const ALPHA_ZERO_RE = /^0(?:\.0+)?%?$/;

function getFunctionalAlpha(color: string): string | undefined {
  const openParen = color.indexOf('(');
  if (openParen <= 0 || !color.endsWith(')')) {
    return undefined;
  }

  const fn = color.slice(0, openParen).trim();
  if (!/^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)$/i.test(fn)) {
    return undefined;
  }

  const inner = color.slice(openParen + 1, -1).trim();
  if (inner.length === 0) {
    return undefined;
  }

  // Modern functional syntax: rgb(0 0 0 / 0), color(... / 0%), etc.
  const slashIndex = inner.lastIndexOf('/');
  if (slashIndex !== -1) {
    return inner.slice(slashIndex + 1).trim();
  }

  // Legacy syntax: rgba(0, 0, 0, 0), hsla(210, 40%, 50%, 0.0)
  if (/^(?:rgba|hsla)$/i.test(fn)) {
    const parts = inner.split(',');
    if (parts.length === 4) {
      return parts[3]?.trim();
    }
  }

  return undefined;
}

function isFullyTransparent(color: string | undefined): boolean {
  if (color == null) return false;
  const normalized = color.trim().toLowerCase();
  if (normalized === 'transparent') return true;
  if (HEX_TRANSPARENT_RE.test(normalized)) return true;

  const alpha = getFunctionalAlpha(normalized);
  return alpha != null && ALPHA_ZERO_RE.test(alpha);
}
function opaqueOrUndefined(color: string | undefined): string | undefined {
  return isFullyTransparent(color) ? undefined : color;
}

// Parses an opaque hex color (#rgb / #rrggbb / #rrggbbff) into 0..1 sRGB
// components, ignoring the alpha byte when present. Returns undefined for
// other color formats — callers should treat that as "unknown" and skip
// any luminance-based heuristics rather than guessing.
function parseHexRgb(color: string): [number, number, number] | undefined {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color.trim());
  if (m == null) return undefined;
  const hex = m[1];
  const expand = (s: string) => parseInt(s.length === 1 ? s + s : s, 16) / 255;
  if (hex.length === 3) {
    return [expand(hex[0]), expand(hex[1]), expand(hex[2])];
  }
  return [
    expand(hex.slice(0, 2)),
    expand(hex.slice(2, 4)),
    expand(hex.slice(4, 6)),
  ];
}

// WCAG relative luminance: sRGB channel → linear → weighted sum. Used
// only to compare two colors' lightness, not for absolute contrast
// scoring, so the exact gamma curve is fine to keep inline.
function relativeLuminance(rgb: [number, number, number]): number {
  const linear = rgb.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

// True when `hover` is closer in luminance to `fg` than to `bg` — i.e.,
// the hover surface would land on top of the row text rather than next
// to it, erasing legibility. Returns false when any color can't be
// parsed (unknown format → trust the theme designer's intent).
function hoverWouldEraseText(
  hover: string,
  bg: string | undefined,
  fg: string | undefined
): boolean {
  if (bg == null || fg == null) return false;
  const hoverRgb = parseHexRgb(hover);
  const bgRgb = parseHexRgb(bg);
  const fgRgb = parseHexRgb(fg);
  if (hoverRgb == null || bgRgb == null || fgRgb == null) return false;
  const hoverL = relativeLuminance(hoverRgb);
  const bgL = relativeLuminance(bgRgb);
  const fgL = relativeLuminance(fgRgb);
  return Math.abs(hoverL - fgL) < Math.abs(hoverL - bgL);
}

export function themeToTreeStyles(theme: TreeThemeInput): TreeThemeStyles {
  const c = theme.colors ?? {};
  const sideBarBg =
    c['sideBar.background'] ?? c['editor.background'] ?? theme.bg;
  const sideBarFg =
    c['sideBar.foreground'] ?? c['editor.foreground'] ?? theme.fg;
  const sideBarBorder = c['sideBar.border'];
  const listActiveSelectionFg =
    c['list.activeSelectionForeground'] ?? c['sideBar.foreground'];

  // Some themes (e.g. Material) set hover/selection bg to the same color as
  // the sidebar bg, making the state invisible. Detect this and fall through
  // so the computed defaults provide visible feedback. Additionally, some
  // themes (e.g. slack-ochin) define list.hoverBackground for an editor
  // surface whose palette is opposite the sidebar's — a near-white hover on
  // a dark navy sidebar with light text. Reject those too so the hovered
  // row's text doesn't disappear.
  const bgLower = sideBarBg?.toLowerCase();
  const rawHoverBg = c['list.hoverBackground'];
  let listHoverBg: string | undefined;
  if (rawHoverBg != null && rawHoverBg.toLowerCase() !== bgLower) {
    listHoverBg = hoverWouldEraseText(rawHoverBg, sideBarBg, sideBarFg)
      ? undefined
      : rawHoverBg;
  }
  const rawSelectionBg = c['list.activeSelectionBackground'];
  const listSelectionBg =
    rawSelectionBg?.toLowerCase() === bgLower
      ? (c['list.focusBackground'] ?? c['editor.selectionBackground'])
      : (rawSelectionBg ?? c['editor.selectionBackground']);
  // Many themes set focusOutline or focusBorder to fully transparent (#...00).
  // Catppuccin sets list.focusOutline=#00000000 but has good focusBorder values.
  // Material themes set focusBorder=#FFFFFF00 entirely. Skip transparent values
  // so the fallback chain reaches a visible color.
  const focusRing =
    opaqueOrUndefined(c['list.focusOutline']) ??
    opaqueOrUndefined(c['focusBorder']);
  const inputBg = c['input.background'] ?? sideBarBg;
  const inputBorder = c['input.border'];
  const scrollbarBg = c['scrollbarSlider.background'];
  const sectionHeaderFg = c['sideBarSectionHeader.foreground'] ?? sideBarFg;
  // gitDecoration.* → terminal.ansi* → editorGutter.* (e.g. vesper only has gutter colors)
  const gitAdded =
    c['gitDecoration.addedResourceForeground'] ??
    c['terminal.ansiGreen'] ??
    c['editorGutter.addedBackground'];
  const gitModified =
    c['gitDecoration.modifiedResourceForeground'] ??
    c['terminal.ansiBlue'] ??
    c['editorGutter.modifiedBackground'];
  const gitDeleted =
    c['gitDecoration.deletedResourceForeground'] ??
    c['terminal.ansiRed'] ??
    c['editorGutter.deletedBackground'];

  const isDark = theme.type === 'dark';
  // Pick the hover fallback based on the actual sidebar surface
  // luminance, not theme.type — themes like slack-ochin are tagged
  // `light` for the editor but ship a dark sidebar; a 6%-black overlay
  // on dark navy is nearly invisible.
  const sideBarBgRgb = sideBarBg != null ? parseHexRgb(sideBarBg) : undefined;
  const sideBarIsDark =
    sideBarBgRgb != null ? relativeLuminance(sideBarBgRgb) < 0.5 : isDark;
  const result: TreeThemeStyles = {
    colorScheme: isDark ? 'dark' : 'light',
    backgroundColor: sideBarBg ?? '',
    color: sideBarFg ?? '',
    borderColor:
      'var(--trees-theme-sidebar-border, light-dark(oklch(0% 0 0 / 0.15), oklch(100% 0 0 / 0.15)))',
    '--trees-theme-sidebar-bg': sideBarBg ?? '',
    '--trees-theme-sidebar-fg': sideBarFg ?? '',
    '--trees-theme-sidebar-header-fg': sectionHeaderFg ?? '',
    '--trees-theme-list-active-selection-fg':
      listActiveSelectionFg ?? sideBarFg ?? '',
    '--trees-theme-list-hover-bg':
      listHoverBg ??
      (sideBarIsDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
    '--trees-theme-list-active-selection-bg': listSelectionBg ?? 'transparent',
    '--trees-theme-focus-ring': focusRing ?? sideBarFg ?? '',
    '--trees-theme-input-bg': inputBg ?? '',
  };

  // Expose explicit sidebar border token when present.
  // `borderColor` above always falls back to the default light/dark value.
  if (sideBarBorder != null && sideBarBorder !== '') {
    result['--trees-theme-sidebar-border'] = sideBarBorder;
  }
  if (inputBorder != null && inputBorder !== '') {
    result['--trees-theme-input-border'] = inputBorder;
  }
  if (scrollbarBg != null && scrollbarBg !== '') {
    result['--trees-theme-scrollbar-thumb'] = scrollbarBg;
  }

  if (gitAdded != null && gitAdded !== '') {
    result['--trees-theme-git-added-fg'] = gitAdded;
  }
  if (gitModified != null && gitModified !== '') {
    result['--trees-theme-git-modified-fg'] = gitModified;
  }
  if (gitDeleted != null && gitDeleted !== '') {
    result['--trees-theme-git-deleted-fg'] = gitDeleted;
  }

  return result;
}
