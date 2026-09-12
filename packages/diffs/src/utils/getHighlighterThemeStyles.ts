import { normalizeThemeColors } from '@pierre/theming/color';

import { DEFAULT_THEMES } from '../constants';
import type {
  DiffsHighlighter,
  DiffsThemeNames,
  ThemeRegistrationResolved,
  ThemesType,
} from '../types';
import { formatCSSVariablePrefix } from './formatCSSVariablePrefix';

interface GetHighlighterThemeStylesProps {
  theme?: DiffsThemeNames | ThemesType;
  highlighter: DiffsHighlighter;
  prefix?: string;
}

// FIXME(amadeus): We'll probably need to
// re-think this when it comes to removing inline
// styles
//
// The base foreground/background now flow through @pierre/theming's
// normalizeThemeColors, which preserves the theme's top-level fg/bg. The git
// colors deliberately stay on the diffs-local 2-link lookup below (see
// getGitVariables) to keep this output byte-identical; adopting
// normalizeThemeColors' longer git chain is a separate, independently verified
// follow-up rather than a side effect of this migration.
export function getHighlighterThemeStyles({
  theme = DEFAULT_THEMES,
  highlighter,
  prefix,
}: GetHighlighterThemeStylesProps): string {
  let styles = '';
  if (typeof theme === 'string') {
    const themeData = highlighter.getTheme(theme);
    const normalized = normalizeThemeColors(themeData);
    styles += `color:${normalized.fg};`;
    styles += `background-color:${normalized.bg};`;
    styles += `${formatCSSVariablePrefix('global')}fg:${normalized.fg};`;
    styles += `${formatCSSVariablePrefix('global')}bg:${normalized.bg};`;
    styles += getGitVariables(themeData, prefix);
  } else {
    let themeData = highlighter.getTheme(theme.dark);
    let normalized = normalizeThemeColors(themeData);
    styles += `${formatCSSVariablePrefix('global')}dark:${normalized.fg};`;
    styles += `${formatCSSVariablePrefix('global')}dark-bg:${normalized.bg};`;
    styles += getGitVariables(themeData, 'dark');

    themeData = highlighter.getTheme(theme.light);
    normalized = normalizeThemeColors(themeData);
    styles += `${formatCSSVariablePrefix('global')}light:${normalized.fg};`;
    styles += `${formatCSSVariablePrefix('global')}light-bg:${normalized.bg};`;
    styles += getGitVariables(themeData, 'light');
  }
  return styles;
}

// Emits the diffs git-status CSS variables (addition/deletion/modified colors)
// for a resolved theme. This intentionally uses the diffs-local 2-link lookup
// (gitDecoration.* → terminal.ansi*) and STOPS before the editorGutter.* tail
// that @pierre/theming's normalizeThemeColors adds, so the emitted string stays
// byte-identical to the pre-theming output. Adopting the gutter fallback for
// diffs is a deliberate follow-up. A variable is omitted entirely when neither
// source key is present, matching the previous behavior.
function getGitVariables(
  themeData: ThemeRegistrationResolved,
  modePrefix?: string
) {
  modePrefix = modePrefix != null ? `${modePrefix}-` : '';
  let styles = '';
  const additionGreen =
    themeData.colors?.['gitDecoration.addedResourceForeground'] ??
    themeData.colors?.['terminal.ansiGreen'];
  if (additionGreen != null) {
    styles += `${formatCSSVariablePrefix('global')}${modePrefix}addition-color:${additionGreen};`;
  }
  const deletionRed =
    themeData.colors?.['gitDecoration.deletedResourceForeground'] ??
    themeData.colors?.['terminal.ansiRed'];
  if (deletionRed != null) {
    styles += `${formatCSSVariablePrefix('global')}${modePrefix}deletion-color:${deletionRed};`;
  }
  const modifiedBlue =
    themeData.colors?.['gitDecoration.modifiedResourceForeground'] ??
    themeData.colors?.['terminal.ansiBlue'];
  if (modifiedBlue != null) {
    styles += `${formatCSSVariablePrefix('global')}${modePrefix}modified-color:${modifiedBlue};`;
  }
  return styles;
}
