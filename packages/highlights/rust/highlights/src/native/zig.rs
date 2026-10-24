//! WAT sources: src/langs/zig.wat src/common.wat src/scan.wat src/sig.wat
//!
//! Native Zig highlighter. One pass over the input: each token is scanned
//! and colored in the same step, with the same rules, in the same order, as
//! the translated `$hlZig`. The records equal the translated lexer's
//! records.

use super::Lexer;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
use crate::Rec;
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
fn word_find(src: &[u8], lhs: usize, rhs: usize) -> Option<usize> {
    let n = rhs - lhs;
    if n > WORD_MAX || WORD_LENGTHS[at(src, lhs) as usize] >> n & 1 == 0 {
        return None;
    }
    let (lo, hi) = if n <= 8 {
        (word_at(src, lhs, n as u32), 0)
    } else {
        (word_at(src, lhs, 8), word_at(src, lhs + 8, n as u32 - 8))
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
fn word_group(src: &[u8], lhs: usize, rhs: usize) -> u8 {
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

/// The byte at `i`. Every caller reads at most 16 bytes past the input
/// end, which the 96-byte input slack covers. The byte at the input end is
/// NUL, which matches none of the bytes a lookahead tests, so a lookahead
/// one byte past a token needs no bounds check (`$zigByte` returns 0 at
/// and past the end).
#[inline(always)]
fn at(src: &[u8], i: usize) -> u8 {
    debug_assert!(i < src.len());
    // SAFETY: `i` lies inside the input or its slack (see above).
    unsafe { *src.get_unchecked(i) }
}

/// The byte at `i`, or 0 at and past `end` (`$zigByte`), for lookaheads
/// that may start past the NUL.
#[inline(always)]
fn byte(src: &[u8], i: usize, end: usize) -> u8 {
    if i < end { at(src, i) } else { 0 }
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
fn whitespace_end(src: &[u8], mut p: usize) -> usize {
    loop {
        let c = at(src, p);
        if c == b' ' {
            // Skip spaces 8 bytes at a time.
            // SAFETY: `p` lies before the NUL after the input, so the
            // 8-byte read stays inside the slack.
            let w = unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() };
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
fn ident_end(src: &[u8], mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..4 {
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
fn skip_space_at(src: &[u8], mut p: usize) -> usize {
    while at(src, p) == b' ' || at(src, p) == b'\t' {
        p += 1;
    }
    p
}

/// The nearest byte before `p` on its line that is not a space or tab, or
/// 0 (`$lexLineByteBefore`; the input starts at offset 0).
fn line_byte_before(src: &[u8], mut p: usize) -> u8 {
    while p > 0 {
        p -= 1;
        let c = at(src, p);
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
fn is_const_case(src: &[u8], lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = false;
    for p in lhs..rhs {
        let c = at(src, p);
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
#[inline(always)]
fn word_at(src: &[u8], p: usize, n: u32) -> u64 {
    debug_assert!(p + 8 <= src.len());
    // SAFETY: `p` lies before the input end, so `p + 8` lies inside the
    // slack.
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

/// The color of the name `[lhs, rhs)` with its table group in bits 8 and
/// up, or -1 for a plain name. `c`, `_`, `comptime`, and arbitrary-width
/// `iN`/`uN` names are matched outside the table (`$zigWordHl`).
#[inline(always)]
fn word_hl(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    if let Some(s) = word_find(src, lhs, rhs) {
        return WORDS.values[s] as i32;
    }
    let first = at(src, lhs);
    // (a one-byte `i` or `u` is a plain name)
    if (first == b'i' || first == b'u') && rhs - lhs > 1 {
        return int_type(src, lhs, rhs);
    }
    -1
}

/// `iN`/`uN` with a width up to 65535 is a primitive type, otherwise a
/// plain name (`$zigWordHl`).
fn int_type(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    let mut width = 0u32;
    for p in lhs + 1..rhs {
        let c = at(src, p);
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
fn scan_digits(src: &[u8], mut p: usize, base: u32) -> usize {
    let start = p;
    loop {
        let c = at(src, p);
        if is_digit_for_base(c, base) {
            p += 1;
            continue;
        }
        if p == start || c != b'_' || !is_digit_for_base(at(src, p + 1), base) {
            return p;
        }
        p += 1;
    }
}

/// The end of the number at `lhs` (`$hlZig`'s number rule).
fn number_end(src: &[u8], lhs: usize) -> usize {
    let mut base = 10;
    if at(src, lhs) == b'0' {
        base = match at(src, lhs + 1) {
            b'b' => 2,
            b'o' => 8,
            b'x' => 16,
            _ => 10,
        };
    }
    let mut ptr;
    if base != 10 && is_digit_for_base(at(src, lhs + 2), base) {
        ptr = scan_digits(src, lhs + 2, base);
    } else {
        base = 10;
        ptr = scan_digits(src, lhs, 10);
    }
    if (base == 10 || base == 16)
        && at(src, ptr) == b'.'
        && is_digit_for_base(at(src, ptr + 1), base)
    {
        ptr = scan_digits(src, ptr + 1, base);
    }
    let c = at(src, ptr) | 32;
    if (base == 10 && c == b'e') || (base == 16 && c == b'p') {
        let mut p = ptr + 1;
        if at(src, p) == b'+' || at(src, p) == b'-' {
            p += 1;
        }
        if is_digit(at(src, p)) {
            ptr = scan_digits(src, p, 10);
        }
    }
    ptr
}

/// The end of at most `max` hex digits from `p`, bounded by `end`
/// (`$scanHexRun`).
#[inline(always)]
fn hex_run_end(src: &[u8], mut p: usize, max: usize, end: usize) -> usize {
    let stop = (p + max).min(end);
    while p < stop && is_hex(at(src, p)) {
        p += 1;
    }
    p
}

/// The end of the operator run at `p`: operators glue together except
/// before `->`, `=>`, or `//` (`$hlZig`'s operator rule).
fn op_end(src: &[u8], mut ptr: usize, end: usize) -> usize {
    loop {
        let c = at(src, ptr);
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
        if !(ptr < end && OPS[at(src, ptr) as usize]) {
            return ptr;
        }
    }
}

/// The single-line string, code-point literal, or quoted identifier body
/// whose `quote` is at `p`, colored `hl`, with escapes as their own tokens;
/// `seg` starts the pending token. Returns the end (`$zigString`).
#[inline(never)]
fn string(
    src: &[u8],
    mut recs: Recs,
    p: usize,
    end: usize,
    quote: u8,
    hl: u32,
    mut seg: usize,
) -> (Recs, usize) {
    let mut p = p + 1;
    loop {
        p = scan::string_special(src, p, end, quote);
        if p >= end {
            break;
        }
        let c = at(src, p);
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
            let c = at(src, e);
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
        e = scan::utf8_span_end(src, e, end);
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
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, which is not
    // reallocated while this lexer runs.
    let src: &[u8] = unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) };
    let end = len;
    let mut sig = Sig::default();

    // Records are written through `cur`, which moves along
    // `inst.ext.recs`'s buffer from `rp` to at most `limit`; `last` is the
    // last record's token, or `u32::MAX`.
    let mut rp = inst.ext.recs.as_mut_ptr();
    // SAFETY: `len` records are written.
    let mut cur = unsafe { rp.add(inst.ext.recs.len()) };
    // SAFETY: one past the allocation.
    let mut limit = unsafe { rp.add(inst.ext.recs.capacity()) };
    let mut last = inst.ext.recs.last().map_or(u32::MAX, |r| r.token);
    // Append a non-empty token ending at `end`, merging it into the last
    // record when the token matches (`$emitTok`). Running out of room
    // means a lexer bug, which traps.
    macro_rules! emit {
        ($hl:expr, $end:expr $(,)?) => {{
            let hl: u32 = $hl;
            // SAFETY: `cur` stays within `rp..limit`; a merge rewrites the
            // last record.
            unsafe {
                cur = cur.sub((last == hl) as usize);
                if cur == limit {
                    crate::rt::trap();
                }
                cur.write(Rec {
                    end: $end as u32,
                    token: hl,
                });
                cur = cur.add(1);
            }
            last = hl;
        }};
    }
    // Whitespace `[lhs, rhs)` extends the last record (`$emitGap`).
    macro_rules! gap {
        ($lhs:expr, $rhs:expr) => {{
            let (lhs, rhs): (usize, usize) = ($lhs, $rhs);
            if lhs < rhs {
                if cur == rp {
                    emit!(tok::NONE, rhs);
                } else {
                    // SAFETY: the record before `cur` is written.
                    unsafe { (*cur.sub(1)).end = rhs as u32 };
                }
            }
        }};
    }
    // Whitespace up to `rhs` extends the last record, which exists.
    macro_rules! extend {
        ($rhs:expr) => {{
            debug_assert!(cur > rp);
            // SAFETY: a record precedes every gap after the first token.
            unsafe { (*cur.sub(1)).end = $rhs as u32 };
        }};
    }
    // Run an out-of-line helper that writes its records through `Recs`.
    macro_rules! with_recs {
        (|$recs:ident| $call:expr) => {{
            // SAFETY: the records before `cur` are written.
            unsafe { inst.ext.recs.set_len(cur.offset_from(rp) as usize) };
            let $recs = Recs::load(inst);
            let ($recs, p) = $call;
            $recs.store(inst);
            rp = inst.ext.recs.as_mut_ptr();
            // SAFETY: `len` records are written.
            cur = unsafe { rp.add(inst.ext.recs.len()) };
            // SAFETY: one past the allocation.
            limit = unsafe { rp.add(inst.ext.recs.capacity()) };
            last = inst.ext.recs.last().map_or(u32::MAX, |r| r.token);
            p
        }};
    }

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src, 0, end);
    gap!(0, ptr);
    // Leading whitespace; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    gap!(ptr, first);
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
                if c == b'@' && at(src, ptr + 1) == b'"' {
                    keep |= ctx::EXPECT_FUNC | ctx::EXPECT_LABEL;
                }
                if c == b'|' && at(src, ptr + 1) != b'|' && at(src, ptr + 1) != b'=' {
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
            emit!(tok::PUNCTUATION_BRACKET, ptr);
            prev_dot = false;
        }};
    }
    // The `.` at `ptr`: `...`, `..`, `.*`, `.?`, or a member access.
    macro_rules! dot {
        () => {{
            let p = at(src, ptr + 1);
            if p == b'.' && at(src, ptr + 2) == b'.' {
                ptr += 3;
                emit!(tok::VARIABLE_SPECIAL, ptr);
                prev_dot = false;
            } else if p == b'.' || p == b'*' || p == b'?' {
                ptr += 2;
                emit!(tok::OPERATOR, ptr);
                prev_dot = false;
            } else {
                ptr += 1;
                emit!(tok::PUNCTUATION_DELIMITER, ptr);
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
                    && at(src, skip_space_at(src, ptr + 1)) != b'('
                {
                    // `: (` opens a while loop's continue expression,
                    // not a type annotation
                    expect_type = true;
                }
            }
            flags &= !ctx::LABEL_COLON;
            ptr += 1;
            emit!(tok::PUNCTUATION_DELIMITER, ptr);
            prev_dot = false;
            // a comma returns to parameter position; a top-level `;`
            // proves the marked list was not a parameter list after all
            sig.pattern = c == b',';
            if c == b';' && sig.active() && sig.obscure == 0 {
                sig.unmark();
            }
        }};
    }

    loop {
        let s = at(src, ptr);
        if s == b' ' && !is_space(at(src, ptr + 1)) {
            // one space
            ptr += 1;
            extend!(ptr);
        } else if is_space(s) {
            ptr = whitespace_end(src, ptr + 1);
            extend!(ptr);
        }
        let lhs = ptr;
        let c = at(src, ptr);
        let class = CLASS[c as usize];

        // Zig has only line comments. `///` and `//!` are documentation;
        // `////` starts an ordinary line comment (`$lexLineComment`,
        // `$scanToLineEnd`).
        if class == class::SLASH && at(src, ptr + 1) == b'/' {
            let q = at(src, ptr + 2);
            let hl = if q == b'!' || (q == b'/' && byte(src, ptr + 3, end) != b'/') {
                tok::COMMENT_DOC
            } else {
                tok::COMMENT
            };
            ptr = scan::line_end(src, ptr + 2, end);
            emit!(hl, ptr);
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
                    emit!(hl, ptr);
                    prev_dot = false;
                    if hl == tok::TYPE_BUILTIN || hl == tok::CONSTANT_BUILTIN {
                        expect_type = false;
                    }
                    continue;
                }
                let p = skip_space_at(src, ptr);
                // the byte after the name's blanks
                let q = at(src, p);
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
                    if paren_depth == 0 && is_ident_start(at(src, q)) {
                        let e = ident_end(src, q);
                        word = word_group(src, q, e);
                        if word == 15 {
                            inline = true;
                            q = skip_space_at(src, e);
                            if is_ident_start(at(src, q)) {
                                let e = ident_end(src, q);
                                word = word_group(src, q, e);
                            }
                        }
                    }
                    if paren_depth == 0
                        && (at(src, q) == b'{' || word == 5 || (!inline && word == 6))
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
                    && (word_at(src, lhs, 3) == word(b"nan")
                        || word_at(src, lhs, 3) == word(b"inf"))
                {
                    hl = tok::NUMBER;
                }
                emit!(hl, ptr);
                flags &= !(ctx::EXPECT_FUNC | ctx::EXPECT_LABEL);
                expect_type = false;
                expect_var = false;
                prev_dot = false;
                // a name consumes parameter position
                sig.pattern = false;
                // A bracket, delimiter, or `.` right after the name: its
                // rules run here, without the gap and dispatch steps.
                let n = at(src, ptr);
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
            class::BACKSLASH if at(src, ptr + 1) == b'\\' => {
                // each `\\` line is one segment of a raw multiline string
                ptr = scan::line_end(src, ptr + 2, end);
                emit!(tok::STRING, ptr);
                prev_dot = false;
            }
            class::QUOTE => {
                // A one-line literal without escapes is one token; anything
                // else takes the full rules.
                let close = scan::string_special(src, ptr + 1, end, c);
                if at(src, close) == c {
                    ptr = close + 1;
                    emit!(tok::STRING, ptr);
                } else {
                    ptr = with_recs!(|recs| string(src, recs, ptr, end, c, tok::STRING, ptr));
                }
                prev_dot = false;
                expect_type = false;
            }
            class::AT if at(src, ptr + 1) == b'"' => {
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
                ptr = with_recs!(|recs| string(src, recs, ptr + 1, end, b'"', hl, lhs));
                flags &= !(ctx::EXPECT_FUNC | ctx::EXPECT_LABEL);
                expect_type = false;
                expect_var = false;
                prev_dot = false;
            }
            class::AT if is_ident_start(at(src, ptr + 1)) => {
                // builtin identifiers are functions, except import primitives
                ptr = ident_end(src, ptr + 2);
                let n = ptr - lhs;
                let hl = if (n == 7 && word_at(src, lhs, 7) == word(b"@import"))
                    || (n == 8 && word_at(src, lhs, 8) == word(b"@cImport"))
                {
                    tok::KEYWORD_IMPORT
                } else {
                    tok::FUNCTION
                };
                emit!(hl, ptr);
                expect_type = false;
                prev_dot = false;
            }
            class::DIGIT => {
                ptr = number_end(src, ptr);
                emit!(tok::NUMBER, ptr);
                prev_dot = false;
                expect_type = false;
            }
            class::BRACKET => bracket!(c),
            class::ARROW if at(src, ptr + 1) == b'>' => {
                // arrows are delimiters in Zig's highlight query
                ptr += 2;
                emit!(tok::PUNCTUATION_DELIMITER, ptr);
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
                        && at(src, ptr + 1) != b'|'
                        && at(src, ptr + 1) != b'=') =>
            {
                // payload captures use bracket-colored bars
                ptr += 1;
                emit!(tok::PUNCTUATION_BRACKET, ptr);
                payload = !payload;
                flags &= !ctx::PAYLOAD_READY;
                prev_dot = false;
            }
            class::OP | class::PIPE | class::ARROW | class::SLASH => {
                ptr = op_end(src, ptr, end);
                emit!(tok::OPERATOR, ptr);
                prev_dot = false;
            }
            class::NUL if ptr >= end => break,
            _ => {
                // invalid bytes remain lossless and always advance
                ptr += 1;
                emit!(tok::NONE, ptr);
                prev_dot = false;
            }
        }
    }
    // SAFETY: the records before `cur` are written.
    unsafe { inst.ext.recs.set_len(cur.offset_from(rp) as usize) };
}
