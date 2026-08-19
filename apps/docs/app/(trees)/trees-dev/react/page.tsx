import { preloadFileTree } from '@pierre/trees/ssr';

import { readSettingsCookies } from '../_components/readSettingsCookies';
import { ReactDemoClient } from '../_demos/ReactDemoClient';
import { pageMetadata } from '@/lib/page-metadata';

export const metadata = pageMetadata({
  title: 'React API demo — Pierre Trees',
  description:
    'The @pierre/trees React component rendering a server-prepared file tree, hydrating from SSR markup with search enabled and no flash of unstyled rows.',
  path: '/trees-dev/react',
});

const DEMO_PATHS = [
  'README.md',
  'src/index.ts',
  'src/components/Button.tsx',
  'src/components/Button.test.tsx',
  ...Array.from(
    { length: 28 },
    (_, index) =>
      `src/components/feature-${String(index + 1).padStart(2, '0')}.ts`
  ),
] satisfies readonly string[];
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
