//! WAT sources: src/langs/cpp.wat src/common.wat src/scan.wat
//!
//! Native C++ lexer. One pass over the input: each token is scanned and
//! colored in the same step, with the same rules, in the same order, as the
//! translated `$hlCpp`. The records equal the translated lexer's records.
//!
//! The WAT tests its rules in one chain. Most rules match one first byte,
//! so this lexer dispatches on a byte class and, for each class, tests only
//! the rules that can match it, in the WAT's order. Besides the token, the
//! lexer carries the WAT's three pieces of context: whether a token already
//! sits on the current line (a `#` there is an operator, not a directive),
//! the pending name capture after `class`/`using`/`namespace`, and whether
//! the last token was a `.`/`->` or `::` member access.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::CPP_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "cpp" => Some(highlight),
        _ => None,
    }
}

/// `$cppWords` with `continue` and `char32_t`, which `$cppWordHl` matches
/// outside the table with the same result as a table entry: a perfect hash
/// on a word's bytes. A word of up to 16 bytes is two little-endian
/// integers, `lo` (bytes 0-7) and `hi` (bytes 8-15), zero past its end;
/// identifiers hold no NUL, so equal integers mean equal words.
struct Words {
    /// Entry number plus one for each hash slot, or 0 for no word.
    index: [u8; WORD_SLOTS],
    keys: [(u64, u64); WORD_COUNT],
    /// The word's `keyword-table.value`: the token in the low byte, the
    /// next-name capture above it.
    values: [u16; WORD_COUNT],
    mul: u64,
}

const WORD_SLOTS: usize = 4096;

/// The extra words and their values.
const EXTRA_WORDS: [(&[u8], i32); 2] = [
    (b"continue", tok::KEYWORD_CONTROL as i32),
    (b"char32_t", tok::TYPE_BUILTIN as i32),
];

const WORD_COUNT: usize = CPP_WORDS.len() + EXTRA_WORDS.len();

/// The longest word.
const WORD_MAX: usize = 16;

/// Word `i`: a table word, or an extra word after them.
const fn word_entry(i: usize) -> (&'static [u8], i32) {
    if i < CPP_WORDS.len() {
        (CPP_WORDS[i].word, CPP_WORDS[i].value)
    } else {
        EXTRA_WORDS[i - CPP_WORDS.len()]
    }
}

/// For each first byte, a bit per length of the words in [`WORDS`]. A name
/// whose bit is clear is no word.
static WORD_LENGTHS: [u32; 256] = {
    let mut t = [0u32; 256];
    let mut i = 0;
    while i < WORD_COUNT {
        let w = word_entry(i).0;
        t[w[0] as usize] |= 1 << w.len();
        i += 1;
    }
    t
};

/// The words, placed by searching for a multiplier that gives each its own
/// slot.
static WORDS: Words = {
    let mut keys = [(0u64, 0u64); WORD_COUNT];
    let mut values = [0u16; WORD_COUNT];
    let mut i = 0;
    while i < WORD_COUNT {
        let (w, value) = word_entry(i);
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
        while i < WORD_COUNT {
            let s = word_slot(keys[i].0, mul);
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

/// Operator bytes (`$cppIsOp`).
const OPS: [bool; 256] = byteset(b"!#%&*+-/<=>?^|~");

/// Byte classes for the main dispatch.
mod class {
    /// An identifier start that cannot begin a literal prefix.
    pub const IDENT: u8 = 0;
    /// `R`, `u`, `L`, `U`: a literal prefix or a name.
    pub const PREFIX: u8 = 1;
    /// Anything else: a run of plain bytes.
    pub const OTHER: u8 = 2;
    pub const DIGIT: u8 = 3;
    /// `"` or `'`.
    pub const QUOTE: u8 = 4;
    pub const SLASH: u8 = 5;
    pub const HASH: u8 = 6;
    pub const DOT: u8 = 7;
    pub const COLON: u8 = 8;
    /// A bracket, `,`, or `;`: one byte with its color and context in
    /// [`PUNCT`](super::PUNCT).
    pub const PUNCT: u8 = 9;
    /// An operator byte other than `/` and `#` (`$cppIsOp`).
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
            match b {
                b'R' | b'u' | b'L' | b'U' => class::PREFIX,
                _ => class::IDENT,
            }
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
                b':' => class::COLON,
                b',' | b';' | b'(' | b')' | b'[' | b']' | b'{' | b'}' => class::PUNCT,
                _ if OPS[c] => class::OP,
                _ => class::OTHER,
            }
        };
        c += 1;
    }
    t
};

