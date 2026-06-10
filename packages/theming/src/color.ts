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

// The pure color/contrast transforms, grouped as one object rather than nine
// named exports so a consumer that composes several imports them under a single
// name (e.g. `colorUtils.pickReadableForeground(...)`) instead of cluttering its
// import list.
export const colorUtils = {
  compositeOverBg,
  contrastRatio,
  deriveMutedFg,
  hoverWouldEraseText,
  isDarkSurface,
  isFullyTransparent,
  pickReadableForeground,
  relativeLuminance,
  surfacesMatch,
} as const;
