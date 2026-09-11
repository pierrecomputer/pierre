import type { AnnotationSpan } from '../types';
import { createHTMLElement } from './toHtml';

export function createAnnotationElement(span: AnnotationSpan): string {
  return createHTMLElement(
    'div',
    {
      'data-line-annotation': `${span.hunkIndex},${span.lineIndex}`,
    },
    createHTMLElement(
      'div',
      { 'data-annotation-content': '' },
      ...(span.annotations?.map((slotId) =>
        createHTMLElement('slot', { name: slotId })
      ) ?? [])
    )
  );
}
