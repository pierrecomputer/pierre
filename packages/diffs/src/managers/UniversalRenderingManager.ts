type Callback = (time: number) => unknown;

let callbacks = new Set<Callback>();
let frameId: null | number = null;

// TODO(amadeus): Figure out a proper name for this module...
export function queueRender(callback: Callback): void {
  callbacks.add(callback);
  frameId ??= requestAnimationFrame(render);
}

export function dequeueRender(callback: Callback): void {
  callbacks.delete(callback);
  if (callbacks.size === 0 && frameId != null) {
    cancelAnimationFrame(frameId);
    frameId = null;
  }
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
