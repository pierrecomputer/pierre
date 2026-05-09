import { afterEach, describe, expect, test } from 'bun:test';

import { DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY } from '../src/constants';
import {
  patchScrollbarGutterSize,
  wrapThemeCSS,
} from '../src/utils/cssWrappers';
import {
  getMeasuredScrollbarGutter,
  resetMeasuredScrollbarGutterForTests,
} from '../src/utils/scrollbarGutter';

class FakeHTMLElement {
  attributes = new Map<string, string>();
  children: FakeHTMLElement[] = [];
  isConnected = true;
  parentElement?: FakeHTMLElement | FakeShadowRoot;
  style = {
    properties: new Map<string, string>(),
    position: '',
    width: '',
    setProperty(name: string, value: string) {
      this.properties.set(name, value);
    },
  };
  textContent = '';
  offsetHeight = currentOffsetHeight;
  clientHeight = currentClientHeight;

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  appendChild(element: FakeHTMLElement): void {
    element.parentElement = this;
    this.children.push(element);
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

class FakeShadowRoot {
  children: FakeHTMLElement[] = [];

  constructor(public host = new FakeHTMLElement()) {}

  appendChild(element: FakeHTMLElement): void {
    element.parentElement = this;
    this.children.push(element);
  }
}

let currentOffsetHeight = 106;
let currentClientHeight = 100;

const originalValues = {
  document: Reflect.get(globalThis, 'document'),
  HTMLElement: Reflect.get(globalThis, 'HTMLElement'),
};

function installDomConstructors(): void {
  Object.assign(globalThis, {
    document: {
      createElement() {
        return new FakeHTMLElement();
      },
    },
    HTMLElement: FakeHTMLElement,
  });
}

function restoreDomConstructors(): void {
  for (const [key, value] of Object.entries(originalValues)) {
    if (value === undefined) {
      Reflect.deleteProperty(globalThis, key);
    } else {
      Object.assign(globalThis, { [key]: value });
    }
  }
}

afterEach(() => {
  resetMeasuredScrollbarGutterForTests();
  restoreDomConstructors();
  currentOffsetHeight = 106;
  currentClientHeight = 100;
});

describe('getMeasuredScrollbarGutter', () => {
  test('measures with a temporary code probe without mutating host styles', () => {
    installDomConstructors();
    const host = new FakeHTMLElement();
    const shadowRoot = new FakeShadowRoot(host);

    expect(
      getMeasuredScrollbarGutter(shadowRoot as unknown as ShadowRoot)
    ).toBe(6);
    expect(shadowRoot.children.length).toBe(0);
    expect(host.style.properties.size).toBe(0);
  });

  test('reuses the global page measurement for later shadow roots', () => {
    installDomConstructors();
    const firstShadowRoot = new FakeShadowRoot();
    expect(
      getMeasuredScrollbarGutter(firstShadowRoot as unknown as ShadowRoot)
    ).toBe(6);

    currentOffsetHeight = 120;
    currentClientHeight = 100;
    const secondShadowRoot = new FakeShadowRoot();
    expect(
      getMeasuredScrollbarGutter(secondShadowRoot as unknown as ShadowRoot)
    ).toBe(6);
    expect(secondShadowRoot.children.length).toBe(0);
  });

  test('does not cache a measurement from a disconnected host', () => {
    installDomConstructors();
    const disconnectedHost = new FakeHTMLElement();
    disconnectedHost.isConnected = false;
    expect(
      getMeasuredScrollbarGutter(
        new FakeShadowRoot(disconnectedHost) as unknown as ShadowRoot
      )
    ).toBeUndefined();

    currentOffsetHeight = 120;
    expect(
      getMeasuredScrollbarGutter(new FakeShadowRoot() as unknown as ShadowRoot)
    ).toBe(20);
  });
});

describe('theme CSS scrollbar gutter helpers', () => {
  test('wrapThemeCSS predefines the measured gutter with the fallback value', () => {
    expect(wrapThemeCSS('--diffs-token: red;', 'dark')).toContain(
      `${DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY}: var(--diffs-scrollbar-gutter-fallback);`
    );
  });

  test('wrapThemeCSS writes the measured gutter into the theme style', () => {
    expect(wrapThemeCSS('--diffs-token: red;', 'dark', 6)).toContain(
      `${DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY}: 6px;`
    );
  });

  test('patchScrollbarGutterSize updates the existing measured gutter declaration', () => {
    const patched = patchScrollbarGutterSize(
      wrapThemeCSS('--diffs-token: red;', 'dark'),
      6
    );
    const updated = patchScrollbarGutterSize(patched, 8);

    expect(updated).toContain(
      `${DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY}: 8px;`
    );
    expect(updated).not.toContain(
      `${DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY}: 6px;`
    );
    expect(
      updated.match(new RegExp(DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY, 'g'))
        ?.length
    ).toBe(1);
  });
});
