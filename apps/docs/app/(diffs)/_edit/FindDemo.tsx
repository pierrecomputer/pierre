'use client';

import { Editor } from '@pierre/diffs/editor';
import { EditorProvider, File } from '@pierre/diffs/react';
import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useEffect, useMemo, useRef } from 'react';

import { FIND_DEMO_SEARCH_QUERY } from './constants';

interface FindDemoProps {
  // Server-preloaded, highlighted File; hydrating from it avoids a highlight flash on load.
  prerenderedFile: PreloadedFileResult<undefined>;
}

const SEARCH_QUERY = FIND_DEMO_SEARCH_QUERY;

// Custom element the File renders into; its shadow DOM is open, so we can reach in.
const DIFFS_TAG_NAME = 'diffs-container';

function detectMac(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ??
    navigator.platform ??
    '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

// Demo of the editor's find overlay. With no public API to open the search
// panel, we do what a user does: dispatch Cmd/Ctrl-F, then type a query into
// the panel input. We poll for the content element (it attaches async after the
// File hydrates) and only start once the section is on screen so opening the
// panel doesn't yank the page on load.
export function FindDemo({ prerenderedFile }: FindDemoProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editor = useMemo(() => new Editor({}), []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (wrapper == null) {
      return;
    }

    const isMac = detectMac();
    let cancelled = false;
    let timer: number | undefined;
    let attempts = 0;

    const getShadow = (): ShadowRoot | null => {
      const host = wrapper.querySelector<HTMLElement>(DIFFS_TAG_NAME);
      return host?.shadowRoot ?? null;
    };

    // Open the find panel via the real keyboard shortcut on the content element.
    const openPanel = (shadow: ShadowRoot) => {
      const content = shadow.querySelector<HTMLElement>('[data-content]');
      if (content == null) {
        return;
      }
      content.focus({ preventScroll: true });
      content.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'f',
          bubbles: true,
          cancelable: true,
          composed: true,
          metaKey: isMac,
          ctrlKey: !isMac,
        })
      );
    };

    // Type the query into the open panel, mirroring a user typing. The editor
    // selects and scrolls to the first match on input, so the panel lands on
    // "1 of N" with the input focused. Returns true once the input is found.
    const fillPanel = (shadow: ShadowRoot): boolean => {
      const input = shadow.querySelector<HTMLInputElement>('[data-search]');
      if (input == null) {
        return false;
      }
      input.focus();
      input.value = SEARCH_QUERY;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    };

    const tick = () => {
      if (cancelled) {
        return;
      }
      attempts += 1;
      const shadow = getShadow();
      if (shadow != null) {
        if (shadow.querySelector('[data-search-panel]') != null) {
          if (fillPanel(shadow)) {
            return;
          }
        } else {
          openPanel(shadow);
        }
      }
      if (attempts < 120) {
        timer = window.setTimeout(tick, 50);
      }
    };

    // Defer until the demo is on screen so focusing the panel input doesn't
    // scroll the page on first load.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          tick();
        }
      },
      { threshold: 0.4 }
    );
    observer.observe(wrapper);

    return () => {
      cancelled = true;
      observer.disconnect();
      if (timer != null) {
        window.clearTimeout(timer);
      }
    };
  }, [editor]);

  return (
    <div className="not-prose" ref={wrapperRef}>
      <EditorProvider editor={editor}>
        <File
          {...prerenderedFile}
          className="diff-container max-h-[420px] overflow-auto"
          contentEditable
        />
      </EditorProvider>
    </div>
  );
}
