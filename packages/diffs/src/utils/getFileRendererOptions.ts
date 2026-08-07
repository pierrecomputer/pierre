import type { FileOptions } from '../components/File';
import type { FileRendererOptions } from '../renderers/FileRenderer';
import { shouldUseTokenTransformer } from './shouldUseTokenTransformer';

// Build the renderer option snapshot with direct property reads. CodeView item
// options may inherit prototype getters, so object spread can miss values.
export function getFileRendererOptions<LAnnotation>(
  options: FileOptions<LAnnotation> | undefined
): FileRendererOptions {
  return {
    theme: options?.theme,
    disableLineNumbers: options?.disableLineNumbers,
    overflow: options?.overflow,
    themeType: options?.themeType,
    collapsed: options?.collapsed,
    disableFileHeader: options?.disableFileHeader,
    disableVirtualizationBuffers: options?.disableVirtualizationBuffers,
    stickyHeader: options?.stickyHeader,
    folding: options?.folding,
    preferredHighlighter: options?.preferredHighlighter,
    useCSSClasses: options?.useCSSClasses,
    useTokenTransformer: shouldUseTokenTransformer(options),
    tokenizeMaxLineLength: options?.tokenizeMaxLineLength,
    tokenizeMaxLength: options?.tokenizeMaxLength,
    unsafeCSS: options?.unsafeCSS,
    headerRenderMode:
      options?.renderCustomHeader != null ? 'custom' : 'default',
  };
}
