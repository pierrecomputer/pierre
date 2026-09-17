import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('cuda: execution qualifiers, built-ins, and kernel launches', () => {
  const kinds = tokenKinds(
    'cuda',
    '__global__ void scale(float *x) { x[threadIdx.x] = blockIdx.x; __syncthreads(); }\nscale<<<1, 256>>>(data);'
  );
  for (const expected of [
    ['__global__', 'keyword'],
    ['threadIdx', 'variable.special'],
    ['blockIdx', 'variable.special'],
    ['__syncthreads', 'function'],
    ['scale', 'function'],
    ['<<<', 'operator'],
    ['>>>', 'operator'],
  ] satisfies [string, string][]) {
    expect(kinds).toContainEqual(expected);
  }
});

test('cuda: shared, host, and device declarations', () => {
  const kinds = tokenKinds(
    'cuda',
    '__shared__ float values[32];\n__device__ int helper() { return 0; }\n__host__ void launch(cudaStream_t stream);'
  );
  for (const expected of [
    ['__shared__', 'keyword'],
    ['__device__', 'keyword'],
    ['__host__', 'keyword'],
    ['cudaStream_t', 'type.builtin'],
  ] satisfies [string, string][]) {
    expect(kinds).toContainEqual(expected);
  }
});

test('cuda: C++ raw strings and preprocessor directives', () => {
  const kinds = tokenKinds(
    'cuda',
    '#include <cuda_runtime.h>\nconst char *s = R"tag(one\ntwo)tag";\n/* GPU\ncode */'
  );
  for (const expected of [
    ['#include', 'preproc'],
    ['<cuda_runtime.h>', 'string'],
    ['R"tag(one', 'string'],
    ['two)tag"', 'string'],
  ] satisfies [string, string][]) {
    expect(kinds).toContainEqual(expected);
  }
});

test('cuda: multiline constructs match line-fed streaming', () => {
  for (const code of [
    '/* open\nclosed */\n__global__ void f() {}\n',
    'const char *s = R"tag(one\ntwo)tag";\nf<<<1, 2>>>(p);\n',
    '#define N \\\n  32\n__shared__ float x[N];\n',
  ]) {
    assertLineFedParity('cuda', code);
  }
});

test('cuda: qualifiers sharing hash prefixes remain distinct', () => {
  for (const word of [
    '__device__',
    '__shared__',
    '__restrict__',
    '__noinline__',
    '__global__',
    '__host__',
    '__constant__',
    '__managed__',
    '__forceinline__',
    '__launch_bounds__',
    '__align__',
  ]) {
    expect(tokenKinds('cuda', word)).toEqual([[word, 'keyword']]);
    expect(tokenKinds('cuda', `${word}extra`)).toEqual([
      [`${word}extra`, 'variable'],
    ]);
  }
  for (const word of [
    '__deviXe__',
    '__sharXd__',
    '__restrXct__',
    '__noinlXne__',
  ]) {
    expect(tokenKinds('cuda', word)).toEqual([[word, 'variable']]);
  }
});

test('cuda: runtime types and execution coordinates are classified', () => {
  for (const word of [
    'dim3',
    'uint3',
    'float4',
    'cudaError_t',
    'cudaStream_t',
    'cudaEvent_t',
  ]) {
    expect(tokenKinds('cuda', word)).toEqual([[word, 'type.builtin']]);
  }
  for (const word of [
    'threadIdx',
    'blockIdx',
    'blockDim',
    'gridDim',
    'warpSize',
  ]) {
    expect(tokenKinds('cuda', word)).toEqual([[word, 'variable.special']]);
  }
  expect(tokenKinds('cuda', 'ThreadIdx')).toEqual([['ThreadIdx', 'type']]);
});

test('cuda: four-argument launches preserve numeric and operator boundaries', () => {
  expect(tokenKinds('cuda', 'run<<<grid, block, 0, stream>>>(ptr);')).toEqual([
    ['run', 'function'],
    ['<<<', 'operator'],
    ['grid', 'variable'],
    [',', 'punctuation.delimiter'],
    ['block', 'variable'],
    [',', 'punctuation.delimiter'],
    ['0', 'number'],
    [',', 'punctuation.delimiter'],
    ['stream', 'variable'],
    ['>>>', 'operator'],
    ['(', 'punctuation.bracket'],
    ['ptr', 'variable'],
    [')', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('cuda: numeric literals retain C++ separators and suffixes', () => {
  for (const number of ["1'024u", '0x1.fp+2f', '0b1010ULL', '.5f', '2.0e-3']) {
    expect(tokenKinds('cuda', number)).toEqual([[number, 'number']]);
  }
});

test('cuda: raw strings ignore quotes, comments, and false closing tags', () => {
  const literal = 'R"tag(__global__ " /* )other" λ😀)tag"';
  expect(tokenKinds('cuda', literal)).toEqual([[literal, 'string']]);
  expect(tokenKinds('cuda', literal + '; __device__')).toContainEqual([
    '__device__',
    'keyword',
  ]);
});
