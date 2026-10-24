//! WAT sources: src/langs/c3.wat src/common.wat src/scan.wat
//!
//! Native C3 lexer. One pass over the input: each token is scanned and
//! colored in the same step, with the same rules, in the same order, as the
//! translated `$hlC3`. The records equal the translated lexer's records.
//!
//! The WAT tests its rules in one chain. Most rules match one first byte,
//! so this lexer dispatches on a byte class and, for each class, tests only
//! the rules that can match it, in the WAT's order.

use super::Lexer;
use super::scan;
use super::tables::byteset;
use crate::Rec;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::C3_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "c3" => Some(highlight),
        _ => None,
    }
}

/// `$c3Words` as a perfect hash on a word's bytes. A word of up to 16
/// bytes is two little-endian integers (bytes 0-7 and 8-15), zero past its
/// end; identifiers hold no NUL, so equal integers mean equal words.
struct Words {
    /// Entry number plus one for each hash slot, or 0 for no word.
    index: [u8; WORD_SLOTS],
    /// Each entry's integers; 256 entries, so an index byte needs no
    /// bounds check.
    keys: [(u64, u64); 256],
    /// The word's `keyword-table.value`: its token, with the next-name
    /// capture above it.
    values: [u16; 256],
    mul: u64,
}

const WORD_SLOTS: usize = 4096;

/// The longest word.
const WORD_MAX: usize = 16;

/// The slot of the word with integers `lo` and `hi`.
#[inline(always)]
const fn word_slot(lo: u64, hi: u64, mul: u64) -> usize {
    let h = lo ^ hi.rotate_left(29);
    (h.wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros())) as usize
}

/// The integers of the word `w`.
const fn word_key(w: &[u8]) -> (u64, u64) {
    let mut lo = 0u64;
    let mut hi = 0u64;
    let mut i = 0;
    while i < w.len() {
        if i < 8 {
            lo |= (w[i] as u64) << (8 * i);
        } else {
            hi |= (w[i] as u64) << (8 * (i - 8));
        }
        i += 1;
    }
    (lo, hi)
}

/// For each first byte, a bit per length of the words in [`WORDS`]. A name
/// whose bit is clear is no word.
static WORD_LENGTHS: [u32; 256] = {
    let mut t = [0u32; 256];
    let mut i = 0;
    while i < C3_WORDS.len() {
        let w = C3_WORDS[i].word;
        t[w[0] as usize] |= 1 << w.len();
        i += 1;
    }
    t
};

/// The words, placed by searching for a multiplier that gives each its own
/// slot.
static WORDS: Words = {
    assert!(C3_WORDS.len() < 256);
    let mut keys = [(0u64, 0u64); 256];
    let mut values = [0u16; 256];
    let mut i = 0;
    while i < C3_WORDS.len() {
        let w = C3_WORDS[i].word;
        let value = C3_WORDS[i].value;
        assert!(w.len() <= WORD_MAX && value > 0 && value < 0x10000);
        keys[i] = word_key(w);
        values[i] = value as u16;
        i += 1;
    }
    let mut mul: u64 = 0x2545_f491_4f6c_dd1d;
    let mut attempt = 0;
    'search: loop {
        assert!(attempt < 20_000, "no collision-free hash: use more slots");
        let mut index = [0u8; WORD_SLOTS];
        let mut i = 0;
        while i < C3_WORDS.len() {
            let s = word_slot(keys[i].0, keys[i].1, mul);
            if index[s] != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            index[s] = i as u8 + 1;
            i += 1;
        }
        break Words {
            index,
            keys,
            values,
            mul,
        };
    }
};

/// Operator bytes (`$c3IsOp`).
const OPS: [bool; 256] = byteset(b"!%&*+-/<=>?^|~");

/// Bytes that double into a compound operator (`&&`, `??`, ...).
static DOUBLES: [bool; 256] = byteset(b"!&+-<>?|");

