import { afterEach, describe, expect, test } from 'bun:test';

// Importing shared_highlighter for its side effect: it registers the four
// pierre-* themes against the diffs theme registry at module load.
import '../src/highlighter/shared_highlighter';
import { cleanUpResolvedThemes } from '../src/highlighter/themes/cleanUpResolvedThemes';
import { getResolvedThemes } from '../src/highlighter/themes/getResolvedThemes';
import { hasResolvedThemes } from '../src/highlighter/themes/hasResolvedThemes';
import { resolveTheme } from '../src/highlighter/themes/resolveTheme';
import { resolveThemes } from '../src/highlighter/themes/resolveThemes';

afterEach(() => {
  cleanUpResolvedThemes();
});

describe('resolveTheme contract', () => {
  test('resolves a registered pierre theme to a normalized theme', async () => {
    const theme = await resolveTheme('pierre-dark');
    // normalizeTheme derives fg/bg from the colors map (the raw bundle leaves
    // them undefined), and the registry slug is preserved as the name.
    expect(theme.name).toBe('pierre-dark');
    expect(theme.fg).toBe('#fafafa');
    expect(theme.bg).toBe('#0a0a0a');
  });

  test('caches the resolved theme for synchronous reuse', async () => {
    await resolveTheme('pierre-dark');
    expect(hasResolvedThemes(['pierre-dark'])).toBe(true);
    const [cached] = getResolvedThemes(['pierre-dark']);
    expect(cached.name).toBe('pierre-dark');
  });

  test('dedupes concurrent loads of the same theme', async () => {
    const [a, b] = await Promise.all([
      resolveTheme('pierre-light'),
      resolveTheme('pierre-light'),
    ]);
    expect(a).toBe(b);
  });

  test('resolveThemes preserves input order when mixing cold and cached themes', async () => {
    await resolveTheme('pierre-dark');

    const themes = await resolveThemes(['nord', 'pierre-dark']);

    expect(themes.map((theme) => theme.name)).toEqual(['nord', 'pierre-dark']);
  });

  test('rejects a name with no registered or bundled loader', async () => {
    let caughtErr: unknown;
    try {
      await resolveTheme('definitely-not-a-real-theme-xyz' as never);
    } catch (err) {
      caughtErr = err;
    }
    expect(caughtErr).toBeInstanceOf(Error);
    expect((caughtErr as Error).message).toContain(
      'No valid theme loader registered'
    );
  });

  test('cleanUpResolvedThemes clears the resolved cache', async () => {
    await resolveTheme('pierre-dark');
    expect(hasResolvedThemes(['pierre-dark'])).toBe(true);
    cleanUpResolvedThemes();
    expect(hasResolvedThemes(['pierre-dark'])).toBe(false);
  });
});
