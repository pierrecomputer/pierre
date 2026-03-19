import { Fruncate, Truncate } from '@pierre/truncate/react';
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

      <Truncate>{defaultMessage}</Truncate>

      <Truncate marker="………">{defaultMessage}</Truncate>

      <Truncate marker={() => <span style={{ color: 'red' }}>…</span>}>
        {defaultMessage}
      </Truncate>

      <Truncate
        style={
          {
            backgroundColor: '#E5E5E5',
            '--truncate-marker-background-color': '#E5E5E5',
          } as CSSProperties
        }
      >
        {defaultMessage}
      </Truncate>

      <h2>Fruncate</h2>

      <Fruncate>{defaultMessage}</Fruncate>

      <Fruncate marker="………">{defaultMessage}</Fruncate>

      <Fruncate marker={() => <span style={{ color: 'red' }}>…</span>}>
        {defaultMessage}
      </Fruncate>

      <Fruncate
        style={
          {
            backgroundColor: '#E5E5E5',
            '--truncate-marker-background-color': '#E5E5E5',
          } as CSSProperties
        }
      >
        {defaultMessage}
      </Fruncate>
    </div>
  );
}
