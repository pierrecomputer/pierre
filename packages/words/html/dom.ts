import { createHtmlRenderer } from './render';
import type { AnimateOptions, HtmlOptions, PluginConfig } from './types';

const isFade = (node: Node): node is HTMLElement =>
  node.nodeType === 1 &&
  (node as Element).getAttribute('data-markdown') === 'token';
const isText = (node: Node): boolean => node.nodeType === 3 || isFade(node);
const passiveText =
  '[data-markdown="token"], [data-markdown="code-header"], [data-markdown="line-numbers"], [data-markdown="caret"]';

/** Wrap new text in fade spans, and unwrap each span when its animation ends. */
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
    // An open fence line ends with LF. Keep the LF outside the span, so the
    // next chunk can extend the same line.
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
    // Runs once per DOM patch, not once per text run.
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
      const previous =
        before === null ? parent.lastChild : before.previousSibling;
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

/** Patch `parent` to match `incoming`, and reuse nodes. A fade span counts as text. Returns the node at `committed`. */
function patchChildren(
  parent: Node,
  incoming: Node,
  first: Node | null,
  fades: Fades,
  committed = -1,
  marker?: Comment,
  revising = false
): Node | null {
  // A late definition can change the markup around visible text. Compare with
  // the old text on these full reparses, so existing words do not fade in again.
  const previousText = revising ? (parent.textContent ?? '') : undefined;
  let current = first;
  let target = incoming.firstChild;
  let index = 0;
  let firstPending: Node | null = null;
  while (target !== null) {
    const nextTarget = target.nextSibling;
    let actual: Node;
    if (target === marker) {
      // The marker is always inserted. It never replaces an existing node.
      actual = target;
      parent.insertBefore(target, current);
    } else if (target.nodeType === 3) {
      const value = target.nodeValue ?? '';
      let previous = '';
      let end = current;
      while (end !== null && isText(end)) {
        previous += end.textContent ?? '';
        end = end.nextSibling;
      }
      const append = value.startsWith(previous);
      const lineAppend =
        !append &&
        previous.endsWith('\n') &&
        value.endsWith('\n') &&
        value.slice(0, -1).startsWith(previous.slice(0, -1));
      if (current !== end && (append || lineAppend)) {
        actual = current!;
        const suffix = append
          ? value.slice(previous.length)
          : value.slice(previous.length - 1, -1);
        if (suffix !== '') {
          let before = end;
          if (lineAppend) {
            // Insert before the run's final LF, split out of its text node or fade span.
            let last = end === null ? parent.lastChild : end.previousSibling;
            while (last !== null && last.nodeType === 1) last = last.lastChild;
            if (last !== null) {
              const text = last as Text;
              before =
                text.length === 1 ? text : text.splitText(text.length - 1);
              if (before.parentNode !== parent)
                parent.insertBefore(before, end);
            }
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
        // Text that replaces other text does not fade in.
        if (previous === '') {
          if (
            previousText === undefined ||
            !previousText.includes(target.textContent ?? '')
          )
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
      patchChildren(
        element,
        wanted,
        element.firstChild,
        fades,
        -1,
        marker,
        revising
      );
      current = element.nextSibling;
    } else {
      actual = target;
      const next = current?.nextSibling ?? null;
      parent.insertBefore(target, current);
      if (current !== null) parent.removeChild(current);
      if (
        previousText === undefined ||
        !previousText.includes(target.textContent ?? '')
      )
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

/** Insert a comment before the last code line, so later updates patch only that line. */
function markLastCodeLine(code: Element, trailingNewline: boolean): Comment {
  let before = code.firstChild;
  for (let node = code.lastChild; node !== null; node = node.previousSibling) {
    if (node.nodeType !== 3) continue;
    const text = node as Text;
    let end = text.data.length;
    if (trailingNewline && text.data.endsWith('\n')) {
      end--;
      trailingNewline = false;
    }
    if (end === 0) continue;
    const at = text.data.lastIndexOf('\n', end - 1);
    if (at < 0) continue;
    before =
      at + 1 === text.data.length ? text.nextSibling : text.splitText(at + 1);
    break;
  }
  const marker = code.ownerDocument.createComment('markdown-code');
  code.insertBefore(marker, before);
  return marker;
}

const blockTags =
  /^(?:BLOCKQUOTE|DIV|H[1-6]|LI|OL|P|PRE|SECTION|TABLE|TBODY|TD|TH|THEAD|TR|UL)$/;

/** Compare controls by the buttons they produce, so equal inline objects match. */
const controlFlags = (controls: HtmlOptions['controls']): number => {
  const code = typeof controls === 'object' ? controls.code : controls;
  return code === false
    ? 0
    : typeof code === 'object'
      ? (code.copy === false ? 0 : 1) | (code.download === false ? 0 : 2)
      : 3;
};

/** Render Markdown into `root`, and patch its DOM nodes on each update. */
export function createDomRenderer(
  root: HTMLElement,
  options: HtmlOptions = {},
  formatter = createHtmlRenderer(options)
) {
  const document = root.ownerDocument;
  const checkpoint = document.createComment('markdown');
  const template = document.createElement('template');
  const tail = document.createElement('template');
  const caret = document.createElement('span');
  const fades = createFades(root);
  let revision = 0;
  let initialized = false;
  let previousCaret: 'block' | 'circle' | undefined;
  let codeState:
    | {
        code: Element;
        marker: Comment;
        line: number;
        key: number;
        numbers: Element | null;
        numberCount: number;
      }
    | undefined;
  root.dataset.markdown = 'root';
  root.insertBefore(checkpoint, root.firstChild);
  caret.dataset.markdown = 'caret';
  caret.setAttribute('aria-hidden', 'true');

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
          setTimeout(() => {
            button.textContent = 'Copy';
          }, 2000);
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
      // Some browsers cancel a download whose URL is revoked during the click.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
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
    /**
     * Reformat completed output only when an option value changes, so inline
     * option objects stay cheap. New hook and `urlTransform` functions apply to
     * later output. A changed set of hook names reformats everything. Plugins
     * compare by their parts, because a wrapper object is often written inline.
     */
    configure(next: HtmlOptions): void {
      if (next === options) return;
      const hooks = (value: HtmlOptions['components']): string =>
        Object.keys(value ?? {})
          .filter((tag) => value?.[tag] !== undefined)
          .join(' ');
      const samePlugins = (a?: PluginConfig, b?: PluginConfig): boolean => {
        const left = a?.renderers ?? [];
        const right = b?.renderers ?? [];
        return (
          a?.code === b?.code &&
          left.length === right.length &&
          left.every(
            (renderer, at) =>
              renderer.render === right[at].render &&
              String(renderer.language) === String(right[at].language)
          )
        );
      };
      let reset = false;
      const keys = new Set([...Object.keys(options), ...Object.keys(next)]);
      for (const key of keys as Set<keyof HtmlOptions>) {
        const previous = options[key];
        const value = next[key];
        reset ||= !(
          previous === value ||
          (key === 'controls'
            ? controlFlags(previous as HtmlOptions['controls']) ===
              controlFlags(value as HtmlOptions['controls'])
            : key === 'components'
              ? hooks(previous as HtmlOptions['components']) ===
                hooks(value as HtmlOptions['components'])
              : key === 'urlTransform'
                ? (previous === undefined) === (value === undefined)
                : key === 'plugins'
                  ? samePlugins(
                      previous as PluginConfig | undefined,
                      value as PluginConfig | undefined
                    )
                  : Array.isArray(previous) &&
                    Array.isArray(value) &&
                    previous.length === value.length &&
                    previous.every((tag, at) => tag === value[at]))
        );
      }
      formatter.configure(next, reset);
      options = next;
    },
    update(
      source: string,
      incomplete: boolean,
      active = false,
      animated: boolean | AnimateOptions = false,
      shape?: 'block' | 'circle'
    ): void {
      root.toggleAttribute('data-streaming', active);
      const update = formatter.render(source, incomplete, active);
      const changed = update.revision !== revision;
      const reset =
        !initialized ||
        (changed && (update.reset || update.revision !== revision + 1));
      fades.update(active, animated);
      const nextCaret = active ? shape : undefined;
      if (!changed && nextCaret === previousCaret) return;
      // Remove the caret first, so patches never see it.
      caret.remove();
      const codeUpdate = update.code;
      if (
        changed &&
        !reset &&
        codeUpdate !== undefined &&
        codeState !== undefined &&
        update.addition === '' &&
        codeState.key === codeUpdate.key &&
        codeState.marker.isConnected &&
        (codeUpdate.firstLine === codeUpdate.lineCount ||
          codeUpdate.firstLine === codeState.line) &&
        (codeUpdate.numbers === undefined) === (codeState.numbers === null) &&
        (codeUpdate.numbers ?? 0) >= codeState.numberCount
      ) {
        if (codeUpdate.firstLine < codeUpdate.lineCount) {
          // Balanced per-line HTML lets the browser parse just the changed
          // lines. Lines fill the last 64-line group, then open new groups.
          const { html, lastLineOffset } = codeUpdate;
          const marker = document.createComment('markdown-code');
          let group = codeState.marker.parentNode as Element | null;
          let first = codeState.marker.nextSibling;
          codeState.marker.remove();
          for (let start = 0, line = codeUpdate.firstLine; ; ) {
            let end = start;
            let left = 64 - (line % 64);
            for (; left > 0; left--) {
              const at = html.indexOf('\n', end);
              if (at < 0) break;
              end = at + 1;
            }
            if (left > 0) end = html.length;
            if (group === null) {
              if (start === end) break;
              group = document.createElement('span');
              group.setAttribute('data-markdown', 'code-lines');
              codeState.code.append(group);
              first = null;
            }
            const at =
              lastLineOffset >= start &&
              (lastLineOffset < end || end === html.length)
                ? lastLineOffset
                : -1;
            template.innerHTML = html.slice(start, at < 0 ? end : at);
            const fragment = template.content;
            if (at >= 0) {
              fragment.append(marker);
              tail.innerHTML = html.slice(at, end);
              fragment.append(tail.content);
            }
            patchChildren(
              group,
              fragment,
              first,
              fades,
              -1,
              at < 0 ? undefined : marker
            );
            if (end === html.length) break;
            line += 64 - (line % 64);
            start = end;
            group = null;
          }
          codeState.marker = marker;
          codeState.line = codeUpdate.lastLine;
        }
        const count = codeUpdate.numbers ?? 0;
        if (codeState.numbers !== null && count > codeState.numberCount) {
          let group = codeState.numbers.lastElementChild!;
          const append = (text: string): void => {
            const last = group.lastChild;
            if (last?.nodeType === 3) (last as Text).appendData(text);
            else group.append(text);
          };
          let text = '';
          for (let line = codeState.numberCount + 1; line <= count; line++) {
            if (line % 64 !== 1) {
              text += '\n' + line;
              continue;
            }
            append(text + '\n');
            group = document.createElement('span');
            group.setAttribute('data-markdown', 'code-lines');
            codeState.numbers.append(group);
            text = String(line);
          }
          append(text);
          codeState.numberCount = count;
        }
      } else if (changed) {
        // The first render and skipped revisions need the full prefix. Other
        // updates use only the addition.
        codeState?.marker.remove();
        codeState = undefined;
        if (reset) {
          if (checkpoint.parentNode !== null) root.removeChild(checkpoint);
          root.insertBefore(checkpoint, root.firstChild);
        }
        template.innerHTML = reset ? update.stable : update.addition;
        const fragment = template.content;
        const count = fragment.childNodes.length;
        tail.innerHTML = update.pending;
        // Only the open fence block is incomplete; footnotes after it may hold other fences.
        const incomingCode =
          codeUpdate === undefined
            ? null
            : tail.content.querySelector('[data-incomplete] > pre > code');
        // Add the marker before insertion, because fades wrap multi-line text.
        const codeMarker =
          incomingCode === null || codeUpdate === undefined
            ? undefined
            : markLastCodeLine(
                incomingCode.lastElementChild ?? incomingCode,
                codeUpdate.lastLine < codeUpdate.lineCount - 1
              );
        fragment.append(tail.content);
        const firstPending = patchChildren(
          root,
          fragment,
          checkpoint.nextSibling,
          fades,
          count,
          codeMarker,
          initialized && reset
        );
        if (checkpoint.nextSibling !== firstPending)
          root.insertBefore(checkpoint, firstPending);
        if (codeUpdate !== undefined && codeMarker?.parentNode != null) {
          const code = codeMarker.parentNode.parentNode as Element;
          const numbers = code.previousElementSibling;
          codeState = {
            code,
            marker: codeMarker,
            line: codeUpdate.lastLine,
            key: codeUpdate.key,
            numbers:
              numbers?.getAttribute('data-markdown') === 'line-numbers'
                ? numbers
                : null,
            numberCount: codeUpdate.numbers ?? 0,
          };
        }
        if (!initialized) {
          initialized = true;
          fades.tree(root);
        }
      }
      revision = update.revision;
      previousCaret = nextCaret;
      if (nextCaret !== undefined) {
        caret.dataset.shape = nextCaret;
        // Place the caret after the last text, inside the deepest last block,
        // and before the final LF of a code fence. Its glyph is CSS content,
        // so block and code text stay unchanged for copy and hooks.
        let parent: Node = root;
        let before: Node | null = null;
        for (let node = root.lastChild; node !== null; ) {
          if (
            node.nodeType === 8 ||
            (node.nodeType === 3 && (node as Text).data.trim() === '') ||
            (node.nodeType === 1 &&
              (node as Element).hasAttribute('data-footnotes'))
          ) {
            node = node.previousSibling;
            continue;
          }
          if (node.nodeType !== 1 || !blockTags.test(node.nodeName)) {
            before = node.nextSibling;
            break;
          }
          parent = node;
          if (node.nodeName === 'PRE') {
            const code = (node as Element).lastElementChild;
            parent = code?.lastElementChild ?? code ?? node;
            let last = parent.lastChild;
            while (last?.nodeType === 1 && last.lastChild !== null)
              last = last.lastChild;
            if (last?.nodeType === 3 && (last as Text).data.endsWith('\n')) {
              const text = last as Text;
              before = text.length > 1 ? text.splitText(text.length - 1) : text;
              parent = before.parentNode!;
            }
            break;
          }
          node = node.lastChild;
        }
        parent.insertBefore(caret, before);
      }
      fades.finish();
    },
  };
}
