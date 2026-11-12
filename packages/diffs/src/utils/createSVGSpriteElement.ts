import { SVGSpriteSheet } from '../sprite';

const parsedSpriteSheets = new WeakMap<Document, SVGElement>();

// Parsed once per document, cloned per call: much cheaper than re-parsing.
export function createSVGSpriteElement(): SVGElement | undefined {
  let parsed = parsedSpriteSheets.get(document);
  if (parsed == null) {
    const container = document.createElement('div');
    container.innerHTML = SVGSpriteSheet;
    const firstChild = container.firstChild;
    if (!(firstChild instanceof SVGElement)) {
      return undefined;
    }
    firstChild.remove();
    parsed = firstChild;
    parsedSpriteSheets.set(document, parsed);
  }
  return parsed.cloneNode(true) as SVGElement;
}
/**
 * Prerendered HTML carries only the icons its own markup uses (see
 * ssr/renderHTML.ts). Hydration swaps such a partial sheet for the full one,
 * so icons the component renders later (separators, gutter utility, header
 * changes) still resolve.
 */
export function hydrateSVGSpriteElement(element: SVGElement): SVGElement {
  if (!element.hasAttribute('data-icon-sprite-partial')) {
    return element;
  }
  const full = createSVGSpriteElement();
  if (full == null) {
    return element;
  }
  element.replaceWith(full);
  return full;
}
