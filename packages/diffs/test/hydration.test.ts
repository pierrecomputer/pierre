import { describe, expect, test } from 'bun:test';

import {
  File,
  type FileHydrateProps,
  type FileRenderProps,
} from '../src/components/File';
import {
  FileDiff,
  type FileDiffHydrationProps,
  type FileDiffRenderProps,
} from '../src/components/FileDiff';
import {
  UnresolvedFile,
  type UnresolvedFileHydrationProps,
  type UnresolvedFileRenderProps,
} from '../src/components/UnresolvedFile';
import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import type { Virtualizer } from '../src/components/Virtualizer';
import type { FileContents, FileDiffMetadata } from '../src/types';

function installDomConstructors() {
  class FakeHTMLElement {
    children: FakeHTMLElement[] = [];
    dataset: Record<string, string> = {};
    parentElement?: FakeHTMLElement;
    shadowRoot?: {
      children: FakeHTMLElement[];
      appendChild(element: FakeHTMLElement): void;
    };
    style = {
      properties: new Map<string, string>(),
      setProperty(name: string, value: string) {
        this.properties.set(name, value);
      },
    };

    appendChild(element: FakeHTMLElement): void {
      element.parentElement = this;
      this.children.push(element);
    }

    attachShadow(_options: { mode: 'open' | 'closed' }) {
      this.shadowRoot = createFakeShadowRoot();
      return this.shadowRoot;
    }

    remove(): void {
      if (this.parentElement == null) {
        return;
      }
      const index = this.parentElement.children.indexOf(this);
      if (index >= 0) {
        this.parentElement.children.splice(index, 1);
      }
    }
  }

  function createFakeShadowRoot() {
    const children: FakeHTMLElement[] = [];
    return {
      children,
      appendChild(element: FakeHTMLElement) {
        children.push(element);
      },
    };
  }

  class FakeHTMLPreElement extends FakeHTMLElement {}
  class FakeHTMLStyleElement extends FakeHTMLElement {
    textContent = '';

    hasAttribute(_name: string): boolean {
      return false;
    }
  }
  class FakeSVGElement {}

  const originalValues = {
    document: Reflect.get(globalThis, 'document'),
    HTMLElement: Reflect.get(globalThis, 'HTMLElement'),
    HTMLPreElement: Reflect.get(globalThis, 'HTMLPreElement'),
    HTMLStyleElement: Reflect.get(globalThis, 'HTMLStyleElement'),
    SVGElement: Reflect.get(globalThis, 'SVGElement'),
  };

  Object.assign(globalThis, {
    document: {
      createElement() {
        return new FakeHTMLElement();
      },
    },
    HTMLElement: FakeHTMLElement,
    HTMLPreElement: FakeHTMLPreElement,
    HTMLStyleElement: FakeHTMLStyleElement,
    SVGElement: FakeSVGElement,
  });

  return {
    cleanup() {
      for (const [key, value] of Object.entries(originalValues)) {
        if (value === undefined) {
          Reflect.deleteProperty(globalThis, key);
        } else {
          Object.assign(globalThis, { [key]: value });
        }
      }
    },
    createHydrationContainer({ header = true } = {}) {
      const container = new FakeHTMLElement();
      container.shadowRoot = createFakeShadowRoot();
      if (header) {
        const headerElement = new FakeHTMLElement();
        headerElement.dataset.diffsHeader = '';
        container.shadowRoot.appendChild(headerElement);
      }
      return container as unknown as HTMLElement;
    },
  };
}

class SpyFile extends File {
  renderCalls = 0;

  public override render(_props: FileRenderProps<undefined>): boolean {
    this.renderCalls += 1;
    return true;
  }

  public getHydratedContainer(): HTMLElement | undefined {
    return this.fileContainer;
  }
}

class SpyFileDiff extends FileDiff {
  renderCalls = 0;

  public override render(_props: FileDiffRenderProps<undefined>): boolean {
    this.renderCalls += 1;
    return true;
  }

  public getHydratedContainer(): HTMLElement | undefined {
    return this.fileContainer;
  }
}

class SpyUnresolvedFile extends UnresolvedFile {
  renderCalls = 0;

  public override render(
    _props: UnresolvedFileRenderProps<undefined>
  ): boolean {
    this.renderCalls += 1;
    return true;
  }

