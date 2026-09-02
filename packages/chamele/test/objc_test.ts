import assert from 'node:assert';
import t from 'node:test';

import type { Lang, Theme, ThemedToken } from '../lib/index';
import { codeToTokens, init, StreamTokenizer } from '../lib/index';
import tokenTypes from '../lib/token-types';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import {
  checkInvariants,
  loadLang,
  spansOf,
  type TestLang,
  textOf,
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
  lexer = loadLang('objc', '$hlObjc');
  // the streaming tests below need the full module behind codeToTokens
  const url = new URL('../src/chamele.wat', import.meta.url);
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
  'objc: directives, message sends, properties, and method declarations',
  () => {
    const html = checkInvariants(
      lexer.hl,
      '#import <Foundation/Foundation.h>\n@interface Box : NSObject <NSCopying>\n@property (nonatomic, strong) NSString *name;\n- (instancetype)initWithName:(NSString *)name count:(NSInteger)count;\n+ (void)reset;\n@end\n@implementation Box\n- (void)run {\n  self.name = [[name copy] uppercaseString];\n  NSArray *xs = @[@1, @"two", @(3.5)];\n  if (self && name != nil) return;\n  [xs enumerateObjectsUsingBlock:^(id obj, BOOL *stop) { *stop = YES; }];\n}\n@end',
      { theme: distinct }
    );
    assert.equal(within(html, '#import'), distinctColor('preproc'));
    assert.equal(
      within(html, '<Foundation/Foundation.h>'),
      distinctColor('string')
    );
    assert.equal(exact(html, '@interface'), distinctColor('keyword'));
    assert.equal(exact(html, 'Box'), distinctColor('type'));
    assert.equal(exact(html, 'NSObject'), distinctColor('type'));
    assert.equal(exact(html, '@property'), distinctColor('keyword'));
    assert.equal(exact(html, 'nonatomic'), distinctColor('keyword'));
    assert.equal(exact(html, 'strong'), distinctColor('keyword'));
    assert.equal(
      exact(html, 'initWithName'),
      distinctColor('function.definition')
    );
    assert.equal(exact(html, 'count'), distinctColor('function.definition'));
    assert.equal(exact(html, 'reset'), distinctColor('function.definition'));
    assert.equal(exact(html, 'self'), distinctColor('variable.special'));
    assert.equal(exact(html, 'copy'), distinctColor('function.method'));
    assert.equal(
      exact(html, 'uppercaseString'),
      distinctColor('function.method')
    );
    assert.equal(exact(html, '@"two"'), distinctColor('string'));
    assert.equal(exact(html, 'nil'), distinctColor('constant.builtin'));
    assert.equal(exact(html, 'id'), distinctColor('type.builtin'));
    assert.equal(exact(html, 'YES'), distinctColor('constant.builtin'));
    assert.equal(
      exact(html, 'enumerateObjectsUsingBlock'),
      distinctColor('function.method')
    );
  }
);

void t.test('objc: malformed constructs stay total and lossless', () => {
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
    '@"',
    '@[',
    '- (',
    '@interface',
    '[obj',
  ]) {
    checkInvariants(lexer.hl, src);
  }
});

void t.test('objc: split ranges bound every lookahead', () => {
  const src = 'x// tail\n[obj m:@"a\\n" b:1];// c';
  for (let split = 0; split <= new TextEncoder().encode(src).length; split++) {
    checkInvariants(loadLang('objc', '$hlObjc', split).hl, src);
  }
});

void t.test(
  'objc: malformed UTF-8 stays balanced and decodes losslessly',
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

void t.test('objc: deterministic fuzz preserves lexer invariants', () => {
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

void t.test('objc: multi-line constructs resume line-fed', () => {
  for (const code of [
    'NSString *s = @"a"; /* open\nstill */\nint x;\n',
    '- (void)f:(int)a\n  b:(int)c;\n',
  ]) {
    const [whole, streamed] = wholeAndLineFed('objc', code);
    assert.deepEqual(streamed, whole, JSON.stringify(code));
  }
});
