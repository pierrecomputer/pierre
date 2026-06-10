import { describe, expect, test } from 'bun:test';

import {
  compositeOverBg,
  contrastRatio,
  hoverWouldEraseText,
  isDarkSurface,
  isFullyTransparent,
  MIN_MUTED_RATIO,
  MIN_READABLE_RATIO,
  parseHexRgba,
  relativeLuminance,
  surfacesMatch,
} from '../../src/modules/color';

describe('constants', () => {
  test('WCAG ratio floors', () => {
    expect(MIN_READABLE_RATIO).toBe(3);
    expect(MIN_MUTED_RATIO).toBe(4.5);
  });
});

describe('parseHexRgba', () => {
  test('expands 3-digit hex', () => {
    expect(parseHexRgba('#abc')).toEqual([0xaa, 0xbb, 0xcc, 1]);
  });

  test('parses 6-digit hex', () => {
    expect(parseHexRgba('#112233')).toEqual([0x11, 0x22, 0x33, 1]);
  });

  test('parses 8-digit hex with alpha 0..1', () => {
    expect(parseHexRgba('#11223344')).toEqual([0x11, 0x22, 0x33, 0x44 / 255]);
  });

  test('returns null for non-hex', () => {
    expect(parseHexRgba('rgb(1,2,3)')).toBeNull();
    expect(parseHexRgba('var(--x)')).toBeNull();
    expect(parseHexRgba('not-a-color')).toBeNull();
  });

  test('trims surrounding whitespace', () => {
    expect(parseHexRgba('  #ffffff  ')).toEqual([255, 255, 255, 1]);
  });
});

describe('relativeLuminance', () => {
  test('black is 0', () => {
    expect(relativeLuminance('#000000')).toBe(0);
  });

  test('white is 1', () => {
    expect(relativeLuminance('#ffffff')).toBe(1);
  });

  test('mid color is between 0 and 1', () => {
    const mid = relativeLuminance('#808080');
    expect(mid).not.toBeNull();
    expect(mid as number).toBeGreaterThan(0);
    expect(mid as number).toBeLessThan(1);
  });

  test('8-digit hex parses, alpha ignored', () => {
    expect(relativeLuminance('#ffffffff')).toBe(relativeLuminance('#ffffff'));
    expect(relativeLuminance('#11223300')).toBe(relativeLuminance('#112233'));
  });

  test('3-digit hex parses', () => {
    expect(relativeLuminance('#fff')).toBe(relativeLuminance('#ffffff'));
  });

  test('non-hex and undefined return null', () => {
    expect(relativeLuminance('rgb(0,0,0)')).toBeNull();
    expect(relativeLuminance('transparent')).toBeNull();
    expect(relativeLuminance(undefined)).toBeNull();
  });
});

describe('contrastRatio', () => {
  test('black vs white is 21', () => {
    const ratio = contrastRatio(
      relativeLuminance('#000000') as number,
      relativeLuminance('#ffffff') as number
    );
    expect(ratio).toBeCloseTo(21, 5);
  });

  test('symmetric in argument order', () => {
    const la = relativeLuminance('#123456') as number;
    const lb = relativeLuminance('#abcdef') as number;
    expect(contrastRatio(la, lb)).toBe(contrastRatio(lb, la));
  });

  test('equal luminances give ratio 1', () => {
    const l = relativeLuminance('#808080') as number;
    expect(contrastRatio(l, l)).toBe(1);
  });
});

describe('compositeOverBg', () => {
  test('50%-alpha fg over bg yields the midpoint', () => {
    // 0x80/255 ≈ 0.50196 alpha. white over black ≈ 0x80 each channel.
    expect(compositeOverBg('#ffffff80', '#000000')).toBe('#808080');
  });

  test('opaque fg returns the fg color', () => {
    expect(compositeOverBg('#123456', '#ffffff')).toBe('#123456');
  });

  test('undefined bg returns undefined', () => {
    expect(compositeOverBg('#ffffff80', undefined)).toBeUndefined();
  });

  test('non-hex inputs return undefined', () => {
    expect(compositeOverBg('rgb(1,2,3)', '#000000')).toBeUndefined();
    expect(compositeOverBg('#ffffff80', 'var(--bg)')).toBeUndefined();
  });
});

