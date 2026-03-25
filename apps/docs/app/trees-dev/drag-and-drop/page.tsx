import { preloadFileTree } from '@pierre/trees/ssr';

import { readSettingsCookies } from '../_components/readSettingsCookies';
import { sharedDemoFileTreeOptions, sharedDemoStateConfig } from '../demo-data';
import { DragAndDropDemoClient } from './DragAndDropDemoClient';

export default async function DragAndDropPage() {
  const { flattenEmptyDirectories, useLazyDataLoader } =
    await readSettingsCookies();
  const fileTreeOptions = {
    ...sharedDemoFileTreeOptions,
    flattenEmptyDirectories,
    useLazyDataLoader,
  };

  const mainSsr = preloadFileTree(fileTreeOptions, sharedDemoStateConfig);

  return <DragAndDropDemoClient preloadedFileTreeHtml={mainSsr.shadowHtml} />;
}
