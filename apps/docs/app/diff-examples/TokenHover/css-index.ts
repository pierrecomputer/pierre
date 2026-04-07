import _cssData from '@vscode/web-custom-data/data/browsers.css-data.json';

export interface CSSHoverInfo {
  name: string;
  description: string;
  syntax?: string;
  category:
    | 'property'
    | 'custom-property'
    | 'value'
    | 'at-rule'
    | 'selector'
    | 'function';
  mdnURL?: string;
  origin?: string;
  /** CSS specificity as a (A, B, C) tuple string, e.g. "(0, 1, 0)". */
  specificity?: string;
  /** Baseline web-platform status: "high" (widely), "low" (newly), or "false" (limited). */
  baseline?: { status: string; lowDate?: string; highDate?: string };
  /** Spec status when non-standard: "experimental", "nonstandard", or "obsolete". */
  statusBadge?: 'experimental' | 'nonstandard' | 'obsolete';
}

// ---------------------------------------------------------------------------
// VS Code custom data adapter
// ---------------------------------------------------------------------------

interface VSCodeEntry {
  name: string;
  description?: string;
  syntax?: string;
  references?: Array<{ name: string; url: string }>;
  baseline?: {
    status: string;
    baseline_low_date?: string;
    baseline_high_date?: string;
  };
  status?: string;
}

interface VSCodeCSSData {
  properties: VSCodeEntry[];
  atDirectives: VSCodeEntry[];
  pseudoClasses: VSCodeEntry[];
  pseudoElements: VSCodeEntry[];
}

const cssData = _cssData as unknown as VSCodeCSSData;

function mdnUrl(entry: VSCodeEntry): string | undefined {
  return entry.references?.find((r) => r.url.includes('developer.mozilla.org'))
    ?.url;
}

function baselineInfo(
  entry: VSCodeEntry
): CSSHoverInfo['baseline'] | undefined {
  if (entry.baseline == null) return undefined;
  return {
    status: entry.baseline.status,
    lowDate: entry.baseline.baseline_low_date,
    highDate: entry.baseline.baseline_high_date,
  };
}

function statusBadge(
  entry: VSCodeEntry
): CSSHoverInfo['statusBadge'] | undefined {
  if (
    entry.status === 'experimental' ||
    entry.status === 'nonstandard' ||
    entry.status === 'obsolete'
  ) {
    return entry.status;
  }
  return undefined;
}

/**
 * Build one-time indexed lookup maps from the VS Code CSS dataset so that
 * every hover lookup is O(1) instead of scanning arrays.
 */

const propertyByName = new Map<string, CSSHoverInfo>();
for (const e of cssData.properties) {
  if (!e.description) continue;
  propertyByName.set(e.name, {
    name: e.name,
    description: e.description,
    syntax: e.syntax ? `${e.name}: ${e.syntax}` : undefined,
    category: 'property',
    mdnURL: mdnUrl(e),
    baseline: baselineInfo(e),
    statusBadge: statusBadge(e),
  });
}

const atRuleByName = new Map<string, CSSHoverInfo>();
for (const e of cssData.atDirectives) {
  if (!e.description) continue;
  const info: CSSHoverInfo = {
    name: e.name,
    description: e.description,
    category: 'at-rule',
    mdnURL: mdnUrl(e),
    baseline: baselineInfo(e),
    statusBadge: statusBadge(e),
  };
  atRuleByName.set(e.name, info);
  if (e.name.startsWith('@')) {
    atRuleByName.set(e.name.slice(1), info);
  }
}

const pseudoByName = new Map<string, CSSHoverInfo>();
for (const e of cssData.pseudoClasses) {
  if (!e.description) continue;
  pseudoByName.set(e.name, {
    name: e.name,
    description: e.description,
    specificity: '(0, 1, 0)',
    category: 'selector',
    mdnURL: mdnUrl(e),
    baseline: baselineInfo(e),
    statusBadge: statusBadge(e),
  });
}
for (const e of cssData.pseudoElements) {
  if (!e.description) continue;
  pseudoByName.set(e.name, {
    name: e.name,
    description: e.description,
    specificity: '(0, 0, 1)',
    category: 'selector',
    mdnURL: mdnUrl(e),
    baseline: baselineInfo(e),
    statusBadge: statusBadge(e),
  });
}

// ---------------------------------------------------------------------------
// Local overrides — values, functions, and custom properties that the VS Code
// dataset doesn't cover or where demo-specific copy is preferred.
// ---------------------------------------------------------------------------

