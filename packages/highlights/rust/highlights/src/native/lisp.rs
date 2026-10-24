//! WAT sources: src/langs/lisp.wat src/common.wat src/scan.wat
//!
//! Native Lisp lexer (Common Lisp, Emacs Lisp, Scheme). One pass over the
//! input: each token is scanned and colored in the same step, with the same
//! rules, in the same order, as the translated `$hlLisp`. The records equal
//! the translated lexer's records.
//!
//! The WAT tests its rules in one chain. Each rule matches one first byte,
//! so this lexer dispatches on the first byte and, for each byte, tests
//! only the rules that can match it, in the WAT's order. Bytes that only
//! the last rule (a symbol) can take go straight to it. The binding-list
//! state is the WAT's packed `$bl` value, kept bit for bit.

use super::Lexer;
use super::scan;
use super::tables::byteset;
use crate::Rec;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::LISP_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "lisp" => Some(highlight),
        _ => None,
    }
}

/// `$lispWords` as a perfect hash on a word's bytes, for words of up to 16
/// bytes: each group's value is the token in the low byte, bits 8-9 for
/// the next-name capture, and bits 10-11 for the binding list the word
/// arms. A word is two little-endian integers, `lo` (bytes 0-7) and `hi`
/// (bytes 8-15), zero past its end; symbols hold no NUL, so equal integers
/// mean equal words. Longer words are in [`LONG_WORDS`].
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    values: [u16; WORD_SLOTS],
    mul: u64,
}

const WORD_SLOTS: usize = 1024;

/// The longest word in [`WORDS`].
const WORD_MAX: usize = 16;

/// The slot of the word with integers `lo` and `hi`. No two words share a
/// slot, so a symbol is a word only when its integers equal the slot's.
#[inline(always)]
const fn word_slot(lo: u64, hi: u64, mul: u64) -> usize {
    ((lo ^ hi.rotate_left(29)).wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros())) as usize
}

/// The integers of the word `w`.
const fn word_key(w: &[u8]) -> (u64, u64) {
    let mut lo = 0u64;
    let mut hi = 0u64;
    let mut i = 0;
    while i < w.len() && i < 16 {
        if i < 8 {
            lo |= (w[i] as u64) << (8 * i);
        } else {
            hi |= (w[i] as u64) << (8 * (i - 8));
        }
        i += 1;
    }
    (lo, hi)
}

/// The words `$lispWordHl` matches outside `$lispWords`, with their
/// values: words with a `*` or `!`, and `declare`, which the table's hash
/// can't hold. They join [`WORDS`].
const EXTRA_WORDS: [(&[u8], i32); 3] = [
    // `let*` binds like `let`
    (b"let*", (tok::KEYWORD | 0x800) as i32),
    (b"set!", tok::KEYWORD as i32),
    (b"declare", tok::KEYWORD as i32),
];

/// The `i`th word and its value: the table's words, then [`EXTRA_WORDS`].
const fn word_entry(i: usize) -> (&'static [u8], i32) {
    if i < LISP_WORDS.len() {
        (LISP_WORDS[i].word, LISP_WORDS[i].value)
    } else {
        EXTRA_WORDS[i - LISP_WORDS.len()]
    }
}

const WORD_COUNT: usize = LISP_WORDS.len() + EXTRA_WORDS.len();

/// For each first byte, a bit per length of the words in [`WORDS`] and
/// [`LONG_WORDS`]. A symbol whose bit is clear is no word.
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

