/**
 * Everything for reading and deriving colors from a resolved Shiki/VS Code theme.
 * - `normalizeThemeColors` reads the colors a theme defines, resolving the
 *   fallback chains and applying the universal repairs.
 * - `colorUtils` is the bag of pure color transforms for deriving new colors
 *   from theme colors (a readable foreground for a surface, muted text, mixes,
 *   luminance/contrast checks).
 */
import {
  compositeOverBg,
  contrastRatio,
  deriveMutedFg,
  hoverWouldEraseText,
  isDarkSurface,
  isFullyTransparent,
  pickReadableForeground,
  relativeLuminance,
  surfacesMatch,
} from './modules/color';

export { normalizeThemeColors } from './modules/normalizeThemeColors';

type ColorUtils = {
  readonly compositeOverBg: typeof compositeOverBg;
  readonly contrastRatio: typeof contrastRatio;
  readonly deriveMutedFg: typeof deriveMutedFg;
  readonly hoverWouldEraseText: typeof hoverWouldEraseText;
  readonly isDarkSurface: typeof isDarkSurface;
  readonly isFullyTransparent: typeof isFullyTransparent;
  readonly pickReadableForeground: typeof pickReadableForeground;
  readonly relativeLuminance: typeof relativeLuminance;
  readonly surfacesMatch: typeof surfacesMatch;
};

// The pure color/contrast transforms, grouped as one object rather than nine
// named exports so a consumer that composes several imports them under a single
// name (e.g. `colorUtils.pickReadableForeground(...)`) instead of cluttering its
// import list.
export const colorUtils: ColorUtils = {
  compositeOverBg: compositeOverBg,
  contrastRatio: contrastRatio,
  deriveMutedFg: deriveMutedFg,
  hoverWouldEraseText: hoverWouldEraseText,
  isDarkSurface: isDarkSurface,
  isFullyTransparent: isFullyTransparent,
  pickReadableForeground: pickReadableForeground,
  relativeLuminance: relativeLuminance,
  surfacesMatch: surfacesMatch,
} as const;
