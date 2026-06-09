/**
 * Canonical color/contrast primitives
 */

// MIN_READABLE_RATIO is the primary-foreground floor (WCAG AA large text); used
// when picking the most legible foreground token for a surface.
export const MIN_READABLE_RATIO = 3;
// MIN_MUTED_RATIO is the muted-text floor (WCAG AA normal text); used when
// deciding whether a description/muted token is readable on a surface.
export const MIN_MUTED_RATIO = 4.5;

// Matches a fully-transparent hex color: a 4-digit form whose alpha nibble is
// 0 (`#rgb0`) or an 8-digit form whose alpha byte is 00 (`#rrggbb00`).
const HEX_TRANSPARENT_RE = /^#(?:[0-9a-f]{3}0|[0-9a-f]{6}00)$/i;
// Matches an alpha component that is effectively zero: `0`, `0.0`, `0%`, etc.
const ALPHA_ZERO_RE = /^0(?:\.0+)?%?$/;

// Extracts the alpha component from a functional color notation
// (rgb/rgba/hsl/hsla/hwb/lab/lch/oklab/oklch/color). Supports both the modern
// slash syntax (`rgb(0 0 0 / 0)`) and the legacy comma syntax
// (`rgba(0, 0, 0, 0)`). Returns undefined when the input isn't a recognized
// functional notation or has no alpha component. Used by isFullyTransparent to
// detect zero-alpha colors without a full CSS color parser.
function getFunctionalAlpha(color: string): string | undefined {
  const openParen = color.indexOf('(');
  if (openParen <= 0 || !color.endsWith(')')) {
    return undefined;
  }

  const fn = color.slice(0, openParen).trim();
  if (!/^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)$/i.test(fn)) {
    return undefined;
  }

  const inner = color.slice(openParen + 1, -1).trim();
  if (inner.length === 0) {
    return undefined;
  }

  // Modern functional syntax: rgb(0 0 0 / 0), color(... / 0%), etc.
  const slashIndex = inner.lastIndexOf('/');
  if (slashIndex !== -1) {
    return inner.slice(slashIndex + 1).trim();
  }

  // Legacy syntax: rgba(0, 0, 0, 0), hsla(210, 40%, 50%, 0.0)
  if (/^(?:rgba|hsla)$/i.test(fn)) {
    const parts = inner.split(',');
    if (parts.length === 4) {
      return parts[3]?.trim();
    }
  }

  return undefined;
}

// Parses `#rgb`, `#rrggbb`, or `#rrggbbaa` into [r, g, b, a] with channels in
// [0, 255] and alpha in [0, 1]. Returns null for any other format. Stay in
// 0..255 (not normalized) and alpha is decoded from the 8-digit form.
export function parseHexRgba(
  color: string
): readonly [number, number, number, number] | null {
  // The \b anchor is inherited from the diffshub source to preserve parity.
  // Callers pass trimmed bare hex strings, so \b matches the end of the whole color.
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b/i.exec(color.trim());
  if (match == null) return null;
  const hex = match[1];
  let expanded: string;
  let alpha = 1;
  if (hex.length === 3) {
    expanded = hex
      .split('')
      .map((c) => c + c)
      .join('');
  } else if (hex.length === 6) {
    expanded = hex;
  } else {
    expanded = hex.slice(0, 6);
    alpha = parseInt(hex.slice(6, 8), 16) / 255;
  }
  return [
    parseInt(expanded.slice(0, 2), 16),
    parseInt(expanded.slice(2, 4), 16),
    parseInt(expanded.slice(4, 6), 16),
    alpha,
  ];
}

