/** @jsxImportSource preact */
import type { JSX } from 'preact';

const DEFAULT_WIDTH = 16;
const DEFAULT_HEIGHT = 16;

const ICON_SIZE_OVERRIDES: Record<
  string,
  { width: number; height: number; viewBox?: string } | undefined
> = {};

export function Icon({
  name,
  remappedFrom,
  token,
  width: propWidth,
  height: propHeight,
  viewBox: propViewBox,
  label,
  alignCapitals = false,
}: {
  name: string;
  remappedFrom?: string;
  token?: string;
  width?: number;
  height?: number;
  viewBox?: string;
  label?: string;
  alignCapitals?: boolean;
}): JSX.Element {
  'use no memo';
  const href = `#${name.replace(/^#/, '')}`;
  const override = ICON_SIZE_OVERRIDES[name] ?? {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  };
  const {
    width: iconWidth,
    height: iconHeight,
    viewBox: overrideViewBox,
  } = override;
  const width = propWidth ?? iconWidth;
  const height = propHeight ?? iconHeight;
  const viewBox =
    propViewBox ?? overrideViewBox ?? `0 0 ${iconWidth} ${iconHeight}`;

  const a11yProps =
    label != null
      ? { 'aria-label': label, role: 'img' as const }
      : { 'aria-hidden': true };

  return (
    <svg
      data-icon-name={remappedFrom ?? name}
      data-icon-token={token}
      data-align-capitals={alignCapitals}
      {...a11yProps}
      viewBox={viewBox}
      width={width}
      height={height}
    >
      <use href={href} />
    </svg>
  );
}
