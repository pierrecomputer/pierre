const KEYWORDS =
  'const let function return if else for while await async class extends new this typeof import export default'.split(
    ' '
  );
const IDENTS =
  'value result index buffer offset length token stream parser cursor node state config handler options context'.split(
    ' '
  );
const PROSE = (
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore ' +
  'magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat'
).split(' ');

const UNICODE_WORDS = (
  'café naïve façade jalapeño déjà señor crème brûlée über schön garçon ' +
  '你好 世界 编程 代码 差分 算法 性能 测试 日本語 テスト 文字列 比較 프로그램 알고리즘 ' +
  '😀 🚀 🔥 ✨ 🎉 📦 🦀 👍🏽 👨‍👩‍👧'
).split(' ');

type Rnd = () => number;

const pick = <T>(rnd: Rnd, arr: readonly T[]): T =>
  arr[Math.floor(rnd() * arr.length)];

/** generate a random number between 0 and 1 */
function mulberry32(seed: number): Rnd {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** generate `count` lines of code */
function codeLines(rnd: Rnd, count: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const indent = '  '.repeat(Math.floor(rnd() * 4));
    lines.push(
      `${indent}${pick(rnd, KEYWORDS)} ${pick(rnd, IDENTS)}${i % 97} = ${pick(rnd, IDENTS)}(${pick(rnd, IDENTS)}, ${Math.floor(
        rnd() * 1000
      )}); // ${pick(rnd, PROSE)}`
    );
  }
  return lines;
}

/** generate a text with `words` words */
function proseText(rnd: Rnd, words: number): string {
  let out = '';
  for (let i = 0; i < words; i++) {
    out += pick(rnd, PROSE);
    out += rnd() < 0.08 ? '.\n' : ' ';
  }
  return out;
}

/** mutate ~`rate` of the lines: edit, delete, or insert */
function mutateLines(rnd: Rnd, lines: string[], rate: number): string[] {
  const out = lines.slice();
  const edits = Math.floor(lines.length * rate);
  for (let i = 0; i < edits; i++) {
    const at = Math.floor(rnd() * out.length);
    const roll = rnd();
    if (roll < 0.5)
      out[at] =
        out[at].replace(/= \w+/, `= ${pick(rnd, IDENTS)}`) + ' /* edited */';
    else if (roll < 0.75) out.splice(at, 1);
    else
      out.splice(
        at,
        0,
        `  ${pick(rnd, KEYWORDS)} inserted${i} = ${Math.floor(rnd() * 1000)};`
      );
  }
  return out;
}

/** scatter small word/char edits through a text */
function mutateText(
  rnd: Rnd,
  text: string,
  edits: number,
  insert: (rnd: Rnd, i: number) => string
): string {
  let s = text;
  for (let i = 0; i < edits; i++) {
    const at = Math.floor(rnd() * s.length);
    const delLen = Math.floor(rnd() * 6);
    s = s.slice(0, at) + insert(rnd, i) + s.slice(at + delLen);
  }
  return s;
}

// unicode text is built and mutated as an array of chunks, never by raw string
// offsets — slicing at an arbitrary UTF-16 index could split a surrogate pair,
// and a lone surrogate makes the wasm output legitimately diverge from jsdiff
function unicodeChunks(rnd: Rnd, count: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < count; i++) {
    chunks.push(pick(rnd, UNICODE_WORDS));
    chunks.push(rnd() < 0.08 ? '。\n' : ' ');
  }
  return chunks;
}

/** mutate ~`edits` chunks: replace, delete, or insert a word */
function mutateChunks(rnd: Rnd, chunks: string[], edits: number): string[] {
  const out = chunks.slice();
  for (let i = 0; i < edits; i++) {
    const at = Math.floor(rnd() * out.length);
    const roll = rnd();
    if (roll < 0.5) out[at] = pick(rnd, UNICODE_WORDS);
    else if (roll < 0.75) out.splice(at, 1);
    else out.splice(at, 0, pick(rnd, UNICODE_WORDS), ' ');
  }
  return out;
}

/** The APIs that @pierre/patches and jsdiff share, as the benchmark calls them. */
export interface DiffApi {
  createTwoFilesPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string
  ): string;
  diffLines(oldStr: string, newStr: string): unknown;
  diffWordsWithSpace(oldStr: string, newStr: string): unknown;
  diffChars(oldStr: string, newStr: string): unknown;
}

export type ApiName = keyof DiffApi;

/**
 * `api` of `lib` (@pierre/patches or jsdiff) as a function of (oldStr, newStr).
 * `perLine` diffs line i of the old text with line i of the new text, one call each.
 */
export function bindApi(
  lib: DiffApi,
  api: ApiName,
  perLine = false
): (a: string, b: string) => unknown {
  const fn =
    api === 'createTwoFilesPatch'
      ? (a: string, b: string) => lib.createTwoFilesPatch('a.js', 'b.js', a, b)
      : (a: string, b: string) => lib[api](a, b);
  if (!perLine) return fn;
  const lines = new Map<string, string[]>();
  const split = (s: string) =>
    lines.get(s) ?? lines.set(s, s.split('\n')).get(s)!;
  return (a, b) => {
    const as = split(a),
      bs = split(b);
    return as.map((line, i) => fn(line, bs[i]));
  };
}

export type Fixtures = Record<string, string>;

/** generate the benchmark fixtures */
export function genFixtures(): Fixtures {
  const rnd = mulberry32(0xbe7c4);
  const lines = codeLines(rnd, 8000);
  const lineOld = lines.join('\n') + '\n';
  const lineNew = mutateLines(rnd, lines, 0.02).join('\n') + '\n';

  const prose = proseText(rnd, 12000);
  const wordOld = prose;
  const wordNew = mutateText(rnd, prose, 60, (r) => ` ${pick(r, PROSE)} `);

  const charBase = proseText(rnd, 4000);
  const charOld = charBase;
  const charNew = mutateText(rnd, charBase, 40, (r) =>
    pick(r, 'abcdefgh'.split(''))
  );

  // divergent: ~35% of lines touched, so the Myers loop runs at large edit
  // distance instead of skating along long common snakes
  const divLines = codeLines(rnd, 2500);
  const divOld = divLines.join('\n') + '\n';
  const divNew = mutateLines(rnd, divLines, 0.35).join('\n') + '\n';

  // per line: 2000 edited code lines, diffed one pair at a time like the
  // inline change highlights of a diff viewer, so call overhead dominates
  const pairLines = codeLines(rnd, 2000);
  const pairOld = pairLines.join('\n');
  const pairNew = pairLines
    .map((l) => l.replace(/= \w+/, `= ${pick(rnd, IDENTS)}`) + ' // edited')
    .join('\n');

  const uniWords = unicodeChunks(rnd, 6000);
  const uniWordOld = uniWords.join('');
  const uniWordNew = mutateChunks(rnd, uniWords, 60).join('');

  const uniChars = unicodeChunks(rnd, 1500);
  const uniCharOld = uniChars.join('');
  const uniCharNew = mutateChunks(rnd, uniChars, 40).join('');

  return {
    lineOld,
    lineNew,
    wordOld,
    wordNew,
    charOld,
    charNew,
    divOld,
    divNew,
    pairOld,
    pairNew,
    uniWordOld,
    uniWordNew,
    uniCharOld,
    uniCharNew,
  };
}
