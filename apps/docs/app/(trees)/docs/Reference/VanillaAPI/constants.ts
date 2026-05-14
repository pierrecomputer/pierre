import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const VANILLA_API_EXAMPLE = docsCodeSnippet(
  'vanilla-api.ts',
  `import { FileTree } from '@pierre/trees';

const fileTree = new FileTree({
  paths: ['README.md', 'src/index.ts'],
  search: true,
});

fileTree.render({ fileTreeContainer: container });`
);

export const VANILLA_EXTERNAL_SCROLL_EXAMPLE = docsCodeSnippet(
  'external-scroll-source.ts',
  `import { FileTree, createDomScrollSource } from '@pierre/trees/scroll';

const source = createDomScrollSource({
  scrollContainer: scroller,
  topInset: () => toolbar.getBoundingClientRect().height,
});

const tree = new FileTree({
  paths,
  stickyFolders: true,
  externalScroll: {
    initialSnapshot: source.getSnapshot(),
    source,
  },
});

tree.render({ containerWrapper: mount });
const host = tree.getFileTreeContainer();
source.setHost(host ?? null);

function disposeTree() {
  source.destroy();
  tree.cleanUp();
}`
);
