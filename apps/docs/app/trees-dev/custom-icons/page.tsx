import { preloadFileTree } from '@pierre/trees/ssr';

import { readSettingsCookies } from '../_components/readSettingsCookies';
import {
  customSpriteSheet,
  sharedDemoFileTreeOptions,
  sharedDemoStateConfig,
} from '../demo-data';
import { CustomIconsDemoClient } from './CustomIconsDemoClient';

export default async function CustomIconsPage() {
  const { flattenEmptyDirectories, useLazyDataLoader } =
    await readSettingsCookies();
  const fileTreeOptions = {
    ...sharedDemoFileTreeOptions,
    flattenEmptyDirectories,
    useLazyDataLoader,
  };

  const customIconsSsr = preloadFileTree(
    {
      ...fileTreeOptions,
      icons: {
        spriteSheet: customSpriteSheet,
        remap: {
          'file-tree-icon-file': 'custom-hamburger-icon',
          'file-tree-icon-chevron': {
            name: 'custom-chevron-icon',
            width: 16,
            height: 16,
          },
        },
      },
    },
    sharedDemoStateConfig
  );

  return (
    <CustomIconsDemoClient
      preloadedCustomIconsFileTreeHtml={customIconsSsr.shadowHtml}
    />
  );
}
