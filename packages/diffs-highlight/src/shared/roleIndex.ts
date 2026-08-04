import darkTokens from '@pierre/theme/figma/semantic/dark.json';

/**
 * Maps a resolved token color back to the Figma variable that produced it.
 *
 * Shiki hands us colors, but binding a variable needs a name (`syntax/keyword`).
 * All eight Pierre variants share one scope table and differ only in resolved
 * color, so the role a color stands for can be recovered from any single
 * variant and then bound by name — Figma resolves the actual color per mode.
 * `pierre-dark` is the variant used for that lookup (its 18 `syntax/*` colors
 * are all distinct, unlike the tritanopia variants where five collapse into
 * one), which is why the index is built from the committed `dark.json`.
 */
export type RoleIndex = ReadonlyMap<string, string>;

/** Shiki theme name whose colors the index is keyed by. */
export const PROBE_THEME_NAME = 'pierre-dark';

/**
 * Groups scanned when a color is not a `syntax/*` color, in the order they are
 * scanned. `bg` and `border` are left out entirely: they are surface colors
 * that never apply to glyphs, and including them would let a background color
 * win over the foreground role that shares its hex.
 */
const FALLBACK_GROUPS = ['states', 'accent', 'ansi', 'fg'] as const;

const SYNTAX_GROUP = 'syntax';

interface ColorToken {
  $value: { hex: string };
}

interface TokenGroup {
  [key: string]: ColorToken | TokenGroup;
}

function isColorToken(node: ColorToken | TokenGroup): node is ColorToken {
  return '$value' in node;
}

/**
 * Walks one group of the token document and records `hex -> variableName` for
 * every color token it contains, without overwriting a hex already claimed by
 * an earlier (higher priority) group.
 */
function indexGroup(
  into: Map<string, string>,
  group: TokenGroup,
  path: string[]
): void {
  for (const [key, node] of Object.entries(group)) {
    const nextPath = [...path, key];
    if (isColorToken(node)) {
      const hex = node.$value.hex.toLowerCase();
      if (!into.has(hex)) into.set(hex, nextPath.join('/'));
      continue;
    }
    indexGroup(into, node, nextPath);
  }
}

/**
 * Builds the color-to-variable-name index from a semantic token document.
 *
 * `baseForegroundHex` is the probe theme's `editor.foreground`, which Shiki
 * emits for any text no grammar scope claims. That color is also `syntax/invalid`
 * in every Pierre variant, so it is resolved last and unconditionally to
 * `fg/base`: plain code is common, invalid code is not, and mapping every
 * unscoped character onto `syntax/invalid` would tint whole samples wrong.
 */
export function buildRoleIndex(
  tokens: TokenGroup,
  baseForegroundHex: string
): RoleIndex {
  const index = new Map<string, string>();

  const syntaxGroup = tokens[SYNTAX_GROUP];
  if (syntaxGroup !== undefined && !isColorToken(syntaxGroup)) {
    indexGroup(index, syntaxGroup, [SYNTAX_GROUP]);
  }

  for (const groupName of FALLBACK_GROUPS) {
    const group = tokens[groupName];
    if (group === undefined || isColorToken(group)) continue;
    indexGroup(index, group, [groupName]);
  }

  index.set(baseForegroundHex.toLowerCase(), 'fg/base');

  return index;
}

/** The index for `pierre-dark`, built from the committed token export. */
export function createRoleIndex(baseForegroundHex: string): RoleIndex {
  return buildRoleIndex(darkTokens as unknown as TokenGroup, baseForegroundHex);
}
