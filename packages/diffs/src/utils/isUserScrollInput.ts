// Keys that scroll a focused scroll container natively.
const SCROLL_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
]);

// Whether an input event means the user is taking over scrolling, so a
// pending programmatic scroll should be cancelled. Other keys, such as a held
// Cmd+V, must not cancel the reveal their own edits requested.
export function isUserScrollInput(event: Event): boolean {
  if (event.defaultPrevented) {
    return false;
  }
  if (event.type !== 'keydown') {
    return true;
  }
  return (
    'key' in event &&
    typeof event.key === 'string' &&
    SCROLL_KEYS.has(event.key)
  );
}
