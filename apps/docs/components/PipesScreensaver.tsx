'use client';

import { prefersReducedMotion } from '@pierre/diffs';
import { createPipes, type PipesInstance } from '@pierre/pipes';

// 60 Seconds
const IDLE_TIMEOUT_MS = 60 * 1000;

// Own the timer and WebGL resources together so hidden tabs never keep either running.
function attachScreensaver(canvas: HTMLCanvasElement) {
  let timer: number | undefined;
  let pipes: PipesInstance | undefined;

  function dismiss() {
    window.clearTimeout(timer);
    timer = undefined;
    pipes?.destroy();
    pipes = undefined;
    canvas.hidden = true;
  }

  function restartTimer() {
    dismiss();
    if (document.visibilityState !== 'visible') return;
    timer = window.setTimeout(() => {
      timer = undefined;
      if (document.visibilityState !== 'visible') return;
      canvas.hidden = false;
      try {
        pipes = createPipes(canvas, {
          pixelSize: 3,
          backgroundColor: 'transparent',
          cameraDrift: !prefersReducedMotion(),
        });
      } catch {
        // Leave the docs usable when WebGL2 is unavailable.
        canvas.hidden = true;
      }
    }, IDLE_TIMEOUT_MS);
  }

  const activityEvents = [
    'pointermove',
    'pointerdown',
    'keydown',
    'wheel',
    'scroll',
  ] as const;
  // Capture includes activity inside nested scrollers and controls that stop propagation.
  for (const event of activityEvents) {
    document.addEventListener(event, restartTimer, {
      capture: true,
      passive: true,
    });
  }
  document.addEventListener('visibilitychange', restartTimer);
  restartTimer();

  return () => {
    for (const event of activityEvents) {
      document.removeEventListener(event, restartTimer, true);
    }
    document.removeEventListener('visibilitychange', restartTimer);
    dismiss();
  };
}

export function PipesScreensaver() {
  return (
    <canvas
      ref={attachScreensaver}
      hidden
      aria-hidden="true"
      data-pipes-screensaver
      className="pipes-screensaver fixed inset-0 z-[2147483647] h-full w-full cursor-none bg-black/85"
    />
  );
}
