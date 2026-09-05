import assert from 'node:assert';
import t from 'node:test';

import type { Lang, Theme, ThemedToken } from '../lib/index';
import { codeToTokens, init, StreamTokenizer } from '../lib/index';
import tokenTypes from '../lib/token-types';
import { transformWat, wat2wasm } from '../scripts/build';

// Line-fed streaming parity for the constructs the 2026-09-02 review found
// diverging between whole-buffer runs and the LiveTokenizer shape (one line
// per chunk), for the languages whose own suites do not cover them.

t.before(() => {
  const url = new URL('../src/highlights.wat', import.meta.url);
  const { code } = transformWat(url);
  init(new WebAssembly.Module(wat2wasm(url.pathname, code)));
});

// one unique color per token type so parity checks cannot hide behind a
// theme that maps two captures to the same color
const names = tokenTypes.filter(
  (name) => !['background', 'foreground', 'none'].includes(name)
);
const distinctTheme = {
  name: 'distinct',
  appearance: 'dark',
  style: {
    background: '#000000',
    foreground: '#ffffff',
    syntax: Object.fromEntries(
      names.map((name, i) => [name, '#' + (0x100000 + i * 0x101).toString(16)])
    ),
  },
} as unknown as Theme;
const nameOfColor = new Map(
  names.map((name, i) => ['#' + (0x100000 + i * 0x101).toString(16), name])
);

/** Token content and type name per line, for readable diffs. */
function flat(lines: ThemedToken[][]): string {
  return lines
    .map((line) =>
      line
        .map(
          (tok) =>
            `${JSON.stringify(tok.content)}:${
              tok.color === undefined
                ? 'none'
                : (nameOfColor.get(tok.color) ?? tok.color)
            }`
        )
        .join(' ')
    )
    .join('\n');
}

/** Assert that feeding one line per chunk matches a whole-buffer run. */
function assertLineFedParity(lang: Lang, code: string): void {
  const whole = codeToTokens(code, { lang, theme: distinctTheme }).tokens;
  const stream = new StreamTokenizer({ lang, theme: distinctTheme });
  const streamed: ThemedToken[][] = [];
  for (const line of code.split(/(?<=\n)/)) {
    streamed.push(...stream.pushCode(line));
  }
  streamed.push(...stream.end());
  assert.equal(flat(streamed), flat(whole), `${lang}: ${JSON.stringify(code)}`);
}

/**
 * The type name of the first token containing `text` as a whole word.
 * Neighboring tokens of one type merge, so `INNER JOIN` is a single token.
 */
function tokenType(lang: Lang, code: string, text: string): string | undefined {
  for (const line of codeToTokens(code, { lang, theme: distinctTheme })
    .tokens) {
    for (const tok of line) {
      if (tok.content.split(/[\s(),;]+/).includes(text)) {
        return tok.color === undefined ? 'none' : nameOfColor.get(tok.color);
      }
    }
  }
  return undefined;
}

void t.test('html-family: start tags spanning lines resume line-fed', () => {
  assertLineFedParity(
    'html',
    '<div\n  class="x"\n  id="y">\n  <img\n    src=x\n  />\n</div>\n'
  );
  assertLineFedParity(
    'html',
    '<script\n  type="module">\nlet x = 1;\n</script>\n'
  );
  assertLineFedParity(
    'html',
    '<style\n  media="print">\nh1 { color: red }\n</style>\n'
  );
  assertLineFedParity('xml', '<root\n a="1"\n b="2">\n</root>\n');
  assertLineFedParity(
    'vue',
    '<template>\n  <MyComp\n    :prop="x"\n    @click="go"\n    v-if="ok"\n  />\n</template>\n'
  );
  assertLineFedParity(
    'svelte',
    '<div\n  class="x"\n  on:click={f}\n  {...spread}>\n</div>\n'
  );
  assertLineFedParity(
    'astro',
    '---\nconst a = 1\n---\n<div\n  class="x"\n  client:load>\n</div>\n'
  );
  // a tag that never closes must neither hang nor lose bytes
  assertLineFedParity('html', '<div\n  class="x"\nplain text\n<p>after</p>\n');
});

void t.test('html-family: declarations spanning lines resume line-fed', () => {
  assertLineFedParity(
    'xml',
    '<!DOCTYPE note [\n<!ELEMENT note (to,from)>\n]>\n<note/>\n'
  );
  assertLineFedParity(
    'html',
    '<!DOCTYPE html\n PUBLIC "-//W3C//DTD XHTML 1.0//EN"\n "http://x">\n<p>a</p>\n'
  );
  assertLineFedParity(
    'html',
    '<?xml version="1.0"\n encoding="utf-8"?>\n<p>a</p>\n'
  );
});