const CSS_VALUES: Record<string, CSSHoverInfo> = {
  flex: {
    name: 'flex',
    description:
      "A display value that establishes a flex formatting context for the element's contents, enabling flexible box layout.",
    category: 'value',
  },
  grid: {
    name: 'grid',
    description:
      'A display value that establishes a grid formatting context, enabling powerful two-dimensional layout.',
    category: 'value',
  },
  none: {
    name: 'none',
    description:
      'Removes the element from the layout entirely — it is not rendered and takes up no space.',
    category: 'value',
  },
  center: {
    name: 'center',
    description:
      'Centers items along the relevant axis. Used with align-items, justify-content, text-align, and others.',
    category: 'value',
  },
  'space-between': {
    name: 'space-between',
    description:
      'Distributes items evenly — the first item is flush with the start, the last flush with the end.',
    category: 'value',
  },
  'space-around': {
    name: 'space-around',
    description:
      'Distributes items evenly with equal space around each item (half-size spaces on the edges).',
    category: 'value',
  },
  auto: {
    name: 'auto',
    description:
      'Lets the browser calculate and select a value automatically based on context.',
    category: 'value',
  },
  inherit: {
    name: 'inherit',
    description:
      'Causes the property to take the computed value of its parent element.',
    category: 'value',
  },
  'inline-size': {
    name: 'inline-size',
    description:
      'A container-type value that enables container queries on the inline dimension (width in horizontal writing modes). Used in the container shorthand after the / separator, e.g. container: cards / inline-size.',
    category: 'value',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/container-type',
  },
  column: {
    name: 'column',
    description:
      'A flex-direction value that arranges flex items vertically from top to bottom.',
    category: 'value',
  },
  wrap: {
    name: 'wrap',
    description:
      'A flex-wrap value that allows flex items to flow onto multiple lines.',
    category: 'value',
  },
  nowrap: {
    name: 'nowrap',
    description: 'Prevents wrapping — all items are forced onto a single line.',
    category: 'value',
  },
  pointer: {
    name: 'pointer',
    description:
      'A cursor value that shows a pointing hand, indicating a link or interactive element.',
    category: 'value',
  },
  relative: {
    name: 'relative',
    description:
      'Positions the element relative to its normal position. Creates a new stacking context for absolutely-positioned children.',
    category: 'value',
  },
  absolute: {
    name: 'absolute',
    description:
      'Removes the element from normal flow and positions it relative to its nearest positioned ancestor.',
    category: 'value',
  },
  sticky: {
    name: 'sticky',
    description:
      'Toggles between relative and fixed positioning depending on the scroll position. The element sticks when it reaches a threshold.',
    category: 'value',
  },
  hidden: {
    name: 'hidden',
    description:
      "An overflow value that clips content at the element's padding box without providing a scrollbar.",
    category: 'value',
  },
  solid: {
    name: 'solid',
    description: 'A border-style value that renders a single solid line.',
    category: 'value',
  },
  transparent: {
    name: 'transparent',
    description: 'A fully transparent color — equivalent to rgba(0, 0, 0, 0).',
    category: 'value',
  },
  ellipsis: {
    name: 'ellipsis',
    description:
      'A text-overflow value that renders an ellipsis (\u2026) to represent clipped text.',
    category: 'value',
  },
  'min-width': {
    name: 'min-width',
    description:
      'A media or container query feature that tests whether the viewport or container is at least the given width.',
    syntax: '(min-width: <length>)',
    category: 'value',
  },
  '1fr': {
    name: '1fr',
    description:
      'One fractional unit — represents a share of the available space in a grid container. Tracks sized with fr divide leftover space proportionally.',
    category: 'value',
  },
  components: {
    name: 'components',
    description:
      'A cascade layer name. Layers let you control specificity ordering. Rules inside @layer components { ... } can be overridden by unlayered styles or later layers.',
    category: 'value',
  },
};

