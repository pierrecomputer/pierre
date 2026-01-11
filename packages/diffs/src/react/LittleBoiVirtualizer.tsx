'use client';

import {
  type CSSProperties,
  type Context,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useState,
} from 'react';

import { LittleBoiVirtualizer } from '../components/LittleBoiVirtualizer';

export const LittleBoiVirtualizerContext: Context<
  LittleBoiVirtualizer | undefined
> = createContext<LittleBoiVirtualizer | undefined>(undefined);

interface LittleBoiVirtualizerProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function LittleBoiVirtualizerWrapper({
  children,
  className,
  style,
}: LittleBoiVirtualizerProps): React.JSX.Element {
  const [instance] = useState(() => {
    return typeof window !== 'undefined'
      ? new LittleBoiVirtualizer()
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
    <LittleBoiVirtualizerContext.Provider value={instance}>
      <div className={className} style={style} ref={ref}>
        {children}
      </div>
    </LittleBoiVirtualizerContext.Provider>
  );
}

export function useVirtualizerInstance(): LittleBoiVirtualizer | undefined {
  return useContext(LittleBoiVirtualizerContext);
}
