const enc = new TextEncoder();
const dec = new TextDecoder();
const pageSize = 65536;

class Renderer {
  /** @param {WebAssembly.Module} wasmModule */
  constructor(wasmModule) {
    const instance = new WebAssembly.Instance(wasmModule, {});
    this.memory = instance.exports.memory;
    this.wasmRender = instance.exports.render;
    this.wasmElements = instance.exports.elements;
    this.wasmComplete = instance.exports.complete;
    this.bindMemory();
  }

  /**
   * Render markdown and return a view of the result in wasm memory.
   * @param {string | Uint8Array | ArrayBuffer} input
   * @param {number} mode 0 = html, 1 = ansi
   * @param {{frontmatter?: boolean, width?: number}} options
   * @returns {{output: Uint8Array, meta?: Uint8Array}}
   */
  render(input, mode, options) {
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
      (options?.frontmatter ? 1 : 0) | (options?.skipHtml ? 2 : 0)
    );
    this.dv.setUint32(2, inputLength, true);
    if (options?.incomplete) {
      inputLength = this.wasmComplete();
      this.dv.setUint32(2, inputLength, true);
    }
    this.dv.setUint32(
      22,
      options?.width > 0 ? Math.min(options.width, 4096) : 0,
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
    const ret = {
      output: this.buffer.subarray(outStart, outStart + outLength),
    };
    if (metaStart)
      ret.meta = this.buffer.subarray(metaStart, metaStart + metaLength);
    return ret;
  }

  /** Grow the wasm linear memory so the input and its slack fit. */
  grow(len) {
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

/** @type {Renderer} */
let shared;

/**
 * Initialize the renderer from a compiled WebAssembly module.
 * @param {WebAssembly.Module} wasmModule
 * @returns {Renderer}
 */
export function init(wasmModule) {
  return (shared = new Renderer(wasmModule));
}

/**
 * Render markdown and return a view of the result in wasm memory.
 * @param {string | Uint8Array | ArrayBuffer} input
 * @param {number} mode 0 = html, 1 = ansi
 * @param {{frontmatter?: boolean, width?: number}} options
 * @returns {Uint8Array | [unknown, Uint8Array]}
 */
function render(input, mode, options) {
  const { output, meta } = shared.render(input, mode, options);
  if (!options?.frontmatter) return output;
  return [meta ? JSON.parse(dec.decode(meta)) : null, output];
}

/**
 * Render GitHub Flavored Markdown as HTML.
 * @param {string | Uint8Array | ArrayBuffer} input
 * @param {{frontmatter?: boolean}} [options]
 */
export function renderToHtml(input, options) {
  return render(input, 0, options);
}

/**
 * Render GitHub Flavored Markdown as ANSI-styled text for a terminal.
 * @param {string | Uint8Array | ArrayBuffer} input
 * @param {{width?: number}} [options]
 */
export function renderToAnsi(input, options) {
  return render(input, 1, { width: options?.width });
}

/** Decode only the entities emitted by our HTML backend, exactly once. */
function decodeOutput(value) {
  return value.replace(
    /&(amp|lt|gt|quot|#39);/g,
    (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[name]
  );
}

/**
 * Assemble owned element objects from the WAT event tape. Raw HTML is omitted;
 * URL policies belong to the consumer (the React adapter applies them).
 */
function parseElements(input, options, checkpoint = false) {
  shared.render(input, 0, { skipHtml: true, incomplete: options?.incomplete });
  try {
    shared.wasmElements();
  } finally {
    shared.bindMemory();
  }
  const start = shared.dv.getUint32(6, true);
  const end = start + shared.dv.getUint32(10, true);
  const root = { type: 'element', tagName: '', properties: {}, children: [] };
  const stack = [root];
  const read = (a, b) => decodeOutput(dec.decode(shared.buffer.subarray(a, b)));
  for (let at = start; at < end; at += 20) {
    const kind = shared.dv.getUint32(at, true);
    const text = read(
      shared.dv.getUint32(at + 4, true),
      shared.dv.getUint32(at + 8, true)
    );
    const parent = stack[stack.length - 1];
    if (kind === 1) {
      const node = {
        type: 'element',
        tagName: text,
        properties: {},
        children: [],
      };
      parent.children.push(node);
      stack.push(node);
    } else if (kind === 2) {
      if (stack.length > 1) stack.pop();
    } else if (kind === 3) {
      if (text === 'data-markdown-incomplete') {
        parent.incomplete = true;
        continue;
      }
      parent.properties[text] = read(
        shared.dv.getUint32(at + 12, true),
        shared.dv.getUint32(at + 16, true)
      );
    } else if (kind === 4) {
      // Whitespace between table elements is formatting, not a React text child.
      if (
        text.trim() !== '' ||
        !['', 'table', 'thead', 'tbody', 'tr', 'ul', 'ol'].includes(
          parent.tagName
        )
      ) {
        parent.children.push({ type: 'text', value: text });
      }
    } else if (
      kind === 5 &&
      ['hr', 'br', 'img', 'input'].includes(parent.tagName)
    ) {
      stack.pop();
    }
  }
  const boundary = shared.dv.getUint32(26, true);
  return {
    nodes: root.children,
    boundary: checkpoint
      ? dec.decode(shared.buffer.subarray(pageSize, pageSize + boundary)).length
      : 0,
    definitions: shared.dv.getUint8(30) !== 0,
  };
}

/** Render owned elements with no session state. */
export function renderToElements(input, options) {
  return parseElements(input, options).nodes;
}

/**
 * Cache completed top-level blocks while reparsing the open tail. Definitions
 * can affect any earlier block, so their presence disables prefix reuse.
 * Session results are owned objects; callers should treat them as immutable.
 */
export function createMarkdownSession() {
  let previous = '';
  let prefix = [];
  let offset = 0;
  let definitions = false;
  let incomplete;
  let result;
  return {
    render(input, options) {
      if (typeof input !== 'string')
        throw new TypeError('session input must be a string');
      if (input === previous && incomplete === options?.incomplete && result)
        return result;
      if (
        !input.startsWith(previous) ||
        incomplete !== options?.incomplete ||
        definitions
      ) {
        offset = 0;
        prefix = [];
      }
      let tail = input.slice(offset);
      // A BOM is special only at the start of the original document.
      if (offset && tail.startsWith('\uFEFF')) {
        offset = 0;
        prefix = [];
        tail = input;
      }
      let parsed = parseElements(tail, options, true);
      if (parsed.definitions && offset) {
        offset = 0;
        prefix = [];
        tail = input;
        parsed = parseElements(tail, options, true);
      }
      definitions = parsed.definitions;
      result = prefix.concat(parsed.nodes);
      // Reparse the newly completed region once to obtain its owned nodes.
      // The open suffix will be the only region parsed on subsequent appends.
      if (
        !definitions &&
        parsed.boundary > 0 &&
        parsed.boundary <= tail.length
      ) {
        prefix = prefix.concat(
          renderToElements(tail.slice(0, parsed.boundary), options)
        );
        offset += parsed.boundary;
      }
      previous = input;
      incomplete = options?.incomplete;
      return result;
    },
  };
}
