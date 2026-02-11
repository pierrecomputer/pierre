import type { VirtualWindowSpecs } from '../types';

interface WindowFromScrollPositionProps {
  scrollTop: number;
  height: number;
  scrollHeight: number;
  containerOffset?: number;
  fitPerfectly: boolean;
  overscrollSize: number;
}

export function createWindowFromScrollPosition({
  scrollTop,
  scrollHeight,
  height,
  containerOffset = 0,
  fitPerfectly,
  overscrollSize,
}: WindowFromScrollPositionProps): VirtualWindowSpecs {
  const windowHeight = height + overscrollSize * 2;
  const effectiveHeight = fitPerfectly ? height : windowHeight;
  scrollHeight = Math.max(scrollHeight, effectiveHeight);

  if (windowHeight >= scrollHeight || fitPerfectly) {
    const top = Math.max(scrollTop - containerOffset, 0);
    const bottom =
      Math.min(scrollTop + effectiveHeight, scrollHeight) - containerOffset;
    return {
      top,
      bottom: Math.max(bottom, top),
    };
  }

  const scrollCenter = scrollTop + height / 2;
  let top = scrollCenter - windowHeight / 2;
  let bottom = top + windowHeight;
  if (top < 0) {
    top = 0;
  }
  if (bottom > scrollHeight) {
    bottom = scrollHeight;
  }
  top = Math.floor(Math.max(top - containerOffset, 0));
  return {
    top,
    bottom: Math.ceil(
      Math.max(Math.min(bottom, scrollHeight) - containerOffset, top)
    ),
  };
}
