import type {
  AnsiOptions,
  HtmlSessionOptions,
  HtmlUpdate,
  RenderOptions,
} from './types';

export type {
  AnsiOptions,
  HtmlSessionOptions,
  HtmlUpdate,
  RenderOptions,
} from './types';

export type { Renderer };

type Input = string | Uint8Array | ArrayBuffer;
type Options = AnsiOptions & RenderOptions;

const enc = new TextEncoder();
const dec = new TextDecoder();
const pageSize = 65536;

class Renderer {
  memory: WebAssembly.Memory;
  wasmRender: () => void;
  wasmComplete: () => number;
  buffer!: Uint8Array<ArrayBuffer>;
  dv!: DataView<ArrayBuffer>;
  pages!: number;

  constructor(wasmModule: WebAssembly.Module) {
    const instance = new WebAssembly.Instance(wasmModule, {});
    this.memory = instance.exports.memory as WebAssembly.Memory;
    this.wasmRender = instance.exports.render as () => void;
    this.wasmComplete = instance.exports.complete as () => number;
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
      this.grow(input.length * 3 + 8192);
      inputLength = enc.encodeInto(
        input,
        this.buffer.subarray(pageSize)
      ).written;
    } else {
      if (input instanceof ArrayBuffer) input = new Uint8Array(input);
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
        (options?.skipHtml === true ? 2 : 0)
    );
    this.dv.setUint32(2, inputLength, true);
    if (options?.incomplete === true) {
      inputLength = this.wasmComplete();
      this.dv.setUint32(2, inputLength, true);
    }
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

  /** Grow the wasm linear memory so the input and its slack fit. */
  grow(len: number) {
    const needed = 1 + Math.ceil(len / pageSize);
    if (needed > this.pages) {
      this.memory.grow(needed - this.pages);
      this.bindMemory();
    }
  }

  /** Rebind the views after the memory grew. */
  bindMemory() {
    if (this.buffer?.buffer === this.memory.buffer) return;
    this.pages = this.memory.buffer.byteLength / pageSize;
    this.buffer = new Uint8Array(this.memory.buffer);
    this.dv = new DataView(this.memory.buffer);
  }
}

let shared: Renderer;

export function init(wasmModule: WebAssembly.Module): Renderer {
  return (shared = new Renderer(wasmModule));
}

export function renderToHtml(input: Input): Uint8Array;
export function renderToHtml<T = Record<string, any>>(
  input: Input,
  options: RenderOptions & { frontmatter: true }
): [T, Uint8Array];
export function renderToHtml(input: Input, options?: RenderOptions): Uint8Array;
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
 * Stream HTML strings directly from Wasm, retaining only the completed HTML
 * prefix and reparsing only the unfinished suffix.
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
      let reset =
        !input.startsWith(previous) ||
        incomplete !== options?.incomplete ||
        definitions;
      if (offset !== 0 && input.charCodeAt(offset) === 0xfeff) reset = true;
      if (reset) {
        stable = '';
        offset = 0;
      }
      let tail = input.slice(offset);
      let rendered = shared.render(tail, 0, {
        skipHtml: true,
        incomplete: options?.incomplete,
      });
      if (offset !== 0 && shared.dv.getUint8(30) !== 0) {
        stable = '';
        offset = 0;
        reset = true;
        tail = input;
        rendered = shared.render(tail, 0, {
          skipHtml: true,
          incomplete: options?.incomplete,
        });
      }
      const html = dec.decode(rendered.output);
      const boundary = shared.dv.getUint32(26, true);
      definitions = shared.dv.getUint8(30) !== 0;
      const completed = definitions
        ? 0
        : dec.decode(shared.buffer.subarray(pageSize, pageSize + boundary))
            .length;
      let pending = html;
      let addition = '';
      if (completed > 0 && completed <= tail.length) {
        addition = dec.decode(
          shared.render(tail.slice(0, completed), 0, {
            skipHtml: true,
            incomplete: options?.incomplete,
          }).output
        );
        stable += addition;
        offset += completed;
        pending = html.slice(addition.length);
      }
      previous = input;
      incomplete = options?.incomplete;
      const completedHtml = stable;
      let fullHtml: string | undefined;
      result = {
        // DOM consumers only need the addition and pending suffix. Assemble the
        // full document only when a string consumer or initial mount asks for it.
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
