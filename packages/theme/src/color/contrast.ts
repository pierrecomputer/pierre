// WCAG 2.1 contrast ratio — a legibility check, independent of hue. Relative
// luminance uses the linear-RGB luma coefficients; contrast is
// (lighter + 0.05) / (darker + 0.05), from 1:1 (identical) to 21:1 (black on
// white). WCAG AA wants ≥ 4.5:1 for normal text and ≥ 3:1 for large text / UI
// glyphs. The CVD gate re-checks contrast *after* simulation, since simulation
// shifts luminance.

import { hexToRgb01, srgbToLinear } from './srgb';

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb01(hex).map(srgbToLinear) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio between two sRGB hex colors (order-independent). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
