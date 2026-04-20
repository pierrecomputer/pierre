import {
  preloadFileTree,
  serializeFileTreeSsrPayload,
} from '@pierre/trees/ssr';

import { readSettingsCookies } from '../_components/readSettingsCookies';
import { DragAndDropDemoClient } from '../_demos/DragAndDropDemoClient';
import { createPresortedPreparedInput } from '../_lib/createPresortedPreparedInput';
import type { FileTreePathOptions } from '@/lib/fileTreePathOptions';

const DRAG_AND_DROP_DEMO_PATHS = [
  'assets/images/social/banner.png',
  'assets/images/social/logo.png',
  'docs/guides/faq.md',
  'docs/guides/getting-started.md',
  'src/components/Button.tsx',
  'src/lib/theme.ts',
  'src/lib/utils.ts',
  'src/index.ts',
  ...Array.from(
    { length: 40 },
    (_, index) => `workspace/demo-${String(index).padStart(2, '0')}.ts`
  ),
  'package.json',
  'README.md',
] as const;

const DRAG_AND_DROP_PREPARED_INPUT = createPresortedPreparedInput(
  DRAG_AND_DROP_DEMO_PATHS
);
const TREE_HEADER_HTML =
  '<div data-tree-demo-header style="align-items:center;display:flex;gap:12px;padding:8px 12px"><strong>Drag and drop demo</strong><span>Pointer + touch moves on the canonical tree</span></div>';

export default async function TreesDevDragAndDropPage() {
  const { flattenEmptyDirectories } = await readSettingsCookies();
  const sharedOptions: Omit<FileTreePathOptions, 'dragAndDrop' | 'id'> = {
    composition: {
      header: {
        html: TREE_HEADER_HTML,
      },
    },
    flattenEmptyDirectories,
    fileTreeSearchMode: 'hide-non-matches',
    initialExpandedPaths: [
      'assets/images/social/',
      'docs/guides/',
      'src/',
      'src/lib/',
      'workspace/',
    ],
    paths: DRAG_AND_DROP_PREPARED_INPUT.paths,
    preparedInput: DRAG_AND_DROP_PREPARED_INPUT,
    search: true,
    viewportHeight: 460,
  };

  const payload = preloadFileTree({
    ...sharedOptions,
    dragAndDrop: true,
    id: 'trees-drag-and-drop',
  });

  return (
    <DragAndDropDemoClient
      containerHtml={serializeFileTreeSsrPayload(payload, 'dom')}
      sharedOptions={sharedOptions}
    />
  );
}
