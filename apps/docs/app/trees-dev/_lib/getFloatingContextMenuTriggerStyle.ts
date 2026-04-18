import type { ContextMenuOpenContext } from '@pierre/trees';
import type { CSSProperties } from 'react';

// Positions the hidden Radix trigger at the file-tree anchor point so the
// portaled dropdown can align to the same center/bottom point for both trigger
// clicks and right-click-opened menus.
export function getFloatingContextMenuTriggerStyle(
  anchorRect: ContextMenuOpenContext['anchorRect']
): CSSProperties {
  const anchorCenterX = anchorRect.left + anchorRect.width / 2;
  return {
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: 'none',
    border: 0,
    padding: 0,
    position: 'fixed',
    left: `${anchorCenterX}px`,
    top: `${anchorRect.bottom - 1}px`,
    transform: 'translateX(-50%)',
  };
}
