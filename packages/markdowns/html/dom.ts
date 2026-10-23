import { createHtmlRenderer } from './render';
import type { AnimateOptions, HtmlOptions } from './types';

const isFade = (node: Node): node is HTMLElement =>
  node.nodeType === 1 &&
  (node as Element).getAttribute('data-markdown') === 'token';
const isText = (node: Node): boolean => node.nodeType === 3 || isFade(node);
const passiveText =
  '[data-markdown="token"], [data-markdown="code-header"], [data-markdown="line-numbers"], [data-markdown="caret"]';

/** Only live fades keep records. Settled output is native DOM text, with no leaf state. */
function createFades(root: HTMLElement) {
  const pending = new Map<HTMLElement, number>();
  const document = root.ownerDocument;
  const query = document.defaultView?.matchMedia?.(
    '(prefers-reduced-motion: reduce)'
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timerDeadline = Infinity;
  let requested = false;
  let duration = 180;
  const enabled = (): boolean =>
    requested && duration > 0 && query?.matches !== true;
  const arm = (next: number): void => {
    if (Number.isFinite(next) && timer !== undefined && next >= timerDeadline)
      return;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    timerDeadline = next;
    if (Number.isFinite(next))
      timer = setTimeout(() => flush(), Math.max(0, next - performance.now()));
  };
  const flush = (all = false): void => {
    timer = undefined;
    timerDeadline = Infinity;
    const now = performance.now();
    const parents = new Set<Node>();
    let next = Infinity;
    for (const [span, deadline] of pending) {
      if (!all && deadline > now) {
        next = Math.min(next, deadline);
        continue;
      }
      const parent = span.parentNode;
      pending.delete(span);
      if (parent !== null && root.contains(span)) {
        while (span.firstChild !== null)
          parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
        parents.add(parent);
      }
    }
    for (const parent of parents) parent.normalize();
    arm(next);
  };
  const stop = (): void => {
    arm(Infinity);
    if (pending.size > 0) flush(true);
  };
  const motionChanged = (): void => {
    if (query?.matches === true) stop();
  };
  const animate = (text: Text): void => {
    if (!enabled() || text.data.trim() === '' || text.parentElement === null)
      return;
    // Fenced HTML ends each open line with a newline. Keep that terminator
    // outside the delivery span so the next chunk can extend the same line.
    if (
      text.data.endsWith('\n') &&
      text.data.length > 1 &&
      text.parentElement.closest('pre code') !== null
    )
      text.splitText(text.data.length - 1);
    if (text.parentElement.closest(passiveText) !== null) return;
    const span = document.createElement('span');
    span.dataset.markdown = 'token';
    span.dataset.animated = 'true';
    span.style.animationDuration = `${duration}ms`;
    text.replaceWith(span);
    span.append(text);
    pending.set(span, performance.now() + duration);
  };
  return {
    connect(): void {
      query?.addEventListener('change', motionChanged);
    },
    disconnect(): void {
      stop();
      query?.removeEventListener('change', motionChanged);
    },
    // Prune and schedule once after the whole DOM patch, rather than per text run.
    finish(): void {
      let next = Infinity;
      for (const [span, deadline] of pending) {
        if (!root.contains(span)) pending.delete(span);
        else next = Math.min(next, deadline);
      }
      arm(next);
    },
    update(active: boolean, options: boolean | AnimateOptions): void {
      requested = active && options !== false;
      const value =
        typeof options === 'object' ? (options.duration ?? 180) : 180;
      duration = Number.isFinite(value) ? Math.max(0, value) : 180;
      if (!enabled()) stop();
    },
    tree(node: Node): void {
      if (!enabled()) return;
      if (node.nodeType === 3) animate(node as Text);
      else {
        const walker = document.createTreeWalker(node, 4);
        let text = walker.nextNode();
        while (text !== null) {
          const next = walker.nextNode();
          animate(text as Text);
          text = next;
        }
      }
    },
    append(parent: Node, value: string, before: Node | null): void {
      const previous = before?.previousSibling ?? parent.lastChild;
      const animateHere =
        enabled() &&
        value.trim() !== '' &&
        parent.nodeType === 1 &&
        (parent as Element).closest(passiveText) === null;
      if (!animateHere && previous?.nodeType === 3) {
        (previous as Text).appendData(value);
        return;
      }
      const text = document.createTextNode(value);
      parent.insertBefore(text, before);
      animate(text);
    },
  };
}

type Fades = ReturnType<typeof createFades>;

/** Reconcile native nodes in the mutable suffix; fade spans are transparent text runs. */
function patchChildren(
  parent: Node,
  incoming: Node,
  first: Node | null,
  fades: Fades,
  committed = -1
): Node | null {
  let current = first;
  let target = incoming.firstChild;
  let index = 0;
  let firstPending: Node | null = null;
  while (target !== null) {
    const nextTarget = target.nextSibling;
    let actual: Node;
    if (target.nodeType === 3) {
      const value = target.nodeValue ?? '';
      let previous = '';
      let end = current;
      while (end !== null && isText(end)) {
        previous += end.textContent ?? '';
        end = end.nextSibling;
      }
      const lineAppend =
        previous.endsWith('\n') &&
        value.endsWith('\n') &&
        value.slice(0, -1).startsWith(previous.slice(0, -1));
      if (current !== end && (value.startsWith(previous) || lineAppend)) {
        actual = current!;
        const suffix = lineAppend
          ? value.slice(previous.length - 1, -1)
          : value.slice(previous.length);
        if (suffix !== '') {
          let before = end;
          if (lineAppend) {
            const last = end?.previousSibling ?? parent.lastChild;
            if (last?.nodeType === 3)
              before =
                (last as Text).data.length === 1
                  ? last
                  : (last as Text).splitText((last as Text).data.length - 1);
          }
          fades.append(parent, suffix, before);
        }
      } else {
        while (current !== end) {
          const next = current!.nextSibling;
          parent.removeChild(current!);
          current = next;
        }
        actual = target;
        parent.insertBefore(target, end);
        // Replacement edits do not replay existing text as an entrance effect.
        if (previous === '') {
          fades.tree(target);
          actual = target.parentNode === parent ? target : target.parentNode!;
        }
      }
      current = end;
    } else if (
      current?.nodeType === 1 &&
      target.nodeType === 1 &&
      (current as Element).tagName === (target as Element).tagName &&
      !isFade(current)
    ) {
      actual = current;
      const element = current as Element;
      const wanted = target as Element;
      for (let at = element.attributes.length - 1; at >= 0; at--) {
        const attribute = element.attributes[at];
        if (!wanted.hasAttribute(attribute.name))
          element.removeAttribute(attribute.name);
      }
      for (const attribute of wanted.attributes)
        if (element.getAttribute(attribute.name) !== attribute.value)
          element.setAttribute(attribute.name, attribute.value);
      patchChildren(element, wanted, element.firstChild, fades);
      current = element.nextSibling;
    } else {
      actual = target;
      const next = current?.nextSibling ?? null;
      parent.insertBefore(target, current);
      if (current !== null) parent.removeChild(current);
      fades.tree(target);
      current = next;
    }
    if (index === committed) firstPending = actual;
    index++;
    target = nextTarget;
  }
  while (current !== null) {
    const next = current.nextSibling;
    parent.removeChild(current);
    current = next;
  }
  return firstPending;
}

/** Own an opaque HTML region. React or another framework only supplies source and options. */
export function createDomRenderer(
  root: HTMLElement,
  options: HtmlOptions = {},
  formatter = createHtmlRenderer(options)
) {
  const document = root.ownerDocument;
  const checkpoint = document.createComment('markdown');
  const template = document.createElement('template');
  const fades = createFades(root);
  let stable = '';
  let previousPending: string | undefined;
  let initialized = false;
  root.dataset.markdown = 'root';
  root.insertBefore(checkpoint, root.firstChild);

  const click = (event: Event): void => {
    const target = event.target as Element | null;
    const button = target?.closest<HTMLButtonElement>(
      'button[data-code-action]'
    );
    if (button == null || button.disabled || !root.contains(button)) return;
    const block = button.closest('[data-markdown="code-block"]');
    const code = block?.querySelector('pre code')?.textContent ?? '';
    if (button.dataset.codeAction === 'copy') {
      void document.defaultView?.navigator.clipboard
        ?.writeText(code)
        .then(() => {
          button.textContent = 'Copied';
        })
        .catch(() => {
          button.textContent = 'Copy';
        });
    } else {
      const url = URL.createObjectURL(
        new Blob([code], { type: 'text/plain;charset=utf-8' })
      );
      const link = document.createElement('a');
      link.href = url;
      const language = block?.getAttribute('data-language') ?? 'txt';
      link.download = `code.${/^[a-z0-9]+$/i.test(language) ? language : 'txt'}`;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  return {
    connect(): void {
      fades.connect();
      root.addEventListener('click', click);
    },
    disconnect(): void {
      fades.disconnect();
      formatter.dispose();
      root.removeEventListener('click', click);
    },
    configure(next: HtmlOptions): void {
      const keys = new Set([...Object.keys(options), ...Object.keys(next)]);
      if (
        [...keys].every(
          (key) =>
            options[key as keyof HtmlOptions] === next[key as keyof HtmlOptions]
        )
      )
        return;
      formatter.configure(next);
      options = next;
      stable = '';
    },
    update(
      source: string,
      incomplete: boolean,
      active = false,
      animated: boolean | AnimateOptions = false,
      caret?: 'block' | 'circle'
    ): void {
      root.toggleAttribute('data-streaming', active);
      fades.update(active, animated);
      const update = formatter.render(source, incomplete, active);
      const pending =
        update.pending +
        (active && caret !== undefined
          ? `<span data-markdown="caret" data-shape="${caret}" aria-hidden="true">${caret === 'block' ? '▍' : '●'}</span>`
          : '');
      if (
        !update.reset &&
        update.stable === stable &&
        pending === previousPending
      )
        return;
      if (update.reset || !update.stable.startsWith(stable)) {
        stable = '';
        if (checkpoint.parentNode !== null) root.removeChild(checkpoint);
        root.insertBefore(checkpoint, root.firstChild);
      }
      template.innerHTML = update.stable.slice(stable.length);
      const fragment = template.content;
      const count = fragment.childNodes.length;
      const tail = document.createElement('template');
      tail.innerHTML = pending;
      fragment.append(tail.content);
      const firstPending = patchChildren(
        root,
        fragment,
        checkpoint.nextSibling,
        fades,
        count
      );
      if (checkpoint.nextSibling !== firstPending)
        root.insertBefore(checkpoint, firstPending);
      stable = update.stable;
      previousPending = pending;
      if (!initialized) {
        initialized = true;
        fades.tree(root);
      }
      fades.finish();
    },
  };
}
