'use client';

import {
  SnippetFileDiff as SnippetFileDiffClass,
  type SnippetFileDiffOptions,
} from '../components/SnippetFileDiff';
import { DIFFS_TAG_NAME } from '../constants';
import type { GetHoveredLineResult } from '../managers/InteractionManager';
import type { FileDiffMetadata } from '../types';
import type { DiffBasePropsReact } from './types';
import { renderDiffChildren } from './utils/renderDiffChildren';
import { templateRender } from './utils/templateRender';
import { useSnippetInstance } from './utils/useSnippetInstance';

/**
 * Experimental: this API may change in a minor release.
 * @experimental
 */
export interface SnippetFileDiffProps<LAnnotation> extends Omit<
  DiffBasePropsReact<LAnnotation, undefined>,
  | 'options'
  | 'edit'
  | 'editorOptions'
  | 'editStateKey'
  | 'onEditChange'
  | 'onEditComplete'
  | 'metrics'
> {
  fileDiff: FileDiffMetadata;
  /**
   * Snippet options; `lineRange` is required. Reach the instance (for
   * `expandSnippet`) through `onPostRender`.
   */
  options: SnippetFileDiffOptions<LAnnotation>;
  disableWorkerPool?: boolean;
}

/**
 * Renders a read-only snippet of a complete diff: only `options.lineRange`,
 * with folds that open in place. Throws inside a `<Virtualizer>`.
 *
 * Experimental: this API may change in a minor release.
 * @experimental
 */
export function SnippetFileDiff<LAnnotation = undefined>({
  fileDiff,
  options,
  lineAnnotations,
  selectedLines,
  className,
  style,
  prerenderedHTML,
  renderAnnotation,
  renderCustomHeader,
  renderHeaderPrefix,
  renderHeaderFilenameSuffix,
  renderHeaderMetadata,
  renderGutterUtility,
  disableWorkerPool = false,
}: SnippetFileDiffProps<LAnnotation>): React.JSX.Element {
  const { ref, getHoveredLine } = useSnippetInstance<
    SnippetFileDiffClass<LAnnotation>,
    SnippetFileDiffOptions<LAnnotation>,
    { fileDiff: FileDiffMetadata; lineAnnotations: typeof lineAnnotations },
    GetHoveredLineResult<'diff'>
  >({
    name: 'SnippetFileDiff',
    options,
    create: (...args) => new SnippetFileDiffClass<LAnnotation>(...args),
    renderProps: { fileDiff, lineAnnotations },
    selectedLines,
    prerenderedHTML,
    hasCustomHeader: renderCustomHeader != null,
    hasGutterRenderUtility: renderGutterUtility != null,
    disableWorkerPool,
  });
  const children = renderDiffChildren({
    fileDiff,
    renderCustomHeader,
    renderHeaderPrefix,
    renderHeaderFilenameSuffix,
    renderHeaderMetadata,
    renderAnnotation,
    renderGutterUtility,
    lineAnnotations,
    getHoveredLine,
  });
  return (
    <DIFFS_TAG_NAME ref={ref} className={className} style={style}>
      {templateRender(children, prerenderedHTML)}
    </DIFFS_TAG_NAME>
  );
}
