import assert from 'node:assert';
import t from 'node:test';

import { LANGS } from '../lib/highlighter';
import type { Highlighter, Lang } from '../lib/index';
import {
  codeToTokens,
  init,
  isSupportedLanguage,
  StreamTokenizer,
} from '../lib/index';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import { samples } from './_samples';
import {
  assertLineFedParity,
  checkInvariants,
  distinctTheme,
  kindOfColor,
  loadLang,
  makeRand,
  spansOf,
  textOf,
  themeColor,
} from './_util';

const decoder = new TextDecoder();
const watUrl = new URL('../src/highlights.wat', import.meta.url);
const compiled = transformWat(watUrl);
const languageEnum = compiled.enumMap.get('$Language') as Record<
  string,
  number
>;
const canonical = Object.keys(languageEnum).filter(
  (name) => name !== 'plain'
) as Lang[];

let highlighter: Highlighter;

t.before(() => {
  highlighter = init(
    new WebAssembly.Module(wat2wasm(watUrl.pathname, compiled.code))
  );
});

/**
 * The type name of the first token containing `text` as a whole word.
 * Neighboring tokens of one type merge, so `INNER JOIN` is a single token.
 */
function tokenType(lang: Lang, code: string, text: string): string {
  for (const line of codeToTokens(code, { lang, theme: distinctTheme })
    .tokens) {
    for (const tok of line) {
      if (tok.content.split(/[\s(),;]+/).includes(text)) {
        return kindOfColor(tok.color) ?? 'none';
      }
    }
  }
  assert.fail(
    `${lang}: missing token ${JSON.stringify(text)} in ${JSON.stringify(code)}`
  );
}

void t.test(
  'languages: unknown names and object properties are rejected',
  () => {
    for (const lang of [
      '',
      'unknown',
      ' js ',
      '__proto__',
      'constructor',
      'toString',
      'hasOwnProperty',
    ]) {
      assert.equal(isSupportedLanguage(lang), false, lang);
      const options = { lang: lang as Lang, theme: pierreDark };
      assert.throws(
        () => highlighter.codeToHtml('x', options),
        RangeError,
        lang
      );
      assert.throws(
        () => highlighter.codeToTokens('x', options),
        RangeError,
        lang
      );
      assert.throws(
        () => highlighter.codeToHast('x', options),
        RangeError,
        lang
      );
      assert.throws(() => new StreamTokenizer(options), RangeError, lang);
    }
  }
);

void t.test(
  'input: byte views respect their offset and length in every output mode',
  () => {
    const code = 'const text = "é日本🙂<&>";\r\n';
    const bytes = new TextEncoder().encode(code);
    const padded = new Uint8Array(bytes.length + 8).fill(0x78);
    padded.set(bytes, 4);
    const options = { lang: 'ts', theme: pierreDark } as const;
    const html = decoder.decode(highlighter.codeToHtml(code, options));
    const tokens = highlighter.codeToTokens(code, options);
    const hast = highlighter.codeToHast(code, options);
    for (const input of [
      bytes,
      bytes.buffer,
      padded.subarray(4, padded.length - 4),
    ]) {
      assert.equal(
        decoder.decode(highlighter.codeToHtml(input, options)),
        html
      );
      assert.deepEqual(highlighter.codeToTokens(input, options), tokens);
      assert.deepEqual(highlighter.codeToHast(input, options), hast);
    }
  }
);

void t.test(
  'languages: aliases and uppercase names match their canonical lexer',
  () => {
    for (const [name, id] of Object.entries(languageEnum)) {
      const lang = name as Lang;
      const code = name === 'plain' ? '<&> é🙂\r\nplain\0' : samples[name].code;
      const html = decoder.decode(
        highlighter.codeToHtml(code, { lang, theme: distinctTheme })
      );
      assert.equal(textOf(html), code, lang);
      if (name !== 'plain') assert.ok(spansOf(html).length > 0, lang);
      const tokens = highlighter.codeToTokens(code, {
        lang,
        theme: distinctTheme,
      });
      for (const [alias, aliasId] of Object.entries(LANGS)) {
        if (aliasId !== id) continue;
        for (const spelling of [alias, alias.toUpperCase()]) {
          assert.ok(isSupportedLanguage(spelling), spelling);
          assert.equal(
            decoder.decode(
              highlighter.codeToHtml(code, {
                lang: spelling,
                theme: distinctTheme,
              })
            ),
            html,
            spelling
          );
          assert.deepEqual(
            highlighter.codeToTokens(code, {
              lang: spelling,
              theme: distinctTheme,
            }),
            tokens,
            spelling
          );
        }
      }
    }
  }
);

