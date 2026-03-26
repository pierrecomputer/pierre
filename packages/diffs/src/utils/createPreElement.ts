import type { Element as HASTElement, Properties } from 'hast';

import type { PrePropertiesConfig } from '../types';
import { createHastElement } from './hast_utils';

export function createPreElement(options: PrePropertiesConfig): HASTElement {
  return createHastElement({
    tagName: 'pre',
    properties: createPreWrapperProperties(options),
  });
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
}: PrePropertiesConfig): Properties {
  const properties: Properties = {
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
    tabIndex: 0,
    style: `--diffs-min-number-column-width-default:${`${totalLines}`.length}ch;`,
  };

  return properties;
}
