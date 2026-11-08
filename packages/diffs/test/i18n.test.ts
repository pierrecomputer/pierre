import { afterEach, describe, expect, test } from 'bun:test';

import { DEFAULT_TRANSLATIONS, i18n } from '../src';
import { compileMessage } from '../src/i18n/compileMessage';

const en = new Intl.PluralRules('en');

describe('compileMessage', () => {
  test('returns plain text unchanged', () => {
    expect(compileMessage('Expand all', en)()).toBe('Expand all');
  });

  test('substitutes {name} arguments', () => {
    const message = compileMessage('{index} of {count}', en);
    expect(message({ index: 2, count: 7 })).toBe('2 of 7');
  });

  test('picks the plural branch for the locale and fills #', () => {
    const message = compileMessage(
      '{count, plural, one {# line} other {# lines}}',
      en
    );
    expect(message({ count: 0 })).toBe('0 lines');
    expect(message({ count: 1 })).toBe('1 line');
    expect(message({ count: 12 })).toBe('12 lines');
  });

  test('supports locales with more than two plural forms', () => {
    const message = compileMessage(
      '{count, plural, one {# строка} few {# строки} many {# строк} other {# строки}}',
      new Intl.PluralRules('ru')
    );
    expect(message({ count: 1 })).toBe('1 строка');
    expect(message({ count: 3 })).toBe('3 строки');
    expect(message({ count: 5 })).toBe('5 строк');
    expect(message({ count: 21 })).toBe('21 строка');
  });

  test('falls back to other when the locale picks an absent category', () => {
    const message = compileMessage('{count, plural, other {# 行}}', en);
    expect(message({ count: 1 })).toBe('1 行');
  });

  test('keeps text around the plural block and other arguments', () => {
    const message = compileMessage(
      'Found {count, plural, one {# match} other {# matches}} in {file}',
      en
    );
    expect(message({ count: 2, file: 'a.ts' })).toBe('Found 2 matches in a.ts');
  });

  test('rejects a plural block without other', () => {
    expect(() => compileMessage('{count, plural, one {# line}}', en)).toThrow(
      '"other"'
    );
  });

  test('rejects an unknown plural category', () => {
    expect(() =>
      compileMessage('{count, plural, single {# line} other {# lines}}', en)
    ).toThrow('unknown plural category "single"');
  });

  test('rejects a malformed plural block', () => {
    expect(() => compileMessage('{count, plural, one # line}', en)).toThrow(
      'malformed plural block'
    );
  });

  test('rejects more than one plural block', () => {
    expect(() =>
      compileMessage('{a, plural, other {#}} and {b, plural, other {#}}', en)
    ).toThrow('only one plural block');
  });

  test('throws when an argument is missing at format time', () => {
    const message = compileMessage('{count} results', en);
    expect(() => message()).toThrow('"count" was not provided');
  });

  test('throws when the plural argument is not a number', () => {
    const message = compileMessage('{count, plural, other {#}}', en);
    expect(() => message({ count: 'many' })).toThrow('must be a number');
  });
});

describe('i18n', () => {
  afterEach(() => {
    i18n.set();
  });

  test('renders the English defaults', () => {
    expect(i18n.locale).toBe('en');
    expect(i18n.translations).toEqual(DEFAULT_TRANSLATIONS);
    expect(i18n.t('unmodifiedLines', { count: 1 })).toBe('1 unmodified line');
    expect(i18n.t('unmodifiedLines', { count: 0 })).toBe('0 unmodified lines');
    expect(i18n.t('unmodifiedLines', { count: 12 })).toBe(
      '12 unmodified lines'
    );
    expect(i18n.t('unknownUnmodifiedLines')).toBe(
      'More unchanged context may be available'
    );
    expect(i18n.t('expandAll')).toBe('Expand all');
    expect(i18n.t('noNewlineAtEndOfFile')).toBe('No newline at end of file');
  });

  test('set replaces translations and uses the locale for plurals', () => {
    i18n.set({
      locale: 'fr',
      translations: {
        unmodifiedLines:
          '{count, plural, one {# ligne inchangée} other {# lignes inchangées}}',
        expandAll: 'Tout déplier',
      },
    });
    expect(i18n.locale).toBe('fr');
    // French treats 0 as singular.
    expect(i18n.t('unmodifiedLines', { count: 0 })).toBe('0 ligne inchangée');
    expect(i18n.t('unmodifiedLines', { count: 2 })).toBe('2 lignes inchangées');
    expect(i18n.t('expandAll')).toBe('Tout déplier');
  });

  test('translations left out or set to undefined fall back to English', () => {
    i18n.set({
      translations: {
        expandAll: 'Tout déplier',
        noNewlineAtEndOfFile: undefined,
      },
    });
    expect(i18n.t('expandAll')).toBe('Tout déplier');
    expect(i18n.t('noNewlineAtEndOfFile')).toBe('No newline at end of file');
    expect(i18n.t('unknownUnmodifiedLines')).toBe(
      'More unchanged context may be available'
    );
  });

  test('set with no config restores English', () => {
    i18n.set({ locale: 'de', translations: { expandAll: 'Alle aufklappen' } });
    i18n.set();
    expect(i18n.locale).toBe('en');
    expect(i18n.t('expandAll')).toBe('Expand all');
  });

  test('notifies subscribers once per effective change', () => {
    let notified = 0;
    const unsubscribe = i18n.subscribe({
      onTranslationsChange: () => {
        notified++;
      },
    });
    i18n.set({ translations: { expandAll: 'Tout déplier' } });
    expect(notified).toBe(1);
    // Same config again: nothing changed, nobody is told.
    i18n.set({ translations: { expandAll: 'Tout déplier' } });
    expect(notified).toBe(1);
    // Locale alone counts as a change because plural forms depend on it.
    i18n.set({ locale: 'fr', translations: { expandAll: 'Tout déplier' } });
    expect(notified).toBe(2);
    unsubscribe();
    i18n.set();
    expect(notified).toBe(2);
  });

  test('a bad translation throws and leaves the previous config in place', () => {
    i18n.set({ translations: { expandAll: 'Tout déplier' } });
    expect(() =>
      i18n.set({
        translations: { unmodifiedLines: '{count, plural, one {# line}}' },
      })
    ).toThrow('"other"');
    expect(i18n.t('expandAll')).toBe('Tout déplier');
    expect(i18n.t('unmodifiedLines', { count: 1 })).toBe('1 unmodified line');
  });

  test('an unknown translation key throws', () => {
    const translations: Record<string, string> = { expandAl: 'typo' };
    expect(() => i18n.set({ translations })).toThrow(
      'unknown translation "expandAl"'
    );
  });

  test('an invalid locale throws and leaves the previous config in place', () => {
    expect(() => i18n.set({ locale: 'not a locale' })).toThrow();
    expect(i18n.locale).toBe('en');
  });
});
