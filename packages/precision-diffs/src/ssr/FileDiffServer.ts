import { toHtml } from 'hast-util-to-html';

import type { FileOptions } from '../../src/File';
import type { FileDiffOptions } from '../../src/FileDiff';
import { DiffHunksRenderer } from '../DiffHunksRenderer';
import { FileHeaderRenderer } from '../FileHeaderRenderer';
import { FileRenderer } from '../FileRenderer';
import { SVGSpriteSheet } from '../sprite';
import rawStyles from '../style.css';
import type {
  DiffLineAnnotation,
  FileContents,
  FileDiffMetadata,
  LineAnnotation,
} from '../types';
import { createHastElement, createTextNode } from '../utils/hast_utils';
import { parseDiffFromFile } from '../utils/parseDiffFromFile';

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

export type PreloadFileDiffOptions<LAnnotation> = {
  fileDiff?: FileDiffMetadata;
  oldFile?: FileContents;
  newFile?: FileContents;
  options?: FileDiffOptions<LAnnotation>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
};

export interface PreloadedFileDiffResult<LAnnotation> {
  fileDiff: FileDiffMetadata;
  oldFile?: FileContents;
  newFile?: FileContents;
  options?: FileDiffOptions<LAnnotation>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
  prerenderedHTML: string;
}

export async function preloadFile<LAnnotation = undefined>({
  file,
  options,
  annotations,
}: PreloadFileOptions<LAnnotation>): Promise<PreloadedFileResult<LAnnotation>> {
  const { disableFileHeader = false } = options ?? {};
  const fileRenderer = new FileRenderer<LAnnotation>(options);
  const fileHeader = new FileHeaderRenderer(options);

  // Set line annotations if provided
  if (annotations !== undefined && annotations.length > 0) {
    fileRenderer.setLineAnnotations(annotations);
  }

  const [headerResult, fileResult] = await Promise.all([
    !disableFileHeader ? fileHeader.render(file) : undefined,
    fileRenderer.render(file, true),
  ]);
  if (fileResult == null) {
    throw new Error('Failed to render file diff');
  }
  const cssText = `@layer base, theme, unsafe;
    @layer base {
      ${rawStyles}
    }
    @layer theme {
      ${fileResult.css}
    }
    @layer unsafe {
      ${options?.unsafeCSS ?? ''}
    }`;

  const children = [
    createHastElement({
      tagName: 'style',
      children: [createTextNode(cssText)],
    }),
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
    prerenderedHTML: `${SVGSpriteSheet}${toHtml(children)}`,
  };
}

export async function preloadFileDiff<LAnnotation = undefined>({
  fileDiff,
  oldFile,
  newFile,
  options,
  annotations,
}: PreloadFileDiffOptions<LAnnotation>): Promise<
  PreloadedFileDiffResult<LAnnotation>
> {
  const { disableFileHeader = false } = options ?? {};
  if (fileDiff == null && oldFile != null && newFile != null) {
    fileDiff = parseDiffFromFile(oldFile, newFile);
  }
  if (fileDiff == null) {
    throw new Error(
      'preloadFileDiff: You must pass at least a fileDiff prop or oldFile/newFile props'
    );
  }
  const diffHunksRenderer = new DiffHunksRenderer<LAnnotation>({
    ...options,
    hunkSeparators:
      typeof options?.hunkSeparators === 'function'
        ? 'custom'
        : options?.hunkSeparators,
    useCSSClasses: true,
  });
  const fileHeader = new FileHeaderRenderer(options);

  // Set line annotations if provided
  if (annotations !== undefined && annotations.length > 0) {
    diffHunksRenderer.setLineAnnotations(annotations);
  }

  const [headerResult, hunkResult] = await Promise.all([
    !disableFileHeader ? fileHeader.render(fileDiff) : undefined,
    diffHunksRenderer.render(fileDiff),
  ]);
  if (hunkResult == null) {
    throw new Error('Failed to render file diff');
  }
  const cssText = `@layer base, theme, unsafe;
    @layer base {
      ${rawStyles}
    }
    @layer theme {
      ${hunkResult.css}
    }
    @layer unsafe {
      ${options?.unsafeCSS ?? ''}
    }`;

  const children = [
    createHastElement({
      tagName: 'style',
      children: [createTextNode(cssText)],
    }),
  ];
  if (headerResult != null) {
    children.push(headerResult);
  }
  const code = diffHunksRenderer.renderFullAST(hunkResult);
  code.properties['data-dehydrated'] = '';
  children.push(code);

  return {
    fileDiff,
    oldFile,
    newFile,
    options,
    annotations,
    prerenderedHTML: `${SVGSpriteSheet}${toHtml(children)}`,
  };
}
