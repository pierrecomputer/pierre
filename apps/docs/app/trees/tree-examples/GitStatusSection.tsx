import { preloadFileTree } from '@pierre/trees/ssr';

import { baseTreeOptions, GIT_STATUSES_A } from './demo-data';
import { GitStatusSectionClient } from './GitStatusSectionClient';

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
