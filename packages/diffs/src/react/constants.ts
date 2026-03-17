import type { CSSProperties } from 'react';

export const GutterUtilitySlotStyles: CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  textAlign: 'center',
};

export const MergeConflictSlotStyles: CSSProperties = {
  display: 'contents',
};

export function noopRender() {
  return null;
}
