'use client';

import {
  type CSSProperties,
  type PointerEvent,
  type PropsWithChildren,
  useRef,
  useState,
} from 'react';

type ResizableRightBorderProps = PropsWithChildren<{
  style?: CSSProperties;
  startWidth?: number;
  minWidth?: number;
}>;

export function ResizableRightBorder({
  children,
  style,
  startWidth = 480,
  minWidth = 80,
}: ResizableRightBorderProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(startWidth ?? null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    maxWidth: number;
  } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (container == null) return;

    const bounds = container.getBoundingClientRect();
    const viewportPadding = 24;
    const maxWidth = Math.max(
      minWidth,
      window.innerWidth - bounds.left - viewportPadding
    );

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: bounds.width,
      maxWidth,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (dragState == null || event.pointerId !== dragState.pointerId) return;

    const delta = event.clientX - dragState.startX;
    const nextWidth = Math.round(dragState.startWidth + delta);
    const clampedWidth = Math.min(
      Math.max(nextWidth, minWidth),
      dragState.maxWidth
    );

    setWidth(clampedWidth);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (dragState == null || event.pointerId !== dragState.pointerId) return;

    dragStateRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      ref={containerRef}
      style={{
        ...style,
        width: width == null ? undefined : `${width}px`,
        position: 'relative',
      }}
    >
      {children}

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize container width"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: 'absolute',
          top: 0,
          right: '-9px',
          width: '12px',
          height: '100%',
          cursor: 'ew-resize',
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            height: '96%',
            width: '1.5px',
            top: '2%',
            right: '4px',
            opacity: 0.5,
            backgroundColor: 'light-dark(#CCC, #222)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            height: '94%',
            width: '1.5px',
            top: '3%',
            right: '1px',
            opacity: 0.5,
            backgroundColor: 'light-dark(#CCC, #222)',
          }}
        />
      </div>
    </div>
  );
}
