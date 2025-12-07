import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';
import type { PreloadMultiFileDiffOptions } from '@pierre/precision-diffs/ssr';

export const SPLIT_UNIFIED: PreloadMultiFileDiffOptions<undefined> = {
  oldFile: {
    name: 'example_old.tsx',
    contents: `import { getTokenStyleObject, stringifyTokenStyle } from 'shiki';

import type {
  FileDiffMetadata,
  FileTypes,
  PJSHighlighter,
  PJSThemeNames,
  RenderCustomFileMetadata,
  ThemeTypes,
  ThemeRegistrationResolved,
  ThemedToken,
  ThemesType,
} from '../types';

export function createSpanFromToken(token: ThemedToken) {
  const element = document.createElement('div');
  const style = getTokenStyleObject(token);
  element.style = stringifyTokenStyle(style);
  return element;
}

export function createRow(line: number) {
  const row = document.createElement('div');
  row.dataset.line = \`\${line}\`;

  const lineColumn = document.createElement('div');
  lineColumn.dataset.columnNumber = '';
  lineColumn.textContent = \`\${line}\`;

  const content = document.createElement('div');
  content.dataset.columnContent = '';

  row.appendChild(lineColumn);
  row.appendChild(content);
  return { row, content };
}

interface SetupWrapperNodesProps {
  theme?: PJSThemeNames | ThemesType;
  pre: HTMLElement;
  highlighter: PJSHighlighter;
  split: boolean;
  wrap: boolean;
  themed: boolean;
  diffIndicators: 'bars' | 'none';
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
`,
  },
  newFile: {
    name: 'example_new.tsx',
    contents: `import { getTokenStyleObject, stringifyTokenStyle } from 'shiki';

import type {
  FileDiffMetadata,
  FileTypes,
  PJSHighlighter,
  PJSThemeNames,
  RenderCustomFileMetadata,
  ThemeTypes,
  ThemeRegistrationResolved,
  ThemedToken,
  ThemesType,
} from '../types';

export function createSpanFromToken(token: ThemedToken) {
  const element = document.createElement('span');
  const style = token.htmlStyle ?? getTokenStyleObject(token);
  element.style = stringifyTokenStyle(style);
  element.textContent = token.content;
  element.dataset.span = ''
  return element;
}

export function createRow(line: number) {
  const row = document.createElement('div');
  row.dataset.line = \`\${line}\`;

  const content = document.createElement('div');
  content.dataset.columnContent = '';

  row.appendChild(content);
  return { row, content };
}

interface SetupWrapperNodesProps {
  theme?: PJSThemeNames | ThemesType;
  pre: HTMLElement;
  highlighter: PJSHighlighter;
  split: boolean;
  wrap: boolean;
  themed: boolean;
  diffIndicators: 'bars' | 'none';
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
`,
  },
  options: {
    theme: 'pierre-dark',
    diffStyle: 'split',
    unsafeCSS: CustomScrollbarCSS,
  },
};
