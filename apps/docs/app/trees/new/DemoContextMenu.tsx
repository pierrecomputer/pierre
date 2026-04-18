import {
  type PathStoreTreesContextMenuTriggerMode,
  preloadPathStoreFileTree,
} from '@pierre/trees/path-store';

import { sampleFileList } from '../demo-data';
import { DemoContextMenuClient } from './DemoContextMenuClient';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';

const CONTEXT_MENU_EXPANDED_PATHS = ['src', 'src/components'] as const;

const CONTEXT_MENU_HEADER_HTML = `
<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;font-size:12px;border-bottom:1px solid color-mix(in oklab, currentColor 18%, transparent);color:var(--trees-fg-muted)">
  <span>Project files</span>
  <span>Path-store context menu</span>
</div>
`;

function createContextMenuPreloadedData(
  triggerMode: PathStoreTreesContextMenuTriggerMode,
  id: string
) {
  return preloadPathStoreFileTree({
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
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.contextMenu,
  });
}

const bothModePreloadedData = createContextMenuPreloadedData(
  'both',
  'path-store-context-menu-demo-both'
);
const buttonModePreloadedData = createContextMenuPreloadedData(
  'button',
  'path-store-context-menu-demo-button'
);
const rightClickModePreloadedData = createContextMenuPreloadedData(
  'right-click',
  'path-store-context-menu-demo-right-click'
);

export function DemoContextMenu() {
  return (
    <DemoContextMenuClient
      preloadedDataById={{
        'path-store-context-menu-demo-both': bothModePreloadedData,
        'path-store-context-menu-demo-button': buttonModePreloadedData,
        'path-store-context-menu-demo-right-click': rightClickModePreloadedData,
      }}
    />
  );
}
