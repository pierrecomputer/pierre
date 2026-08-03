/**
 * Guards the Figma variable export written by `theme:build` into figma/. The
 * rules being enforced come from Figma's design-token import:
 *
 *  - Every semantic file becomes one mode, and Figma only creates a variable for
 *    tokens present in *all* imported files — so the token-name sets must match
 *    exactly across modes.
 *  - Cross-collection aliases resolve by name, so each alias target must exist in
 *    the primitives collection.
 *  - Figma creates variables in file order, so palette scales have to be written
 *    light-to-dark rather than in JavaScript's integer-key-first order.
 */
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { hexToRgb01 } from '../src/color';
import { PRIMITIVES_COLLECTION_NAME } from '../src/createFigmaTokens';
import { palettes } from '../src/palettes';

const PRIMITIVES_FILE = 'figma/primitives.json';

const SEMANTIC_FILES = [
  'figma/semantic/light.json',
  'figma/semantic/light-soft.json',
  'figma/semantic/light-protanopia-deuteranopia.json',
  'figma/semantic/light-tritanopia.json',
  'figma/semantic/dark.json',
  'figma/semantic/dark-soft.json',
  'figma/semantic/dark-protanopia-deuteranopia.json',
  'figma/semantic/dark-tritanopia.json',
];

/** Role tokens that carry a literal color instead of aliasing a palette step. */
const EXPECTED_UNALIASED_TOKENS = ['bg/editor', 'accent/contrastOnAccent'];

const LIGHT_FILES = SEMANTIC_FILES.filter((file) =>
  file.includes('/semantic/light')
);

type ColorToken = {
  $type: string;
  $value: {
    colorSpace: string;
    components: [number, number, number];
    alpha: number;
    hex: string;
  };
  $extensions?: {
    'com.figma.aliasData': {
      targetVariableSetName: string;
      targetVariableName: string;
    };
  };
};

type TokenGroup = { [name: string]: ColorToken | TokenGroup };

function isColorToken(node: ColorToken | TokenGroup): node is ColorToken {
  return '$type' in node;
}

/**
 * Flatten a document into the slash-separated names Figma derives from nested
 * groups, so tests can assert on the same names a designer will see.
 */
function readTokens(path: string): Map<string, ColorToken> {
  const document = JSON.parse(readFileSync(path, 'utf8')) as TokenGroup;
  const tokens = new Map<string, ColorToken>();

  const walk = (group: TokenGroup, prefix: string) => {
    for (const [name, node] of Object.entries(group)) {
      const tokenName = prefix === '' ? name : `${prefix}/${name}`;
      if (isColorToken(node)) {
        tokens.set(tokenName, node);
      } else {
        walk(node, tokenName);
      }
    }
  };

  walk(document, '');
  return tokens;
}

const primitives = readTokens(PRIMITIVES_FILE);

describe('figma primitives collection', () => {
  test('covers every palette scale step', () => {
    const expected = Object.entries(palettes).flatMap(([scale, steps]) =>
      Object.keys(steps).map((step) => `${scale}/${step}`)
    );

    assert.deepEqual(
      [...primitives.keys()].sort(),
      expected.sort(),
      `${PRIMITIVES_FILE}: token names do not match the palettes source`
    );
  });

  test('every token is a valid sRGB color whose components match its hex', () => {
    for (const [name, token] of primitives) {
      assert.equal(token.$type, 'color', `${name}: unexpected $type`);
      assert.equal(
        token.$value.colorSpace,
        'srgb',
        `${name}: Figma import only supports srgb and hsl`
      );
      assert.equal(token.$value.alpha, 1, `${name}: unexpected alpha`);
      assert.match(
        token.$value.hex,
        /^#[0-9a-f]{6}$/,
        `${name}: hex is not normalized`
      );

      const expected = hexToRgb01(token.$value.hex).map(
        (channel) => Math.round(channel * 1_000_000) / 1_000_000
      );
      assert.deepEqual(
        token.$value.components,
        expected,
        `${name}: components do not match hex ${token.$value.hex}`
      );
    }
  });

  test('primitives carry no aliases of their own', () => {
    for (const [name, token] of primitives) {
      assert.equal(
        token.$extensions,
        undefined,
        `${name}: primitives should be raw values, not aliases`
      );
    }
  });

  test('each scale is written light-to-dark', () => {
    const contents = readFileSync(PRIMITIVES_FILE, 'utf8');

    for (const [scale, steps] of Object.entries(palettes)) {
      const ordered = Object.keys(steps).sort(
        (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10)
      );
      const positions = ordered.map((step) =>
        contents.indexOf(`"${step}"`, contents.indexOf(`"${scale}":`))
      );

      for (let i = 1; i < positions.length; i++) {
        assert.ok(
          positions[i] > positions[i - 1],
          `${scale}: step ${ordered[i]} is written before ${ordered[i - 1]}`
        );
      }
    }
  });
});

describe('figma semantic collection', () => {
  const tokensByFile = new Map(
    SEMANTIC_FILES.map((file) => [file, readTokens(file)])
  );

  test('every mode declares an identical token-name set', () => {
    const [reference, ...rest] = SEMANTIC_FILES;
    const referenceNames = [...tokensByFile.get(reference)!.keys()].sort();

    assert.ok(referenceNames.length > 0, `${reference}: no tokens found`);

    for (const file of rest) {
      assert.deepEqual(
        [...tokensByFile.get(file)!.keys()].sort(),
        referenceNames,
        `${file}: token names differ from ${reference}, so Figma would drop the mismatched variables`
      );
    }
  });

  for (const [file, tokens] of tokensByFile) {
    describe(file, () => {
      test('aliases resolve to primitives holding the same color', () => {
        for (const [name, token] of tokens) {
          const alias = token.$extensions?.['com.figma.aliasData'];
          if (alias === undefined) {
            continue;
          }

          assert.equal(
            alias.targetVariableSetName,
            PRIMITIVES_COLLECTION_NAME,
            `${name}: unexpected alias collection`
          );

          const target = primitives.get(alias.targetVariableName);
          assert.ok(
            target !== undefined,
            `${name}: alias target ${alias.targetVariableName} is not in ${PRIMITIVES_FILE}`
          );
          assert.equal(
            token.$value.hex,
            target.$value.hex,
            `${name}: alias to ${alias.targetVariableName} disagrees with its own value`
          );
        }
      });

      test('only the known literals are left unaliased', () => {
        const unaliased = [...tokens]
          .filter(([, token]) => token.$extensions === undefined)
          .map(([name]) => name);

        const expected = LIGHT_FILES.includes(file)
          ? EXPECTED_UNALIASED_TOKENS
          : [];

        assert.deepEqual(
          unaliased.sort(),
          [...expected].sort(),
          `${file}: unexpected set of tokens without a palette alias`
        );
      });
    });
  }
});