/// Byte classes for the main dispatch.
mod class {
    /// An identifier start (`$lexIsIdentStart`), including `$`.
    pub const IDENT: u8 = 0;
    /// Anything else: one plain byte.
    pub const OTHER: u8 = 1;
    pub const DIGIT: u8 = 2;
    /// `"` or `'`.
    pub const QUOTE: u8 = 3;
    pub const BACKTICK: u8 = 4;
    pub const AT: u8 = 5;
    pub const SLASH: u8 = 6;
    pub const DOT: u8 = 7;
    /// `(`, `)`, `[`, `]`, `{`, or `}`.
    pub const BRACKET: u8 = 8;
    /// `,` or `;`.
    pub const DELIM: u8 = 9;
    pub const COLON: u8 = 10;
    /// An operator byte other than `/` (`$c3IsOp`).
    pub const OP: u8 = 11;
    /// ASCII whitespace.
    pub const SPACE: u8 = 12;
    /// NUL: the end of the input, or a plain byte inside it.
    pub const NUL: u8 = 13;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = if is_ident_start(b) {
            class::IDENT
        } else if is_digit(b) {
            class::DIGIT
        } else if is_space(b) {
            class::SPACE
        } else {
            match b {
                0 => class::NUL,
                b'"' | b'\'' => class::QUOTE,
                b'`' => class::BACKTICK,
                b'@' => class::AT,
                b'/' => class::SLASH,
                b'.' => class::DOT,
                b'(' | b')' | b'[' | b']' | b'{' | b'}' => class::BRACKET,
                b',' | b';' => class::DELIM,
                b':' => class::COLON,
                _ if OPS[c] => class::OP,
                _ => class::OTHER,
            }
        };
        c += 1;
    }
    t
};

/// Identifier bytes (`$lexIsIdentContinue`).
static IDENT_CONT: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = is_ident_continue(c as u8);
        c += 1;
    }
    t
};
/// The byte at `i`. Every caller reads inside the input or its 96-byte
/// slack. The byte at the input end is NUL, which matches none of the
/// bytes a lookahead tests, so a one-byte lookahead past a token needs no
/// bounds check.
#[inline(always)]
fn at(src: &[u8], i: usize) -> u8 {
    debug_assert!(i < src.len());
    // SAFETY: `i` lies inside the input or its slack (see above).
    unsafe { *src.get_unchecked(i) }
}

/// Whether `c` is ASCII whitespace: space or TAB through CR (`$lexIsSpace`).
#[inline(always)]
const fn is_space(c: u8) -> bool {
    c == b' ' || c.wrapping_sub(9) <= 4
}

/// Whether `c` is an ASCII digit (`$lexIsDigit`).
#[inline(always)]
const fn is_digit(c: u8) -> bool {
    c.wrapping_sub(b'0') <= 9
}

/// Whether `c` starts an identifier: a letter, `_`, `$`, or any byte from
/// 0x80 (`$lexIsIdentStart`).
#[inline(always)]
const fn is_ident_start(c: u8) -> bool {
    c >= 0x80 || (c | 32).wrapping_sub(b'a') <= 25 || c == b'_' || c == b'$'
}

/// Whether `c` continues an identifier (`$lexIsIdentContinue`).
#[inline(always)]
const fn is_ident_continue(c: u8) -> bool {
    is_ident_start(c) || is_digit(c)
}

/// Token records written straight into `inst.ext.recs` the way `$emitTok`
/// and `$emitGap` write them: a token extends the last record when its
/// color matches, and whitespace extends the last record whatever its
/// color. The vector has room for one record per input byte and every
/// record covers at least one byte, so running out of room means a lexer
/// bug, which traps. Helpers off the hot path take it by value and return
/// it, so its fields stay in registers in the main loop.
struct Out {
    base: *mut Rec,
    cur: *mut Rec,
    limit: *mut Rec,
    /// Token of the last record, or `u32::MAX` when there is none.
    last: u32,
}

