import type { Element } from 'hast';
import { toHtml } from 'hast-util-to-html';

import { SVGSpriteSheet } from '../sprite';

export function renderHTML(children: Element[]) {
  return `${SVGSpriteSheet}${toHtml(children)}`;
}
