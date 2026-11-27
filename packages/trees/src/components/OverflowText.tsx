/** @jsxImportSource preact */

import type { ComponentChildren, CSSProperties, JSX } from 'preact';

type PropsWithChildren<T = {}> = T & {
  children?: ComponentChildren;
};

export type CSSPropertiesWithVars = CSSProperties & {
  [key: `--${string}`]: string | number | undefined;
};

export type TruncateMode = 'truncate' | 'fruncate';

export interface OverflowTextProps extends PropsWithChildren {
  mode?: TruncateMode;
  style?: Omit<CSSPropertiesWithVars, 'height' | 'overflow'>;
  className?: string;
  'data-truncate-segment-priority'?: '1' | '2';
}

export type MiddleTruncateProps = Omit<OverflowTextProps, 'mode' | 'children'> &
  AllowableContentGroups & {
    minimumLength?: number;
    priority?: 'start' | 'end' | 'equal';
    split?:
      | 'center'
      | 'extension'
      | 'leaf-path'
      | number
      | SplitOffset
      | CustomSplitFn;
  };

export type MiddleTruncateFilteredProps = Pick<
  MiddleTruncateProps,
  'priority'
> & { splitIndex?: number; splitOffset?: number };

export type CustomSplitFn = (
  contents: string,
  props?: MiddleTruncateFilteredProps
) => [string, string];
export type SplitOffsetType = 'last' | 'first';
export type SplitOffset = [SplitOffsetType, number];

type AllowableContentGroups =
  | {
      children?: never;
      contents: [ComponentChildren, ComponentChildren];
    }
  | {
      contents?: never;
      children: string;
    };

// When a split boundary lands adjacent to whitespace, the trailing/leading
// space sits at the seam between the two inline segments. Because the visible
// content is rendered with `white-space: nowrap`, the browser collapses that
// boundary whitespace and the name visually loses its space (e.g. "Hello world"
// rendering as "Helloworld"). To keep the space visible, nudge the proposed
// center index to the nearest position where neither side of the seam is
// whitespace, so the space stays interior to one segment. Returns the original
// index when no whitespace-free boundary exists (e.g. all-whitespace input).
const isWhitespace = (char: string | undefined): boolean =>
  char !== undefined && /\s/.test(char);

const avoidWhitespaceBoundary = (
  contents: string,
  centerIndex: number
): number => {
  const isOnBoundary = (index: number): boolean =>
    isWhitespace(contents[index - 1]) || isWhitespace(contents[index]);

  if (!isOnBoundary(centerIndex)) {
    return centerIndex;
  }

  // Search outward from the center for the closest boundary that is not
  // adjacent to whitespace, keeping the two segments as balanced as possible.
  for (let offset = 1; offset < contents.length; offset++) {
    const before = centerIndex - offset;
    if (before > 0 && !isOnBoundary(before)) {
      return before;
    }
    const after = centerIndex + offset;
    if (after < contents.length && !isOnBoundary(after)) {
      return after;
    }
  }

  return centerIndex;
};

const centerSplitIndex = (contents: string): number =>
  avoidWhitespaceBoundary(contents, Math.ceil(contents.length / 2));

// Split the contents into two equal segments
export const splitCenter: CustomSplitFn = (contents) => {
  if (contents.length < 2) {
    return [contents, ''];
  }
  const splitIndex = centerSplitIndex(contents);
  return [contents.slice(0, splitIndex), contents.slice(splitIndex)];
};

// Find the last dot in the contents and split a that index
export const splitExtension: CustomSplitFn = (contents) => {
  if (contents.length < 4) {
    return [contents, ''];
  }
  const lastDotIndex = contents.lastIndexOf('.');
  const extensionIndex = lastDotIndex + 1;
  const impliedExtensionLength = contents.length - extensionIndex;
  const maxExtensionLength = 10;
  const isTooLong = impliedExtensionLength > maxExtensionLength;

  const splitIndex =
    extensionIndex >= 1 && !isTooLong
      ? extensionIndex
      : centerSplitIndex(contents);

  return [contents.slice(0, splitIndex), contents.slice(splitIndex)];
};

export const splitLeafPath: CustomSplitFn = (contents) => {
  if (contents.length < 4) {
    return [contents, ''];
  }
  const lastSlashIndex = contents.lastIndexOf('/');
  const leafPathIndex = lastSlashIndex + 1;
  const impliedLeafPathLength = contents.length - leafPathIndex;
  const maxLeafPathLength = 25;
  const isTooLong = impliedLeafPathLength > maxLeafPathLength;
  const splitIndex =
    leafPathIndex >= 1 && !isTooLong
      ? leafPathIndex
      : Math.ceil(contents.length / 2);
  return [contents.slice(0, splitIndex), contents.slice(splitIndex)];
};

export const splitByIndex: CustomSplitFn = (contents, { splitIndex } = {}) => {
  if (typeof splitIndex !== 'number') {
    const centerIndex = Math.ceil(contents.length / 2);
    return [contents.slice(0, centerIndex), contents.slice(centerIndex)];
  }
  return [contents.slice(0, splitIndex), contents.slice(splitIndex)];
};

