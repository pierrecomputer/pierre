import { expectTypeOf, test } from 'bun:test';

import type {
  CodeToHtmlOptions,
  CodeToTokensOptions,
  DiffsHighlighter,
} from '../src';
import type { CodeToTokenTransformStreamOptions } from '../src/shiki-stream';

test('tokenization requires exactly one theme selection', () => {
  expectTypeOf<{
    lang: string;
    theme: string;
    themes?: undefined;
  }>().toExtend<CodeToTokensOptions>();
  expectTypeOf<{
    lang: string;
    theme?: undefined;
    themes: Record<string, string>;
  }>().toExtend<CodeToTokensOptions>();
  expectTypeOf<{ lang: string }>().not.toExtend<CodeToTokensOptions>();
  expectTypeOf<{
    lang: string;
    theme: string;
    themes: Record<string, string>;
  }>().not.toExtend<CodeToTokensOptions>();
  expectTypeOf<{ lang: string }>().not.toExtend<CodeToHtmlOptions>();
  expectTypeOf<{
    lang: string;
    theme: string;
    themes: Record<string, string>;
  }>().not.toExtend<CodeToHtmlOptions>();
  expectTypeOf<{
    lang: string;
    highlighter: DiffsHighlighter;
  }>().not.toExtend<CodeToTokenTransformStreamOptions>();
  expectTypeOf<{
    lang: string;
    highlighter: DiffsHighlighter;
    theme: string;
    themes: Record<string, string>;
  }>().not.toExtend<CodeToTokenTransformStreamOptions>();
});