const CSS_FUNCTIONS: Record<string, CSSHoverInfo> = {
  var: {
    name: 'var()',
    description:
      'Inserts the value of a CSS custom property (variable), with an optional fallback if the property is not defined.',
    syntax: 'var(--<name>, <fallback>?)',
    category: 'function',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/var',
  },
  calc: {
    name: 'calc()',
    description:
      'Performs calculations to determine CSS property values, mixing units freely (e.g. calc(100% - 2rem)).',
    syntax: 'calc(<expression>)',
    category: 'function',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/calc',
  },
  minmax: {
    name: 'minmax()',
    description:
      'Defines a size range for grid tracks — the track will be at least the minimum and at most the maximum.',
    syntax: 'minmax(<min>, <max>)',
    category: 'function',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/minmax',
  },
  repeat: {
    name: 'repeat()',
    description:
      'Repeats a track pattern in grid-template-columns or grid-template-rows, reducing repetition.',
    syntax: 'repeat(<count> | auto-fill | auto-fit, <track-list>)',
    category: 'function',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/repeat',
  },
  rgb: {
    name: 'rgb()',
    description:
      'Specifies a color using red, green, and blue channels, optionally with alpha for transparency.',
    syntax: 'rgb(<red> <green> <blue> [ / <alpha> ]?)',
    category: 'function',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/rgb',
  },
  hsl: {
    name: 'hsl()',
    description:
      'Specifies a color using hue, saturation, and lightness, often more intuitive for humans than RGB.',
    syntax: 'hsl(<hue> <saturation> <lightness> [ / <alpha> ]?)',
    category: 'function',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/hsl',
  },
};

/**
 * Known custom properties with their origin file and resolved value.
 * Simulates what an LSP would surface from a real design token pipeline.
 */
const CSS_CUSTOM_PROPERTIES: Record<string, CSSHoverInfo> = {
  '--color-surface': {
    name: '--color-surface',
    description:
      'The default background color for elevated surfaces like cards, dialogs, and popovers.',
    syntax: '--color-surface: oklch(0.97 0.001 240)',
    category: 'custom-property',
    origin: 'tokens.css:14',
    mdnURL:
      'https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties',
  },
  '--color-border': {
    name: '--color-border',
    description:
      'The standard border color for interactive and structural elements.',
    syntax: '--color-border: oklch(0.82 0.01 240)',
    category: 'custom-property',
    origin: 'tokens.css:18',
    mdnURL:
      'https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties',
  },
  '--color-accent': {
    name: '--color-accent',
    description:
      'The primary accent color used for focus rings, active states, and interactive highlights.',
    syntax: '--color-accent: oklch(0.62 0.20 255)',
    category: 'custom-property',
    origin: 'tokens.css:22',
    mdnURL:
      'https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties',
  },
  '--color-text': {
    name: '--color-text',
    description: 'The primary text color for body content.',
    syntax: '--color-text: oklch(0.20 0.02 240)',
    category: 'custom-property',
    origin: 'tokens.css:6',
    mdnURL:
      'https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties',
  },
  '--color-text-muted': {
    name: '--color-text-muted',
    description:
      'A subdued text color for secondary content, captions, and placeholders.',
    syntax: '--color-text-muted: oklch(0.55 0.01 240)',
    category: 'custom-property',
    origin: 'tokens.css:10',
    mdnURL:
      'https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties',
  },
};

// ---------------------------------------------------------------------------
// Dynamic selector patterns — structural selectors that need runtime logic.
// Individual pseudo-classes/elements are handled by the pseudoByName map.
// ---------------------------------------------------------------------------

const SELECTOR_PATTERNS: Array<{
  test: (token: string) => boolean;
  getInfo: (token: string) => CSSHoverInfo;
}> = [
  {
    test: (t) => t === '&',
    getInfo: () => ({
      name: '&',
      description:
        'The nesting selector — refers to the selector of the parent rule. Enables native CSS nesting without a preprocessor. Takes the specificity of its parent selector.',
      syntax: '.parent { & .child { ... } }',
      category: 'selector',
      mdnURL:
        'https://developer.mozilla.org/en-US/docs/Web/CSS/Nesting_selector',
    }),
  },
  {
    test: (t) => t.startsWith('&:') && t.length > 2,
    getInfo: (t) => {
      const pseudo = t.slice(1);
      const result = lookupCSSToken(pseudo);
      if (result != null && result.category === 'selector') {
        return {
          ...result,
          name: t,
          description: `Nested ${result.name} — the & refers to the parent rule's selector. ${result.description}`,
        };
      }
      return {
        name: t,
        description: `Nested pseudo-class — & refers to the parent selector, combined with the ${pseudo} pseudo-class.`,
        category: 'selector',
        mdnURL:
          'https://developer.mozilla.org/en-US/docs/Web/CSS/Nesting_selector',
      };
    },
  },
  {
    test: (t) => t.startsWith('::'),
    getInfo: (t) => ({
      name: t,
      description: `Pseudo-element — targets a specific part of the selected element (e.g. ${t}).`,
      specificity: '(0, 0, 1)',
      category: 'selector',
      mdnURL: `https://developer.mozilla.org/en-US/docs/Web/CSS/${t}`,
    }),
  },
  {
    test: (t) => t.length > 1 && t.startsWith(':') && !t.startsWith('::'),
    getInfo: (t) => ({
      name: t,
      description: `Pseudo-class — selects elements based on state or structural position (${t}).`,
      specificity: '(0, 1, 0)',
      category: 'selector',
    }),
  },
  {
    test: (t) => t.startsWith('.') && t.length > 1,
    getInfo: (t) => ({
      name: t,
      description: `Class selector — matches elements with class="${t.slice(1)}" in their class list. Multiple classes can be chained for higher specificity.`,
      syntax: `${t} { ... }`,
      specificity: '(0, 1, 0)',
      category: 'selector',
      mdnURL:
        'https://developer.mozilla.org/en-US/docs/Web/CSS/Class_selectors',
    }),
  },
  {
    test: (t) => t.startsWith('#') && t.length > 1,
    getInfo: (t) => ({
      name: t,
      description: `ID selector — matches the element with id="${t.slice(1)}". IDs should be unique per page. Higher specificity than classes.`,
      syntax: `${t} { ... }`,
      specificity: '(1, 0, 0)',
      category: 'selector',
      mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/ID_selectors',
    }),
  },
];

