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
          fontFamily: 'var(--font-geist-sans)',
          margin: '30px 20%',
          borderLeft: '8px solid light-dark(#999, #222)',
          borderRight: '8px solid light-dark(#999, #222)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          '--truncate-marker-background-color': 'var(--color-background)',
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

      <Truncate marker="▸">{defaultMessage}</Truncate>

      <Truncate variant="fade">{defaultMessage}</Truncate>

      <Truncate marker={() => <span style={{ color: 'aliceblue' }}>…</span>}>
        {defaultMessage}
      </Truncate>

      <Truncate
        style={{
          backgroundColor: 'light-dark(#E5E5E5, #111)',
          '--truncate-marker-background-color': 'light-dark(#E5E5E5, #111)',
          '--truncate-marker-fade-in-duration': '500ms',
        }}
      >
        {defaultMessage}
      </Truncate>

      <h2>Fruncate</h2>

      <Fruncate>{defaultMessage}</Fruncate>

      <Fruncate marker="◂">{defaultMessage}</Fruncate>

      <Fruncate variant="fade">{defaultMessage}</Fruncate>

      <Fruncate marker={() => <span style={{ color: 'lightgray' }}>…</span>}>
        {defaultMessage}
      </Fruncate>

      <Fruncate
        style={{
          backgroundColor: 'light-dark(#E5E5E5, #111)',
          '--truncate-marker-background-color': 'light-dark(#E5E5E5, #111)',
          '--truncate-marker-fade-in-duration': '500ms',
        }}
      >
        {defaultMessage}
      </Fruncate>
    </div>
  );
}
