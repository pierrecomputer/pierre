//! WAT sources: src/langs/c.wat src/common.wat src/scan.wat
//!
//! Native C lexer. One pass over the input: each token is scanned and
//! colored in the same step, with the same rules, in the same order, as the
//! translated `$hlC`. The records equal the translated lexer's records.
//!
//! The WAT tests its rules in one chain. Most rules match one first byte,
//! so this lexer dispatches on a byte class and, for each class, tests only
//! the rules that can match it, in the WAT's order.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::C_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "c" => Some(highlight),
        _ => None,
    }
}

/// `$cWords` and `continue`, which `$cWordHl` matches outside the table
/// with the same result as a table entry: a perfect hash on a word's
/// bytes. A word of up to 16 bytes is two little-endian integers, `lo`
/// (bytes 0-7) and `hi` (bytes 8-15), zero past its end; identifiers hold
/// no NUL, so equal integers mean equal words.
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    /// The word's `keyword-table.value`.
    values: [u8; WORD_SLOTS],
    mul: u64,
}

const WORD_SLOTS: usize = 256;

/// The longest word.
const WORD_MAX: usize = 16;

/// The slot of the word whose first 8 bytes are `lo`. No two words share
/// a slot, so a name is a word only when its integers equal the slot's.
#[inline(always)]
const fn word_slot(lo: u64, mul: u64) -> usize {
    (lo.wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros())) as usize
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
    let mut mul: u64 = 0x2545_f491_4f6c_dd1d;
    let mut attempt = 0;
    'search: loop {
        assert!(attempt < 20_000, "no collision-free hash: use more slots");
        let mut keys = [(0u64, 0u64); WORD_SLOTS];
        let mut values = [0u8; WORD_SLOTS];
        let mut i = 0;
        while i <= C_WORDS.len() {
            // `continue` follows the table's words.
            let (w, value) = if i < C_WORDS.len() {
                (C_WORDS[i].word, C_WORDS[i].value)
            } else {
                (b"continue".as_slice(), tok::KEYWORD_CONTROL as i32)
            };
            assert!(w.len() <= WORD_MAX && value > 0 && value < 256);
            let (lo, hi) = word_key(w);
            let s = word_slot(lo, mul);
            if keys[s].0 != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            keys[s] = (lo, hi);
            values[s] = value as u8;
            i += 1;
        }
        break Words { keys, values, mul };
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
    /// Anything else: a run of plain bytes.
    pub const OTHER: u8 = 1;
    pub const DIGIT: u8 = 2;
    /// `"` or `'`.
    pub const QUOTE: u8 = 3;
    pub const SLASH: u8 = 4;
    pub const HASH: u8 = 5;
    pub const DOT: u8 = 6;
    /// A bracket, `,`, `;`, or `:`: one byte with its color in
    /// [`PUNCT_HL`](super::PUNCT_HL).
    pub const PUNCT: u8 = 7;
    /// An operator byte other than `/` and `#` (`$cIsOp`).
    pub const OP: u8 = 8;
    /// ASCII whitespace.
    pub const SPACE: u8 = 9;
    /// NUL: the end of the input, or a plain byte inside it.
    pub const NUL: u8 = 10;
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
                b'/' => class::SLASH,
                b'#' => class::HASH,
                b'.' => class::DOT,
                b',' | b';' | b':' => class::PUNCT,
                b'(' | b')' | b'[' | b']' | b'{' | b'}' => class::PUNCT,
                _ if OPS[c] => class::OP,
                _ => class::OTHER,
            }
        };
        c += 1;
    }
    t
};

