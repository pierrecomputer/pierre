// Figma variable export. Emits Design Tokens Community Group (DTCG) JSON that
// Figma can import directly from its Variables view, in two collections:
//
//   Primitives — every palette scale step, one mode. Written once.
//   Semantic   — the Roles surface, one file per theme variant. Figma turns each
//                imported file into a mode, and its values alias the primitives.
//
// Figma only creates a variable for tokens present in *every* file imported into
// a collection, so all semantic modes must emit an identical token-name set. The
// Display P3 "vibrant" variants are deliberately not exported: Figma import only
// supports the sRGB and HSL color spaces.

import { hexToRgb01 } from './color';
import { palettes } from './palettes';
import type { Roles } from './roles';

/**
 * The Figma collection that holds the palette primitives. Semantic tokens name
 * it as their alias target, so the collection created in Figma must match it
 * exactly for cross-collection aliases to resolve.
 */
export const PRIMITIVES_COLLECTION_NAME = 'Pierre Primitives';

/**
 * Role values that intentionally live outside the palette scales, so they import
 * as plain color literals rather than aliases. Any *other* role value missing
 * from the palette index means roles and palettes have drifted apart, which
 * fails the build instead of silently producing an unlinked variable.
 */
const UNALIASED_ROLE_COLORS = new Set(['#ffffff']);

type FigmaColorValue = {
  colorSpace: 'srgb';
  components: [number, number, number];
  alpha: number;
  hex: string;
};

/** Figma's extension for pointing a token at a variable in another collection. */
type FigmaAliasData = {
  targetVariableSetName: string;
  targetVariableName: string;
};

type ColorToken = {
  $type: 'color';
  $value: FigmaColorValue;
  $extensions?: { 'com.figma.aliasData': FigmaAliasData };
};

/**
 * A DTCG document: nested groups of tokens, which Figma flattens into
 * slash-separated variable names (`{ bg: { editor } }` imports as `bg/editor`).
 *
 * Groups are Maps rather than plain objects to keep authored order. Palette steps
 * like "100" are integer-like keys, which `JSON.stringify` hoists ahead of
 * leading-zero keys like "020" — that would list each scale's lightest steps
 * after its darkest in Figma. See `stringifyFigmaTokens`.
 */
export type FigmaTokenDocument = Map<string, ColorToken | FigmaTokenDocument>;

/** Expand shorthand hex and lowercase it so lookups and output stay consistent. */
function normalizeHex(color: string): string {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (match === null) {
    throw new Error(
      `Cannot export "${color}" as a Figma color: expected a #rgb or #rrggbb hex value.`
    );
  }

  const digits = match[1].toLowerCase();
  const expanded =
    digits.length === 3
      ? digits
          .split('')
          .map((d) => d + d)
          .join('')
      : digits;

  return `#${expanded}`;
}

/**
 * Build the DTCG color value Figma expects. `components` are the sRGB channels
 * in the 0–1 range; the redundant `hex` is what Figma shows in its UI.
 */
function figmaColor(hex: string): FigmaColorValue {
  const normalized = normalizeHex(hex);
  const [r, g, b] = hexToRgb01(normalized);

  return {
    colorSpace: 'srgb',
    components: [round6(r), round6(g), round6(b)],
    alpha: 1,
    hex: normalized,
  };
}

function round6(channel: number): number {
  return Math.round(channel * 1_000_000) / 1_000_000;
}

/**
 * A scale's steps ordered light-to-dark by numeric value. Reading the object
 * directly would not do: JavaScript hoists integer-like keys ("100") ahead of
 * leading-zero ones ("020") on any plain object, so `Object.entries` hands back
 * every scale with its lightest steps last.
 */
function paletteSteps(scale: Record<string, string>): [string, string][] {
  return Object.entries(scale).sort(
    ([a], [b]) => Number.parseInt(a, 10) - Number.parseInt(b, 10)
  );
}

