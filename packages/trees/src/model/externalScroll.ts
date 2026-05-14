import type {
  FileTreeExternalScrollOrigin,
  FileTreeExternalScrollSnapshot,
} from '../scroll/publicTypes';

export interface FileTreeNormalizedExternalScrollSnapshot {
  bottomInset: number;
  effectiveViewportHeight: number;
  isScrolling: boolean;
  scrollOrigin: FileTreeExternalScrollOrigin;
  topInset: number;
  viewportHeight: number;
  viewportTop: number;
}

export interface FileTreeExternalScrollInitialSnapshotInput {
  initialSnapshot?: FileTreeExternalScrollSnapshot;
  initialVisibleRowCount?: number;
  itemHeight: number;
}

const VALID_EXTERNAL_SCROLL_ORIGINS = new Set<FileTreeExternalScrollOrigin>([
  'programmatic',
  'unknown',
  'user',
]);

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nonNegativeFiniteOr(
  value: number | undefined,
  fallback: number
): number {
  return Math.max(0, finiteOr(value, fallback));
}

function normalizeScrollOrigin(
  origin: FileTreeExternalScrollSnapshot['scrollOrigin']
): FileTreeExternalScrollOrigin {
  return origin != null && VALID_EXTERNAL_SCROLL_ORIGINS.has(origin)
    ? origin
    : 'unknown';
}

// Normalizes caller-provided viewport metrics before layout code consumes them.
// External scroll sources are a system boundary, so bad geometry degrades to a
// zero-sized viewport instead of leaking NaN through virtualization math.
export function normalizeFileTreeExternalScrollSnapshot(
  snapshot: FileTreeExternalScrollSnapshot | undefined,
  fallbackViewportHeight: number = 0
): FileTreeNormalizedExternalScrollSnapshot {
  const viewportTop = finiteOr(snapshot?.viewportTop, 0);
  const viewportHeight = nonNegativeFiniteOr(
    snapshot?.viewportHeight,
    fallbackViewportHeight
  );
  const topInset = nonNegativeFiniteOr(snapshot?.topInset, 0);
  const bottomInset = nonNegativeFiniteOr(snapshot?.bottomInset, 0);
  const effectiveViewportHeight = Math.max(
    0,
    viewportHeight - topInset - bottomInset
  );

  return {
    bottomInset,
    effectiveViewportHeight,
    isScrolling: snapshot?.isScrolling === true,
    scrollOrigin: normalizeScrollOrigin(snapshot?.scrollOrigin),
    topInset,
    viewportHeight,
    viewportTop,
  };
}

export function getFileTreeExternalScrollFallbackViewportHeight({
  initialVisibleRowCount,
  itemHeight,
}: Pick<
  FileTreeExternalScrollInitialSnapshotInput,
  'initialVisibleRowCount' | 'itemHeight'
>): number {
  return initialVisibleRowCount == null
    ? 0
    : Math.max(0, initialVisibleRowCount) * itemHeight;
}

export function resolveFileTreeExternalScrollInitialSnapshot({
  initialSnapshot,
  initialVisibleRowCount,
  itemHeight,
}: FileTreeExternalScrollInitialSnapshotInput): FileTreeNormalizedExternalScrollSnapshot {
  const fallbackViewportHeight =
    getFileTreeExternalScrollFallbackViewportHeight({
      initialVisibleRowCount,
      itemHeight,
    });
  return normalizeFileTreeExternalScrollSnapshot(
    initialSnapshot,
    fallbackViewportHeight
  );
}
