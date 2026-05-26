'use client';

import { type DiffsThemeNames, getResolvedOrResolveTheme } from '@pierre/diffs';
import darkSoftTheme from '@pierre/theme/pierre-dark-soft';
import lightSoftTheme from '@pierre/theme/pierre-light-soft';
import { themeToTreeStyles, type TreeThemeStyles } from '@pierre/trees';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';

import { useTheme } from '@/components/theme-provider';

// Resolved Shiki/VS Code-style theme shape (the minimum bits diffshub
// needs); kept loose so it accepts both the typed `@pierre/theme` bundles
// and `getResolvedOrResolveTheme`'s `ThemeRegistrationResolved`.
interface ResolvedShikiTheme {
  type?: 'light' | 'dark';
  bg?: string;
  fg?: string;
  colors?: Record<string, string>;
}

// Per-theme bundle: the tree styles for FileTree consumers, plus the raw
// resolved colors that the sidebar chrome needs to mirror the theme
// without going through TreeThemeStyles' tree-specific naming.
export interface ResolvedTreeTheme {
  treeStyles: TreeThemeStyles;
  // The color the theme assigns to the sidebar surface
  // (sideBar.foreground, falling back to editor.foreground then theme.fg).
  // Use this for primary text and icon chrome so they stay legible
  // against the tree's sideBar.background — picking editor.foreground
  // first breaks on themes like slack-ochin where the editor and sidebar
  // use opposite palettes (white editor, dark navy sidebar).
  primaryFg?: string;
  // descriptionForeground — VS Code's muted-text token. Many themes
  // don't define it; when missing, callers should fade `primaryFg`
  // themselves rather than reaching for another opaque token like
  // sideBarSectionHeader.foreground, which on some themes is brighter
  // than the primary text and inverts the muted/primary hierarchy.
  mutedFg?: string;
  // editor.background / editor.foreground — the surface and text color the
  // diff body itself renders on. Kept separately from the sidebar pair
  // because some themes use opposite palettes for the two (slack-ochin:
  // white editor, dark navy sidebar). The inter-file separator is derived
  // from these so it contrasts the *diff* surface at the same perceptual
  // weight as the chrome borders do against the sidebar.
  editorBg?: string;
  editorFg?: string;
}

// Defaults used while the user-selected Shiki theme is still resolving.
function buildResolvedTheme(theme: ResolvedShikiTheme): ResolvedTreeTheme {
  const c = theme.colors ?? {};
  const sideBarBg =
    c['sideBar.background'] ?? c['editor.background'] ?? theme.bg;
  const editorBg = c['editor.background'] ?? theme.bg ?? sideBarBg;
  const editorFg = c['editor.foreground'] ?? theme.fg;
  // Pick the foreground that's actually legible on the sidebar surface.
  // Some themes (slack-ochin) want sideBar.foreground because their editor
  // foreground is the opposite palette; others (material-theme-ocean) ship
  // a deliberately dim sideBar.foreground — #525975 on #0F111A is ~2.6:1,
  // well below WCAG AA — and the same theme's editor.foreground (#babed8
  // ~10:1) is the brightness the chrome and tree are supposed to use.
  // Probe candidates in design-intent order and keep the first one that
  // clears AA; only fall through to "highest contrast wins" when no
  // candidate is legible enough on its own.
  //
  // `theme.fg` is Shiki's normalized editor text color, populated through
  // a fallback chain that covers `colors['editor.foreground']`, a
  // tokenColor without scope, and finally Shiki's #bbbbbb default for
  // dark themes / #333333 for light. Aurora-x has none of `sideBar`/
  // `editor.foreground` set in its `colors` block, so the editor renders
  // body text in that Shiki #bbbbbb fallback — using `theme.fg` here
  // makes the chrome match. Notably absent from the list:
  // - `list.activeSelectionForeground` — reserved for the *selected* item
  //   highlight, often a saturated accent (aurora-x: `#86A5FF`); using it
  //   as the default would tint every chrome label that accent color.
  // - `colors.foreground` — VS Code's global UI text token. Aurora-x sets
  //   it to `#576daf` (a deliberately dim blue-gray) intended for menus
  //   and the like; preferring it over `theme.fg` swaps the chrome away
  //   from the editor's body text color, which is exactly the mismatch
  //   the user flagged.
  const primaryFg = pickReadableForeground(sideBarBg, [
    c['sideBar.foreground'],
    c['editor.foreground'],
    theme.fg,
  ]);
  const treeStyles = themeToTreeStyles(theme);
  // themeToTreeStyles pulls its text color tokens straight from
  // sideBar.foreground; when the contrast-based pick disagrees with that
  // raw value, overwrite the tree's tokens so the file rows match the
  // chrome instead of staying on the dim original. Tokens that the theme
  // sets explicitly (sideBarSectionHeader.foreground,
  // list.activeSelectionForeground) keep their intended values — we only
  // upgrade the unconditional fallbacks.
  if (
    primaryFg != null &&
    primaryFg !== c['sideBar.foreground'] &&
    primaryFg !== ''
  ) {
    treeStyles.color = primaryFg;
    treeStyles['--trees-theme-sidebar-fg'] = primaryFg;
    if (c['sideBarSectionHeader.foreground'] == null) {
      treeStyles['--trees-theme-sidebar-header-fg'] = primaryFg;
    }
    if (c['list.activeSelectionForeground'] == null) {
      treeStyles['--trees-theme-list-active-selection-fg'] = primaryFg;
    }
    if (
      c['list.focusOutline'] == null &&
      c['focusBorder'] == null &&
      c['sideBar.foreground'] == null
    ) {
      treeStyles['--trees-theme-focus-ring'] = primaryFg;
    }
  }
  return {
    treeStyles,
    primaryFg,
    mutedFg: c['descriptionForeground'],
    editorBg,
    editorFg: editorFg ?? primaryFg,
  };
}

