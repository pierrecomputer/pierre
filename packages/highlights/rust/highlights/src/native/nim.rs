//! WAT sources: src/langs/nim.wat src/common.wat src/scan.wat src/sig.wat
//!
//! Native Nim highlighter. One pass over the input: each token is scanned
//! and colored in the same step, with the same rules, in the same order, as
//! the translated `$hlNim`. The records equal the translated lexer's
//! records.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::NIM_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "nim" => Some(highlight),
        _ => None,
    }
}

/// `$nimWords` and the two words `$hlNim` matches outside the table with
/// fixed values (`raise`, `export`), as a perfect hash on a word's bytes. A
/// word of up to 16 bytes is two little-endian integers, `lo` (bytes 0-7)
/// and `hi` (bytes 8-15), zero past its end; identifiers hold no NUL, so
/// equal integers mean equal words.
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    /// The word's `keyword-table.value`.
    values: [u16; WORD_SLOTS],
    mul: u64,
}

const WORD_SLOTS: usize = 1024;

/// The longest word.
const WORD_MAX: usize = 16;

/// The words `$hlNim` matches outside the table, with their values.
const EXTRA_WORDS: [(&[u8], u32); 2] = [
    (b"raise", tok::KEYWORD_CONTROL),
    (b"export", tok::KEYWORD_IMPORT + 512),
];

/// Entry `i` of [`NIM_WORDS`] followed by [`EXTRA_WORDS`].
const fn word_entry(i: usize) -> (&'static [u8], i32) {
    if i < NIM_WORDS.len() {
        (NIM_WORDS[i].word, NIM_WORDS[i].value)
    } else {
        let (w, v) = EXTRA_WORDS[i - NIM_WORDS.len()];
        (w, v as i32)
    }
}

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
    while i < NIM_WORDS.len() + EXTRA_WORDS.len() {
        let w = word_entry(i).0;
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
        while i < NIM_WORDS.len() + EXTRA_WORDS.len() {
            let (w, value) = word_entry(i);
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
            i += 1;
        }
        break Words { keys, values, mul };
    }
};

/// The value of the word `[lhs, rhs)`, or -1 (`keyword-table.value
/// $nimWords`, with `raise` and `export`).
#[inline(always)]
fn word_value(src: Input, lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    // SAFETY: `lhs` is a name's start, before the input end.
    if n > WORD_MAX || WORD_LENGTHS[unsafe { src.byte_unchecked(lhs) } as usize] >> n & 1 == 0 {
        return -1;
    }
    let (lo, hi) = if n <= 8 {
        (word_at(src, lhs, n as u32), 0)
    } else {
        (word_at(src, lhs, 8), word_at(src, lhs + 8, n as u32 - 8))
    };
    let s = word_slot(lo, hi, WORDS.mul);
    if WORDS.keys[s] == (lo, hi) {
        WORDS.values[s] as i32
    } else {
        -1
    }
}

/// Operator bytes (`$hlNim`'s operator rule).
static OPS: [bool; 256] = byteset(b"=+-*/<>@$~&%|!?^.:\\");

/// Bytes after a `*` that make it an export marker (`$hlNim`).
static EXPORT_NEXT: [bool; 256] = byteset(b":,[ \x09\x0a\x0d");

