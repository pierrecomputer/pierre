import { getTokenStyleObject, stringifyTokenStyle } from 'shiki';
import { DEFAULT_THEMES } from 'src/constants';

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
  theme?: PJSThemeNames | ThemesType;
  pre: HTMLPreElement;
  highlighter: PJSHighlighter;
  split: boolean;
  wrap: boolean;
  themeType: ThemeTypes;
  diffIndicators: 'bars' | 'classic' | 'none';
  disableBackground: boolean;
  totalLines: number;
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
  theme = DEFAULT_THEMES,
  split,
  wrap,
  themeType,
  diffIndicators,
  disableBackground,
  totalLines,
}: SetupWrapperNodesProps): HTMLPreElement {
  // Get theme color custom properties (e.g., --pjs-fg, --pjs-bg)
  const styles = getHighlighterThemeStyles({ theme, highlighter });

  if (themeType === 'system') {
    delete pre.dataset.themeType;
  } else {
    pre.dataset.themeType = themeType;
  }
  if (typeof theme === 'string') {
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
  // Set theme color custom properties as inline styles on pre element
  pre.style = styles;
  // Set CSS custom property for line number column width
  pre.style.setProperty(
    '--pjs-min-number-column-width-default',
    `${`${totalLines}`.length}ch`
  );
  return pre;
}

export function createHoverContent(): HTMLElement {
  const hoverContent = document.createElement('div');
  hoverContent.slot = 'hover-slot';
  hoverContent.style.position = 'absolute';
  hoverContent.style.top = '0';
  hoverContent.style.right = '0';
  hoverContent.style.bottom = '0';
  hoverContent.style.textAlign = 'center';
  hoverContent.style.whiteSpace = 'normal';
  return hoverContent;
}

export function createAnnotationWrapper(slot: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.dataset.annotationSlot = '';
  wrapper.slot = slot;
  wrapper.style.whiteSpace = 'normal';
  return wrapper;
}
