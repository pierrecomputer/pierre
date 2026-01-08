interface CreateCodeNodeProps {
  pre?: HTMLPreElement;
  code?: HTMLElement;
  columnType?: 'additions' | 'deletions' | 'unified';
}

export function getOrCreateCodeNode({
  code,
  pre,
  columnType,
}: CreateCodeNodeProps = {}): HTMLElement {
  if (code != null) {
    return code;
  }
  code = document.createElement('code');
  code.dataset.code = '';
  if (columnType != null) {
    code.dataset[columnType] = '';
  }
  pre?.appendChild(code);
  return code;
}