/// The words of up to 16 bytes, placed by searching for a multiplier that
/// gives each its own slot.
static WORDS: Words = {
    let mut mul: u64 = 0x2545_f491_4f6c_dd1d;
    let mut attempt = 0;
    'search: loop {
        assert!(attempt < 20_000, "no collision-free hash: use more slots");
        let mut keys = [(0u64, 0u64); WORD_SLOTS];
        let mut values = [0u16; WORD_SLOTS];
        let mut i = 0;
        while i < WORD_COUNT {
            let (w, value) = word_entry(i);
            assert!(w.len() < 32 && value > 0 && value < 0x10000);
            if w.len() <= WORD_MAX {
                let (lo, hi) = word_key(w);
                let s = word_slot(lo, hi, mul);
                if keys[s].0 != 0 {
                    mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                    attempt += 1;
                    continue 'search;
                }
                keys[s] = (lo, hi);
                values[s] = value as u16;
            }
            i += 1;
        }
        break Words { keys, values, mul };
    }
};

/// The words longer than 16 bytes, with their values.
static LONG_WORDS: [(&[u8], i32); LONG_COUNT] = {
    let mut t: [(&[u8], i32); LONG_COUNT] = [(b"", 0); LONG_COUNT];
    let mut n = 0;
    let mut i = 0;
    while i < LISP_WORDS.len() {
        if LISP_WORDS[i].word.len() > WORD_MAX {
            t[n] = (LISP_WORDS[i].word, LISP_WORDS[i].value);
            n += 1;
        }
        i += 1;
    }
    t
};

const LONG_COUNT: usize = {
    let mut n = 0;
    let mut i = 0;
    while i < LISP_WORDS.len() {
        if LISP_WORDS[i].word.len() > WORD_MAX {
            n += 1;
        }
        i += 1;
    }
    n
};

/// The value of the symbol `[lhs, rhs)` in `$lispWords` or among
/// [`EXTRA_WORDS`], or -1 (`keyword-table.value $lispWords`).
#[inline(always)]
fn table_value(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    if n > 31 || WORD_LENGTHS[at(src, lhs) as usize] >> n & 1 == 0 {
        return -1;
    }
    if n > WORD_MAX {
        return long_value(src, lhs, rhs);
    }
    let (lo, hi) = if n <= 8 {
        (word_at(src, lhs, n), 0)
    } else {
        (word_at(src, lhs, 8), word_at(src, lhs + 8, n - 8))
    };
    let s = word_slot(lo, hi, WORDS.mul);
    if WORDS.keys[s] == (lo, hi) {
        WORDS.values[s] as i32
    } else {
        -1
    }
}

/// The value of a symbol longer than 16 bytes among [`LONG_WORDS`], or -1.
#[cold]
#[inline(never)]
fn long_value(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    LONG_WORDS
        .iter()
        .find(|(w, _)| src[lhs..rhs] == **w)
        .map_or(-1, |&(_, v)| v)
}

/// The `$lispWordHl` result for the symbol `[lhs, rhs)`, or -1 for an
/// ordinary symbol: `t`, the table's words, and [`EXTRA_WORDS`].
#[inline(always)]
fn word_hl(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    if n == 1 {
        // the table needs two bytes; `t` is the one-letter truth constant
        return if at(src, lhs) == b't' {
            tok::CONSTANT_BUILTIN as i32
        } else {
            -1
        };
    }
    table_value(src, lhs, rhs)
}

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

/// Bytes that end a symbol: whitespace, parentheses, brackets, quotes, and
/// the reader characters (`$lispIsDelim`).
static DELIM: [bool; 256] = byteset(b"\x00\x09\x0a\x0b\x0c\x0d \"'(),;[]`{}");

/// Exponent markers: `e`, and Common Lisp's `s`, `f`, `d`, and `l`
/// precision markers, in either case (`$lispIsExponent`).
static EXPONENT: [bool; 256] = byteset(b"DEFLSdefls");

