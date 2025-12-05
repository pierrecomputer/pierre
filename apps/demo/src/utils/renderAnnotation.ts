import type { DiffLineAnnotation, LineAnnotation } from '@pierre/diffs';

import type { LineCommentMetadata } from '../mocks';

function renderDOM(
  metadata: LineCommentMetadata,
  lineNumber: number,
  side: string = 'line'
) {
  const wrapper = document.createElement('div');
  wrapper.className = 'comment';
  const author = document.createElement('h6');
  author.innerText = metadata.author;
  author.innerText += `::(${side}-${lineNumber})`;
  const message = document.createElement('p');
  message.innerText = metadata.message;
  wrapper.appendChild(author);
  wrapper.appendChild(message);
  return wrapper;
}

export function renderDiffAnnotation(
  annotation: DiffLineAnnotation<LineCommentMetadata>
): HTMLElement {
  return renderDOM(annotation.metadata, annotation.lineNumber, annotation.side);
}

export function renderAnnotation(
  annotation: LineAnnotation<LineCommentMetadata>
): HTMLElement {
  return renderDOM(annotation.metadata, annotation.lineNumber);
}
