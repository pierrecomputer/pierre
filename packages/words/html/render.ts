import { createHtmlSession } from '@pierre/words';
import type { HtmlUpdate } from '@pierre/words';

import {
  delta,
  type FenceDelta,
  type InternalHtmlUpdate,
} from '../lib/internal';
import type {
  CodeHighlighterSession,
  CodeHighlightUpdate,
  HtmlOptions,
} from './types';

/** Changed lines of the open code fence, for the DOM renderer. */
export interface CodeHtmlUpdate extends Omit<CodeHighlightUpdate, 'fullHtml'> {
  /** Changes when the markup around the fence lines changes. */
  key: number;
  lastLine: number;
  /** Lines shown in the gutter, or undefined without line numbers. */
  numbers: number | undefined;
  /** The whole pending HTML, built on first read. */
  readonly pending: string;
}

type RenderedHtmlUpdate = HtmlUpdate & { code?: CodeHtmlUpdate };
export type InternalCodeUpdate = CodeHtmlUpdate & { [delta]?: FenceDelta };
type InternalRenderedUpdate = RenderedHtmlUpdate & { [delta]?: string };

const lineGroup = '<span data-markdown="code-lines">';
const paragraphStart = '<p data-markdown="p">';

/**
 * Wrap code in groups of 64 lines, so the browser lays out only the last group
 * when a streamed line changes. Each LF stays inside its group, so `textContent`
 * does not change. An LF inside an element never splits a group.
 */
function groupLines(body: string): string {
  let result = '';
  let start = 0;
  let lines = 0;
  let depth = 0;
  let tag = body.indexOf('<');
  for (
    let at = body.indexOf('\n');
    at !== -1;
    at = body.indexOf('\n', at + 1)
  ) {
    for (; tag !== -1 && tag < at; tag = body.indexOf('<', tag + 1))
      if (body.charCodeAt(tag + 1) === 47) depth--;
      else if (body.charCodeAt(body.indexOf('>', tag) - 1) !== 47) depth++;
    if (++lines >= 64 && depth === 0) {
      result += lineGroup + body.slice(start, at + 1) + '</span>';
      start = at + 1;
      lines = 0;
    }
  }
  return result === '' || start < body.length
    ? result + lineGroup + body.slice(start) + '</span>'
    : result;
}

/** Gutter line numbers, in the same 64-line groups as the code. */
function lineNumbers(count: number): string {
  let html = '';
  for (let line = 1; line <= count; line += 64) {
    html += lineGroup + line;
    for (let next = line + 1; next < line + 64 && next <= count; next++)
      html += '\n' + next;
    html += (line + 64 <= count ? '\n' : '') + '</span>';
  }
  return html;
}

/** The code buttons as bits: 1 for copy, 2 for download. Equal inline option objects give equal bits. */
export const controlFlags = (controls: HtmlOptions['controls']): number => {
  const code = typeof controls === 'object' ? controls.code : controls;
  return code === false
    ? 0
    : typeof code === 'object'
      ? (code.copy === false ? 0 : 1) | (code.download === false ? 0 : 2)
      : 3;
};

/** The HTML before and after the code of a fenced block. */
function codeWrapper(
  attributes: string,
  language: string,
  incomplete: boolean,
  numbers: number | undefined,
  options: HtmlOptions
): [string, string] {
  const flags = controlFlags(options.controls);
  const button = (action: string): string =>
    `<button type="button" data-code-action="${action.toLowerCase()}" aria-label="${action} code"${incomplete ? ' disabled=""' : ''}>${action}</button>`;
  return [
    `<div data-markdown="code-block" data-language="${escapeHtml(language)}"${incomplete ? ' data-incomplete="true"' : ''}><div data-markdown="code-header"><span>${escapeHtml(language)}</span><span>${(flags & 1) !== 0 ? button('Copy') : ''}${(flags & 2) !== 0 ? button('Download') : ''}</span></div><pre dir="ltr">${numbers === undefined ? '' : `<span data-markdown="line-numbers" aria-hidden="true">${lineNumbers(numbers)}</span>`}<code${attributes}>`,
    '</code></pre></div>',
  ];
}

/** Escape text for use in HTML. */
export function escapeHtml(value: string): string {
  let result = '';
  let from = 0;
  for (let at = 0; at < value.length; at++) {
    let entity: string;
    switch (value.charCodeAt(at)) {
      case 34:
        entity = '&quot;';
        break;
      case 38:
        entity = '&amp;';
        break;
      case 39:
        entity = '&#39;';
        break;
      case 60:
        entity = '&lt;';
        break;
      case 62:
        entity = '&gt;';
        break;
      default:
        continue;
    }
    result += value.slice(from, at) + entity;
    from = at + 1;
  }
  return from === 0 ? value : result + value.slice(from);
}

