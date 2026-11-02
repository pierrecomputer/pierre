import { createHtmlSession } from '@pierre/words';
import type { HtmlUpdate } from '@pierre/words';

import type {
  CodeHighlighterSession,
  CodeHighlightUpdate,
  HtmlOptions,
} from './types';

export type * from './types';

/** A live fence supplies changed lines while retaining a lazy complete string for fallback rendering. */
export interface CodeHtmlUpdate extends CodeHighlightUpdate {
  /** Changes whenever the markup around the fence lines changes. */
  key: number;
  lastLine: number;
  /** Lines shown in the gutter, or undefined without line numbers. */
  numbers: number | undefined;
  readonly pending: string;
}

type RenderedHtmlUpdate = HtmlUpdate & { code?: CodeHtmlUpdate };

const lineGroup = '<span data-markdown="code-lines">';

/**
 * Wrap code HTML in block groups of 64 lines, keeping each LF inside its group
 * so `textContent` is unchanged. A browser then lays out only the last group
 * when a streamed line changes. LFs inside elements never split a group.
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

/** Number gutter lines in the same 64-line block groups as the code. */
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

/** Share the ordinary code wrapper with the incremental body path. */
function codeWrapper(
  attributes: string,
  language: string,
  incomplete: boolean,
  numbers: number | undefined,
  options: HtmlOptions
): [string, string] {
  const controls =
    typeof options.controls === 'object'
      ? options.controls.code
      : options.controls;
  const copy =
    controls !== false &&
    (typeof controls !== 'object' || controls.copy !== false);
  const download =
    controls !== false &&
    (typeof controls !== 'object' || controls.download !== false);
  const button = (action: string): string =>
    `<button type="button" data-code-action="${action.toLowerCase()}" aria-label="${action} code"${incomplete ? ' disabled=""' : ''}>${action}</button>`;
  return [
    `<div data-markdown="code-block" data-language="${escapeHtml(language)}"${incomplete ? ' data-incomplete="true"' : ''}><div data-markdown="code-header"><span>${escapeHtml(language)}</span><span>${copy ? button('Copy') : ''}${download ? button('Download') : ''}</span></div><pre dir="ltr">${numbers === undefined ? '' : `<span data-markdown="line-numbers" aria-hidden="true">${lineNumbers(numbers)}</span>`}<code${attributes}>`,
    '</code></pre></div>',
  ];
}

/** Escape literal application text before inserting it into generated markup. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) =>
    character === '&'
      ? '&amp;'
      : character === '<'
        ? '&lt;'
        : character === '>'
          ? '&gt;'
          : character === '"'
            ? '&quot;'
            : '&#39;'
  );
}

/** Decode only entities emitted by our renderer; never reinterpret decoded markup. */
export function decodeHtml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) =>
    name === 'amp'
      ? '&'
      : name === 'lt'
        ? '<'
        : name === 'gt'
          ? '>'
          : name === 'quot'
            ? '"'
            : "'"
  );
}