// Walks `candidates` in priority order. Returns the first color whose
// contrast against `bg` clears `MIN_READABLE_RATIO`. If nothing reaches
// that bar, returns the candidate with the highest contrast — that keeps
// weakly-typed themes (where everything is dim) on the brightest
// available token rather than silently picking the first dim one. Non-hex
// candidates (var(...), color-mix(...), named colors) can't be measured
// here without rendering; they're treated as opaque misses and only
// returned via the `firstDefined` fallback when nothing parses.
//
// The 3:1 threshold is WCAG AA's "large text" floor. We use it instead
// of the 4.5:1 "normal text" cutoff because the theme designer's
// `sideBar.foreground` is the design-intent value for sidebar chrome —
// honoring it is preferable to forcing a stronger token whenever
// possible. 3:1 still catches the egregious failures (material-theme-
// ocean's #525975 on #0F111A at ~2.6:1) while leaving deliberately soft
// palettes like pierre-light-soft (~4.4:1) untouched.
const MIN_READABLE_RATIO = 3;

// Muted chrome text ("Diff Stats", "System Monitor", "Comments", file
// counts, empty-state copy) is normal-size body text, so we hold its
// threshold at WCAG AA normal-text (4.5:1) rather than the large-text
// floor used for the primary fg. Several VS Code themes set
// `descriptionForeground` to a value that doubles as the editor comment
// color and clears 3:1 but not 4.5:1 — ayu-dark's `#5a6378` on `#0d1017`
// (~3.27:1) is the canonical case. We'd rather lose the muted/primary
// hierarchy on those themes than ship sidebar text that fades into the
// background.
const MIN_MUTED_RATIO = 4.5;

// Mix weight (percent of the surface's own foreground blended into its
// background) for the opaque chrome borders and the inter-file diff
// separator. Shared so both lines carry the same visual weight across
// themes. Tuned up from an initial 15%, which was too faint to register
// the header/sidebar edges and file boundaries on most surfaces.
const DIFF_BORDER_MIX = 22;

