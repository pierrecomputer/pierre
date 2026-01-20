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
export function getHighlighterThemeStyles({
  theme = DEFAULT_THEMES,
  highlighter,
  prefix,
}: GetHighlighterThemeStylesProps): string {
  let styles = '';
  if (typeof theme === 'string') {
    const themeData = highlighter.getTheme(theme);
    styles += `color:${themeData.fg};`;
    styles += `background-color:${themeData.bg};`;
    styles += `${formatCSSVariablePrefix('global')}fg:${themeData.fg};`;
    styles += `${formatCSSVariablePrefix('global')}bg:${themeData.bg};`;
    styles += getThemeVariables(themeData, prefix);
  } else {
    let themeData = highlighter.getTheme(theme.dark);
    styles += `${formatCSSVariablePrefix('global')}dark:${themeData.fg};`;
    styles += `${formatCSSVariablePrefix('global')}dark-bg:${themeData.bg};`;
    styles += getThemeVariables(themeData, 'dark');

    themeData = highlighter.getTheme(theme.light);
    styles += `${formatCSSVariablePrefix('global')}light:${themeData.fg};`;
    styles += `${formatCSSVariablePrefix('global')}light-bg:${themeData.bg};`;
    styles += getThemeVariables(themeData, 'light');
  }
  return styles;
}

function getThemeVariables(
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