/** Decode only the entities that Wasm writes. The result is text, not HTML. */
export function decodeHtml(value: string): string {
  let result = '';
  let from = 0;
  for (
    let at = value.indexOf('&');
    at !== -1;
    at = value.indexOf('&', at + 1)
  ) {
    let character: string;
    // The `;` of these entities is three to five characters after the `&`.
    let end = at + 3;
    while (end < at + 6 && value.charCodeAt(end) !== 59) end++;
    switch (value.slice(at + 1, end)) {
      case 'amp':
        character = '&';
        break;
      case 'lt':
        character = '<';
        break;
      case 'gt':
        character = '>';
        break;
      case 'quot':
        character = '"';
        break;
      case '#39':
      case '#x27':
        character = "'";
        break;
      default:
        continue;
    }
    result += value.slice(from, at) + character;
    from = end + 1;
  }
  return from === 0 ? value : result + value.slice(from);
}

/** Hooks can come from untyped code, and a non-string would print as text. */
function hookHtml(html: unknown): string {
  if (typeof html !== 'string')
    throw new TypeError('HTML hooks must return strings');
  return html;
}

/**
 * Return `url` if it is relative or uses http, https, mailto, tel, or a scheme
 * the parser autolinks (ftp, xmpp). Reject network paths.
 */
export function defaultUrlTransform(url: string): string | undefined {
  // Browsers ignore spaces and control characters in URLs.
  let normalized = '';
  let from = 0;
  for (let at = 0; at < url.length; at++) {
    const code = url.charCodeAt(at);
    if (code <= 32 || (code >= 127 && code <= 159)) {
      normalized += url.slice(from, at);
      from = at + 1;
    }
  }
  normalized = from === 0 ? url : normalized + url.slice(from);
  // Browsers read `\` as `/`, so `/\host` and `\\host` are network paths too.
  const second = normalized.charCodeAt(1);
  if (
    normalized.charCodeAt(0) === 92 ||
    (normalized.charCodeAt(0) === 47 && (second === 47 || second === 92))
  )
    return undefined;
  // The scheme ends at the last `:` before the path, query, or fragment.
  let colon = -1;
  scheme: for (let at = 0; at < normalized.length; at++)
    switch (normalized.charCodeAt(at)) {
      case 35:
      case 47:
      case 63:
        break scheme;
      case 58:
        colon = at;
    }
  if (colon >= 0)
    switch (normalized.slice(0, colon).toLowerCase()) {
      case 'http':
      case 'https':
      case 'ftp':
      case 'mailto':
      case 'tel':
      case 'xmpp':
        break;
      default:
        return undefined;
    }
  return url;
}

const voidTags = new Set(['br', 'hr', 'img', 'input']);

/** Whether the tag at [at, end) of Wasm HTML is void. All but `<input>` end with ` />`. */
const isVoidAt = (html: string, at: number, end: number): boolean =>
  html.charCodeAt(end - 2) === 47 || html.startsWith('<input', at);

/** Whether a character code continues a tag name, as `\w` does. */
const isNameCode = (code: number): boolean =>
  (code >= 48 && code <= 57) ||
  (code >= 65 && code <= 90) ||
  code === 95 ||
  (code >= 97 && code <= 122);

