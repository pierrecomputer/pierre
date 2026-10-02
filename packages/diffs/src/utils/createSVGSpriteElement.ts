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
