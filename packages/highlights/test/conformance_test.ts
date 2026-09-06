import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import t from 'node:test';

import { LANGS } from '../lib/highlighter';
import type { Lang, ThemedToken } from '../lib/index';
import {
  codeToHtml,
  codeToTokens,
  init,
  isSupportedLanguage,
  StreamTokenizer,
} from '../lib/index';
import tokenTypes from '../lib/token-types';
import { transformWat, wat2wasm } from '../scripts/build';
import { samples } from './_samples';
import {
  bodyOf,
  distinctTheme as distinct,
  flatTokens as flat,
  kindOfColor,
  loadSplitLang,
  makeRand,
  spansOf,
  textOf,
} from './_util';

// The same contract, checked for every built-in lexer against its corpus
// sample (test/_samples.ts): the sample must reach every token kind it
// promises; HTML and token output must describe the same runs and lose no
// byte; streaming must not depend on where chunks are cut; CRLF must
// tokenize like LF; a run over malformed input must not leak state into the
// next; a scan cut at any byte must stay lossless; and random input built
// from the sample's own alphabet must never break the invariants. Per-language
// suites cover what each lexer classifies; this file covers what every lexer
// must satisfy regardless of language, so a new lexer is held to the same
// bar the moment it gets a sample.

const dec = new TextDecoder();
const enc = new TextEncoder();

// the enum is read at load time so the per-language tests can be declared
// in a loop; the shared highlighter is initialized right away for the same
// reason
const watUrl = new URL('../src/highlights.wat', import.meta.url);
const compiled = transformWat(watUrl);
init(new WebAssembly.Module(wat2wasm(watUrl.pathname, compiled.code)));

/** `$Language` members by name, `plain` included. */
const languageEnum = compiled.enumMap.get('$Language') as Record<
  string,
  number
>;
/** Every lexer name in enum order; `plain` has no lexer and no sample. */
const lexers = Object.keys(languageEnum).filter((name) => name !== 'plain');

// Bun 1.4's JavaScriptCore can return one wrong result from a hot SIMD
// scanner at the moment it tiers up (an identifier run cut after 8 bytes; the
// next call with the same input is right again, and BUN_JSC_useOMGJIT=0 hides
// it entirely). Drive every lexer through both output modes before any
// assertion so the shared scanners and each lexer's own entry cross that
// point here, not mid-check; the per-lexer functions need a few hundred
// calls each before the optimizing tier picks them up.
for (let round = 0; round < 240; round++) {
  for (const name of lexers) {
    const { code } = samples[name];
    codeToHtml(code, { lang: name as Lang, theme: distinct });
    codeToTokens(code, { lang: name as Lang, theme: distinct });
  }
}

/** The token kind name behind a themed token's color; plain text is `none`. */
function kindOf(token: ThemedToken): string {
  return kindOfColor(token.color) ?? 'none';
}

/** Whole-buffer tokens for `code` under the distinct theme. */
function tokensOf(lang: Lang, code: string): ThemedToken[][] {
  return codeToTokens(code, { lang, theme: distinct }).tokens;
}

/** Whole-buffer HTML for `code` under the distinct theme. */
function htmlOf(lang: Lang, code: string): string {
  return dec.decode(codeToHtml(code, { lang, theme: distinct }));
}

/** Tokens for `code` fed to a StreamTokenizer in the given chunks. */
function streamed(lang: Lang, chunks: string[]): ThemedToken[][] {
  const stream = new StreamTokenizer({ lang, theme: distinct });
  const out: ThemedToken[][] = [];
  for (const chunk of chunks) out.push(...stream.pushCode(chunk));
  out.push(...stream.end());
  return out;
}

/** Split `code` after every line terminator, keeping the terminators. */
function byLine(code: string): string[] {
  return code.split(/(?<=\n)/);
}

/** Group consecutive lines into chunks of `n` lines. */
function byLines(code: string, n: number): string[] {
  const lines = byLine(code);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += n) {
    out.push(lines.slice(i, i + n).join(''));
  }
  return out;
}

/** Cut `code` into chunks of 1..17 UTF-16 units chosen by `rand`. */
function randomChunks(code: string, rand: () => number): string[] {
  const out: string[] = [];
  for (let i = 0; i < code.length; ) {
    const n = 1 + (rand() % 17);
    out.push(code.slice(i, i + n));
    i += n;
  }
  return out;
}

/** A styled run: the color (null for plain text) and its text. */
type Run = [string | null, string];

