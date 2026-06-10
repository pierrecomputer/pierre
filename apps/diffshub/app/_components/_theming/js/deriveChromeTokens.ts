/**
 * deriveChromeTokens derives diffshub's contrast-heavy "chrome" token set — the
 * opinionated app palette (most-legible foreground, derived muted text,
 * color-mix surfaces, luminance-based status tints).
 *
 * Surfaces come resolved from normalizeThemeColors, but the foreground candidate
 * list is read from the raw theme colors in design-intent order, so the contrast
 * pass can compare sideBar.foreground vs editor.foreground vs theme.fg against
 * each other (the resolved/collapsed sidebar fg has already discarded that).
 */
import type { ThemeLike } from '@pierre/theming';
import { colorUtils, normalizeThemeColors } from '@pierre/theming/color';

// The opinionated app-chrome token set diffshubChromeMapping maps onto its CSS
// variables. Moved out of @pierre/theming (which now stays neutral); the shape
// is unchanged from the token set the package used to ship.
export interface ChromeTokens {
  additionFg: string;
  background: string;
  border: string;
  borderOpaque: string;
  deletionFg: string;
  fg: string;
  mutedFg: string;
  ring: string;
  scrollbarThumb?: string;
  scrollbarTrack?: string;
  separator: string;
  surface: string;
  surfaceBorder: string;
  surfaceHover: string;
  surfaceSelected: string;
  surfaceShadow: string;
}

// Muted-text floor (WCAG AA normal text); used to decide whether the theme's
// descriptionForeground is readable enough to keep on the chrome surface.
const MIN_MUTED_RATIO = 4.5;

// Mix weight (percent of the surface's own foreground blended into its
// background) for the opaque chrome borders and the inter-file diff separator.
// Shared so both lines carry the same visual weight across themes.
const DIFF_BORDER_MIX = 22;

const cache = new WeakMap<ThemeLike, ChromeTokens | undefined>();

// Returns the theme's descriptionForeground when it's readable enough
// (>= MIN_MUTED_RATIO against the chrome bg). Hex-with-alpha values like
// aurora-x's `#576daf79` are composited over the bg first, since rgba previews
// don't reach AA on their own. Returns undefined when the value is missing,
// unparseable, or fails the contrast bar — letting the call site fall back to a
// derived muted.
function pickReadableMuted(
  bg: string | undefined,
  mutedCandidate: string | undefined
): string | undefined {
  if (mutedCandidate == null || mutedCandidate === '') return undefined;
  const composited =
    colorUtils.compositeOverBg(mutedCandidate, bg) ?? mutedCandidate;
  const compositedL = colorUtils.relativeLuminance(composited);
  const bgL = colorUtils.relativeLuminance(bg);
  if (compositedL == null || bgL == null) {
    // Can't measure — trust the designer's value rather than second-guess
    // exotic non-hex formats (var(...), color-mix(...), named colors).
    return mutedCandidate;
  }
  return colorUtils.contrastRatio(bgL, compositedL) >= MIN_MUTED_RATIO
    ? mutedCandidate
    : undefined;
}

// Reads a Shiki/VS Code-style theme and returns the chrome token set, or
// undefined when the theme yields no legible foreground (the degenerate,
// bg-only case — real themes always produce an fg).
export function deriveChromeTokens(theme: ThemeLike): ChromeTokens | undefined {
  const cached = cache.get(theme);
  if (cached !== undefined || cache.has(theme)) return cached;

  // Resolved surfaces (shared with trees) come from normalizeThemeColors; the
  // raw colors map drives the design-intent foreground candidate list.
  const rawColors = theme.colors ?? {};
  const resolved = normalizeThemeColors(theme).colors ?? {};

  const sidebarBg = resolved['sideBar.background'];
  // The contrast pass needs the raw candidate LIST (design-intent order), not
  // the collapsed sidebar fg, so it can compare each against the surface.
  const fg = colorUtils.pickReadableForeground(sidebarBg, [
    rawColors['sideBar.foreground'],
    rawColors['editor.foreground'],
    theme.fg,
  ]);
  // No foreground means no meaningful chrome.
  if (fg == null) {
    cache.set(theme, undefined);
    return undefined;
  }

  const editorBg = resolved['editor.background'] ?? sidebarBg;
  const editorFg = resolved['editor.foreground'] ?? fg;
  // Cards layer the theme foreground onto its own background so they stay
  // on-palette regardless of whether the theme is "light" or "dark".
  const cardBase = sidebarBg ?? 'transparent';
  const muted =
    pickReadableMuted(sidebarBg, rawColors['descriptionForeground']) ??
    colorUtils.deriveMutedFg(fg, sidebarBg);
  // Opaque chrome border (header bottom, sidebar edge); shares DIFF_BORDER_MIX
  // with the diff separator so the two read as one system.
  const borderOpaque = `color-mix(in srgb, ${fg} ${DIFF_BORDER_MIX}%, ${sidebarBg ?? 'transparent'})`;
  const surfaceIsDark = colorUtils.isDarkSurface(sidebarBg, fg);
  // Hairline between diff files. When the editor surface matches the sidebar
  // (the common case) reuse the chrome border verbatim so the separator can't
  // drift; only when the palettes genuinely diverge (slack-ochin) derive it
  // from the editor surface so it contrasts the diff body.
  const separator =
    editorBg == null || colorUtils.surfacesMatch(editorBg, sidebarBg)
      ? borderOpaque
      : `color-mix(in srgb, ${editorFg} ${DIFF_BORDER_MIX}%, ${editorBg})`;

  const tokens = Object.freeze({
    additionFg: surfaceIsDark ? '#34d399' : '#047857',
    background: sidebarBg ?? `color-mix(in srgb, ${fg} 7%, ${cardBase})`,
    border: `color-mix(in srgb, ${fg} 20%, transparent)`,
    borderOpaque,
    deletionFg: surfaceIsDark ? '#fb7185' : '#be123c',
    fg,
    mutedFg: muted,
    ring: fg,
    scrollbarThumb:
      editorBg != null
        ? colorUtils.isDarkSurface(editorBg, editorFg)
          ? `color-mix(in lab, ${editorBg} 80%, white)`
          : `color-mix(in lab, ${editorBg} 85%, black)`
        : undefined,
    scrollbarTrack: editorBg ?? undefined,
    separator,
    surface: `color-mix(in srgb, ${fg} 7%, ${cardBase})`,
    surfaceBorder: `color-mix(in srgb, ${fg} 18%, ${cardBase})`,
    surfaceHover: `color-mix(in srgb, ${fg} 14%, ${cardBase})`,
    surfaceSelected: `color-mix(in srgb, ${fg} 20%, ${cardBase})`,
    surfaceShadow: '0 10px 30px rgb(0 0 0 / 0.18), 0 3px 8px rgb(0 0 0 / 0.12)',
  });
  cache.set(theme, tokens);
  return tokens;
}
