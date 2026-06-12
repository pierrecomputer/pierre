// Shared styling for ghost icon buttons that sit directly on the themed Shiki
// chrome (the header action row and the sidebar's tools). They suppress the
// default ghost hover background and the focus-visible ring/border so the
// buttons stay flush with the chrome surface, signalling both hover and
// keyboard focus with a foreground-color shift instead of a filled background.
export const CHROME_ICON_BUTTON_CLASS =
  'hover:bg-transparent hover:text-muted-foreground focus-visible:border-transparent focus-visible:text-muted-foreground focus-visible:ring-0';
