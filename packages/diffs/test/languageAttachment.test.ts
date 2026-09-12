import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { bundledLanguages } from 'shiki';

import {
  areLanguagesAttached,
  disposeHighlighter,
  getSharedHighlighter,
  registerCustomLanguage,
} from '../src';
import { RegisteredCustomLanguages } from '../src/highlighter/languages/constants';

beforeEach(disposeHighlighter);
afterEach(async () => {
  await disposeHighlighter();
  for (const name of ['tf', 'hcl', 'custom-hcl']) {
    RegisteredCustomLanguages.delete(name);
  }
});

describe('language attachment', () => {
  for (const preloadTerraform of [false, true]) {
    test(`rejects a mismatched custom loader and cached retries, Terraform ${preloadTerraform ? 'loaded' : 'absent'}`, async () => {
      const highlighter = await getSharedHighlighter({
        themes: [],
        langs: preloadTerraform ? ['terraform'] : [],
      });
      registerCustomLanguage('tf', bundledLanguages.hcl);
      const mismatch =
        'attachResolvedLanguages: No returned grammar declares "tf" as its name or an alias.';

      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await getSharedHighlighter({
          themes: [],
          langs: ['tf'],
        }).catch((error: unknown) => error);
        expect(result).toEqual(new Error(mismatch));
        expect(areLanguagesAttached('tf')).toBe(false);
        expect(highlighter.getLoadedLanguages()).not.toContain('hcl');
      }
    });
  }

  for (const name of ['hcl', 'custom-hcl']) {
    test(`accepts a custom grammar providing the requested name ${name}`, async () => {
      registerCustomLanguage(
        name,
        name === 'hcl'
          ? bundledLanguages.hcl
          : async () => {
              const { default: grammars } = await bundledLanguages.hcl();
              return {
                default: grammars.map((grammar) => ({
                  ...grammar,
                  aliases: [...(grammar.aliases ?? []), 'custom-hcl'],
                })),
              };
            }
      );
      const highlighter = await getSharedHighlighter({
        themes: ['pierre-dark'],
        langs: [name],
      });

      expect(areLanguagesAttached(name)).toBe(true);
      expect(highlighter.getLoadedLanguages()).toContain(name);
      expect(
        highlighter.codeToTokens('locals { label = "example" }', {
          lang: name,
          theme: 'pierre-dark',
        }).tokens.length
      ).toBeGreaterThan(0);
    });
  }

  test('preserves a Shiki loading error and allows attachment to be retried', async () => {
    const highlighter = await getSharedHighlighter({ themes: [], langs: [] });
    const failure = new Error('grammar load failed');
    const load = spyOn(highlighter, 'loadLanguageSync').mockImplementation(
      () => {
        throw failure;
      }
    );
    try {
      const result = await getSharedHighlighter({
        themes: [],
        langs: ['tf'],
      }).catch((error: unknown) => error);
      expect(result).toBe(failure);
      expect(areLanguagesAttached('tf')).toBe(false);
    } finally {
      load.mockRestore();
    }

    await getSharedHighlighter({ themes: [], langs: ['tf'] });
    expect(areLanguagesAttached('tf')).toBe(true);
    expect(highlighter.getLoadedLanguages()).toContain('tf');
  });

  test('does not report a new alias attached when Shiki skips an already-loaded grammar', async () => {
    await getSharedHighlighter({ themes: [], langs: ['hcl'] });
    registerCustomLanguage('custom-hcl', async () => {
      const { default: grammars } = await bundledLanguages.hcl();
      return {
        default: grammars.map((grammar) => ({
          ...grammar,
          aliases: [...(grammar.aliases ?? []), 'custom-hcl'],
        })),
      };
    });

    const result = await getSharedHighlighter({
      themes: [],
      langs: ['custom-hcl'],
    }).catch((error: unknown) => error);
    expect(result).toEqual(
      new Error(
        'attachResolvedLanguages: "hcl" is already loaded without alias "custom-hcl". Load the alias first or give the grammar a unique name.'
      )
    );
    expect(areLanguagesAttached('custom-hcl')).toBe(false);
  });
});
