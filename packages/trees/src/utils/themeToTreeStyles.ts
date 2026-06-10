import type { ThemeLike } from '@pierre/theming';
import { colorUtils, normalizeThemeColors } from '@pierre/theming/color';

/**
 * Theme-like shape compatible with Shiki/VS Code theme format (e.g. from
 * highlighter.getTheme() or resolveTheme()). No dependency on shiki; use with
 * resolved themes from @pierre/diffs or shiki. Aliased to theming's
 * `ThemeLike` — a structural superset of the keys trees reads — so existing
 * callers and tests keep typechecking unchanged.
 */
export type TreeThemeInput = ThemeLike;

/**
 * CSS custom properties (--trees-theme-*) and layout styles for the tree host/panel.
 * Compatible with React inline style and the trees stylesheet fallback chain.
 */
export type TreeThemeStyles = Record<string, string>;

/**
 * Maps a Shiki/VS Code–style theme to CSS for FileTree. The shared
 * fallback/repair work — surface chains, the git-color chain, the
 * transparent-focus repair, and dropping a text-erasing hover background — now
 * lives in @pierre/theming's `normalizeThemeColors`, which returns a theme in
 * the same workbench-key vocabulary with those keys resolved. This function
 * reads those resolved keys and maps them onto trees' `--trees-theme-*`
 * variables, applying trees' own presentation defaults where a key is absent.
 *
 * The one piece of trees-specific opinion kept here is the selection lookup: a
 * `list.activeSelectionBackground` that matches the sidebar surface is invisible,
 * so trees prefers `list.focusBackground` in that case. normalizeThemeColors
 * leaves the raw selection keys untouched precisely so this choice stays a trees
 * concern. The trees stylesheet uses --trees-theme-* in its fallback chain
 * (--trees-*-override → --trees-theme-* → default).
 *
 * Use with a resolved theme from shiki or @pierre/diffs:
 *
 *   const theme = await resolveTheme('dracula');
 *   const styles = themeToTreeStyles(theme);
 *   <FileTree style={styles} options={...} />
 */
export function themeToTreeStyles(theme: TreeThemeInput): TreeThemeStyles {
  const colors = normalizeThemeColors(theme).colors ?? {};
  const isDark = theme.type === 'dark';

  // Pull every resolved key into a named local so the mapping below reads as a
  // flat list of tokens rather than inline lookups.
  const sidebarBg = colors['sideBar.background'];
  const sidebarFg = colors['sideBar.foreground'];
  const sectionHeaderFg = colors['sideBarSectionHeader.foreground'];
  const selectionFg = colors['list.activeSelectionForeground'];
  const hoverBg = colors['list.hoverBackground'];
  const focusRing = colors['list.focusOutline'];
  const inputBg = colors['input.background'];
  const sidebarBorder = colors['sideBar.border'];
  const inputBorder = colors['input.border'];
  const scrollbarThumb = colors['scrollbarSlider.background'];
  const addedFg = colors['gitDecoration.addedResourceForeground'];
  const modifiedFg = colors['gitDecoration.modifiedResourceForeground'];
  const deletedFg = colors['gitDecoration.deletedResourceForeground'];

  // Hover fallback is chosen by the ACTUAL sidebar surface luminance, not
  // theme.type — slack-ochin is tagged `light` but ships a dark sidebar.
  const sidebarL = colorUtils.relativeLuminance(sidebarBg);
  const sideBarIsDark = sidebarL != null ? sidebarL < 0.5 : isDark;

  // Selection opinion (trees-owned): a same-surface selection background is
  // invisible, so prefer list.focusBackground; otherwise use the raw selection.
  // editor.selectionBackground is the shared tail in both branches. The
  // `rawSelectionBg != null` guard stops an absent selection from being treated
  // as "same surface" when sidebarBg is also absent.
  const rawSelectionBg = colors['list.activeSelectionBackground'];
  const focusBackground = colors['list.focusBackground'];
  const editorSelectionBg = colors['editor.selectionBackground'];
  const sidebarBgLower = sidebarBg?.toLowerCase();
  const selectionBg =
    rawSelectionBg != null && rawSelectionBg.toLowerCase() === sidebarBgLower
      ? (focusBackground ?? editorSelectionBg)
      : (rawSelectionBg ?? editorSelectionBg);

  const result: TreeThemeStyles = {
    colorScheme: isDark ? 'dark' : 'light',
    backgroundColor: sidebarBg ?? '',
    color: sidebarFg ?? '',
    borderColor:
      'var(--trees-theme-sidebar-border, light-dark(oklch(0% 0 0 / 0.15), oklch(100% 0 0 / 0.15)))',
    '--trees-theme-sidebar-bg': sidebarBg ?? '',
    '--trees-theme-sidebar-fg': sidebarFg ?? '',
    '--trees-theme-sidebar-header-fg': sectionHeaderFg ?? '',
    '--trees-theme-list-active-selection-fg': selectionFg ?? '',
    '--trees-theme-list-hover-bg':
      hoverBg ??
      (sideBarIsDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
    '--trees-theme-list-active-selection-bg': selectionBg ?? 'transparent',
    '--trees-theme-focus-ring': focusRing ?? sidebarFg ?? '',
    '--trees-theme-input-bg': inputBg ?? '',
  };

  // Expose explicit sidebar border token when present.
  // `borderColor` above always falls back to the default light/dark value.
  if (sidebarBorder != null && sidebarBorder !== '') {
    result['--trees-theme-sidebar-border'] = sidebarBorder;
  }
  if (inputBorder != null && inputBorder !== '') {
    result['--trees-theme-input-border'] = inputBorder;
  }
  if (scrollbarThumb != null && scrollbarThumb !== '') {
    result['--trees-theme-scrollbar-thumb'] = scrollbarThumb;
  }
  if (addedFg != null && addedFg !== '') {
    result['--trees-theme-git-added-fg'] = addedFg;
  }
  if (modifiedFg != null && modifiedFg !== '') {
    result['--trees-theme-git-modified-fg'] = modifiedFg;
  }
  if (deletedFg != null && deletedFg !== '') {
    result['--trees-theme-git-deleted-fg'] = deletedFg;
  }

  return result;
}
