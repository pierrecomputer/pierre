import {
  type PathStoreFileTreeOptions,
  preloadPathStoreFileTree,
} from '@pierre/trees/path-store';

import { createPresortedPreparedInput } from '../path-store-powered/createPresortedPreparedInput';
import { PathStoreDragAndDropDemoClient } from './PathStoreDragAndDropDemoClient';

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
const PATH_STORE_DRAG_HEADER_HTML =
  '<div data-path-store-demo-header style="align-items:center;display:flex;gap:12px;padding:8px 12px"><strong>Phase 10 path-store drag and drop</strong><span>Pointer + touch, path-store-native moves</span></div>';

export default function PathStoreDragAndDropPage() {
  const sharedOptions: Omit<PathStoreFileTreeOptions, 'dragAndDrop' | 'id'> = {
    composition: {
      header: {
        html: PATH_STORE_DRAG_HEADER_HTML,
      },
    },
    flattenEmptyDirectories: true,
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

  const payload = preloadPathStoreFileTree({
    ...sharedOptions,
    dragAndDrop: true,
    id: 'pst-phase10-dnd',
  });

  return (
    <PathStoreDragAndDropDemoClient
      containerHtml={payload.html}
      sharedOptions={sharedOptions}
    />
  );
}
