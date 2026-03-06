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
  // so the computed defaults provide visible feedback.
  const bgLower = sideBarBg?.toLowerCase();
  const rawHoverBg = c['list.hoverBackground'];
  const listHoverBg =
    rawHoverBg?.toLowerCase() === bgLower ? undefined : rawHoverBg;
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
      listHoverBg ?? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
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