/**
 * Merge runs of equal color after dropping line terminators. HTML mode
 * folds a newline into whatever span is open while token mode splits lines
 * and never carries terminators, so the two agree only modulo terminators.
 */
function normalizeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const [color, raw] of runs) {
    const text = raw.replace(/[\r\n]/g, '');
    if (text === '') continue;
    const last = out[out.length - 1];
    if (last !== undefined && last[0] === color) last[1] += text;
    else out.push([color, text]);
  }
  return out;
}

/** Styled runs of a token result, plain tokens as `null`. */
function tokenRuns(lines: ThemedToken[][]): Run[] {
  const out: Run[] = [];
  for (const line of lines) {
    for (const tok of line) {
      out.push([kindOf(tok) === 'none' ? null : tok.color!, tok.content]);
    }
  }
  return normalizeRuns(out);
}

/** Styled runs of an HTML result: spans plus the plain text between them. */
function htmlRuns(html: string): Run[] {
  const out: Run[] = [];
  const re = /<span style="color:([^";<>]*)[^"]*">([\s\S]*?)<\/span>|([^<]+)/g;
  let m;
  while ((m = re.exec(bodyOf(html))) !== null) {
    const text = (m[2] ?? m[3])
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    out.push([m[1] ?? null, text]);
  }
  return normalizeRuns(out);
}

/** Assert lossless HTML with balanced spans and return it. */
function checkHtml(lang: Lang, code: string): string {
  const html = htmlOf(lang, code);
  assert.equal(textOf(html), code, `${lang}: lossless ${JSON.stringify(code)}`);
  spansOf(html);
  return html;
}

/**
 * Assert that token contents joined by the input's terminators rebuild it.
 * Token mode ends a line at `\n` and drops a `\r` right before it; a bare
 * `\r` is ordinary content.
 */
function checkTokensLossless(lang: Lang, code: string, lines: ThemedToken[][]) {
  const terminators = code.match(/\r?\n/g) ?? [];
  assert.equal(
    lines.length,
    terminators.length + 1,
    `${lang}: line count for ${JSON.stringify(code)}`
  );
  let rebuilt = '';
  for (const [i, line] of lines.entries()) {
    for (const tok of line) {
      assert.ok(tok.content.length > 0, `${lang}: empty token on line ${i}`);
      assert.equal(tok.offset, rebuilt.length, `${lang}: offset on line ${i}`);
      rebuilt += tok.content;
    }
    if (i < terminators.length) rebuilt += terminators[i];
  }
  assert.equal(
    rebuilt,
    code,
    `${lang}: tokens rebuild ${JSON.stringify(code)}`
  );
}

// Fragments that open a construct in some language and leave it unterminated
// at the end of a run. Each one is highlighted on its own and glued to a cut
// sample, so every lexer sees openers it may not own as well as its own.
const openers = [
  '"',
  "'",
  '`',
  '"""',
  "'''",
  '/*',
  '/**',
  '<!--',
  '<![CDATA[',
  '<?',
  '<script>',
  '<style>',
  '<div a="',
  '{',
  '{{',
  '{#if',
  '${',
  '#{',
  '(',
  '[',
  '[[',
  '(;',
  '#|',
  '{-',
  '<<EOF\n',
  '<<<EOT\n',
  '<<-EOT\n',
  '=begin\n',
  '=pod\n',
  'r#"',
  'R"(',
  '$$',
  '$tag$',
  '@"',
  "@'",
  '$(',
  '$((',
  '---\n',
  '```',
  '--[[',
  '--[==[',
  '%{',
  '~s(',
  '\\',
  '\\\\',
  '#',
  '%',
  '0x',
  '1e',
  '<',
  '>',
  '&',
  '&#',
  '@',
  '$',
  ':',
  '::',
  '\0',
  '\r',
  'é',
  '日本語',
  '🙂',
];