  public getHydratedContainer(): HTMLElement | undefined {
    return this.fileContainer;
  }
}

function createVirtualizer() {
  let connectCalls = 0;
  const virtualizer = {
    config: { resizeDebugging: false },
    connect() {
      connectCalls += 1;
      return () => {};
    },
    disconnect() {},
    getOffsetInScrollContainer() {
      return 0;
    },
    getWindowSpecs() {
      return { top: 0, bottom: 0 };
    },
    instanceChanged() {},
    isInstanceVisible() {
      return false;
    },
  } as unknown as Virtualizer;

  return {
    virtualizer,
    get connectCalls() {
      return connectCalls;
    },
  };
}

function getPlaceholderHeight(fileContainer: HTMLElement): string | undefined {
  const placeholder = Array.from(fileContainer.shadowRoot?.children ?? []).find(
    (element) =>
      element instanceof HTMLElement && 'placeholder' in element.dataset
  );
  return (
    placeholder as
      | (HTMLElement & { style: { properties: Map<string, string> } })
      | undefined
  )?.style.properties.get('height');
}

const file: FileContents = {
  name: 'file.ts',
  contents: 'const value = 1;\n',
};

const unresolvedFile: FileContents = {
  name: 'file.ts',
  contents: `const value = 1;
<<<<<<< HEAD
const conflict = 'current';
=======
const conflict = 'incoming';
>>>>>>> branch
`,
};

const fileDiff: FileDiffMetadata = {
  name: 'file.ts',
  type: 'change',
  hunks: [],
  splitLineCount: 0,
  unifiedLineCount: 0,
  isPartial: false,
  deletionLines: [],
  additionLines: [],
};

