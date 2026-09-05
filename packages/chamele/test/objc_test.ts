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

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(lexer.hl, src, { theme: distinct });

void t.test(
  'objc: preprocessor lines, @-directives, protocols, interfaces, and properties',
  () => {
    const html = distinctHl(
      '#import <Foundation/Foundation.h>\n#import "X.h"\n#define MAX 10\n#pragma mark - Section\n@import UIKit;\n@class Forward;\n@protocol P <NSObject>\n@required\n- (void)f;\n@optional\n- (void)g;\n@end\n@interface Counter : NSObject <NSCopying, P> { NSInteger _count; }\n@property (nonatomic, strong, readonly) NSString *name;\n+ (instancetype)sharedInstance;\n- (instancetype)initWithCount:(NSInteger)count name:(NSString *)name;\n@end\n@interface Counter (Category) @end\n@implementation Counter\n@synthesize name = _name;\n@dynamic shared;\n@end'
    );
    for (const pre of ['#import', '#define', '#pragma']) {
      assert.equal(wordColor(html, pre), distinctColor('preproc'), pre);
    }
    for (const s of ['<Foundation/Foundation.h>', '"X.h"']) {
      assert.equal(exactColor(html, s), distinctColor('string'), s);
    }
    for (const word of [
      '@import',
      '@class',
      '@protocol',
      '@required',
      '@optional',
      '@end',
      '@interface',
      '@property',
      '@implementation',
      '@synthesize',
      '@dynamic',
      'nonatomic',
      'strong',
      'readonly',
    ]) {
      assert.equal(wordColor(html, word), distinctColor('keyword'), word);
    }
    for (const type of [
      'UIKit',
      'Forward',
      'P',
      'NSObject',
      'Counter',
      'NSCopying',
      'NSInteger',
      'NSString',
      'Category',
    ]) {
      assert.equal(wordColor(html, type), distinctColor('type'), type);
    }
    for (const type of ['void', 'instancetype']) {
      assert.equal(wordColor(html, type), distinctColor('type.builtin'), type);
    }
    for (const fn of ['f', 'g', 'sharedInstance', 'initWithCount']) {
      assert.equal(
        exactColor(html, fn),
        distinctColor('function.definition'),
        fn
      );
    }
    for (const op of ['-', '+', '*', '<', '>']) {
      assert.equal(exactColor(html, op), distinctColor('operator'), op);
    }
    for (const v of ['_count', 'count', '_name', 'shared']) {
      assert.equal(exactColor(html, v), distinctColor('variable'), v);
    }
  }
);

void t.test(
  'objc: literal forms, boxed literals, and special constants',
  () => {
    const html = distinctHl(
      'NSInteger x = 0x1F + 1_000 + 1e3f + 2.5 + 3L; char c = \'a\'; char n = \'\\n\'; NSString *s = @"esc\\t %@"; NSNumber *num = @42; NSNumber *b = @YES; NSArray *a = @[@1, @"x"]; NSDictionary *d = @{ @"k": @1 }; id o = nil; Class cls = Nil; BOOL t = YES; SEL sel = @selector(f:); Protocol *p = @protocol(P); const char *e = @encode(int); void *np = NULL;'
    );
    for (const n of ['0x1F', '1_000', '1e3f', '2.5', '3L', '42']) {
      assert.equal(exactColor(html, n), distinctColor('number'), n);
    }
    assert.equal(exactColor(html, "'a'"), distinctColor('string'));
    for (const esc of ['\\n', '\\t']) {
      assert.equal(exactColor(html, esc), distinctColor('string.escape'), esc);
    }
    for (const s of ['@"esc', '@"x"', '@"k"']) {
      assert.equal(exactColor(html, s), distinctColor('string'), s);
    }
    assert.equal(exactColor(html, '@'), distinctColor('punctuation.special'));
    assert.equal(exactColor(html, '@YES'), distinctColor('keyword'));
    for (const type of ['id', 'Class', 'BOOL', 'SEL', 'char', 'void']) {
      assert.equal(wordColor(html, type), distinctColor('type.builtin'), type);
    }
    for (const c of ['nil', 'Nil', 'YES']) {
      assert.equal(exactColor(html, c), distinctColor('constant.builtin'), c);
    }
    for (const word of ['@selector', '@protocol', '@encode', 'const']) {
      assert.equal(wordColor(html, word), distinctColor('keyword'), word);
    }
    assert.equal(exactColor(html, 'NULL'), distinctColor('constant'));
    for (const type of [
      'NSString',
      'NSNumber',
      'NSArray',
      'NSDictionary',
      'Protocol',
    ]) {
      assert.equal(wordColor(html, type), distinctColor('type'), type);
    }
    assert.equal(exactColor(html, 'f'), distinctColor('function.method'));
  }
);

