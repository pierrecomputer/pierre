// Recognize both the built-in utility button and custom content assigned to the
// gutter utility slot so other pointer handlers leave the gesture untouched.
export function isGutterUtilityPath(
  path: readonly (EventTarget | undefined)[]
): boolean {
  for (const element of path) {
    if (!(element instanceof HTMLElement)) {
      continue;
    }
    if (
      element.hasAttribute('data-utility-button') ||
      element.hasAttribute('data-gutter-utility-slot') ||
      element.getAttribute('slot') === 'gutter-utility-slot' ||
      element.getAttribute('name') === 'gutter-utility-slot'
    ) {
      return true;
    }
  }
  return false;
}
