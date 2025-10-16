import { getTokenStyleObject, stringifyTokenStyle } from 'shiki';

import type {
  FileDiffMetadata,
  FileTypes,
  PJSHighlighter,
  PJSThemeNames,
  RenderCustomFileMetadata,
  ThemeModes,
  ThemeRegistrationResolved,
  ThemedToken,
  ThemesType,
} from '../types';

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

interface SetupWrapperNodesProps {
  theme?: PJSThemeNames;
  themes?: ThemesType;
  pre: HTMLPreElement;
  highlighter: PJSHighlighter;
  split: boolean;
  wrap: boolean;
  themeMode: ThemeModes;
  diffIndicators: 'bars' | 'classic' | 'none';
  disableBackground: boolean;
}

interface CreateCodeNodeProps {
  pre?: HTMLPreElement;
  columnType?: 'additions' | 'deletions' | 'unified';
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

interface GetHighlighterThemeStylesProps {
  theme?: PJSThemeNames;
  themes?: ThemesType;
  highlighter: PJSHighlighter;
  prefix?: string;
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

export function getHighlighterThemeStyles({
  theme,
  themes,
  highlighter,
  prefix,
}: GetHighlighterThemeStylesProps) {
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

export function setWrapperProps({
  pre,
  highlighter,
  theme,
  themes,
  split,
  wrap,
  themeMode,
  diffIndicators,
  disableBackground,
}: SetupWrapperNodesProps) {
  const styles = getHighlighterThemeStyles({ theme, themes, highlighter });
  if (themeMode === 'system') {
    delete pre.dataset.themeMode;
  } else {
    pre.dataset.themeMode = themeMode;
  }
  if (theme != null) {
    const themeData = highlighter.getTheme(theme);
    pre.dataset.themeMode = themeData.type;
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

export function formatCSSVariablePrefix(prefix: string = 'pjs') {
  return `--${prefix}-`;
}

export function createSVGElement<K extends keyof SVGElementTagNameMap>(
  tagName: K
): SVGElementTagNameMap[K] {
  return document.createElementNS('http://www.w3.org/2000/svg', tagName);
}

function getIconForType(type: FileTypes) {
  switch (type) {
    case 'change':
      return '#pjs-icon-git-modified';
    case 'new':
      return '#pjs-icon-git-added';
    case 'deleted':
      return '#pjs-icon-git-deleted';
    case 'rename-pure':
    case 'rename-changed':
      return '#pjs-icon-git-moved';
  }
}

interface RenderFileHeaderProps {
  file: FileDiffMetadata;
  renderCustomMetadata?: RenderCustomFileMetadata;
  theme?: PJSThemeNames;
  themes?: ThemesType;
  highlighter: PJSHighlighter;
  prefix?: string;
  themeMode?: ThemeModes;
}

export function renderFileHeader({
  file,
  theme,
  themes,
  themeMode,
  highlighter,
  prefix,
  renderCustomMetadata,
}: RenderFileHeaderProps): HTMLDivElement {
  const style = getHighlighterThemeStyles({
    theme,
    themes,
    highlighter,
    prefix,
  });
  const container = document.createElement('div');
  container.dataset.pjsHeader = '';
  container.dataset.changeType = file.type;
  container.style = style;
  if (themeMode != null && themeMode !== 'system') {
    container.dataset.themeMode = themeMode;
  }

  const content = document.createElement('div');
  content.dataset.headerContent = '';

  const icon = createSVGElement('svg');
  icon.setAttribute('width', '16');
  icon.setAttribute('height', '16');
  icon.setAttribute('viewBox', '0 0 16 16');
  const useEl = createSVGElement('use');
  useEl.setAttribute('href', getIconForType(file.type));
  icon.appendChild(useEl);
  icon.dataset.changeIcon = file.type;
  content.appendChild(icon);

  const title = document.createElement('div');
  title.dataset.title = '';
  if (file.prevName != null) {
    const prevName = document.createElement('div');
    prevName.dataset.prevName = '';
    prevName.textContent = file.prevName;
    const icon = createSVGElement('svg');
    icon.dataset.renameIcon = '';
    icon.setAttribute('width', '16');
    icon.setAttribute('height', '16');
    icon.setAttribute('viewBox', '0 0 16 16');
    const useEl = createSVGElement('use');
    useEl.setAttribute('href', '#pjs-arrow');
    icon.appendChild(useEl);
    content.appendChild(prevName);
    content.appendChild(icon);
  }
  title.innerText = file.name;
  content.appendChild(title);

  const metadata = document.createElement('div');
  metadata.dataset.metadata = '';
  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.hunkContent ?? []) {
      if (line.startsWith('+')) {
        additions++;
      } else if (line.startsWith('-')) {
        deletions++;
      }
    }
  }
  if (additions > 0) {
    const addition = document.createElement('span');
    addition.dataset.additions = '';
    addition.textContent = `+${additions}`;
    metadata.appendChild(addition);
  }
  if (deletions > 0) {
    const deletion = document.createElement('span');
    deletion.dataset.deletions = '';
    deletion.textContent = `-${deletions}`;
    metadata.appendChild(deletion);
  }
  if (deletions === 0 && additions === 0) {
    const nochange = document.createElement('span');
    nochange.textContent = 'NC';
    metadata.appendChild(nochange);
  }

  if (renderCustomMetadata != null) {
    const input = renderCustomMetadata(file);
    if (
      input != null &&
      (typeof input === 'string' || typeof input === 'number')
    ) {
      metadata.insertAdjacentText('beforeend', `${input}`);
    } else if (input != null) {
      metadata.appendChild(input);
    }
  }
  container.appendChild(content);
  container.appendChild(metadata);
  return container;
}