/// Coarse byte kinds for the loop top.
mod kind {
    /// A byte with rules of its own: comments, strings, reader macros,
    /// `#` forms, `?\` characters, and NUL.
    pub const OTHER: u8 = 0;
    /// ASCII whitespace (`$lexIsSpace`).
    pub const SPACE: u8 = 1;
    /// `(`, `)`, `[`, `]`, `{`, or `}`.
    pub const BRACKET: u8 = 2;
    /// A byte only the symbol rule takes, and none of the first bytes
    /// [`MARKED`] lists.
    pub const SYMBOL: u8 = 3;
    /// A digit, `+`, `-`, `.`, `:`, or `&`: a byte only the symbol rule
    /// takes, which can make a number, a keyword, or a lambda-list
    /// keyword.
    pub const MARKED: u8 = 4;
}

/// The [`kind`] of each byte.
static KIND: [u8; 256] = {
    let mut t = [kind::OTHER; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = if is_space(b) {
            kind::SPACE
        } else if matches!(b, b'(' | b')' | b'[' | b']' | b'{' | b'}') {
            kind::BRACKET
        } else if DELIM[c] || b == b'#' || b == b'?' {
            kind::OTHER
        } else if is_digit(b) || matches!(b, b'+' | b'-' | b'.' | b':' | b'&') {
            kind::MARKED
        } else {
            kind::SYMBOL
        };
        c += 1;
    }
    t
};

