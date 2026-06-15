// Low-level sRGB primitives shared across the color-science modules (P3
// conversion, CVD simulation, WCAG contrast, CIEDE2000). These are not
// Display-P3 concerns — they're the generic hex ↔ RGB and gamma conversions that
// everything else builds on.

/** Parse a hex color ("#rgb" or "#rrggbb") to RGB channels in the 0–1 range. */
export function hexToRgb01(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '');
  const expanded =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((x) => x + x)
          .join('')
      : cleaned;

  const num = parseInt(expanded, 16);
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;

  return [r, g, b];
}

/** Linearize an sRGB channel (remove the sRGB gamma curve). */
export function srgbToLinear(c: number): number {
  if (c <= 0.04045) {
    return c / 12.92;
  }
  return Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Apply the sRGB gamma curve to a linear channel (encode for display). */
export function linearToSrgb(c: number): number {
  if (c <= 0.0031308) {
    return c * 12.92;
  }
  return 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