/** Find the first changed byte range with native string comparisons before checking its short tail. */
function unchangedEnd(
  a: string,
  b: string,
  start: number,
  end: number
): number {
  let step = end - start;
  while (step > 32) {
    if (a.slice(start, start + step) === b.slice(start, start + step)) {
      start += step;
      step = end - start;
    } else step = Math.floor(step / 2);
  }
  while (start < end && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  return start;
}

/** The language of a fence from the attributes of its `<code>`. */
function codeLanguage(attributes: string): string {
  const at = attributes.indexOf('class="language-');
  return at < 0
    ? 'text'
    : decodeHtml(attributes.slice(at + 16, attributes.indexOf('"', at + 16)));
}

/**
 * Run `transform` on each `tag` element, without a syntax tree. Inner elements
 * run first, and each element runs once.
 */
function mapElements(
  html: string,
  tag: string,
  transform: (html: string) => string
): string {
  const expression = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
  const isVoid = voidTags.has(tag);
  const open: string[] = [];
  let result = '';
  let cursor = 0;
  for (
    let match = expression.exec(html);
    match !== null;
    match = expression.exec(html)
  ) {
    let piece = html.slice(cursor, match.index);
    cursor = expression.lastIndex;
    if (match[1] === '' && !isVoid) {
      if (open.length === 0) result += piece;
      else open[open.length - 1] += piece;
      open.push(match[0]);
      continue;
    }
    if (match[1] !== '' && (isVoid || open.length === 0)) piece += match[0];
    else {
      const replacement = hookHtml(
        transform(match[1] === '' ? match[0] : open.pop()! + piece + match[0])
      );
      piece = match[1] === '' ? piece + replacement : replacement;
    }
    if (open.length === 0) result += piece;
    else open[open.length - 1] += piece;
  }
  return result + open.join('') + html.slice(cursor);
}

/** Apply element filters and URL checks to HTML from Wasm, and add `data-markdown`. Runs before hooks. */
function decorate(html: string, options: HtmlOptions): string {
  const { allowedElements, disallowedElements } = options;
  if (allowedElements !== undefined && disallowedElements !== undefined)
    throw new Error('Use either allowedElements or disallowedElements');
  const filtered =
    allowedElements !== undefined || disallowedElements !== undefined;
  const excluded = (tag: string): boolean =>
    allowedElements !== undefined
      ? !allowedElements.includes(tag)
      : disallowedElements!.includes(tag);
  let result = '';
  let from = 0;
  // Tags open inside an excluded element, which is dropped whole.
  let dropped = 0;
  // Wasm writes strict tags and escapes `<` in text, so each `<` starts a tag.
  for (
    let at = html.indexOf('<'), end = 0;
    at !== -1;
    at = html.indexOf('<', end)
  ) {
    const closing = html.charCodeAt(at + 1) === 47;
    // A closing tag stays as it is, unless a filter can drop it.
    if (closing && !filtered) {
      end = at + 2;
      continue;
    }
    end = html.indexOf('>', at) + 1;
    if (end === 0) break;
    if (dropped > 0) {
      if (!closing) dropped += isVoidAt(html, at, end) ? 0 : 1;
      else if (--dropped === 0) from = end;
      continue;
    }
    if (closing) {
      if (
        options.unwrapDisallowed === true &&
        excluded(html.slice(at + 2, end - 1))
      ) {
        result += html.slice(from, at);
        from = end;
      }
      continue;
    }
    let space = at + 1;
    for (
      let code = html.charCodeAt(space);
      code !== 32 && code !== 62;
      code = html.charCodeAt(++space)
    );
    const tag = html.slice(at + 1, space);
    if (filtered && excluded(tag)) {
      result += html.slice(from, at);
      from = end;
      if (options.unwrapDisallowed !== true && !voidTags.has(tag)) dropped = 1;
      continue;
    }
    // Most tags have no attributes.
    if (space === end - 1) {
      result += html.slice(from, space) + ' data-markdown="' + tag + '">';
      from = end;
      continue;
    }
    result += html.slice(from, at);
    from = end;
    // A void tag ends with ` /`, which HTML does not need.
    let stop = end - 1;
    if (html.charCodeAt(stop - 1) === 47)
      for (stop--; html.charCodeAt(stop - 1) === 32; stop--);
    const text = html.slice(space, stop);
    // Wasm marks a pending link with this attribute instead of a destination.
    const pending = tag === 'a' && text === ' data-markdown-incomplete';
    let attributes = '';
    if (!pending && text !== '') {
      // Values hold no `"`, so only a real attribute follows a closing quote.
      const note = tag === 'a' ? text.indexOf('" data-footnote-') : -1;
      const footnote = note > 0 && text.charCodeAt(note - 1) !== 61;
      let invalidImage = false;
      let copied = 0;
      // Warning: take whole attributes in order. A search for one name also
      // finds it in the text of a value, such as an `alt` that ends in
      // ` src=`, and the rewrite then moves the quotes of the attributes
      // after it.
      for (
        let equals = text.indexOf('="');
        equals !== -1;
        equals = text.indexOf('="', copied)
      ) {
        const start = text.lastIndexOf(' ', equals);
        const key = text.slice(start + 1, equals);
        const close = text.indexOf('"', equals + 2);
        const value = text.slice(equals + 2, close);
        attributes += text.slice(copied, start);
        copied = close + 1;
        switch (key) {
          case 'align':
            attributes += ` style="text-align:${value}"`;
            break;
          case 'id':
            attributes += ` id="${escapeHtml(options.idPrefix ?? '')}${value}"`;
            break;
          case 'href':
          case 'src': {
            const decoded = decodeHtml(value);
            const transformed =
              options.urlTransform === undefined
                ? decoded
                : options.urlTransform(decoded, key);
            let url =
              transformed == null
                ? ''
                : (defaultUrlTransform(transformed) ?? '');
            if (url === '' && transformed !== '') {
              invalidImage ||= tag === 'img';
              break;
            }
            // Only generated footnote links target the prefixed footnote ids.
            if (footnote && url.startsWith('#'))
              url = '#' + (options.idPrefix ?? '') + url.slice(1);
            attributes += ` ${key}="${escapeHtml(url)}"`;
            break;
          }
          default:
            attributes += text.slice(start, copied);
        }
      }
      if (invalidImage) continue;
      attributes += text.slice(copied);
    }
    if (tag === 'img') attributes += ' loading="lazy"';
    else if (tag === 'input') attributes += ' readonly=""';
    result += `<${tag} data-markdown="${pending ? 'incomplete-link' : tag}"${attributes}>`;
  }
  return result + html.slice(from);
}

/** Format session output with HTML options. Keeps completed HTML and at most one live highlighter. */
export function createHtmlRenderer(options: HtmlOptions = {}) {
  let parser = createHtmlSession();
  // Formatted completed HTML and the Wasm HTML it was formatted from.
  let stable = '';
  let stableRaw = '';
  let nextCode = 0;
  let live:
    | { session: CodeHighlighterSession; index: number; language: string }
    | undefined;
  let liveUses = 0;
  let previousUpdate: HtmlUpdate | undefined;
  let result: InternalRenderedUpdate | undefined;
  let revision = 0;
  let pendingRaw = '';
  let pendingSource: HtmlUpdate | undefined;
  let pendingInput: string | undefined;
  let pendingActive = false;
  let pendingCode = -1;
  let pendingHtml = '';
  let pendingParagraph: { body: string } | undefined;
  let pendingFence: InternalCodeUpdate | undefined;
  // Raw end, formatted end, and next code index at fences in the current pending output.
  let pendingFences: number[] = [];
  // The open fence, the formatted HTML around it, and its previous escaped and decoded code.
  let fenceKey = 0;
  let fence:
    | {
        key: number;
        prefix: string;
        suffix: string;
        attributes: string;
        firstCode: number;
        index: number;
        before: string;
        after: string;
        highlighted: boolean;
        escaped: string | undefined;
        start: number;
        line: number;
        code: string;
        codeStart: number;
      }
    | undefined;
  const dispose = (): void => {
    const session = live?.session;
    live = undefined;
    session?.dispose();
  };

  /** Drop all state after an option change or a hook error, so the next render starts clean. */
  const resetState = (): void => {
    dispose();
    parser = createHtmlSession();
    stable = '';
    stableRaw = '';
    nextCode = 0;
    previousUpdate = undefined;
    result = undefined;
    pendingInput = undefined;
    pendingSource = undefined;
    pendingHtml = '';
    pendingParagraph = undefined;
    pendingActive = false;
    pendingCode = -1;
    pendingFence = undefined;
    pendingFences = [];
    fence = undefined;
  };

  const format = (
    input: string,
    firstCode: number,
    active: boolean,
    fences?: number[]
  ): [string, number] => {
    if (
      options.allowedElements !== undefined ||
      options.disallowedElements !== undefined ||
      Object.values(options.components ?? {}).some((hook) => hook !== undefined)
    )
      fences = undefined;
    const decorated = decorate(input, options);
    let html = '';
    let index = firstCode;
    let cursor = 0;
    let rawEnd = 0;
    // A fence is `<pre ...><code ...>`, escaped code, then `</code></pre>`.
    for (
      let at = decorated.indexOf('<pre '), scan = 0;
      at !== -1;
      at = decorated.indexOf('<pre ', scan)
    ) {
      const pre = decorated.indexOf('>', at);
      scan = pre;
      if (!decorated.startsWith('<code ', pre + 1)) continue;
      const open = decorated.indexOf('>', pre + 1);
      const end = decorated.indexOf('</code></pre>', open);
      if (end < 0) break;
      const codeAttributes = decorated.slice(pre + 6, open);
      const content = decorated.slice(open + 1, end);
      const code = decodeHtml(content);
      const language = codeLanguage(codeAttributes);
      const isIncomplete =
        active && decorated.slice(at, pre).includes('data-markdown-incomplete');
      const number = index++;
      if (fences !== undefined)
        rawEnd = input.indexOf('</code></pre>', rawEnd) + 13;
      html += decorated.slice(cursor, at);
      cursor = scan = end + 13;
      const custom = options.plugins?.renderers?.find((renderer) =>
        typeof renderer.language === 'string'
          ? renderer.language === language
          : renderer.language.includes(language)
      );
      if (custom !== undefined) {
        html += hookHtml(custom.render({ code, language, isIncomplete }));
        fences?.push(rawEnd, html.length, index);
        continue;
      }
      const plugin = options.plugins?.code;
      // Only a different open fence replaces the live highlighter.
      if (isIncomplete) {
        if (
          live !== undefined &&
          (live.index !== number || live.language !== language)
        )
          dispose();
        if (live === undefined) {
          const session = plugin?.createSession?.();
          if (session !== undefined)
            live = { session, index: number, language };
        }
      }
      let highlighted: string | null | undefined;
      if (live !== undefined && live.index === number) {
        liveUses++;
        highlighted = live.session.highlight({ code, language, isIncomplete });
      } else if (plugin !== undefined) {
        highlighted = plugin.highlight({ code, language, isIncomplete });
      }
      if (highlighted != null && typeof highlighted !== 'string')
        throw new TypeError('Code highlighters must return HTML strings');
      let count = 1;
      for (
        let line = code.indexOf('\n');
        line !== -1 && line < code.length - 1;
        line = code.indexOf('\n', line + 1)
      )
        count++;
      const [before, after] = codeWrapper(
        codeAttributes,
        language,
        isIncomplete,
        options.lineNumbers === false ? undefined : count,
        options
      );
      html += before + groupLines(highlighted ?? content) + after;
      fences?.push(rawEnd, html.length, index);
    }
    html += decorated.slice(cursor);
    for (const [tag, render] of Object.entries(options.components ?? {})) {
      // An element hook has a tag name: lowercase letters, then digits too.
      let named = tag !== '';
      for (let at = 0; named && at < tag.length; at++) {
        const code = tag.charCodeAt(at);
        named =
          (code >= 97 && code <= 122) || (at > 0 && code >= 48 && code <= 57);
      }
      if (render === undefined || (!named && tag !== 'inlineCode')) continue;
      const inline = tag === 'inlineCode';
      if (
        !inline &&
        (tag !== 'code' || options.components?.inlineCode === undefined)
      ) {
        html = mapElements(html, tag, render);
        continue;
      }
      // `inlineCode` sees the code outside `<pre>`, so `code` then sees only
      // the code inside it. The leftmost `<pre` or `<code` starts an element
      // when its first closing tag follows.
      let result = '';
      let from = 0;
      let pre = html.indexOf('<pre');
      let code = inline ? html.indexOf('<code') : -1;
      while (inline ? code !== -1 : pre !== -1) {
        const isPre = pre !== -1 && (!inline || pre < code);
        const at = isPre ? pre : code;
        const name = at + (isPre ? 4 : 5);
        const open = isNameCode(html.charCodeAt(name))
          ? -1
          : html.indexOf('>', name);
        const close =
          open < 0 ? -1 : html.indexOf(isPre ? '</pre>' : '</code>', open + 1);
        const next = close < 0 ? name : close + (isPre ? 6 : 7);
        if (close >= 0 && isPre !== inline) {
          const element = html.slice(at, next);
          result +=
            html.slice(from, at) +
            (inline
              ? hookHtml(render(element))
              : mapElements(element, 'code', render));
          from = next;
        }
        if (pre !== -1 && pre < next) pre = html.indexOf('<pre', next);
        if (inline && code < next) code = html.indexOf('<code', next);
      }
      html = result + html.slice(from);
    }
    return [html, index];
  };

  /** Move already formatted pending fences into completed output without highlighting them again. */
  const formatAddition = (
    input: string,
    firstCode: number,
    active: boolean
  ): [string, number] => {
    if (
      pendingInput !== undefined &&
      pendingCode === firstCode &&
      pendingActive === active &&
      pendingInput.slice(0, input.length) === input
    ) {
      for (let at = pendingFences.length - 3; at >= 0; at -= 3) {
        if (pendingFences[at] > input.length) continue;
        const [tail, next] = format(
          input.slice(pendingFences[at]),
          pendingFences[at + 2],
          active
        );
        return [pendingHtml.slice(0, pendingFences[at + 1]) + tail, next];
      }
    }
    return format(input, firstCode, active);
  };

  /**
   * Format the last open fence as changed lines when no hook or filter needs
   * its full element. The HTML around the fence is reused while it is unchanged,
   * so this also works for a fence in a list or quote.
   */
  const formatFence = (
    input: string,
    firstCode: number,
    active: boolean
  ): InternalCodeUpdate | undefined => {
    if (
      !active ||
      options.allowedElements !== undefined ||
      options.disallowedElements !== undefined ||
      (options.components !== undefined &&
        Object.values(options.components).some((hook) => hook !== undefined))
    )
      return;
    // Wasm marks only the fence that is still open at the end of the source.
    const start = input.indexOf('<pre data-markdown-incomplete');
    if (start < 0) return;
    const open = input.indexOf('>', start) + 1;
    const body = input.indexOf('>', open) + 1;
    // Escaped code holds no `<`, so the next one starts `</code></pre>`.
    const end = input.indexOf('<', body);
    if (!input.startsWith('<code', open) || end < 0) return;
    const attributes = input.slice(open + 5, body - 1);
    const language = codeLanguage(attributes);
    if (
      options.plugins?.renderers?.some((renderer) =>
        typeof renderer.language === 'string'
          ? renderer.language === language
          : renderer.language.includes(language)
      ) === true
    )
      return;
    const plugin = options.plugins?.code;
    const prefix = input.slice(0, start);
    const suffix = input.slice(end + 13);
    if (
      fence === undefined ||
      prefix !== fence.prefix ||
      suffix !== fence.suffix ||
      attributes !== fence.attributes ||
      firstCode !== fence.firstCode
    ) {
      const [before, index] = format(prefix, firstCode, active);
      fence = {
        key: ++fenceKey,
        prefix,
        suffix,
        attributes,
        firstCode,
        index,
        before,
        after: format(suffix, index + 1, active)[0],
        highlighted: false,
        escaped: undefined,
        start: 0,
        line: 0,
        code: '',
        codeStart: 0,
      };
    }
    if (
      live !== undefined &&
      (live.index !== fence.index || live.language !== language)
    )
      dispose();
    if (live === undefined && plugin !== undefined) {
      const session = plugin.createSession?.();
      if (session !== undefined)
        live = { session, index: fence.index, language };
    }
    // Plugins without line updates re-highlight the whole fence through format().
    if (plugin !== undefined && live?.session.highlightLines === undefined)
      return;
    // Appended source changes the escaped code only from its previous last
    // line, so decode and count lines from there. V8 compares slices with
    // memcmp, but its startsWith reads each character.
    const escaped = input.slice(body, end);
    const length = escaped.endsWith('\n') ? escaped.length - 1 : escaped.length;
    const lastStart =
      length === 0 ? 0 : escaped.lastIndexOf('\n', length - 1) + 1;
    const unchanged = escaped === fence.escaped;
    const from =
      fence.escaped !== undefined &&
      lastStart >= fence.start &&
      escaped.slice(0, fence.start) === fence.escaped.slice(0, fence.start)
        ? fence.start
        : 0;
    const firstLine = from === 0 ? 0 : fence.line;
    let lineCount = firstLine + 1;
    for (
      let at = escaped.indexOf('\n', from);
      at !== -1;
      at = escaped.indexOf('\n', at + 1)
    )
      lineCount++;
    let code = escaped;
    let codeStart = lastStart;
    if (plugin !== undefined) {
      const head =
        (from === 0 ? '' : fence.code.slice(0, fence.codeStart)) +
        decodeHtml(escaped.slice(from, lastStart));
      code = head + decodeHtml(escaped.slice(lastStart));
      codeStart = head.length;
    }
    if (live !== undefined) liveUses++;
    let lines =
      live?.session.highlightLines?.({ code, language, isIncomplete: true }) ??
      null;
    // Highlighted and plain lines are different markup for the same code.
    if (fence.highlighted !== (lines !== null)) {
      fence.highlighted = lines !== null;
      fence.key = ++fenceKey;
    }
    lines ??= {
      firstLine: unchanged ? lineCount : firstLine,
      lineCount,
      html: unchanged ? '' : escaped.slice(from),
      lastLineOffset: unchanged ? 0 : lastStart - from,
      fullHtml: escaped,
    };
    fence.escaped = escaped;
    fence.start = lastStart;
    fence.line = Math.max(0, lineCount - (escaped.endsWith('\n') ? 2 : 1));
    fence.code = code;
    fence.codeStart = codeStart;
    const update = lines;
    const count = Math.max(1, update.lineCount - (code.endsWith('\n') ? 1 : 0));
    const numbers = options.lineNumbers === false ? undefined : count;
    const context = fence;
    const renderOptions = options;
    let fullPending: string | undefined;
    return {
      key: context.key,
      firstLine: update.firstLine,
      lineCount: update.lineCount,
      lastLine: Math.max(0, update.lineCount - (code.endsWith('\n') ? 2 : 1)),
      lastLineOffset: update.lastLineOffset,
      html: update.html,
      numbers,
      get pending() {
        if (fullPending !== undefined) return fullPending;
        const [before, after] = codeWrapper(
          decorate(`<code${attributes}>`, renderOptions).slice(5, -1),
          language,
          true,
          numbers,
          renderOptions
        );
        return (fullPending =
          context.before +
          before +
          groupLines(update.fullHtml) +
          after +
          context.after);
      },
    };
  };

  /** Use the parser's changed lines without scanning the preceding code again. */
  const formatFenceDelta = (
    update: FenceDelta,
    firstCode: number,
    active: boolean
  ): InternalCodeUpdate | undefined => {
    if (
      !active ||
      fence === undefined ||
      fence.firstCode !== firstCode ||
      options.plugins !== undefined ||
      options.allowedElements !== undefined ||
      options.disallowedElements !== undefined ||
      Object.values(options.components ?? {}).some((hook) => hook !== undefined)
    )
      return;
    const escaped = update.fullHtml;
    const lastLine = Math.max(0, update.lineCount - 2);
    const numbers =
      options.lineNumbers === false
        ? undefined
        : Math.max(1, update.lineCount - 1);
    fence.escaped = escaped;
    fence.start = escaped.length - update.html.length + update.lastLineOffset;
    fence.line = lastLine;
    fence.code = escaped;
    fence.codeStart = fence.start;
    const context = fence;
    const renderOptions = options;
    let fullPending: string | undefined;
    // A literal allocation template can retain the getter and its fence strings.
    const result = Object.create(Object.prototype) as InternalCodeUpdate;
    result.key = context.key;
    result[delta] = update;
    result.firstLine = update.firstLine;
    result.lineCount = update.lineCount;
    result.lastLine = lastLine;
    result.lastLineOffset = update.lastLineOffset;
    result.html = update.html;
    result.numbers = numbers;
    return Object.defineProperty(result, 'pending', {
      enumerable: true,
      configurable: true,
      get() {
        if (fullPending !== undefined) return fullPending;
        const [before, after] = codeWrapper(
          decorate(`<code${context.attributes}>`, renderOptions).slice(5, -1),
          codeLanguage(context.attributes),
          true,
          numbers,
          renderOptions
        );
        return (fullPending =
          context.before +
          before +
          groupLines(update.fullHtml) +
          after +
          context.after);
      },
    });
  };

  return {
    /** Change options. A reset discards completed output and reformats it. */
    configure(next: HtmlOptions, reset = true): void {
      if (reset) resetState();
      options = next;
    },
    render(
      source: string,
      incomplete: boolean,
      active = false
    ): RenderedHtmlUpdate {
      try {
        const update = parser.render(source, { incomplete });
        const change = (update as InternalHtmlUpdate)[delta];
        const fenceDelta = typeof change === 'object' ? change : undefined;
        const paragraphDelta = typeof change === 'string' ? change : undefined;
        if (
          update === previousUpdate &&
          active === pendingActive &&
          result !== undefined
        )
          return result;
        const changed = update !== previousUpdate;
        let reset = false;
        let addition = '';
        if (changed && previousUpdate?.stable === stableRaw && !update.reset) {
          if (update.addition !== '') {
            [addition, nextCode] = formatAddition(
              update.addition,
              nextCode,
              active
            );
            stable += addition;
          }
          stableRaw = update.stable;
          pendingSource =
            fenceDelta === undefined && paragraphDelta === undefined
              ? undefined
              : update;
          if (pendingSource === undefined) pendingRaw = update.pending;
        } else if (changed) {
          const raw = update.stable + update.pending;
          if (
            previousUpdate === undefined ||
            raw.slice(0, stableRaw.length) !== stableRaw
          ) {
            reset = true;
            dispose();
            pendingInput = undefined;
            fence = undefined;
            stable = '';
            stableRaw = '';
            nextCode = 0;
          }
          // Link definitions reset every update. Keep whole top-level blocks
          // that did not change since the previous update as completed HTML,
          // so only the changing tail is formatted and patched.
          let cut = Math.max(update.stable.length, stableRaw.length);
          if (update.reset && cut === stableRaw.length) {
            const previousRaw =
              previousUpdate === undefined
                ? ''
                : previousUpdate.stable + previousUpdate.pending;
            // An open fence formats differently once the stream is inactive.
            const open = raw.indexOf('<pre data-markdown-incomplete', cut);
            const limit = Math.min(
              open < 0 ? raw.length : open,
              previousRaw.length
            );
            const same = unchangedEnd(raw, previousRaw, cut, limit);
            let depth = 0;
            // Identical HTML does not show that the last block has closed.
            for (
              let at = same < raw.length ? raw.indexOf('<', cut) : -1, end = 0;
              at !== -1;
              at = raw.indexOf('<', end)
            ) {
              end = raw.indexOf('>', at) + 1;
              if (end === 0 || end >= same) break;
              if (raw.charCodeAt(at + 1) === 47) depth--;
              else if (!isVoidAt(raw, at, end)) depth++;
              if (depth === 0 && raw.charCodeAt(end) === 10) cut = end + 1;
            }
          }
          if (cut > stableRaw.length) {
            [addition, nextCode] = formatAddition(
              raw.slice(stableRaw.length, cut),
              nextCode,
              active
            );
            stable += addition;
          }
          stableRaw =
            cut === update.stable.length ? update.stable : raw.slice(0, cut);
          pendingRaw = raw.slice(cut);
          pendingSource = undefined;
        }
        previousUpdate = update;
        const textAppend =
          changed &&
          paragraphDelta !== undefined &&
          options.allowedElements === undefined &&
          options.disallowedElements === undefined &&
          !Object.values(options.components ?? {}).some(
            (hook) => hook !== undefined
          ) &&
          (pendingParagraph !== undefined ||
            (pendingFence === undefined &&
              pendingHtml.startsWith(paragraphStart) &&
              pendingHtml.endsWith('</p>\n')))
            ? paragraphDelta
            : undefined;
        if (textAppend !== undefined) {
          pendingParagraph = {
            body:
              (pendingParagraph?.body ??
                pendingHtml.slice(paragraphStart.length, -5)) + textAppend,
          };
          pendingFence = undefined;
          pendingFences = [];
          pendingInput = undefined;
          pendingActive = active;
          pendingCode = nextCode;
        } else {
          pendingParagraph = undefined;
          const fenceUpdate =
            changed && fenceDelta !== undefined
              ? formatFenceDelta(fenceDelta, nextCode, active)
              : undefined;
          if (fenceUpdate !== undefined) {
            pendingFence = fenceUpdate;
            pendingFences = [];
            pendingInput = undefined;
            pendingActive = active;
            pendingCode = nextCode;
          } else {
            if (pendingSource !== undefined) {
              pendingRaw = pendingSource.pending;
              pendingSource = undefined;
            }
            if (
              pendingInput !== pendingRaw ||
              pendingActive !== active ||
              pendingCode !== nextCode
            ) {
              const uses = liveUses;
              pendingFences = [];
              pendingFence = formatFence(pendingRaw, nextCode, active);
              if (pendingFence === undefined) {
                [pendingHtml] = format(
                  pendingRaw,
                  nextCode,
                  active,
                  pendingFences
                );
                fence = undefined;
              }
              // Release the live highlighter once its fence is no longer pending.
              if (liveUses === uses) dispose();
              pendingInput = pendingRaw;
              pendingActive = active;
              pendingCode = nextCode;
            }
          }
        }
        const completedHtml = stable;
        const code = pendingFence;
        const pending = pendingHtml;
        const paragraph = pendingParagraph;
        let fullPending: string | undefined;
        let fullHtml: string | undefined;
        const getPending = (): string => {
          if (fullPending !== undefined) return fullPending;
          if (paragraph !== undefined) {
            fullPending = paragraphStart + paragraph.body + '</p>\n';
            paragraph.body = fullPending.slice(paragraphStart.length, -5);
          } else fullPending = code?.pending ?? pending;
          return fullPending;
        };
        result = {
          get html() {
            return (fullHtml ??= completedHtml + getPending());
          },
          stable: completedHtml,
          addition,
          get pending() {
            return getPending();
          },
          code,
          [delta]: textAppend,
          reset,
          revision: ++revision,
        };
        return result;
      } catch (error) {
        resetState();
        throw error;
      }
    },
    dispose,
  };
}
