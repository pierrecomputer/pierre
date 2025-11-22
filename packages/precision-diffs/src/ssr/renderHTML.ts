import type { Element as HASTElement } from 'hast';
import { toHtml } from 'hast-util-to-html';

import { SVGSpriteSheet } from '../sprite';

export function renderHTML(children: HASTElement[]) {
  return `${SVGSpriteSheet}${toHtml(children)}`;
}
