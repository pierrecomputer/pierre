//! WAT sources: src/langs/objc.wat src/langs/c.wat src/common.wat src/scan.wat
//!
//! Native Objective-C lexer. One pass over the input: each token is
//! scanned and colored in the same step, with the same rules, in the same
//! order, as the translated `$hlObjc`. The records equal the translated
//! lexer's records.
//!
//! The WAT tests its rules in one chain. Most rules match one first byte,
//! so this lexer dispatches on a byte class and, for each class, tests only
//! the rules that can match it, in the WAT's order. Names look up one table
//! holding both the Objective-C words (`$objcWords`) and the C words
//! (`$cWords`) that `$cWordHl` falls back to.

use super::Lexer;
use super::scan;
use super::tables::byteset;
use crate::Rec;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::{C_WORDS, OBJC_WORDS};

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "objc" => Some(highlight),
        _ => None,
    }
}

/// The words of `$objcWords` and `$cWords`, with `continue`, which
/// `$cWordHl` matches outside its table with the same result as a table
/// entry: a perfect hash on a word's bytes. A word of up to 24 bytes is
/// three little-endian integers (bytes 0-7, 8-15, 16-23), zero past its
/// end; identifiers hold no NUL, so equal integers mean equal words.
struct Words {
    /// Entry number plus one for each hash slot, or 0 for no word.
    index: [u8; WORD_SLOTS],
    /// Each entry's integers; 256 entries, so an index byte needs no
    /// bounds check.
    keys: [[u64; 3]; 256],
    /// The word's `$objcWords` value (token, group above it), or -1.
    objc: [i32; 256],
    /// The word's `$cWords` value, or -1.
    c: [i32; 256],
    mul: u64,
}

const WORD_SLOTS: usize = 8192;

/// At most this many distinct words.
const WORD_COUNT: usize = OBJC_WORDS.len() + C_WORDS.len() + 1;

/// The longest word.
const WORD_MAX: usize = 24;

/// The slot of the word with integers `k`.
#[inline(always)]
const fn word_slot(k: [u64; 3], mul: u64) -> usize {
    let h = k[0] ^ k[1].rotate_left(29) ^ k[2].rotate_left(13);
    (h.wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros())) as usize
}

/// The integers of the word `w`.
const fn word_key(w: &[u8]) -> [u64; 3] {
    let mut k = [0u64; 3];
    let mut i = 0;
    while i < w.len() {
        k[i / 8] |= (w[i] as u64) << (8 * (i % 8));
        i += 1;
    }
    k
}

/// Whether two keys are equal, in a `const` context.
const fn same_key(a: [u64; 3], b: [u64; 3]) -> bool {
    a[0] == b[0] && a[1] == b[1] && a[2] == b[2]
}

/// For each first byte, a bit per length of the words in [`WORDS`]. A name
/// whose bit is clear is no word.
static WORD_LENGTHS: [u32; 256] = {
    let mut t = [0u32; 256];
    let mut i = 0;
    while i < OBJC_WORDS.len() {
        let w = OBJC_WORDS[i].word;
        t[w[0] as usize] |= 1 << w.len();
        i += 1;
    }
    let mut i = 0;
    while i < C_WORDS.len() {
        let w = C_WORDS[i].word;
        t[w[0] as usize] |= 1 << w.len();
        i += 1;
    }
    t[b'c' as usize] |= 1 << b"continue".len();
    t
};

