//! WAT sources: src/langs/c.wat src/common.wat src/scan.wat
//!
//! Native C lexer. One pass over the input: each token is scanned and
//! colored in the same step, with the same rules, in the same order, as the
//! translated `$hlC`. The records equal the translated lexer's records.
//!
//! The WAT tests its rules in one chain. Most rules match one first byte,
//! so this lexer dispatches on a byte class and, for each class, tests only
//! the rules that can match it, in the WAT's order.

#[cfg(target_arch = "aarch64")]
use core::arch::aarch64::*;

use super::Lexer;
use super::scan;
use super::tables::byteset;
use crate::Rec;
use crate::generated::Instance;
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
    #[cfg(target_arch = "aarch64")]
    // SAFETY: each 16-byte load starts at or before the NUL after the
    // input, inside the slack.
    unsafe {
        loop {
            let v = vld1q_u8(src.as_ptr().add(p));
            let alpha = vcleq_u8(
                vsubq_u8(vorrq_u8(v, vdupq_n_u8(0x20)), vdupq_n_u8(b'a')),
                vdupq_n_u8(25),
            );
            let digit = vcleq_u8(vsubq_u8(v, vdupq_n_u8(b'0')), vdupq_n_u8(9));
            let extra = vorrq_u8(vceqq_u8(v, vdupq_n_u8(b'_')), vceqq_u8(v, vdupq_n_u8(b'$')));
            let high = vcltzq_s8(vreinterpretq_s8_u8(v));
            let ok = vorrq_u8(vorrq_u8(alpha, digit), vorrq_u8(extra, high));
            let k = scan::first_lane(vmvnq_u8(ok));
            if k < 16 {
                return p + k;
            }
            p += 16;
        }
    }
    #[cfg(not(target_arch = "aarch64"))]
    {
        while is_ident_continue(at(src, p)) {
            p += 1;
        }
        p
    }
}

/// The position just past the next `*/` from `p`, or `end`
/// (`$scanBlockCommentEnd`): each step tests 16 star positions against the
/// bytes after them.
#[inline(always)]
fn block_comment_end(src: &[u8], mut p: usize, end: usize) -> usize {
    #[cfg(target_arch = "aarch64")]
    // SAFETY: each load starts before `end` and reads 17 bytes, inside the
    // input slack.
    unsafe {
        while p < end {
            let a = vld1q_u8(src.as_ptr().add(p));
            let b = vld1q_u8(src.as_ptr().add(p + 1));
            let hit = vandq_u8(vceqq_u8(a, vdupq_n_u8(b'*')), vceqq_u8(b, vdupq_n_u8(b'/')));
            let k = scan::first_lane(hit);
            if k < 16 {
                return (p + k + 2).min(end);
            }
            p += 16;
        }
        end
    }
    #[cfg(not(target_arch = "aarch64"))]
    scan::block_comment_end(src, p, end)
}

/// The nearest byte before `p` on its line that is not a space or tab, or
/// 0 when there is none (`$lexLineByteBefore`).
#[inline(always)]
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

/// The color of the name `[lhs, rhs)` (`$cWordHl`).
#[inline(always)]
fn word_hl(src: &[u8], lhs: usize, rhs: usize) -> u32 {
    // `continue` and the table
    let n = rhs - lhs;
    if n <= WORD_MAX && WORD_LENGTHS[at(src, lhs) as usize] >> n & 1 != 0 {
        let (lo, hi) = if n <= 8 {
            (word_at(src, lhs, n as u32), 0)
        } else {
            (word_at(src, lhs, 8), word_at(src, lhs + 8, n as u32 - 8))
        };
        let s = word_slot(lo, WORDS.mul);
        if WORDS.keys[s] == (lo, hi) {
            return WORDS.values[s] as u32;
        }
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

/// Lex the C input of `len` bytes at `base` (`$hlC`).
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
    // Leading whitespace; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    out.gap(ptr, first);
    ptr = first;

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
        // Names, the most common tokens, skip the jump table.
        if class == class::IDENT {
            ptr = ident_end(src, ptr + 1);
            let next = at(src, ptr);
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
            let hl = word_hl(src, lhs, ptr);
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
                let c2 = at(src, ptr + 1);
                if c2 == b'/' {
                    let c3 = at(src, ptr + 2);
                    ptr = scan::line_end(src, ptr + 2, end);
                    let hl = if c3 == b'/' || c3 == b'!' {
                        tok::COMMENT_DOC
                    } else {
                        tok::COMMENT
                    };
                    out.tok(hl, ptr);
                } else if c2 == b'*' {
                    let c3 = at(src, ptr + 2);
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
                    ptr = scan::line_end(src, ptr + 1, end);
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
            class::DOT if is_digit(at(src, ptr + 1)) => {
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
                    let c = at(src, ptr);
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
fn operator_end(src: &[u8], p: usize, c: u8) -> usize {
    let c2 = at(src, p + 1);
    let mut p = p + 1;
    if c2 == b'=' || (c == c2 && DOUBLES[c as usize]) || (c == b'-' && c2 == b'>') {
        p += 1;
        if (c == b'<' || c == b'>') && at(src, p) == b'=' {
            p += 1;
        }
    }
    p
}