export const splitLast: CustomSplitFn = (
  contents: string,
  { splitOffset } = {}
) => {
  // fall back to center split if the offset is not valid
  if (
    typeof splitOffset !== 'number' ||
    splitOffset <= 0 ||
    splitOffset >= contents.length
  ) {
    const centerIndex = Math.ceil(contents.length / 2);
    return [contents.slice(0, centerIndex), contents.slice(centerIndex)];
  }

  const splitIndex = contents.length - splitOffset;
  return [contents.slice(0, splitIndex), contents.slice(splitIndex)];
};

export const splitFirst: CustomSplitFn = (
  contents: string,
  { splitOffset } = {}
) => {
  // fall back to center split if the offset is not valid
  if (
    typeof splitOffset !== 'number' ||
    splitOffset <= 0 ||
    splitOffset >= contents.length
  ) {
    const centerIndex = Math.ceil(contents.length / 2);
    return [contents.slice(0, centerIndex), contents.slice(centerIndex)];
  }

  const splitIndex = splitOffset;
  return [contents.slice(0, splitIndex), contents.slice(splitIndex)];
};

export function OverflowText({
  children,
  mode = 'truncate',
  ...props
}: OverflowTextProps): JSX.Element {
  'use no memo';
  return (
    <span data-truncate-container={mode} {...props}>
      {mode === 'fruncate' ? (
        <span data-truncate-content>{children}</span>
      ) : (
        children
      )}
    </span>
  );
}

export function Truncate({
  children,
  ...props
}: Omit<OverflowTextProps, 'mode'>): JSX.Element {
  'use no memo';
  return (
    <OverflowText mode="truncate" {...props}>
      {children}
    </OverflowText>
  );
}

export function Fruncate({
  children,
  ...props
}: Omit<OverflowTextProps, 'mode'>): JSX.Element {
  'use no memo';
  return (
    <OverflowText mode="fruncate" {...props}>
      {children}
    </OverflowText>
  );
}

export function MiddleTruncate({
  children,
  contents,
  priority = 'end',
  split = 'center',
  minimumLength = 12,
  className,
  style,
  ...props
}: MiddleTruncateProps): JSX.Element | null {
  'use no memo';
  let firstSegment: ComponentChildren | null = null;
  let secondSegment: ComponentChildren | null = null;
  if (Array.isArray(contents)) {
    if (contents.length !== 2) {
      console.error('MiddleTruncate: contents must be an array of two items');
      return null;
    }
    firstSegment = contents[0];
    secondSegment = contents[1];
  } else {
    // TODO: figure out how to support ReactNode children in the future
    if (typeof children !== 'string') {
      console.error('MiddleTruncate: children must be a string');
      return null;
    }

    // In case styling relies on the presence of the component, keep a host node.
    if (children.length === 0) {
      return <span className={className} style={style}></span>;
    }

    // If the minimumLength is not met, we will still truncate the text,
    // but we will not split it into two segments.
    if (children.length < minimumLength) {
      if (priority === 'end') {
        return (
          <Fruncate {...props} className={className} style={style}>
            {children}
          </Fruncate>
        );
      } else {
        // 'start' and 'equal' both fall back to standard end-clipping.
        return (
          <Truncate {...props} className={className} style={style}>
            {children}
          </Truncate>
        );
      }
    }

    let splitFn: CustomSplitFn | null = null;
    let splitIndex: number | null = null;
    let splitOffset: number | null = null;

    // A little ugly, but want to make it fast?
    if (typeof split === 'string') {
      if (split === 'center') {
        splitFn = splitCenter;
      } else if (split === 'extension') {
        splitFn = splitExtension;
      } else if (split === 'leaf-path') {
        splitFn = splitLeafPath;
      }
    } else if (typeof split === 'number') {
      splitFn = splitByIndex;
      splitIndex = split;
    } else if (Array.isArray(split)) {
      const [offsetType, offsetValue] = split;
      splitOffset = offsetValue;
      if (offsetType === 'last') {
        splitFn = splitLast;
      } else if (offsetType === 'first') {
        splitFn = splitFirst;
      }
    } else if (typeof split === 'function') {
      splitFn = split;
    }

    // If we can't determine the split function, use the center split
    splitFn ??= splitCenter;

    const [firstHalfMessage, secondHalfMessage] = splitFn(children, {
      priority,
      splitIndex: typeof splitIndex === 'number' ? splitIndex : undefined,
      splitOffset: typeof splitOffset === 'number' ? splitOffset : undefined,
    });

    firstSegment = firstHalfMessage;
    secondSegment = secondHalfMessage;
  }

  const firstPriority =
    priority === 'start' || priority === 'equal' ? '1' : '2';
  const secondPriority = priority === 'end' || priority === 'equal' ? '1' : '2';

  return (
    <span
      data-truncate-group-container="middle"
      className={className}
      style={style}
    >
      <Truncate {...props} data-truncate-segment-priority={firstPriority}>
        {firstSegment}
      </Truncate>
      <Fruncate {...props} data-truncate-segment-priority={secondPriority}>
        {secondSegment}
      </Fruncate>
    </span>
  );
}
