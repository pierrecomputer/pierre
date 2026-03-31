import type { FileOptions } from '../components/File';
import { FileRenderer } from '../renderers/FileRenderer';
import type {
  FileContents,
  FileDecorationItem,
  LineAnnotation,
} from '../types';
import {
  createStyleElement,
  createThemeStyleElement,
} from '../utils/createStyleElement';
import { wrapThemeCSS } from '../utils/cssWrappers';
import { shouldUseTokenTransformer } from '../utils/shouldUseTokenTransformer';
import { renderHTML } from './renderHTML';

export type PreloadFileOptions<
  LAnnotation = undefined,
  LDecoration = undefined,
> = {
  file: FileContents;
  options?: FileOptions<LAnnotation, LDecoration>;
  annotations?: LineAnnotation<LAnnotation>[];
  decorations?: FileDecorationItem<LDecoration>[];
};

export interface PreloadedFileResult<
  LAnnotation = undefined,
  LDecoration = undefined,
> {
  file: FileContents;
  options?: FileOptions<LAnnotation, LDecoration>;
  annotations?: LineAnnotation<LAnnotation>[];
  decorations?: FileDecorationItem<LDecoration>[];
  prerenderedHTML: string;
}

export async function preloadFile<
  LAnnotation = undefined,
  LDecoration = undefined,
>({
  file,
  options,
  annotations,
  decorations,
}: PreloadFileOptions<LAnnotation, LDecoration>): Promise<
  PreloadedFileResult<LAnnotation, LDecoration>
> {
  const fileRenderer = new FileRenderer<LAnnotation, LDecoration>({
    ...options,
    // Match the client's option snapshot: token callbacks imply the
    // transformer, so server markup hydrates into identical client renders.
    useTokenTransformer: shouldUseTokenTransformer(options),
    headerRenderMode:
      options?.renderCustomHeader != null ? 'custom' : 'default',
  });

  // Set line annotations if provided
  if (annotations !== undefined && annotations.length > 0) {
    fileRenderer.setLineAnnotations(annotations);
  }
  if (decorations !== undefined && decorations.length > 0) {
    fileRenderer.setDecorations(decorations);
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

  return {
    file,
    options,
    annotations,
    decorations,
    prerenderedHTML: renderHTML(children),
  };
}
