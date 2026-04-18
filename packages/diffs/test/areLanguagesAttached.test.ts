import { describe, expect, test } from 'bun:test';

import { areLanguagesAttached } from '../src/highlighter/languages/areLanguagesAttached';
import { AttachedLanguages } from '../src/highlighter/languages/constants';

describe('areLanguagesAttached', () => {
  test('treats builtin text-like languages as already attached', () => {
    AttachedLanguages.clear();

    expect(areLanguagesAttached('text')).toBe(true);
    expect(areLanguagesAttached('ansi')).toBe(true);
  });

  test('still requires explicit attachment for non-builtin languages', () => {
    AttachedLanguages.clear();

    expect(areLanguagesAttached('typescript')).toBe(false);

    AttachedLanguages.add('typescript');
    expect(areLanguagesAttached('typescript')).toBe(true);
  });
});
