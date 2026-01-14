import { renderToString } from 'preact-render-to-string';

import type { FileTree } from '../components/FileTree';
import { TestFileTree } from '../components/TestFileTree';
import { SVGSpriteSheet } from '../sprite';
import fileTreeStyles from '../style.css';

// TODO: this is crude for now
// needs options and unsafe css etc
export function preloadFileTree<T>(fileTree: FileTree<T>): string {
  return `${SVGSpriteSheet}<style>${fileTreeStyles}</style>
<div data-file-tree-id="${fileTree.__id}" data-dehydrated>
  ${fileTree.generateFileTreeFake()}
</div>
<div data-file-tree-test-id="${fileTree.__id}">
  ${renderToString(<TestFileTree />)}
</div>
`;
}
