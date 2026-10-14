import type { Element as HASTElement } from 'hast';

import type { AnnotationSpan, LineTypes } from '../types';
import { createHastElement } from './hast_utils';

// An annotation row holding the span's slots. A line type styles the row like
// the line it sits under.
export function createAnnotationElement(
  span: AnnotationSpan,
  lineType?: LineTypes
): HASTElement {
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
      'data-line-type': lineType,
    },
  });
}