describe('collapsed hydration', () => {
  test('File does not rerender missing code while collapsed', () => {
    const dom = installDomConstructors();
    try {
      const instance = new SpyFile({ collapsed: true });
      const props: FileHydrateProps<undefined> = {
        file,
        fileContainer: dom.createHydrationContainer(),
      };

      instance.hydrate(props);

      expect(instance.renderCalls).toBe(0);
    } finally {
      dom.cleanup();
    }
  });

  test('File rerenders missing code while expanded', () => {
    const dom = installDomConstructors();
    try {
      const instance = new SpyFile();
      const props: FileHydrateProps<undefined> = {
        file,
        fileContainer: dom.createHydrationContainer(),
      };

      instance.hydrate(props);

      expect(instance.renderCalls).toBe(1);
    } finally {
      dom.cleanup();
    }
  });

  test('File registers empty collapsed hydration container', () => {
    const dom = installDomConstructors();
    try {
      const instance = new SpyFile({
        collapsed: true,
        disableFileHeader: true,
      });
      const fileContainer = dom.createHydrationContainer({ header: false });
      const props: FileHydrateProps<undefined> = {
        file,
        fileContainer,
      };

      instance.hydrate(props);

      expect(instance.renderCalls).toBe(0);
      expect(instance.getHydratedContainer()).toBe(fileContainer);
    } finally {
      dom.cleanup();
    }
  });

  test('VirtualizedFile sets up virtualizer when hydration renders missing code', () => {
    const dom = installDomConstructors();
    try {
      const virtualizerState = createVirtualizer();
      const instance = new VirtualizedFile(
        undefined,
        virtualizerState.virtualizer
      );
      const fileContainer = dom.createHydrationContainer();
      const props: FileHydrateProps<undefined> = {
        file,
        fileContainer,
      };

      instance.hydrate(props);

      expect(virtualizerState.connectCalls).toBe(1);
      expect(getPlaceholderHeight(fileContainer)).not.toBe('0px');
    } finally {
      dom.cleanup();
    }
  });

  test('FileDiff does not rerender missing code while collapsed', () => {
    const dom = installDomConstructors();
    try {
      const instance = new SpyFileDiff({ collapsed: true });
      const props: FileDiffHydrationProps<undefined> = {
        fileDiff,
        oldFile: file,
        newFile: file,
        fileContainer: dom.createHydrationContainer(),
      };

      instance.hydrate(props);

      expect(instance.renderCalls).toBe(0);
    } finally {
      dom.cleanup();
    }
  });

  test('FileDiff rerenders missing code while expanded', () => {
    const dom = installDomConstructors();
    try {
      const instance = new SpyFileDiff();
      const props: FileDiffHydrationProps<undefined> = {
        fileDiff,
        oldFile: file,
        newFile: file,
        fileContainer: dom.createHydrationContainer(),
      };

      instance.hydrate(props);

      expect(instance.renderCalls).toBe(1);
    } finally {
      dom.cleanup();
    }
  });

  test('FileDiff registers empty collapsed hydration container', () => {
    const dom = installDomConstructors();
    try {
      const instance = new SpyFileDiff({
        collapsed: true,
        disableFileHeader: true,
      });
      const fileContainer = dom.createHydrationContainer({ header: false });
      const props: FileDiffHydrationProps<undefined> = {
        fileDiff,
        oldFile: file,
        newFile: file,
        fileContainer,
      };

      instance.hydrate(props);

      expect(instance.renderCalls).toBe(0);
      expect(instance.getHydratedContainer()).toBe(fileContainer);
    } finally {
      dom.cleanup();
    }
  });

  test('VirtualizedFileDiff sets up virtualizer when hydration renders missing code', () => {
    const dom = installDomConstructors();
    try {
      const virtualizerState = createVirtualizer();
      const instance = new VirtualizedFileDiff(
        undefined,
        virtualizerState.virtualizer
      );
      const fileContainer = dom.createHydrationContainer();
      const props: FileDiffHydrationProps<undefined> = {
        oldFile: file,
        newFile: {
          ...file,
          contents: 'const value = 2;\n',
        },
        fileContainer,
      };

      instance.hydrate(props);

      expect(virtualizerState.connectCalls).toBe(1);
      expect(getPlaceholderHeight(fileContainer)).not.toBe('0px');
    } finally {
      dom.cleanup();
    }
  });

  test('UnresolvedFile does not rerender missing code while collapsed', () => {
    const dom = installDomConstructors();
    try {
      let actionRenderCalls = 0;
      const instance = new SpyUnresolvedFile({
        collapsed: true,
        mergeConflictActionsType() {
          actionRenderCalls += 1;
          return undefined;
        },
      });
      const props: UnresolvedFileHydrationProps<undefined> = {
        file: unresolvedFile,
        fileContainer: dom.createHydrationContainer(),
      };

      instance.hydrate(props);

      expect(instance.renderCalls).toBe(0);
      expect(actionRenderCalls).toBe(0);
    } finally {
      dom.cleanup();
    }
  });

  test('UnresolvedFile rerenders missing code while expanded', () => {
    const dom = installDomConstructors();
    try {
      const instance = new SpyUnresolvedFile();
      const props: UnresolvedFileHydrationProps<undefined> = {
        file: unresolvedFile,
        fileContainer: dom.createHydrationContainer(),
      };

      instance.hydrate(props);

      expect(instance.renderCalls).toBe(1);
    } finally {
      dom.cleanup();
    }
  });

  test('UnresolvedFile rerenders missing header while collapsed', () => {
    const dom = installDomConstructors();
    try {
      const instance = new SpyUnresolvedFile({ collapsed: true });
      const props: UnresolvedFileHydrationProps<undefined> = {
        file: unresolvedFile,
        fileContainer: dom.createHydrationContainer({ header: false }),
      };

      instance.hydrate(props);

      expect(instance.renderCalls).toBe(1);
    } finally {
      dom.cleanup();
    }
  });

  test('UnresolvedFile registers empty collapsed hydration container', () => {
    const dom = installDomConstructors();
    try {
      let actionRenderCalls = 0;
      const instance = new SpyUnresolvedFile({
        collapsed: true,
        disableFileHeader: true,
        mergeConflictActionsType() {
          actionRenderCalls += 1;
          return undefined;
        },
      });
      const fileContainer = dom.createHydrationContainer({ header: false });
      const props: UnresolvedFileHydrationProps<undefined> = {
        file: unresolvedFile,
        fileContainer,
      };

      instance.hydrate(props);

      expect(instance.renderCalls).toBe(0);
      expect(actionRenderCalls).toBe(0);
      expect(instance.getHydratedContainer()).toBe(fileContainer);
    } finally {
      dom.cleanup();
    }
  });
});
