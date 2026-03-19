import { type CSSProperties, type ReactNode, useId, useMemo } from 'react';
import type { PropsWithChildren } from 'react';

export interface RenderOverflowMarkerProps extends PropsWithChildren {}

export interface OverflowTextProps extends PropsWithChildren {
  mode?: 'truncate' | 'fruncate';
  style?: Omit<CSSProperties, 'height' | 'overflow'>;
  renderOverflowMarker?:
    | ReactNode
    | ((props: RenderOverflowMarkerProps) => ReactNode);
}

const CONTENTS_STYLE = {
  truncate: {
    columns: 'minmax(0, max-content) 0',
    marker: {
      right: 0,
    },
    outer: {},
    inner: {},
  },
  fruncate: {
    columns: '0 minmax(0, max-content) auto',
    marker: {},
    outer: {
      direction: 'rtl',
    },
    inner: {
      unicodeBidi: 'plaintext',
    },
  },
} as const;

function OverflowMarker({
  children,
  mode,
  renderOverflowMarker,
}: OverflowTextProps) {
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
        style={{
          display: 'inline-flex',
          position: 'absolute',
          ...CONTENTS_STYLE[mode!].marker,
          // css mask to hide the text underneath
          // mask: 'linear-gradient(to right, transparent, black 100%)',
          zIndex: 2,
          backgroundColor: 'var(--truncate-internal-marker-background-color)',
        }}
      >
        {typeof renderOverflowMarker === 'function'
          ? renderOverflowMarker({ children })
          : renderOverflowMarker}
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
        <span style={CONTENTS_STYLE[mode].inner}>{children}</span>
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
  renderOverflowMarker = '…',
  ...props
}: OverflowTextProps) {
  const id = useId();

  // TODO: I think this only needs to be injected once per document
  // maybe we can figure out a way to make sure multiple instance dont result in
  // multiple style blocks, without needing to query the dom
  // Or we have the users add this to their stylesheet themselves
  const styleBlock = useMemo(() => {
    return `[data-truncate-overflow-marker-inner] { opacity: 0; }
@container measure (height > 1lh) { [data-truncate-overflow-marker-inner] { opacity: 1; } }`;
  }, []);

  const content = (
    <OverflowContent key="content" mode={mode}>
      {children}
    </OverflowContent>
  );
  const marker = (
    <OverflowMarker
      key="marker"
      renderOverflowMarker={renderOverflowMarker}
      mode={mode}
    />
  );
  const fill = <div key="fill" data-truncate-fill></div>;

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
        } as CSSProperties
      }
    >
      <style>{styleBlock}</style>

      <div
        data-truncate-grid-container
        style={{
          display: 'grid',
          gridTemplateColumns: CONTENTS_STYLE[mode].columns,
          position: 'relative',
        }}
      >
        {mode === 'truncate' ? [content, marker] : [marker, content, fill]}
      </div>
    </div>
  );
}
