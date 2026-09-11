import type { DiffIndicators, SelectedLineRange } from '@pierre/diffs';

// The playground's URL state, parsed identically on the server (to build the
// prerendered payload) and on the client (to seed component state). The
// prerendered markup paints before hydration, so any parameter the two sides
// derived differently would show the server's presentation until the first
// client repaint — one parser, consumed by both, removes that class of drift.

export const LIGHT_THEMES = [
  'pierre-light',
  'pierre-light-soft',
  'catppuccin-latte',
  'github-light',
  'one-light',
  'solarized-light',
] as const;

export const DARK_THEMES = [
  'pierre-dark',
  'pierre-dark-soft',
  'catppuccin-mocha',
  'dracula',
  'github-dark',
  'one-dark-pro',
  'tokyo-night',
  'vitesse-dark',
] as const;

export type PlaygroundLightTheme = (typeof LIGHT_THEMES)[number];
export type PlaygroundDarkTheme = (typeof DARK_THEMES)[number];

const VIEW_MODES = [
  'diff',
  'file',
  'virtualizer',
  'virtualizer-element',
  'codeview',
] as const;

const DIFF_STYLES = ['split', 'unified'] as const;
const COLOR_MODES = ['system', 'light', 'dark'] as const;
const DIFF_INDICATORS = ['bars', 'classic', 'none'] as const;
const LINE_DIFF_TYPES = ['word-alt', 'word', 'char', 'none'] as const;
const HUNK_SEPARATOR_VALUES = [
  'line-info',
  'line-info-basic',
  'simple',
  'metadata',
] as const;
const LINE_HOVER_HIGHLIGHTS = ['disabled', 'both', 'number', 'line'] as const;
const LINE_MODES = ['select', 'comment', 'none'] as const;

// The syntax-highlighting implementation diffs renders with: shiki (the
// default TextMate pipeline) or the experimental wasm-based highlights lexers.
const HIGHLIGHTERS = ['shiki', 'highlights'] as const;
export type PlaygroundHighlighter = (typeof HIGHLIGHTERS)[number];

// The rendering view used by the playground. 'diff' and 'file' render one
// directly controlled component; the virtualizer modes render scrolling lists;
// 'codeview' renders a mixed list in CodeView's own scroller.
export type ViewMode = (typeof VIEW_MODES)[number];

export type HunkSeparatorValue = (typeof HUNK_SEPARATOR_VALUES)[number];
export type LineHoverHighlight = (typeof LINE_HOVER_HIGHLIGHTS)[number];
export type PlaygroundLineDiffType = (typeof LINE_DIFF_TYPES)[number];

// Default values for URL param comparison
export const DEFAULTS = {
  viewMode: 'diff' as ViewMode,
  diffStyle: 'split',
  colorMode: 'system',
  lightTheme: 'pierre-light',
  darkTheme: 'pierre-dark',
  diffIndicators: 'bars',
  lineDiffType: 'word-alt',
  lineHoverHighlight: 'disabled' as LineHoverHighlight,
  hunkSeparators: 'line-info' as HunkSeparatorValue,
  background: true,
  lineNumbers: true,
  wrap: true,
  lineSelection: true,
  gutterButton: true,
  interactionMode: 'comment' as const,
  annotations: true,
  editPrediction: false,
  edit: false,
  markers: false,
  highlighter: 'shiki' as PlaygroundHighlighter,
} as const;

export interface PlaygroundUrlState {
  viewMode: ViewMode;
  diffStyle: (typeof DIFF_STYLES)[number];
  colorMode: (typeof COLOR_MODES)[number];
  lightTheme: PlaygroundLightTheme;
  darkTheme: PlaygroundDarkTheme;
  diffIndicators: DiffIndicators;
  lineDiffType: PlaygroundLineDiffType;
  lineHoverHighlight: LineHoverHighlight;
  hunkSeparators: HunkSeparatorValue;
  disableBackground: boolean;
  disableLineNumbers: boolean;
  overflow: 'wrap' | 'scroll';
  enableLineSelection: boolean;
  enableGutterUtility: boolean;
  showAnnotations: boolean;
  editPrediction: boolean;
  edit: boolean;
  showMarkers: boolean;
  highlighter: PlaygroundHighlighter;
  selectedRange: SelectedLineRange | null;
}

