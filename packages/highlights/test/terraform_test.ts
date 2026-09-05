import assert from 'node:assert';
import t from 'node:test';

import type { Lang, Theme, ThemedToken } from '../lib/index';
import { codeToTokens, init, StreamTokenizer } from '../lib/index';
import tokenTypes from '../lib/token-types';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import {
  assertLineFedParity,
  checkInvariants,
  exactColor,
  loadLang,
  spansOf,
  type TestLang,
  textOf,
  tokenKinds,
  wordColor,
} from './util';

// one unique color per token type so equal styles cannot merge neighboring
// spans and hide a classification behind a same-colored token
const distinct = {
  name: 'distinct',
  appearance: 'dark',
  style: {
    background: '#000000',
    foreground: '#ffffff',
    syntax: Object.fromEntries(
      tokenTypes
        .filter((name) => !['background', 'foreground', 'none'].includes(name))
        .map((name, i) => [name, '#' + (0x100000 + i * 0x101).toString(16)])
    ),
  },
} as unknown as Theme;

/** The distinct theme's color for a token type name. */
function distinctColor(name: string): string {
  const i = tokenTypes.indexOf(name);
  assert.ok(i >= 0, `unknown token type: ${name}`);
  return distinct.style.syntax?.[name] as string;
}

let lexer: TestLang;
t.before(() => {
  lexer = loadLang('terraform', '$hlTerraform');
  // the streaming tests below need the full module behind codeToTokens
  const url = new URL('../src/highlights.wat', import.meta.url);
  const { code } = transformWat(url);
  init(new WebAssembly.Module(wat2wasm(url.pathname, code)));
});

/**
 * Tokens for `code` from the whole buffer and from a StreamTokenizer fed one
 * line per push - the chunk shape the LiveTokenizer uses - so a test can
 * assert that a construct crossing line boundaries resumes correctly.
 */
function wholeAndLineFed(
  lang: Lang,
  code: string
): [ThemedToken[][], ThemedToken[][]] {
  const whole = codeToTokens(code, { lang, theme: pierreDark }).tokens;
  const stream = new StreamTokenizer({ lang, theme: pierreDark });
  const streamed: ThemedToken[][] = [];
  for (const line of code.split(/(?<=\n)/)) {
    streamed.push(...stream.pushCode(line));
  }
  streamed.push(...stream.end());
  return [whole, streamed];
}

/** The color of the first span whose trimmed text is exactly `word`. */
function exact(html: string, word: string): string | null | undefined {
  return spansOf(html).find((s) => s.text.trim() === word)?.color;
}

/** The color of the first span containing `text`. */
function within(html: string, text: string): string | null | undefined {
  return spansOf(html).find((s) => s.text.includes(text))?.color;
}

void t.test(
  'terraform: blocks, attributes, references, functions, and control words',
  () => {
    const html = checkInvariants(
      lexer.hl,
      'terraform {\n  required_providers { aws = { source = "hashicorp/aws" } }\n}\nresource "aws_instance" "web" {\n  count = var.enabled ? 1 : 0\n  ami   = data.aws_ami.ubuntu.id\n  tags  = merge(local.tags, { Name = "web-${count.index}" })\n  ports = [for p in var.ports : p if p > 1024]\n  type  = list(string)\n  nil   = null\n  ok    = true\n}',
      { theme: distinct }
    );
    assert.equal(
      exact(html, 'terraform'),
      distinctColor('keyword.declaration')
    );
    assert.equal(
      exact(html, 'required_providers'),
      distinctColor('keyword.declaration')
    );
    assert.equal(exact(html, 'aws'), distinctColor('property'));
    assert.equal(exact(html, 'source'), distinctColor('property'));
    assert.equal(exact(html, 'resource'), distinctColor('keyword.declaration'));
    assert.equal(within(html, '"aws_instance"'), distinctColor('string'));
    assert.equal(exact(html, 'count'), distinctColor('property'));
    assert.equal(exact(html, 'var'), distinctColor('variable.special'));
    assert.equal(exact(html, 'enabled'), distinctColor('property'));
    assert.equal(exact(html, 'data'), distinctColor('variable.special'));
    assert.equal(exact(html, 'merge'), distinctColor('function'));
    assert.equal(exact(html, 'local'), distinctColor('variable.special'));
    assert.equal(exact(html, '${'), distinctColor('punctuation.special'));
    assert.equal(exact(html, 'index'), distinctColor('property'));
    assert.equal(exact(html, 'for'), distinctColor('keyword.control'));
    assert.equal(exact(html, 'in'), distinctColor('keyword.control'));
    assert.equal(exact(html, 'if'), distinctColor('keyword.control'));
    assert.equal(exact(html, 'list'), distinctColor('type.builtin'));
    assert.equal(exact(html, 'string'), distinctColor('type.builtin'));
    assert.equal(exact(html, 'null'), distinctColor('constant.builtin'));
    assert.equal(exact(html, 'true'), distinctColor('boolean'));
  }
);

