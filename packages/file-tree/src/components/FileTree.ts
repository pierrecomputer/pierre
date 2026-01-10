import {
  type ItemInstance,
  type TreeConfig,
  type TreeInstance,
  createTree,
  syncDataLoaderFeature,
} from '@headless-tree/core';

import { FILE_TREE_TAG_NAME } from '../constants';
import { FileTreeContainerLoaded } from './web-components';

let instanceId = -1;

export type DemoItem = {
  name: string;
  children?: string[];
};

const sampleTree: Record<string, DemoItem> = {
  root: {
    name: 'pierrejs',
    children: ['packages', 'apps', 'scripts', 'github'],
  },
  packages: {
    name: 'packages',
    children: [
      'file-tree',
      'diffs',
      'storage-elements',
      'storage-elements-next',
    ],
  },
  'file-tree': {
    name: 'file-tree',
    children: ['file-tree-src', 'file-tree-package'],
  },
  'file-tree-src': {
    name: 'src',
    children: [
      'file-tree-components',
      'file-tree-react',
      'file-tree-constants',
    ],
  },
  'file-tree-components': {
    name: 'components',
    children: ['file-tree-ts', 'file-tree-web-components'],
  },
  'file-tree-ts': { name: 'FileTree.ts' },
  'file-tree-web-components': { name: 'web-components.ts' },
  'file-tree-react': {
    name: 'react',
    children: ['file-tree-react-tsx', 'file-tree-utils'],
  },
  'file-tree-react-tsx': { name: 'FileTree.tsx' },
  'file-tree-utils': {
    name: 'utils',
    children: ['file-tree-use-instance', 'file-tree-use-callback'],
  },
  'file-tree-use-instance': { name: 'useFileTreeInstance.ts' },
  'file-tree-use-callback': { name: 'useStableCallback.ts' },
  'file-tree-constants': { name: 'constants.ts' },
  'file-tree-package': { name: 'package.json' },
  diffs: {
    name: 'diffs',
    children: ['diffs-src', 'diffs-test'],
  },
  'diffs-src': {
    name: 'src',
    children: ['diffs-core', 'diffs-components'],
  },
  'diffs-core': {
    name: 'core',
    children: ['diffs-tree', 'diffs-loader'],
  },
  'diffs-tree': { name: 'tree.ts' },
  'diffs-loader': { name: 'loader.ts' },
  'diffs-components': {
    name: 'components',
    children: ['diffs-diff', 'diffs-patch'],
  },
  'diffs-diff': { name: 'Diff.tsx' },
  'diffs-patch': { name: 'Patch.tsx' },
  'diffs-test': {
    name: 'test',
    children: ['diffs-test-snapshots'],
  },
  'diffs-test-snapshots': { name: 'snapshots' },
  'storage-elements': {
    name: 'storage-elements',
    children: ['storage-blocks', 'storage-components', 'storage-lib'],
  },
  'storage-blocks': {
    name: 'blocks',
    children: ['storage-block-auth', 'storage-block-repo'],
  },
  'storage-block-auth': { name: 'AuthBlock.tsx' },
  'storage-block-repo': { name: 'RepoBlock.tsx' },
  'storage-components': {
    name: 'components',
    children: ['storage-button', 'storage-input', 'storage-modal'],
  },
  'storage-button': { name: 'Button.tsx' },
  'storage-input': { name: 'Input.tsx' },
  'storage-modal': { name: 'Modal.tsx' },
  'storage-lib': {
    name: 'lib',
    children: ['storage-utils'],
  },
  'storage-utils': { name: 'utils.ts' },
  'storage-elements-next': {
    name: 'storage-elements-next',
    children: ['storage-next-src'],
  },
  'storage-next-src': {
    name: 'src',
    children: ['storage-next-auth', 'storage-next-github', 'storage-next-repo'],
  },
  'storage-next-auth': {
    name: 'auth',
    children: ['storage-next-auth-callback'],
  },
  'storage-next-auth-callback': { name: 'success-callback.ts' },
  'storage-next-github': {
    name: 'github',
    children: ['storage-next-github-installations'],
  },
  'storage-next-github-installations': { name: 'installations.ts' },
  'storage-next-repo': {
    name: 'repo',
    children: ['storage-next-repo-route'],
  },
  'storage-next-repo-route': { name: 'route.ts' },
  apps: {
    name: 'apps',
    children: ['docs', 'demo'],
  },
  docs: {
    name: 'docs',
    children: ['docs-app', 'docs-components', 'docs-lib'],
  },
  'docs-app': {
    name: 'app',
    children: ['docs-file-tree', 'docs-diff-examples', 'docs-api'],
  },
  'docs-file-tree': {
    name: 'file-tree',
    children: ['docs-file-tree-client', 'docs-file-tree-page'],
  },
  'docs-file-tree-client': { name: 'ClientPage.tsx' },
  'docs-file-tree-page': { name: 'page.tsx' },
  'docs-diff-examples': {
    name: 'diff-examples',
    children: ['docs-diff-basic', 'docs-diff-advanced'],
  },
  'docs-diff-basic': { name: 'BasicDiff.tsx' },
  'docs-diff-advanced': { name: 'AdvancedDiff.tsx' },
  'docs-api': {
    name: 'api',
    children: ['docs-api-code-storage'],
  },
  'docs-api-code-storage': {
    name: 'code-storage',
    children: ['docs-api-github', 'docs-api-repo'],
  },
  'docs-api-github': {
    name: 'github',
    children: ['docs-api-github-route'],
  },
  'docs-api-github-route': { name: 'route.ts' },
  'docs-api-repo': {
    name: 'repo',
    children: ['docs-api-repo-route'],
  },
  'docs-api-repo-route': { name: 'route.ts' },
  'docs-components': {
    name: 'components',
    children: ['docs-components-ui', 'docs-components-layout'],
  },
  'docs-components-ui': {
    name: 'ui',
    children: ['docs-ui-button', 'docs-ui-card'],
  },
  'docs-ui-button': { name: 'Button.tsx' },
  'docs-ui-card': { name: 'Card.tsx' },
  'docs-components-layout': {
    name: 'layout',
    children: ['docs-layout-header', 'docs-layout-sidebar'],
  },
  'docs-layout-header': { name: 'Header.tsx' },
  'docs-layout-sidebar': { name: 'Sidebar.tsx' },
  'docs-lib': {
    name: 'lib',
    children: ['docs-lib-mdx', 'docs-lib-utils'],
  },
  'docs-lib-mdx': { name: 'mdx.tsx' },
  'docs-lib-utils': { name: 'utils.ts' },
  demo: {
    name: 'demo',
    children: ['demo-src', 'demo-config'],
  },
  'demo-src': {
    name: 'src',
    children: ['demo-components', 'demo-mocks', 'demo-utils'],
  },
  'demo-components': {
    name: 'components',
    children: ['demo-app', 'demo-file-stream'],
  },
  'demo-app': { name: 'App.tsx' },
  'demo-file-stream': { name: 'FileStream.tsx' },
  'demo-mocks': {
    name: 'mocks',
    children: ['demo-mock-diff', 'demo-mock-example'],
  },
  'demo-mock-diff': { name: 'diff.patch' },
  'demo-mock-example': { name: 'example_ts.txt' },
  'demo-utils': {
    name: 'utils',
    children: ['demo-utils-stream', 'demo-utils-worker'],
  },
  'demo-utils-stream': { name: 'createFakeContentStream.ts' },
  'demo-utils-worker': { name: 'createWorkerAPI.ts' },
  'demo-config': { name: 'vite.config.ts' },
  scripts: {
    name: 'scripts',
    children: ['scripts-build-icons', 'scripts-build-sprite'],
  },
  'scripts-build-icons': { name: 'build-icons.js' },
  'scripts-build-sprite': { name: 'build-sprite.js' },
  github: {
    name: '.github',
    children: ['github-workflows', 'github-templates'],
  },
  'github-workflows': {
    name: 'workflows',
    children: ['github-ci'],
  },
  'github-ci': { name: 'ci.yml' },
  'github-templates': {
    name: 'ISSUE_TEMPLATE',
    children: ['github-bug', 'github-feature'],
  },
  'github-bug': { name: 'bug_report.yml' },
  'github-feature': { name: 'feature_request.yml' },
};

