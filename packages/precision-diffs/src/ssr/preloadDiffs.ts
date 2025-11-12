import type { FileDiffOptions } from '../../src/FileDiff';
import { DiffHunksRenderer } from '../DiffHunksRenderer';
import { FileHeaderRenderer } from '../FileHeaderRenderer';
import type {
  DiffLineAnnotation,
  FileContents,
  FileDiffMetadata,
} from '../types';
import { getSingularPatch } from '../utils/getSingularPatch';
import { createStyleElement } from '../utils/hast_utils';
import { parseDiffFromFile } from '../utils/parseDiffFromFile';
import { renderCSS } from './renderCSS';
import { renderHTML } from './renderHTML';

export interface PreloadDiffOptions<LAnnotation> {
  fileDiff?: FileDiffMetadata;
  oldFile?: FileContents;
  newFile?: FileContents;
  options?: FileDiffOptions<LAnnotation>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
}

export async function preloadDiffHTML<LAnnotation = undefined>({
  fileDiff,
  oldFile,
  newFile,
  options,
  annotations,
}: PreloadDiffOptions<LAnnotation>): Promise<string> {
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

  const children = [
    createStyleElement(renderCSS(hunkResult.css, options?.unsafeCSS)),
  ];
  if (headerResult != null) {
    children.push(headerResult);
  }
  const code = diffHunksRenderer.renderFullAST(hunkResult);
  code.properties['data-dehydrated'] = '';
  children.push(code);

  return renderHTML(children);
}

export interface PreloadMultiFileDiffOptions<LAnnotation> {
  oldFile: FileContents;
  newFile: FileContents;
  options?: FileDiffOptions<LAnnotation>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
}

export interface PreloadMultiFileDiffResult<LAnnotation> {
  oldFile: FileContents;
  newFile: FileContents;
  options?: FileDiffOptions<LAnnotation>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
  prerenderedHTML: string;
}

export async function preloadMultiFileDiff<LAnnotation = undefined>({
  oldFile,
  newFile,
  options,
  annotations,
}: PreloadMultiFileDiffOptions<LAnnotation>): Promise<
  PreloadMultiFileDiffResult<LAnnotation>
> {
  return {
    newFile,
    oldFile,
    options,
    annotations,
    prerenderedHTML: await preloadDiffHTML({
      oldFile,
      newFile,
      options,
      annotations,
    }),
  };
}

export interface PreloadFileDiffOptions<LAnnotation> {
  fileDiff: FileDiffMetadata;
  options?: FileDiffOptions<LAnnotation>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
}

export interface PreloadFileDiffResult<LAnnotation> {
  fileDiff: FileDiffMetadata;
  options?: FileDiffOptions<LAnnotation>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
  prerenderedHTML: string;
}

export async function preloadFileDiff<LAnnotation = undefined>({
  fileDiff,
  options,
  annotations,
}: PreloadFileDiffOptions<LAnnotation>): Promise<
  PreloadFileDiffResult<LAnnotation>
> {
  return {
    fileDiff,
    options,
    annotations,
    prerenderedHTML: await preloadDiffHTML({
      fileDiff,
      options,
      annotations,
    }),
  };
}

export interface PreloadPatchDiffOptions<LAnnotation> {
  patch: string;
  options?: FileDiffOptions<LAnnotation>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
}

export interface PreloadPatchDiffResult<LAnnotation> {
  patch: string;
  options?: FileDiffOptions<LAnnotation>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
  prerenderedHTML: string;
}

export async function preloadPatchDiff<LAnnotation = undefined>({
  patch,
  options,
  annotations,
}: PreloadPatchDiffOptions<LAnnotation>): Promise<
  PreloadPatchDiffResult<LAnnotation>
> {
  const fileDiff = getSingularPatch(patch);
  return {
    patch,
    options,
    annotations,
    prerenderedHTML: await preloadDiffHTML({
      fileDiff,
      options,
      annotations,
    }),
  };
}
