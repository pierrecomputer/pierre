//! WAT sources: src/langs/erlang.wat src/common.wat src/scan.wat
//!
//! Native Erlang lexer. One pass over the input: each token is scanned and
//! colored in the same step, with the same rules, in the same order, as the
//! translated `$hlErlang`. The records equal the translated lexer's
//! records.
//!
//! The WAT tests its rules in one chain. Each rule matches one first byte,
//! so this lexer dispatches on the first byte and, for each byte, tests
//! only the rules that can match it, in the WAT's order.

#[cfg(target_arch = "aarch64")]
use core::arch::aarch64::*;

use super::Lexer;
use super::scan;
use super::tables::byteset;
use crate::Rec;
use crate::generated::Instance;
use crate::token_ids as tok;
use crate::wat_tables::ERLANG_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "erlang" => Some(highlight),
        _ => None,
    }
}

/// `$erlangWords` as a perfect hash on a word's bytes, holding each word's
/// group (`keyword-table.get`) and value (`keyword-table.value`). A word of
/// up to 16 bytes is two little-endian integers, `lo` (bytes 0-7) and `hi`
/// (bytes 8-15), zero past its end; names hold no NUL, so equal integers
/// mean equal words.
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    groups: [u8; WORD_SLOTS],
    values: [i16; WORD_SLOTS],
    mul: u64,
}

const WORD_SLOTS: usize = 512;

/// The longest word.
const WORD_MAX: usize = 16;

/// The slot of the word with integers `lo` and `hi`. No two words share a
/// slot, so a name is a word only when its integers equal the slot's.
#[inline(always)]
const fn word_slot(lo: u64, hi: u64, mul: u64) -> usize {
    ((lo ^ hi.rotate_left(29)).wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros())) as usize
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
    while i < ERLANG_WORDS.len() {
        let w = ERLANG_WORDS[i].word;
        t[w[0] as usize] |= 1 << w.len();
        i += 1;
    }
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
        let mut groups = [0u8; WORD_SLOTS];
        let mut values = [-1i16; WORD_SLOTS];
        let mut i = 0;
        while i < ERLANG_WORDS.len() {
            let k = &ERLANG_WORDS[i];
            assert!(k.word.len() <= WORD_MAX && k.group > 0);
            let (lo, hi) = word_key(k.word);
            let s = word_slot(lo, hi, mul);
            if keys[s].0 != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            keys[s] = (lo, hi);
            groups[s] = k.group;
            values[s] = k.value as i16;
            i += 1;
        }
        break Words {
            keys,
            groups,
            values,
            mul,
        };
    }
};

/// The first `n` bytes at `p` as a little-endian integer, for comparing
/// short words. Reads 8 bytes, which the input slack allows.
#[inline(always)]
fn word_at(src: &[u8], p: usize, n: usize) -> u64 {
    debug_assert!(p + 8 <= src.len());
    // SAFETY: `p` lies before the input end, so `p + 8` lies inside the
    // slack.
    let w = unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() };
    w & (u64::MAX >> (64 - 8 * n))
}

/// The slot of the name `[lhs, rhs)` in [`WORDS`], if it is a word.
#[inline(always)]
fn word_slot_of(src: &[u8], lhs: usize, rhs: usize) -> Option<usize> {
    let n = rhs - lhs;
    if n > WORD_MAX || WORD_LENGTHS[at(src, lhs) as usize] >> n & 1 == 0 {
        return None;
    }
    let (lo, hi) = if n <= 8 {
        (word_at(src, lhs, n), 0)
    } else {
        (word_at(src, lhs, 8), word_at(src, lhs + 8, n - 8))
    };
    let s = word_slot(lo, hi, WORDS.mul);
    (WORDS.keys[s] == (lo, hi)).then_some(s)
}

/// The token for a bare atom that is a reserved word or a well-known
/// constant, or -1 (`$erlWordHl`).
#[inline(always)]
fn word_hl(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    word_slot_of(src, lhs, rhs).map_or(-1, |s| WORDS.values[s] as i32)
}

