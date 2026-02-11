/** @jsxImportSource react */

// ---------------------------------------------------------------------------
// jsdom environment setup – must run BEFORE any React / FileTree imports so
// that every module sees the globals it needs.
// ---------------------------------------------------------------------------

// @ts-expect-error -- no @types/jsdom; only used in tests
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  pretendToBeVisual: true,
});

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  HTMLDivElement: dom.window.HTMLDivElement,
  SVGElement: dom.window.SVGElement,
  navigator: dom.window.navigator,
  Node: dom.window.Node,
  Event: dom.window.Event,
  MutationObserver: dom.window.MutationObserver,
});

// Register the custom element before importing FileTree so the
// web-components.ts side-effect doesn't crash.
const TAG = 'file-tree-container';
class FTC extends (dom.window.HTMLElement as typeof HTMLElement) {
  constructor() {
    super();
    if (this.shadowRoot != null) return;
    this.attachShadow({ mode: 'open' });
  }
}
dom.window.customElements.define(TAG, FTC);
Object.assign(globalThis, { customElements: dom.window.customElements });

// jsdom doesn't support CSSStyleSheet.replaceSync – provide a no-op mock.
class MockCSSStyleSheet {
  cssRules: unknown[] = [];
  replaceSync(_text: string) {}
}
Object.assign(globalThis, { CSSStyleSheet: MockCSSStyleSheet });

// Tell React we're in a test environment so act() doesn't warn.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Imports (after globals are set up)
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  FileTree as FileTreeClass,
  type FileTreeStateConfig,
} from '../src/FileTree';
import { FileTree as FileTreeReact } from '../src/react/FileTree';

// ---------------------------------------------------------------------------
// Spy on FileTree prototype methods so Preact never actually renders (which
// would crash in jsdom with Preact 11 beta) while still letting us verify
// that the React wrapper calls the right methods.
// ---------------------------------------------------------------------------

const renderSpy = spyOn(FileTreeClass.prototype, 'render').mockImplementation(
  () => {}
);
const cleanUpSpy = spyOn(FileTreeClass.prototype, 'cleanUp').mockImplementation(
  () => {}
);
const setExpandedSpy = spyOn(
  FileTreeClass.prototype,
  'setExpandedItems'
).mockImplementation(() => {});
const setSelectedSpy = spyOn(
  FileTreeClass.prototype,
  'setSelectedItems'
).mockImplementation(() => {});
const setCallbacksSpy = spyOn(
  FileTreeClass.prototype,
  'setCallbacks'
).mockImplementation(() => {});

