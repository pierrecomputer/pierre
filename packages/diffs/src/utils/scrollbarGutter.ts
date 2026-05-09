import {
  DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY,
  DIFFS_SCROLLBAR_MEASURE_ATTRIBUTE,
} from '../constants';

let measuredScrollbarGutter: number | undefined;

// Measures the horizontal scrollbar used by `[data-code]` once per page. The
// hidden probe opts into the same selector as real code panes so custom
// scrollbar CSS is reflected in the measured value.
export function getMeasuredScrollbarGutter(
  shadowRoot: ShadowRoot
): number | undefined {
  if (measuredScrollbarGutter != null) {
    return measuredScrollbarGutter;
  }

  const host = shadowRoot.host;
  if (
    typeof HTMLElement !== 'undefined' &&
    host instanceof HTMLElement &&
    !host.isConnected
  ) {
    return undefined;
  }

  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-code', '');
  wrapper.setAttribute(DIFFS_SCROLLBAR_MEASURE_ATTRIBUTE, 'true');

  const child = document.createElement('div');
  child.style.position = 'relative';
  child.style.width = '200%';
  child.style.height = '200%';
  wrapper.appendChild(child);

  shadowRoot.appendChild(wrapper);
  measuredScrollbarGutter = Math.max(
    wrapper.offsetHeight - wrapper.clientHeight,
    0
  );
  wrapper.remove();
  return measuredScrollbarGutter;
}

export function createMeasuredScrollbarGutterDeclaration(
  scrollbarGutter: number | undefined
): string {
  const value =
    scrollbarGutter == null
      ? 'var(--diffs-scrollbar-gutter-fallback)'
      : `${scrollbarGutter}px`;
  return `${DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY}: ${value};`;
}
