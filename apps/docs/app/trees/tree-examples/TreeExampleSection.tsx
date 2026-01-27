import type { ReactNode } from 'react';

export function TreeExampleSection({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="scroll-mt-[20px] space-y-5" id={id}>
      {children}
    </div>
  );
}
