/** Operations with known trace counts, so that the harness can check itself. */
export interface SelfTest {
  composited(): void;
  mainThread(): void;
  forcedLayout(): void;
  /** A text change inside pane a only. */
  paneText(): void;
  /** A font size change on the parent of both panes, which both inherit. */
  sharedFont(): void;
}

declare global {
  interface Window {
    __selftest: SelfTest;
  }
}

const box = document.getElementById('box');
const panes = document.getElementById('panes');
const paneText = document.getElementById('a-text');
if (box === null || panes === null || paneText === null)
  throw new Error('Missing self-test elements');

window.__selftest = {
  // A transform animation runs on the compositor in Chromium.
  composited() {
    box.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(300px)' }],
      { duration: 300 }
    );
  },
  // A `left` animation needs the main thread on each frame.
  mainThread() {
    box.animate([{ left: '20px' }, { left: '320px' }], { duration: 300 });
  },
  // A geometry read after a style change forces a layout in the same task.
  forcedLayout() {
    setTimeout(() => {
      box.style.width = `${200 + Math.random() * 100}px`;
      void box.offsetWidth;
    }, 0);
  },
  paneText() {
    setTimeout(() => {
      paneText.textContent = `Pane a ${Math.random()}`;
    }, 0);
  },
  sharedFont() {
    setTimeout(() => {
      panes.style.fontSize = panes.style.fontSize === '20px' ? '' : '20px';
    }, 0);
  },
};
