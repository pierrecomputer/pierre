import type { CodeView } from './CodeView';
import type { Virtualizer } from './Virtualizer';

// Browser debug hooks installed only in development builds.
declare global {
  interface Window {
    // oxlint-disable-next-line typescript/no-explicit-any
    __INSTANCE?: CodeView<any, any> | Virtualizer;
    __TOGGLE?: () => void;
    __LOG?: boolean;
  }
}
