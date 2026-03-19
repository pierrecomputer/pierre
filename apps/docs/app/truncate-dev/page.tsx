import { OverflowText } from '@pierre/truncate/react';
import { notFound } from 'next/navigation';

export default function TruncateDevPage() {
  if (process.env.NODE_ENV !== 'development') {
    return notFound();
  }

  return (
    <div
      style={{
        margin: '30px 20%',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        backgroundColor: 'white',
      }}
    >
      <OverflowText backgroundColor="white">
        This is a test of the overflow text component.
      </OverflowText>

      <OverflowText backgroundColor="white" renderOverflowMarker="………">
        This is a test of the overflow text component.
      </OverflowText>

      <OverflowText
        backgroundColor="white"
        renderOverflowMarker={() => <span style={{ color: 'red' }}>…</span>}
      >
        This is a test of the overflow text component.
      </OverflowText>
    </div>
  );
}