void t.test('conformance: enum, alias table, and Lang type agree', () => {
  // every lexer is reachable through its own name and keeps its enum id
  for (const [name, id] of Object.entries(languageEnum)) {
    assert.equal(LANGS[name], id, name);
  }
  // every alias points at a lexer that exists
  const ids = new Set(Object.values(languageEnum));
  for (const [alias, id] of Object.entries(LANGS)) {
    assert.ok(ids.has(id), `${alias} -> ${id}`);
  }
  // the public `Lang` union lists exactly the alias table, and lookups fold
  // case so `Rust` and `RUST` reach the same lexer as `rust`
  const source = readFileSync(
    new URL('../lib/index.ts', import.meta.url),
    'utf8'
  );
  const union = source.match(/export type Lang =([\s\S]*?);/);
  assert.ok(union !== null, 'Lang union in lib/index.ts');
  const typed = [...union[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(typed.sort(), Object.keys(LANGS).sort());
  for (const alias of Object.keys(LANGS)) {
    assert.equal(alias, alias.toLowerCase(), alias);
    assert.ok(isSupportedLanguage(alias.toUpperCase()), alias);
  }
  assert.equal(isSupportedLanguage('not-a-language'), false);
});

void t.test('conformance: every lexer has a corpus sample', () => {
  assert.deepEqual(Object.keys(samples).sort(), [...lexers].sort());
  for (const lang of lexers) {
    const { code, kinds } = samples[lang];
    assert.ok(code.endsWith('\n'), `${lang}: sample ends with a newline`);
    assert.ok(byLine(code).length >= 8, `${lang}: sample is multi-line`);
    assert.ok(kinds.length >= 5, `${lang}: sample promises several kinds`);
    assert.equal(new Set(kinds).size, kinds.length, `${lang}: kinds unique`);
    for (const kind of kinds) {
      assert.ok(tokenTypes.includes(kind), `${lang}: unknown kind ${kind}`);
    }
  }
});

for (const name of lexers) {
  const lang = name as Lang;
  const { code: sample, kinds } = samples[name];

  void t.test(`${name}: the sample reaches every promised token kind`, () => {
    const whole = tokensOf(lang, sample);
    const produced = new Set<string>();
    for (const line of whole) for (const tok of line) produced.add(kindOf(tok));
    for (const kind of kinds) {
      assert.ok(produced.has(kind), `${name}: no ${kind} token in the sample`);
    }
    // the sample is not one undifferentiated run: most of its text is styled
    const styled = whole
      .flat()
      .filter((tok) => kindOf(tok) !== 'none')
      .reduce((n, tok) => n + tok.content.trim().length, 0);
    assert.ok(styled > sample.replace(/\s/g, '').length / 2, `${name}: styled`);
  });

  void t.test(`${name}: html and token output describe the same runs`, () => {
    const whole = tokensOf(lang, sample);
    checkTokensLossless(lang, sample, whole);
    const html = checkHtml(lang, sample);
    assert.deepEqual(htmlRuns(html), tokenRuns(whole), `${name}: runs`);
  });

  void t.test(
    `${name}: streaming matches the whole buffer however it is cut`,
    () => {
      const whole = tokensOf(lang, sample);
      assert.deepEqual(
        streamed(lang, byLine(sample)),
        whole,
        `${name}: one line per chunk`
      );
      assert.deepEqual(
        streamed(lang, byLines(sample, 2)),
        whole,
        `${name}: two lines per chunk`
      );
      assert.deepEqual(
        streamed(lang, byLines(sample, 3)),
        whole,
        `${name}: three lines per chunk`
      );
      assert.deepEqual(streamed(lang, [sample]), whole, `${name}: one chunk`);
      const rand = makeRand(0x5eed0000 + lexers.indexOf(name));
      for (let round = 0; round < 4; round++) {
        assert.deepEqual(
          streamed(lang, randomChunks(sample, rand)),
          whole,
          `${name}: random chunks, round ${round}`
        );
      }
      // CRLF terminators tokenize exactly like LF, whole and line-fed
      const crlf = sample.replace(/\n/g, '\r\n');
      const crlfWhole = tokensOf(lang, crlf);
      checkTokensLossless(lang, crlf, crlfWhole);
      assert.equal(flat(crlfWhole), flat(whole), `${name}: CRLF whole`);
      assert.deepEqual(
        streamed(lang, byLine(crlf)),
        crlfWhole,
        `${name}: CRLF line-fed`
      );
      checkHtml(lang, crlf);
    }
  );

  void t.test(
    `${name}: every line-boundary prefix streams like its whole`,
    () => {
      // a document that ends inside a construct is the live-editing common case
      const lines = byLine(sample);
      for (let n = 1; n < lines.length; n++) {
        const prefix = lines.slice(0, n).join('');
        const whole = tokensOf(lang, prefix);
        checkTokensLossless(lang, prefix, whole);
        assert.deepEqual(
          streamed(lang, lines.slice(0, n)),
          whole,
          `${name}: ${n} of ${lines.length} lines`
        );
        checkHtml(lang, prefix);
      }
    }
  );

  void t.test(`${name}: malformed runs leave no state behind`, () => {
    const pristineHtml = checkHtml(lang, sample);
    const pristineTokens = tokensOf(lang, sample);
    const bytes = enc.encode(sample);
    // the sample cut at arbitrary byte offsets, including inside multi-byte
    // characters, then every opener alone and glued to a cut
    for (let cut = 0; cut < bytes.length; cut += 7) {
      const cutBytes = bytes.subarray(0, cut);
      const html = dec.decode(codeToHtml(cutBytes, { lang, theme: distinct }));
      assert.equal(
        textOf(html),
        dec.decode(cutBytes),
        `${name}: cut at ${cut}`
      );
      spansOf(html);
    }
    const head = sample.slice(0, Math.floor(sample.length / 3));
    for (const opener of openers) {
      checkHtml(lang, opener);
      checkHtml(lang, head + opener);
      checkHtml(lang, opener + sample);
    }
    assert.equal(
      checkHtml(lang, sample),
      pristineHtml,
      `${name}: html after junk`
    );
    assert.deepEqual(
      tokensOf(lang, sample),
      pristineTokens,
      `${name}: tokens after junk`
    );
    // a stream that ends mid-construct returns its instance to the pool; the
    // next stream must start from a clean slate
    for (const opener of openers.slice(0, 24)) {
      streamed(lang, byLine(head + opener));
      streamed(lang, [opener]);
    }
    assert.deepEqual(
      streamed(lang, byLine(sample)),
      pristineTokens,
      `${name}: stream after junk`
    );
  });

  void t.test(
    `${name}: sub-range scans stay lossless at every byte split`,
    () => {
      const split = loadSplitLang(lang);
      const inputs = [
        sample,
        'aé日本🙂z',
        '"aé日本🙂z"',
        '// aé日本🙂z\nx',
        '<p aé="日本🙂">é</p>',
      ];
      for (const input of inputs) {
        const length = enc.encode(input).length;
        for (let at = 0; at <= length; at++) {
          const html = split(input, at);
          assert.equal(
            textOf(html),
            input,
            `${name}: byte ${at}/${length} of ${JSON.stringify(input.slice(0, 24))}`
          );
          spansOf(html);
        }
      }
    }
  );

  void t.test(
    `${name}: fuzz from the sample's own alphabet keeps the invariants`,
    () => {
      // BMP-only alphabet so code-unit iteration equals code-point iteration,
      // plus the terminators and a few bytes every lexer must survive
      const alphabet = [
        ...new Set(
          (sample.replace(/[\ud800-\udfff]/g, '') + '\r\t\0é').split('')
        ),
      ];
      const rand = makeRand(0xa1fa0000 + lexers.indexOf(name));
      for (let sampleNo = 0; sampleNo < 96; sampleNo++) {
        let input = '';
        for (let n = rand() % 64; n-- !== 0; ) {
          input += alphabet[rand() % alphabet.length];
        }
        checkHtml(lang, input);
        checkTokensLossless(lang, input, tokensOf(lang, input));
        // the line-fed stream may classify malformed input differently from a
        // whole-buffer run, but it must never drop or invent a byte
        checkTokensLossless(lang, input, streamed(lang, byLine(input)));
      }
      // mutations of the sample: deleted spans, inserted bytes, duplicated
      // lines, and truncations; each must stay lossless and must not change how
      // the pristine sample highlights afterwards
      const pristine = htmlOf(lang, sample);
      const lines = byLine(sample);
      for (let round = 0; round < 48; round++) {
        let mutant: string;
        const at = rand() % sample.length;
        switch (rand() % 4) {
          case 0:
            mutant = sample.slice(0, at) + sample.slice(at + 1 + (rand() % 4));
            break;
          case 1:
            mutant =
              sample.slice(0, at) +
              alphabet[rand() % alphabet.length] +
              sample.slice(at);
            break;
          case 2: {
            const line = rand() % lines.length;
            mutant = [
              ...lines.slice(0, line),
              lines[line],
              ...lines.slice(line),
            ].join('');
            break;
          }
          default:
            mutant = sample.slice(0, at);
        }
        checkHtml(lang, mutant);
        checkTokensLossless(lang, mutant, tokensOf(lang, mutant));
        checkTokensLossless(lang, mutant, streamed(lang, byLine(mutant)));
        assert.equal(
          htmlOf(lang, sample),
          pristine,
          `${name}: after mutation ${round}`
        );
      }
    }
  );
}
