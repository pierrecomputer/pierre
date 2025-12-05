interface CreateCodeNodeProps {
  pre?: HTMLPreElement;
  columnType?: 'additions' | 'deletions' | 'unified';
}

export function createCodeNode({
  pre,
  columnType,
}: CreateCodeNodeProps = {}): HTMLElement {
  const code = document.createElement('code');
  code.dataset.code = '';
  if (columnType != null) {
    code.dataset[columnType] = '';
  }
  pre?.appendChild(code);
  return code;
}
