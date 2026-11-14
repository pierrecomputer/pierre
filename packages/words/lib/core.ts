import type {
  FenceDelta,
  InternalHtmlUpdate,
  delta as protocolDelta,
} from './internal';
import type {
  AnsiOptions,
  Frontmatter,
  HtmlSessionOptions,
  HtmlUpdate,
  RenderOptions,
} from './types';

export type {
  AnsiOptions,
  Frontmatter,
  HtmlSessionOptions,
  HtmlUpdate,
  RenderOptions,
} from './types';

type Input = string | Uint8Array | ArrayBuffer;
type Options = AnsiOptions & RenderOptions & { boundary?: boolean };

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true });
const pageSize = 65536;
const maxInput = 2 ** 30 - 2 * pageSize;

// Keep the core entrypoint self-contained while sharing the renderer's private key.
const delta = Symbol.for(
  '@pierre/words/stream-delta/v1'
) as typeof protocolDelta;

// oxlint-disable-next-line no-control-regex -- Control bytes require parser normalization.
const paragraphSyntax = /[\u0000-\u001f"&<>@\\[\]`*_~:\uD800-\uDFFF]/u;

/** Escape appended fence text exactly as the Wasm text writer does. */
function escapeCode(value: string): string {
  return value.replace(/[&"<>]/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      case '<':
        return '&lt;';
      default:
        return '&gt;';
    }
  });
}

/**
 * A possible closing fence must go through the full block parser: a finished
 * line that closes the fence, or a last line that can still grow into one.
 */
function fenceMayClose(
  input: string,
  previousLength: number,
  line: number,
  marker: number,
  count: number
): boolean {
  for (;;) {
    let at = line;
    while (at < line + 3 && input.charCodeAt(at) === 32) at++;
    const run = at;
    while (input.charCodeAt(at) === marker) at++;
    if (at > run) {
      const length = at - run;
      let code = input.charCodeAt(at);
      while (code === 32 || code === 9) code = input.charCodeAt(++at);
      if (at === input.length || (code === 10 && length >= count)) return true;
    }
    const end = input.indexOf('\n', Math.max(line, previousLength));
    if (end < 0) return false;
    line = end + 1;
  }
}

class Renderer {
  memory: WebAssembly.Memory;
  wasmRender: () => void;
  buffer!: Uint8Array<ArrayBuffer>;
  dv!: DataView<ArrayBuffer>;
  pages!: number;

  constructor(wasmModule: WebAssembly.Module) {
    const instance = new WebAssembly.Instance(wasmModule, {});
    this.memory = instance.exports.memory as WebAssembly.Memory;
    this.wasmRender = instance.exports.render as () => void;
    // A random label hash seed, so crafted reference labels cannot share a
    // slot. Math.random suffices and avoids ~2 MiB of webcrypto setup in Node.
    (instance.exports.seed as (seed: number) => void)(
      (Math.random() * 2 ** 32) >>> 0
    );
    this.bindMemory();
  }