/// The color of each [`class::PUNCT`] byte.
static PUNCT_HL: [u8; 256] = {
    let mut t = [0u8; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = match c as u8 {
            b',' | b';' | b':' => tok::PUNCTUATION_DELIMITER as u8,
            b'(' | b')' | b'[' | b']' | b'{' | b'}' => tok::PUNCTUATION_BRACKET as u8,
            _ => 0,
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

/// Bytes that end a run of plain bytes: identifier starts, digits,
/// operators, quotes, and whitespace (`$hlC`'s `$plain` loop).
static PLAIN_STOP: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = is_ident_start(b) || is_digit(b) || OPS[c] || b == b'"' || b == b'\'' || is_space(b);
        c += 1;
    }
    t
};

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

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run.
#[inline(always)]
fn whitespace_end(src: Input, mut p: usize) -> usize {
    loop {
        // Skip spaces 8 bytes at a time, then step over one other
        // whitespace byte (TAB to CR) and go on.
        // SAFETY: `p` lies at or before the NUL after the input, so the
        // 8-byte read stays inside the slack.
        let w = unsafe { src.word_unchecked(p) };
        let x = w ^ 0x2020_2020_2020_2020;
        let other =
            (((x & 0x7f7f_7f7f_7f7f_7f7f) + 0x7f7f_7f7f_7f7f_7f7f) | x) & 0x8080_8080_8080_8080;
        if other == 0 {
            p += 8;
            continue;
        }
        p += (other.trailing_zeros() / 8) as usize;
        // SAFETY: as above, `p` lies at or before the NUL.
        if !is_space(unsafe { src.byte_unchecked(p) }) {
            return p;
        }
        p += 1;
    }
}

/// The end of the identifier run from `p`: `[A-Za-z0-9_$]` and bytes from
/// 0x80 (`$lexScanIdent`, `$scanIdentRun`). The NUL after the input ends
/// every run.
#[inline(always)]
fn ident_end(src: Input, mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..8 {
        // SAFETY: `p` lies at or before the NUL after the input.
        if !IDENT_CONT[unsafe { src.byte_unchecked(p) } as usize] {
            return p;
        }
        p += 1;
    }
    loop {
        // SAFETY: each 16-byte load starts at or before the NUL after the
        // input, inside the slack.
        let v = unsafe { src.vec_unchecked(p) };
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
fn block_comment_end(src: Input, mut p: usize, end: usize) -> usize {
    while p < end {
        // SAFETY: `p` lies before `end`, the input end, so the 17 bytes
        // these loads read stay inside the slack.
        let (a, b) = unsafe { (src.vec_unchecked(p), src.vec_unchecked(p + 1)) };
        let k = a.eq(V::splat(b'*')).and(b.eq(V::splat(b'/'))).first();
        if k < 16 {
            return (p + k + 2).min(end);
        }
        p += 16;
    }
    end
}

/// The nearest byte before `p` on its line that is not a space or tab, or
/// 0 when there is none (`$lexLineByteBefore`).
#[inline(always)]
fn line_byte_before(src: Input, mut p: usize) -> u8 {
    while p > 0 {
        p -= 1;
        // SAFETY: `p` lies before the `#` this looks back from.
        let c = unsafe { src.byte_unchecked(p) };
        if c == b'\n' || c == b'\r' {
            return 0;
        }
        if c != b' ' && c != b'\t' {
            return c;
        }
    }
    0
}

/// Skip spaces and tabs from `p` on the current line (`$lexSkipSpaceAt`).
/// The NUL after the input ends every run.
#[inline(always)]
fn skip_space_at(src: Input, mut p: usize) -> usize {
    loop {
        // SAFETY: `p` starts at or before the NUL after the input, which
        // ends the run.
        let c = unsafe { src.byte_unchecked(p) };
        if c != b' ' && c != b'\t' {
            return p;
        }
        p += 1;
    }
}

/// SCREAMING_CASE: at least two bytes, one uppercase letter, and only
/// `[A-Z0-9_]` (`$lexIsConstCase`).
fn is_const_case(src: Input, lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = false;
    for p in lhs..rhs {
        // SAFETY: the name lies inside the input.
        let c = unsafe { src.byte_unchecked(p) };
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
fn word_at(src: Input, p: usize, n: u32) -> u64 {
    low_bytes(src.word(p), n)
}

/// The first `n` bytes of the little-endian integer `w`.
#[inline(always)]
const fn low_bytes(w: u64, n: u32) -> u64 {
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

/// The color of the name `[lhs, rhs)`, whose first byte is `c`
/// (`$cWordHl`).
#[inline(always)]
fn word_hl(src: Input, lhs: usize, rhs: usize, c: u8) -> u32 {
    // `continue` and the table
    let n = rhs - lhs;
    if n <= WORD_MAX && WORD_LENGTHS[c as usize] >> n & 1 != 0 {
        // SAFETY: the name ends at or before the input end, so the 8 bytes
        // at `lhs`, and at `lhs + 8` for a longer name, lie inside the slack.
        let (lo, hi) = unsafe {
            if n <= 8 {
                (low_bytes(src.word_unchecked(lhs), n as u32), 0)
            } else {
                (
                    src.word_unchecked(lhs),
                    low_bytes(src.word_unchecked(lhs + 8), n as u32 - 8),
                )
            }
        };
        let s = word_slot(lo, WORDS.mul);
        if WORDS.keys[s] == (lo, hi) {
            return WORDS.values[s] as u32;
        }
    }
    // (only `[A-Z_]` can start a constant name)
    if (c.wrapping_sub(b'A') <= 25 || c == b'_') && is_const_case(src, lhs, rhs) {
        return tok::CONSTANT;
    }
    // SAFETY: the name lies inside the input.
    if rhs - lhs >= 3
        && unsafe { src.byte_unchecked(rhs - 2) == b'_' && src.byte_unchecked(rhs - 1) == b't' }
    {
        return tok::TYPE;
    }
    let p = skip_space_at(src, rhs);
    // SAFETY: the run ends at or before the NUL after the input.
    if unsafe { src.byte_unchecked(p) } == b'(' {
        return tok::FUNCTION;
    }
    if c.wrapping_sub(b'A') <= 25 {
        return tok::TYPE;
    }
    tok::VARIABLE
}

/// The number at `p`: radix digits, separators, exponents, and suffixes,
/// with `.` only before a digit (`$lexScanNumber`, `$lexScanNumberBody`).
/// The NUL after the input ends every number.
#[inline(always)]
fn number_body(src: Input, mut p: usize, hex: bool) -> usize {
    let mut prev = 0u8;
    loop {
        // SAFETY: the NUL at the input end stops the run.
        let c = unsafe { src.byte_unchecked(p) };
        if IDENT_CONT[c as usize] {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            // SAFETY: `p` lies before the NUL, at the dot.
            if !is_digit(unsafe { src.byte_unchecked(p + 1) }) {
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
fn hex_number_end(src: Input, lhs: usize) -> usize {
    // SAFETY: `lhs` lies before the NUL, at the number, and the number
    // ends at or before the NUL.
    let hex =
        unsafe { src.byte_unchecked(lhs) == b'0' && src.byte_unchecked(lhs + 1) | 0x20 == b'x' };
    let p = number_body(src, lhs, hex);
    // SAFETY: as above.
    if hex && unsafe { src.byte_unchecked(p) } == b'.' {
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
fn hex_fraction(src: Input, p: usize) -> usize {
    let next = src.byte(p + 1);
    if !(is_hex(next) || next | 32 == b'p') {
        return p;
    }
    if next | 32 == b'p' {
        let mut q = p + 1;
        while is_hex(src.byte(q)) || src.byte(q) == b'_' {
            q += 1;
        }
        if src.byte(q) | 32 != b'p' {
            return p;
        }
        q += 1;
        if src.byte(q) == b'+' || src.byte(q) == b'-' {
            q += 1;
        }
        if !is_digit(src.byte(q)) {
            return p;
        }
    }
    number_body(src, p + 1, true)
}

/// The end of at most `max` hex digits from `p` (`$scanHexRun`).
fn hex_run(src: Input, mut p: usize, max: usize, end: usize) -> usize {
    let stop = (p + max).min(end);
    while p < stop && is_hex(src.byte(p)) {
        p += 1;
    }
    p
}

/// The end of the escape at backslash `p`: one character, kept whole when
/// it is UTF-8, and CRLF as one (`$lexEscapeEnd`).
fn escape_end(src: Input, p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(src.bytes(), p + 2, end);
    if e == p + 2 && src.byte(p + 1) == b'\r' && e < end && src.byte(e) == b'\n' {
        e += 1;
    }
    e
}

/// The end of the C escape at backslash `p` (`$lexCEscapeEnd`).
fn c_escape_end(src: Input, p: usize, end: usize) -> usize {
    let c = if p + 1 < end { src.byte(p + 1) } else { 0 };
    let mut e = p + 2;
    if c == b'u' {
        e = hex_run(src, e, 4, end);
    } else if c == b'U' {
        e = hex_run(src, e, 8, end);
    } else if c == b'x' {
        e = hex_run(src, e, 64, end);
    } else if c == b'N' && e < end && src.byte(e) == b'{' {
        e += 1;
        while e < end {
            let c = src.byte(e);
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
        while e < end && e - p < 4 && src.byte(e).wrapping_sub(b'0') <= 7 {
            e += 1;
        }
    } else {
        e = escape_end(src, p, end);
    }
    scan::utf8_span_end(src.bytes(), e, end)
}

/// The rest of a C literal from the backslash at `p`, with quote `q`; the
/// pending string token starts at `seg`. Emits the body as a string, with
/// escapes as `string.escape`, and returns its end (the escape loop of
/// `$lexCStringBody`, without a suffix).
#[inline(never)]
fn c_string_escapes(
    src: Input,
    mut out: Recs,
    mut p: usize,
    end: usize,
    q: u8,
    mut seg: usize,
) -> (Recs, usize) {
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
        if p == end && (src.byte(p - 1) == b'\n' || src.byte(p - 1) == b'\r') {
            break;
        }
        if p < end {
            p = scan::string_special(src.bytes(), p, end, q);
        }
        if p >= end {
            break;
        }
        let c = src.byte(p);
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
fn c_string(src: Input, out: Recs, lhs: usize, end: usize) -> (Recs, usize) {
    let mut out = out;
    // SAFETY: `lhs` lies before the NUL, at the quote.
    let q = unsafe { src.byte_unchecked(lhs) };
    let p = scan::string_special(src.bytes(), lhs + 1, end, q);
    // SAFETY: the scan stops at or before the input end.
    let c = unsafe { src.byte_unchecked(p) };
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
fn include_directive(src: Input, out: &mut Recs, lhs: usize, rhs: usize) -> bool {
    let mut p = lhs + 1;
    while p < rhs && (src.byte(p) == b' ' || src.byte(p) == b'\t') {
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
    if p < rhs && is_ident_continue(src.byte(p)) {
        return false;
    }
    while p < rhs && (src.byte(p) == b' ' || src.byte(p) == b'\t') {
        p += 1;
    }
    if p >= rhs {
        return false;
    }
    let close = match src.byte(p) {
        b'<' => b'>',
        b'"' => b'"',
        _ => return false,
    };
    let header = p;
    p += 1;
    while p < rhs {
        if src.byte(p) == close {
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

/// Lex the C input of `len` bytes at `base` (`$hlC`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: `base..base + len` plus the slack lies inside lexer memory,
    // and this lexer calls no translated code, so memory stays in place.
    let src = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut out = Recs::load(inst);

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src.bytes(), 0, end);
    out.gap(0, ptr);
    // Leading whitespace; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    out.gap(ptr, first);
    ptr = first;

    // Every token ends at or before the input end, so `ptr` stays at or
    // before the NUL and its lookahead bytes inside the slack.
    loop {
        // SAFETY: `ptr` lies at or before the NUL (above).
        let mut c = unsafe { src.byte_unchecked(ptr) };
        let mut class = CLASS[c as usize];
        if class == class::SPACE {
            // whitespace gaps
            // SAFETY: `ptr` lies before the NUL, at whitespace.
            let next = unsafe { src.byte_unchecked(ptr + 1) };
            let next_class = CLASS[next as usize];
            if c == b' ' && next_class != class::SPACE {
                // one space
                ptr += 1;
                c = next;
                class = next_class;
            } else {
                ptr = whitespace_end(src, ptr + 1);
                // SAFETY: the run ends at or before the NUL.
                c = unsafe { src.byte_unchecked(ptr) };
                class = CLASS[c as usize];
            }
            // SAFETY: the leading run took all whitespace before the first
            // token, so a token's record precedes this gap.
            unsafe { out.extend_unchecked(ptr) };
        }
        let lhs = ptr;
        // Names, the most common tokens, skip the jump table.
        if class == class::IDENT {
            ptr = ident_end(src, ptr + 1);
            // SAFETY: the name ends at or before the NUL.
            let next = unsafe { src.byte_unchecked(ptr) };
            // C literal prefixes: `L`, `u`, `U`, `u8` before a quote
            if (next == b'"' || next == b'\'')
                && ptr < end
                && ((ptr - lhs == 1 && (c == b'L' || c == b'u' || c == b'U'))
                    || (ptr - lhs == 2 && word_at(src, lhs, 2) == word(b"u8")))
            {
                out.tok(tok::STRING, ptr);
                (out, ptr) = c_string(src, out, ptr, end);
                continue;
            }
            let hl = word_hl(src, lhs, ptr, c);
            out.tok(hl, ptr);
            // a bracket or delimiter right after a name: its rule runs
            // here, without the gap and dispatch steps
            if CLASS[next as usize] == class::PUNCT {
                ptr += 1;
                out.tok(PUNCT_HL[next as usize] as u32, ptr);
            }
            continue;
        }
        match class {
            class::SLASH => {
                // SAFETY: `ptr` lies before the NUL, so both lookahead bytes
                // stay inside the slack.
                let c2 = unsafe { src.byte_unchecked(ptr + 1) };
                if c2 == b'/' {
                    // SAFETY: as above.
                    let c3 = unsafe { src.byte_unchecked(ptr + 2) };
                    ptr = scan::line_end(src.bytes(), ptr + 2, end);
                    let hl = if c3 == b'/' || c3 == b'!' {
                        tok::COMMENT_DOC
                    } else {
                        tok::COMMENT
                    };
                    out.tok(hl, ptr);
                } else if c2 == b'*' {
                    // SAFETY: as above.
                    let c3 = unsafe { src.byte_unchecked(ptr + 2) };
                    ptr = block_comment_end(src, ptr + 2, end);
                    let hl = if c3 == b'*' || c3 == b'!' {
                        tok::COMMENT_DOC
                    } else {
                        tok::COMMENT
                    };
                    out.tok(hl, ptr);
                } else {
                    ptr = operator_end(src, ptr, c);
                    out.tok(tok::OPERATOR, ptr);
                }
            }
            class::HASH => {
                // a `#` that opens its line starts a directive to the
                // line end; elsewhere it is an operator
                if line_byte_before(src, lhs) == 0 {
                    ptr = scan::line_end(src.bytes(), ptr + 1, end);
                    if !include_directive(src, &mut out, lhs, ptr) {
                        out.tok(tok::PREPROC, ptr);
                    }
                } else {
                    ptr = operator_end(src, ptr, c);
                    out.tok(tok::OPERATOR, ptr);
                }
            }
            class::QUOTE => {
                (out, ptr) = c_string(src, out, ptr, end);
            }
            class::DIGIT => {
                ptr = hex_number_end(src, ptr);
                out.tok(tok::NUMBER, ptr);
            }
            // SAFETY: `ptr` lies before the NUL, at the dot.
            class::DOT if is_digit(unsafe { src.byte_unchecked(ptr + 1) }) => {
                ptr = hex_number_end(src, ptr);
                out.tok(tok::NUMBER, ptr);
            }
            class::PUNCT => {
                ptr += 1;
                out.tok(PUNCT_HL[c as usize] as u32, ptr);
            }
            class::DOT => {
                ptr += 1;
                out.tok(tok::PUNCTUATION_DELIMITER, ptr);
            }
            class::OP => {
                ptr = operator_end(src, ptr, c);
                out.tok(tok::OPERATOR, ptr);
            }
            class::NUL if ptr >= end => break,
            _ => {
                // unknown bytes are plain, batched until the next byte
                // class
                ptr += 1;
                loop {
                    // SAFETY: the `ptr >= end` test stops the run at the NUL.
                    let c = unsafe { src.byte_unchecked(ptr) };
                    if PLAIN_STOP[c as usize] || ptr >= end {
                        break;
                    }
                    ptr += 1;
                }
                out.tok(tok::NONE, ptr);
            }
        }
    }
    out.store(inst);
}

/// The end of the operator at `p`, whose first byte is `c`: at most one
/// compound operator, so a following slash can still open a comment
/// (`$hlC`'s operator rule).
#[inline(always)]
fn operator_end(src: Input, p: usize, c: u8) -> usize {
    // SAFETY: `p` lies before the NUL, at the operator, so the lookahead
    // bytes stay inside the slack.
    let c2 = unsafe { src.byte_unchecked(p + 1) };
    let mut p = p + 1;
    if c2 == b'=' || (c == c2 && DOUBLES[c as usize]) || (c == b'-' && c2 == b'>') {
        p += 1;
        // SAFETY: as above.
        if (c == b'<' || c == b'>') && unsafe { src.byte_unchecked(p) } == b'=' {
            p += 1;
        }
    }
    p
}
