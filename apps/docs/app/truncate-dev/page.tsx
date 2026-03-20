import { Fruncate, Truncate } from '@pierre/truncate/react';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';

const defaultMessage = 'src/components/ui/elements/deprecated/button.tsx';

function EllipsisIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentcolor"
      style={{ height: '0.55lh', marginTop: '0.4lh', marginBottom: '0.05lh' }}
    >
      <path d="M5 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M9.5 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M14 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0" />
    </svg>
  );
}

export default function TruncateDevPage() {
  if (process.env.NODE_ENV !== 'development') {
    return notFound();
  }

  return (
    <div
      style={
        {
          fontFamily: 'var(--font-geist-sans)',
          fontSize: '14px',
          margin: '30px 20%',
          borderLeft: '2px solid light-dark(#CCC, #222)',
          borderRight: '2px solid light-dark(#CCC, #222)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          '--truncate-marker-background-color': 'var(--color-background)',
          '--app-custom-background-color': 'light-dark(#E5E5E5, #111)',
        } as CSSProperties
      }
    >
      <style>{`
        h2 {
          font-size: 20px;
          font-weight: 600;
        }
      `}</style>

      <div>
        <h2>Truncate</h2>

        <Truncate>{defaultMessage}</Truncate>

        <Truncate marker="▸">{defaultMessage}</Truncate>

        <Truncate variant="fade">{defaultMessage}</Truncate>

        <Truncate marker={() => <EllipsisIcon />}>{defaultMessage}</Truncate>

        <Truncate
          style={{
            backgroundColor: 'var(--app-custom-background-color)',
            '--truncate-marker-background-color':
              'var(--app-custom-background-color)',
            '--truncate-marker-fade-in-duration': '500ms',
          }}
        >
          {defaultMessage}
        </Truncate>
      </div>

      <div>
        <h2>Fruncate</h2>

        <Fruncate>{defaultMessage}</Fruncate>

        <Fruncate marker="◂">{defaultMessage}</Fruncate>

        <Fruncate variant="fade">{defaultMessage}</Fruncate>

        <Fruncate marker={() => <EllipsisIcon />}>{defaultMessage}</Fruncate>

        <Fruncate
          style={{
            backgroundColor: 'var(--app-custom-background-color)',
            '--truncate-marker-background-color':
              'var(--app-custom-background-color)',
            '--truncate-marker-fade-in-duration': '500ms',
          }}
        >
          {defaultMessage}
        </Fruncate>
      </div>
    </div>
  );
}
