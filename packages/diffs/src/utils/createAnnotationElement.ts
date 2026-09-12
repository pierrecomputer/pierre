import type { Element as HASTElement } from 'hast';

import type { AnnotationSpan } from '../types';
import { createHastElement } from './hast_utils';

export function createAnnotationElement(span: AnnotationSpan): HASTElement {
  return createHastElement({
    tagName: 'div',
    children: [
      createHastElement({
        tagName: 'div',
        children: span.annotations?.map((slotId) =>
          createHastElement({ tagName: 'slot', properties: { name: slotId } })
        ),
        properties: { 'data-annotation-content': '' },
      }),
    ],
    properties: {
      'data-line-annotation': `${span.hunkIndex},${span.lineIndex}`,
    },
  });
}
