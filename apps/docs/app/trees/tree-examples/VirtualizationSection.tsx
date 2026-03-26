import { FileTree } from '@pierre/trees/react';
import { preloadFileTree } from '@pierre/trees/ssr';
import Link from 'next/link';
import type { CSSProperties } from 'react';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { DEFAULT_FILE_TREE_PANEL_CLASS } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

const EXTENSIONS = ['.ts', '.tsx', '.css', '.json', '.md', '.test.ts'];

const COMPONENT_NAMES = [
  'Button',
  'Card',
  'Dialog',
  'Dropdown',
  'Input',
  'Modal',
  'Select',
  'Sidebar',
  'Tabs',
  'Tooltip',
];

const UTIL_NAMES = [
  'array',
  'cache',
  'color',
  'crypto',
  'date',
  'debounce',
  'dom',
  'event',
  'format',
  'hash',
  'http',
  'logger',
  'math',
  'merge',
  'parse',
  'path',
  'queue',
  'random',
  'schema',
  'string',
  'throttle',
  'timer',
  'url',
  'validate',
];

const PACKAGE_NAMES = [
  'api',
  'auth',
  'cache',
  'cli',
  'config',
  'core',
  'crypto',
  'database',
  'email',
  'events',
  'gateway',
  'graphql',
  'hooks',
  'i18n',
  'icons',
  'jobs',
  'logging',
  'metrics',
  'models',
  'notifications',
  'payments',
  'permissions',
  'queue',
  'router',
  'scheduler',
  'search',
  'session',
  'storage',
  'testing',
  'types',
  'ui',
  'uploads',
  'validation',
  'workers',
];

const APP_NAMES = ['web', 'admin', 'docs', 'mobile', 'storybook'];
const FILE_COUNT_FORMATTER = new Intl.NumberFormat('en-US');
function generateLargeTree(): { files: string[]; expandedItems: string[] } {
  const files: string[] = [
    'README.md',
    'package.json',
    'tsconfig.json',
    'turbo.json',
    '.eslintrc.json',
    '.prettierrc',
    '.gitignore',
  ];

  for (const pkg of PACKAGE_NAMES) {
    const base = `packages/${pkg}`;
    files.push(
      `${base}/package.json`,
      `${base}/tsconfig.json`,
      `${base}/README.md`
    );

    files.push(`${base}/src/index.ts`);

    for (const comp of COMPONENT_NAMES) {
      files.push(`${base}/src/components/${comp}.tsx`);
      files.push(`${base}/src/components/${comp}.test.tsx`);
    }

    for (const util of UTIL_NAMES) {
      files.push(`${base}/src/utils/${util}.ts`);
      files.push(`${base}/src/utils/${util}.test.ts`);
    }

    for (const ext of EXTENSIONS) {
      files.push(`${base}/src/lib/helpers${ext}`);
    }

    files.push(
      `${base}/src/types/index.ts`,
      `${base}/src/types/internal.ts`,
      `${base}/src/constants.ts`
    );
  }

  for (const app of APP_NAMES) {
    const base = `apps/${app}`;
    files.push(
      `${base}/package.json`,
      `${base}/tsconfig.json`,
      `${base}/README.md`
    );

    files.push(`${base}/src/index.ts`, `${base}/src/App.tsx`);

    for (const comp of COMPONENT_NAMES) {
      files.push(`${base}/src/components/${comp}.tsx`);
      files.push(`${base}/src/components/${comp}.module.css`);
    }

    for (const name of [
      'Home',
      'Settings',
      'Dashboard',
      'Profile',
      'Login',
      'NotFound',
    ]) {
      files.push(`${base}/src/pages/${name}.tsx`);
    }

    for (const name of [
      'useAuth',
      'useTheme',
      'useMedia',
      'useDebounce',
      'useForm',
    ]) {
      files.push(`${base}/src/hooks/${name}.ts`);
    }

    files.push(
      `${base}/public/favicon.ico`,
      `${base}/public/robots.txt`,
      `${base}/public/manifest.json`
    );
  }

  const dirSet = new Set<string>();
  for (const file of files) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) {
      dirSet.add(parts.slice(0, i).join('/'));
    }
  }

  return {
    files,
    expandedItems: [...dirSet],
  };
}

const panelStyle: CSSProperties = {
  colorScheme: 'dark',
  height: 540,
};

const virtualizationDemoData = generateLargeTree();
const virtualizationPrerenderedHTML = preloadFileTree(
  {
    virtualize: { threshold: 0 },
    flattenEmptyDirectories: true,
    id: 'virtualization-demo',
    initialFiles: virtualizationDemoData.files,
  },
  {
    initialExpandedItems: virtualizationDemoData.expandedItems,
  }
).shadowHtml;

export function VirtualizationSection() {
  const { files, expandedItems } = virtualizationDemoData;

  return (
    <TreeExampleSection>
      <FeatureHeader
        id="virtualization"
        title="Virtualized rendering"
        description={
          <>
            Trees with thousands of items render instantly with opt-in
            virtualization. Only visible rows are in the DOM. Pass{' '}
            <code>virtualize</code> in{' '}
            <Link
              href="/preview/trees/docs#core-types-filetreeoptions"
              className="inline-link"
            >
              <code>FileTreeOptions</code>
            </Link>{' '}
            to enable it. As a demo, the tree below contains{' '}
            <strong>{FILE_COUNT_FORMATTER.format(files.length)} files</strong>{' '}
            with every folder expanded.
          </>
        }
      />

      <FileTree
        className={DEFAULT_FILE_TREE_PANEL_CLASS}
        prerenderedHTML={virtualizationPrerenderedHTML}
        options={{
          virtualize: { threshold: 0 },
          flattenEmptyDirectories: true,
          id: 'virtualization-demo',
        }}
        initialFiles={files}
        initialExpandedItems={expandedItems}
        style={panelStyle}
      />
    </TreeExampleSection>
  );
}
