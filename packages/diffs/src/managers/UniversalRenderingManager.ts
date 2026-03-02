type Callback = (time: number) => unknown;

let callbacks = new Set<Callback>();
let frameId: null | number = null;
let isRendering = false;

// TODO(amadeus): Figure out a proper name for this module...
export function queueRender(callback: Callback): void {
  callbacks.add(callback);
  if (!isRendering) {
    frameId ??= requestAnimationFrame(render);
  }
}

export function dequeueRender(callback: Callback): void {
  callbacks.delete(callback);
  if (!isRendering && callbacks.size === 0 && frameId != null) {
    cancelAnimationFrame(frameId);
    frameId = null;
  }
}

function render(time: number): void {
  isRendering = true;
  const toIterate = new Set(callbacks);
  callbacks.clear();
  for (const callback of toIterate) {
    try {
      callback(time);
    } catch (error) {
      console.error(error);
    }
  }
  if (callbacks.size > 0) {
    frameId = requestAnimationFrame(render);
  } else {
    frameId = null;
  }
  isRendering = false;
}