/// Byte classes for the main dispatch.
mod class {
    /// An identifier start other than `$`.
    pub const IDENT: u8 = 0;
    pub const DIGIT: u8 = 1;
    pub const HASH: u8 = 2;
    pub const DQUOTE: u8 = 3;
    pub const SQUOTE: u8 = 4;
    pub const BACKTICK: u8 = 5;
    /// `(`, `)`, `[`, `]`, `{`, `}`.
    pub const BRACKET: u8 = 6;
    /// `,` or `;`.
    pub const DELIMITER: u8 = 7;
    /// An operator byte (`.` and `:` included).
    pub const OP: u8 = 8;
    /// Anything else: one byte colored `none`.
    pub const OTHER: u8 = 9;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 10;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    t[0] = class::NUL;
    let mut c = 1;
    while c < 256 {
        let b = c as u8;
        t[c] = if is_ident_start(b) && b != b'$' {
            class::IDENT
        } else if is_digit(b) {
            class::DIGIT
        } else {
            match b {
                b'#' => class::HASH,
                b'"' => class::DQUOTE,
                b'\'' => class::SQUOTE,
                b'`' => class::BACKTICK,
                b'(' | b')' | b'[' | b']' | b'{' | b'}' => class::BRACKET,
                b',' | b';' => class::DELIMITER,
                _ if OPS[c] => class::OP,
                _ => class::OTHER,
            }
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

/// The byte at `i`, or 0 at and past `end` (`$templateByte`), for
/// lookaheads that may start past the NUL.
#[inline(always)]
fn byte(src: Input, i: usize, end: usize) -> u8 {
    // SAFETY: `i` is before the input end (tested first).
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

/// The end of the name run from `p`: `[A-Za-z0-9_]` and bytes from 0x80
/// (`$scanIdentRun` with `_`). The NUL after the input ends every run.
#[inline(always)]
fn name_run_end(src: Input, mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..4 {
        // SAFETY: `p` starts at or before the input end, and the NUL there
        // ends the run, so `p` never passes it; 16 bytes from there stay
        // inside the slack.
        if !NAME_CONT[unsafe { src.byte_unchecked(p) } as usize] {
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
        let ok = alpha.or(digit).or(under.or(v.high()));
        let k = ok.not().first();
        if k < 16 {
            return p + k;
        }
        p += 16;
    }
}

/// The end of the number at `p`: radix digits, separators, exponents, and
/// suffixes, with `.` only before a digit (`$lexScanNumber`,
/// `$lexScanNumberBody`).
fn number_end(src: Input, mut p: usize) -> usize {
    // SAFETY: `p` starts at or before the input end, and the NUL there
    // ends the number, so every read is at most one byte past it.
    let hex = unsafe { src.byte_unchecked(p) } == b'0'
        && unsafe { src.byte_unchecked(p + 1) } | 0x20 == b'x';
    let mut prev = 0u8;
    loop {
        // SAFETY: as above.
        let c = unsafe { src.byte_unchecked(p) };
        if IDENT_CONT[c as usize] {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            // SAFETY: as above.
            let next = unsafe { src.byte_unchecked(p + 1) };
            if !is_digit(next) {
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

/// SCREAMING_CASE: at least two bytes, one uppercase letter, and only
/// `[A-Z0-9_]` (`$lexIsConstCase`).
fn is_const_case(src: Input, lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = false;
    for p in lhs..rhs {
        // SAFETY: `p` is inside the name, before the input end.
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
#[inline(always)]
fn word_at(src: Input, p: usize, n: u32) -> u64 {
    // SAFETY: `p` lies before the input end, so `p + 8` lies inside the
    // slack.
    let w = unsafe { src.word_unchecked(p) };
    w & (u64::MAX >> (64 - 8 * n))
}

/// Whether the gap `[p, stop)` holds a CR or LF (`$lexGapHasBreak`).
#[inline(always)]
fn gap_has_break(src: Input, p: usize, stop: usize) -> bool {
    // SAFETY: the gap lies inside the input.
    (p..stop).any(|i| matches!(unsafe { src.byte_unchecked(i) }, b'\n' | b'\r'))
}

/// The end of at most `max` hex digits from `p`, bounded by `end`
/// (`$scanHexRun`).
#[inline(always)]
fn hex_run_end(src: Input, mut p: usize, max: usize, end: usize) -> usize {
    let stop = (p + max).min(end);
    // SAFETY: `p` is below `stop`, at most the input end.
    while p < stop && is_hex(unsafe { src.byte_unchecked(p) }) {
        p += 1;
    }
    p
}

/// The end of the escape at backslash `p`: `\xHH`, `\uHHHH`, `\u{H..}`, a
/// decimal code, or one character; a backslash before a line break escapes
/// nothing (`$nimEscapeEnd`, `$lexEscapeEnd`).
fn escape_end(src: Input, p: usize, end: usize) -> usize {
    if p + 1 < end {
        // SAFETY: `p + 1` is before the input end (tested above).
        let c = unsafe { src.byte_unchecked(p + 1) };
        if c == b'\n' || c == b'\r' {
            return p + 1;
        }
        if c | 32 == b'x' {
            return hex_run_end(src, p + 2, 2, end);
        }
        if c | 32 == b'u' {
            let q = p + 2;
            if byte(src, q, end) != b'{' {
                return hex_run_end(src, q, 4, end);
            }
            let q = hex_run_end(src, q + 1, 8, end);
            return if byte(src, q, end) == b'}' { q + 1 } else { q };
        }
        if is_digit(c) {
            let mut q = p + 2;
            while is_digit(byte(src, q, end)) {
                q += 1;
            }
            return q;
        }
    }
    // `$lexEscapeEnd`
    let mut e = scan::utf8_span_end(src.bytes(), p + 2, end);
    // SAFETY: the backslash at `p` is before the input end, so `p + 1` is
    // at most the input end; `e` is below it when read.
    if e == p + 2
        && unsafe { src.byte_unchecked(p + 1) } == b'\r'
        && e < end
        && unsafe { src.byte_unchecked(e) } == b'\n'
    {
        e += 1;
    }
    e
}

/// The `"` string from `lhs`, whose body starts at `p`: it ends at its
/// quote or, unterminated, before the line break; escapes are their own
/// tokens. Returns the end (`$hlNim`'s string rule).
#[inline(never)]
fn string(src: Input, mut recs: Recs, mut lhs: usize, mut p: usize, end: usize) -> (Recs, usize) {
    loop {
        p = scan::string_special(src.bytes(), p, end, b'"');
        if p >= end {
            break;
        }
        // SAFETY: `p` is before the input end (tested above).
        let c = unsafe { src.byte_unchecked(p) };
        if c == b'"' {
            p += 1;
            break;
        }
        if c != b'\\' {
            break;
        }
        if lhs < p {
            recs.tok(tok::STRING, p);
        }
        let e = escape_end(src, p, end);
        if p < e {
            recs.tok(tok::STRING_ESCAPE, e);
        }
        p = e;
        lhs = e;
    }
    if lhs < p {
        recs.tok(tok::STRING, p);
    }
    (recs, p)
}

/// The end of a `"""` body from `p`: through its closing quotes, the last
/// three of a run of three or more, or `end` (`$nimTriple`).
#[inline(never)]
fn triple_end(src: Input, mut p: usize, end: usize) -> usize {
    loop {
        p = scan::find3(src.bytes(), p, end, b'"', b'"', b'"');
        if p >= end {
            return end;
        }
        let q = p;
        p += 1;
        while byte(src, p, end) == b'"' {
            p += 1;
        }
        if p - q >= 3 {
            return p;
        }
    }
}

/// The end of a raw string body from `p`: `""` is a quote; one `"` ends
/// the string, and a line break ends it unterminated (`$nimRawString`).
#[inline(never)]
fn raw_string_end(src: Input, mut p: usize, end: usize) -> usize {
    loop {
        p = scan::find3(src.bytes(), p, end, b'"', b'\n', b'\r');
        // SAFETY: `p` is before the input end when read.
        if p >= end || unsafe { src.byte_unchecked(p) } != b'"' {
            return p;
        }
        p += 1;
        if byte(src, p, end) != b'"' {
            return p;
        }
        p += 1;
    }
}

/// The end of a `#[ ]#` comment body from `p` at nesting `depth`; a doc
/// comment also takes the `#` after its last `]#` (`$nimBlockComment`,
/// `$lexNestedScan`).
#[inline(never)]
fn block_comment_end(src: Input, mut p: usize, end: usize, doc: bool) -> usize {
    let mut depth = 1u32;
    loop {
        // the next `#[` or `]#`: hop between `#` and `]` bytes
        p = scan::find3(src.bytes(), p, end, b'#', b']', b'#');
        if p + 1 >= end {
            return end;
        }
        // SAFETY: `p + 1` is before the input end (tested above).
        let (a, b) = unsafe { (src.byte_unchecked(p), src.byte_unchecked(p + 1)) };
        if a == b'#' && b == b'[' {
            depth += 1;
            p += 2;
        } else if a == b']' && b == b'#' {
            depth -= 1;
            p += 2;
            if depth == 0 {
                if doc && byte(src, p, end) == b'#' {
                    p += 1;
                }
                return p;
            }
        } else {
            p += 1;
        }
    }
}

/// The parameter-list machine's registers (`$sig*` globals in `sig.wat`).
#[derive(Default)]
struct Sig {
    parens: u32,
    mask: u32,
    obscure: u32,
    pattern: bool,
    fn_pend: bool,
    fn_angle: u32,
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

/// No name position recorded.
const NONE: usize = usize::MAX;

/// Lex the Nim input of `len` bytes at `base` (`$hlNim`).
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
    // Leading whitespace (no import statement is open yet); every later gap
    // follows a token's record.
    let first = whitespace_end(src, ptr);
    recs.gap(ptr, first);
    ptr = first;

    // the next name defines a routine
    let mut after_decl = false;
    let mut after_dot = false;
    // end of a definition name: a `*` there exports it
    let mut def_end = NONE;
    // open brackets
    let mut depth = 0u32;
    // 1: names are modules until the line ends; 2: after a comma
    let mut import = 0u32;
    // end of the last name, for an adjacent export `*`
    let mut name_end = NONE;
    // inside `{. .}`: 1 a pragma name is due, 2 after it
    let mut pragma = 0u32;

    // `ptr` never passes the input end: every scan stops at the NUL there.
    loop {
        let gap = ptr;
        // SAFETY: `ptr` is at or before the input end (see above).
        let s = unsafe { src.byte_unchecked(ptr) };
        // SAFETY: as above.
        if s == b' ' && !is_space(unsafe { src.byte_unchecked(ptr + 1) }) {
            // one space
            ptr += 1;
            // SAFETY: every pass of this loop writes a record or ends it, and
            // the first pass starts after the leading whitespace.
            unsafe { recs.extend_unchecked(ptr) };
        } else if is_space(s) {
            ptr = whitespace_end(src, ptr + 1);
            // an import statement ends at a line break outside brackets
            // unless its last token was a comma
            if import == 1 && depth == 0 && gap_has_break(src, gap, ptr) {
                import = 0;
            }
            // SAFETY: as above.
            unsafe { recs.extend_unchecked(ptr) };
        }
        let lhs = ptr;
        // SAFETY: `ptr` is at or before the input end, so this and every
        // read up to `ptr + 2` below stay inside the slack.
        let c = unsafe { src.byte_unchecked(ptr) };
        // SAFETY: as above.
        let c2 = unsafe { src.byte_unchecked(ptr + 1) };
        let class = CLASS[c as usize];

        if class == class::HASH {
            if c2 == b'[' {
                ptr = block_comment_end(src, ptr + 2, end, false);
                recs.tok(tok::COMMENT, ptr);
            // SAFETY: `ptr + 2` lies inside the slack (see above).
            } else if c2 == b'#' && unsafe { src.byte_unchecked(ptr + 2) } == b'[' {
                ptr = block_comment_end(src, ptr + 3, end, true);
                recs.tok(tok::COMMENT_DOC, ptr);
            } else {
                // `$lexLineComment`, `$scanToLineEnd`
                ptr = scan::line_end(src.bytes(), ptr + 1, end);
                recs.tok(
                    if c2 == b'#' {
                        tok::COMMENT_DOC
                    } else {
                        tok::COMMENT
                    },
                    ptr,
                );
            }
            continue;
        }

        // every other token consumes a pending definition or member position
        let decl = after_decl;
        after_decl = false;
        let dot = after_dot;
        after_dot = false;
        // a pending routine head survives only its export marker, its `[...]`
        // generic list, and its name on the way to the `(` of its parameters
        if sig.fn_pend && sig.fn_angle == 0 && !matches!(c, b'(' | b'*' | b'[' | b'`') {
            sig.fn_pend = false;
        }

        match class {
            class::IDENT => {
                ptr = name_run_end(src, ptr + 1);
                // a string right after a name: `r"raw"` is one raw literal;
                // any other name calls a generalized raw literal
                // SAFETY: names end at or before the input end, so these reads
                // are at most one byte past it.
                if unsafe { src.byte_unchecked(ptr) } == b'"' {
                    let p = ptr;
                    let mut lhs = lhs;
                    if !(p - lhs == 1 && c | 32 == b'r') {
                        recs.tok(tok::FUNCTION, p);
                        lhs = p;
                    }
                    ptr = if unsafe { src.byte_unchecked(p + 1) } == b'"'
                        && byte(src, p + 2, end) == b'"'
                    {
                        triple_end(src, p + 3, end)
                    } else {
                        raw_string_end(src, p + 1, end)
                    };
                    recs.emit(tok::STRING, lhs, ptr);
                    continue;
                }
                let g = if dot { -1 } else { word_value(src, lhs, ptr) };
                let hl;
                if g != -1 {
                    hl = (g & 255) as u32;
                    if g >> 8 == 1 {
                        after_decl = true;
                        sig.fn_pend = true;
                        sig.fn_angle = 0;
                    }
                    if g >> 8 == 2 {
                        import = 1;
                    }
                } else {
                    name_end = ptr;
                    if decl {
                        hl = tok::FUNCTION_DEFINITION;
                        def_end = ptr;
                        sig.fn_pend = true;
                        sig.fn_angle = 0;
                    } else if import != 0 {
                        hl = tok::NAMESPACE;
                        import = 1;
                    } else if pragma == 1 {
                        hl = tok::ATTRIBUTE;
                        pragma = 2;
                    } else {
                        // SAFETY: names end at or before the input end.
                        let call = unsafe { src.byte_unchecked(ptr) } == b'(';
                        if dot {
                            hl = if call {
                                tok::FUNCTION_METHOD
                            } else {
                                tok::PROPERTY
                            };
                        } else if sig.active() && sig.pattern && sig.obscure == 0 {
                            // a name at the top level of a marked routine
                            // list after `(`, `,`, or `;` is a parameter
                            hl = tok::VARIABLE_PARAMETER;
                        } else if is_upper(c) {
                            hl = if is_const_case(src, lhs, ptr) {
                                tok::CONSTANT
                            } else {
                                tok::TYPE
                            };
                        } else if call {
                            hl = tok::FUNCTION;
                        } else {
                            hl = tok::VARIABLE;
                        }
                    }
                }
                recs.tok(hl, ptr);
                sig.pattern = false;
            }
            class::DQUOTE => {
                // SAFETY: `ptr + 2` lies inside the slack (see above).
                if c2 == b'"' && unsafe { src.byte_unchecked(ptr + 2) } == b'"' {
                    ptr = triple_end(src, ptr + 3, end);
                    recs.tok(tok::STRING, ptr);
                } else {
                    (recs, ptr) = string(src, recs, lhs, ptr + 1, end);
                }
            }
            class::SQUOTE => {
                // a character literal: `'a'`, `'\n'`; a lone `'` stays plain
                ptr += 1;
                let p = if c2 == b'\\' {
                    escape_end(src, ptr, end)
                } else {
                    scan::utf8_span_end(src.bytes(), ptr + 1, end)
                };
                if byte(src, p, end) == b'\'' && !matches!(c2, b'\n' | b'\r' | b'\'') {
                    recs.tok(tok::STRING, ptr);
                    recs.emit(
                        if c2 == b'\\' {
                            tok::STRING_ESCAPE
                        } else {
                            tok::STRING
                        },
                        ptr,
                        p,
                    );
                    ptr = p + 1;
                    recs.tok(tok::STRING, ptr);
                } else {
                    recs.tok(tok::NONE, ptr);
                }
            }
            class::DIGIT => {
                ptr = number_end(src, ptr);
                // a type suffix: `1'i32`, `0xff'u8`, `2.0'f64`
                // SAFETY: the NUL at the input end stops the number, so these
                // reads are at most one byte past it.
                if unsafe { src.byte_unchecked(ptr) } == b'\''
                    && is_ident_start(unsafe { src.byte_unchecked(ptr + 1) })
                {
                    ptr = name_run_end(src, ptr + 1);
                }
                recs.tok(tok::NUMBER, ptr);
            }
            class::BACKTICK => {
                // an accent-quoted name: `+`, `type`
                let p = scan::find3(src.bytes(), ptr + 1, end, b'`', b'\n', b'\r');
                // SAFETY: the scan stops at or before the input end, so this
                // read and the one at `p + 1` below stay inside the slack.
                if unsafe { src.byte_unchecked(p) } == b'`' && p < end {
                    ptr = p + 1;
                    recs.tok(tok::PUNCTUATION_SPECIAL, lhs + 1);
                    recs.emit(
                        if decl {
                            tok::FUNCTION_DEFINITION
                        } else if unsafe { src.byte_unchecked(ptr) } == b'(' {
                            tok::FUNCTION
                        } else {
                            tok::VARIABLE
                        },
                        lhs + 1,
                        p,
                    );
                    recs.tok(tok::PUNCTUATION_SPECIAL, ptr);
                    name_end = ptr;
                    if decl {
                        def_end = ptr;
                        sig.fn_pend = true;
                        sig.fn_angle = 0;
                    }
                } else {
                    ptr += 1;
                    recs.tok(tok::NONE, ptr);
                }
            }
            // SAFETY: `ptr + 2` lies inside the slack (see above).
            class::BRACKET
                if c == b'{' && c2 == b'.' && unsafe { src.byte_unchecked(ptr + 2) } != b'.' =>
            {
                // pragmas: `{.inline, raises: [].}`
                ptr += 2;
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
                pragma = 1;
            }
            class::OP if pragma != 0 && c == b'.' && c2 == b'}' => {
                ptr += 2;
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
                pragma = 0;
            }
            class::BRACKET => {
                // parameter machine: `(` may open the armed routine list and
                // puts the next name in parameter position; `[` right after
                // the name is a generic list; brackets inside a marked list
                // obscure its top level
                if c == b'(' {
                    sig.parens = sig.parens.wrapping_add(1);
                    if sig.fn_angle == 0 {
                        if sig.fn_pend {
                            sig.mark();
                        }
                        sig.fn_pend = false;
                    }
                    sig.pattern = true;
                } else {
                    sig.pattern = false;
                    if c == b')' {
                        if sig.active() {
                            sig.unmark();
                        }
                        if sig.parens != 0 {
                            sig.parens -= 1;
                        }
                    } else if sig.fn_pend {
                        if c == b'[' {
                            sig.fn_angle = sig.fn_angle.wrapping_add(1);
                        } else if c == b']' {
                            sig.fn_angle = sig.fn_angle.saturating_sub(1);
                        } else {
                            sig.fn_pend = false;
                        }
                    } else if sig.active() {
                        if c == b'[' || c == b'{' {
                            sig.obscure = sig.obscure.wrapping_add(1);
                        } else if sig.obscure != 0 {
                            sig.obscure -= 1;
                        }
                    }
                }
                if c == b'(' || c == b'[' || c == b'{' {
                    depth = depth.wrapping_add(1);
                } else {
                    depth = depth.saturating_sub(1);
                }
                ptr += 1;
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
            }
            class::DELIMITER => {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                // both separate parameters: `(a, b: int; c = 1)`
                sig.pattern = true;
                if pragma == 2 {
                    pragma = 1;
                }
                if import != 0 {
                    import = if c == b',' { 2 } else { 0 };
                }
            }
            class::OP => {
                sig.pattern = false;
                // an export marker right after a name: `proc run*(`,
                // `field*: int`
                if c == b'*' && lhs == name_end && (lhs == def_end || EXPORT_NEXT[c2 as usize]) {
                    ptr += 1;
                    recs.tok(tok::PUNCTUATION_SPECIAL, ptr);
                    continue;
                }
                ptr += 1;
                // SAFETY: the NUL at the input end stops the run.
                while OPS[unsafe { src.byte_unchecked(ptr) } as usize] {
                    ptr += 1;
                }
                // a lone `.` or `:` is punctuation
                if ptr - lhs == 1 && (c == b'.' || c == b':') {
                    recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                    after_dot = c == b'.';
                } else {
                    recs.tok(tok::OPERATOR, ptr);
                }
            }
            class::NUL if ptr >= end => break,
            _ => {
                ptr += 1;
                recs.tok(tok::NONE, ptr);
            }
        }
    }
    recs.store(inst);
}
