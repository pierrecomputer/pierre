'use client';

import { FileDiff } from '@/components/diff-ui/FileDiff';
import { IconDiffBlended, IconDiffSplit } from '@/components/icons';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type { FileContents } from '@pierre/diff-ui';
import { useState } from 'react';

import { FeatureHeader } from './FeatureHeader';

const OLD_FILE: FileContents = {
  name: 'example_old.tsx',
  contents: `import { getTokenStyleObject, stringifyTokenStyle } from 'shiki';

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
  theme?: PJSThemeNames;
  themes?: ThemesType;
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
};

const NEW_FILE: FileContents = {
  name: 'example_new.tsx',
  contents: `import { getTokenStyleObject, stringifyTokenStyle } from 'shiki';

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
  theme?: PJSThemeNames;
  themes?: ThemesType;
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
};

export function SplitUnified() {
  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>('split');
  return (
    <div className="space-y-5">
      <FeatureHeader
        title="Diff layout styles"
        description="Choose from stacked (unified) or split (side-by-side). Both use CSS Grid and Shadow DOM under the hood, meaning fewer DOM nodes and faster rendering."
      />
      <ButtonGroup
        value={diffStyle}
        onValueChange={(value) => setDiffStyle(value as 'split' | 'unified')}
      >
        <ButtonGroupItem value="split">
          <IconDiffSplit />
          Split
        </ButtonGroupItem>
        <ButtonGroupItem value="unified">
          <IconDiffBlended />
          Stacked
        </ButtonGroupItem>
      </ButtonGroup>

      <FileDiff
        oldFile={OLD_FILE}
        newFile={NEW_FILE}
        className="rounded-lg overflow-hidden border"
        options={{
          theme: 'pierre-dark',
          diffStyle,
        }}
      />
    </div>
  );
}
