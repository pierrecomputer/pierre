type Callback = (time: number) => unknown;

const queuedCallbacks = new Set<Callback>();
let callbacks = new Set<Callback>();
let frameId: null | number = null;
let isRendering = false;

// TODO(amadeus): Figure out a proper name for this module...
export function queueRender(callback: Callback) {
  if (isRendering) {
    queuedCallbacks.add(callback);
    return;
  }
  callbacks.add(callback);
  if (frameId == null) {
    frameId = requestAnimationFrame(render);
  }
}

function render(time: number) {
  isRendering = true;
  for (const callback of callbacks) {
    try {
      callback(time);
    } catch (error) {
      console.error(error);
    }
  }
  callbacks.clear();
  if (queuedCallbacks.size > 0) {
    callbacks = new Set(queuedCallbacks);
    queuedCallbacks.clear();
    frameId = requestAnimationFrame(render);
  } else {
    frameId = null;
  }
  isRendering = false;
}
