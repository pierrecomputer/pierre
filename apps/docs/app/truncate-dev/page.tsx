import { OverflowText } from '@pierre/truncate/react';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';

const defaultMessage = 'This is a test of the overflow text component.';

export default function TruncateDevPage() {
  if (process.env.NODE_ENV !== 'development') {
    return notFound();
  }

  return (
    <div
      style={
        {
          margin: '30px 20%',
          borderLeft: '8px solid #999',
          borderRight: '8px solid #999',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          backgroundColor: 'white',
        } as CSSProperties
      }
    >
      <style>{`
        h2 {
          font-size: 20px;
          font-weight: 600;
        }
      `}</style>
      <h2>Truncate</h2>

      <OverflowText>{defaultMessage}</OverflowText>

      <OverflowText
        style={
          {
            backgroundColor: '#E5E5E5',
            '--truncate-marker-background-color': '#E5E5E5',
          } as CSSProperties
        }
      >
        {defaultMessage}
      </OverflowText>

      <OverflowText renderOverflowMarker="………">{defaultMessage}</OverflowText>

      <OverflowText
        renderOverflowMarker={() => <span style={{ color: 'red' }}>…</span>}
      >
        {defaultMessage}
      </OverflowText>

      <h2>Fruncate</h2>

      <OverflowText mode="fruncate">{defaultMessage}</OverflowText>

      <OverflowText
        mode="fruncate"
        style={
          {
            backgroundColor: '#E5E5E5',
            '--truncate-marker-background-color': '#E5E5E5',
          } as CSSProperties
        }
      >
        {defaultMessage}
      </OverflowText>

      <OverflowText mode="fruncate" renderOverflowMarker="………">
        {defaultMessage}
      </OverflowText>

      <OverflowText
        mode="fruncate"
        renderOverflowMarker={() => <span style={{ color: 'red' }}>…</span>}
      >
        {defaultMessage}
      </OverflowText>
    </div>
  );
}
