import { createHtmlSession } from '@pierre/words';
import type { HtmlUpdate } from '@pierre/words';

import {
  delta,
  type FenceDelta,
  formatFlags,
  format as formatKey,
  type InternalHtmlUpdate,
  type InternalSessionOptions,
} from '../lib/internal';
import {
  decodeHtml,
  defaultUrlTransform,
  escapeHtml,
  isNameCode,
  unchangedEnd,
} from '../lib/utils';
import {
  formatInlineIslands,
  formatIsland,
  formatIslandPending,
  inlineIslandNames,
  islandFor,
} from './islands';
import type {
  CodeHighlighterSession,
  CodeHighlightUpdate,
  HtmlOptions,
  MermaidPlugin,
  PluginConfig,
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
const codeEnd = '</code></pre></div>';
const codeBlockOpen = '<div data-markdown="code-block"';

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

/** The gutter of an open fence, in the same 64-line groups as the code. Wasm writes it for other blocks. */
function lineNumbers(count: number): string {
  let html = '<span data-markdown="line-numbers" aria-hidden="true">';
  for (let line = 1; line <= count; line += 64) {
    html += lineGroup + line;
    for (let next = line + 1; next < line + 64 && next <= count; next++)
      html += '\n' + next;
    html += (line + 64 <= count ? '\n' : '') + '</span>';
  }
  return html + '</span>';
}

/** Whether a filter or hook can rewrite formatted HTML, so output cannot be extended in place. */
export const rewritesElements = (options: HtmlOptions): boolean =>
  options.allowedElements !== undefined ||
  options.disallowedElements !== undefined ||
  (options.components !== undefined &&
    Object.values(options.components).some((hook) => hook !== undefined));

/** The code buttons as bits: 1 for copy, 2 for download. Equal inline option objects give equal bits. */
export const controlFlags = (controls: HtmlOptions['controls']): number => {
  const code = typeof controls === 'object' ? controls.code : controls;
  return code === false
    ? 0
    : typeof code === 'object'
      ? (code.copy === false ? 0 : 1) | (code.download === false ? 0 : 2)
      : 3;
};

/** Hooks can come from untyped code, and a non-string would print as text. */
function hookHtml(html: unknown): string {
  if (typeof html !== 'string')
    throw new TypeError('HTML hooks must return strings');
  return html;
}

/** The plugin that renders code blocks of `language`, if any. */
const rendererFor = (
  plugins: PluginConfig | undefined,
  language: string
): (MermaidPlugin & { frame?: boolean }) | undefined =>
  (language === 'mermaid' ? plugins?.mermaid : undefined) ??
  plugins?.renderers?.find((renderer) =>
    typeof renderer.language === 'string'
      ? renderer.language === language
      : renderer.language.includes(language)
  );

const voidTags = new Set(['br', 'hr', 'img', 'input']);

/**
 * Whether the formatted tag in [at, end) has no closing tag: an HTML void tag
 * or a self-closing SVG tag. Every formatted tag has an attribute after its name.
 */
const isVoidAt = (html: string, at: number, end: number): boolean =>
  html.charCodeAt(end - 2) === 47 ||
  html.startsWith('br ', at + 1) ||
  html.startsWith('hr ', at + 1) ||
  html.startsWith('img ', at + 1) ||
  html.startsWith('input ', at + 1);

/**
 * The start of the open fence in session HTML, or -1. A code block in slots
 * starts with a NUL and its state, which is not "0" for the open fence, and
 * has five NULs.
 */
function openFence(html: string, from: number): number {
  let start = html.indexOf('\0', from);
  while (start !== -1 && html.charCodeAt(start + 1) === 48) {
    for (let slot = 0; slot < 4; slot++) start = html.indexOf('\0', start + 1);
    start = html.indexOf('\0', start + 1);
  }
  return start;
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
  // Kept raw tags such as `<a-card>` may start with the name.
  const expression = new RegExp(`<(/?)${tag}(?=[ />])[^>]*>`, 'g');
  const voidTag = voidTags.has(tag);
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
    const isVoid = voidTag || match[0].endsWith('/>');
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

/**
 * Run the URL hook on each link and image of formatted HTML. With a hook,
 * Wasm leaves these URLs unchecked and footnote links without the id prefix.
 */
function transformUrls(html: string, options: HtmlOptions): string {
  let result = '';
  let from = 0;
  // Wasm escapes `<` in text, so each `<` starts a tag.
  for (
    let at = html.indexOf('<'), end = 0;
    at !== -1;
    at = html.indexOf('<', end)
  ) {
    end = at + 1;
    // Check one character before the slower `startsWith`.
    const first = html.charCodeAt(end);
    const image =
      first === 105 && html.startsWith('img data-markdown="img" src="', end);
    if (
      !image &&
      (first !== 97 || !html.startsWith('a data-markdown="a" href="', end))
    )
      continue;
    const key = image ? 'src' : 'href';
    const start = end + (image ? 29 : 26);
    const close = html.indexOf('"', start);
    end = html.indexOf('>', close) + 1;
    const transformed = options.urlTransform!(
      decodeHtml(html.slice(start, close)),
      key
    );
    let url =
      transformed == null ? '' : (defaultUrlTransform(transformed) ?? '');
    if (url === '' && transformed !== '') {
      // A link loses its `href`. An image goes whole.
      result += html.slice(from, image ? at : start - 7);
      from = image ? end : close + 1;
      continue;
    }
    // Only generated footnote links target the prefixed footnote ids. Values
    // hold no `"`, so only a real attribute follows a closing quote.
    if (!image && url.startsWith('#')) {
      const rest = html.slice(close, end);
      const note = rest.indexOf('" data-footnote-');
      if (note === 0 || (note > 0 && rest.charCodeAt(note - 1) !== 61))
        url = '#' + (options.idPrefix ?? '') + url.slice(1);
    }
    result += html.slice(from, start) + escapeHtml(url);
    from = close;
  }
  return from === 0 ? html : result + html.slice(from);
}

/** Format session output with HTML options. Keeps at most one live highlighter. */
export function createHtmlRenderer(options: HtmlOptions = {}) {
  let parser = createHtmlSession();
  let inlineNames = inlineIslandNames(options.islands);
  let sawInlineIsland = false;
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
  // Whether `pendingRaw` can hold a code block in slots.
  let pendingSlots = false;
  let pendingSource: HtmlUpdate | undefined;
  let pendingInput: string | undefined;
  let pendingActive = false;
  // Whether the source ends inside a line. An open fence runs to the end, so
  // this tells renderers if the last code line is still being written.
  let partial = false;
  let pendingPartial = false;
  let pendingCode = -1;
  let pendingHtml = '';
  let pendingParagraph: { body: string } | undefined;
  let pendingFence: InternalCodeUpdate | undefined;
  // Whether completed output can contain slots as well as the open fence.
  let closedSlots = false;
  // Raw end, formatted end, and next code index at fences in the current pending output.
  let pendingFences: number[] = [];
  // Completed fence output by language and code: highlighted HTML, or what a
  // renderer returned. Resets keep only the fences they reuse.
  let codeCache = new Map<string, string | null>();
  let oldCodeCache = new Map<string, string | null>();
  // The open fence, the formatted HTML around it, and its previous escaped and decoded code.
  let fenceKey = 0;
  let fence:
    | {
        key: number;
        prefix: string;
        suffix: string;
        // The block markup before the gutter, and the `<code>` tag.
        open: string;
        code: string;
        firstCode: number;
        index: number;
        before: string;
        after: string;
        highlighted: boolean;
        escaped: string | undefined;
        start: number;
        line: number;
        text: string;
        textStart: number;
      }
    | undefined;
  const dispose = (): void => {
    const session = live?.session;
    live = undefined;
    session?.dispose();
  };

  /** Drop all state after an option change or a hook error. */
  const resetState = (): void => {
    dispose();
    parser = createHtmlSession();
    sawInlineIsland = false;
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
    pendingPartial = false;
    pendingCode = -1;
    pendingFence = undefined;
    pendingFences = [];
    codeCache = new Map();
    oldCodeCache = new Map();
    fence = undefined;
  };

  /**
   * Run the host-only steps on session HTML: element filters, the URL hook,
   * code plugins, and element hooks. Code blocks for a plugin or filter, and
   * the open fence of an active stream, come in slots, each after a NUL: the
   * state ("0" closed, "1" open fence, "2" open fence of an active stream) and
   * language, the markup before `<code>`, the `<code>` tag, and the escaped
   * code. An open fence has no gutter yet. Without `slots` there is no such
   * block, so the search is skipped.
   */
  const format = (
    input: string,
    firstCode: number,
    fences?: number[],
    slots = true
  ): [string, number] => {
    const { allowedElements, disallowedElements } = options;
    if (allowedElements !== undefined && disallowedElements !== undefined)
      throw new Error('Use either allowedElements or disallowedElements');
    const filtered =
      allowedElements !== undefined || disallowedElements !== undefined;
    const excluded = (tag: string): boolean =>
      allowedElements !== undefined
        ? !allowedElements.includes(tag)
        : disallowedElements!.includes(tag);
    if (rewritesElements(options)) fences = undefined;
    // Tags open inside an excluded element, which is dropped whole. An
    // element can hold code blocks, so the count lasts for the whole input.
    let dropped = 0;
    /** Apply the element filters, then the URL hook, to HTML between code blocks. */
    const pass = (html: string): string => {
      if (sawInlineIsland && options.islands !== undefined)
        html = formatInlineIslands(html, options.islands);
      if (filtered) {
        let result = '';
        let from = 0;
        // Wasm escapes `<` in text, so each `<` starts a tag.
        for (
          let at = html.indexOf('<'), end = 0;
          at !== -1;
          at = html.indexOf('<', end)
        ) {
          const closing = html.charCodeAt(at + 1) === 47;
          end = html.indexOf('>', at) + 1;
          if (dropped > 0) {
            if (!closing) dropped += isVoidAt(html, at, end) ? 0 : 1;
            else if (--dropped === 0) from = end;
            continue;
          }
          let space = at + (closing ? 2 : 1);
          for (
            let code = html.charCodeAt(space);
            code !== 32 && code !== 62;
            code = html.charCodeAt(++space)
          );
          const tag = html.slice(at + (closing ? 2 : 1), space);
          if (!excluded(tag)) continue;
          if (closing && options.unwrapDisallowed !== true) continue;
          result += html.slice(from, at);
          from = end;
          if (
            options.unwrapDisallowed !== true &&
            !voidTags.has(tag) &&
            html.charCodeAt(end - 2) !== 47
          )
            dropped = 1;
        }
        html = dropped > 0 ? result : result + html.slice(from);
      }
      return options.urlTransform === undefined
        ? html
        : transformUrls(html, options);
    };
    let html = '';
    let index = firstCode;
    let cursor = 0;
    for (
      let at = slots ? input.indexOf('\0') : -1;
      at !== -1;
      at = input.indexOf('\0', cursor)
    ) {
      const open = input.indexOf('\0', at + 2);
      const tag = input.indexOf('\0', open + 1);
      const body = input.indexOf('\0', tag + 1);
      const end = input.indexOf('\0', body + 1);
      html += pass(input.slice(cursor, at));
      cursor = end + 1 + codeEnd.length;
      // An excluded element around the block drops it too.
      if (dropped > 0) continue;
      const content = input.slice(body + 1, end);
      if (filtered && (excluded('pre') || excluded('code'))) {
        // A filter for these tags sees the plain block, as the parser writes it.
        html += pass(
          `<pre data-markdown="pre"${input.charCodeAt(at + 1) === 48 ? '' : ' data-markdown-incomplete'}>${input.slice(tag + 1, body)}${content}</code></pre>`
        );
        continue;
      }
      const isIncomplete = input.charCodeAt(at + 1) === 50;
      const language =
        open === at + 2 ? 'text' : decodeHtml(input.slice(at + 2, open));
      const number = index++;
      const island =
        filtered && excluded('div')
          ? undefined
          : islandFor(options.islands, language);
      if (island !== undefined) {
        if (isIncomplete) {
          html += formatIslandPending(island.pending);
          continue;
        }
        // A paused but still open fence stays code.
        if (input.charCodeAt(at + 1) === 48) {
          const block = formatIsland(island, language, decodeHtml(content));
          if (block !== undefined) {
            html += block;
            fences?.push(cursor, html.length, index);
            continue;
          }
        }
      }
      const custom = rendererFor(options.plugins, language);
      if (custom !== undefined) {
        let code = decodeHtml(content);
        // Open code ends with an added LF. Drop it from a partial line.
        if (isIncomplete && partial) code = code.slice(0, -1);
        // The leading NUL keeps these keys apart from the highlighter's.
        const key = '\0' + language + '\0' + code;
        let block = isIncomplete
          ? undefined
          : codeCache.has(key)
            ? codeCache.get(key)
            : oldCodeCache.get(key);
        if (block === undefined)
          block = custom.render({ code, language, isIncomplete });
        if (!isIncomplete) codeCache.set(key, block);
        // A renderer that returns null shows the code block.
        if (block !== null) {
          block = hookHtml(block);
          // A diagram sits in the code block frame: its header and buttons,
          // which are disabled while the fence streams. The buttons of a
          // closed fence take the source from `data-code`; Wasm escapes `"`
          // in code, so the slot content is a safe attribute value.
          if (
            block !== '' &&
            (custom === options.plugins?.mermaid || custom.frame === true)
          ) {
            const start = open + 1 + codeBlockOpen.length;
            const pre = input.indexOf('<pre', start);
            if (pre !== -1 && pre < tag)
              block = `${codeBlockOpen}${isIncomplete ? '' : ` data-code="${content}"`}${input.slice(start, pre)}${block}</div>`;
          }
          html += block;
          fences?.push(cursor, html.length, index);
          continue;
        }
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
        highlighted = live.session.highlight({
          code: decodeHtml(content),
          language,
          isIncomplete,
        });
      } else if (plugin !== undefined) {
        const code = decodeHtml(content);
        const key = language + '\0' + code;
        highlighted = isIncomplete
          ? undefined
          : (codeCache.get(key) ?? oldCodeCache.get(key));
        if (highlighted === undefined) {
          highlighted = plugin.highlight({ code, language, isIncomplete });
          if (!isIncomplete && typeof highlighted === 'string')
            codeCache.set(key, highlighted);
        } else codeCache.set(key, highlighted);
      }
      if (highlighted != null && typeof highlighted !== 'string')
        throw new TypeError('Code highlighters must return HTML strings');
      if (!isIncomplete && live?.index === number) dispose();
      html += input.slice(open + 1, tag);
      if (input.charCodeAt(at + 1) !== 48 && options.lineNumbers !== false) {
        let count = 1;
        for (
          let line = content.indexOf('\n');
          line !== -1 && line < content.length - 1;
          line = content.indexOf('\n', line + 1)
        )
          count++;
        html += lineNumbers(count);
      }
      html +=
        input.slice(tag + 1, body) +
        groupLines(highlighted ?? content) +
        codeEnd;
      fences?.push(cursor, html.length, index);
    }
    html += pass(input.slice(cursor));
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

  /** Move formatted pending fences into completed output without highlighting them again. */
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
          undefined,
          closedSlots
        );
        return [pendingHtml.slice(0, pendingFences[at + 1]) + tail, next];
      }
    }
    // Completed output never holds the open fence.
    return format(input, firstCode, undefined, closedSlots);
  };

  /**
   * Format the last open fence as changed lines when no hook or filter needs
   * its full element. Reuses the HTML around it, so this works in lists and quotes too.
   */
  const formatFence = (
    input: string,
    firstCode: number,
    active: boolean
  ): InternalCodeUpdate | undefined => {
    if (!active || rewritesElements(options)) return;
    const start = openFence(input, 0);
    if (start < 0) return;
    const open = input.indexOf('\0', start + 2);
    const tag = input.indexOf('\0', open + 1);
    const body = input.indexOf('\0', tag + 1) + 1;
    const end = input.indexOf('\0', body);
    const language =
      open === start + 2 ? 'text' : decodeHtml(input.slice(start + 2, open));
    if (
      islandFor(options.islands, language) !== undefined ||
      rendererFor(options.plugins, language) !== undefined
    )
      return;
    const plugin = options.plugins?.code;
    const prefix = input.slice(0, start);
    const suffix = input.slice(end + 1 + codeEnd.length);
    const head = input.slice(open + 1, tag);
    const codeTag = input.slice(tag + 1, body - 1);
    if (
      fence === undefined ||
      prefix !== fence.prefix ||
      suffix !== fence.suffix ||
      head !== fence.open ||
      codeTag !== fence.code ||
      firstCode !== fence.firstCode
    ) {
      const [before, index] = format(prefix, firstCode, undefined, closedSlots);
      fence = {
        key: ++fenceKey,
        prefix,
        suffix,
        open: head,
        code: codeTag,
        firstCode,
        index,
        before,
        after: format(suffix, index + 1, undefined, closedSlots)[0],
        highlighted: false,
        escaped: undefined,
        start: 0,
        line: 0,
        text: '',
        textStart: 0,
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
        (from === 0 ? '' : fence.text.slice(0, fence.textStart)) +
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
    fence.text = code;
    fence.textStart = codeStart;
    const update = lines;
    const count = Math.max(1, update.lineCount - (code.endsWith('\n') ? 1 : 0));
    const numbers = options.lineNumbers === false ? undefined : count;
    const context = fence;
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
        return (fullPending ??=
          context.before +
          context.open +
          (numbers === undefined ? '' : lineNumbers(numbers)) +
          context.code +
          groupLines(update.fullHtml) +
          codeEnd +
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
      rewritesElements(options)
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
    fence.text = escaped;
    fence.textStart = fence.start;
    const context = fence;
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
        return (fullPending ??=
          context.before +
          context.open +
          (numbers === undefined ? '' : lineNumbers(numbers)) +
          context.code +
          groupLines(update.fullHtml) +
          codeEnd +
          context.after);
      },
    });
  };

  return {
    /** Change options. A reset discards completed output and reformats it. */
    configure(next: HtmlOptions, reset = true): void {
      if (reset) resetState();
      if (next.islands !== options.islands)
        inlineNames = inlineIslandNames(next.islands);
      options = next;
    },
    render(
      source: string,
      incomplete: boolean,
      active = false
    ): RenderedHtmlUpdate {
      try {
        const wasPartial = partial;
        const last = source.charCodeAt(source.length - 1);
        partial = incomplete && last !== 10 && last !== 13;
        const controls = controlFlags(options.controls);
        const plugins = options.plugins;
        // Plugins and filters need code blocks in slots.
        const allSlots =
          plugins?.code !== undefined ||
          plugins?.mermaid !== undefined ||
          (plugins?.renderers?.length ?? 0) > 0 ||
          options.allowedElements !== undefined ||
          options.disallowedElements !== undefined;
        closedSlots = allSlots || options.islands !== undefined;
        const sessionOptions: InternalSessionOptions = {
          incomplete,
          cjk: options.cjk,
          math: options.math,
          allowedHtml: options.allowedHtml,
          [formatKey]: {
            flags:
              formatFlags.on |
              (options.lineNumbers === false ? 0 : formatFlags.numbers) |
              ((controls & 1) === 0 ? 0 : formatFlags.copy) |
              ((controls & 2) === 0 ? 0 : formatFlags.download) |
              (active ? formatFlags.active : 0) |
              (allSlots
                ? formatFlags.slots
                : options.islands !== undefined
                  ? formatFlags.islands
                  : 0) |
              (options.urlTransform === undefined ? 0 : formatFlags.rawUrls),
            idPrefix: escapeHtml(options.idPrefix ?? ''),
            inlineNames,
          },
        };
        const update = parser.render(
          source,
          sessionOptions
        ) as InternalHtmlUpdate;
        // Cached prefixes can still contain earlier markers after the tail turns literal.
        if (update.hasInlineIslands === true) sawInlineIsland = true;
        const change = update[delta];
        const slots = closedSlots || update[formatKey] === true;
        const fenceDelta = typeof change === 'object' ? change : undefined;
        const paragraphDelta = typeof change === 'string' ? change : undefined;
        if (
          update === previousUpdate &&
          active === pendingActive &&
          partial === wasPartial &&
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
          if (pendingSource === undefined) {
            pendingRaw = update.pending;
            pendingSlots = slots;
          }
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
            oldCodeCache = codeCache;
            codeCache = new Map();
          }
          // Link definitions reset every update. Keep unchanged top-level
          // blocks as completed HTML, so only the changing tail is formatted.
          let cut = Math.max(update.stable.length, stableRaw.length);
          if (update.reset && cut === stableRaw.length) {
            const previousRaw =
              previousUpdate === undefined
                ? ''
                : previousUpdate.stable + previousUpdate.pending;
            // An open fence formats differently once the stream is inactive.
            const open = slots ? openFence(raw, cut) : -1;
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
          // Take the session's own strings where they fit: a slice of `raw`
          // first copies the whole output.
          const whole = cut === update.stable.length;
          if (cut > stableRaw.length) {
            [addition, nextCode] = formatAddition(
              whole && stableRaw === ''
                ? update.stable
                : raw.slice(stableRaw.length, cut),
              nextCode,
              active
            );
            stable += addition;
          }
          stableRaw = whole ? update.stable : raw.slice(0, cut);
          pendingRaw = whole ? update.pending : raw.slice(cut);
          pendingSlots = slots;
          pendingSource = undefined;
        }
        previousUpdate = update;
        // Completed output moved past the pending start, so an open fence
        // there is a new one, even when it looks like the one before.
        if (addition !== '') {
          fence = undefined;
          pendingInput = undefined;
        }
        const textAppend =
          changed &&
          paragraphDelta !== undefined &&
          !rewritesElements(options) &&
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
              pendingSlots =
                closedSlots ||
                (pendingSource as InternalHtmlUpdate)[formatKey] === true;
              pendingSource = undefined;
            }
            if (
              pendingInput !== pendingRaw ||
              pendingActive !== active ||
              pendingPartial !== partial ||
              pendingCode !== nextCode
            ) {
              const uses = liveUses;
              pendingFences = [];
              pendingFence = pendingSlots
                ? formatFence(pendingRaw, nextCode, active)
                : undefined;
              if (pendingFence === undefined) {
                [pendingHtml] = format(
                  pendingRaw,
                  nextCode,
                  pendingFences,
                  pendingSlots
                );
                fence = undefined;
              }
              // Release the live highlighter once its fence is no longer pending.
              if (liveUses === uses) dispose();
              pendingInput = pendingRaw;
              pendingActive = active;
              pendingPartial = partial;
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
          reset,
          revision: ++revision,
        };
        // A computed key would slow every literal: add this one only when set.
        if (textAppend !== undefined) result[delta] = textAppend;
        return result;
      } catch (error) {
        resetState();
        throw error;
      }
    },
    dispose,
  };
}
