import { init } from './core';
import wasmModule from './patch.wasm';

init(() => wasmModule);

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