describe('isFullyTransparent', () => {
  test('transparent keyword is true', () => {
    expect(isFullyTransparent('transparent')).toBe(true);
    expect(isFullyTransparent('  TRANSPARENT ')).toBe(true);
  });

  test('zero-alpha hex forms are true', () => {
    expect(isFullyTransparent('#0000')).toBe(true);
    expect(isFullyTransparent('#11223300')).toBe(true);
  });

  test('zero-alpha functional forms are true', () => {
    expect(isFullyTransparent('rgba(0,0,0,0)')).toBe(true);
    expect(isFullyTransparent('hsla(0,0%,0%,0)')).toBe(true);
    expect(isFullyTransparent('rgb(0 0 0 / 0%)')).toBe(true);
  });

  test('opaque and partially-transparent colors are false', () => {
    expect(isFullyTransparent('#ffffff')).toBe(false);
    expect(isFullyTransparent('#11223344')).toBe(false);
    expect(isFullyTransparent('rgba(0,0,0,0.5)')).toBe(false);
  });

  test('undefined is false', () => {
    expect(isFullyTransparent(undefined)).toBe(false);
  });
});

describe('isDarkSurface', () => {
  test('dark bg is dark', () => {
    expect(isDarkSurface('#0d1017')).toBe(true);
  });

  test('light bg is not dark', () => {
    expect(isDarkSurface('#ffffff')).toBe(false);
  });

  test('unparseable bg + light fgHint is dark', () => {
    expect(isDarkSurface('var(--bg)', '#ffffff')).toBe(true);
  });

  test('unparseable bg + dark fgHint is not dark', () => {
    expect(isDarkSurface('var(--bg)', '#000000')).toBe(false);
  });

  test('both unparseable/undefined is not dark', () => {
    expect(isDarkSurface('var(--bg)', 'var(--fg)')).toBe(false);
    expect(isDarkSurface(undefined, undefined)).toBe(false);
    expect(isDarkSurface(undefined)).toBe(false);
  });
});

describe('surfacesMatch', () => {
  test('identical hex (case-insensitive) matches', () => {
    expect(surfacesMatch('#ABCDEF', '#abcdef')).toBe(true);
    expect(surfacesMatch('  #112233 ', '#112233')).toBe(true);
  });

  test('near-luminance (delta < 0.06) matches', () => {
    // Two near-identical dark surfaces differing only slightly.
    expect(surfacesMatch('#0d1017', '#0e1118')).toBe(true);
  });

  test('clearly different surfaces do not match', () => {
    expect(surfacesMatch('#000000', '#ffffff')).toBe(false);
  });

  test('undefined does not match', () => {
    expect(surfacesMatch(undefined, '#000000')).toBe(false);
    expect(surfacesMatch('#000000', undefined)).toBe(false);
  });

  test('non-hex (unmeasurable, non-identical) does not match', () => {
    expect(surfacesMatch('var(--a)', 'var(--b)')).toBe(false);
  });
});

describe('hoverWouldEraseText', () => {
  test('hover closer to fg than bg erases text (true)', () => {
    // Dark bg, light text; a light hover lands on the text → erases.
    expect(hoverWouldEraseText('#eeeeee', '#0f111a', '#f0f0f0')).toBe(true);
  });

  test('hover between bg and fg does not erase (false)', () => {
    // Dark bg, light text; a mid hover stays nearer the bg → safe.
    expect(hoverWouldEraseText('#333333', '#0f111a', '#f0f0f0')).toBe(false);
  });

  test('null bg or fg returns false', () => {
    expect(hoverWouldEraseText('#eeeeee', undefined, '#f0f0f0')).toBe(false);
    expect(hoverWouldEraseText('#eeeeee', '#0f111a', undefined)).toBe(false);
  });

  test('unparseable input returns false', () => {
    expect(hoverWouldEraseText('var(--hover)', '#0f111a', '#f0f0f0')).toBe(
      false
    );
    expect(hoverWouldEraseText('#eeeeee', 'var(--bg)', '#f0f0f0')).toBe(false);
  });

  test('8-digit hover hex is evaluated, not skipped', () => {
    // The 8-digit hover parses (alpha ignored) and is close to the light fg,
    // so it still reads as erasing the text rather than returning false.
    expect(hoverWouldEraseText('#eeeeeeff', '#0f111a', '#f0f0f0')).toBe(true);
  });
});
