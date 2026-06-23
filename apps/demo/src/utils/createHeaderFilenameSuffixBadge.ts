export function createHeaderFilenameSuffixBadge(label: string): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'header-filename-suffix-badge';
  badge.textContent = label;
  return badge;
}
