import { init } from './core';
import wasmBase64 from './patch.wasm.mjs';

// WARNING: decode here, not at import: most importers of @pierre/diffs stay on jsdiff
init(() => {
  const s = atob(wasmBase64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new WebAssembly.Module(bytes);
});

export {
  createPatch,
  createTwoFilesPatch,
  diffChars,
  diffLines,
  diffWordsWithSpace,
  setMemoryLimit,
} from './core';
export type {
  ChangeObject,
  CreatePatchOptions,
  DiffLinesOptions,
  HeaderOptions,
} from './core';
