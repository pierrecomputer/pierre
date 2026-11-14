import { delta, type InternalHtmlUpdate } from '../lib/internal';
import { decodeHtml } from '../lib/utils';
import type { InternalCodeUpdate } from './render';
import { controlFlags, createHtmlRenderer, rewritesElements } from './render';
import type { AnimateOptions, HtmlOptions, PluginConfig } from './types';

const isFade = (node: Node): node is HTMLElement =>
  node.nodeType === 1 &&
  (node as Element).getAttribute('data-markdown') === 'token';
const isText = (node: Node): boolean => node.nodeType === 3 || isFade(node);
const passiveText =
  '[data-animated="true"], [data-markdown="token"], [data-markdown="code-header"], [data-markdown="line-numbers"], [data-markdown="caret"]';

// Must equal the `markdown-fade-in` duration in react/styles.css: fades with
// this duration carry no inline style, and cleanup is timed from this value.
const fadeDuration = 180;

/** Wrap new text in fade spans, and unwrap each span when its animation ends. */
function createFades(root: HTMLElement) {
  const nodes: HTMLElement[] = [];
  const deadlines: number[] = [];
  const document = root.ownerDocument;
  const query = document.defaultView?.matchMedia?.(
    '(prefers-reduced-motion: reduce)'
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timerDeadline = Infinity;
  let requested = false;
  let duration = fadeDuration;
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
    let kept = 0;
    for (let at = 0; at < nodes.length; at++) {
      const span = nodes[at];
      const value = deadlines[at];
      const deadline = Math.abs(value);
      if (!all && deadline > now) {
        nodes[kept] = span;
        deadlines[kept++] = value;
        next = Math.min(next, deadline);
        continue;
      }
      const parent = span.parentNode;
      if (parent !== null && root.contains(span)) {
        if (value < 0) {
          span.removeAttribute('data-animated');
          span.style.removeProperty('animation-duration');
          if (span.getAttribute('style') === '') span.removeAttribute('style');
          continue;
        }
        while (span.firstChild !== null)
          parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
        parents.add(parent);
      }
    }
    nodes.length = deadlines.length = kept;
    for (const parent of parents) parent.normalize();
    arm(next);
  };
  const stop = (): void => {
    arm(Infinity);
    if (nodes.length > 0) flush(true);
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
    if (duration !== fadeDuration)
      span.style.animationDuration = `${duration}ms`;
    text.replaceWith(span);
    span.append(text);
    nodes.push(span);
    deadlines.push(performance.now() + duration);
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
      let kept = 0;
      for (let at = 0; at < nodes.length; at++) {
        const node = nodes[at];
        if (!root.contains(node)) continue;
        nodes[kept] = node;
        const deadline = deadlines[at];
        deadlines[kept++] = deadline;
        next = Math.min(next, Math.abs(deadline));
      }
      nodes.length = deadlines.length = kept;
      arm(next);
    },
    update(active: boolean, options: boolean | AnimateOptions): void {
      requested = active && options !== false;
      const value =
        typeof options === 'object'
          ? (options.duration ?? fadeDuration)
          : fadeDuration;
      duration = Number.isFinite(value) ? Math.max(0, value) : fadeDuration;
      if (!enabled()) stop();
    },
    tree(node: Node, completed = false): void {
      if (!enabled()) return;
      if (completed && node.nodeType === 1) {
        const visit = (node: Node): void => {
          if (node.nodeType === 3) {
            animate(node as Text);
            return;
          }
          if (node.nodeType !== 1) return;
          const element = node as HTMLElement;
          const kind = element.getAttribute('data-markdown');
          if (
            kind === 'code-header' ||
            kind === 'line-numbers' ||
            kind === 'caret' ||
            kind === 'token'
          )
            return;
          if (
            !element.hasAttribute('style') &&
            (kind === 'p' ||
              (kind?.length === 2 &&
                kind[0] === 'h' &&
                kind[1] >= '1' &&
                kind[1] <= '6') ||
              kind === 'code-lines')
          ) {
            element.setAttribute('data-animated', 'true');
            if (duration !== fadeDuration)
              element.style.animationDuration = `${duration}ms`;
            nodes.push(element);
            deadlines.push(-(performance.now() + duration));
            return;
          }
          for (let child = node.firstChild; child !== null; ) {
            const next = child.nextSibling;
            visit(child);
            child = next;
          }
        };
        visit(node);
        return;
      }
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

/** Update existing nodes directly and let the native parser build batches of new blocks. */
function patchHtml(
  root: Node,
  html: string,
  first: Node | null,
  committed: number,
  template: HTMLTemplateElement
): Node | null {
  const document = root.ownerDocument!;
  let at = 0;
  let firstPending: Node | null = null;
  const children = (parent: Node, current: Node | null): void => {
    while (at < html.length && !html.startsWith('</', at)) {
      if (
        parent === root &&
        current === null &&
        html.length - at >= 1024 &&
        html.charCodeAt(at) === 60
      ) {
        const split = committed > at && committed < html.length;
        template.innerHTML = split
          ? html.slice(at, committed) +
            '<!--markdown-->' +
            html.slice(committed)
          : html.slice(at);
        const fragment = template.content;
        if (split) {
          for (
            let node = fragment.firstChild;
            node !== null;
            node = node.nextSibling
          )
            if (node.nodeType === 8) {
              firstPending = node.nextSibling;
              fragment.removeChild(node);
              break;
            }
        } else if (at >= committed && firstPending === null)
          firstPending = fragment.firstChild;
        parent.appendChild(fragment);
        at = html.length;
        return;
      }
      const pending = parent === root && at >= committed;
      let actual: Node;
      if (html.charCodeAt(at) !== 60) {
        let end = html.indexOf('<', at);
        if (end < 0) end = html.length;
        if (parent === root && at < committed && committed < end)
          end = committed;
        const value = decodeHtml(html.slice(at, end));
        if (current?.nodeType === 3) {
          // Code-line boundaries and carets can split an otherwise unchanged text run.
          let last = current as Text;
          let next = last.nextSibling;
          if (next?.nodeType === 3) {
            let previous = last.data;
            do {
              last = next as Text;
              previous += last.data;
              next = last.nextSibling;
            } while (next?.nodeType === 3);
            const append = value.startsWith(previous);
            const lineAppend =
              !append &&
              previous.endsWith('\n') &&
              value.endsWith('\n') &&
              value.slice(0, -1).startsWith(previous.slice(0, -1));
            if (append || lineAppend) {
              if (value !== previous) {
                if (append) last.appendData(value.slice(previous.length));
                else {
                  while (last.length === 0) last = last.previousSibling as Text;
                  last.insertData(
                    last.length - 1,
                    value.slice(previous.length - 1, -1)
                  );
                }
              }
              if (pending && firstPending === null) firstPending = current;
              at = end;
              current = next;
              continue;
            }
          }
          actual = current;
          const text = current as Text;
          const previous = text.data;
          if (previous !== value) {
            if (value.startsWith(previous))
              text.appendData(value.slice(previous.length));
            else if (
              previous.endsWith('\n') &&
              value.endsWith('\n') &&
              value.slice(0, -1).startsWith(previous.slice(0, -1))
            )
              text.insertData(
                previous.length - 1,
                value.slice(previous.length - 1, -1)
              );
            else text.data = value;
          }
        } else actual = document.createTextNode(value);
        at = end;
      } else {
        const end = html.indexOf('>', at);
        let nameEnd = html.indexOf(' ', at);
        if (nameEnd < 0 || nameEnd > end) nameEnd = end;
        const name = html.slice(at + 1, nameEnd);
        const element =
          current?.nodeType === 1 && (current as Element).localName === name
            ? (current as Element)
            : document.createElement(name);
        const names: string[] = [];
        for (let pos = nameEnd; pos < end; ) {
          if (html.charCodeAt(pos) === 32) {
            pos++;
            continue;
          }
          const start = pos;
          while (
            pos < end &&
            html.charCodeAt(pos) !== 32 &&
            html.charCodeAt(pos) !== 61
          )
            pos++;
          const attribute = html.slice(start, pos);
          let value = '';
          if (html.charCodeAt(pos) === 61) {
            const close = html.indexOf('"', pos + 2);
            value = decodeHtml(html.slice(pos + 2, close));
            pos = close + 1;
          }
          names.push(attribute);
          if (element.getAttribute(attribute) !== value)
            element.setAttribute(attribute, value);
        }
        for (let index = element.attributes.length - 1; index >= 0; index--) {
          const name = element.attributes[index].name;
          if (!names.includes(name)) element.removeAttribute(name);
        }
        at = end + 1;
        if (
          name !== 'br' &&
          name !== 'hr' &&
          name !== 'img' &&
          name !== 'input'
        ) {
          children(element, element.firstChild);
          at = html.indexOf('>', at) + 1;
        }
        actual = element;
      }
      if (actual !== current) {
        parent.insertBefore(actual, current);
        if (current !== null) {
          const next = current.nextSibling;
          parent.removeChild(current);
          current = next;
        }
      } else current = current.nextSibling;
      if (pending && firstPending === null) firstPending = actual;
    }
    while (current !== null) {
      const next = current.nextSibling;
      parent.removeChild(current);
      current = next;
    }
  };
  children(root, first);
  return firstPending;
}

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
    if (
      current === null &&
      incoming.nodeType === 11 &&
      target.nextSibling !== null
    ) {
      // Matching targets stay in the detached fragment; only append its new tail.
      while (incoming.firstChild !== target)
        incoming.removeChild(incoming.firstChild!);
      for (let node: Node | null = target; node !== null; ) {
        const next: Node | null = node.nextSibling;
        if (
          node !== marker &&
          (previousText === undefined ||
            !previousText.includes(node.textContent ?? ''))
        )
          fades.tree(node, index < committed);
        if (index === committed)
          firstPending = node.parentNode === incoming ? node : node.parentNode;
        index++;
        node = next;
      }
      parent.appendChild(incoming);
      return firstPending;
    }
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
          const lead = current!.previousSibling;
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
          // A run that was only its final LF now starts at the new text.
          actual = (lead === null ? parent.firstChild : lead.nextSibling)!;
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
      // A native deep compare skips an unchanged element. The last element
      // holds the open end of the stream, so it is patched without the compare.
      if (wanted.nextElementSibling === null || !element.isEqualNode(wanted)) {
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
      }
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
        fades.tree(target, index < committed);
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

/** Separate the last code line, so later updates patch only that line. */
function lastCodeLine(code: Element, trailingNewline: boolean): Node | null {
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
  return before;
}

/** Keep a physical boundary while fade cleanup can merge neighboring text nodes. */
function markLastCodeLine(code: Element, trailingNewline: boolean): Comment {
  const marker = code.ownerDocument.createComment('markdown-code');
  code.insertBefore(marker, lastCodeLine(code, trailingNewline));
  return marker;
}

/** Append literal code into 64-line groups, retaining the last text node and its selections. */
function appendCodeText(
  code: Element,
  lines: number,
  text: string,
  replaceNewline: boolean
): Element {
  let group = code.lastElementChild ?? code;
  const value = text.endsWith('\n') ? text : text + '\n';
  for (let from = 0; from < value.length; ) {
    if (!replaceNewline && lines > 0 && lines % 64 === 0) {
      group = code.ownerDocument.createElement('span');
      group.setAttribute('data-markdown', 'code-lines');
      code.append(group);
    }
    let end = from;
    for (let left = 64 - (lines % 64); left > 0; left--) {
      const at = value.indexOf('\n', end);
      if (at < 0) break;
      end = at + 1;
      lines++;
    }
    const last = group.lastChild;
    if (replaceNewline && last?.nodeType === 3) {
      const node = last as Text;
      node.insertData(node.length - 1, value.slice(from, end - 1));
      replaceNewline = false;
    } else if (last?.nodeType === 3)
      (last as Text).appendData(value.slice(from, end));
    else group.append(value.slice(from, end));
    from = end;
  }
  return group;
}

/** Render Markdown into `root`, and patch its DOM nodes on each update. */
export function createDomRenderer(
  root: HTMLElement,
  options: HtmlOptions = {},
  formatter = createHtmlRenderer(options)
) {
  const document = root.ownerDocument;
  const checkpoint = document.createComment('markdown');
  let pending: Node | null = root.firstChild;
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
        marker: Comment | undefined;
        group: Element;
        first: Node | null;
        line: number;
        lineCount: number;
        key: number;
        numbers: Element | null;
        numberCount: number;
      }
    | undefined;
  root.dataset.markdown = 'root';
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
      // Only letters and digits make a file extension.
      let language = block?.getAttribute('data-language') ?? '';
      for (let at = 0; at < language.length; at++) {
        const code = language.charCodeAt(at);
        if (((code | 32) < 97 || (code | 32) > 122) && (code < 48 || code > 57))
          language = '';
      }
      link.download = `code.${language === '' ? 'txt' : language}`;
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
      const codeUpdate: InternalCodeUpdate | undefined = update.code;
      const append = (update as InternalHtmlUpdate)[delta];
      const textAppend = typeof append === 'string' ? append : undefined;
      const codeAppend = codeUpdate?.[delta];
      const direct =
        animated === false &&
        options.plugins === undefined &&
        !rewritesElements(options);
      if (
        changed &&
        !reset &&
        textAppend !== undefined &&
        update.addition === '' &&
        pending?.parentNode === root &&
        pending.nodeName === 'P' &&
        pending.lastChild !== null &&
        isText(pending.lastChild)
      ) {
        if (textAppend !== '') {
          if (animated !== false) fades.append(pending, textAppend, null);
          else (pending.lastChild as Text).appendData(textAppend);
        }
      } else if (
        changed &&
        !reset &&
        codeUpdate !== undefined &&
        codeState !== undefined &&
        update.addition === '' &&
        codeState.key === codeUpdate.key &&
        direct === (codeState.marker === undefined) &&
        (codeState.marker !== undefined
          ? root.contains(codeState.marker)
          : root.contains(codeState.group) &&
            (codeState.first === null ||
              codeState.first.parentNode === codeState.group)) &&
        (codeUpdate.firstLine === codeUpdate.lineCount ||
          (codeUpdate.firstLine === codeState.line &&
            codeUpdate.firstLine <= codeUpdate.lastLine)) &&
        (codeUpdate.numbers === undefined) === (codeState.numbers === null) &&
        (codeUpdate.numbers ?? 0) >= codeState.numberCount
      ) {
        if (direct && codeAppend !== undefined) {
          const group = appendCodeText(
            codeState.code,
            codeState.lineCount -
              1 -
              (codeAppend.replaceNewline === true ? 1 : 0),
            codeAppend.text,
            codeAppend.replaceNewline === true
          );
          codeState.group = group;
          codeState.first = lastCodeLine(group, true);
          codeState.line = codeUpdate.lastLine;
        } else if (codeUpdate.firstLine < codeUpdate.lineCount) {
          // Balanced per-line HTML lets the browser parse just the changed
          // lines. Lines fill the last 64-line group, then open new groups.
          const { html, lastLineOffset } = codeUpdate;
          const marker = codeState.marker;
          let group = (marker?.parentNode ?? codeState.group) as Element | null;
          let first =
            marker === undefined ? codeState.first : marker.nextSibling;
          marker?.remove();
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
            if (direct) {
              const next = patchHtml(
                group,
                html.slice(start, end),
                first,
                at < 0 ? end - start : at - start,
                template
              );
              if (at >= 0) {
                codeState.first = next;
                codeState.group = group;
              }
            } else {
              template.innerHTML = html.slice(start, at < 0 ? end : at);
              const fragment = template.content;
              if (at >= 0) {
                fragment.append(marker!);
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
            }
            if (end === html.length) break;
            line += 64 - (line % 64);
            start = end;
            group = null;
          }
          codeState.marker = marker;
          codeState.line = codeUpdate.lastLine;
        }
        codeState.lineCount = codeUpdate.lineCount;
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
      } else if (changed && direct) {
        codeState?.marker?.remove();
        codeState = undefined;
        if (checkpoint.parentNode !== null) {
          pending = checkpoint.nextSibling;
          checkpoint.remove();
        }
        if (reset) pending = root.firstChild;
        const addition = reset ? update.stable : update.addition;
        const firstPending = patchHtml(
          root,
          addition + update.pending,
          pending,
          addition.length,
          template
        );
        pending = firstPending;
        if (codeUpdate !== undefined) {
          let code: Element | null = null;
          for (
            let node = firstPending;
            node !== null;
            node = node.nextSibling
          ) {
            if (node.nodeType === 1)
              code = (node as Element).querySelector(
                '[data-incomplete] > pre > code'
              );
            if (code !== null) break;
          }
          if (code !== null) {
            const group = code.lastElementChild ?? code;
            const first = lastCodeLine(
              group,
              codeUpdate.lastLine < codeUpdate.lineCount - 1
            );
            const numbers = code.previousElementSibling;
            codeState = {
              code,
              marker: undefined,
              group,
              first,
              line: codeUpdate.lastLine,
              lineCount: codeUpdate.lineCount,
              key: codeUpdate.key,
              numbers:
                numbers?.getAttribute('data-markdown') === 'line-numbers'
                  ? numbers
                  : null,
              numberCount: codeUpdate.numbers ?? 0,
            };
          }
        }
        initialized = true;
      } else if (changed) {
        // The first render and skipped revisions need the full prefix. Other
        // updates use only the addition.
        codeState?.marker?.remove();
        codeState = undefined;
        if (checkpoint.parentNode !== null) {
          pending = checkpoint.nextSibling;
          checkpoint.remove();
        }
        if (reset) pending = root.firstChild;
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
          pending,
          fades,
          count,
          codeMarker,
          initialized && reset
        );
        pending = firstPending;
        // Root-level text can merge when fade wrappers finish. Keep a physical
        // boundary only there; ordinary block nodes are stable references.
        if (firstPending !== null && isText(firstPending))
          root.insertBefore(checkpoint, firstPending);
        if (codeUpdate !== undefined && codeMarker?.parentNode != null) {
          const code = codeMarker.parentNode.parentNode as Element;
          const numbers = code.previousElementSibling;
          codeState = {
            code,
            marker: codeMarker,
            group: codeMarker.parentNode as Element,
            first: codeMarker.nextSibling,
            line: codeUpdate.lastLine,
            lineCount: codeUpdate.lineCount,
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
          let block = false;
          if (node.nodeType === 1)
            switch (node.nodeName) {
              case 'BLOCKQUOTE':
              case 'DIV':
              case 'H1':
              case 'H2':
              case 'H3':
              case 'H4':
              case 'H5':
              case 'H6':
              case 'LI':
              case 'OL':
              case 'P':
              case 'PRE':
              case 'SECTION':
              case 'TABLE':
              case 'TBODY':
              case 'TD':
              case 'TH':
              case 'THEAD':
              case 'TR':
              case 'UL':
                block = true;
            }
          if (!block) {
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
