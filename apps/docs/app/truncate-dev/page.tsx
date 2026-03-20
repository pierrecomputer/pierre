import { Fruncate, MiddleTruncate, Truncate } from '@pierre/truncate/react';
import '@pierre/truncate/style.css';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';

import { ResizableRightBorder } from './ResizableRightBorder';

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

function ExampleGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: '600' }}>{title}</h2>
      {children}
    </div>
  );
}

export default function TruncateDevPage() {
  if (process.env.NODE_ENV !== 'development') {
    return notFound();
  }

  return (
    <ResizableRightBorder
      style={
        {
          backgroundColor:
            'light-dark(var(--color-background), var(--color-card))',
          fontFamily: 'var(--font-geist-sans)',
          fontSize: '16px',
          margin: '30px 25%',
          maxWidth: '640px',
          padding: '4px 0',
          border: '2px solid light-dark(#CCC, #222)',
          borderRadius: '4px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          '--truncate-marker-background-color':
            'light-dark(var(--color-background), var(--color-card))',
          '--app-custom-background-color': 'light-dark(#F0F0F0, #222)',
        } as CSSProperties
      }
    >
      <style>{`
        body {
          background-color: var(--color-background);
        }
        h2 {
          font-size: 20px;
          font-weight: 600;
          overflow: hidden;
        }
      `}</style>

      <ExampleGroup title="Native">
        <div
          style={{
            width: '100%',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {defaultMessage}
        </div>
      </ExampleGroup>

      <ExampleGroup title="Truncate">
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
      </ExampleGroup>

      <ExampleGroup title="Fruncate">
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
      </ExampleGroup>

      <ExampleGroup title="Middle">
        <MiddleTruncate>{defaultMessage}</MiddleTruncate>
        <MiddleTruncate priority="start">{defaultMessage}</MiddleTruncate>
        <MiddleTruncate priority="equal">{defaultMessage}</MiddleTruncate>
        <MiddleTruncate priority="equal" splitIndex={3}>
          {defaultMessage}
        </MiddleTruncate>

        <MiddleTruncate variant="fade">{defaultMessage}</MiddleTruncate>
      </ExampleGroup>
    </ResizableRightBorder>
  );
}
