import { baseTreeOptions, GIT_STATUSES_A } from './demo-data';
import { ThemingSectionClient } from './ThemingSectionClient';
import { preloadFileTree, type TreeThemeStyles } from '@/lib/treesCompat';

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
