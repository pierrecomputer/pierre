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

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import { useMemo, useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

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
const setFilesSpy = spyOn(
  FileTreeClass.prototype,
  'setFiles'
).mockImplementation(() => {});

const resetMethodMocks = (): void => {
  renderSpy.mockImplementation(() => {});
  cleanUpSpy.mockImplementation(() => {});
  setExpandedSpy.mockImplementation(() => {});
  setSelectedSpy.mockImplementation(() => {});
  setCallbacksSpy.mockImplementation(() => {});
  setFilesSpy.mockImplementation(() => {});
};

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
    resetMethodMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    renderSpy.mockClear();
    cleanUpSpy.mockClear();
    setExpandedSpy.mockClear();
    setSelectedSpy.mockClear();
    setCallbacksSpy.mockClear();
    setFilesSpy.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  afterAll(() => {
    renderSpy.mockRestore();
    cleanUpSpy.mockRestore();
    setExpandedSpy.mockRestore();
    setSelectedSpy.mockRestore();
    setCallbacksSpy.mockRestore();
    setFilesSpy.mockRestore();
  });

  // -- Mount / unmount --

  test('creates FileTree instance and calls render on mount', () => {
    act(() => {
      root.render(<FileTreeReact options={{}} files={FILES} />);
    });

    expect(renderSpy).toHaveBeenCalled();
  });

  test('calls cleanUp on unmount', () => {
    act(() => {
      root.render(<FileTreeReact options={{}} files={FILES} />);
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
          options={{}}
          files={FILES}
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
          options={{}}
          files={FILES}
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
          options={{}}
          files={FILES}
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
          options={{}}
          files={FILES}
          onExpandedItemsChange={onExpanded}
          onSelectedItemsChange={onSelected}
        />
      );
    });

    expect(setCallbacksSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        onExpandedItemsChange: onExpanded,
        onSelectedItemsChange: onSelected,
      })
    );
  });

  test('calls setCallbacks when callback props change', () => {
    let setCallback!: (fn: () => void) => void;

    function Harness() {
      const [cb, setCb] = useState<() => void>(() => {});
      setCallback = setCb;
      return (
        <FileTreeReact options={{}} files={FILES} onExpandedItemsChange={cb} />
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
    let setFlatten!: (v: boolean) => void;

    function Harness() {
      const [flatten, setter] = useState(false);
      setFlatten = setter;
      return (
        <FileTreeReact
          options={{ flattenEmptyDirectories: flatten }}
          files={FILES}
        />
      );
    }

    act(() => {
      root.render(<Harness />);
    });

    // Initial mount should have called render once
    expect(renderSpy).toHaveBeenCalledTimes(1);

    renderSpy.mockClear();
    cleanUpSpy.mockClear();

    // Change flattenEmptyDirectories → structural change → should clean up and re-render
    act(() => {
      setFlatten(true);
    });

    expect(cleanUpSpy).toHaveBeenCalled();
    expect(renderSpy).toHaveBeenCalled();
  });

  // -- Initial state passed to constructor --

  test('passes controlled expandedItems as initialExpandedItems to FileTree constructor', () => {
    let capturedStateConfig: FileTreeStateConfig | null = null;
    renderSpy.mockImplementation(function (this: FileTreeClass) {
      capturedStateConfig = this.stateConfig;
    });

    act(() => {
      root.render(
        <FileTreeReact options={{}} files={FILES} expandedItems={['src']} />
      );
    });

    expect(capturedStateConfig).not.toBeNull();
    const stateConfig = requireCapturedStateConfig(capturedStateConfig);
    expect(stateConfig.initialExpandedItems).toEqual(['src']);
    // Controlled values should NOT be in stateConfig.expandedItems
    expect(stateConfig.expandedItems).toBeUndefined();

    // Restore spy
    renderSpy.mockImplementation(() => {});
  });

  test('passes controlled selectedItems as initialSelectedItems to FileTree constructor', () => {
    let capturedStateConfig: FileTreeStateConfig | null = null;
    renderSpy.mockImplementation(function (this: FileTreeClass) {
      capturedStateConfig = this.stateConfig;
    });

    act(() => {
      root.render(
        <FileTreeReact
          options={{}}
          files={FILES}
          selectedItems={['README.md']}
        />
      );
    });

    expect(capturedStateConfig).not.toBeNull();
    const stateConfig = requireCapturedStateConfig(capturedStateConfig);
    expect(stateConfig.initialSelectedItems).toEqual(['README.md']);
    expect(stateConfig.selectedItems).toBeUndefined();

    // Restore spy
    renderSpy.mockImplementation(() => {});
  });

  // -- Controlled files --

  test('calls setFiles when files prop changes', () => {
    let setFiles!: (files: string[]) => void;

    function Harness() {
      const [files, setter] = useState(FILES);
      setFiles = setter;
      const stableOptions = useMemo(() => ({}), []);
      return <FileTreeReact options={stableOptions} files={files} />;
    }

    act(() => {
      root.render(<Harness />);
    });

    // Clear spies from mount (the initial useEffect fires setFiles)
    setFilesSpy.mockClear();

    const newFiles = ['package.json'];
    act(() => {
      setFiles(newFiles);
    });

    expect(setFilesSpy).toHaveBeenCalledWith(newFiles);
  });

  test('does NOT recreate FileTree when files prop changes', () => {
    let setFiles!: (files: string[]) => void;

    function Harness() {
      const [files, setter] = useState(FILES);
      setFiles = setter;
      const stableOptions = useMemo(() => ({}), []);
      return <FileTreeReact options={stableOptions} files={files} />;
    }

    act(() => {
      root.render(<Harness />);
    });

    cleanUpSpy.mockClear();
    setFilesSpy.mockClear();

    act(() => {
      setFiles(['package.json']);
    });

    // Should NOT recreate the instance — only setFiles should be called
    expect(cleanUpSpy).not.toHaveBeenCalled();
    expect(setFilesSpy).toHaveBeenCalled();
  });

  test('passes initialFiles to constructor from files prop', () => {
    let capturedOptions: FileTreeClass['options'] | null = null;
    renderSpy.mockImplementation(function (this: FileTreeClass) {
      capturedOptions = this.options;
    });

    act(() => {
      root.render(<FileTreeReact options={{}} files={FILES} />);
    });

    expect(capturedOptions).not.toBeNull();
    expect(capturedOptions!.initialFiles).toEqual(FILES);

    // Restore spy
    renderSpy.mockImplementation(() => {});
  });

  test('passes onFilesChange callback via setCallbacks', () => {
    const onFilesChange = () => {};

    act(() => {
      root.render(
        <FileTreeReact
          options={{}}
          files={FILES}
          onFilesChange={onFilesChange}
        />
      );
    });

    expect(setCallbacksSpy).toHaveBeenCalledWith(
      expect.objectContaining({ onFilesChange })
    );
  });

  // -- Context menu --

  test('passes context menu callbacks via setCallbacks when renderContextMenu is provided', () => {
    const renderCtx = () => null;

    act(() => {
      root.render(
        <FileTreeReact
          options={{}}
          files={FILES}
          renderContextMenu={renderCtx}
        />
      );
    });

    // When renderContextMenu is provided, onContextMenuOpen and onContextMenuClose
    // should be wired through setCallbacks
    expect(setCallbacksSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        onContextMenuOpen: expect.any(Function),
        onContextMenuClose: expect.any(Function),
      })
    );
  });

  test('does NOT pass context menu callbacks when renderContextMenu is not provided', () => {
    act(() => {
      root.render(<FileTreeReact options={{}} files={FILES} />);
    });

    // Without renderContextMenu, context menu callbacks should be undefined
    const lastCall = setCallbacksSpy.mock.calls.at(-1)?.[0];
    expect(lastCall?.onContextMenuOpen).toBeUndefined();
    expect(lastCall?.onContextMenuClose).toBeUndefined();
  });

  test('passes onContextMenuOpen callback without renderContextMenu', () => {
    const onContextMenuOpen = () => {};

    act(() => {
      root.render(
        <FileTreeReact
          options={{}}
          files={FILES}
          onContextMenuOpen={onContextMenuOpen}
        />
      );
    });

    expect(setCallbacksSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        onContextMenuOpen: expect.any(Function),
      })
    );
  });

  test('server-renders a slotted header child when header is provided', () => {
    const originalWindow = globalThis.window;
    Reflect.deleteProperty(globalThis, 'window');

    try {
      const html = renderToString(
        <FileTreeReact
          options={{}}
          initialFiles={FILES}
          prerenderedHTML={'<div data-file-tree-id="ft_srv_test"></div>'}
          header={<button data-test-header>Header action</button>}
        />
      );

      expect(html).toContain('slot="header"');
      expect(html).toContain('data-test-header');
      expect(html).toContain('Header action');
    } finally {
      Object.assign(globalThis, { window: originalWindow });
    }
  });

  test('renders slot div as child when renderContextMenu callback fires', () => {
    let capturedOpen:
      | ((
          item: { path: string; isFolder: boolean },
          context: {
            anchorElement: HTMLElement;
            anchorRect: {
              top: number;
              right: number;
              bottom: number;
              left: number;
              width: number;
              height: number;
              x: number;
              y: number;
            };
            close: () => void;
          }
        ) => void)
      | undefined;
    renderSpy.mockImplementation(function (this: FileTreeClass) {
      // Capture the onContextMenuOpen callback from stateConfig
      capturedOpen = this.callbacksRef.current.onContextMenuOpen;
    });

    act(() => {
      root.render(
        <FileTreeReact
          options={{}}
          files={FILES}
          renderContextMenu={(item) => <div data-test-menu>{item.path}</div>}
        />
      );
    });

    // After setCallbacks fires, grab the latest callback
    const lastSetCallbacksCall = setCallbacksSpy.mock.calls.at(-1)?.[0];
    const onOpen = capturedOpen ?? lastSetCallbacksCall?.onContextMenuOpen;

    if (onOpen != null) {
      act(() => {
        onOpen(
          { path: 'README.md', isFolder: false },
          {
            anchorElement: container,
            anchorRect: {
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              width: 0,
              height: 0,
              x: 0,
              y: 0,
            },
            close: () => {},
          }
        );
      });
    }

    // The container should now have a child with slot="context-menu"
    const slotEl = container.querySelector('[slot="context-menu"]');
    expect(slotEl).not.toBeNull();
    expect(slotEl?.querySelector('[data-test-menu]')).not.toBeNull();

    renderSpy.mockImplementation(() => {});
  });

  test('renders and clears slotted header content in containerId mode', () => {
    const host = document.createElement('file-tree-container');
    host.id = 'existing-file-tree';
    document.body.appendChild(host);

    try {
      act(() => {
        root.render(
          <FileTreeReact
            options={{}}
            files={FILES}
            containerId={host.id}
            header={<button data-test-header>Header action</button>}
          />
        );
      });

      const slotEl = host.querySelector('[slot="header"]');
      expect(slotEl).not.toBeNull();
      expect(slotEl?.querySelector('[data-test-header]')?.textContent).toBe(
        'Header action'
      );

      act(() => {
        root.render(
          <FileTreeReact options={{}} files={FILES} containerId={host.id} />
        );
      });

      expect(host.querySelector('[slot="header"]')).toBeNull();
    } finally {
      host.remove();
    }
  });
});
