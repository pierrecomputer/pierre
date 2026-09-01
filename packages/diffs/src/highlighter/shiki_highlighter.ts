import type { Root } from 'hast';
import type { CodeToTokensOptions, GrammarState } from 'shiki/core';

import type {
  CodeToHastOptions,
  DiffsHighlighter,
  DiffsThemeNames,
  ThemedToken,
} from '../types';
import type {
  CodeHighlighter,
  CodeHighlighterOptions,
  CodeTokenizeStream,
} from './code_highlighter';
import { markBuiltinShikiHighlighter } from './code_highlighter';
import { areLanguagesAttached } from './languages/areLanguagesAttached';
import {
  getHighlighterIfLoaded,
  getSharedHighlighter,
} from './shared_highlighter';
import { areThemesAttached } from './themes/areThemesAttached';

function loadedInstance(): DiffsHighlighter {
  const instance = getHighlighterIfLoaded();
  if (instance == null) {
    throw new Error(
      'The shiki highlighter is not loaded yet. Await CodeHighlighter.load() ' +
        '(or preloadHighlighter) before highlighting.'
    );
  }
  return instance;
}

/**
 * Streaming tokenizer over shiki's grammar-state threading: complete lines
 * are tokenized one at a time, carrying the grammar state forward; the
 * unterminated tail is buffered until its newline (or `end`) arrives. This is
 * the synchronous line-oriented sibling of `ShikiStreamTokenizer`.
 */
class ShikiTokenizeStream implements CodeTokenizeStream {
  #options: CodeToTokensOptions<string, string>;
  #grammarState: GrammarState | undefined;
  #tail = '';

  constructor(options: CodeToTokensOptions<string, string>) {
    this.#options = options;
  }

  pushCode(code: string): ThemedToken[][] {
    const lines = (this.#tail + code).split('\n');
    this.#tail = lines.pop() ?? '';
    return lines.map((line) => this.#tokenizeLine(line));
  }

  end(): ThemedToken[][] {
    const tail = this.#tail;
    this.#tail = '';
    const lines = [this.#tokenizeLine(tail)];
    this.#grammarState = undefined;
    return lines;
  }

  #tokenizeLine(line: string): ThemedToken[] {
    const result = loadedInstance().codeToTokens(line, {
      ...this.#options,
      grammarState: this.#grammarState,
    });
    this.#grammarState = result.grammarState;
    return result.tokens[0];
  }
}

// The marking must happen inside the exported value's initializer: a
// standalone top-level call would be dropped by bundlers that treat this
// module as side-effect free.
function asBuiltinShikiAdapter(adapter: CodeHighlighter): CodeHighlighter {
  markBuiltinShikiHighlighter(adapter);
  return adapter;
}

/**
 * The default `CodeHighlighter`: shiki, delegating to the shared highlighter
 * machinery this library has always used. The registry resolves to it unless
 * `setHighlighter` picked another implementation; pass it back to
 * `setHighlighter` to restore the default. Identified by identity (not by
 * `getShikiInstance` presence) so the pre-existing shiki code paths engage
 * only for this exact adapter.
 */
export const shikiHighlighter: CodeHighlighter = asBuiltinShikiAdapter({
  name: 'shiki',
  async load({ langs, themes, preferredHighlighter }: CodeHighlighterOptions) {
    await getSharedHighlighter({ langs, themes, preferredHighlighter });
  },
  isReady({ langs, themes }: CodeHighlighterOptions) {
    return (
      getHighlighterIfLoaded() != null &&
      themes.every((theme) => areThemesAttached(theme)) &&
      areLanguagesAttached(langs)
    );
  },
  getTheme(name: DiffsThemeNames) {
    return loadedInstance().getTheme(name);
  },
  codeToTokens(code: string, options: CodeToTokensOptions<string, string>) {
    return loadedInstance().codeToTokens(code, options);
  },
  codeToHast(code: string, options: CodeToHastOptions<DiffsThemeNames>): Root {
    return loadedInstance().codeToHast(code, options);
  },
  TokenizeStream: ShikiTokenizeStream,
  getShikiInstance: getHighlighterIfLoaded,
});