impl Out {
    fn load(inst: &mut Instance) -> Self {
        let v = &mut inst.ext.recs;
        let base = v.as_mut_ptr();
        Out {
            base,
            // SAFETY: `len` records are written, within the allocation.
            cur: unsafe { base.add(v.len()) },
            // SAFETY: one past the allocation.
            limit: unsafe { base.add(v.capacity()) },
            last: v.last().map_or(u32::MAX, |r| r.token),
        }
    }

    fn store(self, inst: &mut Instance) {
        // SAFETY: the records before `cur` are written, within the
        // capacity.
        unsafe {
            inst.ext
                .recs
                .set_len(self.cur.offset_from(self.base) as usize)
        };
    }

    /// Append a non-empty token ending at `end` (`$emitTok`).
    #[inline(always)]
    fn tok(&mut self, hl: u32, end: usize) {
        // SAFETY: `cur` stays within `base..limit`; a merge rewrites the
        // last record, which exists when `last` matches.
        unsafe {
            self.cur = self.cur.sub((self.last == hl) as usize);
            if self.cur == self.limit {
                crate::rt::trap();
            }
            self.cur.write(Rec {
                end: end as u32,
                token: hl,
            });
            self.cur = self.cur.add(1);
        }
        self.last = hl;
    }

    /// Whitespace `[lhs, rhs)` (`$emitGap`).
    #[inline(always)]
    fn gap(&mut self, lhs: usize, rhs: usize) {
        if lhs < rhs {
            if self.cur == self.base {
                self.tok(tok::NONE, rhs);
            } else {
                self.extend(rhs);
            }
        }
    }

    /// Whitespace up to `rhs` after a record: it extends that record.
    #[inline(always)]
    fn extend(&mut self, rhs: usize) {
        debug_assert!(self.cur > self.base);
        // SAFETY: a record precedes `cur`.
        unsafe { (*self.cur.sub(1)).end = rhs as u32 };
    }
}

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run.
#[inline(always)]
fn whitespace_end(src: &[u8], mut p: usize) -> usize {
    loop {
        // Skip spaces 8 bytes at a time, then step over one other
        // whitespace byte (TAB to CR) and go on.
        // SAFETY: `p` lies at or before the NUL after the input, so the
        // 8-byte read stays inside the slack.
        let w = unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() };
        let x = w ^ 0x2020_2020_2020_2020;
        let other =
            (((x & 0x7f7f_7f7f_7f7f_7f7f) + 0x7f7f_7f7f_7f7f_7f7f) | x) & 0x8080_8080_8080_8080;
        if other == 0 {
            p += 8;
            continue;
        }
        p += (other.trailing_zeros() / 8) as usize;
        if !is_space(at(src, p)) {
            return p;
        }
        p += 1;
    }
}

/// The end of the identifier run from `p`: `[A-Za-z0-9_$]` and bytes from
/// 0x80 (`$lexScanIdent`, `$scanIdentRun`). The NUL after the input ends
/// every run.
#[inline(always)]
fn ident_end(src: &[u8], mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..8 {
        if !IDENT_CONT[at(src, p) as usize] {
            return p;
        }
        p += 1;
    }
    loop {
        // SAFETY: each 16-byte load starts at or before the NUL after the
        // input, inside the slack.
        let v = unsafe { V::load(src.as_ptr().add(p)) };
        let alpha = v.or(V::splat(0x20)).sub(V::splat(b'a')).le(V::splat(25));
        let digit = v.sub(V::splat(b'0')).le(V::splat(9));
        let extra = v.eq(V::splat(b'_')).or(v.eq(V::splat(b'$')));
        let ok = alpha.or(digit).or(extra.or(v.high()));
        let k = ok.not().first();
        if k < 16 {
            return p + k;
        }
        p += 16;
    }
}

/// Skip spaces and tabs from `p` on the current line (`$lexSkipSpaceAt`).
/// The NUL after the input ends every run.
#[inline(always)]
fn skip_space_at(src: &[u8], mut p: usize) -> usize {
    while at(src, p) == b' ' || at(src, p) == b'\t' {
        p += 1;
    }
    p
}

