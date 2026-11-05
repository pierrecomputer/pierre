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
/** `boundary` makes Wasm measure the session's safe boundary in UTF-16 units. */
type Options = AnsiOptions & RenderOptions & { boundary?: boolean };

const enc = new TextEncoder();
// Keep a leading U+FEFF so string lengths match the UTF-16 counts from Wasm.
const dec = new TextDecoder('utf-8', { ignoreBOM: true });
const pageSize = 65536;
// Line records keep 30-bit end addresses and the input starts after the first
// 64 KiB page. Another 64 KiB stays free for the closers completion appends.
const maxInput = 2 ** 30 - 2 * pageSize;

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
      this.grow(Math.min(input.length * 3, maxInput + 1) + 8192);
      const { read, written } = enc.encodeInto(
        input,
        this.buffer.subarray(pageSize, pageSize + maxInput + 1)
      );
      if (read < input.length || written > maxInput) throw tooLarge();
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
      this.bindMemory();
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
  let result: HtmlUpdate | undefined;
  let revision = 0;
  return {
    render(input, options) {
      if (typeof input !== 'string')
        throw new TypeError('session input must be a string');
      if (
        input === previous &&
        incomplete === options?.incomplete &&
        result != null
      )
        return result;
      // startsWith takes a slow path for two-byte and rope strings in V8.
      let reset =
        input.length < previous.length ||
        input.slice(0, previous.length) !== previous ||
        incomplete !== options?.incomplete ||
        definitions;
      if (offset !== 0 && input.charCodeAt(offset) === 0xfeff) reset = true;
      // A render can throw, so session state changes only after it succeeds.
      let nextStable = reset ? '' : stable;
      let nextOffset = reset ? 0 : offset;
      const renderOptions = {
        skipHtml: true,
        incomplete: options?.incomplete,
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
      incomplete = options?.incomplete;
      const completedHtml = stable;
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
