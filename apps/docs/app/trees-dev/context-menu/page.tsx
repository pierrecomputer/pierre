import { preloadFileTree } from '@pierre/trees/ssr';

import { readSettingsCookies } from '../_components/readSettingsCookies';
import { sharedDemoFileTreeOptions, sharedDemoStateConfig } from '../demo-data';
import { ContextMenuDemoClient } from './ContextMenuDemoClient';

export default async function ContextMenuPage() {
  const { flattenEmptyDirectories, useLazyDataLoader } =
    await readSettingsCookies();
  const fileTreeOptions = {
    ...sharedDemoFileTreeOptions,
    flattenEmptyDirectories,
    useLazyDataLoader,
  };

  const noop = () => {};
  const contextMenuSsr = preloadFileTree(fileTreeOptions, {
    ...sharedDemoStateConfig,
    onContextMenuOpen: noop,
    onContextMenuClose: noop,
  });

  return (
    <ContextMenuDemoClient
      preloadedContextMenuFileTreeHtml={contextMenuSsr.shadowHtml}
      preloadedContextMenuFileTreeContainerHtml={contextMenuSsr.html}
    />
  );
}
