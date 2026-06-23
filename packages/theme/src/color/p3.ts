// Convert sRGB hex colors to the CSS Display P3 color space, with an optional
// saturation/luminance boost that pushes colors into P3's wider gamut. This is
// how the "vibrant" theme variants are defined (see scripts/build.ts) and
// previewed (src/previews/p3.ts).

import { hexToRgb01, linearToSrgb, srgbToLinear } from './srgb';

// Display P3 uses the same transfer function (gamma) as sRGB.
const linearToP3 = linearToSrgb;

/** Linear sRGB → linear Display P3 (sRGB primaries → P3 primaries via XYZ). */
function linearSrgbToLinearP3(
  r: number,
  g: number,
  b: number
): [number, number, number] {
  const rOut = 0.82246197 * r + 0.17753803 * g + 0.0 * b;
  const gOut = 0.0331942 * r + 0.9668058 * g + 0.0 * b;
  const bOut = 0.01708263 * r + 0.07239744 * g + 0.91051993 * b;
  return [rOut, gOut, bOut];
}

/** Format a 0–1 channel for a CSS color() function (clamped, 6 dp). */
function formatColorValue(value: number): string {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped.toFixed(6);
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / delta + 2) / 6;
        break;
      case b:
        h = ((r - g) / delta + 4) / 6;
        break;
    }
  }

  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [r, g, b];
}

/**
 * Enhance colors to take advantage of P3's wider gamut: boost saturation
 * (15–30% by original saturation) and, for vivid mid-tones, luminance (~5%).
 * Grays and near-black/white are left untouched.
 */
function enhanceForP3Gamut(
  r: number,
  g: number,
  b: number
): [number, number, number] {
  const [h, s, l] = rgbToHsl(r, g, b);

  if (s < 0.1 || l < 0.1 || l > 0.9) {
    return [r, g, b];
  }

  const saturationBoost = 0.15 + s * 0.15; // 15–30% depending on saturation
  const newS = Math.min(1.0, s + s * saturationBoost);

  let newL = l;
  if (s > 0.5 && l < 0.7) {
    newL = Math.min(0.9, l + l * 0.05);
  }

  return hslToRgb(h, newS, newL);
}

/**
 * Convert an sRGB hex color to a CSS Display P3 string,
 * "color(display-p3 r g b)" (or "… / alpha").
 */
export function srgbHexToP3Color(
  srgbHex: string,
  enhance: boolean = true
): string {
  const hasAlpha =
    srgbHex.length === 9 || (srgbHex.startsWith('#') && srgbHex.length === 9);
  let alpha = '';
  let colorHex = srgbHex;

  if (hasAlpha) {
    const alphaHex = srgbHex.slice(-2);
    const alphaValue = parseInt(alphaHex, 16) / 255;
    alpha = ` / ${formatColorValue(alphaValue)}`;
    colorHex = srgbHex.slice(0, -2);
  }

  const [sR, sG, sB] = hexToRgb01(colorHex);
  const [linearPR, linearPG, linearPB] = linearSrgbToLinearP3(
    srgbToLinear(sR),
    srgbToLinear(sG),
    srgbToLinear(sB)
  );

  let pR = linearToP3(linearPR);
  let pG = linearToP3(linearPG);
  let pB = linearToP3(linearPB);

  if (enhance) {
    [pR, pG, pB] = enhanceForP3Gamut(pR, pG, pB);
  }

  return `color(display-p3 ${formatColorValue(pR)} ${formatColorValue(pG)} ${formatColorValue(pB)}${alpha})`;
}

/** Recursively convert every hex color in a Roles-shaped object to Display P3. */
export function convertRolesToP3<T>(obj: T): T {
  if (typeof obj === 'string') {
    if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(obj)) {
      return srgbHexToP3Color(obj) as T;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    const items = obj as readonly unknown[];
    return items.map((item) => convertRolesToP3(item)) as T;
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = convertRolesToP3(value);
    }
    return result as T;
  }

  return obj;
}
