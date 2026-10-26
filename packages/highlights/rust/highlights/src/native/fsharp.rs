//! WAT sources: src/langs/fsharp.wat src/langs/ocaml.wat src/common.wat src/scan.wat
//!
//! Native F# lexer. One pass over the input: each token is scanned and
//! colored in the same step, with the same rules, in the same order, as the
//! translated `$hlFsharp`. The records equal the translated lexer's
//! records.
//!
//! The WAT tests its rules in one chain. Each rule matches one first byte,
//! so this lexer dispatches on the first byte and, for each byte, tests
//! only the rules that can match it, in the WAT's order. String bodies run
//! in [`string_body`], which returns at a `{` that opens an interpolation
//! splice; the main loop lexes the splice and resumes the body at its
//! closing `}`.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::FSHARP_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "fsharp" => Some(highlight),
        _ => None,
    }
}

/// `$fsharpWords` as a perfect hash on a word's bytes: the token in the low
/// byte and the pending capture in the high byte. A word of up to 16 bytes
/// is two little-endian integers, `lo` (bytes 0-7) and `hi` (bytes 8-15),
/// zero past its end; names hold no NUL, so equal integers mean equal
/// words.
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    /// The word's `keyword-table.value`.
    values: [u16; WORD_SLOTS],
    mul: u64,
}