export const syncDataLoader = {
  getItem: (id: string): DemoItem => sampleTree[id],
  getChildren: (id: string): string[] => sampleTree[id]?.children ?? [],
};

export type FileTreeItem<T> = ItemInstance<T>;
export interface FileTreeRenderProps {
  fileTreeContainer?: HTMLElement;
  containerWrapper?: HTMLElement;
}

export interface FileTreeHydrationProps {
  fileTreeContainer: HTMLElement;
  prerenderedHTML?: string;
}

export interface FileTreeOptions<T> {
  // probably change the name here once i know a better one
  config: Omit<TreeConfig<T>, 'features'>;
}

export class FileTree<T> {
  static LoadedCustomComponent: boolean = FileTreeContainerLoaded;

  readonly __id: number = ++instanceId;
  private fileTreeContainer: HTMLElement | undefined;
  private divWrapper: HTMLDivElement | undefined;
  private tree: TreeInstance<T> | undefined;

  constructor(public options: FileTreeOptions<T>) {
    if (typeof document !== 'undefined') {
      this.fileTreeContainer = document.createElement(FILE_TREE_TAG_NAME);
    }
    const createTreeOptions = {
      ...options.config,
      features: [syncDataLoaderFeature],
    };
    this.tree = createTree(createTreeOptions);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setOptions(options: FileTreeOptions<T>): void {
    // todo
  }

  private getOrCreateFileTreeContainer(
    fileTreeContainer?: HTMLElement,
    parentNode?: HTMLElement
  ): HTMLElement {
    this.fileTreeContainer =
      fileTreeContainer ??
      this.fileTreeContainer ??
      document.createElement(FILE_TREE_TAG_NAME);
    if (
      parentNode != null &&
      this.fileTreeContainer.parentNode !== parentNode
    ) {
      parentNode.appendChild(this.fileTreeContainer);
    }
    return this.fileTreeContainer;
  }

  getFileTreeContainer(): HTMLElement | undefined {
    return this.fileTreeContainer;
  }

  private getOrCreateDivWrapperNode(container: HTMLElement): HTMLElement {
    // If we haven't created a pre element yet, lets go ahead and do that
    if (this.divWrapper == null) {
      this.divWrapper = document.createElement('div');
      this.divWrapper.id = `file-tree-div-wrapper-${this.__id}`;
      container.shadowRoot?.appendChild(this.divWrapper);
    }
    // If we have a new parent container for the pre element, lets go ahead and
    // move it into the new container
    else if (this.divWrapper.parentNode !== container) {
      container.shadowRoot?.appendChild(this.divWrapper);
    }
    return this.divWrapper;
  }

  render({ fileTreeContainer, containerWrapper }: FileTreeRenderProps): void {
    if (this.tree == null) {
      throw new Error('FileTree: Tree is not initialized');
    }

    fileTreeContainer = this.getOrCreateFileTreeContainer(
      fileTreeContainer,
      containerWrapper
    );
    const divWrapper = this.getOrCreateDivWrapperNode(fileTreeContainer);
    const output = this.generateFileTreeFake();
    console.log(
      'tree render',
      this.__id,
      this.tree.getItems().map((item) => item.getItemData())
    );
    divWrapper.innerHTML = output;
  }

  hydrate({
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    fileTreeContainer,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    prerenderedHTML,
  }: FileTreeHydrationProps): void {
    // todo
  }

  cleanUp(): void {
    // todo
  }

  generateFileTreeFake(subtreeId?: string): string {
    if (this.tree == null) {
      throw new Error('FileTree: Tree is not initialized');
    }
    // idk if these should be here, but works for now.
    // maybe they should be in 'hydrate'? but not totally sure.
    // maybe it should get called here but only once unless unmounted?
    this.tree.setMounted(true);
    this.tree.rebuildTree();
    const subtree =
      subtreeId != null
        ? this.tree.getItemInstance(subtreeId).getChildren()
        : this.tree.getItems();
    const items = subtree.map((item) => item.getItemData());
    const listHtml = items
      ?.map((item: any) => `<li>${item.name}</li>`)
      .join('');
    return `<ul>${listHtml}</ul>`;
  }
}
