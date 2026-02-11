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
};

const STYLE_MARKER_ATTR = 'data-file-tree-style';

export function createFileTreeSsrPayload(
  fileTreeOptions: FileTreeOptions,
  stateConfig?: FileTreeStateConfig
): FileTreeSsrPayload {
  const id = fileTreeOptions.id ?? `ft_srv_${++ssrInstanceId}`;
  const shadowHtml = `${SVGSpriteSheet}<style ${STYLE_MARKER_ATTR}>${fileTreeStyles}</style>
<div data-file-tree-id="${id}">
  ${renderToString(<Root fileTreeOptions={{ ...fileTreeOptions, id }} stateConfig={stateConfig} />)}
</div>
`;

  return { id, shadowHtml };
}

/**
 * Legacy helper returning only the shadow DOM HTML.
 * Prefer `createFileTreeSsrPayload()` so you can reuse the generated `id`.
 */
export function preloadFileTree(
  fileTreeOptions: FileTreeOptions,
  stateConfig?: FileTreeStateConfig
): string {
  return createFileTreeSsrPayload(fileTreeOptions, stateConfig).shadowHtml;
}
