import { type ReactNode, useId, useMemo } from 'react';
import type { PropsWithChildren } from 'react';

export interface RenderOverflowMarkerProps extends PropsWithChildren {}

export interface OverflowTextProps extends PropsWithChildren {
  backgroundColor?: string;
  renderOverflowMarker?:
    | ReactNode
    | ((props: RenderOverflowMarkerProps) => ReactNode);
}

export function OverflowText({
  children,
  backgroundColor,
  renderOverflowMarker = '…',
  ...props
}: OverflowTextProps) {
  const id = useId();

  const styleBlock = useMemo(() => {
    return `[data-truncate-overflow-marker-inner] { opacity: 0; }
@container measure (height >= 1.1lh) { [data-truncate-overflow-marker-inner] { opacity: 1; } }`;
  }, []);

  return (
    <div
      id={id}
      data-truncate-container
      {...props}
      style={{ height: '1lh', overflow: 'hidden' }}
    >
      <style>{styleBlock}</style>

      <div
        data-truncate-grid-container
        style={{
          display: 'grid',
          gridTemplateColumns: '0 minmax(0, max-content) auto',
          position: 'relative',
        }}
      >
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
              // css mask to hide the text underneath
              // mask: 'linear-gradient(to right, transparent, black 100%)',
              zIndex: 2,
              backgroundColor,
            }}
          >
            {typeof renderOverflowMarker === 'function'
              ? renderOverflowMarker({ children })
              : renderOverflowMarker}
          </div>
        </div>
        <div
          style={{
            overflow: 'hidden',
            zIndex: 1,
            textAlign: 'right',
          }}
        >
          <div
            data-truncate-visible-content
            style={{
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              direction: 'rtl',
            }}
          >
            <span style={{ unicodeBidi: 'plaintext' }}>{children}</span>
          </div>
          <div
            data-truncate-overflow-content
            style={{
              opacity: 0,
              pointerEvents: 'none',
              userSelect: 'none',
              wordBreak: 'break-all',
              marginTop: '-1lh',
              direction: 'rtl',
            }}
          >
            <span style={{ unicodeBidi: 'plaintext' }}>{children}</span>
          </div>
        </div>
        <div data-truncate-fill></div>
      </div>
    </div>
  );
}
