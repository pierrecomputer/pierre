import type { ThemeResolver } from '@pierre/theming';

import type { HighlighterTypes } from '../types';
import { tokensToHtml } from '../utils/tokensToHtml';
import type { ResolvedLanguage } from '../worker/types';
import type { DiffsEditorTokenizer } from './DiffsEditorTokenizer';
import {
  acquireHighlighterType,
  releaseHighlighterType,
} from './highlighterType';
import type { DiffsTheme } from './themes/types';
import type {
  DiffsEditorTokenizerOptions,
  DiffsStreamTokenizer,
} from './tokenizer-types';
import type {
  CodeToHtmlOptions,
  CodeToTokensOptions,
  TokensResult,
} from './types';

/**
 * Tokenization and theme resolution owned by one highlighter backend. Each
 * instance holds its realm's highlighter type from construction until
 * dispose(), so a different type cannot load while it is alive.
 */
export abstract class DiffsHighlighter {
  protected disposed = false;

  constructor(
    readonly name: HighlighterTypes,
    readonly themeResolver: ThemeResolver<DiffsTheme>
  ) {
    acquireHighlighterType(name);
  }

  /**
   * A resolved theme by name. Themes an instance has already used stay
   * available after the shared resolver cache is cleared.
   */
  abstract getTheme(name: string): DiffsTheme;

  abstract codeToTokens(
    code: string,
    options: CodeToTokensOptions
  ): TokensResult;

  codeToHtml(code: string, options: CodeToHtmlOptions): string {
    return tokensToHtml(code, this.codeToTokens(code, options), options);
  }

  abstract createStreamTokenizer(
    options: CodeToTokensOptions
  ): DiffsStreamTokenizer;

  abstract createEditorTokenizer(
    options: DiffsEditorTokenizerOptions
  ): DiffsEditorTokenizer;

  /** Load grammars for languages. Backends with bundled lexers resolve at once. */
  abstract loadLanguages(languages: readonly string[]): Promise<void>;

  /** Whether every language can be highlighted without loading anything. */
  abstract hasLoadedLanguages(languages: readonly string[]): boolean;

  /** Attach grammars resolved elsewhere, such as on the main thread for a worker. */
  abstract attachLanguages(languages: readonly ResolvedLanguage[]): void;

  /**
   * Release backend resources and this instance's hold on the highlighter
   * type. The instance is unusable afterward.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.releaseResources();
    releaseHighlighterType();
  }

  protected abstract releaseResources(): void;

  protected assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error('Highlighter is disposed');
    }
  }
}