/// The word's 1-based group, or 0 (`keyword-table.get $erlangWords`).
#[inline(always)]
fn word_group(src: &[u8], lhs: usize, rhs: usize) -> u8 {
    word_slot_of(src, lhs, rhs).map_or(0, |s| WORDS.groups[s])
}

/// Operator bytes (`$erlIsOp`).
static OP: [bool; 256] = byteset(b"!*+-/<=>|");

/// Bytes that continue an operator run: operators, `.`, and `:`.
static OP_RUN: [bool; 256] = byteset(b"!*+-/<=>|.:");

/// Byte classes for the main dispatch.
mod class {
    /// Anything else: one character colored `none`.
    pub const OTHER: u8 = 0;
    /// An identifier start other than `$`: a letter, `_`, or a byte from
    /// 0x80.
    pub const IDENT: u8 = 1;
    pub const DIGIT: u8 = 2;
    pub const PERCENT: u8 = 3;
    pub const QUOTE: u8 = 4;
    pub const TICK: u8 = 5;
    pub const DOLLAR: u8 = 6;
    pub const QUESTION: u8 = 7;
    pub const HASH: u8 = 8;
    pub const DASH: u8 = 9;
    /// `<` or `>`.
    pub const ANGLE: u8 = 10;
    /// `(`, `)`, `[`, `]`, `{`, or `}`.
    pub const BRACKET: u8 = 11;
    /// `,` or `;`.
    pub const DELIMITER: u8 = 12;
    pub const DOT: u8 = 13;
    pub const COLON: u8 = 14;
    /// Any other operator byte.
    pub const OP: u8 = 15;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 16;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = if is_ident_start(b) && b != b'$' {
            class::IDENT
        } else if is_digit(b) {
            class::DIGIT
        } else {
            match b {
                0 => class::NUL,
                b'%' => class::PERCENT,
                b'"' => class::QUOTE,
                b'\'' => class::TICK,
                b'$' => class::DOLLAR,
                b'?' => class::QUESTION,
                b'#' => class::HASH,
                b'-' => class::DASH,
                b'<' | b'>' => class::ANGLE,
                b'(' | b')' | b'[' | b']' | b'{' | b'}' => class::BRACKET,
                b',' | b';' => class::DELIMITER,
                b'.' => class::DOT,
                b':' => class::COLON,
                _ if OP[c] => class::OP,
                _ => class::OTHER,
            }
        };
        c += 1;
    }
    t
};

/// Coarse byte kinds for the loop top: whitespace, a name start, or
/// anything else. The name test reads this table rather than [`CLASS`] so
/// it stays a branch of its own before the class dispatch.
mod kind {
    pub const OTHER: u8 = 0;
    /// ASCII whitespace (`$lexIsSpace`).
    pub const SPACE: u8 = 1;
    /// [`super::class::IDENT`] other than a variable start.
    pub const NAME: u8 = 2;
    /// A variable start: an uppercase letter or `_`.
    pub const VARIABLE: u8 = 3;
}

/// The [`kind`] of each byte.
static KIND: [u8; 256] = {
    let mut t = [kind::OTHER; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = if is_space(c as u8) {
            kind::SPACE
        } else if (c as u8).wrapping_sub(b'A') <= 25 || c as u8 == b'_' {
            kind::VARIABLE
        } else if CLASS[c] == class::IDENT {
            kind::NAME
        } else {
            kind::OTHER
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
        let b = c as u8;
        t[c] = is_ident_start(b) || is_digit(b);
        c += 1;
    }
    t
};

/// The bytes of a `$scanIdentRun` with the extra byte `x`: `[A-Za-z0-9_]`,
/// bytes from 0x80, and `x`.
const fn run_table(x: u8) -> [bool; 256] {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = b >= 0x80 || (b | 32).wrapping_sub(b'a') <= 25 || is_digit(b) || b == b'_' || b == x;
        c += 1;
    }
    t
}

