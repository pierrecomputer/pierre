import { useEffect } from 'react';

// Trees blocks scrolling inside its own pane while a context menu is open (the
// built-in wash captures wheel/touch there), but it cannot reach the scroll
// containers the host page owns. If the window keeps scrolling, a portaled
// menu anchored at a fixed viewport point drifts away from the row it was
// opened for. Hosts that portal context menus should lock window scroll for
// the menu's lifetime; this module is the docs-site implementation of that
// integration.
//
// The lock hides the root scrollbar with `overflow: hidden` on <body> and
// compensates for the removed scrollbar width with `padding-right`, so the
// page content does not shift under the already-positioned menu.

// One lock is shared across all mounted menus (multiple demo trees can briefly
// overlap while one menu closes and another opens), so the body styles are
// only touched by the first acquire and restored by the last release.
let windowScrollLockCount = 0;
let restoreWindowScrollStyles: (() => void) | null = null;

// Framework-agnostic form of the lock: call to lock, invoke the returned
// function to release. This is the shape vanilla-API integrations can copy.
export function lockWindowScroll(): () => void {
  windowScrollLockCount += 1;
  if (windowScrollLockCount === 1) {
    const { body, documentElement } = document;
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${String(scrollbarWidth)}px`;
    }
    restoreWindowScrollStyles = () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    windowScrollLockCount -= 1;
    if (windowScrollLockCount === 0) {
      restoreWindowScrollStyles?.();
      restoreWindowScrollStyles = null;
    }
  };
}

// Locks window scroll for the lifetime of the calling component. Context menu
// components mount exactly while the menu is open, so mounting the menu is the
// lock and unmounting is the release.
export function useWindowScrollLock(): void {
  useEffect(() => lockWindowScroll(), []);
}
