import type {
  PJSHighlighter,
  PJSThemeNames,
  ThemeRegistrationResolved,
  ThemesType,
} from '../types';
import { formatCSSVariablePrefix } from './formatCSSVariablePrefix';

interface GetHighlighterThemeStylesProps {
  theme?: PJSThemeNames;
  themes?: ThemesType;
  highlighter: PJSHighlighter;
  prefix?: string;
}

// FIXME(amadeus): We'll probably need to
// re-think this when it comes to removing inline
// styles
export function getHighlighterThemeStyles({
  theme,
  themes,
  highlighter,
  prefix,
}: GetHighlighterThemeStylesProps): string {
  let styles = '';
  if (theme != null) {
    const themeData = highlighter.getTheme(theme);
    styles += `color:${themeData.fg};`;
    styles += `background-color:${themeData.bg};`;
    styles += `${formatCSSVariablePrefix(prefix)}fg:${themeData.fg};`;
    styles += `${formatCSSVariablePrefix(prefix)}bg:${themeData.bg};`;
    styles += getThemeVariables(themeData, prefix);
  } else if (themes != null) {
    let themeData = highlighter.getTheme(themes.dark);
    styles += `${formatCSSVariablePrefix(prefix)}dark:${themeData.fg};`;
    styles += `${formatCSSVariablePrefix(prefix)}dark-bg:${themeData.bg};`;
    styles += getThemeVariables(themeData, prefix, 'dark');

    themeData = highlighter.getTheme(themes.light);
    styles += `${formatCSSVariablePrefix(prefix)}light:${themeData.fg};`;
    styles += `${formatCSSVariablePrefix(prefix)}light-bg:${themeData.bg};`;
    styles += getThemeVariables(themeData, prefix, 'light');
  }
  return styles;
}

function getThemeVariables(
  themeData: ThemeRegistrationResolved,
  prefix?: string,
  modePrefix?: string
) {
  modePrefix = modePrefix != null ? `${modePrefix}-` : '';
  let styles = '';
  const additionGreen =
    themeData.colors?.['gitDecoration.addedResourceForeground'] ??
    themeData.colors?.['terminal.ansiGreen'];
  if (additionGreen != null) {
    styles += `${formatCSSVariablePrefix(prefix)}${modePrefix}addition-color:${additionGreen};`;
  }
  const deletionRed =
    themeData.colors?.['gitDecoration.deletedResourceForeground'] ??
    themeData.colors?.['terminal.ansiRed'];
  if (deletionRed != null) {
    styles += `${formatCSSVariablePrefix(prefix)}${modePrefix}deletion-color:${deletionRed};`;
  }
  const modifiedBlue =
    themeData.colors?.['gitDecoration.modifiedResourceForeground'] ??
    themeData.colors?.['terminal.ansiBlue'];
  if (modifiedBlue != null) {
    styles += `${formatCSSVariablePrefix(prefix)}${modePrefix}modified-color:${modifiedBlue};`;
  }
  return styles;
}
