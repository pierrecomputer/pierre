import { renderToString } from 'preact-render-to-string';

import { Root } from '../components/Root';
import type { FileTreeOptions } from '../FileTree';
import { SVGSpriteSheet } from '../sprite';
import fileTreeStyles from '../style.css';

// TODO: this is crude for now
// needs options and unsafe css etc
export function preloadFileTree(fileTreeOptions: FileTreeOptions): string {
  return `${SVGSpriteSheet}<style>${fileTreeStyles}</style>
<div data-file-tree-id="ft_srv_4">
  ${renderToString(<Root fileTreeOptions={fileTreeOptions} />)}
</div>
`;
}
