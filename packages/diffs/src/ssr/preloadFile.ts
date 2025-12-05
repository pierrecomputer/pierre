import type { FileOptions } from '../../src/File';
import { FileRenderer } from '../FileRenderer';
import type { FileContents, LineAnnotation } from '../types';
import { createStyleElement } from '../utils/createStyleElement';
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
  const fileRenderer = new FileRenderer<LAnnotation>(options);

  // Set line annotations if provided
  if (annotations !== undefined && annotations.length > 0) {
    fileRenderer.setLineAnnotations(annotations);
  }

  const fileResult = await fileRenderer.asyncRender(file);

  const children = [createStyleElement(fileResult.css, true)];

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
    prerenderedHTML: renderHTML(children),
  };
}