/** Reject navigation schemes and ambiguous network paths before browser HTML parsing. */
export function defaultUrlTransform(url: string): string | undefined {
  // oxlint-disable-next-line no-control-regex -- Strip URL controls before validating schemes.
  const normalized = url.replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
  // Browsers read `\` as `/`, so `/\host` and `\\host` are network paths too.
  if (/^(?:\\|\/[\\/])/.test(normalized)) return undefined;
  const scheme = /^([^/?#]*):/.exec(normalized)?.[1];
  return scheme !== undefined && !/^(https?|mailto|tel)$/i.test(scheme)
    ? undefined
    : url;
}

const voidTags = new Set(['br', 'hr', 'img', 'input']);
const generatedTags = [
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'input',
  'li',
  'ol',
  'p',
  'pre',
  'section',
  'strong',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
];
const anyTag = /<(\/?)([a-z][a-z0-9]*)[^>]*>/g;
const fenceStart = /<pre\b[^>]*><code\b([^>]*)>/y;

/**
 * Transform every balanced generated element with string offsets, without an
 * AST. Each open element collects its content until its end tag, so nested
 * elements are transformed first and every element is transformed once.
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
      const replacement = transform(
        match[1] === '' ? match[0] : open.pop()! + piece + match[0]
      );
      if (typeof replacement !== 'string')
        throw new TypeError('HTML hooks must return strings');
      piece = match[1] === '' ? piece + replacement : replacement;
    }
    if (open.length === 0) result += piece;
    else open[open.length - 1] += piece;
  }
  return result + open.join('') + html.slice(cursor);
}

/** Apply the navigation policy only to attributes generated by Wasm, before HTML hooks. */
function decorate(html: string, options: HtmlOptions): string {
  if (
    options.allowedElements !== undefined &&
    options.disallowedElements !== undefined
  )
    throw new Error('Use either allowedElements or disallowedElements');
  if (
    options.allowedElements !== undefined ||
    options.disallowedElements !== undefined
  ) {
    for (const tag of generatedTags) {
      const excluded =
        options.allowedElements !== undefined
          ? !options.allowedElements.includes(tag)
          : (options.disallowedElements?.includes(tag) ?? false);
      if (excluded)
        html =
          options.unwrapDisallowed === true
            ? html.replace(new RegExp(`</?${tag}\\b[^>]*>`, 'g'), '')
            : mapElements(html, tag, () => '');
    }
  }
  return html.replace(
    /<([a-z][a-z0-9]*)([^>]*)>/g,
    (_, tag: string, attributes: string) => {
      if (voidTags.has(tag)) attributes = attributes.replace(/\s*\/$/, '');
      let pending = false;
      let invalidImage = false;
      const footnote = tag === 'a' && attributes.includes(' data-footnote-');
      attributes = attributes.replace(
        / (href|src)="([^"]*)"/g,
        (_attribute, key: 'href' | 'src', value: string) => {
          let url = decodeHtml(value);
          if (url === 'streamdown:incomplete-link') {
            pending = true;
            return '';
          }
          const transformed =
            options.urlTransform === undefined
              ? url
              : options.urlTransform(url, key);
          url =
            transformed == null ? '' : (defaultUrlTransform(transformed) ?? '');
          if (url === '' && transformed !== '') {
            invalidImage ||= tag === 'img';
            return '';
          }
          // Only generated footnote links target the prefixed footnote ids.
          if (footnote && url.startsWith('#'))
            url = '#' + (options.idPrefix ?? '') + url.slice(1);
          return ` ${key}="${escapeHtml(url)}"`;
        }
      );
      if (invalidImage) return '';
      attributes = attributes.replace(
        / id="([^"]*)"/g,
        (_id, id: string) => ` id="${escapeHtml(options.idPrefix ?? '')}${id}"`
      );
      attributes = attributes.replace(
        / align="(left|center|right)"/g,
        ' style="text-align:$1"'
      );
      if (tag === 'img') attributes += ' loading="lazy"';
      if (tag === 'input') attributes += ' readonly=""';
      return `<${tag} data-markdown="${pending ? 'incomplete-link' : tag}"${attributes}>`;
    }
  );
}

