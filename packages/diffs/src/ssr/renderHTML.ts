import { SVGSpriteSheet } from '../sprite';

export function renderHTML(children: string[]): string {
  return SVGSpriteSheet + children.join('');
}
