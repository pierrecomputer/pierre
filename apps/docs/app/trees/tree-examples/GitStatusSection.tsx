import { baseTreeOptions, GIT_STATUSES_A } from './demo-data';
import { GitStatusSectionClient } from './GitStatusSectionClient';
import { preloadFileTree } from '@/lib/treesCompat';

const initialVisibleFiles = baseTreeOptions.initialFiles ?? [];
const prerenderedHTML = preloadFileTree(
  {
    ...baseTreeOptions,
    id: 'path-colors-git-status-demo',
    initialFiles: initialVisibleFiles,
    gitStatus: GIT_STATUSES_A,
  },
  {
    initialExpandedItems: ['src', 'src/components'],
  }
).shadowHtml;

export function GitStatusSection() {
  return <GitStatusSectionClient prerenderedHTML={prerenderedHTML} />;
}
