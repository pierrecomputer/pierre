import { type JSX, type RefObject, useId, useRef, useState } from 'react';

import type { ModalStrategy } from '../../src/overlays';
import { Drawer, Modal } from '../../src/react/overlays';
import '../../src/overlays.css';

// `?modal=dialog|dialog-hide-covered|popover` and `?backdrop=opaque` select
// the variant of the modal, for the comparison and its e2e tests.
const params = new URLSearchParams(location.search);
const requestedStrategy = params.get('modal');
const STRATEGY: ModalStrategy =
  requestedStrategy === 'dialog' || requestedStrategy === 'popover'
    ? requestedStrategy
    : 'dialog-hide-covered';
const BACKDROP = params.get('backdrop') === 'opaque' ? 'opaque' : 'translucent';

const CHANGES = [
  { path: 'src/overlays/index.ts', added: 412, removed: 0 },
  { path: 'src/react/overlays.tsx', added: 168, removed: 0 },
  { path: 'src/overlays.css', added: 64, removed: 0 },
  { path: 'demo/app/index.tsx', added: 21, removed: 2 },
];

const ACTIVITY = [
  { time: '10:42', text: 'Agent ran the e2e suite: 31 passed' },
  { time: '10:39', text: 'Agent edited src/overlays/index.ts' },
  { time: '10:31', text: 'You asked for a drawer from the right edge' },
  { time: '10:30', text: 'Session started on necolas/layout' },
];

/**
 * The header buttons of the app's overlays: a modal that reviews the agent's
 * changes, and a drawer of session activity. Each overlay comes right after
 * its button in the DOM.
 */
export function AppOverlays({
  workspace,
}: {
  workspace: RefObject<HTMLElement | null>;
}): JSX.Element {
  const [review, setReview] = useState(false);
  const [activity, setActivity] = useState(false);
  const activityButton = useRef<HTMLButtonElement>(null);
  const reviewTitle = useId();
  const activityTitle = useId();

  return (
    <div className="app-overlay-buttons">
      <button type="button" onClick={() => setReview(true)}>
        Review changes
      </button>
      <Modal
        open={review}
        onClose={() => setReview(false)}
        layout={workspace}
        labelledBy={reviewTitle}
        backdrop={BACKDROP}
        experimentalStrategy={STRATEGY}
        className="app-review"
      >
        <header className="app-overlay-header">
          <h2 id={reviewTitle}>Review changes</h2>
          <button
            type="button"
            aria-label="Close review"
            onClick={() => setReview(false)}
          >
            ×
          </button>
        </header>
        <p>The agent changed {CHANGES.length} files.</p>
        <ul className="app-review-files">
          {CHANGES.map(({ path, added, removed }) => (
            <li key={path}>
              <code>{path}</code>
              <span>
                +{added} −{removed}
              </span>
            </li>
          ))}
        </ul>
        <label className="app-review-message">
          Commit message
          <input defaultValue="feat(layouts): add overlays" />
        </label>
        <footer className="app-overlay-footer">
          <button type="button" onClick={() => setReview(false)}>
            Discard
          </button>
          <button
            type="button"
            className="app-primary"
            onClick={() => setReview(false)}
          >
            Apply
          </button>
        </footer>
      </Modal>
      <button
        ref={activityButton}
        type="button"
        onClick={() => setActivity((value) => !value)}
      >
        Activity
      </button>
      <Drawer
        open={activity}
        onClose={() => setActivity(false)}
        layout={workspace}
        edge="right"
        trigger={activityButton}
        labelledBy={activityTitle}
        className="app-activity"
      >
        <header className="app-overlay-header">
          <h2 id={activityTitle}>Activity</h2>
          <button
            type="button"
            aria-label="Close activity"
            onClick={() => setActivity(false)}
          >
            ×
          </button>
        </header>
        <ol className="app-activity-list">
          {ACTIVITY.map(({ time, text }) => (
            <li key={time}>
              <time>{time}</time> {text}
            </li>
          ))}
        </ol>
      </Drawer>
    </div>
  );
}
