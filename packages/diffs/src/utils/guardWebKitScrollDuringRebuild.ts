/**
 * Runs a wholesale code-column rebuild with the pre element's height pinned,
 * working around a WebKit bug (https://bugs.webkit.org/show_bug.cgi?id=308027):
 * when the subtree of a `container-type: inline-size` element is rewritten in
 * bulk (column innerHTML swaps, grid-row span rewrites), WebKit resolves the
 * ancestor scroller's offset against a transiently collapsed interim layout
 * and clamps scrollTop to 0 — the scroller visibly jumps to the top on every
 * edit. Pinning `min-height` keeps that interim layout at full height so the
 * scroll offset survives; the layout read before unpinning is required, since
 * it materializes the interim layout while the pin is active.
 *
 * Both the pin height read and the pinned-layout read force a synchronous
 * layout, so callers own the gating via shouldGuardRebuildScroll: Safari-only,
 * edit-mode-only, and never inside CodeView's batched read/write render pass.
 */
export function guardWebKitScrollDuringRebuild(
  pre: HTMLElement | undefined,
  rebuild: () => void
): void {
  const height = pre?.offsetHeight ?? 0;
  if (pre == null || height === 0) {
    rebuild();
    return;
  }
  pre.style.minHeight = `${height}px`;
  try {
    rebuild();
    void pre.offsetHeight;
  } finally {
    pre.style.minHeight = '';
  }
}
