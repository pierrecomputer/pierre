import type { BundledLanguage, BundledTheme, HighlighterGeneric } from 'shiki';
import {
  getTokenStyleObject,
  stringifyTokenStyle,
  type ThemedToken,
} from 'shiki';
import type { ThemesType } from 'pierrejs';

interface ThemeVariant {
  themes?: never;
  theme: BundledTheme;
}

interface ThemesVariant {
  themes: ThemesType;
  theme?: never;
}

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

interface SetupWrapperBase {
  pre: HTMLPreElement;
  highlighter: HighlighterGeneric<BundledLanguage, BundledTheme>;
  splitView: boolean;
}

interface SetupWrapperTheme extends ThemeVariant, SetupWrapperBase {}

interface SetupWrapperThemes extends ThemesVariant, SetupWrapperBase {}

type SetupWrapperNodesProps = SetupWrapperTheme | SetupWrapperThemes;

export function setupPreNode(props: SetupWrapperNodesProps) {
  const { pre } = props;
  // Clean out container
  pre.innerHTML = '';
  pre.tabIndex = 0;
  pre.dataset.pierrejs = '';
  setWrapperProps(props);
  return pre;
}

interface CreateCodeNodeProps {
  pre?: HTMLPreElement;
  columnType?: 'additions' | 'deletions';
}

export function createCodeNode({ pre, columnType }: CreateCodeNodeProps) {
  const code = document.createElement('code');
  code.dataset.code = '';
  if (columnType != null) {
    code.dataset[columnType] = '';
  }
  pre?.appendChild(code);
  return code;
}

export function createHunkSeparator() {
  const separator = document.createElement('div');
  separator.dataset.separator = '';
  return separator;
}

function setWrapperProps(
  { pre, highlighter, theme, themes, splitView }: SetupWrapperNodesProps,
  prefix?: string
) {
  let styles = '';
  if (theme != null) {
    const themeData = highlighter.getTheme(theme);
    styles += `color:${themeData.fg};`;
    styles += `background-color:${themeData.bg};`;
    styles += `${formatCSSVariablePrefix(prefix)}-fg:${themeData.fg};`;
    styles += `${formatCSSVariablePrefix(prefix)}-bg:${themeData.bg};`;
    pre.dataset.theme = themeData.type;
  } else {
    let themeData = highlighter.getTheme(themes.dark);
    styles += `${formatCSSVariablePrefix(prefix)}dark:${themeData.fg};`;
    styles += `${formatCSSVariablePrefix(prefix)}dark-bg:${themeData.bg};`;

    themeData = highlighter.getTheme(themes.light);
    styles += `${formatCSSVariablePrefix(prefix)}light:${themeData.fg};`;
    styles += `${formatCSSVariablePrefix(prefix)}light-bg:${themeData.bg};`;
    pre.dataset.themed = '';
  }
  pre.dataset.type = splitView ? 'split' : 'file';
  pre.style = styles;
}

export function formatCSSVariablePrefix(prefix: string = 'pjs') {
  return `--${prefix}-`;
}
