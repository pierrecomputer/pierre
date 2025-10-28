import { getTokenStyleObject, stringifyTokenStyle } from 'shiki';

import type {
  PJSHighlighter,
  PJSThemeNames,
  ThemeTypes,
  ThemedToken,
  ThemesType,
} from '../types';
import { getHighlighterThemeStyles } from './getHighlighterThemeStyles';

export function createSpanFromToken(token: ThemedToken): HTMLSpanElement {
  const element = document.createElement('span');
  const style = token.htmlStyle ?? getTokenStyleObject(token);
  element.style = stringifyTokenStyle(style);
  element.textContent = token.content;
  return element;
}

export function createRow(line: number): {
  row: HTMLElement;
  content: HTMLElement;
} {
  const row = document.createElement('div');
  row.dataset.line = `${line}`;

  const lineColumn = document.createElement('div');
  lineColumn.dataset.columnNumber = '';
  lineColumn.textContent = `${line}`;

  const content = document.createElement('div');
  content.dataset.columnContent = '';

  row.appendChild(lineColumn);
  row.appendChild(content);
  return { row, content };
}

interface SetupWrapperNodesProps {
  theme?: PJSThemeNames;
  themes?: ThemesType;
  pre: HTMLPreElement;
  highlighter: PJSHighlighter;
  split: boolean;
  wrap: boolean;
  themeType: ThemeTypes;
  diffIndicators: 'bars' | 'classic' | 'none';
  disableBackground: boolean;
}

interface CreateCodeNodeProps {
  pre?: HTMLPreElement;
  columnType?: 'additions' | 'deletions' | 'unified';
}

export function createCodeNode({
  pre,
  columnType,
}: CreateCodeNodeProps = {}): HTMLElement {
  const code = document.createElement('code');
  code.dataset.code = '';
  if (columnType != null) {
    code.dataset[columnType] = '';
  }
  pre?.appendChild(code);
  return code;
}

export function setWrapperProps({
  pre,
  highlighter,
  theme,
  themes,
  split,
  wrap,
  themeType,
  diffIndicators,
  disableBackground,
}: SetupWrapperNodesProps): HTMLPreElement {
  const styles = getHighlighterThemeStyles({ theme, themes, highlighter });
  if (themeType === 'system') {
    delete pre.dataset.themeType;
  } else {
    pre.dataset.themeType = themeType;
  }
  if (theme != null) {
    const themeData = highlighter.getTheme(theme);
    pre.dataset.themeType = themeData.type;
  }
  switch (diffIndicators) {
    case 'bars':
    case 'classic':
      pre.dataset.indicators = diffIndicators;
      break;
    case 'none':
      delete pre.dataset.indicators;
      break;
  }
  if (disableBackground) {
    delete pre.dataset.background;
  } else {
    pre.dataset.background = '';
  }
  pre.dataset.type = split ? 'split' : 'file';
  pre.dataset.overflow = wrap ? 'wrap' : 'scroll';
  pre.dataset.pjs = '';
  pre.tabIndex = 0;
  pre.style = styles;
  return pre;
}
