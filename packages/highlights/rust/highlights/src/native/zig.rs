//! WAT sources: src/langs/zig.wat src/common.wat src/scan.wat src/sig.wat
//!
//! Native Zig highlighter. One pass over the input: each token is scanned
//! and colored in the same step, with the same rules, in the same order, as
//! the translated `$hlZig`. The records equal the translated lexer's
//! records.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::ZIG_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "zig" => Some(highlight),
        _ => None,
    }
}

/// `$zigWords` and the names `$zigWordHl` matches outside the table with
/// fixed colors (`c`, `_`, `comptime`; group 0, so `keyword-table.get`
/// still misses them), as a perfect hash on a word's bytes. A word of up to
/// 16 bytes is two little-endian integers, `lo` (bytes 0-7) and `hi` (bytes
/// 8-15), zero past its end; identifiers hold no NUL, so equal integers
/// mean equal words.
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    /// The word's `keyword-table.value`.
    values: [u16; WORD_SLOTS],
    /// The word's 1-based group (`keyword-table.get`).
    groups: [u8; WORD_SLOTS],
    mul: u64,
}

const WORD_SLOTS: usize = 512;

/// The longest word.
const WORD_MAX: usize = 16;

/// The slot of the word whose integers are `lo` and `hi`. No two words
/// share a slot, so a name is a word only when its integers equal the
/// slot's.
#[inline(always)]
const fn word_slot(lo: u64, hi: u64, mul: u64) -> usize {
    (lo.wrapping_add(hi.rotate_left(29)).wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros()))
        as usize
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
    while i < ZIG_WORDS.len() + EXTRA_WORDS.len() {
        let w = word_entry(i).0;
        t[w[0] as usize] |= 1 << w.len();
        i += 1;
    }
    t
};

/// The names `$zigWordHl` colors outside the table, with their values.
const EXTRA_WORDS: [(&[u8], u32); 3] = [
    (b"c", tok::VARIABLE_SPECIAL),
    (b"_", tok::VARIABLE_SPECIAL),
    (b"comptime", tok::KEYWORD),
];

/// Entry `i` of [`ZIG_WORDS`] followed by [`EXTRA_WORDS`]: the word, its
/// value, and its group.
const fn word_entry(i: usize) -> (&'static [u8], i32, u8) {
    if i < ZIG_WORDS.len() {
        (ZIG_WORDS[i].word, ZIG_WORDS[i].value, ZIG_WORDS[i].group)
    } else {
        let (w, v) = EXTRA_WORDS[i - ZIG_WORDS.len()];
        (w, v as i32, 0)
    }
}

/// The words, placed by searching for a multiplier that gives each its own
/// slot.
static WORDS: Words = {
    let mut mul: u64 = 0x2545_f491_4f6c_dd1d;
    let mut attempt = 0;
    'search: loop {
        assert!(attempt < 20_000, "no collision-free hash: use more slots");
        let mut keys = [(0u64, 0u64); WORD_SLOTS];
        let mut values = [0u16; WORD_SLOTS];
        let mut groups = [0u8; WORD_SLOTS];
        let mut i = 0;
        while i < ZIG_WORDS.len() + EXTRA_WORDS.len() {
            let (w, value, group) = word_entry(i);
            assert!(w.len() <= WORD_MAX && value >= 0 && value < 0x10000);
            let (lo, hi) = word_key(w);
            let s = word_slot(lo, hi, mul);
            if keys[s].0 != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            keys[s] = (lo, hi);
            values[s] = value as u16;
            groups[s] = group;
            i += 1;
        }
        break Words {
            keys,
            values,
            groups,
            mul,
        };
    }
};

/// The slot of the word `[lhs, rhs)` in [`WORDS`], if it is one.
#[inline(always)]
fn word_find(src: Input, lhs: usize, rhs: usize) -> Option<usize> {
    let n = rhs - lhs;
    // SAFETY: the name `[lhs, rhs)` lies inside the input, and so does
    // `lhs + 8` when the name is longer than 8 bytes.
    if n > WORD_MAX || WORD_LENGTHS[unsafe { src.byte_unchecked(lhs) } as usize] >> n & 1 == 0 {
        return None;
    }
    // SAFETY: as above.
    let (lo, hi) = unsafe {
        if n <= 8 {
            (word_at(src, lhs, n as u32), 0)
        } else {
            (word_at(src, lhs, 8), word_at(src, lhs + 8, n as u32 - 8))
        }
    };
    let s = word_slot(lo, hi, WORDS.mul);
    if WORDS.keys[s] == (lo, hi) {
        Some(s)
    } else {
        None
    }
}

