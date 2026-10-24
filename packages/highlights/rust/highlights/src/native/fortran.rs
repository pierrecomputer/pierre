//! WAT sources: src/langs/fortran.wat src/common.wat src/scan.wat
//!
//! Native Fortran highlighter for free-form and fixed-form sources (a
//! compile-time dialect flag picks fixed form's column-one comments). One
//! pass over the input, with the same rules, in the same order, as the
//! translated `$hlFortranImpl`: whitespace, line breaks, and the bodies of
//! strings are steps of the token loop, as in the WAT, so a string can
//! continue across lines. The records equal the translated lexers'
//! records.

use super::Lexer;
use super::scan;
use super::tables::byteset;
use crate::Rec;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::FORTRAN_WORDS;

/// The lexer for each language this module handles.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "fortran" => Some(free_form),
        "fortran-fixed-form" => Some(fixed_form),
        _ => None,
    }
}

/// Free-form Fortran (`$hlFortran`).
fn free_form(inst: &mut Instance, base: usize, len: usize) {
    highlight::<false>(inst, base, len);
}

/// Fixed-form Fortran (`$hlFortranFixed`).
fn fixed_form(inst: &mut Instance, base: usize, len: usize) {
    highlight::<true>(inst, base, len);
}

/// `$fortranWords` and the words `$fortranWordHl` matches before the table
/// (`where`, `inquire`, `endfile`), all lowercase, as a perfect hash on a
/// word's bytes: an index of entry numbers and the entries' keys and
/// values. A word of up to 16 bytes is two little-endian integers, `lo`
/// (bytes 0-7) and `hi` (bytes 8-15), zero past its end; identifiers hold
/// no NUL, so equal integers mean equal words.
struct Words {
    /// Entry number plus one for each hash slot, or 0 for no word.
    index: [u8; WORD_SLOTS],
    keys: [(u64, u64); 256],
    /// The word's `keyword-table.value`.
    values: [u16; 256],
    mul: u64,
}

const WORD_SLOTS: usize = 4096;

/// The longest word.
const WORD_MAX: usize = 16;

/// The words `$fortranWordHl` matches before the table, with their values.
const EXTRA_WORDS: [(&[u8], u32); 3] = [
    (b"where", tok::KEYWORD_CONTROL),
    (b"inquire", tok::FUNCTION),
    (b"endfile", tok::FUNCTION),
];

/// Entry `i` of [`FORTRAN_WORDS`] followed by [`EXTRA_WORDS`].
const fn word_entry(i: usize) -> (&'static [u8], i32) {
    if i < FORTRAN_WORDS.len() {
        (FORTRAN_WORDS[i].word, FORTRAN_WORDS[i].value)
    } else {
        let (w, v) = EXTRA_WORDS[i - FORTRAN_WORDS.len()];
        (w, v as i32)
    }
}

/// The slot of the word whose integers are `lo` and `hi`.
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

