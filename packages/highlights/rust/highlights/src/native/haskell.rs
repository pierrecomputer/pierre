//! WAT sources: src/langs/haskell.wat src/common.wat src/scan.wat
//!
//! Native Haskell lexer. One pass over the input: each token is scanned and
//! colored in the same step, with the same rules, in the same order, as the
//! translated `$hlHaskell`. The records equal the translated lexer's
//! records.
//!
//! The WAT tests its rules in one chain. Each rule matches one first byte,
//! so this lexer dispatches on the first byte's class and, for each class,
//! tests only the rules that can match it, in the WAT's order.

use super::Lexer;
use super::scan;
use super::tables::byteset;
use crate::Rec;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::HS_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "haskell" => Some(highlight),
        _ => None,
    }
}

/// `$hsWords` as a perfect hash on a word's bytes: each group's value is
/// its token, plus 256 for `let` and `where`, which prime the next name as
/// a definition. A word of up to 16 bytes is two little-endian integers,
/// `lo` (bytes 0-7) and `hi` (bytes 8-15), zero past its end; names hold no
/// NUL, so equal integers mean equal words.
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    /// The word's `keyword-table.value`.
    values: [u16; WORD_SLOTS],
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
    while i < HS_WORDS.len() {
        let w = HS_WORDS[i].word;
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
        let mut values = [0u16; WORD_SLOTS];
        let mut i = 0;
        while i < HS_WORDS.len() {
            let (w, value) = (HS_WORDS[i].word, HS_WORDS[i].value);
            assert!(w.len() <= WORD_MAX && value > 0 && value < 0x10000);
            let (lo, hi) = word_key(w);
            let s = word_slot(lo, mul);
            if keys[s].0 != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            keys[s] = (lo, hi);
            values[s] = value as u16;
            i += 1;
        }
        break Words { keys, values, mul };
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

/// The keyword value of the name `[lhs, rhs)`, or -1 when it is no word
/// (`keyword-table.value $hsWords`).
#[inline(always)]
fn word_value(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    if n > WORD_MAX || WORD_LENGTHS[at(src, lhs) as usize] >> n & 1 == 0 {
        return -1;
    }
    let (lo, hi) = if n <= 8 {
        (word_at(src, lhs, n), 0)
    } else {
        (word_at(src, lhs, 8), word_at(src, lhs + 8, n - 8))
    };
    let s = word_slot(lo, WORDS.mul);
    if WORDS.keys[s] == (lo, hi) {
        WORDS.values[s] as i32
    } else {
        -1
    }
}

/// Operator symbol bytes (`$hsIsSymbol`).
static SYMBOL: [bool; 256] = byteset(b"!#$%&*+-./:<=>?@\\^|~");

/// Byte classes for the main dispatch.
mod class {
    /// An identifier start other than `$`: a letter, `_`, or a byte from
    /// 0x80.
    pub const IDENT: u8 = 0;
    /// Anything else: one byte colored `none`.
    pub const OTHER: u8 = 1;
    pub const DIGIT: u8 = 2;
    /// `.`: a number before a digit, else an operator.
    pub const DOT: u8 = 3;
    /// `-`: a line comment, else an operator.
    pub const DASH: u8 = 4;
    /// `{`: a block comment before `-`, else a bracket.
    pub const OPEN_BRACE: u8 = 5;
    /// `(` or `[`.
    pub const OPEN: u8 = 6;
    /// `)`, `]`, or `}`.
    pub const CLOSE: u8 = 7;
    /// `,` or `;`.
    pub const DELIMITER: u8 = 8;
    /// An operator symbol byte other than `.` and `-`.
    pub const SYMBOL: u8 = 9;
    pub const QUOTE: u8 = 10;
    pub const TICK: u8 = 11;
    pub const BACKTICK: u8 = 12;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 13;
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
                b'.' => class::DOT,
                b'-' => class::DASH,
                b'{' => class::OPEN_BRACE,
                b'(' | b'[' => class::OPEN,
                b')' | b']' | b'}' => class::CLOSE,
                b',' | b';' => class::DELIMITER,
                b'"' => class::QUOTE,
                b'\'' => class::TICK,
                b'`' => class::BACKTICK,
                _ if SYMBOL[c] => class::SYMBOL,
                _ => class::OTHER,
            }
        };
        c += 1;
    }
    t
};

/// The bytes of [`class::IDENT`], as their own table so the name test stays
/// a branch of its own before the class dispatch.
static NAME_START: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = CLASS[c] == class::IDENT;
        c += 1;
    }
    t
};

/// Identifier bytes of a Haskell name: `[A-Za-z0-9_']` and bytes from 0x80
/// (`$scanIdentRun` with `'`).
static NAME: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = b >= 0x80
            || (b | 32).wrapping_sub(b'a') <= 25
            || is_digit(b)
            || b == b'_'
            || b == b'\'';
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