/// The word's 1-based group, or 0 (`keyword-table.get $zigWords`).
#[inline(always)]
fn word_group(src: Input, lhs: usize, rhs: usize) -> u8 {
    word_find(src, lhs, rhs).map_or(0, |s| WORDS.groups[s])
}

/// Operator bytes (`$zigIsOp`).
static OPS: [bool; 256] = byteset(b"!%&*+-/<=>?^|~");

/// Byte classes for the main dispatch.
mod class {
    /// A letter or `_` (`$zigIsIdentStart`).
    pub const IDENT: u8 = 0;
    pub const DIGIT: u8 = 1;
    pub const SLASH: u8 = 2;
    pub const BACKSLASH: u8 = 3;
    /// `"` or `'`.
    pub const QUOTE: u8 = 4;
    pub const AT: u8 = 5;
    /// `(`, `)`, `[`, `]`, `{`, `}`.
    pub const BRACKET: u8 = 6;
    /// `=` or `-`: an arrow or an operator.
    pub const ARROW: u8 = 7;
    pub const DOT: u8 = 8;
    /// `;`, `,`, `:`.
    pub const DELIMITER: u8 = 9;
    pub const PIPE: u8 = 10;
    /// Any other operator byte (`$zigIsOp`).
    pub const OP: u8 = 11;
    /// Anything else: one byte colored `none`.
    pub const OTHER: u8 = 12;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 13;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    t[0] = class::NUL;
    let mut c = 1;
    while c < 256 {
        let b = c as u8;
        t[c] = if is_ident_start(b) {
            class::IDENT
        } else if is_digit(b) {
            class::DIGIT
        } else {
            match b {
                b'/' => class::SLASH,
                b'\\' => class::BACKSLASH,
                b'"' | b'\'' => class::QUOTE,
                b'@' => class::AT,
                b'(' | b')' | b'[' | b']' | b'{' | b'}' => class::BRACKET,
                b'=' | b'-' => class::ARROW,
                b'.' => class::DOT,
                b';' | b',' | b':' => class::DELIMITER,
                b'|' => class::PIPE,
                _ if OPS[c] => class::OP,
                _ => class::OTHER,
            }
        };
        c += 1;
    }
    t
};

/// Identifier bytes `[A-Za-z0-9_]` (`$zigIdentEnd`).
static IDENT_CONT: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = is_ident_start(c as u8) || is_digit(c as u8);
        c += 1;
    }
    t
};

