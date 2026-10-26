import { normalizeThemeColors } from '@pierre/theming/color';

import { DEFAULT_THEMES } from '../constants';
import type {
  DiffsHighlighter,
  DiffsTheme,
  DiffsThemeNames,
  ThemesType,
} from '../types';
import { formatCSSVariablePrefix } from './formatCSSVariablePrefix';

interface GetHighlighterThemeStylesProps {
  theme?: DiffsThemeNames | ThemesType;
  highlighter: DiffsHighlighter;
  prefix?: string;
}

export function getHighlighterThemeStyles({
  theme = DEFAULT_THEMES,
  highlighter,
  prefix,
}: GetHighlighterThemeStylesProps): string {
  let styles = '';
  if (typeof theme === 'string') {
    const themeData = highlighter.getTheme(theme);
    const normalized = getThemeColors(themeData, highlighter);
    styles += `color:${normalized.fg};`;
    styles += `background-color:${normalized.bg};`;
    styles += `${formatCSSVariablePrefix('global')}fg:${normalized.fg};`;
    styles += `${formatCSSVariablePrefix('global')}bg:${normalized.bg};`;
    styles += getGitVariables(themeData, prefix);
  } else {
    let themeData = highlighter.getTheme(theme.dark);
    let normalized = getThemeColors(themeData, highlighter);
    styles += `${formatCSSVariablePrefix('global')}dark:${normalized.fg};`;
    styles += `${formatCSSVariablePrefix('global')}dark-bg:${normalized.bg};`;
    styles += getGitVariables(themeData, 'dark');

    themeData = highlighter.getTheme(theme.light);
    normalized = getThemeColors(themeData, highlighter);
    styles += `${formatCSSVariablePrefix('global')}light:${normalized.fg};`;
    styles += `${formatCSSVariablePrefix('global')}light-bg:${normalized.bg};`;
    styles += getGitVariables(themeData, 'light');
  }
  return styles;
}

// cssVariables: true must use the same prefix for backgrounds and tokens.
// Object palettes already include their configured prefix and defaults.
function getThemeColors(theme: DiffsTheme, highlighter: DiffsHighlighter) {
  if (highlighter.name === 'highlights' && theme.zed?.cssVariables === true) {
    const prefix = formatCSSVariablePrefix('token');
    return { fg: `var(${prefix}foreground)`, bg: `var(${prefix}background)` };
  }
  return normalizeThemeColors(theme);
}

// Keep the gitDecoration → terminal.ansi fallback; adding editorGutter colors
// here would change diff backgrounds for existing themes.
function getGitVariables(themeData: DiffsTheme, modePrefix?: string) {
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
