import type { VirtualWindowSpecs } from '../types';

interface WindowFromScrollPositionProps {
  scrollY: number;
  height: number;
  scrollHeight: number;
  containerOffset: number;
  fitPerfectly: boolean;
  overscrollMultiplier: number;
}

export function createWindowFromScrollPosition({
  scrollY,
  scrollHeight,
  height,
  containerOffset,
  fitPerfectly,
  overscrollMultiplier,
}: WindowFromScrollPositionProps): VirtualWindowSpecs {
  const windowHeight = height * overscrollMultiplier;
  if (windowHeight > scrollHeight || fitPerfectly) {
    return {
      top: Math.max(scrollY - containerOffset, 0),
      bottom:
        scrollY + (fitPerfectly ? height : windowHeight) - containerOffset,
    };
  }
  const scrollCenter = scrollY + height / 2;
  let top = scrollCenter - windowHeight / 2;
  let bottom = top + windowHeight;
  if (top < 0) {
    top = 0;
    bottom = Math.min(windowHeight, scrollHeight);
  } else if (bottom > scrollHeight) {
    bottom = scrollHeight;
    top = Math.max(bottom - windowHeight, 0);
  }
  top = Math.floor(Math.max(top - containerOffset, 0));
  return {
    top,
    bottom: Math.ceil(
      Math.max(Math.min(bottom, scrollHeight) - containerOffset, top)
    ),
  };
}
