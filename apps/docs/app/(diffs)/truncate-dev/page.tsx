import { Fruncate, MiddleTruncate, Truncate } from '@pierre/truncate/react';
import '@pierre/truncate/style.css';
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
      }}
    >
      <h2
        style={{
          fontSize: '16px',
          fontWeight: '600',
          padding: '8px',
          backgroundColor: 'light-dark(#F0F0F0, #000)',
        }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

function Example({
  children,
  description,
}: {
  children: React.ReactNode;
  description: string;
}) {
  return (
    <div
      style={{
        backgroundColor: 'var(--color-background)',
        paddingBlock: '8px',
      }}
    >
      <p
        style={{
          fontFamily: 'var(--font-geist-mono)',
          fontSize: '13px',
          fontWeight: '500',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginBottom: '4px',
          paddingInline: '8px',

          color: 'var(--color-muted-foreground)',
        }}
      >
        {description}
      </p>
      {children}
    </div>
  );
}

export default function TruncateDevPage() {
  // if (process.env.NODE_ENV !== 'development') {
  //   return notFound();
  // }

  return (
    <ResizableRightBorder
      style={
        {
          backgroundColor: 'light-dark(#CCC, #222)',
          fontFamily: 'var(--font-geist-sans)',
          fontSize: '14px',
          margin: '30px 30px',
          width: '480px',
          maxWidth: 'calc(100% - 60px)',
          border: '2px solid light-dark(#CCC, #222)',
          borderRadius: '4px',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          '--truncate-marker-background-color': 'var(--color-background)',
          '--app-custom-background-color': 'light-dark(#F0F0F0, #222)',
        } as CSSProperties
      }
    >
      <style>{`
        body {
          background-color: var(--color-background);
        }
      `}</style>

      <ExampleGroup title="Native">
        <Example description="default">
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
        </Example>
      </ExampleGroup>

      <ExampleGroup title="Truncate">
        <Example description="default">
          <Truncate>{defaultMessage}</Truncate>
        </Example>
        <Example description="marker='▸'">
          <Truncate marker="▸">{defaultMessage}</Truncate>
        </Example>
        <Example description="variant='fade'">
          <Truncate variant="fade">{defaultMessage}</Truncate>
        </Example>
        <Example description="marker={() => <EllipsisIcon />}">
          <Truncate marker={() => <EllipsisIcon />}>{defaultMessage}</Truncate>
        </Example>
        <Example description="style={{ backgroundColor: 'var(--app-custom-background-color)', '--truncate-marker-background-color': 'var(--app-custom-background-color)', '--truncate-marker-fade-in-duration': '500ms' }}">
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
        </Example>
      </ExampleGroup>

      <ExampleGroup title="Fruncate">
        <Example description="default">
          <Fruncate>{defaultMessage}</Fruncate>
        </Example>
        <Example description="marker='◂'">
          <Fruncate marker="◂">{defaultMessage}</Fruncate>
        </Example>
        <Example description="variant='fade'">
          <Fruncate variant="fade">{defaultMessage}</Fruncate>
        </Example>
        <Example description="marker={() => <EllipsisIcon />}">
          <Fruncate marker={() => <EllipsisIcon />}>{defaultMessage}</Fruncate>
        </Example>
        <Example description="style={{ …,'--truncate-marker-background-color': …, '--truncate-marker-fade-in-duration': '500ms' }}">
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
        </Example>
      </ExampleGroup>

      <ExampleGroup title="Middle">
        <Example description="priority='end'">
          <MiddleTruncate priority="end">{defaultMessage}</MiddleTruncate>
        </Example>

        <Example description="priority='start'">
          <MiddleTruncate priority="start">{defaultMessage}</MiddleTruncate>
        </Example>

        <Example description="priority='equal'">
          <MiddleTruncate priority="equal">{defaultMessage}</MiddleTruncate>
        </Example>

        <Example description="split={6} priority='equal'">
          <MiddleTruncate priority="equal" split={6}>
            {defaultMessage}
          </MiddleTruncate>
        </Example>

        <Example description="split={['last', 3]}">
          <MiddleTruncate split={['last', 4]}>{defaultMessage}</MiddleTruncate>
        </Example>

        <Example description="split={['first', 14]}">
          <MiddleTruncate split={['first', 14]}>
            {defaultMessage}
          </MiddleTruncate>
        </Example>

        <Example description="split='leaf-path'">
          <MiddleTruncate split="leaf-path">{defaultMessage}</MiddleTruncate>
        </Example>

        <Example description="split='extension'">
          <MiddleTruncate split="extension">{defaultMessage}</MiddleTruncate>
        </Example>

        <Example description="split={(contents) => [contents.slice(0, 9), contents.slice(9)]}">
          <MiddleTruncate
            split={(contents) => [contents.slice(0, 9), contents.slice(9)]}
          >
            {defaultMessage}
          </MiddleTruncate>
        </Example>

        <Example description="contents={[defaultMessage.slice(0, 19), defaultMessage.slice(19)]}">
          <MiddleTruncate
            contents={[defaultMessage.slice(0, 19), defaultMessage.slice(19)]}
          />
        </Example>

        <Example description="variant='fade'">
          <MiddleTruncate variant="fade">{defaultMessage}</MiddleTruncate>
        </Example>
      </ExampleGroup>
    </ResizableRightBorder>
  );
}
