import { preloadPathStoreFileTree } from '@pierre/trees/path-store';

import { PathStoreReactDemoClient } from './PathStoreReactDemoClient';

const DEMO_PATHS = [
  'README.md',
  'src/index.ts',
  'src/components/Button.tsx',
  'src/components/Button.test.tsx',
] as const;
const VIEWPORT_HEIGHT = 240;

export default function PathStoreReactPage() {
  const ssrPayload = preloadPathStoreFileTree({
    flattenEmptyDirectories: true,
    id: 'trees-dev-path-store-react-ssr',
    initialExpansion: 'open',
    paths: DEMO_PATHS,
    search: true,
    viewportHeight: VIEWPORT_HEIGHT,
  });

  return (
    <PathStoreReactDemoClient
      paths={DEMO_PATHS}
      preloadedData={ssrPayload}
      viewportHeight={VIEWPORT_HEIGHT}
    />
  );
}
