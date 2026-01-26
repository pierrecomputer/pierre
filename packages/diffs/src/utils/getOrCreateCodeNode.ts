interface CreateCodeNodeProps {
  pre?: HTMLPreElement;
  code?: HTMLElement;
  columnType?: 'additions' | 'deletions' | 'unified';
  rowSpan?: number;
}

export function getOrCreateCodeNode({
  code,
  pre,
  columnType,
  rowSpan,
}: CreateCodeNodeProps = {}): HTMLElement {
  if (code == null) {
    code = document.createElement('code');
    code.dataset.code = '';
    if (columnType != null) {
      code.dataset[columnType] = '';
    }
    pre?.appendChild(code);
  }
  if (rowSpan != null) {
    code.style.setProperty('grid-row', `span ${rowSpan}`);
  } else {
    code.style.removeProperty('grid-row');
  }
  return code;
}