/// The words, placed by searching for a multiplier that gives each its own
/// slot.
static WORDS: Words = {
    assert!(WORD_COUNT < 256);
    let mut keys = [[0u64; 3]; 256];
    let mut objc = [-1i32; 256];
    let mut c = [-1i32; 256];
    let mut n = 0;
    let mut i = 0;
    while i < OBJC_WORDS.len() {
        assert!(OBJC_WORDS[i].word.len() <= WORD_MAX);
        keys[n] = word_key(OBJC_WORDS[i].word);
        objc[n] = OBJC_WORDS[i].value;
        n += 1;
        i += 1;
    }
    // The C words, then `continue`, joining an Objective-C entry for the
    // same word.
    let mut i = 0;
    while i <= C_WORDS.len() {
        let (w, value) = if i < C_WORDS.len() {
            (C_WORDS[i].word, C_WORDS[i].value)
        } else {
            (b"continue".as_slice(), tok::KEYWORD_CONTROL as i32)
        };
        assert!(w.len() <= WORD_MAX && value >= 0);
        let k = word_key(w);
        let mut e = 0;
        while e < n && !same_key(keys[e], k) {
            e += 1;
        }
        if e == n {
            keys[n] = k;
            n += 1;
        }
        c[e] = value;
        i += 1;
    }
    let mut mul: u64 = 0x2545_f491_4f6c_dd1d;
    let mut attempt = 0;
    'search: loop {
        assert!(attempt < 20_000, "no collision-free hash: use more slots");
        let mut index = [0u8; WORD_SLOTS];
        let mut e = 0;
        while e < n {
            let s = word_slot(keys[e], mul);
            if index[s] != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            index[s] = e as u8 + 1;
            e += 1;
        }
        break Words {
            index,
            keys,
            objc,
            c,
            mul,
        };
    }
};

/// Operator bytes (`$cIsOp`).
const OPS: [bool; 256] = byteset(b"!#%&*+-/<=>?^|~");

/// Bytes that double into a compound operator (`&&`, `++`, ...).
static DOUBLES: [bool; 256] = byteset(b"&+-<>|");