void t.test('astro: a --- line mid-document is not front matter', () => {
  assertLineFedParity('astro', '<h1>x</h1>\n---\nconst y = 1\n');
  assert.notEqual(
    tokenType('astro', '<h1>x</h1>\n---\nconst y = 1\n', 'const'),
    'keyword.declaration'
  );
});

void t.test('toml: multi-line strings resume with exact escape rules', () => {
  assertLineFedParity('toml', "a = '''\nfoo = bar\n'''\nb = 1\n");
  assertLineFedParity('toml', 'a = """\nline \\n with escape\n"""\n');
  assertLineFedParity('toml', 'a = """\nfoo \\""" bar"""\nb = 1\n');
  assertLineFedParity('toml', 'x = """\nline \\\n   trimmed"""\n');
  assertLineFedParity('toml', 'x = """\n"" two\n""""\ny = 2\n');
});

void t.test(
  'bash: strings and heredocs across lines match whole-buffer',
  () => {
    assertLineFedParity(
      'bash',
      'echo "one\ntwo $x ${y} $(cmd)\nthree \\" four"\necho done\n'
    );
    assertLineFedParity(
      'bash',
      'cat <<EOF | sed "s/a/b/"\nhello\nEOF\necho done\n'
    );
    assertLineFedParity('bash', 'cat <<EOF;echo tail\nhello\nEOF\necho done\n');
    assertLineFedParity(
      'bash',
      "cat <<'EOF' > out.txt\n$notexpanded\nEOF\necho done\n"
    );
    assertLineFedParity('bash', 'cat <<-EOF\n\tindented\n\tEOF\necho done\n');
    assertLineFedParity('bash', 'cat <<EOF\r\nhello\r\nEOF\r\necho done\r\n');
    assertLineFedParity('bash', 'x=$((1\n<< 2))\necho $x\n');
  }
);

void t.test('bash: the heredoc delimiter stops at metacharacters', () => {
  // `done` is a bash keyword; the point is that it is code, not heredoc body
  assert.notEqual(
    tokenType('bash', 'cat <<EOF|tr a-z A-Z\nhello\nEOF\necho done\n', 'done'),
    'string'
  );
  assert.notEqual(
    tokenType('bash', 'cat <<EOF | sed "s/a/b/"\nhello\nEOF\n', 'sed'),
    'string'
  );
});

void t.test(
  'sql: multi-line strings resume and common keywords are keywords',
  () => {
    assertLineFedParity(
      'sql',
      "INSERT INTO t VALUES ('multi\nline', 'it''s');\nSELECT 1;\n"
    );
    for (const word of ['INNER', 'HAVING', 'DESC']) {
      assert.ok(
        tokenType(
          'sql',
          'SELECT a FROM t INNER JOIN u USING (id) GROUP BY a HAVING count(*) > 1 ORDER BY a DESC\n',
          word
        )?.startsWith('keyword') === true,
        word
      );
    }
  }
);

void t.test('asm: the general purpose registers are registers', () => {
  const code =
    'mov rax, rbx\nmov rcx, rdx\nmov rsi, rdi\nmov rbp, rsp\nmov esi, edi\n';
  const rax = tokenType('asm', code, 'rax');
  for (const reg of [
    'rbx',
    'rcx',
    'rdx',
    'rsi',
    'rdi',
    'rbp',
    'rsp',
    'esi',
    'edi',
  ]) {
    assert.equal(tokenType('asm', code, reg), rax, reg);
  }
});

void t.test('asm and wat: comments across lines resume line-fed', () => {
  assertLineFedParity('asm', 'start:\n  /* open\nstill */\n  mov eax, 1\n');
  assertLineFedParity(
    'wat',
    '(module\n  (; open\n  still ;)\n  (func $f)\n)\n'
  );
});

void t.test('zig: keyword table classifies every keyword', () => {
  const code =
    'const std = @import("std");\npub fn main() !void {\n    var x: u32 = 0;\n' +
    '    while (x < 10) : (x += 1) {\n        const y = try foo(x);\n' +
    '        if (y == null) break else continue;\n        defer bar();\n' +
    '        comptime var z = align(4);\n    }\n    return;\n}\n';
  for (const word of [
    'const',
    'pub',
    'fn',
    'var',
    'while',
    'try',
    'if',
    'break',
    'else',
    'continue',
    'defer',
    'comptime',
    'return',
    'align',
  ]) {
    assert.ok(
      tokenType('zig', code, word)?.startsWith('keyword') === true,
      `${word}: ${tokenType('zig', code, word)}`
    );
  }
  assert.equal(tokenType('zig', 'const aligned = 1;\n', 'aligned'), 'variable');
  assertLineFedParity('zig', code);
});
