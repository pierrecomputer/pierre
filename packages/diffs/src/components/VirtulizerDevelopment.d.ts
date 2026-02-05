import type { AdvancedVirtualizer } from './AdvancedVirtualizer';
import type { Virtualizer } from './Virtualizer';

// FIXME(amadeus): REMOVE ME AFTER RELEASING VIRTUALIZATION
declare global {
  interface Window {
    // oxlint-disable-next-line typescript/no-explicit-any
    __INSTANCE?: AdvancedVirtualizer<any> | Virtualizer;
    __TOGGLE?: () => void;
    __LOG?: boolean;
  }
}