/// SCREAMING_CASE: at least two bytes, one uppercase letter, and only
/// `[A-Z0-9_]` (`$lexIsConstCase`).
fn is_const_case(src: &[u8], lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = false;
    for p in lhs..rhs {
        let c = at(src, p);
        if c.wrapping_sub(b'A') <= 25 {
            upper = true;
        } else if !(is_digit(c) || c == b'_') {
            return false;
        }
    }
    upper
}

/// The first `n` bytes at `p` as a little-endian integer. Reads 8 bytes,
/// which the input slack allows.
#[inline(always)]
fn word_at(src: &[u8], p: usize, n: u32) -> u64 {
    debug_assert!(p + 8 <= src.len());
    // SAFETY: `p` lies at or before the input end, so `p + 8` lies inside
    // the slack.
    let w = unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() };
    w & (u64::MAX >> (64 - 8 * n))
}

/// `s` as a little-endian integer.
const fn word(s: &[u8]) -> u64 {
    let mut w = 0u64;
    let mut i = 0;
    while i < s.len() {
        w |= (s[i] as u64) << (8 * i);
        i += 1;
    }
    w
}

/// The number at `p`: radix digits, separators, exponents, and suffixes,
/// with `.` only before a digit (`$lexScanNumber`, `$lexScanNumberBody`).
/// The NUL after the input ends every number.
#[inline(always)]
fn number_body(src: &[u8], mut p: usize, hex: bool) -> usize {
    let mut prev = 0u8;
    loop {
        let c = at(src, p);
        if IDENT_CONT[c as usize] {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            if !is_digit(at(src, p + 1)) {
                break;
            }
            prev = c;
            p += 1;
            continue;
        }
        if (c == b'+' || c == b'-') && ((!hex && prev | 32 == b'e') || prev | 32 == b'p') {
            prev = c;
            p += 1;
            continue;
        }
        break;
    }
    p
}

/// The end of the escape at backslash `p`: one character, kept whole when
/// it is UTF-8, and CRLF as one (`$lexEscapeEnd`).
fn escape_end(src: &[u8], p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(src, p + 2, end);
    if e == p + 2 && at(src, p + 1) == b'\r' && e < end && at(src, e) == b'\n' {
        e += 1;
    }
    e
}

/// The position just past the comment opened by the two bytes `open`
/// before `p`, with nested `open` ... `close` pairs balanced, or `end`
/// (`$lexNestedScan` from depth 1). A pair counts only when both its bytes
/// lie before `end`; the NUL at `end` matches no pair.
#[inline(always)]
fn nested_comment_end(
    src: &[u8],
    mut p: usize,
    end: usize,
    open: [u8; 2],
    close: [u8; 2],
) -> usize {
    let mut depth = 1u32;
    loop {
        // the earliest opener or closer at or after `p`
        loop {
            if p >= end {
                return end;
            }
            // SAFETY: each load starts before `end` and reads 17 bytes,
            // inside the input slack.
            let (a, b) = unsafe {
                (
                    V::load(src.as_ptr().add(p)),
                    V::load(src.as_ptr().add(p + 1)),
                )
            };
            let o = a.eq(V::splat(open[0])).and(b.eq(V::splat(open[1])));
            let c = a.eq(V::splat(close[0])).and(b.eq(V::splat(close[1])));
            let k = o.or(c).first();
            if k < 16 {
                p += k;
                break;
            }
            p += 16;
        }
        if p + 1 >= end {
            return end;
        }
        if at(src, p) == open[0] && at(src, p + 1) == open[1] {
            depth += 1;
            p += 2;
            continue;
        }
        depth -= 1;
        p += 2;
        if depth == 0 {
            return p;
        }
    }
}