// WCAG relative luminance of a hex color in [0, 1], or null for non-hex inputs
// (var(...), color-mix(...), named colors) and undefined.
//
// Accepts 3-, 6-, AND 8-digit hex. The alpha byte of an 8-digit color is
// IGNORED for the luminance computation
export function relativeLuminance(color?: string): number | null {
  if (color == null) return null;
  const rgba = parseHexRgba(color);
  if (rgba == null) return null;
  // parseHexRgba returns channels in 0..255; normalize to 0..1, dropping alpha.
  const r = rgba[0] / 255;
  const g = rgba[1] / 255;
  const b = rgba[2] / 255;
  // sRGB channel → linear → weighted sum (WCAG formula).
  const channel = (v: number): number =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// WCAG contrast ratio between two luminances: (lighter + 0.05) / (darker + 0.05).
// Symmetric in its arguments.
export function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// Composites a hex (`#rrggbb` or `#rrggbbaa`) foreground over a hex background
// and returns the resulting opaque `#rrggbb`. Used to measure the actual
// contrast of semi-transparent tokens (e.g. `#576daf79`) against the surface
// they'll render on, rather than the alpha-stripped base color. Returns
// undefined when no background is given or either color is unparseable.
export function compositeOverBg(
  fgColor: string,
  bgColor?: string
): string | undefined {
  if (bgColor == null) return undefined;
  const fgParts = parseHexRgba(fgColor);
  const bgParts = parseHexRgba(bgColor);
  if (fgParts == null || bgParts == null) return undefined;
  const [fr, fg, fb, fa] = fgParts;
  const [br, bg, bb] = bgParts;
  const r = Math.round(fr * fa + br * (1 - fa));
  const g = Math.round(fg * fa + bg * (1 - fa));
  const b = Math.round(fb * fa + bb * (1 - fa));
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

// True when a color is fully transparent: the `transparent` keyword, a
// zero-alpha hex (`#rgb0` / `#rrggbb00`), or a functional color whose alpha
// component is effectively zero (`rgba(0,0,0,0)`, `hsla(0,0%,0%,0)`,
// `rgb(0 0 0 / 0%)`). Returns false for undefined and for any opaque color.
export function isFullyTransparent(color?: string): boolean {
  if (color == null) return false;
  const normalized = color.trim().toLowerCase();
  if (normalized === 'transparent') return true;
  if (HEX_TRANSPARENT_RE.test(normalized)) return true;

  const alpha = getFunctionalAlpha(normalized);
  return alpha != null && ALPHA_ZERO_RE.test(alpha);
}

// True when a chrome surface is perceptually dark. Prefers the surface's own
// luminance (dark when < 0.4); when the bg hex isn't parseable, falls back to a
// foreground hint (light fg, luminance > 0.6 → dark surface, the conventional
// pairing). An undefined or unparseable fgHint behaves like a miss → false.
export function isDarkSurface(bg?: string, fgHint?: string): boolean {
  const fromBg = relativeLuminance(bg);
  if (fromBg != null) return fromBg < 0.4;
  const fromFg = relativeLuminance(fgHint);
  return fromFg != null ? fromFg > 0.6 : false;
}

// True when two colors read as the "same surface": identical hex (case- and
// whitespace-insensitive) or close enough in luminance (Δ < 0.06) that a border
// tuned for one looks right on the other. Non-hex inputs we can't measure, and
// undefined inputs, are treated as non-matching.
export function surfacesMatch(a?: string, b?: string): boolean {
  if (a == null || b == null) return false;
  if (a.trim().toLowerCase() === b.trim().toLowerCase()) return true;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la == null || lb == null) return false;
  return Math.abs(la - lb) < 0.06;
}

// True when `hover` is closer in luminance to `fg` than to `bg` — i.e. the
// hover surface would land on top of the row text rather than next to it,
// erasing legibility. Returns false when bg or fg is missing, or when any color
// can't be parsed (unknown format → trust the theme designer's intent).
export function hoverWouldEraseText(
  hover: string,
  bg: string | undefined,
  fg: string | undefined
): boolean {
  if (bg == null || fg == null) return false;
  const hoverL = relativeLuminance(hover);
  const bgL = relativeLuminance(bg);
  const fgL = relativeLuminance(fg);
  if (hoverL == null || bgL == null || fgL == null) return false;
  return Math.abs(hoverL - fgL) < Math.abs(hoverL - bgL);
}

// Walks `candidates` in priority order. Returns the first color whose contrast
// against `bg` clears MIN_READABLE_RATIO. If nothing reaches that bar, returns
// the candidate with the highest contrast — that keeps weakly-typed themes
// (where everything is dim) on the brightest available token rather than
// silently picking the first dim one. Non-hex candidates (var(...),
// color-mix(...), named colors) can't be measured here without rendering;
// they're treated as opaque misses and only returned via the `firstDefined`
// fallback when nothing parses.
export function pickReadableForeground(
  bg: string | undefined,
  candidates: ReadonlyArray<string | undefined>
): string | undefined {
  const bgL = relativeLuminance(bg);
  const firstDefined = candidates.find(
    (candidate) => candidate != null && candidate !== ''
  );
  if (bgL == null) return firstDefined;
  let best: string | undefined;
  let bestRatio = -1;
  for (const candidate of candidates) {
    if (candidate == null || candidate === '') continue;
    const candidateL = relativeLuminance(candidate);
    if (candidateL == null) continue;
    const ratio = contrastRatio(bgL, candidateL);
    if (ratio >= MIN_READABLE_RATIO) return candidate;
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best ?? firstDefined;
}

// Mixes primaryFg toward bg until the result clears MIN_MUTED_RATIO, stepping
// from a strong-hierarchy 60% blend up to 90%. Returning primaryFg as a final
// fallback flattens the muted/primary hierarchy on extreme palettes, which is
// the correct tradeoff: dim but legible chrome beats stylish but unreadable
// chrome. Falls back to a CSS `color-mix` expression when either input isn't a
// parseable hex — the browser can still composite, we just can't verify the
// contrast.
export function deriveMutedFg(
  primaryFg: string,
  bg: string | undefined
): string {
  if (bg == null) return primaryFg;
  const fgParts = parseHexRgba(primaryFg);
  const bgParts = parseHexRgba(bg);
  const bgL = relativeLuminance(bg);
  if (fgParts == null || bgParts == null || bgL == null) {
    return `color-mix(in srgb, ${primaryFg} 70%, ${bg})`;
  }
  const [fr, fg2, fb] = fgParts;
  const [br, bg3, bb] = bgParts;
  for (const weight of [0.6, 0.7, 0.8, 0.9]) {
    const r = Math.round(fr * weight + br * (1 - weight));
    const g = Math.round(fg2 * weight + bg3 * (1 - weight));
    const b = Math.round(fb * weight + bb * (1 - weight));
    const hex =
      '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    const L = relativeLuminance(hex);
    if (L != null && contrastRatio(bgL, L) >= MIN_MUTED_RATIO) {
      return hex;
    }
  }
  return primaryFg;
}
