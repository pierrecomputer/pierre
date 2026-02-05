'use client';

import {
  type Context,
  createContext,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from 'react';

import {
  Virtualizer as VirtualizerClass,
  type VirtualizerConfig,
} from '../components/Virtualizer';

export const VirtualizerContext: Context<VirtualizerClass | undefined> =
  createContext<VirtualizerClass | undefined>(undefined);

interface VirtualizerProps {
  children: ReactNode;
  config?: Partial<VirtualizerConfig>;
  className?: string;
  style?: CSSProperties;
  contentClassName?: string;
  contentStyle?: CSSProperties;
}

export function Virtualizer({
  children,
  config,
  className,
  style,
  contentClassName,
  contentStyle,
}: VirtualizerProps): React.JSX.Element {
  const [instance] = useState(() => {
    return typeof window !== 'undefined'
      ? new VirtualizerClass(config)
      : undefined;
  });
  const ref = useCallback(
    (node: HTMLElement | null) => {
      if (node != null) {
        instance?.setup(node);
      } else {
        instance?.cleanUp();
      }
    },
    [instance]
  );
  return (
    <VirtualizerContext.Provider value={instance}>
      <div className={className} style={style} ref={ref}>
        <div className={contentClassName} style={contentStyle}>
          {children}
        </div>
      </div>
    </VirtualizerContext.Provider>
  );
}

export function useVirtualizer(): VirtualizerClass | undefined {
  return useContext(VirtualizerContext);
}
