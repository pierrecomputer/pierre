// The still press that starts a touch drag of a tab, as a wait of the drag
// engine. Only `tabDrag()` imports it, so a pane drag does not load it.
import type { PointerEvent } from 'react';

import type { DragWait } from './drag';

// A touch press that waits for its drag stays still within this distance.
const TOLERANCE_PX = 5;

const preventDefault = (event: Event): void => event.preventDefault();

/**
 * A wait for a touch press: the drag starts after a still press of `delay`
 * milliseconds, and a move of more than 5 pixels before it gives the press to
 * the browser, so a swipe scrolls. The press blocks the context menu, and the
 * drag blocks the pan of the page. A mouse or a pen does not wait.
 */
export function touchHold(
  delay: number
): (
  press: PointerEvent<HTMLElement>,
  begin: () => void
) => DragWait | undefined {
  return (press, begin) => {
    if (press.pointerType !== 'touch') return undefined;
    let state: 'waiting' | 'dragging' | 'released' = 'waiting';
    window.addEventListener('contextmenu', preventDefault);
    const timer = setTimeout(() => {
      state = 'dragging';
      window.addEventListener('touchmove', preventDefault, { passive: false });
      begin();
    }, delay);
    return {
      move(distance) {
        if (state === 'waiting' && distance > TOLERANCE_PX) {
          state = 'released';
          clearTimeout(timer);
        }
        return state === 'dragging';
      },
      end() {
        clearTimeout(timer);
        window.removeEventListener('contextmenu', preventDefault);
        window.removeEventListener('touchmove', preventDefault);
      },
    };
  };
}
