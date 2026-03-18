import { OverflowText } from '@pierre/truncate/react';
import { notFound } from 'next/navigation';

export default function TruncateDevPage() {
  if (process.env.NODE_ENV !== 'development') {
    return notFound();
  }

  return (
    <div>
      <OverflowText
        baseCss={`
          color: red;
        `}
        onOverflow={`
          color: blue;
        `}
      >
        This is a test of the overflow text component.
      </OverflowText>
    </div>
  );
}
