import { preloadFileTree } from '@pierre/trees/ssr';

import { readSettingsCookies } from '../_components/readSettingsCookies';
import { sharedDemoFileTreeOptions, sharedDemoStateConfig } from '../demo-data';
import { StateDemoClient } from './StateDemoClient';

export default async function StatePage() {
  const { flattenEmptyDirectories, useLazyDataLoader } =
    await readSettingsCookies();
  const fileTreeOptions = {
    ...sharedDemoFileTreeOptions,
    flattenEmptyDirectories,
    useLazyDataLoader,
  };

  const mainSsr = preloadFileTree(fileTreeOptions, sharedDemoStateConfig);
  const controlledSsr = preloadFileTree(fileTreeOptions, {
    ...sharedDemoStateConfig,
    initialSelectedItems: ['Build/assets/images/social/logo.png'],
  });

  return (
    <StateDemoClient
      preloadedFileTreeHtml={mainSsr.shadowHtml}
      preloadedFileTreeContainerHtml={mainSsr.html}
      preloadedControlledFileTreeHtml={controlledSsr.shadowHtml}
    />
  );
}