const requireCapturedStateConfig = (
  value: FileTreeStateConfig | null
): FileTreeStateConfig => {
  if (value == null) {
    throw new Error('Expected FileTree stateConfig to be captured');
  }
  return value;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const FILES = ['README.md', 'src/index.ts', 'src/components/Button.tsx'];

describe('React controlled FileTree wrapper', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    renderSpy.mockClear();
    cleanUpSpy.mockClear();
    setExpandedSpy.mockClear();
    setSelectedSpy.mockClear();
    setCallbacksSpy.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  // -- Mount / unmount --

  test('creates FileTree instance and calls render on mount', () => {
    act(() => {
      root.render(<FileTreeReact options={{ files: FILES }} />);
    });

    expect(renderSpy).toHaveBeenCalled();
  });

  test('calls cleanUp on unmount', () => {
    act(() => {
      root.render(<FileTreeReact options={{ files: FILES }} />);
    });

    cleanUpSpy.mockClear();

    act(() => {
      root.unmount();
    });

    expect(cleanUpSpy).toHaveBeenCalled();
  });

  // -- Controlled expandedItems --

  test('calls setExpandedItems when expandedItems prop changes', () => {
    let setExpanded!: (items: string[]) => void;

    function Harness() {
      const [expanded, setter] = useState<string[]>([]);
      setExpanded = setter;
      return (
        <FileTreeReact
          options={{ files: FILES }}
          expandedItems={expanded}
          onExpandedItemsChange={setter}
        />
      );
    }

    act(() => {
      root.render(<Harness />);
    });

    // Clear spies from mount (the initial useEffect fires setExpandedItems([]))
    setExpandedSpy.mockClear();

    act(() => {
      setExpanded(['src']);
    });

    expect(setExpandedSpy).toHaveBeenCalledWith(['src']);
  });

  test('calls setExpandedItems with initial controlled value on mount', () => {
    function Harness() {
      const [expanded, setter] = useState(['src']);
      return (
        <FileTreeReact
          options={{ files: FILES }}
          expandedItems={expanded}
          onExpandedItemsChange={setter}
        />
      );
    }

    act(() => {
      root.render(<Harness />);
    });

    // The useEffect fires on mount with the initial expandedItems
    expect(setExpandedSpy).toHaveBeenCalledWith(['src']);
  });

  // -- Controlled selectedItems --

  test('calls setSelectedItems when selectedItems prop changes', () => {
    let setSelected!: (items: string[]) => void;

    function Harness() {
      const [selected, setter] = useState<string[]>([]);
      setSelected = setter;
      return (
        <FileTreeReact
          options={{ files: FILES }}
          selectedItems={selected}
          onSelectedItemsChange={setter}
        />
      );
    }

    act(() => {
      root.render(<Harness />);
    });

    setSelectedSpy.mockClear();

    act(() => {
      setSelected(['README.md']);
    });

    expect(setSelectedSpy).toHaveBeenCalledWith(['README.md']);
  });

  // -- Callbacks --

  test('calls setCallbacks with onExpandedItemsChange on mount', () => {
    const onExpanded = () => {};
    const onSelected = () => {};

    act(() => {
      root.render(
        <FileTreeReact
          options={{ files: FILES }}
          onExpandedItemsChange={onExpanded}
          onSelectedItemsChange={onSelected}
        />
      );
    });

    expect(setCallbacksSpy).toHaveBeenCalledWith({
      onExpandedItemsChange: onExpanded,
      onSelectedItemsChange: onSelected,
    });
  });

  test('calls setCallbacks when callback props change', () => {
    let setCallback!: (fn: () => void) => void;

    function Harness() {
      const [cb, setCb] = useState<() => void>(() => {});
      setCallback = setCb;
      return (
        <FileTreeReact options={{ files: FILES }} onExpandedItemsChange={cb} />
      );
    }

    act(() => {
      root.render(<Harness />);
    });

    setCallbacksSpy.mockClear();

    const newCb = () => {};
    act(() => {
      setCallback(() => newCb);
    });

    expect(setCallbacksSpy).toHaveBeenCalledWith(
      expect.objectContaining({ onExpandedItemsChange: newCb })
    );
  });

  // -- Structural options change --

  test('recreates FileTree when structural options change', () => {
    let setFiles!: (files: string[]) => void;

    function Harness() {
      const [files, setter] = useState(FILES);
      setFiles = setter;
      return <FileTreeReact options={{ files }} />;
    }

    act(() => {
      root.render(<Harness />);
    });

    // Initial mount should have called render once
    expect(renderSpy).toHaveBeenCalledTimes(1);

    renderSpy.mockClear();
    cleanUpSpy.mockClear();

    // Change files → structural change → should clean up and re-render
    act(() => {
      setFiles(['package.json']);
    });

    expect(cleanUpSpy).toHaveBeenCalled();
    expect(renderSpy).toHaveBeenCalled();
  });

  // -- Initial state passed to constructor --

  test('passes controlled expandedItems as defaultExpandedItems to FileTree constructor', () => {
    let capturedStateConfig: FileTreeStateConfig | null = null;
    renderSpy.mockImplementation(function (this: FileTreeClass) {
      capturedStateConfig = this.stateConfig;
    });

    act(() => {
      root.render(
        <FileTreeReact options={{ files: FILES }} expandedItems={['src']} />
      );
    });

    expect(capturedStateConfig).not.toBeNull();
    const stateConfig = requireCapturedStateConfig(capturedStateConfig);
    expect(stateConfig.defaultExpandedItems).toEqual(['src']);
    // Controlled values should NOT be in stateConfig.expandedItems
    expect(stateConfig.expandedItems).toBeUndefined();

    // Restore spy
    renderSpy.mockImplementation(() => {});
  });

  test('passes controlled selectedItems as defaultSelectedItems to FileTree constructor', () => {
    let capturedStateConfig: FileTreeStateConfig | null = null;
    renderSpy.mockImplementation(function (this: FileTreeClass) {
      capturedStateConfig = this.stateConfig;
    });

    act(() => {
      root.render(
        <FileTreeReact
          options={{ files: FILES }}
          selectedItems={['README.md']}
        />
      );
    });

    expect(capturedStateConfig).not.toBeNull();
    const stateConfig = requireCapturedStateConfig(capturedStateConfig);
    expect(stateConfig.defaultSelectedItems).toEqual(['README.md']);
    expect(stateConfig.selectedItems).toBeUndefined();

    // Restore spy
    renderSpy.mockImplementation(() => {});
  });
});