void t.test(
  'languages: JS, JSX, TS, and TSX enable independent syntax layers',
  () => {
    const html = (lang: Lang, code: string) =>
      decoder.decode(highlighter.codeToHtml(code, { lang, theme: pierreDark }));
    const jsxCode = 'const view = <Box value={x} />;';
    const typeCode = 'type Result = string | number;';

    assert.equal(html('js', jsxCode), html('ts', jsxCode));
    assert.equal(html('jsx', jsxCode), html('tsx', jsxCode));
    assert.notEqual(html('js', jsxCode), html('jsx', jsxCode));

    assert.equal(html('js', typeCode), html('jsx', typeCode));
    assert.equal(html('ts', typeCode), html('tsx', typeCode));
    assert.notEqual(html('js', typeCode), html('ts', typeCode));
  }
);

void t.test('languages: deterministic cross-lexer invariant fuzz', () => {
  const alphabet = Array.from(
    'abcXYZ09 _-$#@/\\\'"`()[]{}<>=+*&|:;,.!?\n\r\t\0é_日本語🙂𝛼'
  );
  const rand = makeRand(0x9e3779b9);
  for (const lang of canonical) {
    for (let sample = 0; sample < 64; sample++) {
      let input = '';
      for (let n = sample; n-- !== 0; ) {
        input += alphabet[rand() % alphabet.length];
      }
      const html = decoder.decode(
        highlighter.codeToHtml(input, { lang, theme: pierreDark })
      );
      assert.equal(textOf(html), input, `${lang}: ${JSON.stringify(input)}`);
      spansOf(html);
    }
  }
});

const STRING = themeColor('string');

void t.test(
  'lexStringBody: a backslash before CRLF continues the string like one before LF',
  () => {
    for (const [lang, fn] of [
      ['c', '$hlC'],
      ['go', '$hlGo'],
      ['rust', '$hlRust'],
    ] as const) {
      const lexer = loadLang(lang, fn);
      for (const newline of ['\n', '\r\n']) {
        const code = `x = "abc\\${newline}def";${newline}`;
        const html = checkInvariants(lexer.hl, code);
        const closing = spansOf(html).find((s) => s.text.startsWith('def"'));
        assert.ok(closing !== undefined, `${lang}: def" is one string span`);
        assert.equal(closing.color, STRING, `${lang}: def" keeps string color`);
        assertLineFedParity(lang, code);
      }
    }
  }
);

void t.test(
  'lexStringBody: an escaped CRLF at a chunk end resumes the string',
  () => {
    assertLineFedParity('c', 'char *s = "abc\\\r\ndef";\r\nint z;\r\n');
    assertLineFedParity('go', 'x := "abc\\\r\ndef"\r\ny := 1\r\n');
  }
);

void t.test(
  'streamSetNested: nested comments preserve odd and even depths',
  () => {
    for (const lang of ['rust', 'swift'] as const) {
      for (const depth of [1, 2, 3, 4]) {
        const code = `${'/* '.repeat(depth)}a\nb\n${'*/ '.repeat(depth)}\nlet c = 1\n`;
        assertLineFedParity(lang, code);
        assert.equal(tokenType(lang, code, 'b'), 'comment');
        assert.equal(tokenType(lang, code, 'c'), 'variable');
      }
    }
  }
);

void t.test(
  'lexSkipSpaceAt: a call lookahead never crosses a line break',
  () => {
    assertLineFedParity('c', 'int x = foo\n(1);\n');
    assertLineFedParity('go', 'x := foo\n(1)\n');
  }
);

void t.test(
  'lexIsConstCase: a single uppercase letter is not a constant',
  () => {
    const code = 'T x = MAX;';
    assert.equal(tokenType('c', code, 'T'), 'type');
    assert.equal(tokenType('c', code, 'MAX'), 'constant');
  }
);

void t.test(
  'streamResumeFixed: delimiter search survives decoy first bytes',
  () => {
    assertLineFedParity(
      'cpp',
      'auto s = R"tag(a)x\n)tagx )ta\n)tag";\nint y;\n'
    );
    assertLineFedParity('lua', 'x = [==[a]\n]=]b\n]==]\ny = 1\n');
  }
);

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
  for (const reg of [
    'rax',
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
    assert.equal(tokenType('asm', code, reg), 'variable.special', reg);
  }
});

void t.test('asm and wat: comments across lines resume line-fed', () => {
  assertLineFedParity('asm', 'start:\n  /* open\nstill */\n  mov eax, 1\n');
  assertLineFedParity(
    'wat',
    '(module\n  (; open\n  still ;)\n  (func $f)\n)\n'
  );
});

void t.test('zig: control and declaration keywords are classified', () => {
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
