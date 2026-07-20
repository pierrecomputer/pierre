type Callback = (time: number) => unknown;

const callbacks = new Set<Callback>();
let frameId: null | number = null;

// TODO(amadeus): Figure out a proper name for this module...
export function queueRender(callback: Callback): void {
  callbacks.add(callback);
  frameId ??= requestAnimationFrame(render);
}

export function dequeueRender(callback: Callback): void {
  if (callbacks.delete(callback) && callbacks.size === 0 && frameId != null) {
    cancelAnimationFrame(frameId);
    frameId = null;
  }
}

// Drops every queued callback and cancels the pending frame. The guard
// matters in test teardown, where the harness may have already removed the
// requestAnimationFrame globals.
export function clearRenderQueue(): void {
  callbacks.clear();
  if (frameId != null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(frameId);
  }
  frameId = null;
}

function render(time: number): void {
  const toIterate = new Set(callbacks);
  callbacks.clear();
  for (const callback of toIterate) {
    try {
      callback(time);
    } catch (error) {
      console.error(error);
    }
  }
  // If render picked up any new callbacks, lets trigger a new
  // requestAnimationFrame
  if (callbacks.size > 0) {
    frameId = requestAnimationFrame(render);
  } else {
    frameId = null;
  }
}
