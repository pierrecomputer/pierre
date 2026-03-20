import { type CSSProperties, type ReactNode } from 'react';
import type { PropsWithChildren } from 'react';

type CSSPropertiesWithVars = CSSProperties & {
  [key: `--${string}`]: string | number | undefined;
};

export interface MarkerProps extends PropsWithChildren {}

export type TruncateMode = 'truncate' | 'fruncate';

export interface OverflowTextProps extends PropsWithChildren {
  mode?: TruncateMode;
  style?: Omit<CSSPropertiesWithVars, 'height' | 'overflow'>;
  className?: string;
  marker?: ReactNode | ((props: MarkerProps) => ReactNode);
  variant?: 'default' | 'fade';
}

function OverflowMarker({
  children,
  marker,
  variant = 'default',
}: OverflowTextProps) {
  const isFadeVariant = variant === 'fade';
  return (
    <div data-truncate-marker-cell>
      <div data-truncate-marker>
        {typeof marker === 'function' ? (
          marker({ children })
        ) : isFadeVariant ? (
          <span data-truncate-fade />
        ) : (
          marker
        )}
      </div>
    </div>
  );
}

function OverflowContent(
  options: OverflowTextProps & { mode: 'truncate' | 'fruncate' }
) {
  const { mode, children } = options;

  return (
    <div>
      <div data-truncate-content="visible">
        {mode === 'fruncate' ? (
          // The span wrapper here is only needed to implement the right aligned internals
          // for fruncate
          <span>{children}</span>
        ) : (
          children
        )}
      </div>
      <div data-truncate-content="overflow">
        {mode === 'fruncate' ? (
          // The span wrapper here is only needed to implement the right aligned internals
          // for fruncate
          <span>{children}</span>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

export function OverflowText({
  children,
  mode = 'truncate',
  marker = '…',
  variant = 'default',
  ...props
}: OverflowTextProps) {
  const contentNode = (
    <OverflowContent key="content" mode={mode}>
      {children}
    </OverflowContent>
  );
  const markerNode = (
    <OverflowMarker
      key="marker"
      marker={marker}
      mode={mode}
      variant={variant}
    />
  );
  const fillNode = <div key="fill" data-truncate-fill></div>;

  return (
    <div
      data-truncate-container={mode}
      data-truncate-variant={variant}
      {...props}
    >
      <div data-truncate-grid>
        {mode === 'truncate'
          ? [contentNode, markerNode]
          : [markerNode, contentNode, fillNode]}
      </div>
    </div>
  );
}

export function Truncate({
  children,
  ...props
}: Omit<OverflowTextProps, 'mode'>) {
  return (
    <OverflowText mode="truncate" {...props}>
      {children}
    </OverflowText>
  );
}

export function Fruncate({
  children,
  ...props
}: Omit<OverflowTextProps, 'mode'>) {
  return (
    <OverflowText mode="fruncate" {...props}>
      {children}
    </OverflowText>
  );
}
export interface MiddleTruncateProps extends Omit<OverflowTextProps, 'mode'> {
  priority?: 'start' | 'end' | 'equal';
  splitIndex?: number;
}

export function MiddleTruncate({
  children,
  priority = 'end',
  splitIndex = 29,
  ...props
}: MiddleTruncateProps) {
  const firstHalfMessage = (children as string).slice(0, splitIndex);
  const secondHalfMessage = (children as string).slice(splitIndex);
  const firstIsLarger = firstHalfMessage.length >= secondHalfMessage.length;
  const secondIsLarger = !firstIsLarger;

  const firstCanBeSimple = priority === 'equal' && secondIsLarger;
  const secondCanBeSimple = priority === 'equal' && firstIsLarger;

  const firstPropOverrides: Partial<OverflowTextProps> = {};
  const secondPropOverrides: Partial<OverflowTextProps> = {};

  if (firstCanBeSimple) {
    firstPropOverrides.marker = '';
  }
  if (secondCanBeSimple) {
    secondPropOverrides.marker = '';
  }

  const firstSegment = (
    <Truncate {...props} {...firstPropOverrides}>
      {firstHalfMessage}
    </Truncate>
  );
  const secondSegment = (
    <Fruncate {...props} {...secondPropOverrides}>
      {secondHalfMessage}
    </Fruncate>
  );

  return (
    <div data-truncate-group-container="middle">
      <div
        data-truncate-segment-priority={
          priority === 'start' || priority === 'equal' ? '1' : '2'
        }
      >
        {firstSegment}
      </div>
      <div
        data-truncate-segment-priority={
          priority === 'end' || priority === 'equal' ? '1' : '2'
        }
      >
        {secondSegment}
      </div>
    </div>
  );
}