/**
 * Reverse index from palette hex to primitive token name (e.g. `blue/500`), used
 * to turn a flat role hex back into an alias. Palette scales are all distinct
 * today; should two ever share a hex, the first one in `palettes` order wins so
 * output stays deterministic.
 */
function buildPrimitiveIndex(): Map<string, string> {
  const index = new Map<string, string>();

  for (const [scaleName, scale] of Object.entries(palettes)) {
    for (const [step, hex] of paletteSteps(scale)) {
      const key = normalizeHex(hex);
      if (!index.has(key)) {
        index.set(key, `${scaleName}/${step}`);
      }
    }
  }

  return index;
}

const primitiveNamesByHex = buildPrimitiveIndex();

/** Every palette scale step as a single-mode Primitives collection document. */
export function createFigmaPrimitives(): FigmaTokenDocument {
  const document: FigmaTokenDocument = new Map();

  for (const [scaleName, scale] of Object.entries(palettes)) {
    const group: FigmaTokenDocument = new Map();
    for (const [step, hex] of paletteSteps(scale)) {
      group.set(step, { $type: 'color', $value: figmaColor(hex) });
    }
    document.set(scaleName, group);
  }

  return document;
}

/**
 * One theme variant as a Semantic collection document — a Figma mode once
 * imported. Token names mirror the `Roles` shape (`bg/editor`, `syntax/keyword`)
 * so they are identical across every variant.
 */
export function createFigmaSemanticMode(roles: Roles): FigmaTokenDocument {
  const document: FigmaTokenDocument = new Map();
  const groups = Object.entries(roles) as [string, Record<string, string>][];

  for (const [groupName, group] of groups) {
    const tokens: FigmaTokenDocument = new Map();
    for (const [roleName, color] of Object.entries(group)) {
      tokens.set(roleName, semanticToken(`${groupName}/${roleName}`, color));
    }
    document.set(groupName, tokens);
  }

  return document;
}

/**
 * A semantic token always carries a concrete color so the file imports on its
 * own, plus an alias to the matching primitive when one exists so Figma links
 * the two collections.
 */
function semanticToken(tokenName: string, color: string): ColorToken {
  const value = figmaColor(color);
  const target = primitiveNamesByHex.get(value.hex);

  if (target === undefined) {
    if (!UNALIASED_ROLE_COLORS.has(value.hex)) {
      throw new Error(
        `Role "${tokenName}" uses ${value.hex}, which is not in any palette scale. ` +
          `Point it at a palette step, or add the hex to UNALIASED_ROLE_COLORS if it ` +
          `is meant to be a standalone literal.`
      );
    }
    return { $type: 'color', $value: value };
  }

  return {
    $type: 'color',
    $value: value,
    $extensions: {
      'com.figma.aliasData': {
        targetVariableSetName: PRIMITIVES_COLLECTION_NAME,
        targetVariableName: target,
      },
    },
  };
}

/**
 * Render a document as JSON with groups in authored order, matching what
 * `JSON.stringify(value, null, 2)` would produce apart from that ordering.
 * Figma creates variables in file order, so this is what keeps each palette
 * scale reading light-to-dark in the Variables view.
 */
export function stringifyFigmaTokens(document: FigmaTokenDocument): string {
  return `${serializeGroup(document, 0)}\n`;
}

function serializeGroup(group: FigmaTokenDocument, depth: number): string {
  const indent = '  '.repeat(depth + 1);
  const entries = [...group].map(([name, node]) => {
    const serialized =
      node instanceof Map
        ? serializeGroup(node, depth + 1)
        : // Leaf tokens have no integer-like keys, so plain stringify is safe;
          // its newlines just need shifting to this group's depth.
          JSON.stringify(node, null, 2).replaceAll('\n', `\n${indent}`);

    return `${indent}${JSON.stringify(name)}: ${serialized}`;
  });

  return `{\n${entries.join(',\n')}\n${'  '.repeat(depth)}}`;
}