// Narrows a raw param to one of the allowed values, falling back for absent
// or unrecognized input, so garbage in the URL degrades to the default
// instead of leaking into render options.
function pick<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T
): T {
  return allowed.find((option) => option === value) ?? fallback;
}

function pickBool(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  return value === '1' || value === 'true';
}

// Selected line range format: L15a (line 15 additions), L28-35a (lines 28-35
// additions), L10d (line 10 deletions).
function parseLineSelection(value: string | null): SelectedLineRange | null {
  if (value == null) return null;
  const match = value.match(/^(\d+)(?:-(\d+))?([ad])$/);
  if (match == null) return null;
  const start = parseInt(match[1], 10);
  const end = match[2] != null ? parseInt(match[2], 10) : start;
  const side: 'additions' | 'deletions' =
    match[3] === 'd' ? 'deletions' : 'additions';
  return { start, end, side };
}

export function parsePlaygroundSearchParams(
  get: (key: string) => string | null
): PlaygroundUrlState {
  const viewMode = pick(get('view'), VIEW_MODES, DEFAULTS.viewMode);

  // `lineMode` is the combined interaction switch; when absent, the separate
  // legacy `select`/`gutter` booleans apply.
  const lineModeParam = get('lineMode');
  const lineMode =
    LINE_MODES.find((option) => option === lineModeParam) ?? null;
  const enableLineSelection =
    lineMode != null
      ? lineMode === 'select'
      : pickBool(get('select'), DEFAULTS.lineSelection);
  const enableGutterUtility =
    lineMode != null
      ? lineMode === 'comment'
      : pickBool(get('gutter'), DEFAULTS.gutterButton);

  return {
    viewMode,
    diffStyle: pick(get('layout'), DIFF_STYLES, 'split'),
    colorMode: pick(get('mode'), COLOR_MODES, 'system'),
    lightTheme: pick(get('light'), LIGHT_THEMES, DEFAULTS.lightTheme),
    darkTheme: pick(get('dark'), DARK_THEMES, DEFAULTS.darkTheme),
    diffIndicators: pick(get('indicators'), DIFF_INDICATORS, 'bars'),
    lineDiffType: pick(get('inline'), LINE_DIFF_TYPES, 'word-alt'),
    lineHoverHighlight: pick(
      get('hover'),
      LINE_HOVER_HIGHLIGHTS,
      DEFAULTS.lineHoverHighlight
    ),
    hunkSeparators: pick(
      get('hunks'),
      HUNK_SEPARATOR_VALUES,
      DEFAULTS.hunkSeparators
    ),
    disableBackground: !pickBool(get('bg'), DEFAULTS.background),
    disableLineNumbers: !pickBool(get('ln'), DEFAULTS.lineNumbers),
    overflow: pickBool(get('wrap'), DEFAULTS.wrap) ? 'wrap' : 'scroll',
    enableLineSelection,
    enableGutterUtility,
    showAnnotations: pickBool(get('annot'), DEFAULTS.annotations),
    editPrediction: pickBool(get('predict'), DEFAULTS.editPrediction),
    // Only the direct File and FileDiff views carry their edit session in the
    // URL; the scrolling views own per-file controls instead.
    edit:
      (viewMode === 'diff' || viewMode === 'file') && get('edit') === 'edit',
    showMarkers: pickBool(get('markers'), DEFAULTS.markers),
    highlighter: pick(get('hl'), HIGHLIGHTERS, DEFAULTS.highlighter),
    selectedRange: parseLineSelection(get('line')),
  };
}
