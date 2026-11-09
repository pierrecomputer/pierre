'use client';

import {
  SnippetFile as SnippetFileClass,
  type SnippetFileOptions,
} from '../components/SnippetFile';
import { DIFFS_TAG_NAME } from '../constants';
import type { GetHoveredLineResult } from '../managers/InteractionManager';
import type { FileContents } from '../types';
import type { FileProps } from './types';
import { renderFileChildren } from './utils/renderFileChildren';
import { templateRender } from './utils/templateRender';
import { useSnippetInstance } from './utils/useSnippetInstance';

/**
 * Experimental: this API may change in a minor release.
 * @experimental
 */
export interface SnippetFileProps<LAnnotation> extends Omit<
  FileProps<LAnnotation, undefined>,
  | 'options'
  | 'edit'
  | 'editorOptions'
  | 'editStateKey'
  | 'onEditChange'
  | 'onEditComplete'
  | 'metrics'
> {
  /**
   * Snippet options; `lineRange` is required. Reach the instance (for
   * `expandSnippet`) through `onPostRender`.
   */
  options: SnippetFileOptions<LAnnotation>;
  disableWorkerPool?: boolean;
}

/**
 * Renders a read-only snippet of a file: only `options.lineRange`, with
 * folds that open in place. Throws inside a `<Virtualizer>`.
 *
 * Experimental: this API may change in a minor release.
 * @experimental
 */
export function SnippetFile<LAnnotation = undefined>({
  file,
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
}: SnippetFileProps<LAnnotation>): React.JSX.Element {
  const { ref, getHoveredLine } = useSnippetInstance<
    SnippetFileClass<LAnnotation>,
    SnippetFileOptions<LAnnotation>,
    { file: FileContents; lineAnnotations: typeof lineAnnotations },
    GetHoveredLineResult<'file'>
  >({
    name: 'SnippetFile',
    options,
    create: (...args) => new SnippetFileClass<LAnnotation>(...args),
    renderProps: { file, lineAnnotations },
    selectedLines,
    prerenderedHTML,
    hasCustomHeader: renderCustomHeader != null,
    hasGutterRenderUtility: renderGutterUtility != null,
    disableWorkerPool,
  });
  const children = renderFileChildren({
    file,
    renderAnnotation,
    renderCustomHeader,
    renderHeaderPrefix,
    renderHeaderFilenameSuffix,
    renderHeaderMetadata,
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
