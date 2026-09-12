import type { Theme } from '@pierre/highlights';

import { DEFAULT_THEMES } from '../constants';
import { getHighlightsTheme } from '../highlighter/getHighlightsTheme';
import type { DiffsHighlighter, DiffsThemeNames, ThemesType } from '../types';
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
    const themeData = getHighlightsTheme(highlighter.getTheme(theme));
    const normalized = getThemeColors(themeData);
    styles += `color:${normalized.fg};`;
    styles += `background-color:${normalized.bg};`;
    styles += `${formatCSSVariablePrefix('global')}fg:${normalized.fg};`;
    styles += `${formatCSSVariablePrefix('global')}bg:${normalized.bg};`;
    styles += getGitVariables(themeData, prefix);
  } else {
    let themeData = getHighlightsTheme(highlighter.getTheme(theme.dark));
    let normalized = getThemeColors(themeData);
    styles += `${formatCSSVariablePrefix('global')}dark:${normalized.fg};`;
    styles += `${formatCSSVariablePrefix('global')}dark-bg:${normalized.bg};`;
    styles += getGitVariables(themeData, 'dark');

    themeData = getHighlightsTheme(highlighter.getTheme(theme.light));
    normalized = getThemeColors(themeData);
    styles += `${formatCSSVariablePrefix('global')}light:${normalized.fg};`;
    styles += `${formatCSSVariablePrefix('global')}light-bg:${normalized.bg};`;
    styles += getGitVariables(themeData, 'light');
  }
  return styles;
}

// Read the git colors from the theme, falling back to terminal colors.
function getGitVariables(themeData: Theme, modePrefix?: string) {
  modePrefix = modePrefix != null ? `${modePrefix}-` : '';
  let styles = '';
  const additionGreen =
    themeData.style.created ?? themeData.style['terminal.ansi.green'];
  if (typeof additionGreen === 'string') {
    styles += `${formatCSSVariablePrefix('global')}${modePrefix}addition-color:${additionGreen};`;
  }
  const deletionRed =
    themeData.style.deleted ?? themeData.style['terminal.ansi.red'];
  if (typeof deletionRed === 'string') {
    styles += `${formatCSSVariablePrefix('global')}${modePrefix}deletion-color:${deletionRed};`;
  }
  const modifiedBlue =
    themeData.style.modified ?? themeData.style['terminal.ansi.blue'];
  if (typeof modifiedBlue === 'string') {
    styles += `${formatCSSVariablePrefix('global')}${modePrefix}modified-color:${modifiedBlue};`;
  }
  return styles;
}

// Resolve the same foreground/background defaults used by Highlights.
function getThemeColors({ style, cssVariables }: Theme): {
  fg: string;
  bg: string;
} {
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
