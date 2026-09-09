import { createHTMLElement, type RenderedRow, renderRows } from './html';

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
