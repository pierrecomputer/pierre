declare module 'benchmark-renderer' {
  import type { ReactNode } from 'react';

  export function pendingHighlights(): number;
  export function warmup(enabled: boolean): Promise<void>;
  export function Renderer(props: {
    value: string;
    active: boolean;
    highlight: boolean;
    animated: boolean;
  }): ReactNode;
}

declare module '*.css' {}
