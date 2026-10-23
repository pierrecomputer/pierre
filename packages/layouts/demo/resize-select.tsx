import type { JSX } from 'react';

import type { LayoutProps } from '../src/react';

export type ResizeStrategy = NonNullable<LayoutProps['experimentalResize']>;

/** Experimental: how a pointer resize applies its ratios, to compare how each feels. */
export function ResizeSelect({
  value,
  onChange,
}: {
  value: ResizeStrategy;
  onChange: (value: ResizeStrategy) => void;
}): JSX.Element {
  return (
    <select
      aria-label="Resize strategy"
      value={value}
      onChange={(event) => onChange(event.target.value as ResizeStrategy)}
    >
      <option value="live">live</option>
      <option value="frame">once per frame</option>
      <option value="preview">preview, resize on release</option>
      <option value="freeze">freeze content</option>
      <option value="settle">freeze, settle one pane per frame</option>
    </select>
  );
}