void t.test(
  'objc: messages, blocks, control flow, exceptions, and storage qualifiers',
  () => {
    const html = distinctHl(
      '- (void)increment:(int)by { if (self.count > MAX && by || !done) { return; } for (NSString *s in items) { continue; } for (int i = 0; i < 3; i++) { break; } while (x) {} do {} while (y); switch (k) { case 1: break; } @try { @throw [NSException new]; } @catch (NSException *e) { } @finally { } @synchronized (self) { } @autoreleasepool { } [self doSomething:1 with:2]; [[Counter alloc] init]; [super dealloc]; self.count += by; obj.prop.sub; ^(int a) { return a; }; __block int bb = 0; __strong id st; __bridge id br; __kindof NSObject *ko; nullable id nn; nonnull id nu; IBOutlet UIView *v; static const int sc = 1; extern int ex; typedef struct { int a; } S; NS_ENUM(NSInteger, T) { T1 }; sizeof(int); typeof(x); @available(iOS 13, *); }'
    );
    assert.equal(
      exactColor(html, 'increment'),
      distinctColor('function.definition')
    );
    assert.equal(exactColor(html, 'by'), distinctColor('variable'));
    for (const word of [
      'if',
      'return',
      'for',
      'continue',
      'break',
      'while',
      'do',
      'switch',
      'case',
    ]) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.control'),
        word
      );
    }
    for (const word of [
      'in',
      '@try',
      '@throw',
      '@catch',
      '@finally',
      '@synchronized',
      '@autoreleasepool',
      '__block',
      '__strong',
      '__bridge',
      '__kindof',
      'nullable',
      'nonnull',
      'IBOutlet',
      'const',
      'sizeof',
      'typeof',
      '@available',
    ]) {
      assert.equal(wordColor(html, word), distinctColor('keyword'), word);
    }
    for (const word of ['static', 'extern', 'typedef']) {
      assert.equal(
        wordColor(html, word),
        distinctColor('keyword.declaration'),
        word
      );
    }
    for (const v of ['self', 'super']) {
      assert.equal(wordColor(html, v), distinctColor('variable.special'), v);
    }
    for (const p of ['count', 'prop', 'sub']) {
      assert.equal(exactColor(html, p), distinctColor('property'), p);
    }
    assert.equal(exactColor(html, 'MAX'), distinctColor('constant'));
    for (const m of [
      'doSomething',
      'with',
      'alloc',
      'init',
      'dealloc',
      'new',
    ]) {
      assert.equal(wordColor(html, m), distinctColor('function.method'), m);
    }
    assert.equal(exactColor(html, '^'), distinctColor('operator'));
    for (const type of [
      'NSException',
      'Counter',
      'NSObject',
      'UIView',
      'NSInteger',
      'T',
      'S',
    ]) {
      assert.equal(wordColor(html, type), distinctColor('type'), type);
    }
    for (const c of ['T1', 'NS_ENUM']) {
      assert.equal(exactColor(html, c), distinctColor('constant'), c);
    }
    for (const op of ['&&', '||', '!', '++', '+=', '*', '<', '>']) {
      assert.equal(wordColor(html, op), distinctColor('operator'), op);
    }
  }
);

void t.test('objc: comment forms', () => {
  assert.deepEqual(
    tokenKinds(
      'objc',
      '// line\n/* block\n */\n/// doc\n/** block doc */\n- (void)f {} // tail'
    ),
    [
      ['// line', 'comment'],
      ['/* block', 'comment'],
      ['*/', 'comment'],
      ['/// doc', 'comment.doc'],
      ['/** block doc */', 'comment.doc'],
      ['-', 'operator'],
      ['(', 'punctuation.bracket'],
      ['void', 'type.builtin'],
      [')', 'punctuation.bracket'],
      ['f', 'function.definition'],
      ['{}', 'punctuation.bracket'],
      ['// tail', 'comment'],
    ]
  );
});

void t.test(
  'objc: block comments and multi-line messages stream line-fed',
  () => {
    assertLineFedParity(
      'objc',
      '/* a\n b */\n/// c\n[self doSomething:1\n      with:@"x\\n"];\nNSString *s = @"a"\n  @"b";\n'
    );
  }
);
