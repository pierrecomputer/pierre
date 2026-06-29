import type { FileDiffOptions } from '../components/FileDiff';
import type { DiffHunksRendererOptions } from '../renderers/DiffHunksRenderer';

// Build the renderer option snapshot with direct property reads. CodeView item
// options may inherit prototype getters, so object spread can miss values.
export function getDiffHunksRendererOptions<LAnnotation>(
  options: FileDiffOptions<LAnnotation> | undefined
): DiffHunksRendererOptions {
  return {
    theme: options?.theme,
    disableLineNumbers: options?.disableLineNumbers,
    overflow: options?.overflow,
    collapsed: options?.collapsed,
    disableFileHeader: options?.disableFileHeader,
    disableVirtualizationBuffers: options?.disableVirtualizationBuffers,
    stickyHeader: options?.stickyHeader,
    preferredHighlighter: options?.preferredHighlighter,
    useCSSClasses: options?.useCSSClasses,
    useTokenTransformer: options?.useTokenTransformer,
    tokenizeMaxLineLength: options?.tokenizeMaxLineLength,
    tokenizeMaxLength: options?.tokenizeMaxLength,
    diffStyle: options?.diffStyle,
    diffIndicators: options?.diffIndicators,
    disableBackground: options?.disableBackground,
    hunkSeparators:
      typeof options?.hunkSeparators === 'function'
        ? 'custom'
        : options?.hunkSeparators,
    expandUnchanged: options?.expandUnchanged,
    loadDiffFiles: options?.loadDiffFiles,
    collapsedContextThreshold: options?.collapsedContextThreshold,
    lineDiffType: options?.lineDiffType,
    maxLineDiffLength: options?.maxLineDiffLength,
    expansionLineCount: options?.expansionLineCount,
    headerRenderMode:
      options?.renderCustomHeader != null ? 'custom' : 'default',
  };
}
