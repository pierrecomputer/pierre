import type { ContextMenuOpenContext } from '@pierre/trees';
import type { CSSProperties } from 'react';

// Positions the hidden Radix trigger so its bottom-left corner sits on the
// file-tree anchor point. Radix then aligns the menu's top-left corner to that
// trigger point.
export function getFloatingContextMenuTriggerStyle(
  anchorRect: ContextMenuOpenContext['anchorRect']
): CSSProperties {
  return {
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: 'none',
    border: 0,
    padding: 0,
    position: 'fixed',
    left: `${anchorRect.left}px`,
    top: `${anchorRect.bottom - 1}px`,
  };
}

export function getContextMenuSideOffset(
  anchorRect: ContextMenuOpenContext['anchorRect']
): number {
  return anchorRect.width === 0 && anchorRect.height === 0 ? 0 : 4;
}
