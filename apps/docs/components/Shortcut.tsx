'use client';

import { useEffect, useState } from 'react';

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

/**
 * Renders a keyboard shortcut as a sequence of individual `<kbd>` keys whose
 * platform modifier adapts to the user's OS: `Cmd` on macOS/iOS and `Ctrl`
 * everywhere else. Extra modifiers (e.g. Shift) come from the `modifiers` prop
 * and the main key(s) from children, so `<Shortcut modifiers={['Shift']}>Z</Shortcut>`
 * renders Cmd Shift Z (or Ctrl Shift Z).
 *
 * Platform can only be known on the client, so we render `Cmd` during SSR and
 * the first client render (keeping hydration stable), then correct to `Ctrl`
 * after mount on non-Mac devices.
 */
export function Shortcut({
  children,
  modifiers,
  meta = true,
  className,
}: ShortcutProps) {
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    setIsMac(detectIsMac());
  }, []);

  const modifierKeys: string[] = [];
  if (meta) {
    modifierKeys.push(isMac ? 'Cmd' : 'Ctrl');
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