static RUN_AT: [bool; 256] = run_table(b'@');
static RUN_PLAIN: [bool; 256] = run_table(b'_');

/// The byte at `i`. Every caller reads at most 16 bytes past the input
/// end, which the 96-byte input slack covers. The byte at the input end is
/// NUL, which matches none of the bytes a lookahead tests, so a lookahead
/// one byte past a token needs no bounds check.
#[inline(always)]
fn at(src: &[u8], i: usize) -> u8 {
    debug_assert!(i < src.len());
    // SAFETY: `i` lies inside the input or its slack (see above).
    unsafe { *src.get_unchecked(i) }
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

/// The end of the run from `p` of `[A-Za-z0-9_]`, bytes from 0x80, and the
/// extra byte `X` (`$scanIdentRun`). The NUL after the input ends every
/// run.
#[inline(always)]
fn run_end<const X: u8>(src: &[u8], mut p: usize) -> usize {
    let table = match X {
        b'@' => &RUN_AT,
        _ => &RUN_PLAIN,
    };
    // Most names are short: test a few bytes one by one first.
    for _ in 0..8 {
        if !table[at(src, p) as usize] {
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
            let extra = vorrq_u8(vceqq_u8(v, vdupq_n_u8(b'_')), vceqq_u8(v, vdupq_n_u8(X)));
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
        while table[at(src, p) as usize] {
            p += 1;
        }
        p
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

/// The end of the number at `p`: radix digits, separators, exponents, and
/// suffixes, with `.` only before a digit (`$lexScanNumber`,
/// `$lexScanNumberBody`), then a `base#digits` radix body such as `16#FF`
/// (`$erlScanNumber`).
#[inline(always)]
fn number_end(src: &[u8], mut p: usize) -> usize {
    let hex = at(src, p) == b'0' && at(src, p + 1) | 0x20 == b'x';
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
    if at(src, p) == b'#' && IDENT_CONT[at(src, p + 1) as usize] {
        p = run_end::<b'_'>(src, p + 1);
    }
    p
}

/// The end of the escape at backslash `p`: one character, kept whole when
/// it is UTF-8, and CRLF as one (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(src: &[u8], p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(src, p + 2, end);
    if e == p + 2 && at(src, p + 1) == b'\r' && e < end && at(src, e) == b'\n' {
        e += 1;
    }
    e
}

/// Lex the Erlang input of `len` bytes at `base` (`$hlErlang`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
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
        ($hl:expr, $end:expr) => {{
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
    // A string from `lhs` whose body starts at `p` and ends at the next
    // unescaped `quote` (`$lexString`, `$lexStringBody`): a multiline one
    // runs over line breaks, any other stops before one. Escapes get their
    // own tokens. Returns the end.
    macro_rules! string {
        ($lhs:expr, $p:expr, $quote:expr, $multiline:expr, $hl:expr) => {{
            let quote: u8 = $quote;
            let hl: u32 = $hl;
            let mut seg: usize = $lhs;
            let mut p: usize = $p;
            loop {
                p = if $multiline {
                    scan::find3(src, p, end, quote, b'\\', quote)
                } else {
                    scan::string_special(src, p, end, quote)
                };
                if p >= end {
                    break;
                }
                let d = at(src, p);
                if d == quote {
                    p += 1;
                    break;
                }
                // a raw line break: unterminated, left unconsumed
                if d != b'\\' {
                    break;
                }
                if seg < p {
                    emit!(hl, p);
                }
                let e = escape_end(src, p, end);
                emit!(tok::STRING_ESCAPE, e);
                p = e;
                seg = p;
            }
            if seg < p {
                emit!(hl, p);
            }
            p
        }};
    }

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src, 0, end);
    gap!(0, ptr);
    // the next token would start in column zero, where an atom before `(`
    // heads a function clause and a `-` opens a module attribute
    let mut col0 = true;
    // Leading whitespace; every later gap follows a token's record. A gap
    // that ends with a line break puts the next token in column zero.
    let first = whitespace_end(src, ptr);
    if first > ptr {
        col0 = at(src, first - 1) == b'\n' || at(src, first - 1) == b'\r';
    }
    gap!(ptr, first);
    ptr = first;
    // Whitespace up to `rhs` extends the last record, which exists.
    macro_rules! extend {
        ($rhs:expr) => {{
            debug_assert!(cur > rp);
            // SAFETY: a record precedes every gap after the first token.
            unsafe { (*cur.sub(1)).end = $rhs as u32 };
        }};
    }

    // the capture of the next atom after an attribute or a `#` record
    // prefix: 1 module, 2 type, 3 function, 4 macro
    let mut attr = 0u32;

    loop {
        let mut c = at(src, ptr);
        let mut byte_kind = KIND[c as usize];
        if byte_kind == kind::SPACE {
            if c == b' ' && KIND[at(src, ptr + 1) as usize] != kind::SPACE {
                ptr += 1;
                col0 = false;
            } else {
                ptr = whitespace_end(src, ptr + 1);
                col0 = at(src, ptr - 1) == b'\n' || at(src, ptr - 1) == b'\r';
            }
            extend!(ptr);
            c = at(src, ptr);
            byte_kind = KIND[c as usize];
        }
        let lhs = ptr;
        let at_col0 = col0;
        col0 = false;
        // Names, the most common tokens, skip the jump table.
        if byte_kind >= kind::NAME {
            let rhs = run_end::<b'@'>(src, ptr + 1);
            ptr = rhs;
            // variables start with an uppercase letter or an underscore
            let hl = if byte_kind == kind::VARIABLE {
                let hl = if attr == 4 {
                    tok::CONSTANT
                } else {
                    tok::VARIABLE
                };
                attr = 0;
                hl
            } else if attr != 0 {
                let hl = match attr {
                    2 => tok::TYPE,
                    3 => tok::FUNCTION,
                    4 => tok::CONSTANT,
                    _ => tok::NAMESPACE,
                };
                attr = 0;
                hl
            } else {
                let v = word_hl(src, lhs, rhs);
                if v >= 0 {
                    v as u32
                } else if at(src, skip_space_at(src, rhs)) == b'(' {
                    // `name(` calls
                    if at_col0 {
                        tok::FUNCTION_DEFINITION
                    } else {
                        tok::FUNCTION
                    }
                } else {
                    let n = at(src, rhs);
                    let n2 = at(src, rhs + 1);
                    if n == b'/' && is_digit(n2) {
                        // `name/2` references
                        tok::FUNCTION
                    } else if n == b':' && (n2 == b'\'' || (is_ident_start(n2) && n2 != b'$')) {
                        // `mod:` qualifiers
                        tok::NAMESPACE
                    } else {
                        tok::STRING_SPECIAL_SYMBOL
                    }
                }
            };
            emit!(hl, rhs);
            // `(`, `)`, or `,` right after a name: its rule runs here,
            // without the gap and dispatch steps (`attr` is clear after a
            // name)
            let next = at(src, ptr);
            if next == b'(' || next == b')' {
                ptr += 1;
                emit!(tok::PUNCTUATION_BRACKET, ptr);
            } else if next == b',' {
                ptr += 1;
                emit!(tok::PUNCTUATION_DELIMITER, ptr);
            }
            continue;
        }
        let c2 = at(src, ptr + 1);
        // An operator run from `lhs`: operators, `.`, and `:`, ended early
        // by a binary delimiter `<<` or `>>` after its first byte.
        macro_rules! op_run {
            () => {{
                ptr = lhs + 1;
                while OP_RUN[at(src, ptr) as usize] {
                    let n = at(src, ptr + 1);
                    if (at(src, ptr) == b'<' && n == b'<') || (at(src, ptr) == b'>' && n == b'>') {
                        break;
                    }
                    ptr += 1;
                }
                emit!(tok::OPERATOR, ptr);
                attr = 0;
            }};
        }
        match CLASS[c as usize] {
            class::PERCENT => {
                // `$lexLineComment`
                ptr = scan::line_end(src, ptr + 1, end);
                emit!(tok::COMMENT, ptr);
            }
            class::QUOTE => {
                // strings may span lines; quoted atoms may not
                ptr = string!(lhs, ptr + 1, b'"', true, tok::STRING);
                attr = 0;
            }
            class::TICK => {
                ptr = string!(lhs, ptr + 1, b'\'', false, tok::STRING_SPECIAL_SYMBOL);
                attr = 0;
            }
            class::DOLLAR if c2 >= 32 => {
                // `$c`, `$ ` (the space character), and `$\n` character
                // literals
                ptr = if c2 == b'\\' {
                    escape_end(src, ptr + 1, end)
                } else {
                    scan::utf8_span_end(src, ptr + 2, end)
                };
                emit!(tok::STRING_SPECIAL, ptr);
            }
            class::QUESTION
                if is_ident_start(c2) || (c2 == b'?' && is_ident_start(at(src, ptr + 2))) =>
            {
                // `?MACRO` and `??Stringify`
                ptr += if c2 == b'?' { 2 } else { 1 };
                ptr = run_end::<b'@'>(src, ptr);
                emit!(tok::CONSTANT, ptr);
            }
            class::HASH => {
                // `#name{}` records, `#{}` maps
                ptr += 1;
                emit!(tok::PUNCTUATION_SPECIAL, ptr);
                if is_ident_start(c2) {
                    attr = 2;
                }
            }
            class::DASH if at_col0 && c2.wrapping_sub(b'a') <= 25 => {
                // `-module(...)` and other attributes open a form in
                // column zero
                ptr = run_end::<b'_'>(src, ptr + 1);
                let g = word_group(src, lhs + 1, ptr);
                emit!(
                    if g == 6 {
                        tok::KEYWORD_IMPORT
                    } else {
                        tok::KEYWORD
                    },
                    ptr
                );
                attr = match g {
                    7 => 1,
                    8 => 2,
                    9 => 4,
                    10 => 3,
                    _ => 0,
                };
            }
            class::DIGIT => {
                ptr = number_end(src, ptr);
                emit!(tok::NUMBER, ptr);
            }
            class::ANGLE if c2 == c => {
                // `<<` and `>>` delimit binaries
                ptr += 2;
                emit!(tok::PUNCTUATION_BRACKET, ptr);
            }
            class::BRACKET => {
                ptr += 1;
                emit!(tok::PUNCTUATION_BRACKET, ptr);
                // the `(` of `-module(name)` keeps the pending name
                if c != b'(' {
                    attr = 0;
                }
            }
            class::DELIMITER => {
                ptr += 1;
                emit!(tok::PUNCTUATION_DELIMITER, ptr);
                attr = 0;
            }
            class::DOT if c2 != b'.' => {
                ptr += 1;
                emit!(tok::PUNCTUATION_DELIMITER, ptr);
                attr = 0;
            }
            class::COLON => {
                if c2 == b':' {
                    ptr += 2;
                    emit!(tok::OPERATOR, ptr);
                } else {
                    ptr += 1;
                    emit!(tok::PUNCTUATION_DELIMITER, ptr);
                }
            }
            class::OP | class::DASH | class::ANGLE | class::DOT => op_run!(),
            class::NUL if ptr >= end => break,
            _ => {
                ptr = scan::utf8_span_end(src, ptr + 1, end);
                emit!(tok::NONE, ptr);
            }
        }
    }
    // SAFETY: the records before `cur` are written.
    unsafe { inst.ext.recs.set_len(cur.offset_from(rp) as usize) };
}
