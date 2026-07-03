import {
  CODE_VIEW_FOOTER_ATTRIBUTE,
  CODE_VIEW_HEADER_ATTRIBUTE,
} from '../constants';

// Create, style, position, and observe a header/footer host element. `flow-root`
// gives it a block formatting context so the caller's content margins stay
// inside it, keeping measurement / ResizeObserver heights accurate.
export function createCodeViewHeaderFooterHostElement(
  type: 'header' | 'footer',
  container: HTMLDivElement,
  resizeObserver?: ResizeObserver
): HTMLDivElement {
  const element = document.createElement('div');
  element.style.display = 'flow-root';
  if (type === 'header') {
    element.setAttribute(CODE_VIEW_HEADER_ATTRIBUTE, '');
    container.before(element);
  } else {
    element.setAttribute(CODE_VIEW_FOOTER_ATTRIBUTE, '');
    container.after(element);
  }
  resizeObserver?.observe(element);
  return element;
}
