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
  DiffFileInput,
  DiffLineAnnotation,
  FileContents,
  FileDiffMetadata,
  MaybeDiffFileInput,
} from '../types';
import {
  createStyleElement,
  createThemeStyleElement,
} from '../utils/createStyleElement';
import { wrapThemeCSS } from '../utils/cssWrappers';
import { getDiffFileInput } from '../utils/getDiffFileInput';
import { getSingularPatch } from '../utils/getSingularPatch';
import { parseDiffFromFile } from '../utils/parseDiffFromFile';
import { parseMergeConflictDiffFromFile } from '../utils/parseMergeConflictDiffFromFile';
import { shouldUseTokenTransformer } from '../utils/shouldUseTokenTransformer';
import { renderHTML } from './renderHTML';

interface PreloadDiffBaseOptions<LAnnotation, Caret> {
  options?: FileDiffOptions<LAnnotation, Caret>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
}

export type PreloadDiffOptions<LAnnotation, Caret> = PreloadDiffBaseOptions<
  LAnnotation,
  Caret
> &
  (
    | ({ fileDiff: FileDiffMetadata } & MaybeDiffFileInput)
    | ({ fileDiff?: undefined } & DiffFileInput)
  );

export async function preloadDiffHTML<
  LAnnotation = undefined,
  Caret = undefined,
>({
  fileDiff,
  oldFile,
  newFile,
  options,
  annotations,
}: PreloadDiffOptions<LAnnotation, Caret>): Promise<string> {
  const fileInput = getDiffFileInput({ oldFile, newFile }, 'preloadDiffHTML');
  if (fileDiff == null && fileInput != null) {
    fileDiff = parseDiffFromFile(
      fileInput.oldFile,
      fileInput.newFile,
      options?.parseDiffOptions
    );
  }
  if (fileDiff == null) {
    throw new Error(
      'preloadFileDiff: You must pass at least a fileDiff, oldFile, or newFile prop'
    );
  }
  const renderer = new DiffHunksRenderer<LAnnotation>(
    getHunksRendererOptions(options)
  );
  if (annotations != null && annotations.length > 0) {
    renderer.setLineAnnotations(annotations);
  }
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

interface PreloadMultiFileDiffBaseOptions<LAnnotation, Caret> {
  options?: FileDiffOptions<LAnnotation, Caret>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
}

export type PreloadMultiFileDiffOptions<LAnnotation, Caret> =
  PreloadMultiFileDiffBaseOptions<LAnnotation, Caret> & DiffFileInput;

export type PreloadMultiFileDiffResult<LAnnotation, Caret> =
  PreloadMultiFileDiffOptions<LAnnotation, Caret> & {
    prerenderedHTML: string;
  };

export async function preloadMultiFileDiff<
  LAnnotation = undefined,
  Caret = undefined,
>({
  oldFile,
  newFile,
  options,
  annotations,
}: PreloadMultiFileDiffOptions<LAnnotation, Caret>): Promise<
  PreloadMultiFileDiffResult<LAnnotation, Caret>
> {
  const fileInput = getDiffFileInput(
    { oldFile, newFile },
    'preloadMultiFileDiff'
  );
  if (fileInput == null) {
    throw new Error(
      'preloadMultiFileDiff: You must pass oldFile, newFile, or both'
    );
  }
  return {
    ...fileInput,
    options,
    annotations,
    prerenderedHTML: await preloadDiffHTML({
      ...fileInput,
      options,
      annotations,
    }),
  };
}

export interface PreloadFileDiffOptions<LAnnotation, Caret> {
  fileDiff: FileDiffMetadata;
  options?: FileDiffOptions<LAnnotation, Caret>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
}

export interface PreloadFileDiffResult<
  LAnnotation,
  Caret,
> extends PreloadFileDiffOptions<LAnnotation, Caret> {
  prerenderedHTML: string;
}

export async function preloadFileDiff<
  LAnnotation = undefined,
  Caret = undefined,
>({
  fileDiff,
  options,
  annotations,
}: PreloadFileDiffOptions<LAnnotation, Caret>): Promise<
  PreloadFileDiffResult<LAnnotation, Caret>
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

export interface PreloadUnresolvedFileOptions<LAnnotation> {
  file: FileContents;
  options?: Omit<
    UnresolvedFileOptions<LAnnotation>,
    'onMergeConflictAction' | 'onMergeConflictResolve' | 'onPostRender'
  >;
  annotations?: DiffLineAnnotation<LAnnotation>[];
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
}: PreloadUnresolvedFileOptions<LAnnotation>): Promise<
  PreloadUnresolvedFileResult<LAnnotation>
> {
  return {
    file,
    options,
    annotations,
    prerenderedHTML: await preloadUnresolvedFileHTML({
      file,
      options,
      annotations,
    }),
  };
}

export interface PreloadPatchDiffOptions<LAnnotation, Caret> {
  patch: string;
  options?: FileDiffOptions<LAnnotation, Caret>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
}

export interface PreloadPatchDiffResult<
  LAnnotation,
  Caret,
> extends PreloadPatchDiffOptions<LAnnotation, Caret> {
  prerenderedHTML: string;
}

export async function preloadPatchDiff<
  LAnnotation = undefined,
  Caret = undefined,
>({
  patch,
  options,
  annotations,
}: PreloadPatchDiffOptions<LAnnotation, Caret>): Promise<
  PreloadPatchDiffResult<LAnnotation, Caret>
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

function getHunksRendererOptions<LAnnotation, Caret>(
  options: FileDiffOptions<LAnnotation, Caret> | undefined
): DiffHunksRendererOptions {
  return {
    ...options,
    // Match the client's option snapshot: token callbacks imply the
    // transformer, so server markup hydrates into identical client renders.
    useTokenTransformer: shouldUseTokenTransformer<'diff'>(options),
    headerRenderMode:
      options?.renderCustomHeader != null ? 'custom' : 'default',
    hunkSeparators:
      typeof options?.hunkSeparators === 'function'
        ? 'custom'
        : options?.hunkSeparators,
  };
}