/// The words, placed by searching for a multiplier that gives each its own
/// slot.
static WORDS: Words = {
    let count = FORTRAN_WORDS.len() + EXTRA_WORDS.len();
    assert!(count < 256);
    let mut keys = [(0u64, 0u64); 256];
    let mut values = [0u16; 256];
    let mut i = 0;
    while i < count {
        let (w, value) = word_entry(i);
        assert!(w.len() <= WORD_MAX && value >= 0 && value < 0x10000);
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
        while i < count {
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

/// `w` with its ASCII uppercase letters lowered (`$lexLowerCopy`).
#[inline(always)]
const fn lower(w: u64) -> u64 {
    let t = w & 0x7f7f_7f7f_7f7f_7f7f;
    let ge_a = t + 0x3f3f_3f3f_3f3f_3f3f; // t >= 'A' sets the high bit
    let ge_z1 = t + 0x2525_2525_2525_2525; // t > 'Z' sets the high bit
    let upper = ge_a & !ge_z1 & !w & 0x8080_8080_8080_8080;
    w | upper >> 2
}

/// The value of the word `[lhs, rhs)` compared case-insensitively, or -1
/// (`$fortranWordHl` on a `$lexLowerCopy` copy).
#[inline(always)]
fn word_value(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    if n == 0 || n > WORD_MAX {
        return -1;
    }
    let key = if n <= 8 {
        (lower(word_at(src, lhs, n as u32)), 0)
    } else {
        (
            lower(word_at(src, lhs, 8)),
            lower(word_at(src, lhs + 8, n as u32 - 8)),
        )
    };
    let e = WORDS.index[word_slot(key.0, key.1, WORDS.mul)];
    if e != 0 && WORDS.keys[e as usize - 1] == key {
        WORDS.values[e as usize - 1] as i32
    } else {
        -1
    }
}

/// Byte classes for the dispatch outside strings.
mod class {
    /// An identifier start other than the letters below.
    pub const IDENT: u8 = 0;
    pub const DIGIT: u8 = 1;
    /// LF or CR.
    pub const NEWLINE: u8 = 2;
    /// Space, TAB, VT, or FF.
    pub const SPACE: u8 = 3;
    pub const BANG: u8 = 4;
    pub const STAR: u8 = 5;
    /// `C` or `c`: a fixed-form comment in column one, else a name.
    pub const LETTER_C: u8 = 6;
    pub const HASH: u8 = 7;
    /// `"` or `'`.
    pub const QUOTE: u8 = 8;
    /// A BOZ radix letter: a literal before a quote, else a name.
    pub const BOZ: u8 = 9;
    pub const DOT: u8 = 10;
    /// Anything else: one character, colored by its byte.
    pub const OTHER: u8 = 11;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = match b {
            b'\n' | b'\r' => class::NEWLINE,
            b' ' | 9 | 11 | 12 => class::SPACE,
            b'!' => class::BANG,
            b'*' => class::STAR,
            b'C' | b'c' => class::LETTER_C,
            b'#' => class::HASH,
            b'"' | b'\'' => class::QUOTE,
            b'b' | b'B' | b'o' | b'O' | b'z' | b'Z' => class::BOZ,
            b'.' => class::DOT,
            _ if is_digit(b) => class::DIGIT,
            _ if is_ident_start(b) => class::IDENT,
            _ => class::OTHER,
        };
        c += 1;
    }
    t
};

/// Exponent letters of a Fortran number.
static EXPONENT: [bool; 256] = byteset(b"dDeEqQ");

/// Identifier bytes (`$lexIsIdentContinue`).
static IDENT_CONT: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = is_ident_start(c as u8) || is_digit(c as u8);
        c += 1;
    }
    t
};

/// Name bytes without `$`: `[A-Za-z0-9_]` and bytes from 0x80
/// (`$scanIdentRun` with `_`).
static NAME_CONT: [bool; 256] = {
    let mut t = IDENT_CONT;
    t[b'$' as usize] = false;
    t
};

/// The byte at `i`. Every caller reads at most 16 bytes past the input
/// end, which the 96-byte input slack covers. The byte at the input end is
/// NUL, which matches none of the bytes a lookahead tests.
#[inline(always)]
fn at(src: &[u8], i: usize) -> u8 {
    debug_assert!(i < src.len());
    // SAFETY: `i` lies inside the input or its slack (see above).
    unsafe { *src.get_unchecked(i) }
}

