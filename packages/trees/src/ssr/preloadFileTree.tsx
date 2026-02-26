import { renderToString } from 'preact-render-to-string';

import { Root } from '../components/Root';
import type { FileTreeOptions, FileTreeStateConfig } from '../FileTree';
import { SVGSpriteSheet } from '../sprite';
import fileTreeStyles from '../style.css';

let ssrInstanceId = 0;

export type FileTreeSsrPayload = {
  /** The internal instance id used to match SSR markup to the client instance. */
  id: string;
  /** HTML that should be placed INSIDE a declarative shadow DOM <template>. */
  shadowHtml: string;
  /** Full HTML including the <file-tree-container> element with declarative shadow DOM. */
  html: string;
};

const STYLE_MARKER_ATTR = 'data-file-tree-style';

export function preloadFileTree(
  fileTreeOptions: FileTreeOptions,
  stateConfig?: FileTreeStateConfig
): FileTreeSsrPayload {
  const id = fileTreeOptions.id ?? `ft_srv_${++ssrInstanceId}`;
  const customSpriteSheet = fileTreeOptions.icons?.spriteSheet?.trim() ?? '';
  const shadowHtml = `${SVGSpriteSheet}${customSpriteSheet}<style ${STYLE_MARKER_ATTR}>${fileTreeStyles}</style>
<div data-file-tree-id="${id}">
  ${renderToString(<Root fileTreeOptions={{ ...fileTreeOptions, id }} stateConfig={stateConfig} />)}
</div>
`;

  const html = `<file-tree-container id="${id}"><template shadowrootmode="open">${shadowHtml}</template></file-tree-container>`;

  return { id, shadowHtml, html };
}
