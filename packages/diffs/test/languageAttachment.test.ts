import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { bundledLanguages } from 'shiki';

import {
  areLanguagesAttached,
  attachResolvedLanguages,
  createHighlighter,
  type DiffsHighlighter,
  disposeHighlighter,
  getSharedHighlighter,
  registerCustomLanguage,
} from '../src';
import {
  RegisteredCustomLanguages,
  RegisteredHighlightsLanguages,
} from '../src/highlighter/languages/constants';
import { resolveHighlightsLanguages } from '../src/highlighter/languages/resolveHighlightsLanguages';

beforeEach(async () => {
  await disposeHighlighter();
  await getSharedHighlighter({
    preferredHighlighter: 'shiki-js',
    themes: [],
    langs: [],
  });
});
afterEach(async () => {
  await disposeHighlighter();
  for (const name of ['tf', 'hcl', 'custom-hcl']) {
    RegisteredCustomLanguages.delete(name);
  }
  for (const name of ['my-json', 'bad-json']) {
    RegisteredHighlightsLanguages.delete(name);
  }
});

test('Highlights attaches lexers registered with the highlights type', async () => {
  for (const name of ['my-json', 'bad-json']) {
    registerCustomLanguage(
      name,
      async () => {
        const { default: json } = await import('@pierre/highlights/langs/json');
        return {
          default: {
            ...json,
            aliases: { ...json.aliases, 'my-json': json.aliases.json },
          },
        };
      },
      [],
      'highlights'
    );
  }
  await disposeHighlighter();
  const highlighter = await getSharedHighlighter({
    preferredHighlighter: 'highlights',
    themes: ['pierre-dark'],
    langs: [],
  });
  expect(highlighter.hasLoadedLanguages(['json', 'my-json'])).toBe(false);
  await highlighter.loadLanguages(['my-json']);
  expect(highlighter.hasLoadedLanguages(['json', 'my-json'])).toBe(true);
  const code = '{"a": [1, true]}';
  const tokens = (lang: string) =>
    highlighter.codeToTokens(code, { lang, theme: 'pierre-dark' }).tokens;
  expect(tokens('my-json')).toEqual(tokens('json'));
  expect(tokens('my-json')).not.toEqual(tokens('text'));
  // The stream and editor tokenizers use the attached lexer too.
  const streamed = async (lang: string) => {
    const stream = highlighter.createStreamTokenizer({
      lang,
      theme: 'pierre-dark',
    });
    const { stable, unstable } = await stream.enqueue(code);
    stream.dispose();
    return [...stable, ...unstable];
  };
  expect(await streamed('my-json')).toEqual(await streamed('json'));
  expect(await streamed('my-json')).not.toEqual(await streamed('text'));
  // Workers receive a structured clone of the resolved lexer.
  const worker = await createHighlighter('highlights');
  attachResolvedLanguages(
    structuredClone(await resolveHighlightsLanguages(['my-json'])),
    worker
  );
  expect(
    worker.codeToTokens(code, { lang: 'my-json', theme: 'pierre-dark' }).tokens
  ).toEqual(tokens('json'));
  worker.dispose();
  const error = await highlighter
    .loadLanguages(['bad-json'])
    .catch((error: unknown) => error);
  expect(error).toEqual(
    new Error(
      'attachResolvedLanguages: The Highlights lexer "json" does not declare "bad-json" as an alias.'
    )
  );
  expect(highlighter.hasLoadedLanguages(['bad-json'])).toBe(false);
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
        expect(highlighter.hasLoadedLanguages(['tf'])).toBe(false);
        expect(highlighter.hasLoadedLanguages(['hcl'])).toBe(false);
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
      expect(highlighter.hasLoadedLanguages([name])).toBe(true);
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
    const load = spyOn(
      highlighter as Required<DiffsHighlighter>,
      'attachLanguages'
    ).mockImplementation(() => {
      throw failure;
    });
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
    expect(highlighter.hasLoadedLanguages(['tf'])).toBe(true);
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