/// The byte at `i`, or 0 at and past `end` (`$zigByte`), for lookaheads
/// that may start past the NUL.
#[inline(always)]
fn byte(src: Input, i: usize, end: usize) -> u8 {
    // SAFETY: `i` lies before the input end.
    if i < end {
        unsafe { src.byte_unchecked(i) }
    } else {
        0
    }
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

/// Whether `c` starts a Zig identifier: an ASCII letter or `_`
/// (`$zigIsIdentStart`).
#[inline(always)]
const fn is_ident_start(c: u8) -> bool {
    (c | 32).wrapping_sub(b'a') <= 25 || c == b'_'
}

/// Whether `c` is ASCII whitespace: space or TAB through CR (`$lexIsSpace`).
#[inline(always)]
const fn is_space(c: u8) -> bool {
    c == b' ' || c.wrapping_sub(9) <= 4
}

/// Whether `c` is an ASCII uppercase letter.
#[inline(always)]
const fn is_upper(c: u8) -> bool {
    c.wrapping_sub(b'A') <= 25
}

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run.
#[inline(always)]
fn whitespace_end(src: Input, mut p: usize) -> usize {
    loop {
        // SAFETY: `p` starts at or before the input end, and the NUL there
        // ends the run, so `p` never passes it; 8 bytes from there stay inside
        // the slack.
        let c = unsafe { src.byte_unchecked(p) };
        if c == b' ' {
            // Skip spaces 8 bytes at a time.
            // SAFETY: as above.
            let w = unsafe { src.word_unchecked(p) };
            let x = w ^ 0x2020_2020_2020_2020;
            let other =
                (((x & 0x7f7f_7f7f_7f7f_7f7f) + 0x7f7f_7f7f_7f7f_7f7f) | x) & 0x8080_8080_8080_8080;
            p += if other == 0 {
                8
            } else {
                (other.trailing_zeros() / 8) as usize
            };
        } else if c.wrapping_sub(9) <= 4 {
            // TAB through CR, one at a time
            p += 1;
        } else {
            return p;
        }
    }
}

/// The end of the ASCII identifier run `[A-Za-z0-9_]` from `p`
/// (`$zigIdentEnd`). The NUL after the input ends every run.
#[inline(always)]
fn ident_end(src: Input, mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..4 {
        // SAFETY: `p` starts at or before the input end, and the NUL there
        // ends the run, so `p` never passes it; 16 bytes from there stay
        // inside the slack.
        if !IDENT_CONT[unsafe { src.byte_unchecked(p) } as usize] {
            return p;
        }
        p += 1;
    }
    loop {
        // SAFETY: as above.
        let v = unsafe { src.vec_unchecked(p) };
        let alpha = v.or(V::splat(0x20)).sub(V::splat(b'a')).le(V::splat(25));
        let digit = v.sub(V::splat(b'0')).le(V::splat(9));
        let under = v.eq(V::splat(b'_'));
        let ok = alpha.or(digit).or(under);
        let k = ok.not().first();
        if k < 16 {
            return p + k;
        }
        p += 16;
    }
}

/// Skip spaces and tabs from `p` on the current line (`$lexSkipSpaceAt`).
#[inline(always)]
fn skip_space_at(src: Input, mut p: usize) -> usize {
    // SAFETY: `p` starts at or before the input end, and the NUL there ends
    // the run.
    while unsafe { src.byte_unchecked(p) } == b' ' || unsafe { src.byte_unchecked(p) } == b'\t' {
        p += 1;
    }
    p
}

/// The nearest byte before `p` on its line that is not a space or tab, or
/// 0 (`$lexLineByteBefore`; the input starts at offset 0).
fn line_byte_before(src: Input, mut p: usize) -> u8 {
    while p > 0 {
        p -= 1;
        // SAFETY: `p` is below a position at or before the input end.
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

/// SCREAMING_CASE: at least two bytes, one uppercase letter, and only
/// `[A-Z0-9_]` (`$lexIsConstCase`).
fn is_const_case(src: Input, lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = false;
    for p in lhs..rhs {
        // SAFETY: the name `[lhs, rhs)` lies inside the input.
        let c = unsafe { src.byte_unchecked(p) };
        if is_upper(c) {
            upper = true;
        } else if !(is_digit(c) || c == b'_') {
            return false;
        }
    }
    upper
}

/// The first `n` bytes at `p` as a little-endian integer, for comparing
/// short words. Reads 8 bytes, which the input slack allows.
///
/// # Safety
/// `p` must lie inside the input.
#[inline(always)]
unsafe fn word_at(src: Input, p: usize, n: u32) -> u64 {
    // SAFETY: `p` lies before the input end, so `p + 8` lies inside the
    // slack.
    let w = unsafe { src.word_unchecked(p) };
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

/// The color of the name `[lhs, rhs)` with its table group in bits 8 and
/// up, or -1 for a plain name. `c`, `_`, `comptime`, and arbitrary-width
/// `iN`/`uN` names are matched outside the table (`$zigWordHl`).
#[inline(always)]
fn word_hl(src: Input, lhs: usize, rhs: usize) -> i32 {
    if let Some(s) = word_find(src, lhs, rhs) {
        return WORDS.values[s] as i32;
    }
    // SAFETY: the name `[lhs, rhs)` lies inside the input.
    let first = unsafe { src.byte_unchecked(lhs) };
    // (a one-byte `i` or `u` is a plain name)
    if (first == b'i' || first == b'u') && rhs - lhs > 1 {
        return int_type(src, lhs, rhs);
    }
    -1
}

/// `iN`/`uN` with a width up to 65535 is a primitive type, otherwise a
/// plain name (`$zigWordHl`).
fn int_type(src: Input, lhs: usize, rhs: usize) -> i32 {
    let mut width = 0u32;
    for p in lhs + 1..rhs {
        // SAFETY: `p` is inside the name, before the input end.
        let c = unsafe { src.byte_unchecked(p) };
        if !is_digit(c) || width > 6553 {
            return -1;
        }
        width = width * 10 + (c - b'0') as u32;
        if width > 65535 {
            return -1;
        }
    }
    tok::TYPE_BUILTIN as i32
}

/// Whether `c` is a digit in `base` (`$zigIsDigitForBase`).
#[inline(always)]
fn is_digit_for_base(c: u8, base: u32) -> bool {
    if base == 16 {
        is_hex(c)
    } else {
        ((c.wrapping_sub(b'0')) as u32) < base
    }
}

/// The end of the digits in `base` from `p`, with `_` only between two
/// digits (`$zigScanDigits`). The NUL after the input ends every run.
#[inline(always)]
fn scan_digits(src: Input, mut p: usize, base: u32) -> usize {
    let start = p;
    loop {
        // SAFETY: `p` starts at or before the input end, and the NUL there
        // ends the run; a `_` is an input byte, so the byte after it is at
        // most the NUL.
        let c = unsafe { src.byte_unchecked(p) };
        if is_digit_for_base(c, base) {
            p += 1;
            continue;
        }
        // SAFETY: as above.
        if p == start || c != b'_' || !is_digit_for_base(unsafe { src.byte_unchecked(p + 1) }, base)
        {
            return p;
        }
        p += 1;
    }
}

/// The end of the number at `lhs` (`$hlZig`'s number rule).
fn number_end(src: Input, lhs: usize) -> usize {
    let mut base = 10;
    // SAFETY (the reads below): the number starts inside the input and
    // ends at or before the NUL after it; each lookahead is at most two
    // bytes past an input byte.
    if unsafe { src.byte_unchecked(lhs) } == b'0' {
        base = match unsafe { src.byte_unchecked(lhs + 1) } {
            b'b' => 2,
            b'o' => 8,
            b'x' => 16,
            _ => 10,
        };
    }
    let mut ptr;
    if base != 10 && is_digit_for_base(unsafe { src.byte_unchecked(lhs + 2) }, base) {
        ptr = scan_digits(src, lhs + 2, base);
    } else {
        base = 10;
        ptr = scan_digits(src, lhs, 10);
    }
    if (base == 10 || base == 16)
        && unsafe { src.byte_unchecked(ptr) } == b'.'
        && is_digit_for_base(unsafe { src.byte_unchecked(ptr + 1) }, base)
    {
        ptr = scan_digits(src, ptr + 1, base);
    }
    let c = unsafe { src.byte_unchecked(ptr) } | 32;
    if (base == 10 && c == b'e') || (base == 16 && c == b'p') {
        let mut p = ptr + 1;
        let s = unsafe { src.byte_unchecked(p) };
        if s == b'+' || s == b'-' {
            p += 1;
        }
        if is_digit(unsafe { src.byte_unchecked(p) }) {
            ptr = scan_digits(src, p, 10);
        }
    }
    ptr
}

/// The end of at most `max` hex digits from `p`, bounded by `end`
/// (`$scanHexRun`).
#[inline(always)]
fn hex_run_end(src: Input, mut p: usize, max: usize, end: usize) -> usize {
    let stop = (p + max).min(end);
    // SAFETY: `p` lies before the input end.
    while p < stop && is_hex(unsafe { src.byte_unchecked(p) }) {
        p += 1;
    }
    p
}

/// The end of the operator run at `p`: operators glue together except
/// before `->`, `=>`, or `//` (`$hlZig`'s operator rule).
fn op_end(src: Input, mut ptr: usize, end: usize) -> usize {
    loop {
        // SAFETY: the operator byte at `ptr` lies inside the input.
        let c = unsafe { src.byte_unchecked(ptr) };
        let p = byte(src, ptr + 1, end);
        if ((c == b'-' || c == b'=') && p == b'>') || (c == b'/' && p == b'/') {
            return ptr;
        }
        let q = byte(src, ptr + 2, end);
        let mut base = 1;
        if p == b'=' && c != b'?' && c != b'~' {
            base = 2;
        }
        if (c == b'*' && p == b'*') || (c == b'+' && p == b'+') || (c == b'|' && p == b'|') {
            base = 2;
        }
        if (c == b'*' || c == b'+' || c == b'-') && (p == b'%' || p == b'|') {
            base = if q == b'=' { 3 } else { 2 };
        }
        if c == b'<' && p == b'<' {
            base = 2;
            if q == b'=' {
                base = 3;
            }
            if q == b'|' {
                base = if byte(src, ptr + 3, end) == b'=' {
                    4
                } else {
                    3
                };
            }
        }
        if c == b'>' && p == b'>' {
            base = if q == b'=' { 3 } else { 2 };
        }
        ptr += base;
        // SAFETY: `ptr` lies before the input end.
        if !(ptr < end && OPS[unsafe { src.byte_unchecked(ptr) } as usize]) {
            return ptr;
        }
    }
}

/// The single-line string, code-point literal, or quoted identifier body
/// whose `quote` is at `p`, colored `hl`, with escapes as their own tokens;
/// `seg` starts the pending token. Returns the end (`$zigString`).
#[inline(never)]
fn string(
    src: Input,
    mut recs: Recs,
    p: usize,
    end: usize,
    quote: u8,
    hl: u32,
    mut seg: usize,
) -> (Recs, usize) {
    let mut p = p + 1;
    loop {
        p = scan::string_special(src.bytes(), p, end, quote);
        if p >= end {
            break;
        }
        // SAFETY: `p` lies before the input end.
        let c = unsafe { src.byte_unchecked(p) };
        if c == quote {
            p += 1;
            break;
        }
        if c != b'\\' {
            // a line break ends the literal
            break;
        }
        if seg < p {
            recs.tok(hl, p);
        }
        let mut e = p + 1;
        if e < end {
            // SAFETY: `e` lies before the input end.
            let c = unsafe { src.byte_unchecked(e) };
            if c != b'\n' && c != b'\r' {
                e += 1;
                if c == b'x' {
                    e = hex_run_end(src, e, 2, end);
                }
                // a code point escape holds at most six hex digits
                if c == b'u' && byte(src, e, end) == b'{' {
                    e = hex_run_end(src, e + 1, 6, end);
                    if byte(src, e, end) == b'}' {
                        e += 1;
                    }
                }
            }
        }
        e = scan::utf8_span_end(src.bytes(), e, end);
        if p < e {
            recs.tok(tok::STRING_ESCAPE, e);
        }
        p = e;
        seg = p;
    }
    if seg < p {
        recs.tok(hl, p);
    }
    (recs, p)
}

/// Context flags that the next token clears unless it continues them
/// (`$hlZig`'s locals of the same names, and `$sigFnPend`).
mod ctx {
    /// After `break`/`continue`: a `:` introduces a label.
    pub const WANT_BREAK_LABEL: u32 = 1;
    /// After a label's name: its `:` takes no type.
    pub const LABEL_COLON: u32 = 2;
    /// The next name is an fn name.
    pub const EXPECT_FUNC: u32 = 4;
    /// The next name is a `break`/`continue` label.
    pub const EXPECT_LABEL: u32 = 8;
    /// After `if`/`for`/`while`: the next `(` may precede a payload.
    pub const WANT_PAYLOAD_PAREN: u32 = 16;
    /// A payload's opening `|` may come next.
    pub const PAYLOAD_READY: u32 = 32;
    /// An fn name armed the parameter machine for its paren (`$sigFnPend`).
    pub const FN_PEND: u32 = 64;
}

/// For each first byte of a token, the [`ctx`] flags it keeps: `:` keeps
/// the label flags, a name keeps the name expectations, `(` keeps the
/// paren expectations. `@"` (a quoted name) and a payload `|` depend on the
/// next byte and are kept by the caller.
static KEEP: [u8; 256] = {
    let mut t = [0u8; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = if b == b':' {
            (ctx::WANT_BREAK_LABEL | ctx::LABEL_COLON) as u8
        } else if is_ident_start(b) {
            (ctx::EXPECT_FUNC | ctx::EXPECT_LABEL) as u8
        } else if b == b'(' {
            (ctx::WANT_PAYLOAD_PAREN | ctx::FN_PEND) as u8
        } else {
            0
        };
        c += 1;
    }
    t
};

/// The parameter-list machine's registers (`$sig*` globals in `sig.wat`).
#[derive(Default)]
struct Sig {
    parens: u32,
    mask: u32,
    obscure: u32,
    pattern: bool,
}

impl Sig {
    /// The innermost open paren is a marked parameter list (`$sigActive`).
    #[inline(always)]
    fn active(&self) -> bool {
        self.parens < 32 && (self.mask >> self.parens) & 1 != 0
    }

    /// Mark the innermost paren as a parameter list (`$sigMark`).
    #[inline(always)]
    fn mark(&mut self) {
        if self.parens < 32 {
            self.mask |= 1 << self.parens;
        }
        self.obscure = 0;
        self.pattern = false;
    }

    /// Unmark the innermost paren (`$sigUnmark`).
    #[inline(always)]
    fn unmark(&mut self) {
        if self.parens < 32 {
            self.mask &= !(1 << self.parens);
        }
        self.obscure = 0;
        self.pattern = false;
    }
}

/// Lex the Zig input of `len` bytes at `base` (`$hlZig`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: `base..base + len + SLACK` lies inside lexer memory, which
    // nothing moves while this lexer runs (it calls no translated code).
    let src = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut sig = Sig::default();
    let mut recs = Recs::load(inst);

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src.bytes(), 0, end);
    recs.gap(0, ptr);
    // Leading whitespace; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    recs.gap(ptr, first);
    ptr = first;

    // the next name is a type (after an annotation `:`)
    let mut expect_type = false;
    // after `const`/`var`: the next name is the declared variable
    let mut expect_var = false;
    // the [`ctx`] flags
    let mut flags = 0u32;
    let mut paren_depth = 0u32;
    // inside a `|...|` payload capture
    let mut payload = false;
    // the parens (by depth) whose close may be followed by a payload
    let mut payload_parens = 0u64;
    let mut prev_dot = false;

    // The context flags the token at `ptr`, whose first byte is `c`, keeps
    // (`$hlZig`: context may cross whitespace and comments, but not another
    // token; an armed fn head expects its parameter paren immediately).
    macro_rules! resets {
        ($c:expr) => {{
            let c: u8 = $c;
            if flags != 0 {
                let mut keep = KEEP[c as usize] as u32;
                // SAFETY: `ptr` is at or before the input end, so the byte
                // after it lies inside the slack.
                let next = unsafe { src.byte_unchecked(ptr + 1) };
                if c == b'@' && next == b'"' {
                    keep |= ctx::EXPECT_FUNC | ctx::EXPECT_LABEL;
                }
                if c == b'|' && next != b'|' && next != b'=' {
                    keep |= ctx::PAYLOAD_READY;
                }
                flags &= keep;
            }
        }};
    }
    // The bracket `c` at `ptr`.
    macro_rules! bracket {
        ($c:expr) => {{
            let c: u8 = $c;
            if c == b'(' {
                paren_depth = paren_depth.wrapping_add(1);
                if flags & ctx::WANT_PAYLOAD_PAREN != 0 {
                    payload_parens |= 1u64.wrapping_shl(paren_depth);
                }
                flags &= !(ctx::WANT_PAYLOAD_PAREN | ctx::EXPECT_FUNC);
                // the paren may open the armed fn list and puts the next
                // name in parameter position
                sig.parens = sig.parens.wrapping_add(1);
                if flags & ctx::FN_PEND != 0 {
                    sig.mark();
                }
                flags &= !ctx::FN_PEND;
                sig.pattern = true;
            }
            if c == b')' && paren_depth != 0 {
                if payload_parens.wrapping_shr(paren_depth) & 1 != 0 {
                    flags |= ctx::PAYLOAD_READY;
                } else {
                    flags &= !ctx::PAYLOAD_READY;
                }
                payload_parens &= !1u64.wrapping_shl(paren_depth);
                paren_depth -= 1;
            }
            if c != b'(' {
                sig.pattern = false;
                if c == b')' {
                    if sig.active() {
                        sig.unmark();
                    }
                    if sig.parens > 0 {
                        sig.parens -= 1;
                    }
                } else if sig.active() {
                    if c == b'[' || c == b'{' {
                        sig.obscure = sig.obscure.wrapping_add(1);
                    } else if sig.obscure > 0 {
                        sig.obscure -= 1;
                    }
                }
            }
            ptr += 1;
            recs.tok(tok::PUNCTUATION_BRACKET, ptr);
            prev_dot = false;
        }};
    }
    // The `.` at `ptr`: `...`, `..`, `.*`, `.?`, or a member access.
    macro_rules! dot {
        () => {{
            // SAFETY: the `.` at `ptr` lies inside the input, and the
            // second read follows a `.` at `ptr + 1`.
            let p = unsafe { src.byte_unchecked(ptr + 1) };
            if p == b'.' && unsafe { src.byte_unchecked(ptr + 2) } == b'.' {
                ptr += 3;
                recs.tok(tok::VARIABLE_SPECIAL, ptr);
                prev_dot = false;
            } else if p == b'.' || p == b'*' || p == b'?' {
                ptr += 2;
                recs.tok(tok::OPERATOR, ptr);
                prev_dot = false;
            } else {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                prev_dot = true;
                sig.pattern = false;
            }
        }};
    }
    // The `;`, `,`, or `:` delimiter `c` at `ptr`.
    macro_rules! delimiter {
        ($c:expr) => {{
            let c: u8 = $c;
            if c == b':' {
                if flags & ctx::WANT_BREAK_LABEL != 0 {
                    flags = (flags | ctx::EXPECT_LABEL) & !ctx::WANT_BREAK_LABEL;
                } else if flags & ctx::LABEL_COLON == 0
                    // SAFETY: the NUL at the input end stops the spaces.
                    && unsafe { src.byte_unchecked(skip_space_at(src, ptr + 1)) } != b'('
                {
                    // `: (` opens a while loop's continue expression,
                    // not a type annotation
                    expect_type = true;
                }
            }
            flags &= !ctx::LABEL_COLON;
            ptr += 1;
            recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
            prev_dot = false;
            // a comma returns to parameter position; a top-level `;`
            // proves the marked list was not a parameter list after all
            sig.pattern = c == b',';
            if c == b';' && sig.active() && sig.obscure == 0 {
                sig.unmark();
            }
        }};
    }

    // `ptr` never passes the input end: every scan stops at the NUL there.
    loop {
        // SAFETY: `ptr` is at or before the input end (see above).
        let s = unsafe { src.byte_unchecked(ptr) };
        // SAFETY: as above.
        if s == b' ' && !is_space(unsafe { src.byte_unchecked(ptr + 1) }) {
            // one space
            ptr += 1;
            recs.extend(ptr);
        } else if is_space(s) {
            ptr = whitespace_end(src, ptr + 1);
            recs.extend(ptr);
        }
        let lhs = ptr;
        // SAFETY: `ptr` is at or before the input end.
        let c = unsafe { src.byte_unchecked(ptr) };
        let class = CLASS[c as usize];

        // Zig has only line comments. `///` and `//!` are documentation;
        // `////` starts an ordinary line comment (`$lexLineComment`,
        // `$scanToLineEnd`).
        // SAFETY: `ptr` is at or before the input end.
        if class == class::SLASH && unsafe { src.byte_unchecked(ptr + 1) } == b'/' {
            // SAFETY: `//` lies inside the input.
            let q = unsafe { src.byte_unchecked(ptr + 2) };
            let hl = if q == b'!' || (q == b'/' && byte(src, ptr + 3, end) != b'/') {
                tok::COMMENT_DOC
            } else {
                tok::COMMENT
            };
            ptr = scan::line_end(src.bytes(), ptr + 2, end);
            recs.tok(hl, ptr);
            continue;
        }

        resets!(c);

        match class {
            class::IDENT => {
                ptr = ident_end(src, ptr + 1);
                let v = word_hl(src, lhs, ptr);
                if v >= 0 {
                    // the table group rides in the high byte
                    let word = v >> 8;
                    let hl = (v & 255) as u32;
                    match word {
                        1 => flags |= ctx::EXPECT_FUNC,
                        2 => expect_var = true,
                        4 | 5 => flags |= ctx::WANT_PAYLOAD_PAREN,
                        7 => flags |= ctx::WANT_BREAK_LABEL,
                        8 => flags |= ctx::PAYLOAD_READY,
                        _ => {}
                    }
                    recs.tok(hl, ptr);
                    prev_dot = false;
                    if hl == tok::TYPE_BUILTIN || hl == tok::CONSTANT_BUILTIN {
                        expect_type = false;
                    }
                    continue;
                }
                let p = skip_space_at(src, ptr);
                // the byte after the name's blanks
                // SAFETY: the NUL at the input end stops the blanks.
                let q = unsafe { src.byte_unchecked(p) };
                let mut hl = tok::VARIABLE;
                if flags & ctx::EXPECT_FUNC != 0 {
                    hl = tok::FUNCTION_DEFINITION;
                    // an fn name arms the parameter machine for its paren
                    flags |= ctx::FN_PEND;
                }
                if flags & ctx::EXPECT_LABEL != 0 {
                    hl = tok::LABEL;
                }
                if expect_type {
                    hl = tok::TYPE;
                }
                if prev_dot {
                    hl = if q == b'(' {
                        tok::FUNCTION_METHOD
                    } else {
                        tok::PROPERTY
                    };
                }
                if hl == tok::VARIABLE && q == b'(' {
                    hl = tok::FUNCTION;
                }
                if hl == tok::VARIABLE && is_upper(c) {
                    hl = if is_const_case(src, lhs, ptr) {
                        tok::CONSTANT
                    } else {
                        tok::TYPE
                    };
                }
                // Container fields are properties; block/loop prefixes are
                // labels. A name right after `..` or `[` is a slice or array
                // sentinel, neither field nor label.
                if (!expect_var || sig.active()) && q == b':' && {
                    let b = line_byte_before(src, lhs);
                    b != b'.' && b != b'['
                } {
                    let mut q = skip_space_at(src, p + 1);
                    let mut inline = false;
                    let mut word = 0;
                    // only a top-level `name:` can be a label
                    if paren_depth == 0 && is_ident_start(src.byte(q)) {
                        let e = ident_end(src, q);
                        word = word_group(src, q, e);
                        if word == 15 {
                            inline = true;
                            q = skip_space_at(src, e);
                            if is_ident_start(src.byte(q)) {
                                let e = ident_end(src, q);
                                word = word_group(src, q, e);
                            }
                        }
                    }
                    if paren_depth == 0
                        && (src.byte(q) == b'{' || word == 5 || (!inline && word == 6))
                    {
                        hl = tok::LABEL;
                        flags |= ctx::LABEL_COLON;
                    } else if paren_depth == 0 {
                        hl = tok::PROPERTY;
                    } else if sig.active() && sig.pattern && sig.obscure == 0 {
                        // an annotated name at the top level of a marked fn
                        // list is a parameter
                        hl = tok::VARIABLE_PARAMETER;
                    }
                }
                // ZON's bare nan/inf values
                if hl == tok::VARIABLE
                    && !expect_var
                    && ptr - lhs == 3
                    // SAFETY: the name `[lhs, ptr)` lies inside the input.
                    && unsafe {
                        word_at(src, lhs, 3) == word(b"nan") || word_at(src, lhs, 3) == word(b"inf")
                    }
                {
                    hl = tok::NUMBER;
                }
                recs.tok(hl, ptr);
                flags &= !(ctx::EXPECT_FUNC | ctx::EXPECT_LABEL);
                expect_type = false;
                expect_var = false;
                prev_dot = false;
                // a name consumes parameter position
                sig.pattern = false;
                // A bracket, delimiter, or `.` right after the name: its
                // rules run here, without the gap and dispatch steps.
                // SAFETY: the name ends at or before the input end.
                let n = unsafe { src.byte_unchecked(ptr) };
                match CLASS[n as usize] {
                    class::BRACKET => {
                        resets!(n);
                        bracket!(n);
                    }
                    class::DELIMITER => {
                        resets!(n);
                        delimiter!(n);
                    }
                    class::DOT => {
                        resets!(n);
                        dot!();
                    }
                    _ => {}
                }
            }
            // SAFETY (the guards' `ptr + 1` reads): `ptr` is at or before
            // the input end, so the byte after it lies inside the slack.
            class::BACKSLASH if unsafe { src.byte_unchecked(ptr + 1) } == b'\\' => {
                // each `\\` line is one segment of a raw multiline string
                ptr = scan::line_end(src.bytes(), ptr + 2, end);
                recs.tok(tok::STRING, ptr);
                prev_dot = false;
            }
            class::QUOTE => {
                // A one-line literal without escapes is one token; anything
                // else takes the full rules.
                let close = scan::string_special(src.bytes(), ptr + 1, end, c);
                // SAFETY: the scan stops at the input end at the latest.
                if unsafe { src.byte_unchecked(close) } == c {
                    ptr = close + 1;
                    recs.tok(tok::STRING, ptr);
                } else {
                    (recs, ptr) = string(src, recs, ptr, end, c, tok::STRING, ptr);
                }
                prev_dot = false;
                expect_type = false;
            }
            class::AT if unsafe { src.byte_unchecked(ptr + 1) } == b'"' => {
                // quoted identifiers keep declaration, label, and member
                // context
                let mut hl = tok::VARIABLE;
                if flags & ctx::EXPECT_FUNC != 0 {
                    hl = tok::FUNCTION_DEFINITION;
                    flags |= ctx::FN_PEND;
                }
                if flags & ctx::EXPECT_LABEL != 0 {
                    hl = tok::LABEL;
                }
                if expect_type {
                    hl = tok::TYPE;
                }
                if prev_dot {
                    hl = tok::PROPERTY;
                }
                (recs, ptr) = string(src, recs, ptr + 1, end, b'"', hl, lhs);
                flags &= !(ctx::EXPECT_FUNC | ctx::EXPECT_LABEL);
                expect_type = false;
                expect_var = false;
                prev_dot = false;
            }
            class::AT if is_ident_start(unsafe { src.byte_unchecked(ptr + 1) }) => {
                // builtin identifiers are functions, except import primitives
                ptr = ident_end(src, ptr + 2);
                let n = ptr - lhs;
                // SAFETY: the name `[lhs, ptr)` lies inside the input.
                let hl = if unsafe {
                    (n == 7 && word_at(src, lhs, 7) == word(b"@import"))
                        || (n == 8 && word_at(src, lhs, 8) == word(b"@cImport"))
                } {
                    tok::KEYWORD_IMPORT
                } else {
                    tok::FUNCTION
                };
                recs.tok(hl, ptr);
                expect_type = false;
                prev_dot = false;
            }
            class::DIGIT => {
                ptr = number_end(src, ptr);
                recs.tok(tok::NUMBER, ptr);
                prev_dot = false;
                expect_type = false;
            }
            class::BRACKET => bracket!(c),
            class::ARROW if unsafe { src.byte_unchecked(ptr + 1) } == b'>' => {
                // arrows are delimiters in Zig's highlight query
                ptr += 2;
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                if c == b'=' {
                    flags |= ctx::PAYLOAD_READY;
                }
                prev_dot = false;
            }
            class::DOT => dot!(),
            class::DELIMITER => delimiter!(c),
            class::PIPE
                if payload
                    || (flags & ctx::PAYLOAD_READY != 0
                        && unsafe { src.byte_unchecked(ptr + 1) } != b'|'
                        && unsafe { src.byte_unchecked(ptr + 1) } != b'=') =>
            {
                // payload captures use bracket-colored bars
                ptr += 1;
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
                payload = !payload;
                flags &= !ctx::PAYLOAD_READY;
                prev_dot = false;
            }
            class::OP | class::PIPE | class::ARROW | class::SLASH => {
                ptr = op_end(src, ptr, end);
                recs.tok(tok::OPERATOR, ptr);
                prev_dot = false;
            }
            class::NUL if ptr >= end => break,
            _ => {
                // invalid bytes remain lossless and always advance
                ptr += 1;
                recs.tok(tok::NONE, ptr);
                prev_dot = false;
            }
        }
    }
    recs.store(inst);
}
