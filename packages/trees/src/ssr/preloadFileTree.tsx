import { renderToString } from 'preact-render-to-string';

import { Root } from '../components/Root';
import {
  FILE_TREE_STYLE_ATTRIBUTE,
  FILE_TREE_UNSAFE_CSS_ATTRIBUTE,
} from '../constants';
import type { FileTreeOptions, FileTreeStateConfig } from '../FileTree';
import { SVGSpriteSheet } from '../sprite';
import fileTreeStyles from '../style.css';
import { wrapUnsafeCSS } from '../utils/cssWrappers';

let ssrInstanceId = 0;

export type FileTreeSsrPayload = {
  /** The internal instance id used to match SSR markup to the client instance. */
  id: string;
  /** HTML that should be placed INSIDE a declarative shadow DOM <template>. */
  shadowHtml: string;
  /** Full HTML including the <file-tree-container> element with declarative shadow DOM. */
  html: string;
};

export function preloadFileTree(
  fileTreeOptions: FileTreeOptions,
  stateConfig?: FileTreeStateConfig
): FileTreeSsrPayload {
  const id = fileTreeOptions.id ?? `ft_srv_${++ssrInstanceId}`;
  const customSpriteSheet = fileTreeOptions.icons?.spriteSheet?.trim() ?? '';
  const unsafeCSS = fileTreeOptions.unsafeCSS?.trim();
  const unsafeStyle =
    unsafeCSS != null && unsafeCSS.length > 0
      ? `<style ${FILE_TREE_UNSAFE_CSS_ATTRIBUTE}>${wrapUnsafeCSS(unsafeCSS)}</style>`
      : '';
  const shadowHtml = `${SVGSpriteSheet}${customSpriteSheet}<style ${FILE_TREE_STYLE_ATTRIBUTE}>${fileTreeStyles}</style>${unsafeStyle}
<div data-file-tree-id="${id}">
  ${renderToString(<Root fileTreeOptions={{ ...fileTreeOptions, id }} stateConfig={stateConfig} />)}
</div>
`;

  const html = `<file-tree-container id="${id}"><template shadowrootmode="open">${shadowHtml}</template></file-tree-container>`;

  return { id, shadowHtml, html };
}
