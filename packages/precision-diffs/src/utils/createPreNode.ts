import type { Element as HASTElement } from 'hast';
import type { CreatePreWrapperPropertiesProps } from 'src/types';

import { createHastElement, createPreWrapperProperties } from './hast_utils';

export function createPreNode(
  options: CreatePreWrapperPropertiesProps
): HASTElement {
  return createHastElement({
    tagName: 'pre',
    properties: createPreWrapperProperties(options),
  });
}