/// The byte at `i`, or 0 at and past `end` (`$fortranByte`).
#[inline(always)]
fn byte(src: &[u8], i: usize, end: usize) -> u8 {
    if i < end { at(src, i) } else { 0 }
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

/// Whether `c` is ASCII whitespace: space or TAB through CR (`$lexIsSpace`).
#[inline(always)]
const fn is_space(c: u8) -> bool {
    c == b' ' || c.wrapping_sub(9) <= 4
}

/// The end of the identifier run from `p` over `cont` bytes
/// (`$scanIdentRun`). The NUL after the input ends every run.
#[inline(always)]
fn run_end(src: &[u8], mut p: usize, cont: &[bool; 256]) -> usize {
    while cont[at(src, p) as usize] {
        p += 1;
    }
    p
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

/// The next byte from `p` that a string body stops at: its `quote`, `&`,
/// CR, or LF; or `end`.
#[inline(always)]
fn string_stop(src: &[u8], mut p: usize, end: usize, quote: u8) -> usize {
    while p < end {
        // SAFETY: `p` lies before the input end, so the 16-byte load stays
        // inside the slack.
        let w = unsafe { V::load(src.as_ptr().add(p)) };
        let k = (w.eq(V::splat(quote)).or(w.eq(V::splat(b'&'))))
            .or(w.eq(V::splat(b'\n')).or(w.eq(V::splat(b'\r'))))
            .first();
        if k < 16 {
            return (p + k).min(end);
        }
        p += 16;
    }
    end
}

/// Skip spaces and tabs from `p` on the current line (`$lexSkipSpaceAt`).
#[inline(always)]
fn skip_space_at(src: &[u8], mut p: usize) -> usize {
    while at(src, p) == b' ' || at(src, p) == b'\t' {
        p += 1;
    }
    p
}

/// The first `n` bytes at `p` as a little-endian integer. Reads 8 bytes,
/// which the input slack allows.
#[inline(always)]
fn word_at(src: &[u8], p: usize, n: u32) -> u64 {
    debug_assert!(p + 8 <= src.len());
    // SAFETY: `p` lies before the input end, so `p + 8` lies inside the
    // slack.
    let w = unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() };
    w & (u64::MAX >> (64 - 8 * n))
}

/// The kind of the fixed-form line at `p` while the previous line left a
/// string open: 1 for a continuation line (columns one to five blank, a
/// mark other than blank or `0` in column six), 2 for a comment line, 3 for
/// a blank line, 0 otherwise (`$fortranFixedLineKind`).
fn fixed_line_kind(src: &[u8], p: usize) -> u32 {
    let c = at(src, p);
    if matches!(c, b'C' | b'c' | b'*' | b'!') {
        return 2;
    }
    if (0..5).all(|i| at(src, p + i) == b' ') {
        let c = at(src, p + 5);
        if !(c == 0 || is_space(c) || c == b'0') {
            return 1;
        }
    }
    let c = at(src, skip_space_at(src, p));
    if c == 0 || c == b'\n' || c == b'\r' {
        3
    } else {
        0
    }
}

/// The end of a Fortran number from `p`: identifier bytes, a `.` unless a
/// `.operator.` follows, and exponent signs (`$hlFortranImpl`'s number
/// rule).
fn number_end(src: &[u8], mut p: usize, end: usize) -> usize {
    let mut prev = 0u8;
    loop {
        let c = at(src, p);
        let c2 = byte(src, p + 1, end);
        let n = byte(src, p + 2, end);
        let take = IDENT_CONT[c as usize]
            || (c == b'.'
                && ((!is_ident_start(c2) || c2 == b'_')
                    || (EXPONENT[c2 as usize] && (is_digit(n) || n == b'+' || n == b'-'))))
            || ((c == b'+' || c == b'-') && EXPONENT[prev as usize]);
        if !take || p >= end {
            return p;
        }
        prev = c;
        p += 1;
    }
}

/// Lex the Fortran input of `len` bytes at `base` (`$hlFortranImpl`);
/// `FIXED` selects fixed form (`$fortranFixed`).
fn highlight<const FIXED: bool>(inst: &mut Instance, base: usize, len: usize) {
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, which is not
    // reallocated while this lexer runs.
    let src: &[u8] = unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) };
    let end = len;

    // Records are written through `cur`, which moves along
    // `inst.ext.recs`'s buffer from `rp` to at most `limit`; `last` is the
    // last record's token, or `u32::MAX`.
    let rp = inst.ext.recs.as_mut_ptr();
    // SAFETY: `len` records are written.
    let mut cur = unsafe { rp.add(inst.ext.recs.len()) };
    // SAFETY: one past the allocation.
    let limit = unsafe { rp.add(inst.ext.recs.capacity()) };
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
    // Append `hl` over `[lhs, rhs)` when it is not empty (`$emitTok`).
    macro_rules! emit_span {
        ($hl:expr, $lhs:expr, $rhs:expr) => {{
            let (lhs, rhs): (usize, usize) = ($lhs, $rhs);
            if lhs < rhs {
                emit!($hl, rhs);
            }
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
    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src, 0, end);
    gap!(0, ptr);

    // The line comment from `ptr`, colored `hl` (`$lexLineComment` with
    // one byte skipped, `$scanToLineEnd`).
    macro_rules! line_comment {
        ($hl:expr) => {{
            ptr = scan::line_end(src, (ptr + 1).min(end), end);
            emit!($hl, ptr);
        }};
    }

    // where the current line starts: a token there is in column one
    let mut line_start = ptr;
    // the next name defines a routine (1) or names a module (2)
    let mut expect = 0u32;
    // after `%`
    let mut member = false;
    // the quote of an open string, or 0
    let mut quote = 0u8;
    // 1 after a free-form `&` inside a string; 2 after a fixed-form line
    // ended inside a string
    let mut continued = 0u32;

    while ptr < end {
        let mut lhs = ptr;
        let c = at(src, lhs);
        let c2 = at(src, lhs + 1);
        // A fixed-form line after an unterminated string: a nonblank,
        // non-zero column six continues the statement, so the string
        // resumes at column seven. Comment and blank lines in between leave
        // the question open; any other line means the string ended with the
        // previous one.
        if continued == 2 {
            match fixed_line_kind(src, lhs) {
                1 => {
                    ptr = lhs + 5;
                    gap!(lhs, ptr);
                    lhs = ptr;
                    ptr = lhs + 1;
                    emit!(tok::OPERATOR, ptr);
                    continued = 0;
                    continue;
                }
                2 => {
                    line_comment!(tok::COMMENT);
                    continue;
                }
                0 => {
                    quote = 0;
                    continued = 0;
                }
                _ => {}
            }
        }
        // A string is open, or a continuation pending (`continued` is set
        // only while `quote` is): the WAT's rules for that state.
        if quote != 0 || continued != 0 {
            if c == b'\n' || c == b'\r' {
                ptr = lhs + 1;
                gap!(lhs, ptr);
                line_start = ptr;
                member = false;
                // a string still open at a fixed-form line end may resume on a
                // column-six continuation line; the next line start decides
                if continued == 0 {
                    if FIXED && quote != 0 {
                        continued = 2;
                    } else {
                        quote = 0;
                    }
                }
                continue;
            }
            // The WAT tests `continued` with a bitwise `i32.and` against a 0/1
            // flag, so these whitespace, `!`, and `&` rules apply only when it
            // is 1: after a fixed-form line ended inside a string (2), they
            // fall through to the string body.
            if is_space(c) && (quote == 0 || continued & 1 != 0) {
                ptr = skip_space_at(src, lhs);
                if ptr == lhs {
                    ptr = lhs + 1;
                }
                gap!(lhs, ptr);
                continue;
            }
            if (quote == 0 || continued & 1 != 0) && c == b'!' {
                line_comment!(if c2 == b'$' {
                    tok::PREPROC
                } else {
                    tok::COMMENT
                });
                continue;
            }
            if continued & 1 != 0 && c == b'&' {
                ptr = lhs + 1;
                emit!(tok::OPERATOR, ptr);
                continued = 0;
                continue;
            }
            {
                // (`quote` is set: a string is open)
                debug_assert!(quote != 0);
                continued = 0;
                loop {
                    ptr = string_stop(src, ptr, end, quote);
                    if ptr >= end {
                        break;
                    }
                    let c = at(src, ptr);
                    if c == b'\n' || c == b'\r' {
                        break;
                    }
                    if c == quote {
                        ptr += 1;
                        if at(src, ptr) == quote {
                            ptr += 1;
                        } else {
                            quote = 0;
                            break;
                        }
                    } else {
                        if c == b'&' {
                            let p = skip_space_at(src, ptr + 1);
                            let c2 = at(src, p);
                            if p >= end || c2 == b'!' || c2 == b'\n' || c2 == b'\r' {
                                emit_span!(tok::STRING, lhs, ptr);
                                ptr += 1;
                                emit!(tok::OPERATOR, ptr);
                                lhs = ptr;
                                continued = 1;
                                break;
                            }
                        }
                        ptr += 1;
                    }
                }
                emit_span!(tok::STRING, lhs, ptr);
                continue;
            }
        }
        // No string is open: the remaining rules, each tested only for the
        // bytes that can start it, in the WAT's order.
        match CLASS[c as usize] {
            class::NEWLINE => {
                ptr = lhs + 1;
                gap!(lhs, ptr);
                line_start = ptr;
                member = false;
            }
            class::SPACE => {
                ptr = skip_space_at(src, lhs);
                if ptr == lhs {
                    ptr = lhs + 1;
                }
                gap!(lhs, ptr);
            }
            class::BANG => {
                line_comment!(if c2 == b'$' {
                    tok::PREPROC
                } else {
                    tok::COMMENT
                });
            }
            class::STAR | class::LETTER_C if FIXED && lhs == line_start => {
                line_comment!(tok::COMMENT);
            }
            class::HASH => {
                line_comment!(tok::PREPROC);
            }
            class::QUOTE => {
                quote = c;
                ptr = lhs + 1;
                emit!(tok::STRING, ptr);
            }
            class::BOZ if c2 == b'"' || c2 == b'\'' => {
                // BOZ literals use a radix letter followed by either quote
                // style (`$lexRawString`, `$lexRawStringBody`)
                let close = scan::find3(src, lhs + 2, end, c2, b'\n', b'\r');
                ptr = if close < end && at(src, close) == c2 {
                    close + 1
                } else {
                    close
                };
                emit!(tok::NUMBER, ptr);
            }
            class::DOT if is_ident_start(c2) => {
                let p = lhs + 1;
                ptr = run_end(src, p, &NAME_CONT);
                let hl = if word_value(src, p, ptr) == tok::BOOLEAN as i32 {
                    tok::BOOLEAN
                } else {
                    tok::KEYWORD_OPERATOR
                };
                if at(src, ptr) == b'.' {
                    ptr += 1;
                }
                emit!(hl, ptr);
            }
            class::DIGIT => {
                // D exponents, kind suffixes, and a trailing decimal point
                // are Fortran numbers; a following .operator. stays separate
                ptr = number_end(src, lhs, end);
                emit!(tok::NUMBER, ptr);
            }
            class::DOT if is_digit(c2) => {
                ptr = number_end(src, lhs, end);
                emit!(tok::NUMBER, ptr);
            }
            class::IDENT | class::BOZ | class::LETTER_C => {
                // `$lexScanIdent`
                let rhs = ident_end(src, lhs + 1);
                ptr = rhs;
                let kind = word_value(src, lhs, rhs);
                let mut hl = tok::VARIABLE;
                if member {
                    hl = tok::PROPERTY;
                } else if kind >= 0 {
                    hl = (kind & 255) as u32;
                    if kind >> 8 != 0 {
                        expect = (kind >> 8) as u32;
                    }
                } else if expect != 0 {
                    hl = if expect == 1 {
                        tok::FUNCTION_DEFINITION
                    } else {
                        tok::NAMESPACE
                    };
                    expect = 0;
                } else if at(src, skip_space_at(src, rhs)) == b'(' {
                    hl = tok::FUNCTION;
                }
                emit!(hl, rhs);
                member = false;
            }
            _ => {
                ptr = scan::utf8_span_end(src, lhs + 1, end);
                let hl = match c {
                    b'(' | b')' | b'[' | b']' => tok::PUNCTUATION_BRACKET,
                    b':' | b',' | b';' => tok::PUNCTUATION_DELIMITER,
                    b'+' | b'-' | b'*' | b'/' | b'=' | b'<' | b'>' | b'&' | b'%' => tok::OPERATOR,
                    _ => tok::NONE,
                };
                member = c == b'%';
                emit!(hl, ptr);
            }
        }
    }
    // SAFETY: the records before `cur` are written.
    unsafe { inst.ext.recs.set_len(cur.offset_from(rp) as usize) };
}