function pickReadableForeground(
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

function contrastRatio(la: number, lb: number): number {
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// Returns the theme's descriptionForeground when it's readable enough
// (>= MIN_MUTED_RATIO against the chrome bg). Hex-with-alpha values like
// aurora-x's `#576daf79` are composited over the bg first, since rgba
// previews don't reach AA on their own. Returns undefined when the value
// is missing, unparseable, or fails the contrast bar — letting the call
// site fall back to a derived muted (or primaryFg when no bg is known).
function pickReadableMuted(
  bg: string | undefined,
  mutedCandidate: string | undefined
): string | undefined {
  if (mutedCandidate == null || mutedCandidate === '') return undefined;
  const composited = compositeOverBg(mutedCandidate, bg) ?? mutedCandidate;
  const compositedL = relativeLuminance(composited);
  const bgL = relativeLuminance(bg);
  if (compositedL == null || bgL == null) {
    // Can't measure — trust the designer's value rather than second-
    // guess exotic non-hex formats (var(...), color-mix(...), named
    // colors).
    return mutedCandidate;
  }
  return contrastRatio(bgL, compositedL) >= MIN_MUTED_RATIO
    ? mutedCandidate
    : undefined;
}

// Mixes primaryFg toward bg until the result clears MIN_MUTED_RATIO,
// stepping from a strong-hierarchy 60% blend up to 100% (== primaryFg).
// Returning primaryFg as a final fallback flattens the muted/primary
// hierarchy on extreme palettes, which is the correct tradeoff: dim but
// legible chrome beats stylish but unreadable chrome. Falls back to a
// CSS `color-mix` expression when either input isn't a parseable hex —
// the browser can still composite, we just can't verify the contrast.
function deriveMutedFg(primaryFg: string, bg: string | undefined): string {
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

// Composites a hex (`#rrggbb` or `#rrggbbaa`) candidate over a hex
// background and returns the resulting opaque hex. Used so we can measure
// the actual contrast of semi-transparent muted-fg tokens (#576daf79 etc.)
// against the surface they'll render on, rather than the alpha-stripped
// base color. Returns undefined for unparseable inputs.
function compositeOverBg(
  fg: string,
  bg: string | undefined
): string | undefined {
  if (bg == null) return undefined;
  const fgParts = parseHexRgba(fg);
  const bgParts = parseHexRgba(bg);
  if (fgParts == null || bgParts == null) return undefined;
  const [fr, fg2, fb, fa] = fgParts;
  const [br, bg3, bb] = bgParts;
  const r = Math.round(fr * fa + br * (1 - fa));
  const g = Math.round(fg2 * fa + bg3 * (1 - fa));
  const b = Math.round(fb * fa + bb * (1 - fa));
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

// Parses `#rgb`, `#rrggbb`, or `#rrggbbaa` into [r, g, b, a] with channels
// in [0, 255] and alpha in [0, 1]. Returns null for any other format.
function parseHexRgba(
  color: string
): readonly [number, number, number, number] | null {
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

const LIGHT_SOFT_THEME = buildResolvedTheme(lightSoftTheme);
const DARK_SOFT_THEME = buildResolvedTheme(darkSoftTheme);

// Module-level cache so flipping back to a previously-selected Shiki theme
// is synchronous and renders without flashing the default pierre-soft
// palette in between.
const RESOLVED_THEME_CACHE = new Map<string, ResolvedTreeTheme>();
RESOLVED_THEME_CACHE.set('pierre-light-soft', LIGHT_SOFT_THEME);
RESOLVED_THEME_CACHE.set('pierre-dark-soft', DARK_SOFT_THEME);

function useResolvedThemeByName(
  themeName: DiffsThemeNames,
  fallback: ResolvedTreeTheme
): ResolvedTreeTheme {
  // Read the module cache on every render so a theme that's already
  // resolved (the common case once the user has cycled through it
  // once) applies in the same render as the prop change — no useState
  // round-trip. Without this, the sidebar's comment cards and tab
  // badge visibly lag one React commit behind the diff viewer's theme
  // swap, because useState's initializer only runs on mount.
  const cached = RESOLVED_THEME_CACHE.get(themeName);

  // Track the most recently *resolved* theme so cold themes don't
  // flash the pierre-soft fallback in between the prop change and the
  // async load completing. The diff side keeps the previous theme
  // visible during its own await inside `WorkerPoolManager.setRenderOptions`
  // — matching that behaviour here means chrome and diff stay aligned
  // through a swap: both show the prior theme until the new one is
  // ready, then both flip together.
  const [lastResolved, setLastResolved] = useState<ResolvedTreeTheme>(
    cached ?? fallback
  );

  useEffect(() => {
    const existing = RESOLVED_THEME_CACHE.get(themeName);
    if (existing != null) {
      // The render path already returned the cached value via `cached`
      // above; update the fallback state too so it stays in step when
      // the next swap hits a cold theme.
      setLastResolved(existing);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const theme = await getResolvedOrResolveTheme(themeName);
        const next = buildResolvedTheme(theme);
        RESOLVED_THEME_CACHE.set(themeName, next);
        if (!cancelled) setLastResolved(next);
      } catch {
        // Resolution failures are surfaced by the diff side; keeping
        // the previous theme keeps the sidebar usable in the meantime.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [themeName]);

  return cached ?? lastResolved;
}

// Returns the resolved Shiki theme bundle (tree styles + raw colors) for
// whichever color mode is currently active in the global ThemeProvider.
export function useResolvedTreeTheme(
  lightTheme: DiffsThemeNames,
  darkTheme: DiffsThemeNames
): ResolvedTreeTheme {
  const { resolvedTheme } = useTheme();
  const light = useResolvedThemeByName(lightTheme, LIGHT_SOFT_THEME);
  const dark = useResolvedThemeByName(darkTheme, DARK_SOFT_THEME);
  return useMemo(
    () => (resolvedTheme === 'dark' ? dark : light),
    [resolvedTheme, dark, light]
  );
}

// Back-compat alias returning just the TreeThemeStyles slice. Callers that
// only need the file-tree CSS variables stay simple.
export function useResolvedTreeThemeStyles(
  lightTheme: DiffsThemeNames,
  darkTheme: DiffsThemeNames
): TreeThemeStyles {
  return useResolvedTreeTheme(lightTheme, darkTheme).treeStyles;
}

// Builds the inline style we attach to any diffshub chrome surface (sidebar,
// header) so it sits on the active Shiki theme's `sideBar.background` and its
// text/icons/borders follow the same palette. We override the Tailwind v4
// `--color-*` aliases as well as the legacy `--*` names because globals.css
// bakes the aliases out to concrete values — overriding only `--foreground`
// would leave `text-foreground` utilities pinned to the pre-theme color.
//
// Beyond the chrome colors, we also derive surface tokens for "cards" that
// live on top of the sidebar bg (e.g. the comments list rows). Hardcoded
// `bg-card` / `bg-neutral-800` collide with mixed-palette themes like
// slack-ochin, which is classified `type: 'light'` but ships a dark navy
// sidebar — light text from the sidebar override on a white `bg-card` is
// unreadable. Mixing primaryFg into the sidebar bg keeps cards on-palette.
export function buildThemeChromeStyle(
  activeTheme: ResolvedTreeTheme
): CSSProperties | undefined {
  const bg =
    typeof activeTheme.treeStyles.backgroundColor === 'string' &&
    activeTheme.treeStyles.backgroundColor !== ''
      ? activeTheme.treeStyles.backgroundColor
      : undefined;
  const primaryFg =
    activeTheme.primaryFg ??
    (typeof activeTheme.treeStyles.color === 'string'
      ? activeTheme.treeStyles.color
      : undefined);
  if (bg == null && primaryFg == null) return undefined;
  const style: CSSProperties & Record<string, string> = {};
  if (bg != null) style.backgroundColor = bg;
  if (primaryFg != null) {
    style.color = primaryFg;
    style['--color-foreground'] = primaryFg;
    style['--foreground'] = primaryFg;
    // The chrome (file tree, sidebar status panel, header, comments list)
    // wants muted text that's softer than the primary fg for visual
    // hierarchy, but still hits WCAG AA normal-text (~4.5:1) on the
    // sidebar bg. We honour the theme's `descriptionForeground` when it
    // clears that bar, fall back to a mix of primaryFg into bg when it
    // doesn't, and only flatten down to primaryFg as a last resort. Two
    // cautionary tales:
    //   - Aurora-X sets descriptionForeground to `#576daf79` (~1.8:1
    //     composited over the dark navy sidebar). Using it leaves
    //     unselected tab icons and the empty-comments copy invisible.
    //   - ayu-dark sets it to `#5a6378` (~3.27:1 on `#0d1017`) — clears
    //     large-text 3:1 but fails normal-text 4.5:1, which is the bar
    //     these chrome labels need to meet.
    const muted =
      pickReadableMuted(bg, activeTheme.mutedFg) ??
      deriveMutedFg(primaryFg, bg);
    style['--color-muted-foreground'] = muted;
    style['--muted-foreground'] = muted;
    const border = `color-mix(in srgb, ${primaryFg} 20%, transparent)`;
    style['--color-border'] = border;
    style['--border'] = border;
    // Opaque chrome border (header bottom, sidebar edge). Mixing the theme
    // foreground into its surface keeps the line on-palette; the weight is
    // shared with the diff separator (DIFF_BORDER_MIX) so the two read as
    // one system. 15% was too faint to register against most surfaces.
    const borderOpaque = `color-mix(in srgb, ${primaryFg} ${DIFF_BORDER_MIX}%, ${bg ?? 'transparent'})`;
    style['--color-border-opaque'] = borderOpaque;
    style['--border-opaque'] = borderOpaque;
    // Card surface tokens for chrome elements that sit on top of the
    // sidebar bg (e.g. comment rows). We layer the theme's foreground onto
    // its own background so cards remain legible regardless of whether the
    // theme is "light" or "dark" — the cards always sit a touch above the
    // surface they live on, and the same text color works on both.
    const cardSurfaceBase = bg ?? 'transparent';
    const popoverBg = `color-mix(in srgb, ${primaryFg} 7%, ${cardSurfaceBase})`;
    const popoverHoverBg = `color-mix(in srgb, ${primaryFg} 14%, ${cardSurfaceBase})`;
    const popoverSelectedBg = `color-mix(in srgb, ${primaryFg} 20%, ${cardSurfaceBase})`;
    const popoverBorder = `color-mix(in srgb, ${primaryFg} 18%, ${cardSurfaceBase})`;
    // A real elevation drop shadow. It must read as "lifted off the page"
    // on every theme, so the color is occlusion-black (translucent) rather
    // than derived from the surface — a surface-tinted shadow vanishes on
    // light themes (a near-white blur over a near-white page). We do NOT
    // bake a `0 0 0 1px` ring in here: every consumer (the popovers and the
    // annotation cards) already paints its own 1px CSS border, so the ring
    // would render a second hairline just outside it and read as a doubled,
    // too-thick border.
    const popoverShadow =
      '0 10px 30px rgb(0 0 0 / 0.18), 0 3px 8px rgb(0 0 0 / 0.12)';
    style['--diffshub-card-bg'] =
      `color-mix(in srgb, ${primaryFg} 6%, ${cardSurfaceBase})`;
    style['--diffshub-card-hover-bg'] =
      `color-mix(in srgb, ${primaryFg} 12%, ${cardSurfaceBase})`;
    style['--diffshub-card-border'] =
      `color-mix(in srgb, ${primaryFg} 12%, ${cardSurfaceBase})`;
    style['--diffshub-popover-bg'] = popoverBg;
    style['--diffshub-popover-fg'] = primaryFg;
    style['--diffshub-popover-muted-fg'] = muted;
    style['--diffshub-popover-hover-bg'] = popoverHoverBg;
    style['--diffshub-popover-selected-bg'] = popoverSelectedBg;
    style['--diffshub-popover-border'] = popoverBorder;
    style['--diffshub-popover-shadow'] = popoverShadow;
    style['--diffshub-annotation-bg'] = popoverBg;
    style['--diffshub-annotation-fg'] = primaryFg;
    style['--diffshub-annotation-border'] = popoverBorder;
    style['--diffshub-annotation-hover-border'] =
      `color-mix(in srgb, ${primaryFg} 28%, ${cardSurfaceBase})`;
    style['--diffshub-annotation-shadow'] = popoverShadow;
    style['--color-popover'] = popoverBg;
    style['--popover'] = popoverBg;
    style['--color-popover-foreground'] = primaryFg;
    style['--popover-foreground'] = primaryFg;
    style['--color-card'] = popoverBg;
    style['--card'] = popoverBg;
    style['--color-card-foreground'] = primaryFg;
    style['--card-foreground'] = primaryFg;
    style['--color-background'] = bg ?? popoverBg;
    style['--background'] = bg ?? popoverBg;
    style['--color-accent'] = popoverHoverBg;
    style['--accent'] = popoverHoverBg;
    style['--color-accent-foreground'] = primaryFg;
    style['--accent-foreground'] = primaryFg;
    // `secondary` is the segmented-control (ButtonGroup) track. It must sit
    // visibly *behind* the buttons so the three Auto/Light/Dark options read
    // as one connected control — but the popover surface it lives on is
    // already `popoverBg`, so reusing that here made the track disappear
    // into the menu. Use the slightly stronger hover mix so the track is a
    // distinct inset band; the selected pill (which paints `background`)
    // still pops above it.
    style['--color-secondary'] = popoverHoverBg;
    style['--secondary'] = popoverHoverBg;
    style['--color-secondary-foreground'] = primaryFg;
    style['--secondary-foreground'] = primaryFg;
    style['--color-input'] = popoverHoverBg;
    style['--input'] = popoverHoverBg;
    style['--color-muted'] = popoverHoverBg;
    style['--muted'] = popoverHoverBg;
    style['--color-primary'] = primaryFg;
    style['--primary'] = primaryFg;
    style['--color-primary-foreground'] = bg ?? popoverBg;
    style['--primary-foreground'] = bg ?? popoverBg;
    style['--color-ring'] = primaryFg;
    style['--ring'] = primaryFg;
    // Addition / deletion tints for comment line labels switch between
    // Tailwind's 700 and 400 shades based on whether the chrome surface is
    // dark or light. The global `dark:` variant keys off the app's color
    // mode, but mixed-palette themes like slack-ochin advertise as "light"
    // while rendering a dark sidebar — so emerald-700/rose-700 end up on
    // dark navy with poor contrast. Picking by perceived surface luminance
    // instead keeps the tints legible across every theme.
    const surfaceIsDark = isDarkSurface(bg, primaryFg);
    style['--diffshub-comment-add-fg'] = surfaceIsDark ? '#34d399' : '#047857';
    style['--diffshub-comment-del-fg'] = surfaceIsDark ? '#fb7185' : '#be123c';
    // Hairline between diff files. The static global --color-border-opaque
    // follows the app's light/dark palette, so it goes faint (or mismatched)
    // once the diff renders on a Shiki theme that drifts from it.
    //
    // When the diff (editor) surface matches the sidebar surface — the
    // common case — reuse the chrome border verbatim so the separator can
    // never drift brighter or darker than it. This matters for themes like
    // material-theme that share one bg (#263238) for editor and sidebar but
    // pair it with a near-white editor fg (#EEFFFF) and a dim sidebar fg
    // (#6c8692): deriving the separator from the editor fg would make it far
    // brighter than the chrome border on the very same surface.
    //
    // Only when the palettes genuinely diverge (slack-ochin: dark navy
    // sidebar, white editor) do we derive from the editor surface, so the
    // hairline contrasts the diff body instead of going dark-on-light.
    const editorBg = activeTheme.editorBg ?? bg;
    const editorFg = activeTheme.editorFg ?? primaryFg;
    style['--diffshub-diff-separator'] =
      editorBg == null || surfacesMatch(editorBg, bg)
        ? borderOpaque
        : `color-mix(in srgb, ${editorFg} ${DIFF_BORDER_MIX}%, ${editorBg})`;
  }
  return style as CSSProperties;
}

// Returns true when the chrome surface is perceptually dark. We prefer
// reading the surface's own luminance, but some themes lean on the global
// theme.bg fallback that doesn't survive into treeStyles — so when the bg
// hex isn't parseable we use the primaryFg as a hint (light fg → dark
// surface, the conventional pairing).
function isDarkSurface(bg: string | undefined, primaryFg: string): boolean {
  const fromBg = relativeLuminance(bg);
  if (fromBg != null) return fromBg < 0.4;
  const fromFg = relativeLuminance(primaryFg);
  return fromFg != null ? fromFg > 0.6 : false;
}

// True when two surface colors read as the "same surface" — identical hex,
// or close enough in luminance that a border tuned for one looks right on
// the other. Used to decide whether the diff separator can reuse the chrome
// border (shared surface) or must be re-derived from the editor surface
// (divergent palettes like slack-ochin). Non-hex inputs we can't measure
// are treated as non-matching so we fall back to per-surface derivation.
function surfacesMatch(a: string | undefined, b: string | undefined): boolean {
  if (a == null || b == null) return false;
  if (a.trim().toLowerCase() === b.trim().toLowerCase()) return true;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la == null || lb == null) return false;
  return Math.abs(la - lb) < 0.06;
}

// Parse the leading `#rrggbb` / `#rgb` of a color string and return its
// WCAG-style relative luminance in [0, 1]. Returns null for non-hex inputs
// like `var(...)`, `color-mix(...)`, named colors etc. — those can still
// fall back through `isDarkSurface`'s primaryFg path.
function relativeLuminance(color: string | undefined): number | null {
  if (color == null) return null;
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(color.trim());
  if (match == null) return null;
  const hex = match[1];
  const expanded =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  const r = parseInt(expanded.slice(0, 2), 16) / 255;
  const g = parseInt(expanded.slice(2, 4), 16) / 255;
  const b = parseInt(expanded.slice(4, 6), 16) / 255;
  const channel = (v: number) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// Hook form: resolve the active theme and memoize the chrome style. Used by
// both CodeViewSidebar and CodeViewHeader so the two surfaces stay in sync.
// `activeTheme` is itself memoized inside `useResolvedTreeTheme` (and the
// resolved-theme map caches entries by name), so a single dep is enough —
// the reference only changes when the user actually picks a new theme.
export function useThemeChromeStyle(
  lightTheme: DiffsThemeNames,
  darkTheme: DiffsThemeNames
): CSSProperties | undefined {
  const activeTheme = useResolvedTreeTheme(lightTheme, darkTheme);
  return useMemo(() => buildThemeChromeStyle(activeTheme), [activeTheme]);
}
