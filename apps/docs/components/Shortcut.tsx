'use client';

import { Fragment, useEffect, useState } from 'react';

interface ShortcutProps {
  /** The non-modifier key(s), e.g. `A` for Cmd/Ctrl + A. */
  children: React.ReactNode;
  /**
   * Extra modifier keys rendered (in order) between the platform modifier and
   * the main key. e.g. `modifiers={['Shift']}` → Cmd Shift Z / Ctrl Shift Z.
   */
  modifiers?: readonly string[];
  /**
   * Whether to render the platform modifier (Cmd on macOS/iOS, Ctrl elsewhere)
   * as the leading key. Defaults to `true`. Set `false` for shortcuts with no
   * Cmd/Ctrl, e.g. `<Shortcut meta={false} modifiers={['Shift']}>Tab</Shortcut>`.
   */
  meta?: boolean;
  className?: string;
}

// True when the current device uses the Cmd key (macOS / iOS) rather than Ctrl.
// `navigator.platform` is deprecated but still the most reliable signal across
// browsers, and matches the detection already used by the LiveEditor demo.
function detectIsMac(): boolean {
  return /Mac|iP(?:hone|ad|od)/i.test(navigator.platform);
}

// Resolves the platform modifier label. Platform is only knowable on the
// client, so this returns `Cmd` during SSR and the first client render (keeping
// hydration stable), then corrects to `Ctrl` after mount on non-Mac devices.
function usePlatformModifier(): string {
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    setIsMac(detectIsMac());
  }, []);

  return isMac ? 'Cmd' : 'Ctrl';
}

/**
 * Renders a keyboard shortcut as a sequence of individual `<kbd>` keys whose
 * platform modifier adapts to the user's OS: `Cmd` on macOS/iOS and `Ctrl`
 * everywhere else. Extra modifiers (e.g. Shift) come from the `modifiers` prop
 * and the main key(s) from children, so `<Shortcut modifiers={['Shift']}>Z</Shortcut>`
 * renders Cmd Shift Z (or Ctrl Shift Z).
 */
export function Shortcut({
  children,
  modifiers,
  meta = true,
  className,
}: ShortcutProps) {
  const platformModifier = usePlatformModifier();

  const modifierKeys: string[] = [];
  if (meta) {
    modifierKeys.push(platformModifier);
  }
  if (modifiers != null) {
    modifierKeys.push(...modifiers);
  }

  return (
    <span className="inline-flex items-center gap-1">
      {modifierKeys.map((key, index) => (
        <kbd key={`${key}-${index}`} className={className}>
          {key}
        </kbd>
      ))}
      <kbd className={className}>{children}</kbd>
    </span>
  );
}

interface ShortcutKeysProps {
  /** Interchangeable main keys, joined by `/` (e.g. `['Home', 'End']` → Home / End). */
  keys: readonly string[];
  /** Held modifiers rendered ahead of `keys` with no `/` (e.g. `['Shift']`). */
  modifiers?: readonly string[];
  /** Prepend the platform modifier (Cmd on macOS/iOS, Ctrl elsewhere). */
  mod?: boolean;
  className?: string;
}

/**
 * Renders a shortcut from plain string arrays so a serializable data model (the
 * one a shortcuts table maps over) can drive rendering without inlining JSX per
 * row. Held modifiers render as adjacent `<kbd>`s; the interchangeable `keys`
 * are joined by `/` so `mod + ['Home', 'End']` reads as "Cmd Home / End" rather
 * than an ambiguous "Cmd Home End" chord.
 */
export function ShortcutKeys({
  keys,
  modifiers,
  mod = false,
  className,
}: ShortcutKeysProps) {
  const platformModifier = usePlatformModifier();

  const heldKeys: string[] = [];
  if (mod) {
    heldKeys.push(platformModifier);
  }
  if (modifiers != null) {
    heldKeys.push(...modifiers);
  }

  return (
    <span className="inline-flex items-center gap-1">
      {heldKeys.map((key, index) => (
        <kbd key={`held-${key}-${index}`} className={className}>
          {key}
        </kbd>
      ))}
      {keys.map((key, index) => (
        <Fragment key={`key-${key}-${index}`}>
          {index > 0 ? (
            <span className="text-muted-foreground" aria-hidden>
              /
            </span>
          ) : null}
          <kbd className={className}>{key}</kbd>
        </Fragment>
      ))}
    </span>
  );
}
