import { type JSX, type RefObject } from 'react';

import type { ModalStrategy } from '../../src/overlays';
import '../../src/overlays.css';
import { Drawer, Modal } from '../../src/react/overlays';

/** The open state of the fixture's overlays. */
export interface OverlayState {
  modal: boolean;
  drawer: boolean;
}

const ROWS = Array.from({ length: 6 }, (_, index) => index);
const ITEMS = Array.from({ length: 20 }, (_, index) => index);

/**
 * A modal over the workspace and a drawer from its right edge, with small
 * content of their own, so that the scenarios measure the overlays and their
 * effect on the panes. `?modal=` selects the strategy of the modal and
 * `?backdrop=opaque` its backdrop.
 */
export function BenchOverlays({
  workspace,
  state,
  onClose,
  strategy,
  backdrop,
}: {
  workspace: RefObject<HTMLElement | null>;
  state: OverlayState;
  onClose: (overlay: keyof OverlayState) => void;
  strategy: ModalStrategy;
  backdrop: 'translucent' | 'opaque';
}): JSX.Element {
  return (
    <>
      <Modal
        open={state.modal}
        onClose={() => onClose('modal')}
        layout={workspace}
        label="Benchmark modal"
        backdrop={backdrop}
        experimentalStrategy={strategy}
        className="bench-modal"
      >
        <h2>Review changes</h2>
        <ul>
          {ROWS.map((row) => (
            <li key={row}>
              src/file-{row}.ts{' '}
              <span>
                +{row * 7} −{row}
              </span>
            </li>
          ))}
        </ul>
        <input aria-label="Commit message" defaultValue="feat: change" />
        <button type="button" onClick={() => onClose('modal')}>
          Close
        </button>
      </Modal>
      <Drawer
        open={state.drawer}
        onClose={() => onClose('drawer')}
        layout={workspace}
        edge="right"
        label="Benchmark drawer"
        className="bench-drawer"
      >
        <h2>Activity</h2>
        <ol>
          {ITEMS.map((item) => (
            <li key={item}>Event {item}</li>
          ))}
        </ol>
        <button type="button" onClick={() => onClose('drawer')}>
          Close
        </button>
      </Drawer>
    </>
  );
}