/// The `$c3Words` value of the name `[lhs, rhs)`, or -1.
#[inline(always)]
fn word_value(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    let n = rhs.wrapping_sub(lhs);
    if n.wrapping_sub(1) >= WORD_MAX || WORD_LENGTHS[at(src, lhs) as usize] >> n & 1 == 0 {
        return -1;
    }
    let (lo, hi) = if n <= 8 {
        (word_at(src, lhs, n as u32), 0)
    } else {
        (word_at(src, lhs, 8), word_at(src, lhs + 8, n as u32 - 8))
    };
    let e = WORDS.index[word_slot(lo, hi, WORDS.mul)] as usize;
    let key = WORDS.keys[e.wrapping_sub(1) & 255];
    if e != 0 && (key.0 ^ lo) | (key.1 ^ hi) == 0 {
        WORDS.values[e - 1] as i32
    } else {
        -1
    }
}

/// The color of the compile-time word `[lhs, rhs)` after its `$`: a control
/// keyword, a keyword, or a compile-time variable (`$c3WordHl` with `$ct`
/// set).
#[inline(always)]
fn ct_word_hl(src: &[u8], lhs: usize, rhs: usize) -> u32 {
    let g = word_value(src, lhs, rhs);
    if g == tok::KEYWORD_CONTROL as i32 {
        return tok::KEYWORD_CONTROL;
    }
    if g >= 0 {
        return tok::KEYWORD;
    }
    // the two words the table cannot hold
    if rhs - lhs == 7 {
        let w = word_at(src, lhs, 7);
        if w == word(b"vaconst") || w == word(b"vasplat") {
            return tok::KEYWORD;
        }
    }
    tok::VARIABLE_SPECIAL
}

/// The word value of the name `[lhs, rhs)`: its token in the low byte and
/// its next-name capture above (1 = function head, 2 = type, 3 =
/// namespace), or -1 for an ordinary name, including the compile-time words
/// that need their `$` (`$c3WordHl` without `$ct`).
#[inline(always)]
fn word_hl(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    let g = word_value(src, lhs, rhs);
    if g & 1024 != 0 { -1 } else { g }
}

/// The literal from the quote `q` at `lhs`: its body as a string, with
/// escapes as `string.escape`; it ends at its closing quote, a raw line
/// break, or the input end. Returns the end (`$lexString`,
/// `$lexStringBody` on one line).
#[inline(always)]
fn string(src: &[u8], out: Out, lhs: usize, end: usize) -> (Out, usize) {
    let mut out = out;
    let q = at(src, lhs);
    let p = scan::string_special(src, lhs + 1, end, q);
    let c = at(src, p);
    if p < end && c == b'\\' {
        return string_escapes(src, out, p, end, q, lhs);
    }
    // closed, or ended by a raw line break or the input end
    let p = p + (p < end && c == q) as usize;
    out.tok(tok::STRING, p);
    (out, p)
}

/// The rest of a literal from the backslash at `p`, with quote `q`; the
/// pending string token starts at `seg` (the escape loop of
/// `$lexStringBody`).
#[inline(never)]
fn string_escapes(
    src: &[u8],
    mut out: Out,
    mut p: usize,
    end: usize,
    q: u8,
    mut seg: usize,
) -> (Out, usize) {
    loop {
        // `p` is at a backslash
        if seg < p {
            out.tok(tok::STRING, p);
        }
        let e = escape_end(src, p, end);
        out.tok(tok::STRING_ESCAPE, e);
        p = e;
        seg = e;
        if p < end {
            p = scan::string_special(src, p, end, q);
        }
        if p >= end {
            break;
        }
        let c = at(src, p);
        if c == q {
            p += 1;
            break;
        }
        // a raw line break: unterminated, left unconsumed
        if c != b'\\' {
            break;
        }
    }
    if seg < p {
        out.tok(tok::STRING, p);
    }
    (out, p)
}

/// The end of the operator at `p`, whose first byte is `c` (`$hlC3`'s
/// `$c3IsOp` rule).
#[inline(always)]
fn operator_end(src: &[u8], p: usize, c: u8) -> usize {
    let c2 = at(src, p + 1);
    let mut p = p + 1;
    if c2 == b'=' || (c == c2 && DOUBLES[c as usize]) {
        p += 1;
        if (c == b'<' || c == b'>') && at(src, p) == b'=' {
            p += 1;
        }
    }
    p
}