/** Retain completed HTML strings and at most one live code highlighter, never Markdown nodes. */
export function createHtmlRenderer(options: HtmlOptions = {}) {
  let parser = createHtmlSession();
  // Formatted completed HTML and the Wasm HTML it was formatted from.
  let stable = '';
  let stableRaw = '';
  let nextCode = 0;
  let live: CodeHighlighterSession | undefined;
  let liveIndex = -1;
  let liveLanguage = '';
  let liveUses = 0;
  let previousUpdate: HtmlUpdate | undefined;
  let result: RenderedHtmlUpdate | undefined;
  let revision = 0;
  let pendingRaw = '';
  let pendingInput: string | undefined;
  let pendingActive = false;
  let pendingCode = -1;
  let pendingHtml = '';
  let pendingFence: CodeHtmlUpdate | undefined;
  // Completed fence HTML by language and code. Resets keep only the fences they reuse.
  let codeCache = new Map<string, string>();
  let oldCodeCache = new Map<string, string>();
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
    live?.dispose();
    live = undefined;
    liveIndex = -1;
  };

  /** Drop partial formatting after options change or a hook fails, so retry reparses fully. */
  const resetState = (): void => {
    dispose();
    parser = createHtmlSession();
    stable = '';
    stableRaw = '';
    nextCode = 0;
    previousUpdate = undefined;
    result = undefined;
    pendingInput = undefined;
    pendingHtml = '';
    pendingActive = false;
    pendingCode = -1;
    pendingFence = undefined;
    codeCache = new Map();
    oldCodeCache = new Map();
    fence = undefined;
  };

  const format = (
    input: string,
    firstCode: number,
    active: boolean
  ): [string, number] => {
    let html = decorate(input, options);
    let index = firstCode;
    html = html.replace(
      /<pre\b([^>]*)><code\b([^>]*)>([\s\S]*?)<\/code><\/pre>/g,
      (_block, pre: string, codeAttributes: string, content: string) => {
        const code = decodeHtml(content);
        const language = decodeHtml(
          /class="language-([^"]*)"/.exec(codeAttributes)?.[1] ?? 'text'
        );
        const isIncomplete = active && pre.includes('data-markdown-incomplete');
        const number = index++;
        const custom = options.plugins?.renderers?.find((renderer) =>
          typeof renderer.language === 'string'
            ? renderer.language === language
            : renderer.language.includes(language)
        );
        if (custom !== undefined)
          return custom.render({ code, language, isIncomplete });
        const plugin = options.plugins?.code;
        // Only a different open fence replaces the live highlighter.
        if (isIncomplete) {
          if (
            live !== undefined &&
            (liveIndex !== number || liveLanguage !== language)
          )
            dispose();
          if (live === undefined) {
            live = plugin?.createSession?.();
            liveIndex = number;
            liveLanguage = language;
          }
        }
        let highlighted: string | null | undefined;
        if (live !== undefined && liveIndex === number) {
          liveUses++;
          highlighted = live.highlight({ code, language, isIncomplete });
        } else if (plugin !== undefined) {
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
        if (!isIncomplete && liveIndex === number) dispose();
        let count = 1;
        for (let at = 0; at < code.length - 1; at++)
          if (code.charCodeAt(at) === 10) count++;
        const [before, after] = codeWrapper(
          codeAttributes,
          language,
          isIncomplete,
          options.lineNumbers === false ? undefined : count,
          options
        );
        return before + groupLines(highlighted ?? content) + after;
      }
    );
    for (const [tag, render] of Object.entries(options.components ?? {})) {
      if (
        render === undefined ||
        (!/^[a-z][a-z0-9]*$/.test(tag) && tag !== 'inlineCode')
      )
        continue;
      if (tag === 'inlineCode') {
        // Fenced code is protected before applying the inline-code hook.
        html = html.replace(
          /<pre\b[^>]*>[\s\S]*?<\/pre>|<code\b[^>]*>[\s\S]*?<\/code>/g,
          (element) => (element.startsWith('<pre') ? element : render(element))
        );
      } else if (
        tag === 'code' &&
        options.components?.inlineCode !== undefined
      ) {
        html = html.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/g, (element) =>
          mapElements(element, 'code', render)
        );
      } else html = mapElements(html, tag, render);
    }
    return [html, index];
  };

  /**
   * Format the last open fence as changed lines when no hook or filter needs
   * its full element. The HTML around the fence is formatted once and reused
   * while it is unchanged, so a fence in a list or quote also stays live.
   */
  const formatFence = (
    input: string,
    firstCode: number,
    active: boolean
  ): CodeHtmlUpdate | undefined => {
    if (
      !active ||
      options.allowedElements !== undefined ||
      options.disallowedElements !== undefined ||
      (options.components !== undefined &&
        Object.values(options.components).some((hook) => hook !== undefined))
    )
      return;
    const start = input.lastIndexOf('<pre data-markdown-incomplete');
    if (start < 0) return;
    fenceStart.lastIndex = start;
    const match = fenceStart.exec(input);
    const body = fenceStart.lastIndex;
    const end = match === null ? -1 : input.indexOf('</code></pre>', body);
    if (match === null || end < 0) return;
    const attributes = match[1];
    const language = decodeHtml(
      /class="language-([^"]*)"/.exec(attributes)?.[1] ?? 'text'
    );
    if (
      options.plugins?.renderers?.some((renderer) =>
        typeof renderer.language === 'string'
          ? renderer.language === language
          : renderer.language.includes(language)
      ) === true
    )
      return;
    const plugin = options.plugins?.code;
    const prefix = input.slice(0, match.index);
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
      (liveIndex !== fence.index || liveLanguage !== language)
    )
      dispose();
    if (live === undefined && plugin !== undefined) {
      live = plugin.createSession?.();
      liveIndex = fence.index;
      liveLanguage = language;
    }
    // Plugins without line updates re-highlight the whole fence through format().
    if (plugin !== undefined && live?.highlightLines === undefined) return;
    // Appended source changes the escaped code only from its previous last
    // line, so decode and count lines from there.
    const escaped = input.slice(body, end);
    const length = escaped.endsWith('\n') ? escaped.length - 1 : escaped.length;
    const lastStart =
      length === 0 ? 0 : escaped.lastIndexOf('\n', length - 1) + 1;
    const unchanged = escaped === fence.escaped;
    const from =
      fence.escaped !== undefined &&
      lastStart >= fence.start &&
      escaped.startsWith(fence.escaped.slice(0, fence.start))
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
      live?.highlightLines?.({ code, language, isIncomplete: true }) ?? null;
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
    let fullPending: string | undefined;
    return {
      key: context.key,
      firstLine: update.firstLine,
      lineCount: update.lineCount,
      lastLine: Math.max(0, update.lineCount - (code.endsWith('\n') ? 2 : 1)),
      lastLineOffset: update.lastLineOffset,
      html: update.html,
      numbers,
      get fullHtml() {
        return update.fullHtml;
      },
      get pending() {
        if (fullPending !== undefined) return fullPending;
        const [before, after] = codeWrapper(
          decorate(`<code${attributes}>`, options).slice(5, -1),
          language,
          true,
          numbers,
          options
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

  return {
    /** Reconfigure the same formatter. A reset drops caches, so completed output is formatted again. */
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
            [addition, nextCode] = format(update.addition, nextCode, active);
            stable += addition;
          }
          stableRaw = update.stable;
          pendingRaw = update.pending;
        } else if (changed) {
          const raw = update.stable + update.pending;
          if (previousUpdate === undefined || !raw.startsWith(stableRaw)) {
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
          // Link definitions reset every update. Keep whole top-level blocks
          // that did not change since the previous update as completed HTML,
          // so only the changing tail is formatted and patched.
          let cut = Math.max(update.stable.length, stableRaw.length);
          if (update.reset && cut === stableRaw.length) {
            const previousRaw =
              previousUpdate === undefined
                ? ''
                : previousUpdate.stable + previousUpdate.pending;
            let same = cut;
            // An open fence formats differently once the stream is inactive.
            const open = raw.indexOf('<pre data-markdown-incomplete', cut);
            const limit = Math.min(
              open < 0 ? raw.length : open,
              previousRaw.length
            );
            while (
              same < limit &&
              raw.charCodeAt(same) === previousRaw.charCodeAt(same)
            )
              same++;
            let depth = 0;
            anyTag.lastIndex = cut;
            for (
              let match = anyTag.exec(raw);
              match !== null && anyTag.lastIndex < same;
              match = anyTag.exec(raw)
            ) {
              if (match[1] !== '') depth--;
              else if (!voidTags.has(match[2])) depth++;
              if (depth === 0 && raw.charCodeAt(anyTag.lastIndex) === 10)
                cut = anyTag.lastIndex + 1;
            }
          }
          if (cut > stableRaw.length) {
            [addition, nextCode] = format(
              raw.slice(stableRaw.length, cut),
              nextCode,
              active
            );
            stable += addition;
          }
          stableRaw =
            cut === update.stable.length ? update.stable : raw.slice(0, cut);
          pendingRaw = raw.slice(cut);
        }
        previousUpdate = update;
        if (
          pendingInput !== pendingRaw ||
          pendingActive !== active ||
          pendingCode !== nextCode
        ) {
          const uses = liveUses;
          pendingFence = formatFence(pendingRaw, nextCode, active);
          if (pendingFence === undefined)
            [pendingHtml] = format(pendingRaw, nextCode, active);
          // Release the live highlighter once its fence left the mutable HTML.
          if (liveUses === uses) dispose();
          pendingInput = pendingRaw;
          pendingActive = active;
          pendingCode = nextCode;
        }
        const completedHtml = stable;
        const code = pendingFence;
        const pending = pendingHtml;
        let fullPending: string | undefined;
        let fullHtml: string | undefined;
        result = {
          get html() {
            return (fullHtml ??= completedHtml + (code?.pending ?? pending));
          },
          stable: completedHtml,
          addition,
          get pending() {
            return (fullPending ??= code?.pending ?? pending);
          },
          code,
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
