import type { FileDiffMetadata, LineAnnotation } from '@pierre/diff-ui';
import type { LineCommentMetadata } from 'src/mocks';

export function renderAnnotation(
  annotation: LineAnnotation<LineCommentMetadata>,
  _fileDiff: FileDiffMetadata
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'comment';
  const author = document.createElement('h6');
  author.innerText = annotation.metadata.author;
  const message = document.createElement('p');
  message.innerText = annotation.metadata.message;
  wrapper.appendChild(author);
  wrapper.appendChild(message);
  return wrapper;
}
