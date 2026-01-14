import type { SVGSpriteNames } from '../sprite';

export function iconHtml(name: SVGSpriteNames): string {
  return `<svg viewBox="0 0 16 16" width="16" height="16">
    <use href="#${name.replace(/^#/, '')}" />
  </svg>`;
}
