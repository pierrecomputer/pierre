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

import { SimpleVirtualizer as SimpleVirtualizerClass } from '../components/SimpleVirtualizer';

export const SimpleVirtualizerContext: Context<
  SimpleVirtualizerClass | undefined
> = createContext<SimpleVirtualizerClass | undefined>(undefined);

interface SimpleVirtualizerProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  contentClassName?: string;
  contentStyle?: CSSProperties;
}

export function SimpleVirtualizer({
  children,
  className,
  style,
  contentClassName,
  contentStyle,
}: SimpleVirtualizerProps): React.JSX.Element {
  const [instance] = useState(() => {
    return typeof window !== 'undefined'
      ? new SimpleVirtualizerClass()
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
    <SimpleVirtualizerContext.Provider value={instance}>
      <div className={className} style={style} ref={ref}>
        <div className={contentClassName} style={contentStyle}>
          {children}
        </div>
      </div>
    </SimpleVirtualizerContext.Provider>
  );
}

export function useSimpleVirtualizer(): SimpleVirtualizerClass | undefined {
  return useContext(SimpleVirtualizerContext);
}
