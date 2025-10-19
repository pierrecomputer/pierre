import type {
  DiffLineAnnotation,
  LineAnnotation,
} from '@pierre/precision-diffs';
import type { LineCommentMetadata } from 'src/mocks';

function renderDOM(metadata: LineCommentMetadata) {
  const wrapper = document.createElement('div');
  wrapper.className = 'comment';
  const author = document.createElement('h6');
  author.innerText = metadata.author;
  const message = document.createElement('p');
  message.innerText = metadata.message;
  wrapper.appendChild(author);
  wrapper.appendChild(message);
  return wrapper;
}

export function renderDiffAnnotation(
  annotation: DiffLineAnnotation<LineCommentMetadata>
): HTMLElement {
  return renderDOM(annotation.metadata);
}

export function renderAnnotation(
  annotation: LineAnnotation<LineCommentMetadata>
): HTMLElement {
  return renderDOM(annotation.metadata);
}
