import { DEFAULT_THEMES } from '../constants';
import type {
  DiffsHighlighter,
  DiffsTheme,
  DiffsThemeNames,
  DiffsThemeStyle,
  ThemesType,
} from '../types';
import { formatCSSVariablePrefix } from './formatCSSVariablePrefix';
import { getThemeStyle } from './getThemeStyle';

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
    const normalized = getThemeColors(themeData);
    styles += `color:${normalized.fg};`;
    styles += `background-color:${normalized.bg};`;
    styles += `${formatCSSVariablePrefix('global')}fg:${normalized.fg};`;
    styles += `${formatCSSVariablePrefix('global')}bg:${normalized.bg};`;
    styles += getGitVariables(getThemeStyle(themeData), prefix);
  } else {
    let themeData = highlighter.getTheme(theme.dark);
    let normalized = getThemeColors(themeData);
    styles += `${formatCSSVariablePrefix('global')}dark:${normalized.fg};`;
    styles += `${formatCSSVariablePrefix('global')}dark-bg:${normalized.bg};`;
    styles += getGitVariables(getThemeStyle(themeData), 'dark');

    themeData = highlighter.getTheme(theme.light);
    normalized = getThemeColors(themeData);
    styles += `${formatCSSVariablePrefix('global')}light:${normalized.fg};`;
    styles += `${formatCSSVariablePrefix('global')}light-bg:${normalized.bg};`;
    styles += getGitVariables(getThemeStyle(themeData), 'light');
  }
  return styles;
}

// Read the git colors from the theme, falling back to terminal colors.
function getGitVariables(style: DiffsThemeStyle, modePrefix?: string) {
  modePrefix = modePrefix != null ? `${modePrefix}-` : '';
  let styles = '';
  const additionGreen = style.created ?? style['terminal.ansi.green'];
  if (typeof additionGreen === 'string') {
    styles += `${formatCSSVariablePrefix('global')}${modePrefix}addition-color:${additionGreen};`;
  }
  const deletionRed = style.deleted ?? style['terminal.ansi.red'];
  if (typeof deletionRed === 'string') {
    styles += `${formatCSSVariablePrefix('global')}${modePrefix}deletion-color:${deletionRed};`;
  }
  const modifiedBlue = style.modified ?? style['terminal.ansi.blue'];
  if (typeof modifiedBlue === 'string') {
    styles += `${formatCSSVariablePrefix('global')}${modePrefix}modified-color:${modifiedBlue};`;
  }
  return styles;
}

// Resolve the same foreground/background defaults used by Highlights.
function getThemeColors(raw: DiffsTheme): {
  fg: string;
  bg: string;
} {
  const style = getThemeStyle(raw);
  const cssVariables = 'cssVariables' in raw && raw.cssVariables === true;
  return {
    fg:
      cssVariables === true
        ? 'var(--hls-foreground)'
        : (style['editor.foreground'] ??
          style.text ??
          style.foreground ??
          'inherit'),
    bg:
      cssVariables === true
        ? 'var(--hls-background)'
        : (style['editor.background'] ?? style.background ?? 'transparent'),
  };
}
