export function h<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  props?: {
    style?: string | Partial<CSSStyleDeclaration>;
    dataset?: DOMStringMap | string[] | string;
    children?: (Node | string)[];
  } & Partial<Omit<HTMLElementTagNameMap[K], 'style' | 'dataset' | 'children'>>,
  parent?: Element | ShadowRoot | DocumentFragment
): HTMLElementTagNameMap[K] {
  const { style, dataset, children, ...attrs } = props ?? {};
  const el = document.createElement(tagName);
  Object.assign(el, attrs);
  if (style !== undefined) {
    if (typeof style === 'string') {
      el.style.cssText = style;
    } else {
      Object.assign(el.style, style);
    }
  }
  if (dataset !== undefined) {
    if (typeof dataset === 'string') {
      el.dataset[dataset] = '';
    } else if (Array.isArray(dataset)) {
      dataset.forEach((key) => {
        el.dataset[key] = '';
      });
    } else {
      Object.assign(el.dataset, dataset);
    }
  }
  if (children !== undefined) {
    el.replaceChildren(...children);
  }
  if (parent !== undefined) {
    parent.appendChild(el);
  }
  return el;
}

export function addEventListener<K extends keyof HTMLElementEventMap>(
  el: HTMLElement,
  event: K,
  listener: (this: HTMLElement, evt: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions
): () => void;
export function addEventListener<K extends keyof DocumentEventMap>(
  el: Document,
  event: K,
  listener: (this: Document, evt: DocumentEventMap[K]) => void,
  options?: AddEventListenerOptions
): () => void;
export function addEventListener<K extends keyof WindowEventMap>(
  el: Window,
  event: K,
  listener: (this: Window, evt: WindowEventMap[K]) => void,
  options?: AddEventListenerOptions
): () => void;
export function addEventListener<K extends keyof MediaQueryListEventMap>(
  el: MediaQueryList,
  event: K,
  listener: (this: MediaQueryList, evt: MediaQueryListEventMap[K]) => void,
  options?: AddEventListenerOptions
): () => void;
export function addEventListener(
  el: HTMLElement | Document | ShadowRoot | Window | MediaQueryList,
  event: string,
  listener: EventListener,
  options?: AddEventListenerOptions
) {
  el.addEventListener(event, listener, options);
  return () => el.removeEventListener(event, listener);
}

export function getLineNumberAttr(
  el: HTMLElement,
  key = 'line'
): number | undefined {
  const value = el.dataset[key];
  if (value === undefined) {
    return undefined;
  }
  const lineNumber = parseInt(value, 10);
  if (Number.isNaN(lineNumber)) {
    return undefined;
  }
  return lineNumber;
}

export function clampDomOffset(node: Node, offset: number): number {
  if (node.nodeType === 3) {
    const length = (node as Text).textContent?.length ?? 0;
    return Math.max(0, Math.min(offset, length));
  }
  if (node.nodeType === 1) {
    return Math.max(0, Math.min(offset, node.childNodes.length));
  }
  return 0;
}

export function extend<T extends object>(obj: T, attrs: Partial<T>): T {
  return Object.assign(obj, attrs);
}

// oxlint-disable-next-line typescript/no-explicit-any
export function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;
  return function (this: ThisType<T>, ...args: Parameters<T>) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

export function round(value: number, precision: number = 1000): number {
  return Math.round(value * precision) / precision;
}

export function endsWithLineBreak(text: string): boolean {
  return text.endsWith('\n') || text.endsWith('\r');
}