const WORD_SLOTS: usize = 1024;

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
    while i < FSHARP_WORDS.len() {
        let w = FSHARP_WORDS[i].word;
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
        while i < FSHARP_WORDS.len() {
            let (w, value) = (FSHARP_WORDS[i].word, FSHARP_WORDS[i].value);
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
///
/// # Safety
/// `p` must lie inside the input.
#[inline(always)]
unsafe fn word_at(src: Input, p: usize, n: usize) -> u64 {
    // SAFETY: `p` lies before the input end, so `p + 8` lies inside the
    // slack.
    unsafe { src.word_unchecked(p) & (u64::MAX >> (64 - 8 * n)) }
}

/// The keyword value of the name `[lhs, rhs)`, or -1 when it is no word
/// (`$fsWordHl`).
#[inline(always)]
fn word_value(src: Input, lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    // SAFETY: the name `[lhs, rhs)` lies inside the input.
    if n > WORD_MAX || WORD_LENGTHS[unsafe { src.byte_unchecked(lhs) } as usize] >> n & 1 == 0 {
        return -1;
    }
    // SAFETY: the name `[lhs, rhs)` lies inside the input, and so does
    // `lhs + 8` when the name is longer than 8 bytes.
    let (lo, hi) = unsafe {
        if n <= 8 {
            (word_at(src, lhs, n), 0)
        } else {
            (word_at(src, lhs, 8), word_at(src, lhs + 8, n - 8))
        }
    };
    let s = word_slot(lo, WORDS.mul);
    if WORDS.keys[s] == (lo, hi) {
        WORDS.values[s] as i32
    } else {
        -1
    }
}

/// Operator symbol bytes (`$mlIsSymbol`).
static SYMBOL: [bool; 256] = byteset(b"!$%&*+-/:<=>?@^|~");

/// Bytes that continue an operator run: symbols and `.`.
static SYMBOL_RUN: [bool; 256] = byteset(b"!$%&*+-/:<=>?@^|~.");

/// Bytes besides names and digits that can begin an argument (part of
/// `$mlIsArgStart`).
static ARG_PUNCT: [bool; 256] = byteset(b"\"(?[`{~");

/// Byte classes for the main dispatch.
mod class {
    /// Anything else: one character colored `none`.
    pub const OTHER: u8 = 0;
    /// An identifier start other than `$`: a letter, `_`, or a byte from
    /// 0x80.
    pub const IDENT: u8 = 1;
    pub const DIGIT: u8 = 2;
    pub const DOT: u8 = 3;
    pub const SLASH: u8 = 4;
    pub const OPEN_PAREN: u8 = 5;
    pub const HASH: u8 = 6;
    /// `@` or `$`: a string prefix, else an operator.
    pub const PREFIX: u8 = 7;
    pub const QUOTE: u8 = 8;
    pub const TICK: u8 = 9;
    pub const OPEN_BRACKET: u8 = 10;
    pub const GT: u8 = 11;
    pub const BACKTICK: u8 = 12;
    /// `)`, `]`, `{`, or `}`.
    pub const BRACKET: u8 = 13;
    /// `,` or `;`.
    pub const DELIMITER: u8 = 14;
    /// Any other operator symbol byte.
    pub const SYMBOL: u8 = 15;
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
                b'.' => class::DOT,
                b'/' => class::SLASH,
                b'(' => class::OPEN_PAREN,
                b'#' => class::HASH,
                b'@' | b'$' => class::PREFIX,
                b'"' => class::QUOTE,
                b'\'' => class::TICK,
                b'[' => class::OPEN_BRACKET,
                b'>' => class::GT,
                b'`' => class::BACKTICK,
                b')' | b']' | b'{' | b'}' => class::BRACKET,
                b',' | b';' => class::DELIMITER,
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

static RUN_PRIME: [bool; 256] = run_table(b'\'');
static RUN_PLAIN: [bool; 256] = run_table(b'_');

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

/// Whether `c` can begin an argument: a name, a literal, a paren, a label,
/// a polymorphic variant, or a record (`$mlIsArgStart`).
#[inline(always)]
fn is_arg_start(c: u8) -> bool {
    is_ident_start(c) || is_digit(c) || ARG_PUNCT[c as usize]
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
        // SAFETY: `p` lies inside the 8 bytes just read.
        if !is_space(unsafe { src.byte_unchecked(p) }) {
            return p;
        }
        p += 1;
    }
}

/// The end of the run from `p` of `[A-Za-z0-9_]`, bytes from 0x80, and the
/// extra byte `X` (`$scanIdentRun`). The NUL after the input ends every
/// run.
#[inline(always)]
fn run_end<const X: u8>(src: Input, mut p: usize) -> usize {
    let table = match X {
        b'\'' => &RUN_PRIME,
        _ => &RUN_PLAIN,
    };
    // Most names are short: test a few bytes one by one first.
    for _ in 0..8 {
        // SAFETY: the run stops at the NUL after the input, so `p` stays
        // at or before it.
        if !table[unsafe { src.byte_unchecked(p) } as usize] {
            return p;
        }
        p += 1;
    }
    loop {
        // SAFETY: each load starts at or before the NUL after the input,
        // so its 16 bytes stay inside the slack.
        let v = unsafe { src.vec_unchecked(p) };
        let alpha = v.or(V::splat(0x20)).sub(V::splat(b'a')).le(V::splat(25));
        let digit = v.sub(V::splat(b'0')).le(V::splat(9));
        let extra = v.eq(V::splat(b'_')).or(v.eq(V::splat(X)));
        let high = v.high();
        let ok = alpha.or(digit).or(extra.or(high));
        let k = ok.not().first();
        if k < 16 {
            return p + k;
        }
        p += 16;
    }
}

/// The end of the identifier run at `p`, primes included (`$fsIdEnd`).
#[inline(always)]
fn id_end(src: Input, mut p: usize) -> usize {
    // SAFETY: the NUL at the input end stops the run.
    while let c = unsafe { src.byte_unchecked(p) }
        && (IDENT_CONT[c as usize] || c == b'\'')
    {
        p += 1;
    }
    p
}

/// Skip spaces and tabs from `p` on the current line (`$lexSkipSpaceAt`).
#[inline(always)]
fn skip_space_at(src: Input, mut p: usize) -> usize {
    // SAFETY: the run stops at the NUL after the input at the latest.
    while unsafe { src.byte_unchecked(p) } == b' ' || unsafe { src.byte_unchecked(p) } == b'\t' {
        p += 1;
    }
    p
}

/// The end of the number at `p`: radix digits, separators, exponents, and
/// suffixes, with `.` only before a digit (`$lexScanNumber`,
/// `$lexScanNumberBody`), then a trailing `.` that makes a float
/// (`$mlFloatDot`).
#[inline(always)]
fn number_end(src: Input, mut p: usize) -> usize {
    // SAFETY: the number starts inside the input, so the byte after it is
    // at most the NUL.
    let hex = unsafe { src.byte_unchecked(p) == b'0' && src.byte_unchecked(p + 1) | 0x20 == b'x' };
    let mut prev = 0u8;
    loop {
        // SAFETY: the NUL at the input end stops the run, so `p` and the
        // byte after it lie inside the input plus slack.
        let c = unsafe { src.byte_unchecked(p) };
        if IDENT_CONT[c as usize] {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            // SAFETY: as above.
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
    // `$mlFloatDot`
    // SAFETY: as above.
    if unsafe { src.byte_unchecked(p) } == b'.' {
        // SAFETY: as above.
        let c = unsafe { src.byte_unchecked(p + 1) };
        if !(c == b'.' || is_ident_start(c)) {
            p += 1;
        }
    }
    p
}

/// The end of the escape at backslash `p`: one character, kept whole when
/// it is UTF-8, and CRLF as one (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(src: Input, p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(src.bytes(), p + 2, end);
    // SAFETY: the backslash at `p` lies inside the input, so `p + 1` is at
    // most the NUL, and `e < end`.
    if e == p + 2
        && unsafe { src.byte_unchecked(p + 1) } == b'\r'
        && e < end
        && unsafe { src.byte_unchecked(e) } == b'\n'
    {
        e += 1;
    }
    e
}

/// Whether the tick at `p` opens a character literal: an escape, or one
/// code point, then a closing tick (`$mlIsCharLiteral`).
#[inline(always)]
fn is_char_literal(src: Input, p: usize, end: usize) -> bool {
    if p + 1 >= end {
        return false;
    }
    // SAFETY: `p + 1 < end`.
    if unsafe { src.byte_unchecked(p + 1) } == b'\\' {
        return true;
    }
    let e = scan::utf8_span_end(src.bytes(), p + 2, end);
    // SAFETY: `e < end`.
    e < end && unsafe { src.byte_unchecked(e) } == b'\''
}

/// The end of a ``double-backtick`` identifier opening at `p`, just past
/// its closing ``` `` ``` on the same line, or `None` when the line has
/// none (`$fsTickIdEnd`).
#[cold]
#[inline(never)]
fn tick_id_end(src: Input, p: usize, end: usize) -> Option<usize> {
    let mut p = p + 2;
    while p < end {
        // SAFETY: `p < end`.
        let c = unsafe { src.byte_unchecked(p) };
        if c == b'\n' || c == b'\r' {
            break;
        }
        // SAFETY: `p < end`, so `p + 1` is at most the NUL.
        if c == b'`' && unsafe { src.byte_unchecked(p + 1) } == b'`' {
            return Some(p + 2);
        }
        p += 1;
    }
    None
}

/// Whether the bytes at `p` begin an argument of an application: a value
/// start that is not a keyword (`$fsIsArgAt`).
#[inline(always)]
fn is_arg_at(src: Input, p: usize) -> bool {
    // SAFETY: callers pass the end of a space run, which the NUL at the
    // input end stops.
    let c = unsafe { src.byte_unchecked(p) };
    if !is_arg_start(c) {
        return false;
    }
    if is_ident_start(c) && c != b'$' {
        return word_value(src, p, id_end(src, p)) < 0;
    }
    true
}

/// The first position from `p` where `(*` or `*)` starts, or a position at
/// or past `end` (the search loop of `$lexNestedScan`).
#[inline(always)]
fn find_nest_pair(src: Input, mut p: usize, end: usize) -> usize {
    while p < end {
        // SAFETY: `p < end`, so the 16 bytes at `p + 1` end inside the
        // slack.
        let (w, w1) = unsafe { (src.vec_unchecked(p), src.vec_unchecked(p + 1)) };
        let open = w.eq(V::splat(b'(')).and(w1.eq(V::splat(b'*')));
        let close = w.eq(V::splat(b'*')).and(w1.eq(V::splat(b')')));
        let k = open.or(close).first();
        if k < 16 {
            return p + k;
        }
        p += 16;
    }
    p
}

/// The end of the nested `(* *)` comment whose body starts at `p`, or
/// `end` when it doesn't close (`$lexNestedScan` from depth 1).
#[inline(never)]
fn nested_comment_end(src: Input, mut p: usize, end: usize) -> usize {
    let mut depth = 1u32;
    loop {
        p = find_nest_pair(src, p, end);
        // a pair whose second byte is at or past the end doesn't count
        if p + 1 >= end {
            return end;
        }
        // SAFETY: `p + 1 < end`.
        if unsafe { src.byte_unchecked(p) } == b'(' {
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

/// What ended a string body.
mod status {
    /// The input ended.
    pub const OPEN: u32 = 0;
    /// The closing quote.
    pub const CLOSED: u32 = 1;
    /// A `{` that opens an interpolation splice.
    pub const SPLICE: u32 = 2;
}

/// Scan and emit a string body from `ptr`, where the bytes since `ptr` are
/// unemitted. `kind` has bit 1 for `"""`, bit 2 for a verbatim `@"` body
/// whose only escape is `""`, and bit 4 for an interpolated `$"` body with
/// `{expr}` splices and `{{` `}}` escapes. Inside a splice (`nested`) an
/// interpolated string keeps `{` plain. Returns the end and its
/// [`status`] (`$fsStringBody`).
#[inline(always)]
fn string_body(
    src: Input,
    recs: &mut Recs,
    mut ptr: usize,
    end: usize,
    kind: u32,
    nested: bool,
) -> (usize, u32) {
    let verbatim = kind & 2 != 0;
    let interp = kind & 4 != 0;
    let mut seg = ptr;
    // `p` is the next special byte; one below `ptr` so the first pass
    // searches, and a `}` or `}}` handled before it keeps it valid
    let mut p = ptr - 1;
    loop {
        if ptr > p {
            p = if verbatim {
                if interp {
                    scan::find3(src.bytes(), ptr, end, b'"', b'{', b'"')
                } else {
                    scan::find3(src.bytes(), ptr, end, b'"', b'"', b'"')
                }
            } else if interp {
                scan::find3(src.bytes(), ptr, end, b'"', b'\\', b'{')
            } else {
                scan::find3(src.bytes(), ptr, end, b'"', b'\\', b'"')
            };
        }
        // an interpolated body also escapes `}}`, found inside the run
        if interp {
            let e = scan::find3(src.bytes(), ptr, p, b'}', b'}', b'}');
            if e < p {
                if src.byte(e + 1) == b'}' {
                    if seg < e {
                        recs.tok(tok::STRING, e);
                    }
                    ptr = e + 2;
                    recs.tok(tok::STRING_ESCAPE, ptr);
                    seg = ptr;
                } else {
                    ptr = e + 1;
                }
                continue;
            }
        }
        if p >= end {
            ptr = end;
            break;
        }
        // SAFETY: `p < end`, so `p + 2` lies inside the slack.
        let (c, c2) = unsafe { (src.byte_unchecked(p), src.byte_unchecked(p + 1)) };
        if c == b'"' {
            if kind & 1 != 0 {
                // SAFETY: as above.
                if c2 == b'"' && unsafe { src.byte_unchecked(p + 2) } == b'"' {
                    ptr = p + 3;
                    recs.tok(tok::STRING, ptr);
                    return (ptr, status::CLOSED);
                }
                ptr = p + 1;
                continue;
            }
            // a doubled quote escapes itself in a verbatim body
            if verbatim && c2 == b'"' {
                if seg < p {
                    recs.tok(tok::STRING, p);
                }
                ptr = p + 2;
                recs.tok(tok::STRING_ESCAPE, ptr);
                seg = ptr;
                continue;
            }
            ptr = p + 1;
            recs.tok(tok::STRING, ptr);
            return (ptr, status::CLOSED);
        }
        if c == b'\\' {
            if seg < p {
                recs.tok(tok::STRING, p);
            }
            let e = escape_end(src, p, end);
            recs.tok(tok::STRING_ESCAPE, e);
            ptr = e;
            seg = e;
            continue;
        }
        // `{`: an escaped brace or a splice
        if c2 == b'{' {
            if seg < p {
                recs.tok(tok::STRING, p);
            }
            ptr = p + 2;
            recs.tok(tok::STRING_ESCAPE, ptr);
            seg = ptr;
            continue;
        }
        if !nested {
            if seg < p {
                recs.tok(tok::STRING, p);
            }
            ptr = p + 1;
            recs.tok(tok::PUNCTUATION_SPECIAL, ptr);
            return (ptr, status::SPLICE);
        }
        ptr = p + 1;
    }
    if seg < ptr {
        recs.tok(tok::STRING, ptr);
    }
    (ptr, status::OPEN)
}

/// Lex the F# input of `len` bytes at `base` (`$hlFsharp`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: the input and its slack lie inside lexer memory, and this
    // lexer calls no translated code, so memory stays in place.
    let src = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut recs = Recs::load(inst);
    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src.bytes(), 0, end);
    recs.gap(0, ptr);
    // Leading whitespace. The state is already that of a line start, so
    // only the record changes; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    recs.gap(ptr, first);
    ptr = first;

    // the brace depth inside a `{` splice
    let mut interp = 0u32;
    // the string kind a splice returns to
    let mut interp_kind = 0u32;
    // the pending capture: 1 after `let`/`and`/`rec`/`use`, 2 after
    // `type`, 3 on a module, namespace, or open line, 5 after `member`
    let mut expect = 0u32;
    // 1 after `.`, 2 after a module's `.`
    let mut member = 0u32;
    // inside a type annotation
    let mut type_mode = false;
    // after a value, so the head of an application can be told from its
    // arguments
    let mut after_value = false;
    // the last capitalized name was followed by `.`
    let mut last_module = false;
    // inside `[< ... >]`
    let mut attr = false;

    // The open string body of kind `kind` from `ptr`, which runs right
    // after its opener or the `}` that ends a splice: it ends at its
    // closing quote, at a `{` that opens a splice, or at the input end
    // (where nothing follows).
    macro_rules! string {
        ($kind:expr) => {{
            let kind: u32 = $kind;
            let (p, st) = string_body(src, &mut recs, ptr, end, kind, interp != 0);
            ptr = p;
            if st == status::SPLICE {
                interp_kind = kind + 1;
                interp = 1;
                after_value = false;
            } else if st == status::CLOSED {
                after_value = true;
            }
        }};
    }

    loop {
        let gap = ptr;
        // SAFETY: every token ends at or before the input end, so `ptr`
        // (and the byte after it, the NUL at most) lies inside the input
        // plus slack.
        let mut c = unsafe { src.byte_unchecked(ptr) };
        if is_space(c) {
            // SAFETY: as above.
            if c == b' ' && !is_space(unsafe { src.byte_unchecked(ptr + 1) }) {
                // one space: no line break
                ptr += 1;
            } else {
                ptr = whitespace_end(src, ptr + 1);
                // a line break ends a module, namespace, or open line, and
                // starts a new expression where the first name may head an
                // application
                if c == b'\n' || c == b'\r' || scan::line_end(src.bytes(), gap + 1, ptr) < ptr {
                    after_value = false;
                    if expect == 3 {
                        expect = 0;
                    }
                }
            }
            // SAFETY: a token's record precedes every gap after the leading
            // whitespace.
            unsafe { recs.extend_unchecked(ptr) };
            // SAFETY: the NUL at the input end stops the whitespace.
            c = unsafe { src.byte_unchecked(ptr) };
        }
        let lhs = ptr;
        // Names, the most common tokens, skip the jump table. A
        // ``double-backtick name`` is one too.
        let name_end = if NAME_START[c as usize] {
            // primes continue a name: x', f''
            Some(run_end::<b'\''>(src, ptr + 1))
        } else if c == b'`'
            // SAFETY: `ptr` lies at or before the input end, so the byte
            // after it lies inside the slack.
            && unsafe { src.byte_unchecked(ptr + 1) } == b'`'
        {
            tick_id_end(src, ptr, end)
        } else {
            None
        };
        if let Some(rhs) = name_end {
            ptr = rhs;
            let kind = if member != 0 || attr {
                -1
            } else {
                word_value(src, lhs, rhs)
            };
            let hl;
            if kind >= 0 {
                hl = (kind & 255) as u32;
                // a capture keyword sets the pending name; a modifier such
                // as `mutable` or `inline` keeps it; anything else ends it
                if kind >> 8 != 0 {
                    expect = (kind >> 8) as u32;
                } else if hl != tok::KEYWORD_DECLARATION {
                    expect = 0;
                }
                // `of` and `:` open a type; `in`, `=`, and the rest close it
                // SAFETY: the keyword `[lhs, rhs)` lies inside the input.
                type_mode = rhs - lhs == 2
                    && unsafe {
                        src.byte_unchecked(lhs) == b'o' && src.byte_unchecked(lhs + 1) == b'f'
                    };
                after_value = hl == tok::BOOLEAN
                    || hl == tok::CONSTANT_BUILTIN
                    || hl == tok::VARIABLE_SPECIAL;
            } else {
                // After each name, `after_value` says whether it was a
                // value: defined and member names count too, so `let add x
                // y` and `obj.Add x y` keep `x` a value.
                if !attr
                    && member == 0
                    && !type_mode
                    && !matches!(expect, 1 | 2 | 3 | 5)
                    && c.wrapping_sub(b'A') > 25
                {
                    // the head of an application, a name before an argument
                    // that no value precedes, is the function applied
                    hl = if !after_value && is_arg_at(src, skip_space_at(src, rhs)) {
                        tok::FUNCTION
                    } else {
                        tok::VARIABLE
                    };
                    after_value = true;
                } else if attr {
                    hl = tok::ATTRIBUTE;
                    after_value = false;
                } else if expect == 3 {
                    hl = tok::NAMESPACE;
                    after_value = false;
                } else if c.wrapping_sub(b'A') <= 25 {
                    // `Foo.bar` names a module, a bare `Foo` a constructor,
                    // and in a type position a type
                    // SAFETY: the NUL at the input end stops the name and the
                    // spaces after it.
                    last_module = unsafe { src.byte_unchecked(rhs) } == b'.';
                    hl = if member != 0 {
                        // SAFETY: the NUL at the input end stops the name and the
                        // spaces after it.
                        if is_arg_start(unsafe { src.byte_unchecked(skip_space_at(src, rhs)) }) {
                            tok::FUNCTION_METHOD
                        } else {
                            tok::PROPERTY
                        }
                    } else if last_module {
                        tok::NAMESPACE
                    } else if type_mode || expect == 2 {
                        tok::TYPE
                    } else {
                        tok::CONSTRUCTOR
                    };
                    if expect == 2 {
                        expect = 0;
                    }
                    after_value =
                        hl == tok::CONSTRUCTOR || hl == tok::FUNCTION_METHOD || hl == tok::PROPERTY;
                } else if expect == 1 {
                    // `let f x =` defines a function, `let x =` a value
                    // SAFETY: the NUL at the input end stops the name and the
                    // spaces after it.
                    hl = if is_arg_start(unsafe { src.byte_unchecked(skip_space_at(src, rhs)) }) {
                        tok::FUNCTION_DEFINITION
                    } else {
                        tok::VARIABLE
                    };
                    expect = 0;
                    after_value = true;
                } else if expect == 2 {
                    hl = tok::TYPE;
                    expect = 0;
                    after_value = false;
                } else if expect == 5 {
                    // `member this.Name`: the self identifier, then the
                    // member
                    // SAFETY: the NUL at the input end stops the name and the
                    // spaces after it.
                    if unsafe { src.byte_unchecked(rhs) } == b'.' {
                        hl = tok::VARIABLE;
                    } else {
                        // SAFETY: the NUL at the input end stops the name and the
                        // spaces after it.
                        hl = if is_arg_start(unsafe { src.byte_unchecked(skip_space_at(src, rhs)) })
                        {
                            tok::FUNCTION_METHOD
                        } else {
                            tok::PROPERTY
                        };
                        expect = 0;
                    }
                    after_value = true;
                } else if type_mode {
                    hl = tok::TYPE;
                    after_value = false;
                } else if member != 0 {
                    // SAFETY: the NUL at the input end stops the name and the
                    // spaces after it.
                    hl = if is_arg_start(unsafe { src.byte_unchecked(skip_space_at(src, rhs)) }) {
                        tok::FUNCTION_METHOD
                    } else {
                        tok::PROPERTY
                    };
                    after_value = true;
                } else {
                    // the head of an application, a name before an argument
                    // that no value precedes, is the function applied
                    hl = if !after_value && is_arg_at(src, skip_space_at(src, rhs)) {
                        tok::FUNCTION
                    } else {
                        tok::VARIABLE
                    };
                    after_value = true;
                }
            }
            recs.tok(hl, rhs);
            member = 0;
            continue;
        }
        // SAFETY: `ptr` lies at or before the input end, so the byte after
        // it lies inside the slack.
        let c2 = unsafe { src.byte_unchecked(ptr + 1) };
        // An operator run from `lhs`: symbols and `.`, ended early by a
        // `//` comment opener or a closing `>]`.
        macro_rules! symbol_run {
            () => {{
                let mut p = lhs;
                loop {
                    // SAFETY: the run stops at the NUL at the latest, so
                    // `p` and `p + 1` lie inside the input plus slack.
                    let b = unsafe { src.byte_unchecked(p) };
                    if !SYMBOL_RUN[b as usize]
                        || (b == b'/' && unsafe { src.byte_unchecked(p + 1) } == b'/')
                        || (p > lhs && b == b'>' && unsafe { src.byte_unchecked(p + 1) } == b']')
                    {
                        break;
                    }
                    p += 1;
                }
                ptr = p;
                recs.tok(tok::OPERATOR, ptr);
                let n = ptr - lhs;
                // `:` opens a type annotation, `->` keeps it, `=` and `|`
                // end it; `::` is the cons operator
                if n == 1 {
                    if c == b':' {
                        type_mode = true;
                    }
                    if c == b'=' || c == b'|' {
                        type_mode = false;
                        if expect != 3 {
                            expect = 0;
                        }
                    }
                }
                if n == 2 && c == b':' && c2 == b':' {
                    type_mode = false;
                }
                member = 0;
                after_value = false;
            }};
        }
        match CLASS[c as usize] {
            class::SLASH if c2 == b'/' => {
                // `//` comments, `///` documents
                // SAFETY: `ptr + 1` is a slash inside the input, so `ptr + 3`
                // lies inside the slack.
                let hl = if unsafe {
                    src.byte_unchecked(ptr + 2) == b'/' && src.byte_unchecked(ptr + 3) != b'/'
                } {
                    tok::COMMENT_DOC
                } else {
                    tok::COMMENT
                };
                ptr = scan::line_end(src.bytes(), ptr + 2, end);
                recs.tok(hl, ptr);
            }
            // SAFETY: `ptr + 1` is `*` inside the input, so `ptr + 2` is at
            // most the NUL.
            class::OPEN_PAREN if c2 == b'*' && unsafe { src.byte_unchecked(ptr + 2) } != b')' => {
                // `(* ... *)` nests but `(*)` is an operator
                ptr = nested_comment_end(src, ptr + 2, end);
                recs.tok(tok::COMMENT, ptr);
            }
            class::HASH if is_ident_start(c2) => {
                // `#if`, `#else`, `#endif`, `#r`, `#load`, `#nowarn`
                ptr = run_end::<b'_'>(src, ptr + 1);
                recs.tok(tok::PREPROC, ptr);
            }
            class::PREFIX | class::QUOTE => {
                // string openers: `"`, `"""`, `@"`, `$"`, `$@"`, `@$"`,
                // `$"""`
                let mut n = 0u32;
                let mut p = ptr;
                loop {
                    // SAFETY: `p` is `ptr` or follows input bytes `@` and
                    // `$`, so it is at most the NUL.
                    let pc = unsafe { src.byte_unchecked(p) };
                    if pc == b'@' {
                        n |= 2;
                    } else if pc == b'$' {
                        n |= 4;
                    } else {
                        break;
                    }
                    p += 1;
                    if p > ptr + 2 {
                        break;
                    }
                }
                // SAFETY: `p` is at most the NUL (as above), so `p + 2` lies
                // inside the slack.
                if unsafe { src.byte_unchecked(p) } == b'"' {
                    // SAFETY: as above.
                    if unsafe {
                        src.byte_unchecked(p + 1) == b'"' && src.byte_unchecked(p + 2) == b'"'
                    } {
                        n |= 1;
                        p += 2;
                    }
                    ptr = p + 1;
                    member = 0;
                    if n == 0 {
                        // A plain string without escapes is one token.
                        let close = scan::find3(src.bytes(), ptr, end, b'"', b'\\', b'"');
                        // SAFETY: `close < end`.
                        if close < end && unsafe { src.byte_unchecked(close) } == b'"' {
                            ptr = close + 1;
                            recs.tok(tok::STRING, ptr);
                            after_value = true;
                            continue;
                        }
                    }
                    recs.tok(tok::STRING, ptr);
                    string!(n);
                    continue;
                }
                // `@` and `$` alone are operators
                symbol_run!();
            }
            class::TICK if is_char_literal(src, ptr, end) => {
                // `$lexString` with `'`
                let mut seg = lhs;
                ptr += 1;
                loop {
                    ptr = scan::string_special(src.bytes(), ptr, end, b'\'');
                    if ptr >= end {
                        break;
                    }
                    // SAFETY: `ptr < end`.
                    let d = unsafe { src.byte_unchecked(ptr) };
                    if d == b'\'' {
                        ptr += 1;
                        break;
                    }
                    // a raw line break: unterminated, left unconsumed
                    if d != b'\\' {
                        break;
                    }
                    if seg < ptr {
                        recs.tok(tok::STRING, ptr);
                    }
                    let e = escape_end(src, ptr, end);
                    recs.tok(tok::STRING_ESCAPE, e);
                    ptr = e;
                    seg = ptr;
                }
                if seg < ptr {
                    recs.tok(tok::STRING, ptr);
                }
                member = 0;
                after_value = true;
            }
            class::TICK if is_ident_start(c2) => {
                // `'T` type parameters
                ptr = run_end::<b'\''>(src, ptr + 1);
                recs.tok(tok::TYPE, ptr);
                member = 0;
            }
            class::OPEN_BRACKET if c2 == b'<' => {
                // `[< ... >]` attributes
                ptr += 2;
                recs.tok(tok::PUNCTUATION_SPECIAL, ptr);
                attr = true;
            }
            class::GT if c2 == b']' && attr => {
                ptr += 2;
                recs.tok(tok::PUNCTUATION_SPECIAL, ptr);
                attr = false;
            }
            class::DOT if c2 == b'.' => {
                // `..` is a range, `.. ..` a stepped one
                ptr += 2;
                recs.tok(tok::OPERATOR, ptr);
                member = 0;
                after_value = false;
            }
            class::DIGIT => {
                ptr = number_end(src, ptr);
                recs.tok(tok::NUMBER, ptr);
                member = 0;
                after_value = true;
            }
            class::DOT if is_digit(c2) => {
                ptr = number_end(src, ptr);
                recs.tok(tok::NUMBER, ptr);
                member = 0;
                after_value = true;
            }
            class::OPEN_PAREN | class::OPEN_BRACKET | class::BRACKET => {
                ptr += 1;
                if interp != 0 {
                    if c == b'{' {
                        interp += 1;
                    }
                    if c == b'}' {
                        interp -= 1;
                        if interp == 0 {
                            // the brace matching the splice returns to the
                            // string body
                            recs.tok(tok::PUNCTUATION_SPECIAL, ptr);
                            member = 0;
                            let kind = interp_kind - 1;
                            interp_kind = 0;
                            string!(kind);
                            continue;
                        }
                    }
                }
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
                member = 0;
                after_value = c == b')' || c == b']' || c == b'}';
                if c == b')' || c == b']' {
                    type_mode = false;
                }
                if c == b'(' && expect != 3 {
                    expect = 0;
                }
            }
            class::DELIMITER => {
                ptr += if c == b';' && c2 == b';' { 2 } else { 1 };
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                member = 0;
                after_value = false;
                type_mode = false;
                if expect != 3 {
                    expect = 0;
                }
            }
            class::DOT => {
                // `.` names a member, `Foo.` a module member
                ptr += 1;
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                member = if last_module { 2 } else { 1 };
                after_value = false;
            }
            class::SYMBOL | class::SLASH | class::GT => symbol_run!(),
            class::NUL if ptr >= end => break,
            _ => {
                ptr = scan::utf8_span_end(src.bytes(), ptr + 1, end);
                recs.tok(tok::NONE, ptr);
                member = 0;
            }
        }
    }
    recs.store(inst);
}
