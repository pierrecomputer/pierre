import { type RefObject, useEffect } from 'react';

import { STATE_FILE_NAMES } from './constants';

const INITIAL_POLL_MS = 32;
const MAX_POLL_MS = 256;
const MAX_SHADOW_ROOT_POLL_ATTEMPTS = 8;

interface StatePreviewItems {
  hover: HTMLElement | null;
  focus: HTMLElement | null;
  selected: HTMLElement | null;
  selectedFocused: HTMLElement | null;
}

function findStatePreviewItems(root: ShadowRoot): StatePreviewItems {
  const items = root.querySelectorAll<HTMLElement>(
    "[data-type='item'][data-item-type='file']"
  );

  let hover: HTMLElement | null = null;
  let focus: HTMLElement | null = null;
  let selected: HTMLElement | null = null;
  let selectedFocused: HTMLElement | null = null;

  for (const item of items) {
    const content = item.querySelector("[data-item-section='content']");
    const fileName = content?.textContent?.trim();
    if (fileName === STATE_FILE_NAMES.hover) {
      hover = item;
    } else if (fileName === STATE_FILE_NAMES.focus) {
      focus = item;
    } else if (fileName === STATE_FILE_NAMES.selected) {
      selected = item;
    } else if (fileName === STATE_FILE_NAMES.selectedFocused) {
      selectedFocused = item;
    }

    if (
      hover != null &&
      focus != null &&
      selected != null &&
      selectedFocused != null
    ) {
      break;
    }
  }

  return { hover, focus, selected, selectedFocused };
}

function applyStatePreview(root: ShadowRoot): boolean {
  const { hover, focus, selected, selectedFocused } =
    findStatePreviewItems(root);

  if (
    hover == null ||
    focus == null ||
    selected == null ||
    selectedFocused == null
  ) {
    return false;
  }

  hover.style.setProperty('background-color', 'var(--trees-bg-muted)');
  focus.setAttribute('data-item-focused', 'true');
  selected.setAttribute('data-item-selected', 'true');
  selectedFocused.setAttribute('data-item-selected', 'true');
  selectedFocused.setAttribute('data-item-focused', 'true');

  return true;
}

function clearStatePreview(root: ShadowRoot) {
  const { hover, focus, selected, selectedFocused } =
    findStatePreviewItems(root);

  hover?.style.removeProperty('background-color');
  focus?.removeAttribute('data-item-focused');
  selected?.removeAttribute('data-item-selected');
  selectedFocused?.removeAttribute('data-item-selected');
  selectedFocused?.removeAttribute('data-item-focused');
}

/**
 * Applies forced hover/focus/selected states to specific file items inside a
 * FileTree's shadow DOM. Uses a MutationObserver to re-apply after the tree
 * re-renders internally.
 */
export function useTreeStatePreview(
  ref: RefObject<HTMLDivElement | null>,
  enabled: boolean
) {
  useEffect(() => {
    const host = ref.current?.querySelector('file-tree-container');
    if (host == null) return;
    if (!enabled) {
      if (host.shadowRoot != null) {
        clearStatePreview(host.shadowRoot);
      }
      return;
    }

    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let observer: MutationObserver | undefined;
    let pollDelayMs = INITIAL_POLL_MS;
    let pollAttempts = 0;

    const ensureObserver = (root: ShadowRoot) => {
      if (observer != null) return;
      observer = new MutationObserver(() => {
        applyStatePreview(root);
      });
      observer.observe(root, { childList: true, subtree: true });
    };

    const connect = () => {
      const root = host.shadowRoot;
      if (root == null) {
        pollAttempts += 1;
        if (pollAttempts >= MAX_SHADOW_ROOT_POLL_ATTEMPTS) {
          return;
        }
        pollTimer = setTimeout(connect, pollDelayMs);
        pollDelayMs = Math.min(pollDelayMs * 2, MAX_POLL_MS);
        return;
      }

      applyStatePreview(root);
      ensureObserver(root);
    };
    connect();

    return () => {
      if (pollTimer != null) clearTimeout(pollTimer);
      observer?.disconnect();
      if (host.shadowRoot != null) {
        clearStatePreview(host.shadowRoot);
      }
    };
  }, [ref, enabled]);
}
