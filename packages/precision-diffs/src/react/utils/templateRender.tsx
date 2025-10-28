import type { ReactNode } from 'react';

export function templateRender(
  children: ReactNode,
  __html: string | undefined
): React.JSX.Element {
  if (typeof window === 'undefined' && __html != null) {
    return (
      <>
        <template
          // @ts-expect-error unclear how to fix this
          shadowrootmode="open"
          dangerouslySetInnerHTML={{ __html }}
        />
        {children}
      </>
    );
  }
  return <>{children}</>;
}
