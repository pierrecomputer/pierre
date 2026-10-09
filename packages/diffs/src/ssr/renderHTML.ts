import type { Element as HASTElement } from 'hast';

import { SVGSpriteSheet } from '../sprite';
import { hastToHtml } from '../utils/hastToHtml';

export function renderHTML(children: HASTElement[]) {
  return `${SVGSpriteSheet}${hastToHtml(children)}`;
}
