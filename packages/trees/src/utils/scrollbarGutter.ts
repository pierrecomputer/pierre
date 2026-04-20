import {
  FILE_TREE_SCROLLBAR_GUTTER_MEASURED_PROPERTY,
  FILE_TREE_SCROLLBAR_GUTTER_STYLE_ATTRIBUTE,
  FILE_TREE_SCROLLBAR_MEASURE_ATTRIBUTE,
} from '../constants';

const measuredGutterCache = new WeakMap<ShadowRoot, number>();

// Measures the scrollbar inside a real tree shadow root. The probe opts into
// the same shared scrollbar selector as the real scroll surface, but carries a
// dedicated attribute so the live DOM stays unchanged.
function measureScrollbarGutter(shadowRoot: ShadowRoot): number | undefined {
  const cachedScrollbarGutter = measuredGutterCache.get(shadowRoot);
  if (cachedScrollbarGutter != null) {
    return cachedScrollbarGutter;
  }

  const wrapper = document.createElement('div');
  wrapper.setAttribute(FILE_TREE_SCROLLBAR_MEASURE_ATTRIBUTE, 'true');
  const child = document.createElement('div');
  child.style.position = 'relative';
  child.style.height = '200%';
  wrapper.appendChild(child);
  shadowRoot.appendChild(wrapper);

  const measuredGutter = Math.max(wrapper.offsetWidth - wrapper.clientWidth, 0);
  wrapper.remove();
  measuredGutterCache.set(shadowRoot, measuredGutter);
  return measuredGutter;
}

// Publishes the measured value as a custom property on the host via a
// shadow-root <style> rule targeting `:host`, rather than writing to the
// host's inline `style` attribute. React hydrates against the host element's
// attributes, so mutating `host.style` before hydration produces a mismatch;
// shadow-root contents are outside React's hydration diff, so updating the
// variable there is safe to do synchronously from connectedCallback.
export function ensureMeasuredScrollbarGutter(
  host: HTMLElement,
  shadowRoot: ShadowRoot
): void {
  if (!host.isConnected) {
    return;
  }

  const measuredScrollbarGutter = measureScrollbarGutter(shadowRoot);
  if (measuredScrollbarGutter == null) {
    return;
  }

  const existing = shadowRoot.querySelector(
    `style[${FILE_TREE_SCROLLBAR_GUTTER_STYLE_ATTRIBUTE}]`
  );
  const styleEl =
    existing instanceof HTMLStyleElement
      ? existing
      : document.createElement('style');
  if (!(existing instanceof HTMLStyleElement)) {
    styleEl.setAttribute(FILE_TREE_SCROLLBAR_GUTTER_STYLE_ATTRIBUTE, '');
    shadowRoot.appendChild(styleEl);
  }
  styleEl.textContent = `:host { ${FILE_TREE_SCROLLBAR_GUTTER_MEASURED_PROPERTY}: ${measuredScrollbarGutter}px; }`;
}
