// The properties that a gesture needs on the layout's own controls. The view
// sets them inline, so that an app's CSS outside a layer, such as
// `button { cursor: pointer; }`, cannot change them. The look of the controls
// stays in the sheets, inside `@layer pierre-layouts`.
import type { CSSProperties } from 'react';

import type { Direction } from '../types';

const ROW_SEPARATOR: CSSProperties = {
  cursor: 'col-resize',
  touchAction: 'none',
};
const COLUMN_SEPARATOR: CSSProperties = {
  cursor: 'row-resize',
  touchAction: 'none',
};

/** A separator of a row resizes columns, and one of a column resizes rows. */
export const separatorGestureStyle = (direction: Direction): CSSProperties =>
  direction === 'horizontal' ? ROW_SEPARATOR : COLUMN_SEPARATOR;

export const CORNER_GESTURE_STYLE: CSSProperties = {
  cursor: 'move',
  touchAction: 'none',
};

/** A move handle: a grab cursor, and no browser panning of the drag. */
export const GRIP_STYLE: CSSProperties = {
  cursor: 'grab',
  touchAction: 'none',
};

/** A move handle while a pane is zoomed: it does not start a drag. */
export const DISABLED_GRIP_STYLE: CSSProperties = {
  cursor: 'default',
  touchAction: 'none',
};
