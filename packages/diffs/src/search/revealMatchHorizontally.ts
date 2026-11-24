// Scrolls a match's code column sideways until the match is in view. Instant
// scrolling overrides scroll-behavior without moving the vertical viewport.
// Returns false when the column is not laid out yet, so the host can retry
// after its next render.
export function revealMatchHorizontally(range: Range): boolean {
  const code =
    range.startContainer.parentElement?.closest<HTMLElement>('[data-code]');
  if (code == null || code.clientWidth === 0) return false;
  if (code.scrollWidth <= code.clientWidth) return true;
  const rect = range.getBoundingClientRect();
  const viewport = code.getBoundingClientRect();
  const gutter = code.querySelector<HTMLElement>(':scope > [data-gutter]');
  const left = Math.max(
    viewport.left + code.clientLeft,
    gutter?.getBoundingClientRect().right ?? viewport.left
  );
  const right = viewport.left + code.clientLeft + code.clientWidth;
  const delta =
    rect.left < left || rect.width > right - left
      ? rect.left - left
      : Math.max(0, rect.right - right);
  code.scrollTo({ left: code.scrollLeft + delta, behavior: 'instant' });
  return true;
}
