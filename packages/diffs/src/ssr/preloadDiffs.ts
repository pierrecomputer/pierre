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
  DiffDecorationItem,
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

interface PreloadDiffBaseOptions<LAnnotation, LDecoration> {
  options?: FileDiffOptions<LAnnotation, LDecoration>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
  decorations?: DiffDecorationItem<LDecoration>[];
}

export type PreloadDiffOptions<
  LAnnotation = undefined,
  LDecoration = undefined,
> = PreloadDiffBaseOptions<LAnnotation, LDecoration> &
  (
    | ({ fileDiff: FileDiffMetadata } & MaybeDiffFileInput)
    | ({ fileDiff?: undefined } & DiffFileInput)
  );

export async function preloadDiffHTML<
  LAnnotation = undefined,
  LDecoration = undefined,
>({
  fileDiff,
  oldFile,
  newFile,
  options,
  annotations,
  decorations,
}: PreloadDiffOptions<LAnnotation, LDecoration>): Promise<string> {
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
  const renderer = new DiffHunksRenderer<LAnnotation, LDecoration>(
    getHunksRendererOptions(options)
  );
  if (annotations != null && annotations.length > 0) {
    renderer.setLineAnnotations(annotations);
  }
  if (decorations != null && decorations.length > 0) {
    renderer.setDecorations(decorations);
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

export async function preloadUnresolvedFileHTML<
  LAnnotation = undefined,
  LDecoration = undefined,
>({
  file,
  options,
  annotations,
  decorations,
}: PreloadUnresolvedFileOptions<LAnnotation, LDecoration>): Promise<string> {
  const { fileDiff, actions, markerRows } = parseMergeConflictDiffFromFile(
    file,
    options?.maxContextLines
  );
  const renderer = new UnresolvedFileHunksRenderer<LAnnotation, LDecoration>(
    getUnresolvedDiffHunksRendererOptions(options)
  );
  if (annotations != null && annotations.length > 0) {
    renderer.setLineAnnotations(annotations);
  }
  if (decorations != null && decorations.length > 0) {
    renderer.setDecorations(decorations);
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

interface PreloadMultiFileDiffBaseOptions<LAnnotation, LDecoration> {
  options?: FileDiffOptions<LAnnotation, LDecoration>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
  decorations?: DiffDecorationItem<LDecoration>[];
}

export type PreloadMultiFileDiffOptions<
  LAnnotation = undefined,
  LDecoration = undefined,
> = PreloadMultiFileDiffBaseOptions<LAnnotation, LDecoration> & DiffFileInput;

export type PreloadMultiFileDiffResult<
  LAnnotation = undefined,
  LDecoration = undefined,
> = PreloadMultiFileDiffOptions<LAnnotation, LDecoration> & {
  prerenderedHTML: string;
};

export async function preloadMultiFileDiff<
  LAnnotation = undefined,
  LDecoration = undefined,
>({
  oldFile,
  newFile,
  options,
  annotations,
  decorations,
}: PreloadMultiFileDiffOptions<LAnnotation, LDecoration>): Promise<
  PreloadMultiFileDiffResult<LAnnotation, LDecoration>
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
    decorations,
    prerenderedHTML: await preloadDiffHTML({
      ...fileInput,
      options,
      annotations,
      decorations,
    }),
  };
}

export interface PreloadFileDiffOptions<
  LAnnotation = undefined,
  LDecoration = undefined,
> {
  fileDiff: FileDiffMetadata;
  options?: FileDiffOptions<LAnnotation, LDecoration>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
  decorations?: DiffDecorationItem<LDecoration>[];
}

export interface PreloadFileDiffResult<
  LAnnotation = undefined,
  LDecoration = undefined,
> extends PreloadFileDiffOptions<LAnnotation, LDecoration> {
  prerenderedHTML: string;
}

export async function preloadFileDiff<
  LAnnotation = undefined,
  LDecoration = undefined,
>({
  fileDiff,
  options,
  annotations,
  decorations,
}: PreloadFileDiffOptions<LAnnotation, LDecoration>): Promise<
  PreloadFileDiffResult<LAnnotation, LDecoration>
> {
  return {
    fileDiff,
    options,
    annotations,
    decorations,
    prerenderedHTML: await preloadDiffHTML({
      fileDiff,
      options,
      annotations,
      decorations,
    }),
  };
}

export interface PreloadUnresolvedFileOptions<
  LAnnotation = undefined,
  LDecoration = undefined,
> {
  file: FileContents;
  options?: Omit<
    UnresolvedFileOptions<LAnnotation, LDecoration>,
    'onMergeConflictAction' | 'onMergeConflictResolve' | 'onPostRender'
  >;
  annotations?: DiffLineAnnotation<LAnnotation>[];
  decorations?: DiffDecorationItem<LDecoration>[];
}

export interface PreloadUnresolvedFileResult<
  LAnnotation = undefined,
  LDecoration = undefined,
> extends PreloadUnresolvedFileOptions<LAnnotation, LDecoration> {
  prerenderedHTML: string;
}

export async function preloadUnresolvedFile<
  LAnnotation = undefined,
  LDecoration = undefined,
>({
  file,
  options,
  annotations,
  decorations,
}: PreloadUnresolvedFileOptions<LAnnotation, LDecoration>): Promise<
  PreloadUnresolvedFileResult<LAnnotation, LDecoration>
> {
  return {
    file,
    options,
    annotations,
    decorations,
    prerenderedHTML: await preloadUnresolvedFileHTML({
      file,
      options,
      annotations,
      decorations,
    }),
  };
}

export interface PreloadPatchDiffOptions<LAnnotation, LDecoration> {
  patch: string;
  options?: FileDiffOptions<LAnnotation, LDecoration>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
  decorations?: DiffDecorationItem<LDecoration>[];
}

export interface PreloadPatchDiffResult<
  LAnnotation,
  LDecoration,
> extends PreloadPatchDiffOptions<LAnnotation, LDecoration> {
  prerenderedHTML: string;
}

export async function preloadPatchDiff<
  LAnnotation = undefined,
  LDecoration = undefined,
>({
  patch,
  options,
  annotations,
  decorations,
}: PreloadPatchDiffOptions<LAnnotation, LDecoration>): Promise<
  PreloadPatchDiffResult<LAnnotation, LDecoration>
> {
  const fileDiff = getSingularPatch(patch);
  return {
    patch,
    options,
    annotations,
    decorations,
    prerenderedHTML: await preloadDiffHTML({
      fileDiff,
      options,
      annotations,
      decorations,
    }),
  };
}

function processHunkResult<LAnnotation, LDecoration>(
  hunkResult: HunksRenderResult,
  renderer:
    | DiffHunksRenderer<LAnnotation, LDecoration>
    | UnresolvedFileHunksRenderer<LAnnotation, LDecoration>,
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

function getHunksRendererOptions<LAnnotation, LDecoration>(
  options: FileDiffOptions<LAnnotation, LDecoration> | undefined
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
