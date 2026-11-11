import type { Element as HASTElement } from 'hast';

import { SVGSpriteSheet } from '../sprite';
import { hastToHtml } from '../utils/hastToHtml';

const SPRITE_SYMBOLS = new Map(
  Array.from(
    SVGSpriteSheet.matchAll(/<symbol id="([^"]+)"[\s\S]*?<\/symbol>/g),
    ([symbol, id]) => [id, symbol]
  )
);

export function renderHTML(children: HASTElement[]) {
  const html = hastToHtml(children);
  return `${getSpriteSheetForHTML(html)}${html}`;
}

/**
 * Builds a sprite sheet with only the icons this markup references, instead of
 * every icon (about 16 KB): prerendered HTML repeats the sheet in each file's
 * shadow root. It is marked partial so hydration swaps in the full sheet
 * (hydrateSVGSpriteElement).
 */
function getSpriteSheetForHTML(html: string): string {
  let symbols = '';
  const used = new Set<string>();
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) {
    const symbol = SPRITE_SYMBOLS.get(id);
    if (symbol != null && !used.has(id)) {
      used.add(id);
      symbols += symbol;
    }
  }
  return `<svg data-icon-sprite data-icon-sprite-partial aria-hidden="true" width="0" height="0">${symbols}</svg>`;
}
