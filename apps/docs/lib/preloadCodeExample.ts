import {
  type PreloadedFileResult,
  preloadFile,
  type PreloadFileOptions,
} from '@pierre/diffs/ssr';
import { cache } from 'react';

export interface CodeExampleHTML {
  sprite: string;
  shared: { html: string };
  content: string;
}

export interface PreloadedCodeExample<LAnnotation, Caret> extends Omit<
  PreloadedFileResult<LAnnotation, Caret>,
  'prerenderedHTML'
> {
  prerenderedHTML: CodeExampleHTML;
}

// React serializes a reused object once per server render. Keep the core
// stylesheet in that object instead of repeating it in every prop.
const shareHTML = cache((html: string) => ({ html }));

// Diffs starts each preloaded file with its icon sprite and core stylesheet.
// The sprite carries only the icons that example uses, so it stays per
// example; the core stylesheet is identical everywhere, so RSC shares it.
// File still receives the complete, unchanged markup for server rendering and
// browser hydration.
export async function preloadCodeExample<
  LAnnotation = undefined,
  Caret = undefined,
>(
  options: PreloadFileOptions<LAnnotation, Caret>
): Promise<PreloadedCodeExample<LAnnotation, Caret>> {
  const { prerenderedHTML, ...result } = await preloadFile(options);
  const styleStart = prerenderedHTML.indexOf('<style data-core-css="">');
  const styleEnd = prerenderedHTML.indexOf('</style>', styleStart);
  if (styleStart === -1 || styleEnd === -1) {
    throw new Error('Code example is missing its preloaded core stylesheet');
  }
  const contentStart = styleEnd + '</style>'.length;

  return {
    ...result,
    prerenderedHTML: {
      sprite: prerenderedHTML.slice(0, styleStart),
      shared: shareHTML(prerenderedHTML.slice(styleStart, contentStart)),
      content: prerenderedHTML.slice(contentStart),
    },
  };
}
