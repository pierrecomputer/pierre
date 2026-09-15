import { SVGSpriteSheet } from '../sprite';
import type { HElement } from '../types';
import { toHtml } from '../utils/html';

export function renderHTML(children: HElement[]) {
  return `${SVGSpriteSheet}${toHtml(children)}`;
}
