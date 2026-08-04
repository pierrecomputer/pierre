/**
 * Shiki setup for the UI realm: the language list, the probe theme, and the step
 * from source text to the character ranges the sandbox binds. Kept free of DOM
 * access so it can be exercised directly by tests.
 */
import probeTheme from '@pierre/theme/pierre-dark';
import {
  createHighlighterCore,
  type HighlighterCore,
  type ThemeRegistrationRaw,
} from '@shikijs/core';
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';
import { bundledLanguagesInfo } from 'shiki/langs';

import { mapTokens, type MapTokensResult } from '../shared/mapTokens';
import { createRoleIndex, PROBE_THEME_NAME } from '../shared/roleIndex';

export interface Language {
  /** Shiki language id, e.g. `typescript`. */
  id: string;
  /** Display name from Shiki's bundle, e.g. `TypeScript`. */
  label: string;
}

/**
 * Every language Shiki bundles, sorted by display name for the picker.
 *
 * The grammars behind them are reached through `bundledLanguagesInfo`'s
 * `import()` getters. Those are still statically bundled — the UI is one
 * self-contained HTML file and Figma loads no external resources, so there is
 * nothing to fetch at runtime — but going through the getters means a grammar is
 * only *parsed into a registry* when a user picks it, which keeps startup flat
 * regardless of how many languages exist.
 */
export const LANGUAGES: Language[] = bundledLanguagesInfo
  .map((info) => ({ id: info.id, label: info.name }))
  .sort((a, b) => a.label.localeCompare(b.label));

/**
 * Grammar loaders keyed by id *and* by alias, so `bash` resolves as readily as
 * `shellscript`. Shiki's aliases are unambiguous — none collides with an id and
 * none is claimed by two languages — so flattening them into one map is safe.
 */
const LANGUAGE_IMPORTS = new Map(
  bundledLanguagesInfo.flatMap((info) =>
    [info.id, ...(info.aliases ?? [])].map((key) => [key, info.import] as const)
  )
);

/**
 * Shiki's theme type is mutable while `@pierre/theme` exports a frozen readonly
 * object; the shapes are otherwise identical, so one cast at the boundary keeps
 * the rest of the module honest.
 */
const theme = probeTheme as unknown as ThemeRegistrationRaw;

// Shiki paints text that no grammar scope claims with `editor.foreground`, which
// is why the index needs it; roleIndex.ts explains what it resolves to.
const roleIndex = createRoleIndex(probeTheme.colors['editor.foreground']);

/** Highlighters that have had the one-time warm-up described below. */
const warmed = new WeakSet<HighlighterCore>();

export function createProbeHighlighter(): Promise<HighlighterCore> {
  return createHighlighterCore({
    themes: [theme],
    langs: [],
    // The JavaScript engine avoids WebAssembly, which the plugin sandbox cannot
    // load. It is the same engine @pierre/diffs defaults to.
    engine: createJavaScriptRegexEngine(),
  });
}

/**
 * Registers `lang`'s grammar if it is not registered yet, then makes sure the
 * highlighter has been warmed up.
 *
 * The warm-up exists because a highlighter's very first tokenization comes back
 * coarser than every call after it: `const a = 1;` yields `1;` as one token
 * instead of separating the number from the semicolon. One throwaway pass settles
 * it, and it is genuinely one-time — languages registered later tokenize
 * correctly on their first real call, so this does not repeat per language.
 */
async function ensureLanguage(
  highlighter: HighlighterCore,
  lang: string
): Promise<void> {
  if (!highlighter.getLoadedLanguages().includes(lang)) {
    const load = LANGUAGE_IMPORTS.get(lang);
    if (load === undefined) throw new Error(`Unknown language: ${lang}`);
    await highlighter.loadLanguage(load);
  }

  if (!warmed.has(highlighter)) {
    highlighter.codeToTokens('x', { lang, theme: PROBE_THEME_NAME });
    warmed.add(highlighter);
  }
}

/**
 * Tokenizes `characters` from a Figma text layer and resolves each token to the
 * Figma variable that should color it.
 *
 * Figma stores a soft line break as U+2028. Swapping in a newline is
 * character-for-character, so Shiki's token offsets still line up with the
 * layer's own character indices and the ranges can be applied as-is.
 */
export async function highlightToBindings(
  highlighter: HighlighterCore,
  characters: string,
  lang: string
): Promise<MapTokensResult> {
  await ensureLanguage(highlighter, lang);

  const { tokens } = highlighter.codeToTokens(
    characters.replaceAll('\u2028', '\n'),
    { lang, theme: PROBE_THEME_NAME }
  );
  return mapTokens(tokens, roleIndex);
}
