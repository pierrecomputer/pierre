import type { FileTree } from '@pierre/trees';

export function cleanupFileTreeInstance(
  container: HTMLElement,
  instanceRef: { current: FileTree | null }
): void {
  if (instanceRef.current == null) return;
  instanceRef.current.cleanUp();
  const shadowRoot = container.shadowRoot;
  if (shadowRoot !== null) {
    const treeElement = Array.from(shadowRoot.children).find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.dataset?.fileTreeId != null
    );
    treeElement?.replaceChildren();
  }
}
