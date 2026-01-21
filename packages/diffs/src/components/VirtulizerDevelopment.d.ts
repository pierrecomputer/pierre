import type { AdvancedVirtualizer } from './AdvancedVirtualizer';
import type { SimpleVirtualizer } from './SimpleVirtualizer';

// FIXME(amadeus): REMOVE ME AFTER RELEASING VIRTUALIZATION
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __INSTANCE?: AdvancedVirtualizer<any> | SimpleVirtualizer;
    __TOGGLE?: () => void;
    __STOP?: boolean;
  }
}
