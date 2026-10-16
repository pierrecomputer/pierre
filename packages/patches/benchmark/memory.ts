import * as jsdiff from 'diff';
// Print the bytes one call allocates, in a fresh process. `moonx patches:bench -- --memory` runs this
// with BUN_JSC_useGC=0, so nothing is freed or reused during the call.
// argv: "mine" | "theirs", api, fixture name, "perLine"?; stdin: patch.wasm (mine only)
import { readFileSync } from 'node:fs';

import * as core from '../lib/core';
import { type ApiName, bindApi, genFixtures } from './fixtures';

const [lib, api, input, perLine] = process.argv.slice(2);
const wasm =
  lib === 'mine' ? new WebAssembly.Module(readFileSync(0)) : undefined;
if (wasm != null) core.init(() => wasm);
const fn = bindApi(
  lib === 'mine' ? core : jsdiff,
  api as ApiName,
  perLine === 'perLine'
);
const fx = genFixtures();
const a = fx[input + 'Old'],
  b = fx[input + 'New'];

// warm up on the same input so JIT tier-up is done, and let background compiles finish
for (let i = 0; i < 5; i++) fn(a, b);
await Bun.sleep(100);
// a new instance keeps the compiled code but starts with empty wasm memory,
// so the call counts the wasm memory it grows into
if (wasm != null) core.init(() => wasm);

// Warning: maxRSS is a high-water mark. This is only correct because, with GC off,
// the RSS before the call is already the peak.
const rss = process.memoryUsage.rss();
fn(a, b);
console.log(process.resourceUsage().maxRSS * 1024 - rss);
