import type { BlobLike, FileLike, ReadableStreamLike } from './types';

type NodeBuffer = Uint8Array & { toString(encoding?: string): string };
interface NodeBufferConstructor {
  from(data: Uint8Array): NodeBuffer;
  from(data: string, encoding?: string): NodeBuffer;
  isBuffer(value: unknown): value is NodeBuffer;
}

const BufferCtor: NodeBufferConstructor | undefined = (
  globalThis as { Buffer?: NodeBufferConstructor }
).Buffer;

export const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

export type ChunkSegment = {
  chunk: Uint8Array;
  eof: boolean;
};

export async function* chunkify(
  source: AsyncIterable<Uint8Array>
): AsyncIterable<ChunkSegment> {
  let pending: Uint8Array | null = null;
  let produced = false;

  for await (const value of source) {
    const bytes = value;

    if (pending && pending.byteLength === MAX_CHUNK_BYTES) {
      yield { chunk: pending, eof: false };
      produced = true;
      pending = null;
    }

    const merged: Uint8Array = pending ? concatChunks(pending, bytes) : bytes;
    pending = null;

    let cursor: Uint8Array = merged;
    while (cursor.byteLength > MAX_CHUNK_BYTES) {
      const chunk: Uint8Array = cursor.slice(0, MAX_CHUNK_BYTES);
      cursor = cursor.slice(MAX_CHUNK_BYTES);
      yield { chunk, eof: false };
      produced = true;
    }

    pending = cursor;
  }

  if (pending) {
    yield { chunk: pending, eof: true };
    produced = true;
  }

  if (!produced) {
    yield { chunk: new Uint8Array(0), eof: true };
  }
}

export async function* toAsyncIterable(
  source:
    | string
    | Uint8Array
    | ArrayBuffer
    | BlobLike
    | FileLike
    | ReadableStreamLike<Uint8Array | ArrayBuffer | ArrayBufferView | string>
    | AsyncIterable<Uint8Array | ArrayBuffer | ArrayBufferView | string>
    | Iterable<Uint8Array | ArrayBuffer | ArrayBufferView | string>
): AsyncIterable<Uint8Array> {
  if (typeof source === 'string') {
    yield new TextEncoder().encode(source);
    return;
  }
  if (source instanceof Uint8Array) {
    yield source;
    return;
  }
  if (source instanceof ArrayBuffer) {
    yield new Uint8Array(source);
    return;
  }
  if (ArrayBuffer.isView(source)) {
    yield new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    return;
  }
  if (isBlobLike(source)) {
    const stream = source.stream();
    if (isAsyncIterable(stream)) {
      for await (const chunk of stream as AsyncIterable<unknown>) {
        yield ensureUint8Array(chunk);
      }
      return;
    }
    if (isReadableStreamLike(stream)) {
      yield* readReadableStream(stream);
      return;
    }
  }
  if (isReadableStreamLike(source)) {
    yield* readReadableStream(source);
    return;
  }
  if (isAsyncIterable(source)) {
    for await (const chunk of source as AsyncIterable<unknown>) {
      yield ensureUint8Array(chunk);
    }
    return;
  }
  if (isIterable(source)) {
    for (const chunk of source as Iterable<unknown>) {
      yield ensureUint8Array(chunk);
    }
    return;
  }
  throw new Error('Unsupported content source; expected binary data');
}

export function base64Encode(bytes: Uint8Array): string {
  if (BufferCtor) {
    return BufferCtor.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const btoaFn = (globalThis as { btoa?: (data: string) => string }).btoa;
  if (typeof btoaFn === 'function') {
    return btoaFn(binary);
  }
  throw new Error('Base64 encoding is not supported in this environment');
}

export function requiresDuplex(body: unknown): boolean {
  if (!body || typeof body !== 'object') {
    return false;
  }

  if (
    typeof (body as { [Symbol.asyncIterator]?: unknown })[
      Symbol.asyncIterator
    ] === 'function'
  ) {
    return true;
  }

  const readableStreamCtor = (
    globalThis as {
      ReadableStream?: new (...args: unknown[]) => unknown;
    }
  ).ReadableStream;
  if (readableStreamCtor && body instanceof readableStreamCtor) {
    return true;
  }

  return false;
}

export function toRequestBody(iterable: AsyncIterable<Uint8Array>): unknown {
  const readableStreamCtor = (
    globalThis as {
      ReadableStream?: new (underlyingSource: unknown) => unknown;
    }
  ).ReadableStream;
  if (typeof readableStreamCtor === 'function') {
    const iterator = iterable[Symbol.asyncIterator]();
    return new readableStreamCtor({
      async pull(controller: {
        enqueue(chunk: Uint8Array): void;
        close(): void;
      }) {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value!);
      },
      async cancel(reason: unknown) {
        if (typeof iterator.return === 'function') {
          await iterator.return(reason);
        }
      },
    });
  }
  return iterable;
}

async function* readReadableStream(
  stream: ReadableStreamLike<unknown>
): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (value !== undefined) {
        yield ensureUint8Array(value);
      }
    }
  } finally {
    reader.releaseLock?.();
  }
}

function ensureUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === 'string') {
    return new TextEncoder().encode(value);
  }
  if (BufferCtor && BufferCtor.isBuffer(value)) {
    return value as Uint8Array;
  }
  throw new Error('Unsupported chunk type; expected binary data');
}

function isBlobLike(value: unknown): value is BlobLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as BlobLike).stream === 'function'
  );
}

function isReadableStreamLike<T>(
  value: unknown
): value is ReadableStreamLike<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ReadableStreamLike<T>).getReader === 'function'
  );
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in (value as Record<string, unknown>)
  );
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.iterator in (value as Record<string, unknown>)
  );
}

function concatChunks(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.byteLength === 0) {
    return b;
  }
  if (b.byteLength === 0) {
    return a;
  }
  const merged = new Uint8Array(a.byteLength + b.byteLength);
  merged.set(a, 0);
  merged.set(b, a.byteLength);
  return merged;
}