  render(
    input: Input,
    mode: number,
    options?: Options
  ): { output: Uint8Array; meta?: Uint8Array } {
    if (
      typeof input !== 'string' &&
      !(input instanceof Uint8Array) &&
      !(input instanceof ArrayBuffer)
    ) {
      throw new TypeError('input must be a string, Uint8Array, or ArrayBuffer');
    }
    let inputLength;
    if (typeof input === 'string') {
      // Encode in chunks that each have worst-case room. One worst-case
      // buffer would triple the memory of ASCII text, and Bun's encodeInto is
      // several times slower when the text may not fit.
      let written = 0;
      for (let read = 0; read < input.length; ) {
        let end = Math.min(read + 16384, input.length);
        // keep a surrogate pair in one chunk
        if (
          end < input.length &&
          (input.charCodeAt(end - 1) & 0xfc00) === 0xd800
        )
          end--;
        this.grow(Math.min(written + (end - read) * 3, maxInput + 1) + 8192);
        const next = enc.encodeInto(
          end - read === input.length ? input : input.slice(read, end),
          this.buffer.subarray(pageSize + written, pageSize + maxInput + 1)
        );
        written += next.written;
        if (next.read < end - read || written > maxInput) throw tooLarge();
        read = end;
      }
      inputLength = written;
    } else {
      if (input instanceof ArrayBuffer) input = new Uint8Array(input);
      if (input.length > maxInput) throw tooLarge();
      // growing detaches the old buffer, so copy an aliasing input first
      if (input.buffer === this.memory.buffer) input = input.slice();
      this.grow(input.length + 8192);
      this.buffer.set(input, pageSize);
      inputLength = input.length;
    }
    this.dv.setUint8(0, mode);
    this.dv.setUint8(
      1,
      (options?.frontmatter === true ? 1 : 0) |
        (options?.skipHtml === true ? 2 : 0) |
        (options?.boundary === true ? 8 : 0) |
        (mode === 1 && typeof input !== 'string' ? 32 : 0) |
        (options?.incomplete === true ? 64 : 0)
    );
    this.dv.setUint32(2, inputLength, true);
    this.dv.setUint32(
      22,
      options?.width != null && options.width > 0
        ? Math.min(options.width, 4096)
        : 0,
      true
    );
    // the NUL sentinel and the slack the SIMD scans read into
    this.buffer.fill(0, pageSize + inputLength, pageSize + inputLength + 32);
    try {
      this.wasmRender();
    } finally {
      // Growing Wasm's non-shared memory detaches the previous views.
      if (this.buffer.byteLength === 0) this.bindMemory();
    }
    const outStart = this.dv.getUint32(6, true);
    const outLength = this.dv.getUint32(10, true);
    const metaStart = this.dv.getUint32(14, true);
    const metaLength = this.dv.getUint32(18, true);
    const ret: { output: Uint8Array; meta?: Uint8Array } = {
      output: this.buffer.subarray(outStart, outStart + outLength),
    };
    if (metaStart !== 0)
      ret.meta = this.buffer.subarray(metaStart, metaStart + metaLength);
    return ret;
  }

  grow(len: number) {
    const needed = 1 + Math.ceil(len / pageSize);
    if (needed > this.pages) {
      this.memory.grow(needed - this.pages);
      this.bindMemory();
    }
  }

  bindMemory() {
    if (this.buffer?.buffer === this.memory.buffer) return;
    this.pages = this.memory.buffer.byteLength / pageSize;
    this.buffer = new Uint8Array(this.memory.buffer);
    this.dv = new DataView(this.memory.buffer);
  }
}

let shared: Renderer;

const tooLarge = () =>
  new RangeError(`input exceeds ${maxInput} bytes of UTF-8`);

export function init(wasmModule: WebAssembly.Module): Renderer {
  return (shared = new Renderer(wasmModule));
}

export function renderToHtml(input: Input): Uint8Array;
export function renderToHtml<T = Frontmatter>(
  input: Input,
  options: RenderOptions & { frontmatter: true }
): [T | null, Uint8Array];
export function renderToHtml(
  input: Input,
  options?: RenderOptions & { frontmatter?: false }
): Uint8Array;
export function renderToHtml<T = Frontmatter>(
  input: Input,
  options: RenderOptions
): Uint8Array | [T | null, Uint8Array];
export function renderToHtml(
  input: Input,
  options?: RenderOptions
): Uint8Array | [unknown, Uint8Array] {
  const { output, meta } = shared.render(input, 0, options);
  if (options?.frontmatter !== true) return output;
  return [meta != null ? JSON.parse(dec.decode(meta)) : null, output];
}

export function renderToAnsi(input: Input, options?: AnsiOptions): Uint8Array {
  return shared.render(input, 1, { width: options?.width }).output;
}

/**
 * Render a growing string to HTML. A session keeps completed HTML and reparses
 * only the unfinished end.
 */