/// For each [`class::PUNCT`] byte, its color and a mask for the pending
/// name capture: `{`, `}`, and `;` end it, the others keep it.
static PUNCT: [(u8, u8); 256] = {
    let mut t = [(0u8, 0u8); 256];
    let mut c = 0;
    while c < 256 {
        t[c] = match c as u8 {
            b',' => (tok::PUNCTUATION_DELIMITER as u8, 0xff),
            b';' => (tok::PUNCTUATION_DELIMITER as u8, 0),
            b'(' | b')' | b'[' | b']' => (tok::PUNCTUATION_BRACKET as u8, 0xff),
            b'{' | b'}' => (tok::PUNCTUATION_BRACKET as u8, 0),
            _ => (0, 0),
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

/// Bytes that end a run of plain bytes (`$hlCppImpl`'s `$plain` loop).
static PLAIN_STOP: [bool; 256] = {
    let mut t = byteset(b"\"'(),.:;[]{}");
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] |= is_space(b) || is_ident_start(b) || is_digit(b) || OPS[c];
        c += 1;
    }
    t
};

/// The two kinds of name capture `$cppWordHl`'s high byte selects, and
/// none.
const CAPTURE_CLASS: u32 = 1;
const CAPTURE_NAMESPACE: u32 = 3;

/// The member access before a name: none, `.` or `->`, or `::`.
const MEMBER_DOT: u32 = 1;
const MEMBER_SCOPE: u32 = 2;
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

/// The word value of the name `[lhs, rhs)`: its token in the low byte and
/// its next-name capture above, or -1 for an ordinary name. `c` is its
/// first byte (`$cppWordHl`).
#[inline(always)]
fn word_value(src: Input, lhs: usize, rhs: usize, c: u8) -> i32 {
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
        let e = WORDS.index[word_slot(lo, WORDS.mul)] as usize;
        if e != 0 && WORDS.keys[e - 1] == (lo, hi) {
            return WORDS.values[e - 1] as i32;
        }
    }
    -1
}

/// The end of the C++ number at `p`: radix digits, `'` separators, one
/// `.`, exponent signs, and suffixes (`$cppScanNumber`). The NUL after the
/// input ends every number.
#[inline(always)]
fn number_end(src: Input, mut p: usize) -> usize {
    let mut prev = 0u8;
    let mut dot = false;
    loop {
        let c = src.byte(p);
        if IDENT_CONT[c as usize] || c == b'\'' {
        } else if c == b'.' && !dot {
            dot = true;
        } else if (c == b'+' || c == b'-') && (prev | 32 == b'e' || prev | 32 == b'p') {
        } else {
            break;
        }
        prev = c;
        p += 1;
    }
    p
}

/// What literal the bytes at `p` begin: the quote's offset plus one in the
/// low byte and 256 for a raw literal, or 0 for a name (`$cppStringKind`).
/// Each read past `p` follows a matched byte before the input end, so it
/// lies at or before the NUL after the input.
#[inline(always)]
fn string_kind(src: Input, p: usize) -> u32 {
    let c = src.byte(p);
    if c == b'"' || c == b'\'' {
        return 1;
    }
    let mut n = src.byte(p + 1);
    if c == b'R' && n == b'"' {
        return 258;
    }
    if c == b'u' && n == b'8' {
        n = src.byte(p + 2);
        if n == b'"' || n == b'\'' {
            return 3;
        }
        if n == b'R' && src.byte(p + 3) == b'"' {
            return 260;
        }
    }
    if (c == b'L' || c == b'u' || c == b'U')
        && (n == b'"' || n == b'\'' || (n == b'R' && src.byte(p + 2) == b'"'))
    {
        return if n == b'R' { 259 } else { 2 };
    }
    0
}

