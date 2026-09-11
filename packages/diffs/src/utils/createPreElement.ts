import type { HTMLAttributes, PrePropertiesConfig } from '../types';
import { createHTMLElement } from './toHtml';

export function createPreElement(options: PrePropertiesConfig): string {
  return createHTMLElement('pre', createPreWrapperProperties(options));
}

export function createPreWrapperProperties({
  diffIndicators,
  disableBackground,
  disableLineNumbers,
  overflow,
  split,
  totalLines,
  type,
  customProperties,
}: PrePropertiesConfig): HTMLAttributes {
  const properties: HTMLAttributes = {
    // NOTE: We always apply custom properties first so the important
    // properties cannot be overridden
    ...customProperties,
    'data-diff': type === 'diff' ? '' : undefined,
    'data-file': type === 'file' ? '' : undefined,
    'data-diff-type':
      type === 'diff' ? (split ? 'split' : 'single') : undefined,
    'data-overflow': overflow,
    'data-disable-line-numbers': disableLineNumbers ? '' : undefined,
    'data-background': !disableBackground ? '' : undefined,
    'data-indicators':
      diffIndicators === 'bars' || diffIndicators === 'classic'
        ? diffIndicators
        : undefined,
    // The pre is intentionally not focusable. It is not the scroll container
    // (`[data-code]` inside it is) and has no keyboard behavior of its own, so
    // a tabindex would only add a tab stop per diff and steal focus from a host
    // wrapper that wants to own keyboard navigation of the selection.
    style: `--diffs-min-number-column-width-default:${`${totalLines}`.length}ch;`,
  };

  return properties;
}
