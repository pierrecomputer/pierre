// The cover API with the app's own overlays (the e2e tests use it): a native
// `<dialog>` with `showModal()` and `Layout.useCover`, and a popover of the
// page with `coverLayout`, over a row of four panes.
import { type JSX, StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { coverLayout, type OverlayCover, type PaneNode } from '../src';
import * as Layout from '../src/react';
import {
  createLayout,
  hiddenPanes,
  PANE_VISIBILITY_EVENT,
  type PaneVisibilityEvent,
} from '../src/react';

const page = {
  layout: createLayout(
    {
      type: 'split',
      id: 'row',
      direction: 'horizontal',
      sizes: [1, 1, 1, 1],
      children: ['a', 'b', 'c', 'd'].map((id) => ({
        type: 'pane' as const,
        id,
      })),
    },
    [hiddenPanes()]
  ),
  visibility: {} as Record<string, boolean[]>,
  covers: [] as OverlayCover[],
  release: null as (() => void) | null,
  openPopover(): void {
    const popover = document.getElementById('popover');
    const layout = document.querySelector<HTMLElement>('.pierre-layouts');
    if (popover === null || layout === null) return;
    popover.showPopover();
    page.release = coverLayout(layout, popover, {
      onCover: (cover) => page.covers.push(cover),
    });
  },
  closePopover(): void {
    page.release?.();
    page.release = null;
    document.getElementById('popover')?.hidePopover();
  },
};
Object.assign(window, { __cover: page });

function renderPane(pane: PaneNode): JSX.Element {
  return <p>{pane.id}</p>;
}

function App(): JSX.Element {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  Layout.useCover(page.layout, dialog, open);
  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open) element.showModal();
    else element.close();
  }, [open]);
  useEffect(() => {
    const controller = new AbortController();
    for (const host of document.querySelectorAll<HTMLElement>(
      '[data-layouts-pane]'
    )) {
      const id = host.dataset.layoutsPane ?? '';
      host.addEventListener(
        PANE_VISIBILITY_EVENT,
        (event) => {
          (page.visibility[id] ??= []).push(
            (event as PaneVisibilityEvent).detail.hidden
          );
        },
        { signal: controller.signal }
      );
    }
    return () => controller.abort();
  }, []);
  return (
    <>
      <div style={{ position: 'fixed', inset: 0 }}>
        <Layout.Root layout={page.layout} renderPane={renderPane} />
      </div>
      <button
        type="button"
        style={{ position: 'fixed', right: 8, bottom: 8, zIndex: 10 }}
        onClick={() => setOpen(true)}
      >
        Open the dialog
      </button>
      <dialog
        ref={dialog}
        className="app-dialog"
        aria-label="App dialog"
        onClose={() => setOpen(false)}
      >
        <button type="button" onClick={() => setOpen(false)}>
          Close the dialog
        </button>
      </dialog>
      <div id="popover" className="app-popover" popover="manual">
        Popover
      </div>
    </>
  );
}

const element = document.getElementById('root');
if (element === null) throw new Error('Missing root');
createRoot(element).render(
  <StrictMode>
    <App />
  </StrictMode>
);
