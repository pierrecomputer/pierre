import type { HighlighterGeneric } from 'shiki';
import {
  getTokenStyleObject,
  stringifyTokenStyle,
  type ThemedToken,
} from 'shiki';

export function createSpanFromToken(token: ThemedToken) {
  const element = document.createElement('span');
  const style = token.htmlStyle ?? getTokenStyleObject(token);
  element.style = stringifyTokenStyle(style);
  element.textContent = token.content;
  return element;
}

export function createRow(line: number) {
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

export function createWrapperNodes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  highlighter: HighlighterGeneric<any, any>
) {
  const pre = document.createElement('pre');
  pre.tabIndex = 0;
  pre.dataset.theme = 'dark';
  pre.dataset.pre = '';
  pre.style = getEditorStyles(highlighter);
  const code = document.createElement('code');
  code.dataset.code = '';
  pre.appendChild(code);
  return { pre, code };
}

export function getEditorStyles(
  highlighter: HighlighterGeneric<any, any>,
  prefix: string = 'shiki'
) {
  let styles = '';
  for (const themeKey of highlighter.getLoadedThemes()) {
    const theme = highlighter.getTheme(themeKey);
    styles += `--${prefix}-${theme.type}:${theme.fg};`;
    styles += `--${prefix}-${theme.type}-bg:${theme.bg};`;
  }
  return styles;
}
