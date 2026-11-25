/**
 * Snap a CSS-pixel value to the nearest device-pixel boundary. Browsers store
 * scrollTop on the device-pixel grid on fractional-DPR displays (1.25x, 1.5x,
 * etc.), so rounding computed scroll targets against that grid keeps delta
 * math settling cleanly instead of hovering around fractional residuals.
 *
 * Reads window.devicePixelRatio fresh on each call so monitor-switching and
 * zoom changes are picked up without needing to flush any cached value.
 */
export function roundToDevicePixel(value: number): number {
  const dpr = window.devicePixelRatio ?? 1;
  return Math.round(value * dpr) / dpr;
}
