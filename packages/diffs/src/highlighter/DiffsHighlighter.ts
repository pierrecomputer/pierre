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
 * A different highlighter type cannot load in this thread until every
 * instance of the current type is disposed.
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
   * Previously used themes remain available after the shared cache is cleared.
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

  /** Backends with bundled lexers resolve immediately. */
  abstract loadLanguages(languages: readonly string[]): Promise<void>;

  abstract hasLoadedLanguages(languages: readonly string[]): boolean;

  /** Attach grammars resolved elsewhere, such as on the main thread for a worker. */
  abstract attachLanguages(languages: readonly ResolvedLanguage[]): void;

  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Disposed instances cannot be reused.
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