/// The end of the name run from `p`: `[A-Za-z0-9_']` and bytes from 0x80
/// (`$scanIdentRun` with `'`). The NUL after the input ends every run.
#[inline(always)]
fn name_end(src: &[u8], mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..8 {
        if !NAME[at(src, p) as usize] {
            return p;
        }
        p += 1;
    }
    // SAFETY: each 16-byte load starts at or before the NUL after the
    // input, inside the slack.
    unsafe {
        loop {
            let v = V::load(src.as_ptr().add(p));
            let alpha = v.or(V::splat(0x20)).sub(V::splat(b'a')).le(V::splat(25));
            let digit = v.sub(V::splat(b'0')).le(V::splat(9));
            let extra = v.eq(V::splat(b'_')).or(v.eq(V::splat(b'\'')));
            let ok = alpha.or(digit).or(extra.or(v.high()));
            let k = ok.not().first();
            if k < 16 {
                return p + k;
            }
            p += 16;
        }
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
/// `$lexScanNumberBody`).
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

/// Whether the tick at `p` opens a character literal: an escape, or one
/// code point, then a closing tick on the same line (`$hsIsCharLiteral`).
#[inline(always)]
fn is_char_literal(src: &[u8], p: usize, end: usize) -> bool {
    if p + 1 >= end {
        return false;
    }
    let c = at(src, p + 1);
    if c == b'\\' {
        return true;
    }
    if c == b'\n' || c == b'\r' {
        return false;
    }
    let e = scan::utf8_span_end(src, p + 2, end);
    e < end && at(src, e) == b'\''
}

/// The first position from `p` where `{-` or `-}` starts, or a position at
/// or past `end` (the search loop of `$lexNestedScan`).
#[inline(always)]
fn find_nest_pair(src: &[u8], mut p: usize, end: usize) -> usize {
    while p < end {
        // SAFETY: `p < end`, so both 16-byte loads end inside the slack.
        let k = unsafe {
            let w = V::load(src.as_ptr().add(p));
            let w1 = V::load(src.as_ptr().add(p + 1));
            let open = w.eq(V::splat(b'{')).and(w1.eq(V::splat(b'-')));
            let close = w.eq(V::splat(b'-')).and(w1.eq(V::splat(b'}')));
            open.or(close).first()
        };
        if k < 16 {
            return p + k;
        }
        p += 16;
    }
    p
}

/// The end of the nested `{- -}` comment whose body starts at `p`, or
/// `end` when it doesn't close (`$lexNestedScan` from depth 1).
#[cold]
#[inline(never)]
fn nested_comment_end(src: &[u8], mut p: usize, end: usize) -> usize {
    let mut depth = 1u32;
    loop {
        p = find_nest_pair(src, p, end);
        // a pair whose second byte is at or past the end doesn't count
        if p + 1 >= end {
            return end;
        }
        if at(src, p) == b'{' {
            depth = depth.wrapping_add(1);
            p += 2;
            continue;
        }
        depth = depth.wrapping_sub(1);
        p += 2;
        if depth == 0 {
            return p;
        }
    }
}

/// Lex the Haskell input of `len` bytes at `base` (`$hlHaskell`).
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

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src, 0, end);
    gap!(0, ptr);
    // Leading whitespace. The state is already that of a line start, so
    // only the record changes; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
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

    let mut line_head = true;
    let mut import_line = false;
    let mut type_mode = false;
    let mut want_function = false;
    let mut want_type = false;
    let mut in_backtick = false;
    // a stack of open brackets, one bit each with 1 for `{`
    let mut braces = 0u32;

    loop {
        let gap = ptr;
        let mut c = at(src, ptr);
        if is_space(c) {
            if c == b' ' && !is_space(at(src, ptr + 1)) {
                // one space: no line break
                ptr += 1;
            } else {
                ptr = whitespace_end(src, ptr + 1);
                // the gap crossed a line break when a CR/LF sits in it
                if c == b'\n' || c == b'\r' || scan::line_end(src, gap + 1, ptr) < ptr {
                    line_head = true;
                    import_line = false;
                    type_mode = false;
                    want_function = false;
                    want_type = false;
                }
            }
            extend!(ptr);
            c = at(src, ptr);
        }
        let lhs = ptr;
        let at_head = line_head;
        // Names, the most common tokens, skip the jump table.
        if NAME_START[c as usize] {
            ptr = name_end(src, ptr + 1);
            // the group value, or -1 for a name that is not a keyword
            let g = word_value(src, lhs, ptr);
            let hl = if g < 0 {
                let upper = c.wrapping_sub(b'A') <= 25;
                if want_type || type_mode || (import_line && upper) {
                    tok::TYPE
                } else if upper {
                    tok::CONSTRUCTOR
                } else if in_backtick || at_head || want_function {
                    if in_backtick {
                        tok::FUNCTION
                    } else {
                        tok::FUNCTION_DEFINITION
                    }
                } else if at(src, skip_space_at(src, ptr)) == b'(' {
                    tok::FUNCTION
                } else {
                    tok::VARIABLE
                }
            } else {
                (g & 255) as u32
            };
            emit!(hl, ptr);
            if hl == tok::KEYWORD_DECLARATION {
                want_type = true;
            } else if hl == tok::KEYWORD_IMPORT {
                import_line = true;
            } else {
                want_type = false;
            }
            want_function = g > 255;
            line_head = false;
            continue;
        }
        match CLASS[c as usize] {
            class::OPEN_BRACE if at(src, ptr + 1) == b'-' => {
                // a pragma `{-#` is preprocessor text; `{-|` and `{-^` are
                // doc comments
                let c3 = at(src, ptr + 2);
                let hl = if c3 == b'#' {
                    tok::PREPROC
                } else if c3 == b'|' || c3 == b'^' {
                    tok::COMMENT_DOC
                } else {
                    tok::COMMENT
                };
                ptr = nested_comment_end(src, ptr + 2, end);
                emit!(hl, ptr);
            }
            class::OPEN_BRACE | class::OPEN => {
                ptr += 1;
                emit!(tok::PUNCTUATION_BRACKET, ptr);
                braces = braces << 1 | (c == b'{') as u32;
                line_head = false;
            }
            class::CLOSE => {
                ptr += 1;
                emit!(tok::PUNCTUATION_BRACKET, ptr);
                braces >>= 1;
                line_head = false;
            }
            class::DELIMITER => {
                ptr += 1;
                emit!(tok::PUNCTUATION_DELIMITER, ptr);
                if braces & 1 != 0 {
                    type_mode = false;
                }
                line_head = false;
            }
            class::DASH | class::DOT | class::SYMBOL | class::DIGIT => {
                if c == b'-' && at(src, ptr + 1) == b'-' {
                    // A dash run opens a comment only when no symbol
                    // follows it.
                    let mut p = ptr + 2;
                    while at(src, p) == b'-' {
                        p += 1;
                    }
                    if !SYMBOL[at(src, p) as usize] {
                        let mut q = ptr + 2;
                        if at(src, q) == b' ' {
                            q += 1;
                        }
                        let d = at(src, q);
                        let hl = if d == b'|' || d == b'^' || d == b'$' {
                            tok::COMMENT_DOC
                        } else {
                            tok::COMMENT
                        };
                        // `$lexLineComment`
                        ptr = scan::line_end(src, ptr + 2, end);
                        emit!(hl, ptr);
                        continue;
                    }
                }
                if is_digit(c) || (c == b'.' && is_digit(at(src, ptr + 1))) {
                    ptr = number_end(src, ptr);
                    emit!(tok::NUMBER, ptr);
                    line_head = false;
                    continue;
                }
                ptr += 1;
                while SYMBOL[at(src, ptr) as usize] {
                    ptr += 1;
                }
                emit!(tok::OPERATOR, ptr);
                let n = ptr - lhs;
                if n == 2 {
                    let pair = [at(src, lhs), at(src, lhs + 1)];
                    if pair == *b"::" {
                        type_mode = true;
                    }
                    if pair == *b"==" {
                        type_mode = false;
                    }
                }
                if n == 1 && c == b'=' {
                    type_mode = false;
                    want_type = false;
                }
                line_head = false;
            }
            class::QUOTE | class::TICK => {
                let hl = if c == b'"' {
                    tok::STRING
                } else if is_char_literal(src, ptr, end) {
                    tok::STRING_SPECIAL
                } else {
                    // a name-quoting tick: the name after it lexes as usual
                    ptr += 1;
                    emit!(tok::PUNCTUATION_SPECIAL, ptr);
                    line_head = false;
                    continue;
                };
                // `$lexString`, `$lexStringBody`
                let mut seg = lhs;
                ptr += 1;
                loop {
                    ptr = scan::string_special(src, ptr, end, c);
                    if ptr >= end {
                        break;
                    }
                    let d = at(src, ptr);
                    if d == c {
                        ptr += 1;
                        break;
                    }
                    // a raw line break: unterminated, left unconsumed
                    if d != b'\\' {
                        break;
                    }
                    if seg < ptr {
                        emit!(hl, ptr);
                    }
                    let e = escape_end(src, ptr, end);
                    emit!(tok::STRING_ESCAPE, e);
                    ptr = e;
                    seg = ptr;
                }
                if seg < ptr {
                    emit!(hl, ptr);
                }
                line_head = false;
            }
            class::BACKTICK => {
                ptr += 1;
                emit!(tok::PUNCTUATION_SPECIAL, ptr);
                in_backtick = !in_backtick;
                line_head = false;
            }
            class::NUL if ptr >= end => break,
            _ => {
                ptr += 1;
                emit!(tok::NONE, ptr);
                line_head = false;
            }
        }
    }
    // SAFETY: the records before `cur` are written.
    unsafe { inst.ext.recs.set_len(cur.offset_from(rp) as usize) };
}
