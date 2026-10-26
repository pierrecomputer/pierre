//! WAT sources: src/langs/ocaml.wat src/common.wat src/scan.wat
//!
//! Native OCaml lexer. One pass over the input: each token is scanned and
//! colored in the same step, with the same rules, in the same order, as the
//! translated `$hlOcaml`. The records equal the translated lexer's records.
//!
//! The WAT tests its rules in one chain. Each rule matches one first byte,
//! so this lexer dispatches on the first byte and, for each byte, tests
//! only the rules that can match it, in the WAT's order.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::ML_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "ocaml" => Some(highlight),
        _ => None,
    }
}

/// `$mlWords` as a perfect hash on a word's bytes: the token in the low
/// byte, and bit 8 for a value binding, bit 9 for `type`, bit 10 for a
/// module head. A word of up to 16 bytes is two little-endian integers,
/// `lo` (bytes 0-7) and `hi` (bytes 8-15), zero past its end; names hold no
/// NUL, so equal integers mean equal words.
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    /// The word's `keyword-table.value`.
    values: [u16; WORD_SLOTS],
    mul: u64,
}

const WORD_SLOTS: usize = 512;

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
    while i < ML_WORDS.len() {
        let w = ML_WORDS[i].word;
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
        while i < ML_WORDS.len() {
            let (w, value) = (ML_WORDS[i].word, ML_WORDS[i].value);
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
/// (`$mlWordHl`).
#[inline(always)]
fn word_value(src: Input, lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    // SAFETY: the name `[lhs, rhs)` lies inside the input, and so does
    // `lhs + 8` when the name is longer than 8 bytes.
    if n > WORD_MAX || WORD_LENGTHS[unsafe { src.byte_unchecked(lhs) } as usize] >> n & 1 == 0 {
        return -1;
    }
    // SAFETY: as above.
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

/// Bytes besides names and digits that can begin an argument
/// (`$mlIsArgStart`).
static ARG_PUNCT: [bool; 256] = byteset(b"\"(?[`{~");

/// Byte classes for the main dispatch.
mod class {
    /// Anything else: one byte colored `none`.
    pub const OTHER: u8 = 0;
    /// An identifier start other than `$`: a letter, `_`, or a byte from
    /// 0x80.
    pub const IDENT: u8 = 1;
    pub const DIGIT: u8 = 2;
    pub const DOT: u8 = 3;
    pub const OPEN_PAREN: u8 = 4;
    pub const OPEN_BRACE: u8 = 5;
    pub const OPEN_BRACKET: u8 = 6;
    /// `)` or `]`.
    pub const CLOSE: u8 = 7;
    pub const CLOSE_BRACE: u8 = 8;
    /// `,` or `;`.
    pub const DELIMITER: u8 = 9;
    pub const QUOTE: u8 = 10;
    pub const TICK: u8 = 11;
    pub const BACKTICK: u8 = 12;
    /// `~` or `?`: a label before a name, else an operator.
    pub const LABEL: u8 = 13;
    /// Any other operator symbol byte.
    pub const SYMBOL: u8 = 14;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 15;
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
                b'(' => class::OPEN_PAREN,
                b'{' => class::OPEN_BRACE,
                b'[' => class::OPEN_BRACKET,
                b')' | b']' => class::CLOSE,
                b'}' => class::CLOSE_BRACE,
                b',' | b';' => class::DELIMITER,
                b'"' => class::QUOTE,
                b'\'' => class::TICK,
                b'`' => class::BACKTICK,
                b'~' | b'?' => class::LABEL,
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

/// The bytes of [`class::SYMBOL`], as their own table so the operator test
/// stays a branch of its own before the class dispatch.
static OP_START: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = CLASS[c] == class::SYMBOL;
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
static RUN_DOLLAR: [bool; 256] = run_table(b'$');
static RUN_DOT: [bool; 256] = run_table(b'.');

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

/// Whether `c` is ASCII whitespace: space or TAB through CR (`$lexIsSpace`).
#[inline(always)]
const fn is_space(c: u8) -> bool {
    c == b' ' || c.wrapping_sub(9) <= 4
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
/// extra byte `X` (`$scanIdentRun`; `$lexScanIdent` with `$`). The NUL
/// after the input ends every run.
#[inline(always)]
fn run_end<const X: u8>(src: Input, mut p: usize) -> usize {
    let table = match X {
        b'\'' => &RUN_PRIME,
        b'$' => &RUN_DOLLAR,
        _ => &RUN_DOT,
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

/// The end of the lowercase run `[a-z_]` at `p` (`$mlIdEnd`).
#[inline(always)]
fn id_end(src: Input, mut p: usize) -> usize {
    // SAFETY: the run stops at the NUL after the input at the latest.
    while unsafe { src.byte_unchecked(p) }.wrapping_sub(b'a') <= 25
        || unsafe { src.byte_unchecked(p) } == b'_'
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

/// The end of the number body from `p`: radix digits, separators,
/// exponents, and suffixes, with `.` only before a digit
/// (`$lexScanNumberBody`).
#[inline(always)]
fn number_body_end(src: Input, mut p: usize, hex: bool) -> usize {
    let mut prev = 0u8;
    loop {
        // SAFETY: the number stops at the NUL after the input at the
        // latest, so `p` stays at or before it.
        let c = unsafe { src.byte_unchecked(p) };
        if IDENT_CONT[c as usize] {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            // SAFETY: the `.` lies inside the input, so the byte after it
            // is at most the NUL.
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

/// The end of the number at `p`, with hexadecimal floats that need an
/// exponent (`$lexScanHexNumber` with `$requireExponent`, `$lexScanNumber`),
/// then a trailing `.` that makes a float (`$mlFloatDot`).
#[inline(always)]
fn number_end(src: Input, lhs: usize, end: usize) -> usize {
    // SAFETY: the number's first byte lies inside the input, so the byte
    // after it is at most the NUL.
    let hex =
        unsafe { src.byte_unchecked(lhs) == b'0' && src.byte_unchecked(lhs + 1) | 0x20 == b'x' };
    let mut p = number_body_end(src, lhs, hex);
    if hex && p < end {
        let next = src.byte(p + 1);
        if src.byte(p) == b'.' && (is_hex(next) || next | 32 == b'p') {
            let mut q = p + 1;
            while is_hex(src.byte(q)) || src.byte(q) == b'_' {
                q += 1;
            }
            if src.byte(q) | 32 == b'p' {
                q += 1;
                if src.byte(q) == b'+' || src.byte(q) == b'-' {
                    q += 1;
                }
                if is_digit(src.byte(q)) {
                    p = number_body_end(src, p + 1, true);
                }
            }
        }
    }
    // `$mlFloatDot`
    // SAFETY: the number ends at or before the NUL after the input, and a
    // `.` there lies inside the input.
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
    if e == p + 2 && src.byte(p + 1) == b'\r' && e < end && src.byte(e) == b'\n' {
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
    // SAFETY: `p + 1` lies before the input end.
    if unsafe { src.byte_unchecked(p + 1) } == b'\\' {
        return true;
    }
    let e = scan::utf8_span_end(src.bytes(), p + 2, end);
    // SAFETY: `e` lies before the input end.
    e < end && unsafe { src.byte_unchecked(e) } == b'\''
}

/// Whether the bytes at `p` begin an argument of an application: a value
/// start that is not a keyword (`$mlIsArgAt`, `$mlIsArgStart`).
#[inline(always)]
fn is_arg_at(src: Input, p: usize) -> bool {
    // SAFETY: `p` lies at or before the NUL after the input.
    let c = unsafe { src.byte_unchecked(p) };
    if !(is_ident_start(c) || is_digit(c) || ARG_PUNCT[c as usize]) {
        return false;
    }
    if c.wrapping_sub(b'a') > 25 {
        return true;
    }
    let e = id_end(src, p);
    // SAFETY: the run stops at the NUL after the input at the latest.
    let d = unsafe { src.byte_unchecked(e) };
    if IDENT_CONT[d as usize] || d == b'\'' {
        return true;
    }
    let kind = word_value(src, p, e);
    kind < 0 || (kind & 255) as u32 == tok::BOOLEAN
}

/// The first position from `p` where `(*` or `*)` starts, or a position at
/// or past `end` (the search loop of `$lexNestedScan`).
#[inline(always)]
fn find_nest_pair(src: Input, mut p: usize, end: usize) -> usize {
    while p < end {
        // SAFETY: `p < end`, so both 16-byte loads end inside the slack.
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
        // SAFETY: `p` lies before the input end.
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

/// The end of a quoted string whose key id is `[id_start, id_end)`, with
/// the opener's `|` at `id_end`: just past the closer `|` + id + `}` (the
/// id cut to 30 bytes), or `end` (`$mlQuoted`, `$mlQuotedBody`).
#[cold]
#[inline(never)]
fn quoted_end(src: Input, id_start: usize, id_end: usize, end: usize) -> usize {
    let n = (id_end - id_start).min(30);
    let mut closer = [0u8; 32];
    closer[0] = b'|';
    closer[1..=n].copy_from_slice(&src.bytes()[id_start..id_start + n]);
    closer[n + 1] = b'}';
    let n = n + 2;
    let mut p = id_end + 1;
    loop {
        // `$lexFindByte`
        p = scan::find3(src.bytes(), p, end, b'|', b'|', b'|');
        if p >= end {
            return p;
        }
        if p + n <= end && src.bytes()[p + 1..p + n] == closer[1..n] {
            return p + n;
        }
        p += 1;
    }
}

/// Lex the OCaml input of `len` bytes at `base` (`$hlOcaml`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: the input and its slack lie inside lexer memory, and this
    // lexer calls no translated code, so memory stays in place.
    let src = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut recs = Recs::load(inst);

    // A string from `lhs` whose body starts at `p` and ends at the next
    // unescaped `quote` (`$lexString`, `$lexStringBody`): a multiline one
    // runs over line breaks, any other stops before one. Escapes get their
    // own tokens. Returns the end.
    macro_rules! string {
        ($lhs:expr, $p:expr, $quote:expr, $multiline:expr) => {{
            let quote: u8 = $quote;
            let mut seg: usize = $lhs;
            let mut p: usize = $p;
            loop {
                p = if $multiline {
                    scan::find3(src.bytes(), p, end, quote, b'\\', quote)
                } else {
                    scan::string_special(src.bytes(), p, end, quote)
                };
                if p >= end {
                    break;
                }
                // SAFETY: `p` lies before the input end.
                let d = unsafe { src.byte_unchecked(p) };
                if d == quote {
                    p += 1;
                    break;
                }
                // a raw line break: unterminated, left unconsumed
                if d != b'\\' {
                    break;
                }
                if seg < p {
                    recs.tok(tok::STRING, p);
                }
                let e = escape_end(src, p, end);
                recs.tok(tok::STRING_ESCAPE, e);
                p = e;
                seg = p;
            }
            if seg < p {
                recs.tok(tok::STRING, p);
            }
            p
        }};
    }

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src.bytes(), 0, end);
    recs.gap(0, ptr);
    // Leading whitespace; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    recs.gap(ptr, first);
    ptr = first;

    // the pending capture: 1 after `let`/`and`/`rec`, 2 after `type`, 3
    // after a module keyword
    let mut expect = 0u32;
    // 1 after `.`, 2 after a module's `.`
    let mut member = 0u32;
    // inside a type annotation or constructor argument list
    let mut type_mode = false;
    // after a value: a name, a literal, or a closer
    let mut after_value = false;
    // the last capitalized name was followed by `.`
    let mut last_module = false;

    loop {
        // SAFETY: every token ends at or before the input end, so `ptr`
        // (and the byte after it, the NUL at most) lies inside the input
        // plus slack.
        let mut c = unsafe { src.byte_unchecked(ptr) };
        if is_space(c) {
            // SAFETY: as above.
            if c == b' ' && !is_space(unsafe { src.byte_unchecked(ptr + 1) }) {
                ptr += 1;
            } else {
                ptr = whitespace_end(src, ptr + 1);
            }
            // SAFETY: a token's record precedes every gap after the leading
            // whitespace.
            unsafe { recs.extend_unchecked(ptr) };
            // SAFETY: the NUL at the input end stops the run.
            c = unsafe { src.byte_unchecked(ptr) };
        }
        let lhs = ptr;
        // Names, the most common tokens, skip the jump table.
        if NAME_START[c as usize] {
            // primes continue a name: x', f''
            let rhs = run_end::<b'\''>(src, ptr + 1);
            ptr = rhs;
            let kind = if member != 0 {
                -1
            } else {
                word_value(src, lhs, rhs)
            };
            // After each name, `after_value` says whether it was a value:
            // a variable, function, definition, constructor, or property
            // (a defined name counts too, so `let add x y` keeps `x` a
            // value).
            let hl;
            if kind >= 0 {
                hl = (kind & 255) as u32;
                expect = (kind >> 8) as u32;
                if expect == 4 {
                    expect = 3;
                }
                // `of` and `:` open a type; `in`, `=`, and the rest close it
                // SAFETY: the name `[lhs, rhs)` lies inside the input.
                type_mode = rhs - lhs == 2
                    && unsafe { src.byte_unchecked(lhs) } == b'o'
                    && unsafe { src.byte_unchecked(lhs + 1) } == b'f';
                // (the table holds keywords, built-in types, and booleans)
                after_value = false;
            } else if c.wrapping_sub(b'A') <= 25 {
                // `Foo.bar` names a module, a bare `Foo` a constructor;
                // after `module type` the name is a module type
                // SAFETY: the name ends at or before the input end.
                last_module = unsafe { src.byte_unchecked(rhs) } == b'.';
                hl = if expect == 2 {
                    tok::TYPE
                } else if last_module || expect == 3 {
                    tok::NAMESPACE
                } else {
                    tok::CONSTRUCTOR
                };
                after_value = hl == tok::CONSTRUCTOR;
                if expect >= 2 {
                    expect = 0;
                }
            } else if expect.wrapping_sub(1) > 1 && !type_mode && member == 0 {
                // the head of an application, a name before an argument
                // that no value precedes, is the function applied
                hl = if !after_value && is_arg_at(src, skip_space_at(src, rhs)) {
                    tok::FUNCTION
                } else {
                    tok::VARIABLE
                };
                after_value = true;
            } else if expect == 1 {
                // `let f x =` defines a function, `let x =` a value
                // SAFETY: the NUL at the input end stops the spaces.
                let d = unsafe { src.byte_unchecked(skip_space_at(src, rhs)) };
                hl = if is_ident_start(d) || d == b'(' || d == b'~' || d == b'?' {
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
            } else if type_mode {
                hl = tok::TYPE;
                after_value = false;
            } else {
                // (`member` is set)
                hl = if member == 2 {
                    tok::FUNCTION
                } else {
                    tok::PROPERTY
                };
                after_value = true;
            }
            recs.tok(hl, rhs);
            member = 0;
            continue;
        }
        // SAFETY: `ptr` lies at or before the input end, so the byte after
        // it lies inside the slack.
        let c2 = unsafe { src.byte_unchecked(ptr + 1) };
        // Operators skip the jump table too.
        if OP_START[c as usize] {
            ptr += 1;
            // SAFETY: the NUL at the input end stops the run.
            while SYMBOL_RUN[unsafe { src.byte_unchecked(ptr) } as usize] {
                ptr += 1;
            }
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
                    expect = 0;
                }
            }
            if n == 2 && c == b':' && c2 == b':' {
                type_mode = false;
            }
            member = 0;
            after_value = false;
            continue;
        }
        match CLASS[c as usize] {
            class::OPEN_PAREN if c2 == b'*' => {
                // `(* ... *)` nests; `(** ... *)` documents
                // SAFETY: `(*` lies inside the input, so the two bytes after
                // it lie at most one past the NUL, inside the slack.
                let hl = if unsafe {
                    src.byte_unchecked(ptr + 2) == b'*' && src.byte_unchecked(ptr + 3) != b')'
                } {
                    tok::COMMENT_DOC
                } else {
                    tok::COMMENT
                };
                ptr = nested_comment_end(src, ptr + 2, end);
                recs.tok(hl, ptr);
            }
            class::QUOTE => {
                // strings span lines
                ptr = string!(lhs, ptr + 1, b'"', true);
                member = 0;
                after_value = true;
            }
            class::OPEN_BRACE
                if c2 == b'|'
                    || (c2.wrapping_sub(b'a') <= 25
                        // SAFETY: the run stops at the NUL after the input
                        // at the latest.
                        && unsafe { src.byte_unchecked(id_end(src, ptr + 1)) } == b'|') =>
            {
                // `{id|...|id}` is a quoted string with no escapes
                let q = ptr + 1;
                ptr = quoted_end(src, q, id_end(src, q), end);
                recs.tok(tok::STRING, ptr);
                member = 0;
                after_value = true;
            }
            class::OPEN_BRACE | class::OPEN_PAREN | class::OPEN_BRACKET => {
                if c == b'{' && c2 == b'%' {
                    // `{%ext|...|}` and `{%%ext id|...|id}` quoted
                    // extensions: the marker and name, then a quoted string
                    // keyed by the id
                    let mut p = ptr + 2;
                    if src.byte(p) == b'%' {
                        p += 1;
                    }
                    let rhs = run_end::<b'.'>(src, p);
                    let mut q = rhs;
                    if src.byte(q) == b' ' {
                        q += 1;
                    }
                    let n = id_end(src, q);
                    if rhs > p && src.byte(n) == b'|' {
                        recs.tok(tok::PUNCTUATION_SPECIAL, p);
                        recs.tok(tok::ATTRIBUTE, rhs);
                        ptr = quoted_end(src, q, n, end);
                        recs.tok(tok::STRING, ptr);
                        member = 0;
                        after_value = true;
                        continue;
                    }
                }
                if c == b'[' && (c2 == b'@' || c2 == b'%') {
                    // `[@attr]`, `[@@attr]`, `[@@@attr]`, `[%ext]`, `[%%ext]`
                    ptr += 1;
                    while src.byte(ptr) == c2 {
                        ptr += 1;
                    }
                    recs.tok(tok::PUNCTUATION_SPECIAL, ptr);
                    let rhs = run_end::<b'.'>(src, ptr);
                    if rhs > ptr {
                        ptr = rhs;
                        recs.tok(tok::ATTRIBUTE, ptr);
                    }
                    member = 0;
                    continue;
                }
                ptr += 1;
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
                member = 0;
                after_value = false;
                if c == b'(' {
                    expect = 0;
                }
            }
            class::CLOSE | class::CLOSE_BRACE => {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
                member = 0;
                after_value = true;
                if c != b'}' {
                    type_mode = false;
                }
            }
            class::TICK if is_char_literal(src, ptr, end) => {
                ptr = string!(lhs, ptr + 1, b'\'', false);
                member = 0;
                after_value = true;
            }
            class::TICK if is_ident_start(c2) => {
                // `'a` type variables
                ptr = run_end::<b'\''>(src, ptr + 1);
                recs.tok(tok::TYPE, ptr);
                member = 0;
            }
            class::BACKTICK if is_ident_start(c2) => {
                // `` `Variant `` polymorphic variants
                ptr = run_end::<b'$'>(src, ptr + 1);
                recs.tok(tok::VARIANT, ptr);
                member = 0;
            }
            class::LABEL if is_ident_start(c2) => {
                // `~label`, `~label:`, `?opt` argument labels; the `:` glued
                // to a label introduces its one-atom argument
                ptr = run_end::<b'$'>(src, ptr + 1);
                recs.tok(tok::VARIABLE_PARAMETER, ptr);
                member = 0;
                // SAFETY: the label ends at or before the NUL after the
                // input, and a `:` there lies inside the input.
                if unsafe { src.byte_unchecked(ptr) == b':' && src.byte_unchecked(ptr + 1) != b':' }
                {
                    ptr += 1;
                    recs.tok(tok::OPERATOR, ptr);
                    after_value = true;
                }
            }
            class::DIGIT => {
                ptr = number_end(src, ptr, end);
                recs.tok(tok::NUMBER, ptr);
                member = 0;
                after_value = true;
            }
            class::DOT if is_digit(c2) => {
                ptr = number_end(src, ptr, end);
                recs.tok(tok::NUMBER, ptr);
                member = 0;
                after_value = true;
            }
            class::DELIMITER => {
                ptr += if c == b';' && c2 == b';' { 2 } else { 1 };
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                member = 0;
                after_value = false;
                type_mode = false;
                expect = 0;
            }
            class::DOT if c2 != b'.' => {
                // `.` names a field, `.(` an array index, `Foo.` a module
                // member, which is a function when an argument follows
                ptr += 1;
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                member = if last_module && is_arg_at(src, skip_space_at(src, id_end(src, ptr))) {
                    2
                } else {
                    1
                };
                after_value = false;
            }
            class::LABEL => {
                ptr += 1;
                // SAFETY: the NUL at the input end stops the run.
                while SYMBOL_RUN[unsafe { src.byte_unchecked(ptr) } as usize] {
                    ptr += 1;
                }
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
                        expect = 0;
                    }
                }
                if n == 2 && c == b':' && c2 == b':' {
                    type_mode = false;
                }
                member = 0;
                after_value = false;
            }
            class::NUL if ptr >= end => break,
            _ => {
                ptr += 1;
                recs.tok(tok::NONE, ptr);
                member = 0;
            }
        }
    }
    recs.store(inst);
}