/// Lex the C3 input of `len` bytes at `base` (`$hlC3`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, which is not
    // reallocated while this lexer runs.
    let src: &[u8] = unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) };
    let end = len;
    let mut out = Out::load(inst);

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src, 0, end);
    out.gap(0, ptr);
    // the pending capture: 1 while a function head is open, 2 for a type
    // name, 3 for a module path
    let mut expect = 0u32;
    // 1 after `.`, 2 after `::`
    let mut member = 0u32;
    // Leading whitespace; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    out.gap(ptr, first);
    ptr = first;

    // The bracket `$c` at `ptr`.
    macro_rules! bracket {
        ($c:expr) => {{
            let c: u8 = $c;
            ptr += 1;
            out.tok(tok::PUNCTUATION_BRACKET, ptr);
            member = 0;
            // a function head survives its generic braces:
            // `fn List{int}.push(`
            if expect != 1 || c == b'(' || c == b')' {
                expect = 0;
            }
        }};
    }
    // The `,` or `;` at `ptr`.
    macro_rules! delimiter {
        () => {{
            ptr += 1;
            out.tok(tok::PUNCTUATION_DELIMITER, ptr);
            member = 0;
            expect = 0;
        }};
    }

    loop {
        let mut c = at(src, ptr);
        let mut class = CLASS[c as usize];
        if class == class::SPACE {
            // whitespace gaps
            let next = at(src, ptr + 1);
            let next_class = CLASS[next as usize];
            if c == b' ' && next_class != class::SPACE {
                // one space
                ptr += 1;
                c = next;
                class = next_class;
            } else {
                ptr = whitespace_end(src, ptr + 1);
                c = at(src, ptr);
                class = CLASS[c as usize];
            }
            out.extend(ptr);
        }
        let lhs = ptr;
        match class {
            class::IDENT => {
                ptr = ident_end(src, ptr + 1);
                let rhs = ptr;
                // `x"..."` and `b64"..."` are byte strings
                if at(src, rhs) == b'"'
                    && ((rhs - lhs == 1 && c == b'x')
                        || (rhs - lhs == 3 && word_at(src, lhs, 3) == word(b"b64")))
                {
                    out.tok(tok::STRING, rhs);
                    (out, ptr) = string(src, out, rhs, end);
                    member = 0;
                    continue;
                }
                // the byte after the name's blanks
                let p = skip_space_at(src, rhs);
                let c2 = at(src, p);
                // `$if`, `$sizeof`, and `$Type` are compile-time words
                if c == b'$' {
                    out.tok(ct_word_hl(src, lhs + 1, rhs), rhs);
                    member = 0;
                    continue;
                }
                let kind = if member == 1 {
                    -1
                } else {
                    word_hl(src, lhs, rhs)
                };
                let hl;
                if kind >= 0 {
                    hl = kind as u32 & 255;
                    // a keyword either arms a capture or ends it; a function
                    // head keeps its return type keyword
                    if expect != 1 || hl != tok::TYPE_BUILTIN {
                        expect = kind as u32 >> 8;
                    }
                } else if expect == 1 {
                    // the name before `(` is the definition; anything earlier
                    // is its return type, receiver, or module
                    if c2 == b'(' {
                        hl = tok::FUNCTION_DEFINITION;
                        expect = 0;
                    } else {
                        hl = if c2 == b':' {
                            tok::NAMESPACE
                        } else {
                            tok::TYPE
                        };
                    }
                } else if expect != 0 {
                    hl = if expect == 2 {
                        tok::TYPE
                    } else {
                        tok::NAMESPACE
                    };
                    // a `::` path keeps its capture
                    if expect == 2 || c2 != b':' {
                        expect = 0;
                    }
                } else if c2 == b'(' {
                    // `Foo(` and `Foo{` build a struct
                    hl = if c.wrapping_sub(b'A') <= 25 {
                        tok::TYPE
                    } else if member == 1 {
                        tok::FUNCTION_METHOD
                    } else {
                        tok::FUNCTION
                    };
                } else if member == 1 {
                    hl = tok::PROPERTY;
                } else if (c.wrapping_sub(b'A') <= 25 || c == b'_') && is_const_case(src, lhs, rhs)
                {
                    // (only `[A-Z_]` can start a constant name)
                    hl = tok::CONSTANT;
                } else if c.wrapping_sub(b'A') <= 25 {
                    hl = tok::TYPE;
                } else if c2 == b':' && at(src, p + 1) == b':' {
                    // `io::` names a module
                    hl = tok::NAMESPACE;
                } else {
                    hl = tok::VARIABLE;
                }
                out.tok(hl, rhs);
                member = 0;
                // a bracket or delimiter right after a name: its rule runs
                // here, without the gap and dispatch steps
                let next = at(src, rhs);
                let next_class = CLASS[next as usize];
                if next_class == class::BRACKET {
                    bracket!(next);
                } else if next_class == class::DELIM {
                    delimiter!();
                } else if next_class == class::COLON && at(src, ptr + 1) == b':' {
                    // a `::` path
                    ptr += 2;
                    out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                    member = 2;
                }
            }
            class::SLASH if at(src, ptr + 1) == b'/' => {
                let c3 = at(src, ptr + 2);
                ptr = scan::line_end(src, ptr + 2, end);
                out.tok(
                    if c3 == b'/' {
                        tok::COMMENT_DOC
                    } else {
                        tok::COMMENT
                    },
                    ptr,
                );
            }
            class::SLASH if at(src, ptr + 1) == b'*' => {
                // C3 block comments nest
                ptr = nested_comment_end(src, ptr + 2, end, *b"/*", *b"*/");
                out.tok(tok::COMMENT, ptr);
            }
            class::OP if c == b'<' && at(src, ptr + 1) == b'*' => {
                // `<* ... *>` documents and constrains the declaration that
                // follows
                ptr = nested_comment_end(src, ptr + 2, end, *b"<*", *b"*>");
                out.tok(tok::COMMENT_DOC, ptr);
            }
            class::QUOTE => {
                (out, ptr) = string(src, out, lhs, end);
                member = 0;
            }
            class::BACKTICK => {
                // raw strings span lines and have no escapes
                let p = scan::find3(src, ptr + 1, end, b'`', b'`', b'`');
                ptr = p + (p < end) as usize;
                out.tok(tok::STRING, ptr);
                member = 0;
            }
            class::AT if is_ident_start(at(src, ptr + 1)) => {
                // `@attribute` and `@macro_call(...)`
                ptr = ident_end(src, ptr + 1);
                out.tok(tok::ATTRIBUTE, ptr);
                member = 0;
            }
            class::DIGIT => {
                let hex = c == b'0' && at(src, ptr + 1) | 0x20 == b'x';
                ptr = number_body(src, ptr, hex);
                out.tok(tok::NUMBER, ptr);
                member = 0;
            }
            class::DOT if is_digit(at(src, ptr + 1)) => {
                ptr = number_body(src, ptr, false);
                out.tok(tok::NUMBER, ptr);
                member = 0;
            }
            class::BRACKET => bracket!(c),
            class::DELIM => delimiter!(),
            class::COLON => {
                let scope = at(src, ptr + 1) == b':';
                ptr += if scope { 2 } else { 1 };
                out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                member = if scope { 2 } else { 0 };
            }
            class::DOT => {
                // `.`, or the `..` and `...` operators
                let c2 = at(src, ptr + 1);
                ptr += 1;
                if c2 == b'.' {
                    ptr += 1;
                    if at(src, ptr) == b'.' {
                        ptr += 1;
                    }
                    out.tok(tok::OPERATOR, ptr);
                    member = 0;
                } else {
                    out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                    member = 1;
                }
            }
            class::OP | class::SLASH => {
                ptr = operator_end(src, ptr, c);
                out.tok(tok::OPERATOR, ptr);
                member = 0;
            }
            class::NUL if ptr >= end => break,
            _ => {
                ptr += 1;
                out.tok(tok::NONE, ptr);
                member = 0;
            }
        }
    }
    out.store(inst);
}
