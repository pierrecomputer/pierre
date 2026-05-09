import { describe, expect, test } from 'bun:test';

import { DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY } from '../src/constants';
import {
  patchScrollbarGutterSize,
  wrapThemeCSS,
} from '../src/utils/cssWrappers';

describe('theme CSS scrollbar gutter helpers', () => {
  test('wrapThemeCSS predefines the measured gutter with the fallback value', () => {
    expect(wrapThemeCSS('--diffs-token: red;', 'dark')).toContain(
      `${DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY}: var(--diffs-scrollbar-gutter-fallback);`
    );
  });

  test('wrapThemeCSS writes the measured gutter into the theme style', () => {
    expect(wrapThemeCSS('--diffs-token: red;', 'dark', 6)).toContain(
      `${DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY}: 6px;`
    );
  });

  test('patchScrollbarGutterSize updates the existing measured gutter declaration', () => {
    const patched = patchScrollbarGutterSize(
      wrapThemeCSS('--diffs-token: red;', 'dark'),
      6
    );
    const updated = patchScrollbarGutterSize(patched, 8);

    expect(updated).toContain(
      `${DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY}: 8px;`
    );
    expect(updated).not.toContain(
      `${DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY}: 6px;`
    );
    expect(
      updated.match(new RegExp(DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY, 'g'))
        ?.length
    ).toBe(1);
  });
});
