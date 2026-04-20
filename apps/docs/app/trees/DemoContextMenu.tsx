import { type ContextMenuTriggerMode } from '@pierre/trees';
import { preloadFileTree } from '@pierre/trees/ssr';

import { sampleFileList } from './demo-data';
import { DemoContextMenuClient } from './DemoContextMenuClient';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';

const CONTEXT_MENU_EXPANDED_PATHS = ['src', 'src/components'] as const;

const CONTEXT_MENU_HEADER_HTML = `
<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;font-size:12px;border-bottom:1px solid color-mix(in oklab, currentColor 18%, transparent);color:var(--trees-fg-muted)">
  <span>Project files</span>
  <span>File tree context menu</span>
</div>
`;

function createContextMenuPreloadedData(
  triggerMode: ContextMenuTriggerMode,
  id: string
) {
  return preloadFileTree({
    composition: {
      contextMenu: {
        enabled: true,
        triggerMode,
      },
      header: {
        html: CONTEXT_MENU_HEADER_HTML,
      },
    },
    flattenEmptyDirectories: true,
    id,
    initialExpandedPaths: CONTEXT_MENU_EXPANDED_PATHS,
    paths: sampleFileList,
    search: false,
    initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.contextMenu / 30,
  });
}

const bothModePreloadedData = createContextMenuPreloadedData(
  'both',
  'file-tree-context-menu-demo-both'
);
const buttonModePreloadedData = createContextMenuPreloadedData(
  'button',
  'file-tree-context-menu-demo-button'
);
const rightClickModePreloadedData = createContextMenuPreloadedData(
  'right-click',
  'file-tree-context-menu-demo-right-click'
);

export function DemoContextMenu() {
  return (
    <DemoContextMenuClient
      preloadedDataById={{
        'file-tree-context-menu-demo-both': bothModePreloadedData,
        'file-tree-context-menu-demo-button': buttonModePreloadedData,
        'file-tree-context-menu-demo-right-click': rightClickModePreloadedData,
      }}
    />
  );
}
