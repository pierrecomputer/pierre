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
 * CSS custom properties (--ft-theme-*) and layout styles for the tree host/panel.
 * Compatible with React inline style and the trees stylesheet fallback chain.
 */
export type TreeThemeStyles = Record<string, string>;

/**
 * Maps a Shiki/VS Code–style theme to CSS for FileTree. Uses the same token
 * semantics as @pierre/diffs getHighlighterThemeStyles (theme.fg/bg,
 * theme.colors with gitDecoration.* and terminal.ansi* fallback). The trees
 * stylesheet uses --ft-theme-* in its fallback chain
 * (--ft-* → --ft-theme-* → default).
 *
 * Use with a resolved theme from shiki or @pierre/diffs:
 *
 *   const theme = await resolveTheme('dracula');
 *   const styles = themeToTreeStyles(theme);
 *   <FileTree style={styles} options={...} />
 */
export function themeToTreeStyles(theme: TreeThemeInput): TreeThemeStyles {
  const c = theme.colors ?? {};
  const sideBarBg =
    c['sideBar.background'] ?? c['editor.background'] ?? theme.bg;
  const sideBarFg =
    c['sideBar.foreground'] ?? c['editor.foreground'] ?? theme.fg;
  const sideBarBorder = c['sideBar.border'] ?? c['editor.background'];
  const listSelectionBg =
    c['list.activeSelectionBackground'] ?? c['editor.selectionBackground'];
  const listHoverBg = c['list.hoverBackground'];
  const focusOutline = c['list.focusOutline'] ?? c['focusBorder'];
  const inputBg = c['input.background'] ?? sideBarBg;
  const inputBorder = c['input.border'] ?? sideBarBorder;
  const sectionHeaderFg = c['sideBarSectionHeader.foreground'] ?? sideBarFg;
  // Same fallbacks as diffs getHighlighterThemeStyles (gitDecoration.* → terminal.ansi*)
  const gitAdded =
    c['gitDecoration.addedResourceForeground'] ?? c['terminal.ansiGreen'];
  const gitModified =
    c['gitDecoration.modifiedResourceForeground'] ?? c['terminal.ansiBlue'];
  const gitDeleted =
    c['gitDecoration.deletedResourceForeground'] ?? c['terminal.ansiRed'];

  const isDark = theme.type === 'dark';
  const result: TreeThemeStyles = {
    colorScheme: isDark ? 'dark' : 'light',
    backgroundColor: sideBarBg ?? '',
    color: sideBarFg ?? '',
    borderColor: sideBarBorder ?? '',
    '--ft-theme-side-bar-background': sideBarBg ?? '',
    '--ft-theme-side-bar-foreground': sideBarFg ?? '',
    '--ft-theme-side-bar-border': sideBarBorder ?? sideBarBg ?? '',
    '--ft-theme-side-bar-section-header-foreground': sectionHeaderFg ?? '',
    '--ft-theme-list-hover-background':
      listHoverBg ?? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
    '--ft-theme-list-active-selection-background':
      listSelectionBg ?? 'transparent',
    '--ft-theme-list-focus-outline': focusOutline ?? sideBarFg ?? '',
    '--ft-theme-input-background': inputBg ?? '',
    '--ft-theme-input-border': inputBorder ?? sideBarBorder ?? '',
  };

  if (gitAdded != null && gitAdded !== '') {
    result['--ft-theme-git-decoration-added-resource-foreground'] = gitAdded;
  }
  if (gitModified != null && gitModified !== '') {
    result['--ft-theme-git-decoration-modified-resource-foreground'] =
      gitModified;
  }
  if (gitDeleted != null && gitDeleted !== '') {
    result['--ft-theme-git-decoration-deleted-resource-foreground'] =
      gitDeleted;
  }

  return result;
}