void t.test(
  'terraform: comments, heredocs, template directives, and escapes',
  () => {
    const html = checkInvariants(
      lexer.hl,
      '# one\n// two\n/* three */\nuser_data = <<-EOT\n  echo "${var.msg}"\n  EOT\ndesc = "%{ if x }y%{ endif } $${lit} \\n"',
      { theme: distinct }
    );
    assert.equal(within(html, '# one'), distinctColor('comment'));
    assert.equal(within(html, '// two'), distinctColor('comment'));
    assert.equal(within(html, '/* three */'), distinctColor('comment'));
    assert.equal(within(html, '<<-EOT'), distinctColor('string'));
    assert.equal(within(html, 'echo'), distinctColor('string'));
    assert.equal(exact(html, '%{'), distinctColor('punctuation.special'));
    assert.equal(exact(html, 'endif'), distinctColor('keyword.control'));
    assert.equal(within(html, '$${lit}'), distinctColor('string'));
    assert.equal(within(html, '\\n'), distinctColor('string.escape'));
  }
);

void t.test('terraform: malformed constructs stay total and lossless', () => {
  for (const src of [
    '',
    '/',
    '/*',
    '// tail',
    '"unterminated',
    "'\\",
    '0x_',
    '\u00e9 \u65e5\u672c\u8a9e',
    '#',
    '@',
    '${',
    '#{',
    '<<',
    '%',
    '<<EOT',
    '<<-',
    '"${',
    '%{',
    '<<',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('terraform: split ranges bound every lookahead', () => {
  const src = 'x = <<-EOT\n  a ${b}\n  EOT\ny = "a ${z} b" # c';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('terraform', '$hlTerraform', split).hl, src);
  }
});

void t.test(
  'terraform: malformed UTF-8 stays balanced and decodes losslessly',
  () => {
    const bytes = Uint8Array.of(
      0x66,
      0x6f,
      0x6f,
      0x20,
      0xf0,
      0x28,
      0x8c,
      0x28,
      0x20,
      0xff
    );
    const html = lexer.hl(bytes);
    assert.equal(textOf(html), new TextDecoder().decode(bytes));
    spansOf(html);
  }
);

void t.test('terraform: deterministic fuzz preserves lexer invariants', () => {
  let state = 0x51f15e;
  const alphabet = 'abcXYZ09_ /\\"\'`\n\t{}[]().,:;+-*=!<>&|#@$%~?\u00e9';
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = state & 63; i < len; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(lexer.hl, src);
  }
});

void t.test('terraform: multi-line constructs resume line-fed', () => {
  for (const code of [
    'x = <<-EOT\n  hello ${var.y}\n  EOT\ny = "a ${z} b"\n',
    'x = <<EOT\nline\nEOT\ny = 1\n',
    'a = 1 /* open\nstill */\nb = 2\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('terraform', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinct });

void t.test(
  'terraform: every top-level block, nested blocks, meta-arguments, and references',
  () => {
    const html = distinctHl(
      'terraform {\n  required_version = ">= 1.5"\n  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.0" } }\n  backend "s3" { bucket = "x" }\n}\nprovider "aws" { region = var.region }\nvariable "name" {\n  type        = string\n  default     = "demo"\n  description = "d"\n  validation { condition = length(var.name) > 0; error_message = "e" }\n}\nlocals { tags = { env = var.env, owner = "team-${var.name}" }; n = length(var.zones) > 0 ? 3 : 1 }\ndata "aws_ami" "ubuntu" { most_recent = true }\nresource "aws_s3_bucket" "logs" {\n  bucket   = "${local.tags.env}-logs"\n  count    = local.n\n  for_each = toset(var.zones)\n  depends_on = [aws_vpc.main]\n  lifecycle { ignore_changes = [tags]; create_before_destroy = true; prevent_destroy = false }\n  dynamic "rule" { for_each = var.rules }\n  tags = merge(local.tags, { Name = "x" })\n}\nmodule "vpc" { source = "./vpc"; cidr = "10.0.0.0/16" }\noutput "arn" { value = aws_s3_bucket.logs[0].arn; sensitive = true }\nmoved { from = a.b; to = c.d }\nimport { to = aws_x.y; id = "z" }\ncheck "c" { }\nremoved { from = aws_q.r }'
    );
    for (const word of [
      'terraform',
      'required_providers',
      'backend',
      'provider',
      'variable',
      'validation',
      'locals',
      'data',
      'resource',
      'lifecycle',
      'dynamic',
      'module',
      'output',
      'moved',
      'import',
      'check',
      'removed',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.declaration'),
        word
      );
    }
    for (const prop of [
      'required_version',
      'aws',
      'source',
      'version',
      'bucket',
      'region',
      'type',
      'default',
      'description',
      'condition',
      'error_message',
      'tags',
      'env',
      'owner',
      'n',
      'most_recent',
      'count',
      'for_each',
      'depends_on',
      'main',
      'ignore_changes',
      'create_before_destroy',
      'prevent_destroy',
      'rules',
      'Name',
      'cidr',
      'value',
      'arn',
      'sensitive',
      'from',
      'to',
      'id',
    ]) {
      assert.equal(wordColor(html, prop), distinctColor('property'), prop);
    }
    for (const word of ['var', 'local']) {
      assert.equal(
        wordColor(html, word),
        distinctColor('variable.special'),
        word
      );
    }
    for (const name of [
      'aws_vpc',
      'aws_s3_bucket',
      'aws_x',
      'aws_q',
      'a',
      'c',
    ]) {
      assert.equal(wordColor(html, name), distinctColor('variable'), name);
    }
    for (const fn of ['length', 'toset', 'merge']) {
      assert.equal(wordColor(html, fn), distinctColor('function'), fn);
    }
    for (const s of ['">= 1.5"', '"~> 5.0"']) {
      assert.equal(exactColor(html, s), distinctColor('string'), s);
    }
    for (const s of [
      '"hashicorp/aws"',
      '"s3"',
      '"aws"',
      '"demo"',
      '"aws_ami"',
      '"ubuntu"',
      '"aws_s3_bucket"',
      '"logs"',
      '"rule"',
      '"vpc"',
      '"./vpc"',
      '"10.0.0.0/16"',
      '"arn"',
      '"z"',
      '"c"',
    ]) {
      assert.equal(wordColor(html, s), distinctColor('string'), s);
    }
    assert.equal(wordColor(html, 'string'), distinctColor('type.builtin'));
    for (const b of ['true', 'false']) {
      assert.equal(wordColor(html, b), distinctColor('boolean'), b);
    }
    for (const n of ['0', '3', '1']) {
      assert.equal(wordColor(html, n), distinctColor('number'), n);
    }
    for (const op of ['=', '>', '?']) {
      assert.equal(wordColor(html, op), distinctColor('operator'), op);
    }
    assert.equal(wordColor(html, '${'), distinctColor('punctuation.special'));
  }
);

void t.test(
  'terraform: literals, template interpolation and directives, collections, for expressions, splats, and heredocs',
  () => {
    const html = distinctHl(
      'x = 0x1F + 1_000 + 1e3 + 2.5 + -3; s = "esc\\t ${var.a} %{if var.b}yes%{else}no%{endif} $${literal} %%{literal}"; b = true; n = null; l = [1, "a", true]; m = { k = "v", "quoted" = 1, (expr) = 2 }; t = tuple([1]); o = object({ a = string }); f = a == b && c != d || !e; g = a ? b : c; h = [for x in l : upper(x) if x != ""]; i = { for k, v in m : k => v }; j = a[*].id; k = a.*.id; ii = l[0]; sp = a...; e = <<EOT\nheredoc ${var.x}\nEOT\nei = <<-EOT\n  indented\n  EOT\ntypes = [string, number, bool, any, list(string), map(number), set(string), object({}), tuple([])]'
    );
    for (const n of ['0x1F', '1_000', '1e3', '2.5', '3', '1', '2', '0']) {
      assert.equal(wordColor(html, n), distinctColor('number'), n);
    }
    assert.equal(exactColor(html, '\\t'), distinctColor('string.escape'));
    for (const p of ['${', '%{', '}']) {
      assert.equal(wordColor(html, p), distinctColor('punctuation.special'), p);
    }
    for (const word of ['if', 'else', 'endif', 'for', 'in']) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.control'),
        word
      );
    }
    assert.equal(wordColor(html, 'var'), distinctColor('variable.special'));
    for (const s of [
      'yes',
      'no',
      '$${literal}',
      '%%{literal}"',
      '"quoted"',
      '<<EOT',
      'heredoc',
      'EOT',
      '<<-EOT',
      'indented',
      '""',
    ]) {
      assert.equal(wordColor(html, s), distinctColor('string'), s);
    }
    assert.equal(wordColor(html, 'true'), distinctColor('boolean'));
    assert.equal(wordColor(html, 'null'), distinctColor('constant.builtin'));
    for (const type of [
      'tuple',
      'object',
      'string',
      'number',
      'bool',
      'any',
      'list',
      'map',
      'set',
    ]) {
      assert.equal(wordColor(html, type), distinctColor('type.builtin'), type);
    }
    assert.equal(wordColor(html, 'upper'), distinctColor('function'));
    assert.equal(wordColor(html, 'expr'), distinctColor('variable'));
    for (const op of [
      '+',
      '-',
      '==',
      '&&',
      '!=',
      '||',
      '!',
      '?',
      '=>',
      '*',
      '...',
    ]) {
      assert.equal(wordColor(html, op), distinctColor('operator'), op);
    }
  }
);

void t.test('terraform: comment forms', () => {
  assert.deepEqual(
    tokenKinds(
      'terraform',
      '# hash comment\n// slash comment\n/* block\n */\nx = 1 # tail'
    ),
    [
      ['# hash comment', 'comment'],
      ['// slash comment', 'comment'],
      ['/* block', 'comment'],
      ['*/', 'comment'],
      ['x', 'property'],
      ['=', 'operator'],
      ['1', 'number'],
      ['# tail', 'comment'],
    ]
  );
});

void t.test(
  'terraform: heredocs, templates, and nested blocks stream line-fed',
  () => {
    assertLineFedParity(
      'terraform',
      'resource "aws_s3_bucket" "logs" {\n  bucket = "${local.tags.env}-logs"\n  policy = <<EOT\n{\n  "x": "${var.x}"\n}\nEOT\n  user_data = <<-EOF\n    #!/bin/bash\n    EOF\n  tags = merge(local.tags, {\n    Name = "x"\n  })\n  /* block\n     comment */\n}\n'
    );
  }
);