export function createHtmlSession(): {
  render(input: string, options?: HtmlSessionOptions): HtmlUpdate;
} {
  let previous = '';
  let stable = '';
  let offset = 0;
  let definitions = false;
  let incomplete: boolean | undefined;
  let result: InternalHtmlUpdate | undefined;
  let revision = 0;
  let paragraph: { body: string; spaces: number; links: boolean } | undefined;
  let openFence:
    | {
        prefix: string;
        body: string;
        marker: number;
        count: number;
        line: number;
        tail: string;
        firstLine: number;
      }
    | undefined;
  return {
    render(input, options) {
      if (typeof input !== 'string')
        throw new TypeError('session input must be a string');
      // A missing option and `false` are the same mode.
      const wanted = options?.incomplete === true;
      if (input === previous && incomplete === wanted && result != null)
        return result;
      // V8 compares slices with memcmp, but its startsWith reads each character.
      let reset =
        input.length < previous.length ||
        input.slice(0, previous.length) !== previous ||
        incomplete !== wanted ||
        definitions;
      if (offset !== 0 && input.charCodeAt(offset) === 0xfeff) reset = true;
      if (!reset && paragraph !== undefined) {
        const appended = input.slice(previous.length);
        if (
          !paragraphSyntax.test(appended) &&
          (!paragraph.links || !/[()]/.test(appended)) &&
          !/www\./i.test(previous.slice(-3) + appended)
        ) {
          let end = appended.length;
          while (appended.charCodeAt(end - 1) === 32) end--;
          const text =
            end === 0
              ? ''
              : ' '.repeat(paragraph.spaces) +
                dec.decode(enc.encode(appended.slice(0, end)));
          const context = {
            body: paragraph.body + text,
            links: paragraph.links,
            spaces:
              end === 0
                ? paragraph.spaces + appended.length
                : appended.length - end,
          };
          let pending: string | undefined;
          const getPending = (): string => {
            if (pending === undefined) {
              pending = '<p>' + context.body + '</p>\n';
              context.body = pending.slice(3, -5);
            }
            return pending;
          };
          paragraph = context;
          previous = input;
          const completedHtml = stable;
          let fullHtml: string | undefined;
          result = {
            get html() {
              return (fullHtml ??= completedHtml + getPending());
            },
            stable: completedHtml,
            addition: '',
            get pending() {
              return getPending();
            },
            reset: false,
            revision: ++revision,
            [delta]: text,
          };
          return result;
        }
      }
      if (!reset && openFence !== undefined) {
        const appended = input.slice(previous.length);
        if (
          !/[\0\r\uD800-\uDFFF]/u.test(appended) &&
          !fenceMayClose(
            input,
            previous.length,
            openFence.line,
            openFence.marker,
            openFence.count
          )
        ) {
          // Own the new text: source slices could otherwise retain every earlier document.
          const literal = dec.decode(enc.encode(appended));
          const escaped = escapeCode(literal);
          let body = openFence.body + escaped;
          const changed = openFence.tail + escaped;
          const ending = body === '' || input.endsWith('\n') ? '' : '\n';
          const html = changed + ending;
          const length = html.endsWith('\n') ? html.length - 1 : html.length;
          const lastStart =
            length === 0 ? 0 : html.lastIndexOf('\n', length - 1) + 1;
          const firstLine = openFence.firstLine;
          let lineCount = firstLine + 1;
          for (
            let at = html.indexOf('\n');
            at >= 0;
            at = html.indexOf('\n', at + 1)
          )
            lineCount++;
          const lastLine = appended.lastIndexOf('\n');
          const context = {
            ...openFence,
            body,
            line:
              lastLine < 0 ? openFence.line : previous.length + lastLine + 1,
            tail: changed.slice(lastStart),
            firstLine: Math.max(0, lineCount - 2),
          };
          const suffix = ending + '</code></pre>\n';
          const fence: FenceDelta = {
            text: literal,
            replaceNewline: openFence.body !== '' && !previous.endsWith('\n'),
            firstLine,
            lineCount,
            html,
            lastLineOffset: lastStart,
            get fullHtml() {
              return body + ending;
            },
          };
          let pending: string | undefined;
          const getPending = (): string => {
            if (pending === undefined) {
              pending = context.prefix + body + suffix;
              // Share the materialized output instead of retaining its old rope pieces too.
              body = pending.slice(
                context.prefix.length,
                context.prefix.length + body.length
              );
              context.body = body;
              context.tail = body.slice(body.length - context.tail.length);
            }
            return pending;
          };
          openFence = context;
          previous = input;
          const completedHtml = stable;
          let fullHtml: string | undefined;
          result = {
            get html() {
              return (fullHtml ??= completedHtml + getPending());
            },
            stable: completedHtml,
            addition: '',
            get pending() {
              return getPending();
            },
            reset: false,
            revision: ++revision,
            [delta]: fence,
          };
          return result;
        }
      }
      // A render can throw, so session state changes only after it succeeds.
      let nextStable = reset ? '' : stable;
      let nextOffset = reset ? 0 : offset;
      const renderOptions = {
        skipHtml: true,
        incomplete: wanted,
        boundary: true,
      };
      let tail = input.slice(nextOffset);
      let rendered = shared.render(tail, 0, renderOptions);
      if (nextOffset !== 0 && shared.dv.getUint8(30) !== 0) {
        nextStable = '';
        nextOffset = 0;
        reset = true;
        tail = input;
        rendered = shared.render(tail, 0, renderOptions);
      }
      const html = dec.decode(rendered.output);
      definitions = shared.dv.getUint8(30) !== 0;
      // Wasm measures the source and HTML before the boundary in UTF-16 units.
      const completed = definitions ? 0 : shared.dv.getUint32(36, true);
      let pending = html;
      let addition = '';
      if (completed > 0 && completed <= tail.length) {
        addition = html.slice(0, shared.dv.getUint32(40, true));
        nextStable += addition;
        nextOffset += completed;
        pending = html.slice(addition.length);
      }
      stable = nextStable;
      offset = nextOffset;
      previous = input;
      incomplete = wanted;
      const completedHtml = stable;
      paragraph = undefined;
      // Option bit 7: completion hid or closed something, so the source no
      // longer tells what the paragraph shows.
      if (
        !definitions &&
        (shared.dv.getUint8(1) & 128) === 0 &&
        pending.startsWith('<p>') &&
        pending.endsWith('</p>\n')
      ) {
        const body = pending.slice(3, -5);
        let end = input.length;
        while (input.charCodeAt(end - 1) === 32) end--;
        const tail = input.slice(offset, end).trimStart();
        // A literal final word excludes synthetic inline closers. New block
        // markers, unfinished HTML, entities, and autolinks need the parser.
        const word = tail.slice(tail.lastIndexOf(' ') + 1);
        if (
          word !== '' &&
          !paragraphSyntax.test(tail.slice(-2)) &&
          // Completion skips Unicode whitespace at the end, so only a visible
          // last character shows that it left nothing waiting to close.
          !/\s/.test(tail.slice(-1)) &&
          !/[&<>@:]/.test(word) &&
          !/www\./i.test(word) &&
          body.endsWith(word) &&
          // Only digits or only marker characters can still become a list
          // marker, a heading, or a thematic break.
          !/^(?:\d+[.)]?|[-=+# ]+)$/.test(tail) &&
          !(tail.startsWith('[') && tail.includes(']:')) &&
          // This reads the whole paragraph, so it runs last.
          !/[<\r\n\t\0]/.test(tail)
        )
          paragraph = {
            body,
            spaces: input.length - end,
            links: tail.includes('['),
          };
      }
      openFence = undefined;
      if (
        !definitions &&
        pending.startsWith('<pre data-markdown-incomplete><code') &&
        pending.endsWith('</code></pre>\n')
      ) {
        const firstLine = input.indexOf('\n', offset);
        const opener = input.slice(offset, firstLine);
        const last = input.charCodeAt(input.length - 1);
        if (
          firstLine >= offset &&
          /^(`{3,}|~{3,})[^\r\n]*$/.test(opener) &&
          last !== 13 &&
          !(last >= 0xd800 && last <= 0xdbff)
        ) {
          const start = pending.indexOf('>', pending.indexOf('<code')) + 1;
          let body = pending.slice(start, -14);
          if (input.length > firstLine + 1 && !input.endsWith('\n'))
            body = body.slice(0, -1);
          const length = body.endsWith('\n') ? body.length - 1 : body.length;
          const lastStart =
            length === 0 ? 0 : body.lastIndexOf('\n', length - 1) + 1;
          let line = 0;
          for (
            let at = body.indexOf('\n');
            at >= 0 && at < lastStart;
            at = body.indexOf('\n', at + 1)
          )
            line++;
          const source = input.slice(offset);
          const marker = opener.charCodeAt(0);
          let count = 3;
          while (opener.charCodeAt(count) === marker) count++;
          openFence = {
            prefix: pending.slice(0, start),
            body,
            marker,
            count,
            line:
              offset +
              Math.max(source.lastIndexOf('\n'), source.lastIndexOf('\r')) +
              1,
            tail: body.slice(lastStart),
            firstLine: line,
          };
        }
      }
      let fullHtml: string | undefined;
      result = {
        // The DOM renderer reads only `addition` and `pending`, so build this on demand.
        get html() {
          return (fullHtml ??= completedHtml + pending);
        },
        stable: completedHtml,
        addition,
        pending,
        reset,
        revision: ++revision,
      };
      return result;
    },
  };
}
