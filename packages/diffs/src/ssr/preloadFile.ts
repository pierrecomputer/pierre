import type { FileOptions } from '../components/File';
import type { SnippetFileOptions } from '../components/SnippetFile';
import { FileRenderer } from '../renderers/FileRenderer';
import { SnippetFileRenderer } from '../renderers/SnippetFileRenderer';
import type { FileContents, LineAnnotation } from '../types';
import {
  createStyleElement,
  createThemeStyleElement,
} from '../utils/createStyleElement';
import { wrapThemeCSS } from '../utils/cssWrappers';
import { DEFAULT_EXPANSION_LINE_COUNT } from '../utils/expansionLineCount';
import { shouldUseTokenTransformer } from '../utils/shouldUseTokenTransformer';
import { assertSnippetOptions as assertSnippetFileOptions } from '../utils/snippetClip';
import { renderHTML } from './renderHTML';

export type PreloadFileOptions<LAnnotation, Caret> = {
  file: FileContents;
  options?: FileOptions<LAnnotation, Caret>;
  annotations?: LineAnnotation<LAnnotation>[];
};

export interface PreloadedFileResult<LAnnotation, Caret> {
  file: FileContents;
  options?: FileOptions<LAnnotation, Caret>;
  annotations?: LineAnnotation<LAnnotation>[];
  prerenderedHTML: string;
}

export async function preloadFile<LAnnotation = undefined, Caret = undefined>({
  file,
  options,
  annotations,
}: PreloadFileOptions<LAnnotation, Caret>): Promise<
  PreloadedFileResult<LAnnotation, Caret>
> {
  const fileRenderer = new FileRenderer<LAnnotation>(
    getPreloadRendererOptions(options)
  );
  return {
    file,
    options,
    annotations,
    prerenderedHTML: await renderPreloadedFile(
      fileRenderer,
      file,
      options,
      annotations
    ),
  };
}

/**
 * Experimental: this API may change in a minor release.
 * @experimental
 */
export interface PreloadSnippetFileOptions<LAnnotation> {
  file: FileContents;
  options: SnippetFileOptions<LAnnotation>;
  annotations?: LineAnnotation<LAnnotation>[];
}

/**
 * Experimental: this API may change in a minor release.
 * @experimental
 */
export interface PreloadSnippetFileResult<
  LAnnotation,
> extends PreloadSnippetFileOptions<LAnnotation> {
  prerenderedHTML: string;
}

/**
 * Server-renders a SnippetFile. Pass the result to the React `SnippetFile`
 * (or `hydrate`) with the same options so hydration keeps the markup.
 *
 * Experimental: this API may change in a minor release.
 * @experimental
 */
export async function preloadSnippetFile<LAnnotation = undefined>({
  file,
  options,
  annotations,
}: PreloadSnippetFileOptions<LAnnotation>): Promise<
  PreloadSnippetFileResult<LAnnotation>
> {
  assertSnippetFileOptions('preloadSnippetFile', options);
  const fileRenderer = new SnippetFileRenderer<LAnnotation>(
    getPreloadRendererOptions(options)
  );
  fileRenderer.snippet.setRange(options.lineRange);
  fileRenderer.snippet.expansionLineCount =
    options.expansionLineCount ?? DEFAULT_EXPANSION_LINE_COUNT;
  return {
    file,
    options,
    annotations,
    prerenderedHTML: await renderPreloadedFile(
      fileRenderer,
      file,
      options,
      annotations
    ),
  };
}

function getPreloadRendererOptions<LAnnotation, Caret>(
  options: FileOptions<LAnnotation, Caret> | undefined
) {
  return {
    ...options,
    // Match the client's option snapshot: token callbacks imply the
    // transformer, so server markup hydrates into identical client renders.
    useTokenTransformer: shouldUseTokenTransformer(options),
    headerRenderMode:
      options?.renderCustomHeader != null
        ? ('custom' as const)
        : ('default' as const),
  };
}

async function renderPreloadedFile<LAnnotation, Caret>(
  fileRenderer: FileRenderer<LAnnotation>,
  file: FileContents,
  options: FileOptions<LAnnotation, Caret> | undefined,
  annotations: LineAnnotation<LAnnotation>[] | undefined
): Promise<string> {
  // Set line annotations if provided
  if (annotations !== undefined && annotations.length > 0) {
    fileRenderer.setLineAnnotations(annotations);
  }

  const fileResult = await fileRenderer.asyncRender(file);
  const children = [createStyleElement(fileResult.css, true)];

  children.push(
    createThemeStyleElement(
      wrapThemeCSS(
        fileResult.themeStyles,
        fileResult.baseThemeType ?? options?.themeType ?? 'system'
      )
    )
  );

  if (options?.unsafeCSS != null) {
    children.push(createStyleElement(options.unsafeCSS));
  }

  if (fileResult.headerAST != null) {
    children.push(fileResult.headerAST);
  }
  const code = fileRenderer.renderFullAST(fileResult);
  code.properties['data-dehydrated'] = '';
  children.push(code);
  return renderHTML(children);
}
