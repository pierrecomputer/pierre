import type { JSX } from 'preact';

import type { SVGSpriteNames } from '../sprite';

const DEFAULT_WIDTH = 16;
const DEFAULT_HEIGHT = 16;

const ICON_SIZE_OVERRIDES: Record<
  string,
  { width: number; height: number } | undefined
> = {
  'file-tree-icon-chevron': {
    width: 10,
    height: 6,
  },
  'file-tree-icon-file': {
    width: 12,
    height: 12,
  },
};

export function Icon({
  name,
  width: propWidth,
  height: propHeight,
  label,
  alignCapitals = false,
}: {
  name: SVGSpriteNames;
  width?: number;
  height?: number;
  label?: string;
  alignCapitals?: boolean;
}): JSX.Element {
  'use no memo';
  const href = `#${name.replace(/^#/, '')}`;
  const { width: iconWidth, height: iconHeight } = ICON_SIZE_OVERRIDES[
    name
  ] ?? {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  };
  const width = propWidth ?? iconWidth;
  const height = propHeight ?? iconHeight;

  const a11yProps =
    label != null
      ? { 'aria-label': label, role: 'img' as const }
      : { 'aria-hidden': true };

  return (
    <svg
      data-icon-name={name}
      data-align-capitals={alignCapitals}
      {...a11yProps}
      viewBox={`0 0 ${iconWidth} ${iconHeight}`}
      width={width}
      height={height}
    >
      <use href={href} />
    </svg>
  );
}
