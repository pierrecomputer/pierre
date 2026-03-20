import { type CSSProperties, type ReactNode, useId } from 'react';
import type { PropsWithChildren } from 'react';

type CSSPropertiesWithVars = CSSProperties & {
  [key: `--${string}`]: string | number | undefined;
};

export interface MarkerProps extends PropsWithChildren {}

export type TruncateMode = 'truncate' | 'fruncate';

export interface OverflowTextProps extends PropsWithChildren {
  mode?: TruncateMode;
  style?: Omit<CSSPropertiesWithVars, 'height' | 'overflow'>;
  marker?: ReactNode | ((props: MarkerProps) => ReactNode);
  variant?: 'default' | 'fade';
}

// TODO: I think this only needs to be injected once per document
// maybe we can figure out a way to make sure multiple instance dont result in
// multiple style blocks, without needing to query the dom
// Or we have the users add this to their stylesheet themselves
const styleBlock = `
[data-truncate-overflow-marker-inner] {
  opacity: 0;
  transition: opacity var(--truncate-marker-fade-out-duration, 100ms) ease-in-out;
}
@container measure (height > 1lh) {
 [data-truncate-overflow-marker-inner] {
   opacity: 1;
   transition: opacity var(--truncate-marker-fade-in-duration, 0ms) ease-in-out;
  }
}`.trim();

const FADE = 'light-dark(#0007, #000F), 35%, transparent 65%, transparent';
const CONTENTS_STYLE = {
  truncate: {
    columns: 'minmax(0, max-content) 0',
    marker: {
      right: 0,
      paddingLeft:
        'calc(var(--truncate-marker-prefade-width) + var(--truncate-marker-gap))',
    },
    outer: {},
    inner: {},
    fadeBg: `radial-gradient(at right center, ${FADE});`,
  },
  fruncate: {
    columns: '0 minmax(0, max-content) auto',
    marker: {
      paddingRight:
        'calc(var(--truncate-marker-prefade-width) + var(--truncate-marker-gap))',
    },
    outer: {
      direction: 'rtl',
    },
    inner: {
      unicodeBidi: 'plaintext',
    },
    fadeBg: `radial-gradient(at left center, ${FADE});`,
  },
} as const;

function FadeMarker(mode: TruncateMode) {
  return (
    <span
      style={{
        width: '4px',
        height: '0.9lh',
        marginTop: '0.05lh',
        marginBottom: '0.05lh',
        background: CONTENTS_STYLE[mode].fadeBg,
      }}
    />
  );
}

function OverflowMarker({
  children,
  mode,
  marker,
  variant = 'default',
}: OverflowTextProps) {
  const fadeDir = mode === 'truncate' ? 'to right' : 'to left';
  const isFadeVariant = variant === 'fade';
  return (
    <div
      data-truncate-overflow-marker
      style={{
        container: 'measure / size',
        overflow: 'visible',
        userSelect: 'none',
        pointerEvents: 'none',
      }}
    >
      <div
        data-truncate-overflow-marker-inner
        style={
          {
            ...CONTENTS_STYLE[mode!].marker,
            display: 'flex',
            position: 'absolute',
            height: '1lh',
            zIndex: 2,
            color:
              'color-mix(in srgb, currentColor var(--truncate-marker-opacity, 50%), transparent)',
            '--truncate-marker-prefade-width': '3px',
            '--truncate-marker-gap': '1px',
            background: isFadeVariant
              ? 'transparent'
              : `linear-gradient(${fadeDir}, transparent, var(--truncate-marker-prefade-width), var(--truncate-internal-marker-background-color), calc(2.5 * var(--truncate-marker-prefade-width)), var(--truncate-internal-marker-background-color))`,
          } as CSSPropertiesWithVars
        }
      >
        {typeof marker === 'function'
          ? marker({ children })
          : isFadeVariant
            ? FadeMarker(mode!)
            : marker}
      </div>
    </div>
  );
}

function OverflowContent(
  options: OverflowTextProps & { mode: 'truncate' | 'fruncate' }
) {
  const { mode, children } = options;

  return (
    <div
      style={{
        zIndex: 1,
      }}
    >
      <div
        data-truncate-visible-content
        style={{
          whiteSpace: 'nowrap',
          ...CONTENTS_STYLE[mode].outer,
        }}
      >
        {mode === 'truncate' ? (
          // The span wrapper here is only needed to implement the right aligned internals
          // for fruncate
          children
        ) : (
          <span style={CONTENTS_STYLE[mode].inner}>{children}</span>
        )}
      </div>
      <div
        data-truncate-overflow-content
        style={{
          opacity: 0,
          pointerEvents: 'none',
          userSelect: 'none',
          wordBreak: 'break-all',
          marginTop: '-1lh',
          ...CONTENTS_STYLE[mode].outer,
        }}
      >
        <span style={CONTENTS_STYLE[mode].inner}>{children}</span>
      </div>
    </div>
  );
}

export function OverflowText({
  children,
  mode = 'truncate',
  style,
  marker = '…',
  variant = 'default',
  ...props
}: OverflowTextProps) {
  const id = useId();

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
      id={id}
      data-truncate-container
      {...props}
      style={
        {
          ...style,
          height: '1lh',
          overflow: 'hidden',
          '--truncate-internal-marker-background-color':
            'var(--truncate-marker-background-color, light-dark(white, black))',
        } as CSSPropertiesWithVars
      }
    >
      <style>{styleBlock}</style>

      <div
        data-truncate-grid-container={mode}
        style={{
          display: 'grid',
          gridTemplateColumns: CONTENTS_STYLE[mode].columns,
          position: 'relative',
        }}
      >
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
