import type { TokenBinding } from './messages';
import type { RoleIndex } from './roleIndex';

/**
 * The part of Shiki's `ThemedToken` this module needs. Declared structurally so
 * the mapping stays a pure function that tests can call with plain objects.
 */
export interface MappableToken {
  /** Start offset relative to the whole input, 0-indexed. */
  offset: number;
  content: string;
  color?: string;
}

export interface MapTokensResult {
  bindings: TokenBinding[];
  /** Ranges left untouched because no role claimed their color. */
  unmatchedRanges: number;
  /** The distinct unmatched colors, sorted, for the UI summary. */
  unmatchedColors: string[];
}

const WHITESPACE_ONLY = /^\s*$/;

/**
 * Normalizes a Shiki color to the lowercase `#rrggbb` form the role index is
 * keyed by, dropping a fully opaque `ff` alpha suffix if the theme carries one.
 */
function normalizeColor(color: string): string {
  const lower = color.toLowerCase();
  return lower.length === 9 && lower.endsWith('ff') ? lower.slice(0, 7) : lower;
}

/**
 * Turns tokenized lines into the character ranges the sandbox should bind.
 *
 * Two reductions keep the sandbox's per-range `setRangeFills` calls down, since
 * that is the expensive side of the plugin:
 *
 * - Whitespace-only tokens are skipped. They draw no glyph, so a fill on them
 *   is invisible.
 * - Neighbouring ranges that resolve to the same variable are merged, but only
 *   when they actually touch (`previous.end === token.offset`). A skipped token
 *   or the newline between two lines breaks that adjacency, so merging can
 *   never silently swallow a range it should have left alone.
 */
export function mapTokens(
  lines: readonly (readonly MappableToken[])[],
  index: RoleIndex
): MapTokensResult {
  const bindings: TokenBinding[] = [];
  const unmatchedColors = new Set<string>();
  let unmatchedRanges = 0;

  for (const line of lines) {
    for (const token of line) {
      if (token.content.length === 0) continue;
      if (WHITESPACE_ONLY.test(token.content)) continue;

      if (token.color === undefined) {
        unmatchedRanges += 1;
        continue;
      }

      const color = normalizeColor(token.color);
      const variableName = index.get(color);
      if (variableName === undefined) {
        unmatchedRanges += 1;
        unmatchedColors.add(color);
        continue;
      }

      const end = token.offset + token.content.length;
      const previous = bindings[bindings.length - 1];
      if (
        previous !== undefined &&
        previous.variableName === variableName &&
        previous.end === token.offset
      ) {
        previous.end = end;
        continue;
      }

      bindings.push({ start: token.offset, end, variableName });
    }
  }

  return {
    bindings,
    unmatchedRanges,
    unmatchedColors: [...unmatchedColors].sort(),
  };
}
