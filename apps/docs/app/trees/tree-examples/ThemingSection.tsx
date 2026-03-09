import type { TreeThemeStyles } from '@pierre/trees';
import { preloadFileTree } from '@pierre/trees/ssr';

import { baseTreeOptions, GIT_STATUSES_A } from './demo-data';
import { ThemingSectionClient } from './ThemingSectionClient';

const prerenderedHTML = preloadFileTree(
  {
    ...baseTreeOptions,
    id: 'shiki-themes-tree',
    gitStatus: GIT_STATUSES_A,
  },
  {
    initialExpandedItems: ['src', 'src/components'],
    initialSelectedItems: ['package.json'],
  }
).shadowHtml;

const initialThemeStyles: TreeThemeStyles = {
  colorScheme: 'light',
};

export function ThemingSection() {
  return (
    <ThemingSectionClient
      prerenderedHTML={prerenderedHTML}
      initialThemeStyles={initialThemeStyles}
    />
  );
}
