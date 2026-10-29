//! WAT sources: src/langs/hlsl.wat src/common.wat src/scan.wat
//!
//! Native HLSL lexer. One pass over the input: each token is scanned and
//! colored in the same step, with the same rules, in the same order, as the
//! translated `$hlHlsl`. The records equal the translated lexer's records.
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
use crate::wat_tables::HLSL_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "hlsl" => Some(highlight),
        _ => None,
    }
}

/// `$hlslWords` as a perfect hash on a word's bytes. A word of up to 16
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
    while i < HLSL_WORDS.len() {
        let w = HLSL_WORDS[i].word;
        t[w[0] as usize] |= 1 << w.len();
        i += 1;
    }
    t
};

/// The words, placed by searching for a multiplier that gives each its own
/// slot.
static WORDS: Words = {
    assert!(HLSL_WORDS.len() < 256);
    let mut keys = [(0u64, 0u64); 256];
    let mut values = [0u16; 256];
    let mut i = 0;
    while i < HLSL_WORDS.len() {
        let w = HLSL_WORDS[i].word;
        let value = HLSL_WORDS[i].value;
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
        while i < HLSL_WORDS.len() {
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

/// Operator bytes (`$hlslIsOp`).
const OPS: [bool; 256] = byteset(b"!%&*+-/<=>?^|~");

/// The first bytes of the names `$hlslTypeHl` can match: `sampler`,
/// `int`/`uint` widths, `min1`, and the built-in scalar types of the table
/// (`int bool half uint void dword float double string vector matrix
/// sampler ...`).
static TYPE_START: [bool; 256] = byteset(b"bdfhimsuv");

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
    pub const HASH: u8 = 4;
    pub const SLASH: u8 = 5;
    pub const DOT: u8 = 6;
    /// `(`, `)`, `[`, `]`, `{`, or `}`.
    pub const BRACKET: u8 = 7;
    /// `,` or `;`.
    pub const DELIM: u8 = 8;
    pub const COLON: u8 = 9;
    /// An operator byte other than `/` (`$hlslIsOp`).
    pub const OP: u8 = 10;
    /// ASCII whitespace.
    pub const SPACE: u8 = 11;
    /// NUL: the end of the input, or a plain byte inside it.
    pub const NUL: u8 = 12;
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
                b'#' => class::HASH,
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
        // SAFETY: `p` lies before the starting position, inside the input.
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

/// The number at `p`: radix digits, separators, exponents, and suffixes,
/// with `.` only before a digit (`$lexScanNumber`, `$lexScanNumberBody`).
/// The NUL after the input ends every number.
#[inline(always)]
fn number_body(src: Input, mut p: usize, hex: bool) -> usize {
    let mut prev = 0u8;
    loop {
        // SAFETY: the number starts inside the input and the NUL after it
        // ends the run, so `p` stays at or before the NUL.
        let c = unsafe { src.byte_unchecked(p) };
        if IDENT_CONT[c as usize] {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            // SAFETY: `p` lies before the NUL, at `.`.
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
        // SAFETY: `p` is below `end`.
        let c = unsafe { src.byte_unchecked(p) };
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
    // SAFETY: the quote at `lhs` lies inside the input.
    let q = unsafe { src.byte_unchecked(lhs) };
    let p = scan::string_special(src.bytes(), lhs + 1, end, q);
    // SAFETY: the scan stops at or before `end`, the input end.
    let c = unsafe { src.byte_unchecked(p) };
    if p < end && c == b'\\' {
        return c_string_escapes(src, out, p, end, q, lhs);
    }
    // closed, or ended by a raw line break or the input end
    let p = p + (p < end && c == q) as usize;
    out.tok(tok::STRING, p);
    (out, p)
}

/// The end of the whitespace run from `p`, and whether it holds a CR or LF
/// (`$scanWhitespace`, and the line-break search of `$hlCppImpl`'s gap).
/// The NUL after the input ends every run.
#[inline(always)]
fn whitespace_end(src: Input, mut p: usize) -> (usize, bool) {
    let mut line = false;
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
        let c = unsafe { src.byte_unchecked(p) };
        if !is_space(c) {
            return (p, line);
        }
        line |= c == b'\n' || c == b'\r';
        p += 1;
    }
}

/// The `$hlslWords` value of the name `[lhs, rhs)`, whose first byte is
/// `c`, or -1.
#[inline(always)]
fn word_value(src: Input, lhs: usize, rhs: usize, c: u8) -> i32 {
    let n = rhs - lhs;
    if n > WORD_MAX || WORD_LENGTHS[c as usize] >> n & 1 == 0 {
        return -1;
    }
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
    let e = WORDS.index[word_slot(lo, hi, WORDS.mul)] as usize;
    let key = WORDS.keys[e.wrapping_sub(1) & 255];
    if e != 0 && (key.0 ^ lo) | (key.1 ^ hi) == 0 {
        WORDS.values[e - 1] as i32
    } else {
        -1
    }
}

/// `type.builtin` for the built-in type families the table cannot hold:
/// `sampler2D`, `int16_t`-style widths, `min16float`, and a scalar with a
/// `2`..`4` or `2x2`..`4x4` suffix; otherwise `tok::NONE` (`$hlslTypeHl`).
/// `c` is the name's first byte.
#[inline(always)]
fn type_hl(src: Input, lhs: usize, rhs: usize, c: u8) -> u32 {
    let len = rhs - lhs;
    // (every family starts with a byte of `TYPE_START`)
    if len < 4 || !TYPE_START[c as usize] {
        return tok::NONE;
    }
    // The first `n` bytes at `p`.
    // SAFETY: every read below starts inside the name, which lies inside
    // the input, so its 8 bytes stay inside the slack.
    let at = |p: usize, n: u32| low_bytes(unsafe { src.word_unchecked(p) }, n);
    if len >= 7 && at(lhs, 7) == word(b"sampler") {
        return tok::TYPE_BUILTIN;
    }
    let word32 = |p: usize| at(p, 4);
    let w = word32(rhs - 4);
    if (w == word(b"16_t") || w == word(b"32_t") || w == word(b"64_t"))
        && ((len == 7 && at(lhs, 3) == word(b"int")) || (len == 8 && word32(lhs) == word(b"uint")))
    {
        return tok::TYPE_BUILTIN;
    }
    // `min10float`, `min12int`, `min16uint`, and their vector forms
    if word32(lhs) == word(b"min1") {
        return tok::TYPE_BUILTIN;
    }
    // strip a `1`..`4` or `1x1`..`4x4` suffix and look the scalar stem up
    let mut stem = rhs;
    // SAFETY: the name holds at least four bytes, inside the input.
    if unsafe { src.byte_unchecked(rhs - 1) }.wrapping_sub(b'1') <= 3 {
        stem = rhs - 1;
        // SAFETY: as above.
        if unsafe {
            src.byte_unchecked(rhs - 2) == b'x'
                && src.byte_unchecked(rhs - 3).wrapping_sub(b'1') <= 3
        } {
            stem = rhs - 3;
        }
    }
    if stem == rhs {
        return tok::NONE;
    }
    if word_value(src, lhs, stem, c) == tok::TYPE_BUILTIN as i32 {
        return tok::TYPE_BUILTIN;
    }
    tok::NONE
}

/// The word value of the name `[lhs, rhs)`: its token in the low byte and
/// its next-name capture above (1 = type, 2 = namespace), or -1 for an
/// ordinary name. `c` is its first byte (`$hlslWordHl`).
#[inline(always)]
fn word_hl(src: Input, lhs: usize, rhs: usize, c: u8) -> i32 {
    let g = word_value(src, lhs, rhs, c);
    if g < 0 {
        let g = type_hl(src, lhs, rhs, c);
        return if g != tok::NONE { g as i32 } else { -1 };
    }
    g
}

/// Whether the operator `[lhs, rhs)` is made only of `<`, `>`, and `?`
/// (`$lexIsTypeGlue`).
#[inline(always)]
fn is_type_glue(src: Input, lhs: usize, rhs: usize) -> bool {
    // SAFETY: the operator `[lhs, rhs)` lies inside the input.
    (lhs..rhs).all(|p| matches!(unsafe { src.byte_unchecked(p) }, b'<' | b'>' | b'?'))
}

/// The end of the operator at `p`, whose first byte is `c` (`$hlHlsl`'s
/// `$hlslIsOp` rule).
#[inline(always)]
fn operator_end(src: Input, p: usize, c: u8) -> usize {
    // SAFETY: the operator byte at `p` lies inside the input, so the two
    // bytes after it lie at most one past the NUL.
    let c2 = unsafe { src.byte_unchecked(p + 1) };
    let mut p = p + 1;
    if c2 == b'=' || (c == c2 && DOUBLES[c as usize]) {
        p += 1;
        // SAFETY: as above.
        if (c == b'<' || c == b'>') && unsafe { src.byte_unchecked(p) } == b'=' {
            p += 1;
        }
    }
    p
}

/// Lex the HLSL input of `len` bytes at `base` (`$hlHlsl`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: `base..base + len` plus the slack lies inside lexer memory,
    // and this lexer calls no translated code, so memory stays in place.
    let src = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut out = Recs::load(inst);

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src.bytes(), 0, end);
    out.gap(0, ptr);
    // the pending next-name capture: 1 = type, 2 = namespace
    let mut expect = 0u32;
    // after `.`, `->`, or `::`
    let mut member = false;
    // right after a type, through the `<`, `>`, `[`, `]`, and `,` of a
    // template or array type
    let mut after_type = false;
    // inside a `[...]` that opened a line: names are attributes
    let mut attr = false;
    // after `#include`: `<` opens a header path
    let mut include = false;
    // the token opens its line
    let mut at_head = true;
    // Leading whitespace; every later gap follows a token's record.
    let (first, line) = whitespace_end(src, ptr);
    if line {
        attr = false;
        include = false;
    }
    out.gap(ptr, first);
    ptr = first;

    // The bracket `$c` at `ptr`, `$head` when it opens its line.
    macro_rules! bracket {
        ($c:expr, $head:expr) => {{
            let c: u8 = $c;
            // a bracket opening a line starts an attribute list
            if c == b'[' {
                attr = $head;
            }
            if c == b']' {
                attr = false;
            }
            ptr += 1;
            out.tok(tok::PUNCTUATION_BRACKET, ptr);
            member = false;
            // array brackets keep a type pending; the others end it along
            // with any declaration head
            if c != b'[' && c != b']' {
                after_type = false;
                expect = 0;
            }
        }};
    }
    // The `,` or `;` `$c` at `ptr`.
    macro_rules! delimiter {
        ($c:expr) => {{
            ptr += 1;
            out.tok(tok::PUNCTUATION_DELIMITER, ptr);
            member = false;
            expect = 0;
            if $c == b';' {
                after_type = false;
            }
        }};
    }

    // Every token ends at or before the input end, so `ptr` stays at or
    // before the NUL and its lookahead bytes inside the slack.
    loop {
        // SAFETY: `ptr` lies at or before the NUL (above).
        let mut c = unsafe { src.byte_unchecked(ptr) };
        let mut class = CLASS[c as usize];
        if class == class::SPACE {
            // whitespace gaps; a line break starts a line
            // SAFETY: `ptr` lies before the NUL, at whitespace.
            let next = unsafe { src.byte_unchecked(ptr + 1) };
            let next_class = CLASS[next as usize];
            if c == b' ' && next_class != class::SPACE {
                // one space
                ptr += 1;
                c = next;
                class = next_class;
            } else {
                let (e, line) = whitespace_end(src, ptr + 1);
                if line || c == b'\n' || c == b'\r' {
                    at_head = true;
                    attr = false;
                    include = false;
                }
                ptr = e;
                // SAFETY: the run stops at or before the NUL.
                c = unsafe { src.byte_unchecked(ptr) };
                class = CLASS[c as usize];
            }
            out.extend(ptr);
        }
        let lhs = ptr;
        let head = at_head;
        at_head = false;
        match class {
            class::IDENT => {
                ptr = ident_end(src, ptr + 1);
                let rhs = ptr;
                let kind = if member {
                    -1
                } else {
                    word_hl(src, lhs, rhs, c)
                };
                // SAFETY: the run of blanks after the name ends at or
                // before the NUL after the input.
                let next = || unsafe { src.byte_unchecked(skip_space_at(src, rhs)) };
                let hl;
                if kind >= 0 {
                    hl = kind as u32 & 255;
                    expect = kind as u32 >> 8;
                    after_type = hl == tok::TYPE_BUILTIN;
                } else if attr {
                    hl = tok::ATTRIBUTE;
                    after_type = false;
                } else if expect != 0 {
                    hl = if expect == 1 {
                        tok::TYPE
                    } else {
                        tok::NAMESPACE
                    };
                    after_type = expect == 1;
                    expect = 0;
                } else if c == b'S' && word_at(src, lhs, 3) == word(b"SV_") {
                    // `SV_Position` and its kin are system-value semantics
                    hl = tok::VARIABLE_SPECIAL;
                    after_type = false;
                } else if member {
                    hl = if next() == b'(' {
                        tok::FUNCTION_METHOD
                    } else {
                        tok::PROPERTY
                    };
                    after_type = false;
                } else if next() == b'(' {
                    // after a type, `name(` declares a function; elsewhere
                    // it calls one or constructs a type
                    hl = if after_type {
                        tok::FUNCTION_DEFINITION
                    } else if c.wrapping_sub(b'A') <= 25 {
                        tok::TYPE
                    } else {
                        tok::FUNCTION
                    };
                    after_type = false;
                } else if (c.wrapping_sub(b'A') <= 25 || c == b'_') && is_const_case(src, lhs, rhs)
                {
                    // (only `[A-Z_]` can start a constant name)
                    hl = tok::CONSTANT;
                    after_type = false;
                } else {
                    // A capitalized name is a type, except the declarator
                    // right after one; a name opening or continuing a
                    // template argument list stays a type.
                    let mut h = if c.wrapping_sub(b'A') <= 25 {
                        tok::TYPE
                    } else {
                        tok::VARIABLE
                    };
                    if after_type && h == tok::TYPE {
                        let b = line_byte_before(src, lhs);
                        if b != b'<' && b != b',' {
                            h = tok::VARIABLE;
                        }
                    }
                    hl = h;
                    after_type = hl == tok::TYPE;
                }
                out.tok(hl, rhs);
                member = false;
                // a bracket or delimiter right after a name: its rule runs
                // here, without the gap and dispatch steps
                // SAFETY: the name ends at or before the NUL.
                let next = unsafe { src.byte_unchecked(rhs) };
                let next_class = CLASS[next as usize];
                if next_class == class::BRACKET {
                    bracket!(next, false);
                } else if next_class == class::DELIM {
                    delimiter!(next);
                }
            }
            // SAFETY (the comment rules): `ptr` holds `/`, inside the input,
            // so the three bytes after it lie inside the slack.
            class::SLASH if unsafe { src.byte_unchecked(ptr + 1) } == b'/' => {
                let c3 = unsafe { src.byte_unchecked(ptr + 2) };
                ptr = scan::line_end(src.bytes(), ptr + 2, end);
                let hl = if c3 == b'/' || c3 == b'!' {
                    tok::COMMENT_DOC
                } else {
                    tok::COMMENT
                };
                out.tok(hl, ptr);
            }
            class::SLASH if unsafe { src.byte_unchecked(ptr + 1) } == b'*' => {
                let c3 = unsafe { src.byte_unchecked(ptr + 2) };
                let doc =
                    c3 == b'!' || (c3 == b'*' && unsafe { src.byte_unchecked(ptr + 3) } != b'/');
                ptr = block_comment_end(src, ptr + 2, end);
                out.tok(if doc { tok::COMMENT_DOC } else { tok::COMMENT }, ptr);
            }
            class::HASH => {
                // `#directive`, with the blanks before its name, is one
                // preproc token
                ptr = skip_space_at(src, ptr + 1);
                let word_start = ptr;
                ptr = ident_end(src, ptr);
                include = ptr - word_start == 7 && word_at(src, word_start, 7) == word(b"include");
                out.tok(tok::PREPROC, ptr);
                member = false;
                after_type = false;
            }
            class::OP if include && c == b'<' => {
                // an angle-bracket include path is a string
                ptr += 1;
                loop {
                    // SAFETY: the loop stops at the input end, so `ptr` stays at or
                    // before the NUL.
                    let c = unsafe { src.byte_unchecked(ptr) };
                    if ptr >= end || c == b'\n' || c == b'\r' {
                        break;
                    }
                    ptr += 1;
                    if c == b'>' {
                        break;
                    }
                }
                out.tok(tok::STRING, ptr);
                include = false;
            }
            class::QUOTE => {
                (out, ptr) = c_string(src, out, lhs, end);
                member = false;
                after_type = false;
            }
            class::DIGIT => {
                // SAFETY: `ptr` holds a digit, inside the input.
                let hex = c == b'0' && unsafe { src.byte_unchecked(ptr + 1) } | 0x20 == b'x';
                ptr = number_body(src, ptr, hex);
                out.tok(tok::NUMBER, ptr);
                member = false;
                after_type = false;
            }
            // SAFETY: `ptr` holds `.`, inside the input.
            class::DOT if is_digit(unsafe { src.byte_unchecked(ptr + 1) }) => {
                ptr = number_body(src, ptr, false);
                out.tok(tok::NUMBER, ptr);
                member = false;
                after_type = false;
            }
            class::BRACKET => bracket!(c, head),
            class::DELIM => delimiter!(c),
            class::COLON => {
                // SAFETY: `ptr` holds `:`, inside the input.
                let scope = unsafe { src.byte_unchecked(ptr + 1) } == b':';
                ptr += if scope { 2 } else { 1 };
                out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                member = scope;
                after_type = false;
            }
            class::DOT => {
                ptr += 1;
                out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                member = true;
                after_type = false;
            }
            // SAFETY: `ptr` holds `-`, inside the input.
            class::OP if c == b'-' && unsafe { src.byte_unchecked(ptr + 1) } == b'>' => {
                ptr += 2;
                out.tok(tok::OPERATOR, ptr);
                member = true;
                after_type = false;
            }
            class::OP | class::SLASH => {
                ptr = operator_end(src, ptr, c);
                out.tok(tok::OPERATOR, ptr);
                member = false;
                // the angles of a template type keep it pending; any other
                // operator ends it
                if !is_type_glue(src, lhs, ptr) {
                    after_type = false;
                }
            }
            class::NUL if ptr >= end => break,
            _ => {
                ptr += 1;
                out.tok(tok::NONE, ptr);
                member = false;
                after_type = false;
            }
        }
    }
    out.store(inst);
}
