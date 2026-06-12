import type { FileDiffOptions } from '../components/FileDiff';
import {
  getUnresolvedDiffHunksRendererOptions,
  type UnresolvedFileOptions,
} from '../components/UnresolvedFile';
import {
  DiffHunksRenderer,
  type DiffHunksRendererOptions,
  type HunksRenderResult,
} from '../renderers/DiffHunksRenderer';
import { UnresolvedFileHunksRenderer } from '../renderers/UnresolvedFileHunksRenderer';
import type {
  DiffLineAnnotation,
  DiffSpanDecoration,
  FileContents,
  FileDiffMetadata,
} from '../types';
import {
  createStyleElement,
  createThemeStyleElement,
} from '../utils/createStyleElement';
import { wrapThemeCSS } from '../utils/cssWrappers';
import { getSingularPatch } from '../utils/getSingularPatch';
import { parseDiffFromFile } from '../utils/parseDiffFromFile';
import { parseMergeConflictDiffFromFile } from '../utils/parseMergeConflictDiffFromFile';
import { renderHTML } from './renderHTML';

export interface PreloadDiffOptions<LAnnotation> {
  fileDiff?: FileDiffMetadata;
  oldFile?: FileContents;
  newFile?: FileContents;
  options?: FileDiffOptions<LAnnotation>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
  spanDecorations?: DiffSpanDecoration[];
}

export async function preloadDiffHTML<LAnnotation = undefined>({
  fileDiff,
  oldFile,
  newFile,
  options,
  annotations,
  spanDecorations,
}: PreloadDiffOptions<LAnnotation>): Promise<string> {
  if (fileDiff == null && oldFile != null && newFile != null) {
    fileDiff = parseDiffFromFile(oldFile, newFile, options?.parseDiffOptions);
  }
  if (fileDiff == null) {
    throw new Error(
      'preloadFileDiff: You must pass at least a fileDiff prop or oldFile/newFile props'
    );
  }
  const renderer = new DiffHunksRenderer<LAnnotation>(
    getHunksRendererOptions(options)
  );
  if (annotations != null && annotations.length > 0) {
    renderer.setLineAnnotations(annotations);
  }
  renderer.setSpanDecorations(spanDecorations);
  return renderHTML(
    processHunkResult(
      await renderer.asyncRender(fileDiff),
      renderer,
      options?.unsafeCSS,
      options?.themeType ?? 'system'
    )
  );
}

export async function preloadUnresolvedFileHTML<LAnnotation = undefined>({
  file,
  options,
  annotations,
  spanDecorations,
}: PreloadUnresolvedFileOptions<LAnnotation>): Promise<string> {
  const { fileDiff, actions, markerRows } = parseMergeConflictDiffFromFile(
    file,
    options?.maxContextLines
  );
  const renderer = new UnresolvedFileHunksRenderer<LAnnotation>(
    getUnresolvedDiffHunksRendererOptions(options)
  );
  if (annotations != null && annotations.length > 0) {
    renderer.setLineAnnotations(annotations);
  }
  renderer.setSpanDecorations(spanDecorations);
  renderer.setConflictState(actions, markerRows, fileDiff);
  return renderHTML(
    processHunkResult(
      await renderer.asyncRender(fileDiff),
      renderer,
      options?.unsafeCSS,
      options?.themeType ?? 'system'
    )
  );
}

export interface PreloadMultiFileDiffOptions<LAnnotation> {
  oldFile: FileContents;
  newFile: FileContents;
  options?: FileDiffOptions<LAnnotation>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
  spanDecorations?: DiffSpanDecoration[];
}

export interface PreloadMultiFileDiffResult<
  LAnnotation,
> extends PreloadMultiFileDiffOptions<LAnnotation> {
  prerenderedHTML: string;
}

export async function preloadMultiFileDiff<LAnnotation = undefined>({
  oldFile,
  newFile,
  options,
  annotations,
  spanDecorations,
}: PreloadMultiFileDiffOptions<LAnnotation>): Promise<
  PreloadMultiFileDiffResult<LAnnotation>
> {
  return {
    newFile,
    oldFile,
    options,
    annotations,
    spanDecorations,
    prerenderedHTML: await preloadDiffHTML({
      oldFile,
      newFile,
      options,
      annotations,
      spanDecorations,
    }),
  };
}

