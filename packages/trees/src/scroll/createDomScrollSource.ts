import type {
  FileTreeExternalScrollOrigin,
  FileTreeExternalScrollRequestContext,
  FileTreeExternalScrollSnapshot,
  FileTreeExternalScrollSource,
} from './publicTypes';

export interface CreateDomScrollSourceOptions {
  bottomInset?: number | (() => number);
  host?: HTMLElement | null;
  scrollContainer: HTMLElement;
  topInset?: number | (() => number);
}

export interface FileTreeDomScrollSource extends FileTreeExternalScrollSource {
  destroy(): void;
  setHost(host: HTMLElement | null): void;
  updateSnapshot(scrollOrigin?: FileTreeExternalScrollOrigin): void;
}

function resolveInset(value: number | (() => number) | undefined): number {
  const nextValue = typeof value === 'function' ? value() : value;
  return typeof nextValue === 'number' && Number.isFinite(nextValue)
    ? Math.max(0, nextValue)
    : 0;
}

export function createDomScrollSource({
  bottomInset,
  host: initialHost,
  scrollContainer,
  topInset,
}: CreateDomScrollSourceOptions): FileTreeDomScrollSource {
  const listeners = new Set<() => void>();
  let host = initialHost ?? null;
  let snapshot: FileTreeExternalScrollSnapshot = {
    bottomInset: resolveInset(bottomInset),
    topInset: resolveInset(topInset),
    viewportHeight: Math.max(0, scrollContainer.clientHeight),
    viewportTop: 0,
  };

  const resizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          syncSnapshot('unknown');
        });

  // Measure from the scrollport edge rather than the border box so bordered
  // scrollers report the same viewport origin the user actually sees.
  function readViewportTop(): number {
    if (host == null) {
      return snapshot.viewportTop;
    }

    return (
      scrollContainer.getBoundingClientRect().top +
      scrollContainer.clientTop -
      host.getBoundingClientRect().top
    );
  }

  function syncSnapshot(
    scrollOrigin: FileTreeExternalScrollOrigin = 'unknown',
    notify: boolean = true
  ): void {
    snapshot = {
      bottomInset: resolveInset(bottomInset),
      isScrolling: false,
      scrollOrigin,
      topInset: resolveInset(topInset),
      viewportHeight: Math.max(0, scrollContainer.clientHeight),
      viewportTop: readViewportTop(),
    };
    if (!notify) {
      return;
    }
    for (const listener of listeners) {
      listener();
    }
  }

  function observeHost(nextHost: HTMLElement | null): void {
    if (resizeObserver != null && host != null) {
      resizeObserver.unobserve(host);
    }
    host = nextHost;
    if (resizeObserver != null && host != null) {
      resizeObserver.observe(host);
    }
  }

  const handleScroll = (): void => {
    syncSnapshot('user');
  };

  scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
  resizeObserver?.observe(scrollContainer);
  observeHost(host);
  syncSnapshot('unknown', false);

  return {
    destroy(): void {
      scrollContainer.removeEventListener('scroll', handleScroll);
      if (resizeObserver != null) {
        if (host != null) {
          resizeObserver.unobserve(host);
        }
        resizeObserver.disconnect();
      }
      listeners.clear();
    },
    getSnapshot(): FileTreeExternalScrollSnapshot {
      return snapshot;
    },
    scrollToViewportTop(
      viewportTop: number,
      _context: FileTreeExternalScrollRequestContext
    ): void {
      const currentViewportTop = readViewportTop();
      scrollContainer.scrollTop += viewportTop - currentViewportTop;
      syncSnapshot('programmatic', false);
    },
    setHost(nextHost: HTMLElement | null): void {
      observeHost(nextHost);
      syncSnapshot('unknown');
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    updateSnapshot(
      scrollOrigin: FileTreeExternalScrollOrigin = 'unknown'
    ): void {
      syncSnapshot(scrollOrigin);
    },
  };
}
