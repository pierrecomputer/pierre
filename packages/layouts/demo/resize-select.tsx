import type { JSX } from 'react';

import type { LayoutProps } from '../src/react';

export type ResizeStrategy = NonNullable<LayoutProps['experimentalResize']>;

/** Experimental: how a pointer resize applies its sizes, to compare how each feels. */
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
      {/* Short names keep the select narrow in a header; each title holds
          the description. */}
      <option value="live" title="Resize on each pointer move">
        live
      </option>
      <option value="frame" title="Resize once per frame">
        per frame
      </option>
      <option value="preview" title="Move the separator, resize on release">
        preview
      </option>
      <option value="freeze" title="Freeze the content while the pointer moves">
        freeze
      </option>
      <option
        value="settle"
        title="Freeze the content, then settle one pane per frame"
      >
        settle
      </option>
    </select>
  );
}
