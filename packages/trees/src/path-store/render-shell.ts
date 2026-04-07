import { PathStoreTreesController } from './controller';
import type {
  PathStoreTreesBootstrapItem,
  PathStoreTreesBootstrapSnapshot,
  PathStoreTreesShellTarget,
} from './types';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatFirstItem(item: PathStoreTreesBootstrapItem | null): string {
  if (item == null) {
    return '<em data-path-store-shell-empty="true">none</em>';
  }

  return `<code data-path-store-shell-first-path="true">${escapeHtml(item.path)}</code>`;
}

/**
 * Turns the bootstrap snapshot into minimal HTML without committing us to the
 * final row/component contract that later phases will design.
 */
export function renderPathStoreTreesBootstrapShell(
  snapshot: PathStoreTreesBootstrapSnapshot
): string {
  return `<section data-path-store-trees-bootstrap="true" data-controller-id="${escapeHtml(snapshot.controllerId)}" data-public-identity="${snapshot.publicIdentity}">
  <h2>Path-store lane bootstrap shell</h2>
  <p>This is a provisional no-op shell for Phase 0.</p>
  <dl>
    <div>
      <dt>Phase</dt>
      <dd>${snapshot.phase}</dd>
    </div>
    <div>
      <dt>Visible rows</dt>
      <dd data-path-store-shell-visible-count="true">${String(snapshot.visibleCount)}</dd>
    </div>
    <div>
      <dt>First visible path</dt>
      <dd>${formatFirstItem(snapshot.firstVisibleItem)}</dd>
    </div>
  </dl>
</section>`;
}

/**
 * Mounts the bootstrap shell against a controller subscription so Phase 0 can
 * prove the controller/renderer boundary without claiming a real tree renderer.
 */
export function mountPathStoreTreesBootstrapShell(
  container: PathStoreTreesShellTarget,
  controller: PathStoreTreesController
): () => void {
  const unsubscribe = controller.subscribe((snapshot) => {
    container.innerHTML = renderPathStoreTreesBootstrapShell(snapshot);
  });

  return () => {
    unsubscribe();
    container.innerHTML = '';
  };
}
