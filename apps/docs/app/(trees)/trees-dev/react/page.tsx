import { preloadFileTree } from '@pierre/trees/ssr';

import { readSettingsCookies } from '../_components/readSettingsCookies';
import { ReactDemoClient } from '../_demos/ReactDemoClient';

const DEMO_PATHS = [
  'README.md',
  'src/index.ts',
  'src/components/Button.tsx',
  'src/components/Button.test.tsx',
] as const;
const VIEWPORT_HEIGHT = 240;

export default async function TreesDevReactPage() {
  const { flattenEmptyDirectories } = await readSettingsCookies();
  const ssrPayload = preloadFileTree({
    flattenEmptyDirectories,
    id: 'trees-dev-react-ssr',
    initialExpansion: 'open',
    paths: DEMO_PATHS,
    search: true,
    initialVisibleRowCount: VIEWPORT_HEIGHT / 30,
  });

  return (
    <ReactDemoClient
      flattenEmptyDirectories={flattenEmptyDirectories}
      paths={DEMO_PATHS}
      preloadedData={ssrPayload}
      viewportHeight={VIEWPORT_HEIGHT}
    />
  );
}