/// Byte classes for the main dispatch.
mod class {
    /// An identifier start (`$lexIsIdentStart`).
    pub const IDENT: u8 = 0;
    /// Anything else: one plain byte.
    pub const OTHER: u8 = 1;
    pub const DIGIT: u8 = 2;
    /// `"` or `'`.
    pub const QUOTE: u8 = 3;
    pub const AT: u8 = 4;
    pub const SLASH: u8 = 5;
    pub const HASH: u8 = 6;
    pub const DOT: u8 = 7;
    /// `(`, `)`, `[`, `]`, `{`, or `}`.
    pub const BRACKET: u8 = 8;
    /// `,`, `;`, or `:`.
    pub const DELIM: u8 = 9;
    /// `-` or `+`: an operator, `->`, or the start of a method declaration.
    pub const SIGN: u8 = 10;
    /// Another operator byte (`$cIsOp`).
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
                b'@' => class::AT,
                b'/' => class::SLASH,
                b'#' => class::HASH,
                b'.' => class::DOT,
                b'(' | b')' | b'[' | b']' | b'{' | b'}' => class::BRACKET,
                b',' | b';' | b':' => class::DELIM,
                b'-' | b'+' => class::SIGN,
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

/// Whether `c` is an ASCII hex digit (`$lexIsHex`).
#[inline(always)]
const fn is_hex(c: u8) -> bool {
    is_digit(c) || (c | 32).wrapping_sub(b'a') <= 5
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

/// The position just past the next `*/` from `p`, or `end`
/// (`$scanBlockCommentEnd`): each step tests 16 star positions against the
/// bytes after them.
#[inline(always)]
fn block_comment_end(src: &[u8], mut p: usize, end: usize) -> usize {
    while p < end {
        // SAFETY: each load starts before `end` and reads 17 bytes, inside
        // the input slack.
        let (a, b) = unsafe {
            (
                V::load(src.as_ptr().add(p)),
                V::load(src.as_ptr().add(p + 1)),
            )
        };
        let k = a.eq(V::splat(b'*')).and(b.eq(V::splat(b'/'))).first();
        if k < 16 {
            return (p + k + 2).min(end);
        }
        p += 16;
    }
    end
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

/// The end of the number at `lhs`, with hexadecimal floats whose fraction
/// may start with an a-f digit or be empty (`$lexScanHexNumber` with no
/// required exponent).
#[inline(always)]
fn hex_number_end(src: &[u8], lhs: usize) -> usize {
    let hex = at(src, lhs) == b'0' && at(src, lhs + 1) | 0x20 == b'x';
    let p = number_body(src, lhs, hex);
    if hex && at(src, p) == b'.' {
        hex_fraction(src, p)
    } else {
        p
    }
}

/// The rest of a hexadecimal number from its `.` at `p`: the fraction and
/// exponent when they form a hexadecimal float, or `p` (the tail of
/// `$lexScanHexNumber`).
#[cold]
#[inline(never)]
fn hex_fraction(src: &[u8], p: usize) -> usize {
    let next = at(src, p + 1);
    if !(is_hex(next) || next | 32 == b'p') {
        return p;
    }
    if next | 32 == b'p' {
        let mut q = p + 1;
        while is_hex(at(src, q)) || at(src, q) == b'_' {
            q += 1;
        }
        if at(src, q) | 32 != b'p' {
            return p;
        }
        q += 1;
        if at(src, q) == b'+' || at(src, q) == b'-' {
            q += 1;
        }
        if !is_digit(at(src, q)) {
            return p;
        }
    }
    number_body(src, p + 1, true)
}

/// The end of at most `max` hex digits from `p` (`$scanHexRun`).
fn hex_run(src: &[u8], mut p: usize, max: usize, end: usize) -> usize {
    let stop = (p + max).min(end);
    while p < stop && is_hex(at(src, p)) {
        p += 1;
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

/// The end of the C escape at backslash `p` (`$lexCEscapeEnd`).
fn c_escape_end(src: &[u8], p: usize, end: usize) -> usize {
    let c = if p + 1 < end { at(src, p + 1) } else { 0 };
    let mut e = p + 2;
    if c == b'u' {
        e = hex_run(src, e, 4, end);
    } else if c == b'U' {
        e = hex_run(src, e, 8, end);
    } else if c == b'x' {
        e = hex_run(src, e, 64, end);
    } else if c == b'N' && e < end && at(src, e) == b'{' {
        e += 1;
        while e < end {
            let c = at(src, e);
            if c == b'\n' || c == b'\r' || c == b'"' || c == b'\'' || c == b'\\' {
                break;
            }
            e += 1;
            if c == b'}' {
                break;
            }
        }
    } else if c.wrapping_sub(b'0') <= 7 {
        // the first digit is already in; take up to two more
        while e < end && e - p < 4 && at(src, e).wrapping_sub(b'0') <= 7 {
            e += 1;
        }
    } else {
        e = escape_end(src, p, end);
    }
    scan::utf8_span_end(src, e, end)
}

/// The rest of a C literal from the backslash at `p`, with quote `q`; the
/// pending string token starts at `seg`. Emits the body as a string, with
/// escapes as `string.escape`, and returns its end (the escape loop of
/// `$lexCStringBody`, without a suffix).
#[inline(never)]
fn c_string_escapes(
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
        let e = c_escape_end(src, p, end);
        out.tok(tok::STRING_ESCAPE, e);
        p = e;
        seg = e;
        // an escaped line break that ends the input leaves the literal open
        if p == end && (at(src, p - 1) == b'\n' || at(src, p - 1) == b'\r') {
            break;
        }
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

/// The C literal from the opening quote at `lhs`, without a suffix: its
/// body as a string, with escapes as `string.escape`. Returns its end
/// (`$lexCString`, `$lexCStringBody`).
#[inline(always)]
fn c_string(src: &[u8], out: Out, lhs: usize, end: usize) -> (Out, usize) {
    let mut out = out;
    let q = at(src, lhs);
    let p = scan::string_special(src, lhs + 1, end, q);
    let c = at(src, p);
    if p < end && c == b'\\' {
        return c_string_escapes(src, out, p, end, q, lhs);
    }
    // closed, or ended by a raw line break or the input end
    let p = p + (p < end && c == q) as usize;
    out.tok(tok::STRING, p);
    (out, p)
}

/// Split a `#include` or `#import` directive `[lhs, rhs)` into the
/// directive, its quoted or angle-bracket header as a string, and the rest.
/// Returns false, emitting nothing, when the directive is another one or
/// names its header with a macro (`$lexEmitIncludeDirective`).
#[inline(always)]
fn include_directive(src: &[u8], out: &mut Out, lhs: usize, rhs: usize) -> bool {
    let mut p = lhs + 1;
    while p < rhs && (at(src, p) == b' ' || at(src, p) == b'\t') {
        p += 1;
    }
    let w = p;
    if w + 6 > rhs {
        return false;
    }
    if word_at(src, w, 7) == word(b"include") {
        p = w + 7;
    } else if word_at(src, w, 6) == word(b"import") {
        p = w + 6;
    } else {
        return false;
    }
    if p > rhs {
        return false;
    }
    if p < rhs && is_ident_continue(at(src, p)) {
        return false;
    }
    while p < rhs && (at(src, p) == b' ' || at(src, p) == b'\t') {
        p += 1;
    }
    if p >= rhs {
        return false;
    }
    let close = match at(src, p) {
        b'<' => b'>',
        b'"' => b'"',
        _ => return false,
    };
    let header = p;
    p += 1;
    while p < rhs {
        if at(src, p) == close {
            p += 1;
            break;
        }
        p += 1;
    }
    out.tok(tok::PREPROC, header);
    out.tok(tok::STRING, p);
    if p < rhs {
        out.tok(tok::PREPROC, rhs);
    }
    true
}

/// The end of the whitespace run from `p`, and whether it holds a CR or LF
/// (`$scanWhitespace`, and the line-break search of `$hlCppImpl`'s gap).
/// The NUL after the input ends every run.
#[inline(always)]
fn whitespace_end(src: &[u8], mut p: usize) -> (usize, bool) {
    let mut line = false;
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
        let c = at(src, p);
        if !is_space(c) {
            return (p, line);
        }
        line |= c == b'\n' || c == b'\r';
        p += 1;
    }
}

/// The entry of the name `[lhs, rhs)` in [`WORDS`], if it is a word of
/// either table.
#[inline(always)]
fn lookup(src: &[u8], lhs: usize, rhs: usize) -> Option<usize> {
    let n = rhs - lhs;
    if n > WORD_MAX || WORD_LENGTHS[at(src, lhs) as usize] >> n & 1 == 0 {
        return None;
    }
    let k = [
        word_at(src, lhs, n.min(8) as u32),
        if n > 8 {
            word_at(src, lhs + 8, (n - 8).min(8) as u32)
        } else {
            0
        },
        if n > 16 {
            word_at(src, lhs + 16, (n - 16) as u32)
        } else {
            0
        },
    ];
    let e = WORDS.index[word_slot(k, WORDS.mul)] as usize;
    let key = &WORDS.keys[e.wrapping_sub(1) & 255];
    if e != 0 && (key[0] ^ k[0]) | (key[1] ^ k[1]) | (key[2] ^ k[2]) == 0 {
        Some(e - 1)
    } else {
        None
    }
}

/// The Objective-C value of the word `[lhs, rhs)` with entry `entry`
/// ([`lookup`]): the token in the low byte, 256 for a directive that names
/// a type next, 512 for `@property`; or -1 to leave the word to
/// [`c_word_hl`]. `at` says the word follows `@`, `prop_attrs` that it sits
/// in a property attribute list (`$objcWordHl`).
#[inline(always)]
fn objc_word_hl(
    src: &[u8],
    entry: Option<usize>,
    lhs: usize,
    rhs: usize,
    at_sign: bool,
    prop_attrs: bool,
) -> i32 {
    let n = entry.map_or(-1, |e| WORDS.objc[e & 255]);
    // the group, or a large number for a miss
    let g = n as u32 >> 8;
    if at_sign {
        let len = rhs - lhs;
        // @interface, @implementation, @protocol, and @class name a type
        if g == 1 {
            if (len == 9 && word_at(src, lhs, 8) == word(b"interfac"))
                || (len == 14 && word_at(src, lhs, 8) == word(b"implemen"))
                || (len == 8 && word_at(src, lhs, 8) == word(b"protocol"))
                || (len == 5 && word_at(src, lhs, 4) == word(b"clas"))
            {
                return tok::KEYWORD as i32 | 256;
            }
            if len == 8 && word_at(src, lhs, 8) == word(b"property") {
                return tok::KEYWORD as i32 | 512;
            }
        }
        // any other `@word` is a directive too
        return tok::KEYWORD as i32;
    }
    // directive words need their `@`; property attributes their list
    if g == 1 || g > 6 || (g == 6 && !prop_attrs) {
        return -1;
    }
    n & 255
}

/// The C color of the name `[lhs, rhs)` with entry `entry` ([`lookup`])
/// (`$cWordHl`).
#[inline(always)]
fn c_word_hl(src: &[u8], entry: Option<usize>, lhs: usize, rhs: usize) -> u32 {
    // `continue` and the table
    if let Some(e) = entry
        && WORDS.c[e & 255] >= 0
    {
        return WORDS.c[e & 255] as u32;
    }
    let c = at(src, lhs);
    // (only `[A-Z_]` can start a constant name)
    if (c.wrapping_sub(b'A') <= 25 || c == b'_') && is_const_case(src, lhs, rhs) {
        return tok::CONSTANT;
    }
    if rhs - lhs >= 3 && at(src, rhs - 2) == b'_' && at(src, rhs - 1) == b't' {
        return tok::TYPE;
    }
    if at(src, skip_space_at(src, rhs)) == b'(' {
        return tok::FUNCTION;
    }
    if c.wrapping_sub(b'A') <= 25 {
        return tok::TYPE;
    }
    tok::VARIABLE
}

/// The end of the operator at `p`, whose first byte is `c` (`$hlObjc`'s
/// `$cIsOp` rule).
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

/// Lex the Objective-C input of `len` bytes at `base` (`$hlObjc`).
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
    // a token already sits on the current line: `#` is no directive
    let mut mid_line = false;
    // after a directive that names a class or protocol
    let mut expect_type = false;
    // inside the parens after `@property`
    let mut prop_attrs = false;
    // from a line-opening `-` or `+` to the `{` or `;` of its method, with
    // the paren depth inside it and whether a selector part appeared
    let mut decl_head = false;
    let mut parens = 0u32;
    let mut decl_colon = false;
    // open `[` of message sends
    let mut brackets = 0u32;
    // after `.` or `->`
    let mut member = false;

    // Leading whitespace: the gap rule's line-break reset, then its record.
    let (first, line) = whitespace_end(src, ptr);
    if line {
        mid_line = false;
        decl_head = false;
    }
    let mut gap = ptr;
    let mut nl = line;
    out.gap(ptr, first);
    ptr = first;

    // The bracket `$c` at `ptr`: its token, and the paren and bracket
    // depths and declaration state it changes.
    macro_rules! bracket {
        ($c:expr) => {{
            let c: u8 = $c;
            ptr += 1;
            out.tok(tok::PUNCTUATION_BRACKET, ptr);
            // The updates of `$hlObjc`'s bracket rule, without branches:
            // `(` and `)` move the paren depth, `[` and `]` the bracket
            // depth (neither below 0), a `)` back at depth 0 ends a property
            // attribute list, and `{` or `}` ends a declaration.
            let close_paren = c == b')';
            let brace = c == b'{' || c == b'}';
            parens = parens.wrapping_add((c == b'(') as u32);
            parens -= (close_paren && parens != 0) as u32;
            prop_attrs &= !(close_paren && parens == 0);
            brackets = brackets.wrapping_add((c == b'[') as u32);
            brackets -= (c == b']' && brackets != 0) as u32;
            if brace {
                parens = 0;
            }
            decl_head &= !brace;
            expect_type &= !brace;
        }};
    }
    // The `,`, `;`, or `:` `$c` at `ptr`; `;` ends a declaration.
    macro_rules! delimiter {
        ($c:expr) => {{
            ptr += 1;
            out.tok(tok::PUNCTUATION_DELIMITER, ptr);
            if $c == b';' {
                decl_head = false;
                expect_type = false;
            }
        }};
    }

    loop {
        let mut c = at(src, ptr);
        let mut class = CLASS[c as usize];
        if class == class::SPACE {
            // whitespace gaps; a line break resets the line state
            gap = ptr;
            let next = at(src, ptr + 1);
            let next_class = CLASS[next as usize];
            if c == b' ' && next_class != class::SPACE {
                // one space
                ptr += 1;
                c = next;
                class = next_class;
                nl = false;
            } else {
                let (e, line) = whitespace_end(src, ptr + 1);
                nl = line || c == b'\n' || c == b'\r';
                if nl {
                    mid_line = false;
                    decl_head = false;
                }
                ptr = e;
                c = at(src, ptr);
                class = CLASS[c as usize];
            }
            out.extend(ptr);
        }
        let lhs = ptr;
        // the byte before this token on the same line, or 0 at a line start
        let prev = || {
            if nl || gap == 0 { 0 } else { at(src, gap - 1) }
        };
        match class {
            class::IDENT => {
                mid_line = true;
                ptr = ident_end(src, ptr + 1);
                let rhs = ptr;
                // the byte after the name, and after its blanks
                let c2 = at(src, rhs);
                let c3 = || at(src, skip_space_at(src, rhs));
                // C literal prefixes `L`, `u`, `U` before a quote
                if rhs < end
                    && rhs - lhs == 1
                    && (c == b'L' || c == b'u' || c == b'U')
                    && (c2 == b'"' || c2 == b'\'')
                {
                    out.tok(tok::STRING, rhs);
                    (out, ptr) = c_string(src, out, rhs, end);
                    member = false;
                    gap = ptr;
                    nl = false;
                    continue;
                }
                let entry = if member { None } else { lookup(src, lhs, rhs) };
                let kind = if member {
                    -1
                } else {
                    objc_word_hl(src, entry, lhs, rhs, false, prop_attrs)
                };
                let hl;
                if kind >= 0 {
                    hl = kind as u32;
                } else if !(expect_type || decl_head || member || brackets != 0) && c2 != b':' {
                    // none of the context rules below can apply
                    hl = c_word_hl(src, entry, lhs, rhs);
                } else if expect_type {
                    hl = tok::TYPE;
                    expect_type = false;
                } else if c2 == b':' && at(src, rhs + 1) != b':' {
                    // a selector part is glued to its colon
                    hl = if decl_head && parens == 0 {
                        tok::FUNCTION_DEFINITION
                    } else {
                        tok::FUNCTION_METHOD
                    };
                    if decl_head {
                        decl_colon = true;
                    }
                } else if decl_head && parens == 0 && !decl_colon && matches!(c3(), b';' | b'{') {
                    // a unary method has no colon: its name ends the head
                    hl = tok::FUNCTION_DEFINITION;
                } else if brackets != 0 && gap < lhs && c3() == b']' && {
                    let prev = prev();
                    is_ident_continue(prev) || prev == b']' || prev == b')'
                } {
                    // the last part of a unary send follows the receiver or
                    // a nested send
                    hl = tok::FUNCTION_METHOD;
                } else if member {
                    hl = if c3() == b'(' {
                        tok::FUNCTION_METHOD
                    } else {
                        tok::PROPERTY
                    };
                } else {
                    hl = c_word_hl(src, entry, lhs, rhs);
                }
                out.tok(hl, rhs);
                member = false;
                // a bracket or delimiter right after a name: its rule runs
                // here, without the gap and dispatch steps
                let next_class = CLASS[c2 as usize];
                if next_class == class::BRACKET {
                    bracket!(c2);
                } else if next_class == class::DELIM {
                    delimiter!(c2);
                }
            }
            class::QUOTE => {
                mid_line = true;
                (out, ptr) = c_string(src, out, lhs, end);
                member = false;
            }
            class::AT => {
                // `@"literal"`, `@(box)`, `@[array]`, `@{dict}`, `@42`, and
                // `@word`
                mid_line = true;
                let c2 = at(src, ptr + 1);
                if c2 == b'"' {
                    ptr += 1;
                    out.tok(tok::STRING, ptr);
                    (out, ptr) = c_string(src, out, ptr, end);
                } else if is_ident_start(c2) {
                    ptr = ident_end(src, ptr + 1);
                    let entry = lookup(src, lhs + 1, ptr);
                    let kind = objc_word_hl(src, entry, lhs + 1, ptr, true, false);
                    out.tok(kind as u32 & 255, ptr);
                    expect_type = kind >> 8 & 1 != 0;
                    // `@property (attrs)`: the attribute list follows
                    prop_attrs = kind >> 9 & 1 != 0;
                } else {
                    ptr += 1;
                    out.tok(tok::PUNCTUATION_SPECIAL, ptr);
                }
                member = false;
            }
            class::SLASH if at(src, ptr + 1) == b'/' => {
                let c3 = at(src, ptr + 2);
                ptr = scan::line_end(src, ptr + 2, end);
                let hl = if c3 == b'/' || c3 == b'!' {
                    tok::COMMENT_DOC
                } else {
                    tok::COMMENT
                };
                out.tok(hl, ptr);
            }
            class::SLASH if at(src, ptr + 1) == b'*' => {
                let c3 = at(src, ptr + 2);
                let doc = c3 == b'!' || (c3 == b'*' && at(src, ptr + 3) != b'/');
                ptr = block_comment_end(src, ptr + 2, end);
                out.tok(if doc { tok::COMMENT_DOC } else { tok::COMMENT }, ptr);
            }
            class::HASH if !mid_line => {
                // a directive owns its line; `#import` splits off its header
                ptr = scan::line_end(src, ptr + 1, end);
                if !include_directive(src, &mut out, lhs, ptr) {
                    out.tok(tok::PREPROC, ptr);
                }
                mid_line = true;
            }
            class::DIGIT => {
                mid_line = true;
                ptr = hex_number_end(src, ptr);
                out.tok(tok::NUMBER, ptr);
                member = false;
            }
            class::DOT if is_digit(at(src, ptr + 1)) => {
                mid_line = true;
                ptr = hex_number_end(src, ptr);
                out.tok(tok::NUMBER, ptr);
                member = false;
            }
            class::BRACKET => {
                // brackets, and any more brackets or delimiters right after
                mid_line = true;
                bracket!(c);
                loop {
                    let c = at(src, ptr);
                    let class = CLASS[c as usize];
                    if class == class::BRACKET {
                        bracket!(c);
                    } else if class == class::DELIM {
                        delimiter!(c);
                    } else {
                        break;
                    }
                }
                member = false;
            }
            class::DELIM => {
                mid_line = true;
                delimiter!(c);
                member = false;
            }
            class::DOT => {
                mid_line = true;
                ptr += 1;
                out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                member = true;
            }
            class::SIGN if c == b'-' && at(src, ptr + 1) == b'>' => {
                mid_line = true;
                ptr += 2;
                out.tok(tok::OPERATOR, ptr);
                member = true;
            }
            class::SIGN if prev() == 0 && at(src, skip_space_at(src, ptr + 1)) == b'(' => {
                // a `-` or `+` opening a line before `(` declares a method
                mid_line = true;
                ptr += 1;
                out.tok(tok::OPERATOR, ptr);
                decl_head = true;
                decl_colon = false;
                parens = 0;
                member = false;
            }
            class::SIGN | class::OP | class::SLASH | class::HASH => {
                mid_line = true;
                ptr = operator_end(src, ptr, c);
                out.tok(tok::OPERATOR, ptr);
                member = false;
            }
            class::NUL if ptr >= end => break,
            _ => {
                mid_line = true;
                ptr += 1;
                out.tok(tok::NONE, ptr);
                member = false;
            }
        }
        // The next token's gap starts here, with no line break yet.
        gap = ptr;
        nl = false;
    }
    out.store(inst);
}