export interface PreloadFileDiffOptions<LAnnotation> {
  fileDiff: FileDiffMetadata;
  options?: FileDiffOptions<LAnnotation>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
  spanDecorations?: DiffSpanDecoration[];
}

export interface PreloadFileDiffResult<
  LAnnotation,
> extends PreloadFileDiffOptions<LAnnotation> {
  prerenderedHTML: string;
}

export async function preloadFileDiff<LAnnotation = undefined>({
  fileDiff,
  options,
  annotations,
  spanDecorations,
}: PreloadFileDiffOptions<LAnnotation>): Promise<
  PreloadFileDiffResult<LAnnotation>
> {
  return {
    fileDiff,
    options,
    annotations,
    spanDecorations,
    prerenderedHTML: await preloadDiffHTML({
      fileDiff,
      options,
      annotations,
      spanDecorations,
    }),
  };
}

export interface PreloadUnresolvedFileOptions<LAnnotation> {
  file: FileContents;
  options?: Omit<
    UnresolvedFileOptions<LAnnotation>,
    'onMergeConflictAction' | 'onMergeConflictResolve' | 'onPostRender'
  >;
  annotations?: DiffLineAnnotation<LAnnotation>[];
  spanDecorations?: DiffSpanDecoration[];
}

export interface PreloadUnresolvedFileResult<
  LAnnotation,
> extends PreloadUnresolvedFileOptions<LAnnotation> {
  prerenderedHTML: string;
}

export async function preloadUnresolvedFile<LAnnotation = undefined>({
  file,
  options,
  annotations,
  spanDecorations,
}: PreloadUnresolvedFileOptions<LAnnotation>): Promise<
  PreloadUnresolvedFileResult<LAnnotation>
> {
  return {
    file,
    options,
    annotations,
    spanDecorations,
    prerenderedHTML: await preloadUnresolvedFileHTML({
      file,
      options,
      annotations,
      spanDecorations,
    }),
  };
}

export interface PreloadPatchDiffOptions<LAnnotation> {
  patch: string;
  options?: FileDiffOptions<LAnnotation>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
  spanDecorations?: DiffSpanDecoration[];
}

export interface PreloadPatchDiffResult<
  LAnnotation,
> extends PreloadPatchDiffOptions<LAnnotation> {
  prerenderedHTML: string;
}

export async function preloadPatchDiff<LAnnotation = undefined>({
  patch,
  options,
  annotations,
  spanDecorations,
}: PreloadPatchDiffOptions<LAnnotation>): Promise<
  PreloadPatchDiffResult<LAnnotation>
> {
  const fileDiff = getSingularPatch(patch);
  return {
    patch,
    options,
    annotations,
    spanDecorations,
    prerenderedHTML: await preloadDiffHTML({
      fileDiff,
      options,
      annotations,
      spanDecorations,
    }),
  };
}

function processHunkResult<LAnnotation>(
  hunkResult: HunksRenderResult,
  renderer:
    | DiffHunksRenderer<LAnnotation>
    | UnresolvedFileHunksRenderer<LAnnotation>,
  unsafeCSS: string | undefined,
  themeType: 'system' | 'light' | 'dark'
) {
  const children = [createStyleElement(hunkResult.css, true)];
  children.push(
    createThemeStyleElement(
      wrapThemeCSS(
        hunkResult.themeStyles,
        hunkResult.baseThemeType ?? themeType
      )
    )
  );
  if (unsafeCSS != null) {
    children.push(createStyleElement(unsafeCSS));
  }
  if (hunkResult.headerElement != null) {
    children.push(hunkResult.headerElement);
  }
  const code = renderer.renderFullAST(hunkResult);
  code.properties['data-dehydrated'] = '';
  children.push(code);
  return children;
}

function getHunksRendererOptions<LAnnotation>(
  options: FileDiffOptions<LAnnotation> | undefined
): DiffHunksRendererOptions {
  return {
    ...options,
    headerRenderMode:
      options?.renderCustomHeader != null ? 'custom' : 'default',
    hunkSeparators:
      typeof options?.hunkSeparators === 'function'
        ? 'custom'
        : options?.hunkSeparators,
  };
}
