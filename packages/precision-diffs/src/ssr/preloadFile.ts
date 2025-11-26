import type { FileOptions } from '../../src/File';
import { FileRenderer } from '../FileRenderer';
import type { FileContents, LineAnnotation } from '../types';
import { createStyleElement } from '../utils/createStyleElement';
import { renderCSS } from './renderCSS';
import { renderHTML } from './renderHTML';

export type PreloadFileOptions<LAnnotation> = {
  file: FileContents;
  options?: FileOptions<LAnnotation>;
  annotations?: LineAnnotation<LAnnotation>[];
};

export interface PreloadedFileResult<LAnnotation> {
  file: FileContents;
  options?: FileOptions<LAnnotation>;
  annotations?: LineAnnotation<LAnnotation>[];
  prerenderedHTML: string;
}

export async function preloadFile<LAnnotation = undefined>({
  file,
  options,
  annotations,
}: PreloadFileOptions<LAnnotation>): Promise<PreloadedFileResult<LAnnotation>> {
  const { disableFileHeader = false } = options ?? {};
  const fileRenderer = new FileRenderer<LAnnotation>(options);

  // Set line annotations if provided
  if (annotations !== undefined && annotations.length > 0) {
    fileRenderer.setLineAnnotations(annotations);
  }

  const [headerResult, fileResult] = await Promise.all([
    !disableFileHeader ? fileRenderer.asyncRenderHeader(file) : undefined,
    fileRenderer.asyncRender(file),
  ]);
  if (fileResult == null) {
    throw new Error('Failed to render file diff');
  }
  const children = [
    createStyleElement(renderCSS(fileResult.css, options?.unsafeCSS)),
  ];
  if (headerResult != null) {
    children.push(headerResult);
  }
  const code = fileRenderer.renderFullAST(fileResult);
  code.properties['data-dehydrated'] = '';
  children.push(code);

  return {
    file,
    options,
    annotations,
    prerenderedHTML: renderHTML(children),
  };
}