// ---------------------------------------------------------------------------
// Lookup functions
// ---------------------------------------------------------------------------

/**
 * Look up a CSS token by its text and return hover documentation if available.
 * Checks properties, then at-rules, then functions, then values, then
 * selector patterns. Returns null for punctuation, whitespace, and unknown tokens.
 *
 * Shiki sometimes bundles trailing ` {` into a token (e.g. `&:hover {`),
 * so we strip that before matching.
 */
export function lookupCSSToken(tokenText: string): CSSHoverInfo | null {
  const trimmed = tokenText.trim().replace(/\s*\{$/, '');
  if (trimmed.length === 0) return null;

  // Functions (local)
  if (CSS_FUNCTIONS[trimmed] != null) return CSS_FUNCTIONS[trimmed];

  // Values (local) — checked before properties so curated value descriptions
  // take priority when a name is both a value keyword and a property
  // (e.g. "flex" in `display: flex` vs. the `flex` shorthand property).
  if (CSS_VALUES[trimmed] != null) return CSS_VALUES[trimmed];

  // Properties (VS Code data)
  const prop = propertyByName.get(trimmed);
  if (prop != null) return prop;

  // At-rules (VS Code data, includes bare keyword variants)
  const atRule = atRuleByName.get(trimmed);
  if (atRule != null) return atRule;

  // Custom properties — check known registry first, then fall back to generic
  if (trimmed.startsWith('--') && trimmed.length > 2) {
    if (CSS_CUSTOM_PROPERTIES[trimmed] != null) {
      return CSS_CUSTOM_PROPERTIES[trimmed];
    }
    return {
      name: trimmed,
      description: `Custom property (CSS variable). Set with ${trimmed}: <value> and read with var(${trimmed}).`,
      category: 'custom-property',
      mdnURL:
        'https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties',
    };
  }

  // Pseudo-classes and pseudo-elements (VS Code data).
  // Functional pseudos like :not may arrive as ":not" or ":not(" from Shiki.
  const pseudo =
    pseudoByName.get(trimmed) ??
    (trimmed.endsWith('(')
      ? pseudoByName.get(trimmed + ')')
      : pseudoByName.get(trimmed + '()'));
  if (pseudo != null) return pseudo;

  // Dynamic selector patterns (& nesting, .class, #id, catch-all pseudos)
  for (const pattern of SELECTOR_PATTERNS) {
    if (pattern.test(trimmed)) return pattern.getInfo(trimmed);
  }

  // Some themes bundle a property name with its value into one token
  // (e.g. "container: cards"). Extract the property and value, then return
  // a value-level description when available, otherwise the property info.
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx > 0) {
    const propName = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (value.length > 0) {
      const valueInfo = lookupCSSPropertyValue(propName, value);
      if (valueInfo != null) return valueInfo;
    }
    const propInfo = propertyByName.get(propName);
    if (propInfo != null) return propInfo;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Value-context lookup — provides value-specific hover info when the
// tokenizer separates a property name from its value.
// ---------------------------------------------------------------------------

/**
 * Generates value-level descriptions for property values that are
 * multi-part shorthands or otherwise benefit from contextual explanation.
 */
const VALUE_DESCRIPTIONS: Record<
  string,
  (value: string) => CSSHoverInfo | null
> = {
  container: (value) => {
    const parts = value.split('/').map((s) => s.trim());
    const name = parts[0] ?? '';
    const type = parts[1] ?? '';
    if (name.length > 0 && type.length > 0) {
      return {
        name: `${name} / ${type}`,
        description: `Shorthand value for the container property. Sets container-name to "${name}" and container-type to ${type}. Equivalent to writing container-name: ${name} and container-type: ${type} separately.`,
        syntax: `container: ${name} / ${type}`,
        category: 'value',
        mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/container',
      };
    }
    if (name.length > 0) {
      return {
        name,
        description: `Container name — identifies this containment context so @container rules can target it with @container ${name} (...).`,
        syntax: `container: ${name} / <type>`,
        category: 'value',
        mdnURL:
          'https://developer.mozilla.org/en-US/docs/Web/CSS/container-name',
      };
    }
    return null;
  },
  'text-wrap': (value) => {
    const keywords: Record<string, string> = {
      balance:
        'Balances line lengths across the block so no line is significantly shorter. Best for short blocks like headings.',
      pretty:
        'Optimises for better typography by avoiding orphans, even at the cost of slower layout.',
      stable:
        'Keeps wrap positions stable during editing — useful for contenteditable or live-updating text.',
      nowrap: 'Prevents the text from wrapping to a new line.',
      wrap: 'Normal wrapping behavior.',
    };
    const desc = keywords[value];
    if (desc == null) return null;
    return {
      name: value,
      description: desc,
      syntax: `text-wrap: ${value}`,
      category: 'value',
      mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/text-wrap',
    };
  },
  'text-box-trim': (value) => {
    const keywords: Record<string, string> = {
      'trim-start':
        'Trims the leading (over) half-leading space from the first formatted line of the block.',
      'trim-end':
        'Trims the trailing (under) half-leading space from the last formatted line of the block.',
      'trim-both':
        'Trims half-leading space from both the first and last formatted lines.',
      none: 'No half-leading trimming is applied.',
    };
    const desc = keywords[value];
    if (desc == null) return null;
    return {
      name: value,
      description: desc,
      syntax: `text-box-trim: ${value}`,
      category: 'value',
      mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/text-box-trim',
    };
  },
  'text-box-edge': (value) => {
    return {
      name: value.trim(),
      description: `Specifies the text box metric edges to use: "${value}". The first keyword sets the over-edge metric, the second (if present) sets the under-edge metric.`,
      syntax: `text-box-edge: ${value}`,
      category: 'value',
      mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/text-box-edge',
    };
  },
  'margin-trim': (value) => {
    const keywords: Record<string, string> = {
      none: 'No margins are trimmed by the container.',
      'in-flow':
        "Trims the margins of in-flow children where they adjoin the container's block-start and block-end edges, collapsing them to zero.",
      all: 'Trims the margins of all children (in-flow and floats) where they adjoin any container edge.',
    };
    const desc = keywords[value];
    if (desc == null) return null;
    return {
      name: value,
      description: desc,
      syntax: `margin-trim: ${value}`,
      category: 'value',
      mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/margin-trim',
    };
  },
  transition: (value) => {
    const entries = value.split(',').map((s) => s.trim());
    if (entries.length === 0) return null;
    const parsed = entries
      .map((entry) => {
        const parts = entry.split(/\s+/);
        return parts[0] ?? '';
      })
      .filter((p) => p.length > 0);
    if (parsed.length === 0) return null;
    return {
      name: value.trim(),
      description: `Transition shorthand value. Animates ${parsed.map((p) => `"${p}"`).join(' and ')} when they change.`,
      syntax: `transition: ${parsed.join(', ')} <duration> <timing>? <delay>?`,
      category: 'value',
      mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/transition',
    };
  },
};

/**
 * Look up a property value in context. When the tokenizer separates a
 * property name from its value, this provides value-specific hover info
 * rather than showing the generic property description.
 */
export function lookupCSSPropertyValue(
  property: string,
  rawValue: string
): CSSHoverInfo | null {
  const value = rawValue.trim();
  if (value.length === 0) return null;

  if (CSS_VALUES[value] != null) return CSS_VALUES[value];

  const describer = VALUE_DESCRIPTIONS[property];
  if (describer != null) return describer(value);

  return null;
}
