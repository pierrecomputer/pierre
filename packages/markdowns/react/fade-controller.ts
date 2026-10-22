type Settle = (now: number, stopped: boolean) => number | undefined;

/** Share expiry and selection listeners across recent fades in one Markdown root. */
export function createFadeController() {
  const pending = new Map<Settle, number>();
  const deadlines = new WeakMap<object, number>();
  const motionListeners = new Set<() => void>();
  let root: HTMLElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timerAt = Infinity;
  let active: boolean | undefined;
  const initialWindow = typeof window === 'undefined' ? undefined : window;
  const initialQuery = initialWindow?.matchMedia?.(
    '(prefers-reduced-motion: reduce)'
  );
  let reducedMotion = initialQuery?.matches ?? false;

  // Registration is constant-time; find the next deadline only at timer boundaries.
  const arm = (knownNext?: number): void => {
    if (root === undefined) return;
    let next = knownNext ?? Infinity;
    if (knownNext === undefined)
      for (const at of pending.values()) next = Math.min(next, at);
    if (timer !== undefined && next >= timerAt) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    timerAt = next;
    if (!Number.isFinite(next)) return;
    timer = setTimeout(flush, Math.max(0, next - performance.now()));
  };
  // Selected runs sleep until selection changes, without polling expired deadlines.
  const flush = (): void => {
    timer = undefined;
    timerAt = Infinity;
    const now = performance.now();
    for (const [settle, at] of pending) {
      if (at > now) continue;
      pending.delete(settle);
      const next = settle(now, active === false);
      if (next !== undefined) pending.set(settle, next);
    }
    arm();
  };
  const selectionChanged = (): void => {
    for (const settle of pending.keys()) pending.set(settle, 0);
    if (pending.size > 0) arm(0);
  };

  return {
    attach(element: HTMLElement): () => void {
      root = element;
      const document = element.ownerDocument;
      const query =
        document.defaultView === initialWindow
          ? initialQuery
          : document.defaultView?.matchMedia?.(
              '(prefers-reduced-motion: reduce)'
            );
      const motionChanged = (): void => {
        reducedMotion = query?.matches ?? false;
        for (const listener of motionListeners) listener();
      };
      motionChanged();
      query?.addEventListener('change', motionChanged);
      document.addEventListener('selectionchange', selectionChanged);
      arm();
      return () => {
        root = undefined;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        timerAt = Infinity;
        query?.removeEventListener('change', motionChanged);
        document.removeEventListener('selectionchange', selectionChanged);
      };
    },
    subscribeMotion(listener: () => void): () => void {
      motionListeners.add(listener);
      return () => motionListeners.delete(listener);
    },
    getReducedMotion: (): boolean => reducedMotion,
    /** Stop only recent fades; settled blocks do not subscribe to lifecycle changes. */
    setActive(value: boolean): void {
      if (active === value) return;
      active = value;
      if (value) return;
      const now = performance.now();
      // Callbacks may remain registered while selection protects their text nodes.
      for (const settle of Array.from(pending.keys())) {
        pending.delete(settle);
        const next = settle(now, true);
        if (next !== undefined) pending.set(settle, next);
      }
      arm();
    },
    deadline(run: object, duration: number): number {
      let at = deadlines.get(run);
      if (at === undefined) {
        at = performance.now() + duration;
        deadlines.set(run, at);
      }
      return at;
    },
    schedule(at: number, settle: Settle): () => void {
      // A child effect may register after the root has already committed a pause.
      // Decide cancellation when it runs, after any resume in the same commit.
      const next = active === false ? 0 : at;
      pending.set(settle, next);
      arm(next);
      return () => {
        pending.delete(settle);
      };
    },
    hasSelection(node: Node): boolean {
      const selection = node.ownerDocument?.getSelection();
      if (
        selection === null ||
        selection === undefined ||
        selection.isCollapsed
      )
        return false;
      for (let i = 0; i < selection.rangeCount; i++)
        if (selection.getRangeAt(i).intersectsNode(node)) return true;
      return false;
    },
  };
}

export type FadeController = ReturnType<typeof createFadeController>;

/** Hydration starts with the same animation markup as server rendering. */
export const serverReducedMotion = (): boolean => false;
