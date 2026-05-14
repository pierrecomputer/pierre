import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const REACT_API_EXAMPLE = docsCodeSnippet(
  'project-tree.tsx',
  `import { FileTree, useFileTree } from '@pierre/trees/react';

export function ProjectTree({ paths }: { paths: readonly string[] }) {
  const { model } = useFileTree({ paths, search: true });
  return <FileTree model={model} />;
}`
);

export const REACT_API_SELECTOR_HOOKS = docsCodeSnippet(
  'selector-hooks.tsx',
  `const { model } = useFileTree({ paths, search: true });
const selectedPaths = useFileTreeSelection(model);
const search = useFileTreeSearch(model);
const focusedPath = useFileTreeSelector(model, (currentModel) =>
  currentModel.getFocusedPath()
);`
);

export const REACT_EXTERNAL_SCROLL_EXAMPLE = docsCodeSnippet(
  'external-scroll-react.tsx',
  `import {
  FileTree as ScrollFileTree,
  createDomScrollSource,
} from '@pierre/trees/scroll';
import { FileTree } from '@pierre/trees/react';

const hostRef = useRef<HTMLElement>(null);
const source = useMemo(
  () => createDomScrollSource({ scrollContainer: parentScroller }),
  [parentScroller]
);
const model = useMemo(
  () =>
    new ScrollFileTree({
      paths,
      stickyFolders: true,
      externalScroll: { initialSnapshot: source.getSnapshot() },
    }),
  [paths, source]
 );

useEffect(
  () => () => {
    model.cleanUp();
    source.destroy();
  },
  [model, source]
 );

useLayoutEffect(() => {
  source.setHost(hostRef.current);
  model.setExternalScrollSource(source);
  return () => model.setExternalScrollSource(undefined);
}, [model, source]);

return <FileTree ref={hostRef} model={model} />;`
);
