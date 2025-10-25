import type { PreloadFileDiffOptions } from '@pierre/precision-diffs/ssr';

export const SPLIT_UNIFIED: PreloadFileDiffOptions<undefined> = {
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
  },
  options: {
    theme: 'pierre-dark',
    diffStyle: 'split',
  },
};

export const SHIKI_THEMES: PreloadFileDiffOptions<undefined> = {
  oldFile: {
    name: 'file.tsx',
    contents: `import * as 'react';
import IconSprite from './IconSprite';
import Header from './Header';

export default function Home() {
  return (
    <div>
      <Header />
      <IconSprite />
    </div>
  );
}
`,
  },
  newFile: {
    name: 'file.tsx',
    contents: `import IconSprite from './IconSprite';
import HeaderSimple from '../components/HeaderSimple';
import Hero from '../components/Hero';

export default function Home() {
  return (
    <div>
      <HeaderSimple />
      <IconSprite />
      <h1>Hello!</h1>
    </div>
  );
}
`,
  },
  options: {
    diffStyle: 'split',
    themes: {
      dark: 'pierre-dark',
      light: 'pierre-light',
    },
  },
};

export const DIFF_STYLES: PreloadFileDiffOptions<undefined> = {
  oldFile: {
    name: 'main.zig',
    contents: `const std = @import("std");
const Allocator = std.heap.page_allocator;
const ArrayList = std.ArrayList;

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("Hi You, {s}!\\n", .{"World"});

    var list = ArrayList(i32).init(allocator);
    defer list.deinit();
}
`,
  },
  newFile: {
    name: 'main.zig',
    contents: `const std = @import("std");
const GeneralPurposeAllocator = std.heap.GeneralPurposeAllocator;
const ArrayList = std.ArrayList;

pub fn main() !void {
    var gpa = GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const stdout = std.io.getStdOut().writer();
    try stdout.print("Hello There, {s}!\\n", .{"Zig"});

    var list = ArrayList(i32).init(allocator);
    defer list.deinit();
    try list.append(42);
}
`,
  },
  options: {
    theme: 'pierre-dark',
    diffStyle: 'split',
    overflow: 'wrap',
  },
};

export const FONT_STYLES: PreloadFileDiffOptions<undefined> = {
  oldFile: {
    name: 'hello.ts',
    contents: `function greet(name) {
  return "Hello, " + name + "!";
}

const message = greet("World");
console.log(message);
`,
  },
  newFile: {
    name: 'hello.ts',
    contents: `function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

const message: string = greet("World");
console.log(message);

export { greet };
`,
  },
  options: {
    theme: 'pierre-dark',
    diffStyle: 'unified',
  },
};

export interface AnnotationMetadata {
  key: string;
  isThread: boolean;
}

export const ANNOTATION_EXAMPLE: PreloadFileDiffOptions<AnnotationMetadata> = {
  oldFile: {
    name: 'file.tsx',
    contents: `import * as 'react';
import IconSprite from './IconSprite';
import Header from './Header';

export default function Home() {
  return (
    <div>
      <Header />
      <IconSprite />
    </div>
  );
}
`,
  },
  newFile: {
    name: 'file.tsx',
    contents: `import IconSprite from './IconSprite';
import HeaderSimple from '../components/HeaderSimple';
import Hero from '../components/Hero';

export default function Home() {
  return (
    <div>
      <HeaderSimple />
      <IconSprite />
      <h1>Hello!</h1>
    </div>
  );
}
`,
  },
  options: {
    theme: 'pierre-dark',
    diffStyle: 'unified',
  },
  annotations: [
    {
      side: 'additions',
      lineNumber: 8,
      metadata: {
        key: 'additions-8',
        isThread: true,
      },
    },
  ],
};

export const ARBITRARY_DIFF_EXAMPLE: PreloadFileDiffOptions<undefined> = {
  oldFile: {
    name: 'example.css',
    contents: `.pizza {
  display: flex;
  justify-content: center;
}
`,
  },
  newFile: {
    name: 'example.css',
    contents: `.pizza {
  display: flex;
}
`,
  },
  options: {
    theme: 'pierre-dark',
    diffStyle: 'unified',
  },
};
