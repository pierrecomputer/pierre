/**
 * Covers the two pure pieces the plugin's correctness rests on: recovering a
 * role name from a resolved color (`roleIndex`) and turning tokens into the
 * character ranges the sandbox binds (`mapTokens`).
 */
import { describe, expect, test } from 'bun:test';

import { type MappableToken, mapTokens } from '../src/shared/mapTokens';
import { createRoleIndex } from '../src/shared/roleIndex';

/** `pierre-dark`'s `editor.foreground`, which is also `fg/base`. */
const BASE_FOREGROUND = '#fafafa';

const index = createRoleIndex(BASE_FOREGROUND);

/** Builds a single line of tokens with offsets derived from the contents. */
function line(
  tokens: { content: string; color?: string }[]
): MappableToken[][] {
  let offset = 0;
  return [
    tokens.map((token) => {
      const mapped = { ...token, offset };
      offset += token.content.length;
      return mapped;
    }),
  ];
}

describe('createRoleIndex', () => {
  test('every syntax role resolves back to its own variable name', () => {
    // The probe theme is only usable if its syntax colors are distinct, so this
    // asserts the property the whole design depends on rather than a sample.
    const syntaxNames = [...index.values()].filter((name) =>
      name.startsWith('syntax/')
    );
    expect(syntaxNames.length).toBe(17);
    expect(new Set(syntaxNames).size).toBe(syntaxNames.length);
  });

  test('syntax roles win over fg roles that share their color', () => {
    // #737373 is both fg/fg3 and syntax/comment in pierre-dark.
    expect(index.get('#737373')).toBe('syntax/comment');
    // #636363 is both fg/fg4 and syntax/punctuation.
    expect(index.get('#636363')).toBe('syntax/punctuation');
    // #a3a3a3 is both fg/fg2 and syntax/parameter.
    expect(index.get('#a3a3a3')).toBe('syntax/parameter');
  });

  test('editor.foreground maps to fg/base, not the syntax/invalid it shares', () => {
    expect(index.get(BASE_FOREGROUND)).toBe('fg/base');
  });

  test('states are preferred over the ansi colors they share', () => {
    // #08c0ef is states/info, syntax/operator, and four ansi cyans; syntax wins.
    expect(index.get('#08c0ef')).toBe('syntax/operator');
    // #ff2e3f is states/danger and the ansi reds, with no syntax claim.
    expect(index.get('#ff2e3f')).toBe('states/danger');
  });

  test('background and border colors are not indexed as text roles', () => {
    // #1d1d1d is only ever bg/inset and border/*, so nothing should claim it.
    expect(index.get('#1d1d1d')).toBeUndefined();
  });
});

describe('mapTokens', () => {
  test('maps token colors to variable-bound ranges', () => {
    const result = mapTokens(
      line([
        { content: 'const', color: '#ff678d' },
        { content: ' ', color: '#fafafa' },
        { content: 'x', color: '#fafafa' },
      ]),
      index
    );

    expect(result.bindings).toEqual([
      { start: 0, end: 5, variableName: 'syntax/keyword' },
      { start: 6, end: 7, variableName: 'fg/base' },
    ]);
    expect(result.unmatchedRanges).toBe(0);
  });

  test('merges touching ranges that resolve to the same variable', () => {
    const result = mapTokens(
      line([
        { content: '(', color: '#636363' },
        { content: ')', color: '#636363' },
      ]),
      index
    );

    expect(result.bindings).toEqual([
      { start: 0, end: 2, variableName: 'syntax/punctuation' },
    ]);
  });

  test('does not merge across a skipped whitespace token', () => {
    const result = mapTokens(
      line([
        { content: 'a', color: '#636363' },
        { content: '  ', color: '#636363' },
        { content: 'b', color: '#636363' },
      ]),
      index
    );

    expect(result.bindings).toEqual([
      { start: 0, end: 1, variableName: 'syntax/punctuation' },
      { start: 3, end: 4, variableName: 'syntax/punctuation' },
    ]);
  });

  test('does not merge across the newline between two lines', () => {
    // Offsets skip the newline, so line-final and line-initial ranges of the
    // same role must stay separate.
    const result = mapTokens(
      [
        [{ offset: 0, content: 'a', color: '#636363' }],
        [{ offset: 2, content: 'b', color: '#636363' }],
      ],
      index
    );

    expect(result.bindings).toEqual([
      { start: 0, end: 1, variableName: 'syntax/punctuation' },
      { start: 2, end: 3, variableName: 'syntax/punctuation' },
    ]);
  });

  test('counts unmatched colors and leaves their ranges out', () => {
    const result = mapTokens(
      line([
        { content: 'x', color: '#123456' },
        { content: 'y', color: '#123456' },
        { content: 'z', color: '#abcdef' },
      ]),
      index
    );

    expect(result.bindings).toEqual([]);
    expect(result.unmatchedRanges).toBe(3);
    expect(result.unmatchedColors).toEqual(['#123456', '#abcdef']);
  });

  test('treats a token with no color as unmatched', () => {
    const result = mapTokens(line([{ content: 'x' }]), index);

    expect(result.bindings).toEqual([]);
    expect(result.unmatchedRanges).toBe(1);
    expect(result.unmatchedColors).toEqual([]);
  });

  test('ignores case and a fully opaque alpha suffix on token colors', () => {
    const result = mapTokens(
      line([{ content: 'const', color: '#FF678DFF' }]),
      index
    );

    expect(result.bindings).toEqual([
      { start: 0, end: 5, variableName: 'syntax/keyword' },
    ]);
  });
});
