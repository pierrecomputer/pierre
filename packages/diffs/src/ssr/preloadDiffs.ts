import type { FileDiffOptions } from '../components/FileDiff';
import { DiffHunksRenderer } from '../renderers/DiffHunksRenderer';
import { UnresolvedFileHunksRenderer } from '../renderers/UnresolvedFileHunksRenderer';
import type {
  BaseDiffOptions,
  DiffLineAnnotation,
  FileContents,
  FileDiffMetadata,
} from '../types';
import { createStyleElement } from '../utils/createStyleElement';
import { getSingularPatch } from '../utils/getSingularPatch';
import { normalizeUnresolvedFileOptions } from '../utils/normalizeUnresolvedFileOptions';
import { parseDiffFromFile } from '../utils/parseDiffFromFile';
import {
  getMergeConflictActionAnnotations,
  type MergeConflictActionAnnotationMetadata,
  type MergeConflictDiffAction,
  parseMergeConflictDiffFromFile,
} from '../utils/parseMergeConflictDiffFromFile';
import { renderHTML } from './renderHTML';

type PreloadMergeConflictActionsInput =
  | 'none'
  | 'default'
  | ((action: MergeConflictDiffAction) => unknown);
type PreloadMergeConflictActionsOutput = 'none' | 'default';

export interface PreloadDiffOptions<LAnnotation> {
  fileDiff?: FileDiffMetadata;
  oldFile?: FileContents;
  newFile?: FileContents;
  options?: FileDiffOptions<LAnnotation>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
}

function getHunksRendererOptions<LAnnotation>(
  options: FileDiffOptions<LAnnotation> | undefined
): BaseDiffOptions {
  return {
    ...options,
    hunkSeparators:
      typeof options?.hunkSeparators === 'function'
        ? 'custom'
        : options?.hunkSeparators,
  };
}

async function preloadDiffHTMLWithRenderer<LAnnotation>({
  fileDiff,
  options,
  annotations,
  renderer,
}: {
  fileDiff: FileDiffMetadata;
  options: FileDiffOptions<LAnnotation> | undefined;
  annotations: DiffLineAnnotation<LAnnotation>[] | undefined;
  renderer: DiffHunksRenderer<LAnnotation>;
}): Promise<string> {
  if (annotations != null && annotations.length > 0) {
    renderer.setLineAnnotations(annotations);
  }

  const hunkResult = await renderer.asyncRender(fileDiff);
  const children = [createStyleElement(hunkResult.css, true)];

  if (options?.unsafeCSS != null) {
    children.push(createStyleElement(options.unsafeCSS));
  }
  if (hunkResult.headerElement != null) {
    children.push(hunkResult.headerElement);
  }

  const code = renderer.renderFullAST(hunkResult);
  code.properties['data-dehydrated'] = '';
  children.push(code);
  return renderHTML(children);
}

export async function preloadDiffHTML<LAnnotation = undefined>({
  fileDiff,
  oldFile,
  newFile,
  options,
  annotations,
}: PreloadDiffOptions<LAnnotation>): Promise<string> {
  if (fileDiff == null && oldFile != null && newFile != null) {
    fileDiff = parseDiffFromFile(oldFile, newFile);
  }
  if (fileDiff == null) {
    throw new Error(
      'preloadFileDiff: You must pass at least a fileDiff prop or oldFile/newFile props'
    );
  }
  return preloadDiffHTMLWithRenderer({
    fileDiff,
    options,
    annotations,
    renderer: new DiffHunksRenderer<LAnnotation>(
      getHunksRendererOptions(options)
    ),
  });
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

export interface PreloadUnresolvedFileOptions<LAnnotation> {
  file: FileContents;
  options?: FileDiffOptions<
    LAnnotation | MergeConflictActionAnnotationMetadata
  > & {
    mergeConflictActions?: PreloadMergeConflictActionsInput;
  };
  annotations?: DiffLineAnnotation<LAnnotation>[];
}

export interface PreloadUnresolvedFileResult<LAnnotation> {
  file: FileContents;
  options?: FileDiffOptions<
    LAnnotation | MergeConflictActionAnnotationMetadata
  > & {
    mergeConflictActions?: PreloadMergeConflictActionsOutput;
  };
  annotations?: DiffLineAnnotation<LAnnotation>[];
  prerenderedHTML: string;
}

export async function preloadUnresolvedFile<LAnnotation = undefined>({
  file,
  options,
  annotations,
}: PreloadUnresolvedFileOptions<LAnnotation>): Promise<
  PreloadUnresolvedFileResult<LAnnotation>
> {
  const inputMergeConflictActions = options?.mergeConflictActions;
  const mergeConflictActionsMode: PreloadMergeConflictActionsOutput =
    inputMergeConflictActions === 'none' ? 'none' : 'default';
  const { fileDiff, actions } = parseMergeConflictDiffFromFile(file);
  const includeDefaultActions = mergeConflictActionsMode !== 'none';
  const mergeConflictAnnotations = includeDefaultActions
    ? getMergeConflictActionAnnotations(actions)
    : [];
  const mergeConflictOptions: FileDiffOptions<
    LAnnotation | MergeConflictActionAnnotationMetadata
  > & {
    mergeConflictActions?: PreloadMergeConflictActionsOutput;
  } = {
    ...options,
    ...normalizeUnresolvedFileOptions(options),
    mergeConflictActions: mergeConflictActionsMode,
  };
  const unresolvedRenderer = new UnresolvedFileHunksRenderer<
    LAnnotation | MergeConflictActionAnnotationMetadata
  >(getHunksRendererOptions(mergeConflictOptions));
  unresolvedRenderer.setRenderDefaultMergeConflictActions(
    inputMergeConflictActions !== 'none' &&
      typeof inputMergeConflictActions !== 'function'
  );
  unresolvedRenderer.setMergeConflictActionAnnotations(
    mergeConflictAnnotations
  );

  return {
    file,
    options: mergeConflictOptions,
    annotations,
    prerenderedHTML: await preloadDiffHTMLWithRenderer({
      fileDiff,
      options: mergeConflictOptions,
      annotations,
      renderer: unresolvedRenderer,
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
