import assert from 'node:assert';
import t from 'node:test';

import { codeToTokens, LiveTokenizer, type ThemedToken } from '../lib/index';
import {
  assertLineFedParity,
  checkInvariants,
  distinctTheme,
  initFullModule,
  kindOfColor,
  loadLang,
  type TestLang,
  tokenKinds,
} from './_util';

let csv: TestLang;
let tsv: TestLang;
t.before(() => {
  csv = loadLang('csv', '$hlCsv');
  tsv = loadLang('tsv', '$hlTsv');
});

/** The kind of the first token whose trimmed text is exactly `text`. */
function kindOf(kinds: [string, string | null][], text: string) {
  const found = kinds.find(([t]) => t === text);
  assert.ok(found !== undefined, `no token ${JSON.stringify(text)}`);
  return found[1];
}

void t.test('csv: each column keeps one color, neighbors differ', () => {
  const kinds = tokenKinds(
    'csv',
    'a1,b1,c1,d1,e1\na2,b2,c2,d2,e2\na3,b3,c3,d3,e3\n'
  );
  const columns = ['a', 'b', 'c', 'd', 'e'].map((col) =>
    [1, 2, 3].map((row) => kindOf(kinds, `${col}${row}`))
  );
  for (const [i, column] of columns.entries()) {
    assert.ok(column[0] !== null, `column ${i} is styled`);
    assert.deepEqual(new Set(column).size, 1, `column ${i}`);
    if (i > 0) assert.notEqual(column[0], columns[i - 1][0], `column ${i}`);
  }
  for (const [text, kind] of kinds) {
    if (text === ',') assert.equal(kind, 'punctuation.delimiter');
  }
});

void t.test('csv: a quoted field holds delimiters and line breaks', () => {
  const kinds = tokenKinds('csv', 'h1,h2,h3\nx,"one, two\nthree",y\nz,w\n');
  assert.equal(kindOf(kinds, '"one, two'), kindOf(kinds, 'h2'));
  assert.equal(kindOf(kinds, 'three"'), kindOf(kinds, 'h2'));
  assert.equal(kindOf(kinds, 'y'), kindOf(kinds, 'h3'));
  // the record after the quoted line break starts at the first column again
  assert.equal(kindOf(kinds, 'z'), kindOf(kinds, 'h1'));
  assert.equal(kindOf(kinds, 'w'), kindOf(kinds, 'h2'));
});

void t.test('csv: a doubled quote is an escape, not the field end', () => {
  const kinds = tokenKinds('csv', 'h1,h2\n"say ""hi"", ok",next\n');
  assert.deepEqual(
    kinds.filter(([text]) => text === '""').map(([, kind]) => kind),
    ['string.escape', 'string.escape']
  );
  assert.equal(kindOf(kinds, ', ok"'), kindOf(kinds, 'h1'));
  assert.equal(kindOf(kinds, 'next'), kindOf(kinds, 'h2'));
});

void t.test('csv: a quote opens a field only at the field start', () => {
  const kinds = tokenKinds('csv', 'h1,h2,h3\nab"c,d,e\n');
  assert.equal(kindOf(kinds, 'ab"c'), kindOf(kinds, 'h1'));
  assert.equal(kindOf(kinds, 'e'), kindOf(kinds, 'h3'));
});

void t.test('csv: an unclosed quote runs to the end of the input', () => {
  const src = 'h1,h2,h3\nx,"open\ny,z\n';
  checkInvariants(csv.hl, src);
  const kinds = tokenKinds('csv', src);
  assert.equal(kindOf(kinds, 'y,z'), kindOf(kinds, 'h2'));
});

void t.test('csv: LF, CRLF, and a lone CR each end a record', () => {
  const src = 'h1,h2\r\na,b\rc,d\ne,f';
  checkInvariants(csv.hl, src);
  const kinds = tokenKinds('csv', src);
  for (const [first, second] of [
    ['a', 'b'],
    ['c', 'd'],
    ['e', 'f'],
  ]) {
    assert.equal(kindOf(kinds, first), kindOf(kinds, 'h1'), first);
    assert.equal(kindOf(kinds, second), kindOf(kinds, 'h2'), second);
  }
  assertLineFedParity('csv', src);
});

// LiveTokenizer splits lines at a lone CR, so its columns must match the
// whole-input run there too. Whole-input records do not break at a lone CR
// and can merge across it, so both sides compare their text split at CR.
void t.test('csv, tsv: live documents match whole input at a lone CR', () => {
  initFullModule();
  const pieces = (tokens: ThemedToken[]) =>
    tokens.flatMap((tok) =>
      tok.content
        .split('\r')
        .map((text): [string, string | null] => [
          text.trim(),
          kindOfColor(tok.color),
        ])
        .filter(([text]) => text !== '')
    );
  for (const [lang, code] of [
    ['csv', 'h1,h2,h3\ra,b,c\r"x\ry",z\rd,e\r\n'],
    ['tsv', 'h1\th2\th3\ra\tb\tc\rd\te\r\n'],
  ] as const) {
    const live = new LiveTokenizer({ lang, theme: distinctTheme, code });
    const lines = Array.from(
      { length: live.lineCount },
      (_, line) => live.getLineTokens(line).tokens
    );
    live.dispose();
    const whole = codeToTokens(code, { lang, theme: distinctTheme }).tokens;
    assert.deepEqual(pieces(lines.flat()), pieces(whole.flat()), lang);
  }
});

void t.test('csv: HTML specials and Unicode stay lossless', () => {
  checkInvariants(csv.hl, '<a>,"&amp;\n<b>",λ😀,""""\n,,\n');
});

void t.test('csv: quoted line breaks stream line-fed', () => {
  assertLineFedParity(
    'csv',
    'id,note,tail\n1,"first\nsecond, ""third""\nfourth",x\n2,y,z\n'
  );
});

void t.test('tsv: tabs delimit and quotes are data', () => {
  const src = 'h1\th2\th3\th4\n"a\tb"\tc,d\te\n';
  checkInvariants(tsv.hl, src);
  const kinds = tokenKinds('tsv', src);
  assert.equal(kindOf(kinds, '"a'), kindOf(kinds, 'h1'));
  assert.equal(kindOf(kinds, 'b"'), kindOf(kinds, 'h2'));
  assert.equal(kindOf(kinds, 'c,d'), kindOf(kinds, 'h3'));
  assert.equal(kindOf(kinds, 'e'), kindOf(kinds, 'h4'));
});