/// The end of the raw literal whose `"` is at `quote`: past its closing
/// `)delimiter"` and any suffix name, or the input end when it never
/// closes. `None` when the delimiter is invalid, so the literal is an
/// ordinary one (the raw half of `$cppString`).
#[inline(never)]
fn raw_string_end(src: Input, quote: usize, end: usize) -> Option<usize> {
    let d = quote + 1;
    let mut p = d;
    loop {
        if p >= end {
            return None;
        }
        let c = src.byte(p);
        if c == b'(' {
            break;
        }
        if c <= 32 || c == b')' || c == b'\\' || p - d >= 16 {
            return None;
        }
        p += 1;
    }
    let dlen = p - d;
    let mut ptr = p + 1;
    loop {
        let q = scan::find3(src.bytes(), ptr, end, b')', b')', b')');
        if q >= end {
            return Some(end);
        }
        if q + dlen + 2 <= end
            && src.bytes()[q + 1..q + 1 + dlen] == src.bytes()[d..d + dlen]
            && src.byte(q + dlen + 1) == b'"'
        {
            ptr = q + dlen + 2;
            if is_ident_start(src.byte(ptr)) {
                ptr = ident_end(src, ptr);
            }
            return Some(ptr);
        }
        ptr = q + 1;
    }
}

/// The rest of a C++ literal from the backslash at `p`, with quote `q` and
/// body color `hl`; the pending token starts at `seg`. Emits the body, with
/// escapes as `string.escape`, then any suffix name after the closing
/// quote, and returns the end (the escape loop of `$lexCStringBody` with a
/// suffix).
#[inline(never)]
fn string_escapes(
    src: Input,
    mut out: Recs,
    mut p: usize,
    end: usize,
    q: u8,
    hl: u32,
    mut seg: usize,
) -> (Recs, usize) {
    loop {
        // `p` is at a backslash
        if seg < p {
            out.tok(hl, p);
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
            if is_ident_start(src.byte(p)) {
                p = ident_end(src, p);
            }
            break;
        }
        // a raw line break: unterminated, left unconsumed
        if c != b'\\' {
            break;
        }
    }
    if seg < p {
        out.tok(hl, p);
    }
    (out, p)
}

/// The literal at `lhs` of kind `kind` ([`string_kind`]): a raw literal as
/// one string token, or an ordinary one whose body is a string (a number
/// for a character literal) with escapes as `string.escape`, followed by
/// any suffix name. A prefix takes the body's color. Returns the end
/// (`$cppString`, `$lexCStringBody`).
#[inline(always)]
fn string(src: Input, out: Recs, lhs: usize, kind: u32, end: usize) -> (Recs, usize) {
    let mut out = out;
    let quote = lhs + (kind & 255) as usize - 1;
    if kind & 256 != 0
        && let Some(p) = raw_string_end(src, quote, end)
    {
        out.tok(tok::STRING, p);
        return (out, p);
    }
    // An invalid raw prefix falls back to an ordinary literal.
    let q = src.byte(quote);
    let hl = if q == b'\'' { tok::NUMBER } else { tok::STRING };
    let mut p = scan::string_special(src.bytes(), quote + 1, end, q);
    let c = src.byte(p);
    if p < end && c == b'\\' {
        return string_escapes(src, out, p, end, q, hl, lhs);
    }
    // closed, or ended by a raw line break or the input end
    if p < end && c == q {
        p += 1;
        if is_ident_start(src.byte(p)) {
            p = ident_end(src, p);
        }
    }
    out.tok(hl, p);
    (out, p)
}

/// The end of a directive's logical line from `p`: physical lines joined
/// by a backslash before the line break (`$cppDirectiveScan`).
#[inline(always)]
fn directive_end(src: Input, lhs: usize, mut p: usize, end: usize) -> usize {
    loop {
        p = scan::line_end(src.bytes(), p, end);
        if p >= end || p == lhs || src.byte(p - 1) != b'\\' {
            return p;
        }
        if src.byte(p) == b'\r' {
            p += 1;
        }
        if src.byte(p) == b'\n' {
            p += 1;
        }
    }
}