/// [`DELIM`] as two 16-entry nibble tables: a byte is a delimiter when the
/// table entries of its high and low nibble share a bit. Each high nibble
/// of an ASCII delimiter has its own bit, and the low-nibble entry holds
/// the bits of the high nibbles it pairs with, so the test is exact.
static DELIM_NIBBLES: ([u8; 16], [u8; 16]) = {
    let mut hi = [0u8; 16];
    let mut lo = [0u8; 16];
    let mut c = 0;
    while c < 128 {
        if DELIM[c] {
            hi[c >> 4] = 1 << (c >> 4);
            lo[c & 15] |= 1 << (c >> 4);
        }
        c += 1;
    }
    (hi, lo)
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

/// The end of the symbol from `p`: up to the next delimiter
/// (`$lispScanSymbol`). The NUL after the input ends every symbol.
#[inline(always)]
fn symbol_end(src: &[u8], mut p: usize) -> usize {
    // Most symbols are short: test a few bytes one by one first.
    for _ in 0..8 {
        if DELIM[at(src, p) as usize] {
            return p;
        }
        p += 1;
    }
    // SAFETY: each 16-byte load starts at or before the NUL after the
    // input, inside the slack.
    unsafe {
        let hi_t = V::from_array(&DELIM_NIBBLES.0);
        let lo_t = V::from_array(&DELIM_NIBBLES.1);
        loop {
            let v = V::load(src.as_ptr().add(p));
            let h = hi_t.lookup(v.shr::<4>());
            let l = lo_t.lookup(v.and(V::splat(15)));
            let k = h.test(l).first();
            if k < 16 {
                return p + k;
            }
            p += 16;
        }
    }
}

/// Whether `[lhs, rhs)` is a number: an optional sign, digits with at most
/// one point or slash, and an optional exponent (`$lispIsNumber`). The byte
/// at `rhs` is a delimiter.
#[inline(always)]
fn is_number(src: &[u8], mut lhs: usize, rhs: usize) -> bool {
    let mut c = at(src, lhs);
    if c == b'+' || c == b'-' {
        lhs += 1;
        c = at(src, lhs);
    }
    // a number starts with a digit or a point, which rejects most symbols
    // at once
    if !(is_digit(c) || c == b'.') {
        return false;
    }
    let mut digits = false;
    let mut prev = 0u8;
    while lhs < rhs {
        let c = at(src, lhs);
        if is_digit(c) {
            digits = true;
        } else if !(c == b'.'
            || c == b'/'
            || EXPONENT[c as usize]
            || ((c == b'+' || c == b'-') && EXPONENT[prev as usize]))
        {
            // a sign inside the number only follows an exponent marker
            return false;
        }
        prev = c;
        lhs += 1;
    }
    digits
}

// Binding lists: the names a parameter or binding list introduces are
// variables (or local functions), not calls. `bl` packs the state as the
// WAT does:
//   bits 0-1  kind of the open list: 0 none, 1 parameter list, 2 `let`
//             bindings, 3 `flet`/`labels` bindings
//   bit 2     inside a flet binding's parameter list
//   bits 3-4  elements seen in the current binding, saturating at 3
//   bits 5-6  the kind armed for the next `(` while no list is open
//   bit 7     right after `(`, where a symbol is the operator of the form
//   bits 8-   bracket depth inside the open list

/// `bl` after an opening `(` or `[` (`$lispBindOpen`).
#[inline(always)]
fn bind_open(bl: u32) -> u32 {
    let kind = bl & 3;
    if kind == 0 {
        let kind = (bl >> 5) & 3;
        return if kind != 0 { kind | 256 } else { 0 };
    }
    let depth = (bl >> 8).wrapping_add(1);
    if depth == 2 {
        return kind | 512;
    }
    if depth == 3 {
        let elem = (bl >> 3) & 3;
        let flet_params = if kind == 3 && elem == 1 { 4 } else { 0 };
        let next = if elem < 3 { elem + 1 } else { 3 };
        return kind | 768 | flet_params | next << 3;
    }
    (bl & 31) | depth << 8
}

/// `bl` after a closing `)` or `]` (`$lispBindClose`).
#[inline(always)]
fn bind_close(bl: u32) -> u32 {
    if bl & 3 == 0 {
        return 0;
    }
    let depth = (bl >> 8).wrapping_sub(1);
    if depth == 0 {
        return 0;
    }
    (bl & if depth == 2 { 27 } else { 31 }) | depth << 8
}

/// The token for a plain symbol at the current binding-list position, or
/// -1 to classify it as usual (`$lispBindName`).
#[inline(always)]
fn bind_name(bl: u32) -> i32 {
    let kind = bl & 3;
    if kind == 0 {
        return if bl & !128 == 64 {
            tok::FUNCTION_DEFINITION as i32
        } else {
            -1
        };
    }
    let depth = bl >> 8;
    if depth == 1 {
        return tok::VARIABLE as i32;
    }
    if depth == 2 && bl & 24 == 0 {
        return if kind == 3 {
            tok::FUNCTION_DEFINITION as i32
        } else {
            tok::VARIABLE as i32
        };
    }
    if depth == 3 && bl & 4 != 0 {
        return tok::VARIABLE as i32;
    }
    -1
}

/// `bl` after a symbol starting with `c`, with `arm` the binding list the
/// symbol arms (`$lispBindStep`).
#[inline(always)]
fn bind_step(bl: u32, c: u8, arm: u32) -> u32 {
    if bl & 3 != 0 {
        if bl >> 8 != 2 {
            return bl;
        }
        return if bl & 24 < 24 { bl.wrapping_add(8) } else { bl };
    }
    if arm != 0 {
        return arm << 5;
    }
    if c == b':' || bl & !128 == 64 { bl } else { 0 }
}

/// The first position from `p` where `#|` or `|#` starts, or a position at
/// or past `end` (the search loop of `$lexNestedScan`).
#[inline(always)]
fn find_nest_pair(src: &[u8], mut p: usize, end: usize) -> usize {
    while p < end {
        // SAFETY: `p < end`, so both 16-byte loads end inside the slack.
        let k = unsafe {
            let w = V::load(src.as_ptr().add(p));
            let w1 = V::load(src.as_ptr().add(p + 1));
            let open = w.eq(V::splat(b'#')).and(w1.eq(V::splat(b'|')));
            let close = w.eq(V::splat(b'|')).and(w1.eq(V::splat(b'#')));
            open.or(close).first()
        };
        if k < 16 {
            return p + k;
        }
        p += 16;
    }
    p
}

/// The end of the nested `#| |#` comment whose body starts at `p`, or
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
        if at(src, p) == b'#' {
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

/// Lex the Lisp input of `len` bytes at `base` (`$hlLisp`).
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
    // Leading whitespace; every later gap follows a token's record.
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

    // the pending next-name capture of a definition form (bit 2 marks a
    // `defun`-style definer, whose name is followed by a parameter list)
    let mut expect = 0u32;
    // the binding-list state, including the form-head bit
    let mut bl = 0u32;

    loop {
        let mut c = at(src, ptr);
        let mut byte_kind = KIND[c as usize];
        if byte_kind == kind::SPACE {
            if c == b' ' && KIND[at(src, ptr + 1) as usize] != kind::SPACE {
                ptr += 1;
            } else {
                ptr = whitespace_end(src, ptr + 1);
            }
            extend!(ptr);
            c = at(src, ptr);
            byte_kind = KIND[c as usize];
        }
        let lhs = ptr;
        // A bracket at `ptr`, whose byte is `c`.
        macro_rules! bracket {
            () => {{
                ptr += 1;
                emit!(tok::PUNCTUATION_BRACKET, ptr);
                // a definition names the symbol after its head; a paren there
                // is an argument list or a `(name options)` spec, whose first
                // symbol is still the name
                if c != b'(' {
                    expect = 0;
                }
                // bits 0-1 and 5-6 (99): a list is open or armed; with neither,
                // both helpers leave the state empty
                if bl & 99 != 0 {
                    if c == b'(' || c == b'[' {
                        bl = bind_open(bl);
                    }
                    if c == b')' || c == b']' {
                        bl = bind_close(bl);
                    }
                }
                // the symbol right after `(` is the operator of the form
                bl = (bl & !128) | ((c == b'(') as u32) << 7;
            }};
        }
        if byte_kind == kind::BRACKET {
            bracket!();
            continue;
        }
        // (symbols, the most common tokens, take one test here)
        if byte_kind < kind::SYMBOL {
            let c2 = at(src, ptr + 1);
            match c {
                b';' => {
                    // `$lexLineComment`
                    ptr = scan::line_end(src, ptr + 1, end);
                    emit!(tok::COMMENT, ptr);
                    continue;
                }
                b'#' if c2 == b'|' => {
                    // `#| ... |#` nests
                    ptr = nested_comment_end(src, ptr + 2, end);
                    emit!(tok::COMMENT, ptr);
                    continue;
                }
                b'"' => {
                    // `$lexString` with a multiline body
                    let mut seg = lhs;
                    ptr += 1;
                    loop {
                        ptr = scan::find3(src, ptr, end, b'"', b'\\', b'"');
                        if ptr >= end {
                            break;
                        }
                        if at(src, ptr) == b'"' {
                            ptr += 1;
                            break;
                        }
                        if seg < ptr {
                            emit!(tok::STRING, ptr);
                        }
                        let e = escape_end(src, ptr, end);
                        emit!(tok::STRING_ESCAPE, e);
                        ptr = e;
                        seg = ptr;
                    }
                    if seg < ptr {
                        emit!(tok::STRING, ptr);
                    }
                    bl &= !128;
                    continue;
                }
                b'\'' | b'`' | b',' => {
                    // reader macros: quote, quasiquote, unquote
                    ptr += if c == b',' && c2 == b'@' { 2 } else { 1 };
                    emit!(tok::PUNCTUATION_SPECIAL, ptr);
                    bl &= !128;
                    continue;
                }
                b'#' => {
                    ptr += 1;
                    if c2 == b'\\' {
                        // `#\a`, `#\Space`, `#\(`: one character or a name;
                        // a line break right after `#\` stays out
                        let rhs = lhs + 2;
                        ptr = rhs;
                        if !(rhs >= end || at(src, rhs) == b'\n' || at(src, rhs) == b'\r') {
                            ptr = symbol_end(src, scan::utf8_span_end(src, rhs + 1, end));
                        }
                        emit!(tok::STRING_SPECIAL, ptr);
                    } else if matches!(c2 | 32, b'x' | b'b' | b'o') {
                        // `#x1F`
                        ptr = symbol_end(src, ptr + 1);
                        emit!(tok::NUMBER, ptr);
                    } else if c2 == b'+' || c2 == b'-' {
                        // `#+feature`
                        ptr = symbol_end(src, ptr + 1);
                        emit!(tok::PREPROC, ptr);
                    } else {
                        // `#'`, `#:`, `#(`
                        if c2 == b'\'' || c2 == b':' {
                            ptr += 1;
                        }
                        emit!(tok::PUNCTUATION_SPECIAL, ptr);
                    }
                    bl &= !128;
                    continue;
                }
                b'?' if c2 == b'\\' && at(src, ptr + 2) > 13 => {
                    // Emacs Lisp escaped character literals `?\(`, `?\\`;
                    // a plain `?a` stays a symbol
                    ptr = scan::utf8_span_end(src, ptr + 3, end);
                    emit!(tok::STRING_SPECIAL, ptr);
                    bl &= !128;
                    continue;
                }
                0 if ptr >= end => break,
                _ => {}
            }
        }

        // a symbol: keyword, number, definition name, operator, or plain
        let mut arm = 0u32;
        ptr = symbol_end(src, ptr);
        if ptr == lhs {
            ptr += 1;
        }
        let rhs = ptr;
        // (a symbol from an `OTHER` byte starts with NUL or `?`)
        let marked = byte_kind == kind::MARKED;
        let hl = if marked && c == b':' {
            tok::STRING_SPECIAL_SYMBOL
        } else if marked && is_number(src, lhs, rhs) {
            tok::NUMBER
        } else if marked && c == b'&' {
            tok::KEYWORD
        } else {
            let kind = word_hl(src, lhs, rhs);
            if kind >= 0 {
                if bl & 128 != 0 {
                    expect = (kind as u32 >> 8) & 3;
                    // `defun`-style definers, unlike Scheme's `define`,
                    // take a parameter list after the name
                    if expect == 1 && at(src, lhs + 3) != b'i' {
                        expect = 5;
                    }
                    arm = kind as u32 >> 10;
                }
                (kind & 255) as u32
            } else {
                // a name a binding list introduces comes first
                let named = if bl & 99 != 0 { bind_name(bl) } else { -1 };
                if named >= 0 {
                    named as u32
                } else if expect != 0 {
                    let hl = match expect & 3 {
                        1 => tok::FUNCTION_DEFINITION,
                        2 => tok::VARIABLE,
                        _ => tok::TYPE,
                    };
                    if expect & 4 != 0 && bl & 128 == 0 {
                        arm = 1;
                    }
                    expect = 0;
                    hl
                } else if bl & 128 != 0 {
                    tok::FUNCTION
                } else if rhs - lhs > 2 && c == at(src, rhs - 1) && (c == b'*' || c == b'+') {
                    // `*special*` and `+constant+` by convention
                    if c == b'*' {
                        tok::VARIABLE_SPECIAL
                    } else {
                        tok::CONSTANT
                    }
                } else if is_ident_start(c) {
                    if c.wrapping_sub(b'A') <= 25 {
                        tok::TYPE
                    } else {
                        tok::VARIABLE
                    }
                } else {
                    tok::OPERATOR
                }
            }
        };
        emit!(hl, rhs);
        bl &= !128;
        if bl & 99 != 0 || arm != 0 {
            bl = bind_step(bl, c, arm);
        }
        // a bracket right after a symbol: its rule runs here, without the
        // gap and dispatch steps
        c = at(src, ptr);
        if KIND[c as usize] == kind::BRACKET {
            bracket!();
        }
    }
    // SAFETY: the records before `cur` are written.
    unsafe { inst.ext.recs.set_len(cur.offset_from(rp) as usize) };
}
