import { preloadFileTree } from '@pierre/trees/ssr';

import { DemoVirtualizationClient } from './DemoVirtualizationClient';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';

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

function createVirtualizationDemoData(): {
  expandedPaths: string[];
  paths: string[];
} {
  const paths: string[] = [
    'README.md',
    'package.json',
    'tsconfig.json',
    'turbo.json',
    '.eslintrc.json',
    '.prettierrc',
    '.gitignore',
  ];

  for (const packageName of PACKAGE_NAMES) {
    const basePath = `packages/${packageName}`;
    paths.push(
      `${basePath}/package.json`,
      `${basePath}/tsconfig.json`,
      `${basePath}/README.md`
    );
    paths.push(`${basePath}/src/index.ts`);

    for (const componentName of COMPONENT_NAMES) {
      paths.push(`${basePath}/src/components/${componentName}.tsx`);
      paths.push(`${basePath}/src/components/${componentName}.test.tsx`);
    }
    for (const utilName of UTIL_NAMES) {
      paths.push(`${basePath}/src/utils/${utilName}.ts`);
      paths.push(`${basePath}/src/utils/${utilName}.test.ts`);
    }
    for (const extension of EXTENSIONS) {
      paths.push(`${basePath}/src/lib/helpers${extension}`);
    }

    paths.push(
      `${basePath}/src/types/index.ts`,
      `${basePath}/src/types/internal.ts`,
      `${basePath}/src/constants.ts`
    );
  }

  for (const appName of APP_NAMES) {
    const basePath = `apps/${appName}`;
    paths.push(
      `${basePath}/package.json`,
      `${basePath}/tsconfig.json`,
      `${basePath}/README.md`
    );
    paths.push(`${basePath}/src/index.ts`, `${basePath}/src/App.tsx`);

    for (const componentName of COMPONENT_NAMES) {
      paths.push(`${basePath}/src/components/${componentName}.tsx`);
      paths.push(`${basePath}/src/components/${componentName}.module.css`);
    }

    for (const pageName of [
      'Home',
      'Settings',
      'Dashboard',
      'Profile',
      'Login',
      'NotFound',
    ]) {
      paths.push(`${basePath}/src/pages/${pageName}.tsx`);
    }
    for (const hookName of [
      'useAuth',
      'useTheme',
      'useMedia',
      'useDebounce',
      'useForm',
    ]) {
      paths.push(`${basePath}/src/hooks/${hookName}.ts`);
    }

    paths.push(
      `${basePath}/public/favicon.ico`,
      `${basePath}/public/robots.txt`,
      `${basePath}/public/manifest.json`
    );
  }

  const directorySet = new Set<string>();
  for (const path of paths) {
    const pathSegments = path.split('/');
    for (let index = 1; index < pathSegments.length; index += 1) {
      directorySet.add(pathSegments.slice(0, index).join('/'));
    }
  }

  return {
    expandedPaths: [...directorySet],
    paths,
  };
}

const virtualizationDemoData = createVirtualizationDemoData();
const virtualizationPreloadedData = preloadFileTree({
  flattenEmptyDirectories: true,
  id: 'trees-virtualization-demo',
  initialExpandedPaths: virtualizationDemoData.expandedPaths,
  paths: virtualizationDemoData.paths,
  viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.virtualization,
});

export function DemoVirtualization() {
  return (
    <DemoVirtualizationClient
      expandedPaths={virtualizationDemoData.expandedPaths}
      paths={virtualizationDemoData.paths}
      preloadedData={virtualizationPreloadedData}
    />
  );
}
