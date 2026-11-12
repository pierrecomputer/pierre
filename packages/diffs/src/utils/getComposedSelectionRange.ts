// Whether Selection.getComposedRanges takes an options object. Older Safari
// only takes the shadow roots as separate arguments and throws on the object.
// Undefined until the first selection read finds out.
let composedRangesTakeOptions: boolean | undefined;

// The selection's first range as seen through the shadow root, read with
// whichever getComposedRanges signature this browser supports. The signature
// is checked on the first read and remembered, so older Safari throws once
// instead of on every read.
function getComposedRange(
  selection: Selection,
  shadowRoot: ShadowRoot
): StaticRange | undefined {
  if (composedRangesTakeOptions == null) {
    try {
      selection.getComposedRanges({ shadowRoots: [shadowRoot] });
      composedRangesTakeOptions = true;
    } catch {
      composedRangesTakeOptions = false;
    }
  }
  if (composedRangesTakeOptions) {
    return selection.getComposedRanges({ shadowRoots: [shadowRoot] })?.[0];
  }
  // @ts-expect-error The DOM types only describe the options signature.
  return selection.getComposedRanges(shadowRoot)?.[0];
}

// ShadowRoot.getSelection is a non-standard Blink/WebKit method (predates the
// spec'd Selection.getComposedRanges) and is missing from the DOM lib types.
type ShadowRootWithSelection = ShadowRoot & {
  getSelection?: () => Selection | null;
};

// Fallback for browsers without Selection.getComposedRanges: read the first
// range from the shadow root's own selection, so a caret placed by a click
// inside the shadow tree can still be read. Normalized to a StaticRange so it
// matches the getComposedRanges return shape the callers expect. Returns
// undefined when the API or a live range is unavailable.
function getShadowRootRange(shadowRoot: ShadowRoot): StaticRange | undefined {
  const selection = (shadowRoot as ShadowRootWithSelection).getSelection?.();
  if (selection == null || selection.rangeCount === 0) {
    return undefined;
  }
  const range = selection.getRangeAt(0);
  return {
    collapsed: range.collapsed,
    startContainer: range.startContainer,
    startOffset: range.startOffset,
    endContainer: range.endContainer,
    endOffset: range.endOffset,
  };
}

// The native selection's first range as seen through a shadow root.
// Selection.getComposedRanges is the standard way to read it; where it is
// missing (older browsers, embedded WebViews, the pinned CI Chromium) the
// older ShadowRoot.getSelection still reports the range inside the shadow
// tree. Undefined when neither has a range.
export function getComposedSelectionRange(
  shadowRoot: ShadowRoot
): StaticRange | undefined {
  const selection = document.getSelection();
  if (selection == null) {
    return undefined;
  }
  return typeof selection.getComposedRanges === 'function'
    ? getComposedRange(selection, shadowRoot)
    : getShadowRootRange(shadowRoot);
}
