import type { Element as HASTElement } from 'hast';

import type { CreatePreWrapperPropertiesProps } from '../types';
import { createPreWrapperProperties } from './createPreWrapperProperties';
import { createHastElement } from './hast_utils';

export function createPreElement(
  options: CreatePreWrapperPropertiesProps
): HASTElement {
  return createHastElement({
    tagName: 'pre',
    properties: createPreWrapperProperties(options),
  });
}
