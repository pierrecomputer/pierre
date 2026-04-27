import { ghFixture } from '@pierre/tree-test-data';

import { readSettingsCookies } from '../_components/readSettingsCookies';
import { GhFixtureDemoClient } from '../_demos/GhFixtureDemoClient';

export default async function TreesDevGhFixturePage() {
  const { flattenEmptyDirectories } = await readSettingsCookies();

  return (
    <GhFixtureDemoClient
      flattenEmptyDirectories={flattenEmptyDirectories}
      source={ghFixture}
    />
  );
}
