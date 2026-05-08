export type ScrollbarGutterSize = {
  vertical: number;
  horizontal: number;
};

const cachedGutterSizes = new Map<string, ScrollbarGutterSize>();

export function getGutterSize(
  className: string
): ScrollbarGutterSize | undefined {
  return cachedGutterSizes.get(className);
}

const PROBE_SIZE = 100;
const PROBE_CHILD_SIZE = PROBE_SIZE * 2;

/**
 * Measures the scrollbar gutter used by a class by rendering an offscreen
 * scrollable probe, then caches the result for later lookups.
 */
export function detectGutterSize(
  className: string,
  ignoreCache = false
): ScrollbarGutterSize {
  const cached = cachedGutterSizes.get(className);
  if (!ignoreCache && cached != null) {
    return cached;
  }

  const probe = document.createElement('div');
  probe.className = className;
  probe.style.position = 'absolute';
  probe.style.top = `-${PROBE_CHILD_SIZE}px`;
  probe.style.left = `-${PROBE_CHILD_SIZE}px`;
  probe.style.width = `${PROBE_SIZE}px`;
  probe.style.height = `${PROBE_SIZE}px`;
  probe.style.margin = '0';
  probe.style.border = '0';
  probe.style.padding = '0';
  probe.style.boxSizing = 'content-box';
  probe.style.display = 'block';
  probe.style.overflow = 'scroll';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';

  const child = document.createElement('div');
  child.style.width = `${PROBE_CHILD_SIZE}px`;
  child.style.height = `${PROBE_CHILD_SIZE}px`;
  probe.appendChild(child);

  document.body.appendChild(probe);

  const size: ScrollbarGutterSize = {
    vertical: Math.max(probe.offsetWidth - probe.clientWidth, 0),
    horizontal: Math.max(probe.offsetHeight - probe.clientHeight, 0),
  };

  probe.remove();
  cachedGutterSizes.set(className, size);
  return size;
}
