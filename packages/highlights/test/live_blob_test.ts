import assert from 'node:assert';
import t from 'node:test';

import { transformWat, wat2wasm } from '../scripts/build';

void t.test(
  'live wasm: restoring a trimmed maximum-size state clears its tail',
  () => {
    const url = new URL('./live_blob_test.wat', import.meta.url);
    const { code } = transformWat(
      url,
      `(module
      (import "../src/highlights.wat")
      (export "capture" (func $lvCaptureBlob))
      (export "trim" (func $lvTrimBlob))
      (export "load" (func $lvLoadBlob))
      (func (export "prepare")
        (global.set $lvLang (enum.get $Language.json))
        (global.set $liveStackBytes (i32.const 1024))
        (global.set $jsTemplateLexSp (i32.const 256))
        (global.set $jsTemplateEmitSp (i32.const 256))
        (global.set $brkSp (i32.const 1024))
        (global.set $jsxSp (i32.const 512))))`
    );
    const raw = new WebAssembly.Instance(
      new WebAssembly.Module(wat2wasm(url.pathname, code)),
      { env: { is_id_start: () => 0, is_id_continue: () => 0 } }
    ).exports as unknown as {
      memory: WebAssembly.Memory;
      liveStage(size: number): number;
      prepare(): void;
      capture(dst: number): number;
      trim(dst: number, len: number): number;
      load(dst: number, node: number): void;
    };
    const base = raw.liveStage(65536);
    const node = base;
    const scratch = base + 32768;
    raw.prepare();
    const length = raw.capture(node + 24);
    const bytes = new Uint8Array(raw.memory.buffer);
    const expected = bytes.slice(node + 24, node + 24 + length);
    const trimmed = raw.trim(node + 24, length);
    assert.ok(trimmed < length - 4, 'the checkpoint tail must be zero-trimmed');
    new DataView(raw.memory.buffer).setUint32(node + 8, trimmed, true);
    bytes.fill(0xa5, scratch, scratch + length);
    raw.load(scratch, node);
    assert.equal(raw.capture(scratch), length);
    assert.deepEqual(bytes.slice(scratch, scratch + length), expected);
  }
);
