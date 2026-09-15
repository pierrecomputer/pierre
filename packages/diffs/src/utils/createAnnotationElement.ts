import type { AnnotationSpan, HElement as HtmlElement } from '../types';
import { createHtmlElement } from './html';

export function createAnnotationElement(span: AnnotationSpan): HtmlElement {
  return createHtmlElement({
    tagName: 'div',
    children: [
      createHtmlElement({
        tagName: 'div',
        children: span.annotations?.map((slotId) =>
          createHtmlElement({ tagName: 'slot', properties: { name: slotId } })
        ),
        properties: { 'data-annotation-content': '' },
      }),
    ],
    properties: {
      'data-line-annotation': `${span.hunkIndex},${span.lineIndex}`,
    },
  });
}
