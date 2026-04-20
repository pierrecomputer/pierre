import {
  FILE_TREE_SCROLLBAR_GUTTER_MEASURED_PROPERTY,
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

  host.style.setProperty(
    FILE_TREE_SCROLLBAR_GUTTER_MEASURED_PROPERTY,
    `${measuredScrollbarGutter}px`
  );
}