/// Lex the C++ input of `len` bytes at `base` (`$hlCpp`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: `base..base + len` plus the slack lies inside lexer memory,
    // and this lexer calls no translated code, so memory stays in place.
    let src = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut out = Recs::load(inst);

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src.bytes(), 0, end);
    out.gap(0, ptr);
    // a token already sits on the current line: `#` is no directive
    let mut mid_line = false;
    // the next name's capture after `class`, `using`, `namespace`, ...
    let mut expect_type = 0u32;
    // the member access before the next name
    let mut member = 0u32;
    // Leading whitespace; every later gap follows a token's record.
    let (first, _) = whitespace_end(src, ptr);
    out.gap(ptr, first);
    ptr = first;

    // Every token ends at or before the input end, so `ptr` stays at or
    // before the NUL and its lookahead bytes inside the slack.
    loop {
        // SAFETY: `ptr` lies at or before the NUL (above).
        let mut c = unsafe { src.byte_unchecked(ptr) };
        let mut class = CLASS[c as usize];
        if class == class::SPACE {
            // whitespace gaps; a line break puts the next token at a line
            // start
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
                    mid_line = false;
                }
                ptr = e;
                c = src.byte(ptr);
                class = CLASS[c as usize];
            }
            // SAFETY: the leading gap and every token before this one
            // wrote a record.
            unsafe { out.extend_unchecked(ptr) };
        }
        let lhs = ptr;
        // Names, the most common tokens, skip the jump table.
        if class <= class::PREFIX {
            // prefixed and raw literals
            if class == class::PREFIX {
                let kind = string_kind(src, ptr);
                if kind != 0 {
                    (out, ptr) = string(src, out, lhs, kind, end);
                    mid_line = true;
                    member = 0;
                    expect_type = 0;
                    continue;
                }
            }
            ptr = ident_end(src, ptr + 1);
            let rhs = ptr;
            // a name glued to a closing `"` is a literal suffix
            // SAFETY: `lhs - 1` lies inside the input when `lhs > 0`.
            if lhs > 0 && unsafe { src.byte_unchecked(lhs - 1) } == b'"' {
                out.tok(tok::STRING, rhs);
                mid_line = true;
                member = 0;
                expect_type = 0;
                continue;
            }
            let kind = word_value(src, lhs, rhs, c);
            let hl;
            if kind >= 0 {
                hl = kind as u32 & 255;
                if kind >> 8 != 0 {
                    expect_type = kind as u32 >> 8;
                }
            } else {
                // the two bytes after the name: `(`, `::`, and a label
                // `:`
                let p = skip_space_at(src, rhs);
                // SAFETY: the run ends at or before the NUL after the input.
                let c2 = unsafe { src.byte_unchecked(p) };
                let scope = c2 == b':' && src.byte(p + 1) == b':';
                if expect_type != 0 {
                    // a qualifier is a namespace and passes the capture
                    // on to the path's last segment
                    if scope {
                        hl = tok::NAMESPACE;
                    } else {
                        hl = if expect_type == CAPTURE_CLASS {
                            tok::TYPE_CLASS
                        } else if expect_type == CAPTURE_NAMESPACE {
                            tok::NAMESPACE
                        } else {
                            tok::TYPE
                        };
                        expect_type = 0;
                    }
                } else if c2 == b'(' {
                    hl = if member != 0 {
                        tok::FUNCTION_METHOD
                    } else {
                        tok::FUNCTION
                    };
                } else if member == MEMBER_DOT {
                    hl = tok::PROPERTY;
                } else if member == MEMBER_SCOPE || scope {
                    hl = if scope { tok::NAMESPACE } else { tok::TYPE };
                } else if c2 == b':' {
                    hl = tok::LABEL;
                } else if (c.wrapping_sub(b'A') <= 25 || c == b'_') && is_const_case(src, lhs, rhs)
                {
                    // (only `[A-Z_]` can start a constant name)
                    hl = tok::CONSTANT;
                } else if c.wrapping_sub(b'A') <= 25 {
                    hl = tok::TYPE;
                } else {
                    hl = tok::VARIABLE;
                }
            }
            out.tok(hl, rhs);
            mid_line = true;
            member = 0;
            // a bracket, `,`, or `;` right after a name: its rule runs
            // here, without the gap and dispatch steps
            // SAFETY: the name ends at or before the NUL.
            let next = unsafe { src.byte_unchecked(rhs) };
            if CLASS[next as usize] == class::PUNCT {
                let (hl, keep) = PUNCT[next as usize];
                ptr += 1;
                out.tok(hl as u32, ptr);
                expect_type &= keep as u32;
            }
            continue;
        }
        match class {
            class::PUNCT => {
                // brackets, `,`, and `;`, and any more right after
                let mut c = c;
                loop {
                    let (hl, keep) = PUNCT[c as usize];
                    ptr += 1;
                    out.tok(hl as u32, ptr);
                    expect_type &= keep as u32;
                    // SAFETY: each bracket or delimiter lies inside the input, so
                    // `ptr` stays at or before the NUL.
                    c = unsafe { src.byte_unchecked(ptr) };
                    if CLASS[c as usize] != class::PUNCT {
                        break;
                    }
                }
                mid_line = true;
                member = 0;
            }
            class::QUOTE => {
                (out, ptr) = string(src, out, lhs, 1, end);
                mid_line = true;
                member = 0;
                expect_type = 0;
            }
            class::SLASH if src.byte(ptr + 1) == b'/' => {
                // comments, including Doxygen-style documentation
                let c3 = src.byte(ptr + 2);
                ptr = scan::line_end(src.bytes(), ptr + 2, end);
                let hl = if c3 == b'/' || c3 == b'!' {
                    tok::COMMENT_DOC
                } else {
                    tok::COMMENT
                };
                out.tok(hl, ptr);
            }
            class::SLASH if src.byte(ptr + 1) == b'*' => {
                let c3 = src.byte(ptr + 2);
                let doc = c3 == b'!' || (c3 == b'*' && src.byte(ptr + 3) != b'/');
                ptr = block_comment_end(src, ptr + 2, end);
                out.tok(if doc { tok::COMMENT_DOC } else { tok::COMMENT }, ptr);
            }
            class::HASH if !mid_line => {
                // a directive owns its logical line
                ptr = directive_end(src, lhs, ptr + 1, end);
                if !include_directive(src, &mut out, lhs, ptr) {
                    out.tok(tok::PREPROC, ptr);
                }
                mid_line = true;
                member = 0;
                expect_type = 0;
            }
            class::DIGIT => {
                ptr = number_end(src, ptr);
                out.tok(tok::NUMBER, ptr);
                mid_line = true;
                member = 0;
            }
            // SAFETY: `ptr` holds `.`, inside the input.
            class::DOT if is_digit(unsafe { src.byte_unchecked(ptr + 1) }) => {
                ptr = number_end(src, ptr);
                out.tok(tok::NUMBER, ptr);
                mid_line = true;
                member = 0;
            }
            class::COLON => {
                // `::` scopes the next name
                // SAFETY: `ptr` holds `:`, inside the input.
                if unsafe { src.byte_unchecked(ptr + 1) } == b':' {
                    ptr += 2;
                    member = MEMBER_SCOPE;
                } else {
                    ptr += 1;
                    member = 0;
                }
                out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                mid_line = true;
            }
            class::DOT => {
                // `.*` and `...` are operators; `.` is a member access
                // SAFETY: `ptr` holds `.`, inside the input, so the two bytes
                // after it lie inside the slack.
                let c2 = unsafe { src.byte_unchecked(ptr + 1) };
                if c2 == b'*' || (c2 == b'.' && unsafe { src.byte_unchecked(ptr + 2) } == b'.') {
                    ptr += if c2 == b'.' { 3 } else { 2 };
                    out.tok(tok::OPERATOR, ptr);
                    member = 0;
                } else {
                    ptr += 1;
                    out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                    member = MEMBER_DOT;
                }
                mid_line = true;
            }
            class::OP | class::SLASH | class::HASH => {
                // one compound operator, leaving a following `/` free to
                // open a comment
                // SAFETY (this rule): the operator byte at `ptr` lies inside the
                // input, so the bytes it looks at lie at most two past the NUL.
                let c2 = unsafe { src.byte_unchecked(ptr + 1) };
                ptr += 1;
                member = 0;
                if c == b'-' && c2 == b'>' {
                    ptr += 1;
                    if unsafe { src.byte_unchecked(ptr) } == b'*' {
                        ptr += 1;
                    }
                    member = MEMBER_DOT;
                } else if c == b'<' && c2 == b'=' && unsafe { src.byte_unchecked(ptr + 1) } == b'>'
                {
                    ptr += 2;
                } else if c2 == b'=' || c == c2 {
                    ptr += 1;
                    if (c == b'<' || c == b'>') && unsafe { src.byte_unchecked(ptr) } == b'=' {
                        ptr += 1;
                    }
                }
                out.tok(tok::OPERATOR, ptr);
                mid_line = true;
            }
            class::NUL if ptr >= end => break,
            _ => {
                // unknown bytes are plain, batched until the next byte
                // class
                ptr += 1;
                loop {
                    let c = src.byte(ptr);
                    if PLAIN_STOP[c as usize] || ptr >= end {
                        break;
                    }
                    ptr += 1;
                }
                out.tok(tok::NONE, ptr);
                mid_line = true;
                member = 0;
            }
        }
    }
    out.store(inst);
}
