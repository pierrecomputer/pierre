import type { Rect } from '../types';

/**
 * FLIP animations of the layout's own elements. The view applies a change in
 * one step, then animates each element from its old box with a transform, so
 * that the compositor runs the animation and content lays out once. These
 * functions read and animate the DOM directly: the reads must happen before
 * the view applies the change, and the animations after it, in the same frame.
 */

// Elements that animate a layout change carry this attribute with a stable key.
export const FLIP_ATTRIBUTE = 'data-layout-flip';
// A hidden pane does not render, so it neither gives nor takes a FLIP box.
const FLIP_SELECTOR = `[${FLIP_ATTRIBUTE}]:not([data-collapsed='true'])`;
const DEFAULT_DURATION_MS = 240;
// The ID of the layout's own animations, so that it never touches animations in pane content.
const FLIP_ANIMATION_ID = 'pierre-layout-flip';
// An ease-out curve, written as cubic-bezier: Safari runs `linear()` easing on the main thread.
const FLIP_EASING = 'cubic-bezier(0.2, 0, 0, 1)';
// Keyframes of the inverse scale of a pane's content. The inverse of a linear
// scale is not linear, so it is sampled: 16 steps keep the content within a
// fraction of a pixel of its own size.
const COUNTER_SCALE_STEPS = 16;

/** The layout's running FLIP animations; animations in pane content are not included. */
export function flipAnimations(root: HTMLElement): Animation[] {
  return root
    .getAnimations({ subtree: true })
    .filter((animation) => animation.id === FLIP_ANIMATION_ID);
}

/** Stop the running animations, so that a new animation starts from the current boxes. */
export function cancelFlipAnimations(root: HTMLElement): void {
  for (const animation of flipAnimations(root)) animation.cancel();
}

/** Jump the running animations to their end, for example when the container resizes. */
export function finishFlipAnimations(root: HTMLElement): void {
  for (const animation of flipAnimations(root)) animation.finish();
}

/** Read the box of each animatable element, relative to the layout root, including running animations. */
export function readBoxes(root: HTMLElement): Map<string, Rect> {
  const bounds = root.getBoundingClientRect();
  const boxes = new Map<string, Rect>();
  for (const element of root.querySelectorAll<HTMLElement>(FLIP_SELECTOR)) {
    const key = element.getAttribute(FLIP_ATTRIBUTE) ?? '';
    // The focus indicator shares the key of its pane and comes after it. Keep
    // the box of the pane, so that both elements animate from it.
    if (boxes.has(key)) continue;
    const box = element.getBoundingClientRect();
    boxes.set(key, {
      x: box.left - bounds.left,
      y: box.top - bounds.top,
      width: box.width,
      height: box.height,
    });
  }
  return boxes;
}

function durationOf(root: HTMLElement): number {
  const value = getComputedStyle(root).getPropertyValue('--layout-duration');
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return DEFAULT_DURATION_MS;
  return value.trim().endsWith('ms') ? parsed : parsed * 1000;
}

/**
 * FLIP: each element already has its final geometry. Animate it from its old box
 * with a transform only. `transform-origin` is `0 0` on these elements. With
 * `counterScale`, the inner wrapper of a pane host gets the inverse of the
 * host's scale on each frame, so its header and content keep their shape and
 * the frame reveals or clips them, instead of stretching them.
 */
export function animateFromBoxes(
  root: HTMLElement,
  before: ReadonlyMap<string, Rect>,
  counterScale: boolean
): void {
  const duration = durationOf(root);
  const bounds = root.getBoundingClientRect();
  // Read every box before the first animation starts: a new animation dirties
  // style, and a read after it would force another layout.
  const plans: { element: HTMLElement; start: DOMMatrix; end: DOMMatrix }[] =
    [];
  for (const element of root.querySelectorAll<HTMLElement>(FLIP_SELECTOR)) {
    const from = before.get(element.getAttribute(FLIP_ATTRIBUTE) ?? '');
    // A new element has no old box. It appears in place.
    if (from === undefined) continue;
    const box = element.getBoundingClientRect();
    const to = {
      x: box.left - bounds.left,
      y: box.top - bounds.top,
      width: box.width,
      height: box.height,
    };
    if (
      Math.abs(from.x - to.x) < 0.5 &&
      Math.abs(from.y - to.y) < 0.5 &&
      Math.abs(from.width - to.width) < 0.5 &&
      Math.abs(from.height - to.height) < 0.5
    )
      continue;
    if (to.width === 0 || to.height === 0) continue;
    // The element's own transform, for example the translate of a covered pane,
    // is the end of the animation. Its layout box is the box without it.
    const own = getComputedStyle(element).transform;
    const end = own === 'none' ? new DOMMatrix() : new DOMMatrix(own);
    const start = new DOMMatrix([
      from.width / to.width,
      0,
      0,
      from.height / to.height,
      from.x - (to.x - end.e),
      from.y - (to.y - end.f),
    ]);
    plans.push({ element, start, end });
  }
  const timing: KeyframeAnimationOptions = {
    duration,
    easing: FLIP_EASING,
    id: FLIP_ANIMATION_ID,
  };
  for (const { element, start, end } of plans) {
    element.animate(
      [{ transform: start.toString() }, { transform: end.toString() }],
      timing
    );
    const inner = counterScale
      ? element.querySelector<HTMLElement>(':scope > .pierre-layout-pane-inner')
      : null;
    if (inner === null || (start.a === end.a && start.d === end.d)) continue;
    // Both animations share the timing, so at each eased progress the host's
    // scale is the linear mix of its keyframes, and the inner scale undoes it.
    const frames: Keyframe[] = [];
    for (let step = 0; step <= COUNTER_SCALE_STEPS; step++) {
      const progress = step / COUNTER_SCALE_STEPS;
      const x = start.a + (end.a - start.a) * progress;
      const y = start.d + (end.d - start.d) * progress;
      frames.push({
        offset: progress,
        transform: `scale(${end.a / x}, ${end.d / y})`,
      });
    }
    inner.animate(frames, timing);
  }
}
