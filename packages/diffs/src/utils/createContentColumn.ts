import type { RenderedRow } from '../types';
import { createHTMLElement, renderRows } from './toHtml';

export function createContentColumn(
  children: RenderedRow[],
  rowCount: number
): string {
  return createHTMLElement(
    'div',
    { 'data-content': '', style: `grid-row: span ${rowCount}` },
    renderRows(children)
  );
}
