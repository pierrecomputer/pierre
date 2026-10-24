//! WAT sources: src/langs/nim.wat src/common.wat src/scan.wat src/sig.wat
//!
//! Native Nim highlighter. One pass over the input: each token is scanned
//! and colored in the same step, with the same rules, in the same order, as
//! the translated `$hlNim`. The records equal the translated lexer's
//! records.

use super::Lexer;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
use crate::Rec;
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
fn word_value(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    if n > WORD_MAX || WORD_LENGTHS[at(src, lhs) as usize] >> n & 1 == 0 {
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

/// The byte at `i`. Every caller reads at most 16 bytes past the input
/// end, which the 96-byte input slack covers. The byte at the input end is
/// NUL, which matches none of the bytes a lookahead tests, so a lookahead
/// one byte past a token needs no bounds check (`$templateByte` returns 0
/// at and past the end).
#[inline(always)]
fn at(src: &[u8], i: usize) -> u8 {
    debug_assert!(i < src.len());
    // SAFETY: `i` lies inside the input or its slack (see above).
    unsafe { *src.get_unchecked(i) }
}

/// The byte at `i`, or 0 at and past `end` (`$templateByte`), for
/// lookaheads that may start past the NUL.
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

/// The end of the name run from `p`: `[A-Za-z0-9_]` and bytes from 0x80
/// (`$scanIdentRun` with `_`). The NUL after the input ends every run.
#[inline(always)]
fn name_run_end(src: &[u8], mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..4 {
        if !NAME_CONT[at(src, p) as usize] {
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
            let next = at(src, p + 1);
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

/// Whether the gap `[p, stop)` holds a CR or LF (`$lexGapHasBreak`).
#[inline(always)]
fn gap_has_break(src: &[u8], p: usize, stop: usize) -> bool {
    (p..stop).any(|i| matches!(at(src, i), b'\n' | b'\r'))
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

/// The end of the escape at backslash `p`: `\xHH`, `\uHHHH`, `\u{H..}`, a
/// decimal code, or one character; a backslash before a line break escapes
/// nothing (`$nimEscapeEnd`, `$lexEscapeEnd`).
fn escape_end(src: &[u8], p: usize, end: usize) -> usize {
    if p + 1 < end {
        let c = at(src, p + 1);
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
    let mut e = scan::utf8_span_end(src, p + 2, end);
    if e == p + 2 && at(src, p + 1) == b'\r' && e < end && at(src, e) == b'\n' {
        e += 1;
    }
    e
}

/// The `"` string from `lhs`, whose body starts at `p`: it ends at its
/// quote or, unterminated, before the line break; escapes are their own
/// tokens. Returns the end (`$hlNim`'s string rule).
#[inline(never)]
fn string(src: &[u8], mut recs: Recs, mut lhs: usize, mut p: usize, end: usize) -> (Recs, usize) {
    loop {
        p = scan::string_special(src, p, end, b'"');
        if p >= end {
            break;
        }
        let c = at(src, p);
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
fn triple_end(src: &[u8], mut p: usize, end: usize) -> usize {
    loop {
        p = scan::find3(src, p, end, b'"', b'"', b'"');
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
fn raw_string_end(src: &[u8], mut p: usize, end: usize) -> usize {
    loop {
        p = scan::find3(src, p, end, b'"', b'\n', b'\r');
        if p >= end || at(src, p) != b'"' {
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
fn block_comment_end(src: &[u8], mut p: usize, end: usize, doc: bool) -> usize {
    let mut depth = 1u32;
    loop {
        // the next `#[` or `]#`: hop between `#` and `]` bytes
        p = scan::find3(src, p, end, b'#', b']', b'#');
        if p + 1 >= end {
            return end;
        }
        let (a, b) = (at(src, p), at(src, p + 1));
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
    // Leading whitespace (no import statement is open yet); every later gap
    // follows a token's record.
    let first = whitespace_end(src, ptr);
    gap!(ptr, first);
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

    loop {
        let gap = ptr;
        let s = at(src, ptr);
        if s == b' ' && !is_space(at(src, ptr + 1)) {
            // one space
            ptr += 1;
            extend!(ptr);
        } else if is_space(s) {
            ptr = whitespace_end(src, ptr + 1);
            // an import statement ends at a line break outside brackets
            // unless its last token was a comma
            if import == 1 && depth == 0 && gap_has_break(src, gap, ptr) {
                import = 0;
            }
            extend!(ptr);
        }
        let lhs = ptr;
        let c = at(src, ptr);
        let c2 = at(src, ptr + 1);
        let class = CLASS[c as usize];

        if class == class::HASH {
            if c2 == b'[' {
                ptr = block_comment_end(src, ptr + 2, end, false);
                emit!(tok::COMMENT, ptr);
            } else if c2 == b'#' && at(src, ptr + 2) == b'[' {
                ptr = block_comment_end(src, ptr + 3, end, true);
                emit!(tok::COMMENT_DOC, ptr);
            } else {
                // `$lexLineComment`, `$scanToLineEnd`
                ptr = scan::line_end(src, ptr + 1, end);
                emit!(
                    if c2 == b'#' {
                        tok::COMMENT_DOC
                    } else {
                        tok::COMMENT
                    },
                    ptr
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
                if at(src, ptr) == b'"' {
                    let p = ptr;
                    let mut lhs = lhs;
                    if !(p - lhs == 1 && c | 32 == b'r') {
                        emit!(tok::FUNCTION, p);
                        lhs = p;
                    }
                    ptr = if at(src, p + 1) == b'"' && byte(src, p + 2, end) == b'"' {
                        triple_end(src, p + 3, end)
                    } else {
                        raw_string_end(src, p + 1, end)
                    };
                    emit_span!(tok::STRING, lhs, ptr);
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
                        let call = at(src, ptr) == b'(';
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
                emit!(hl, ptr);
                sig.pattern = false;
            }
            class::DQUOTE => {
                if c2 == b'"' && at(src, ptr + 2) == b'"' {
                    ptr = triple_end(src, ptr + 3, end);
                    emit!(tok::STRING, ptr);
                } else {
                    ptr = with_recs!(|recs| string(src, recs, lhs, ptr + 1, end));
                }
            }
            class::SQUOTE => {
                // a character literal: `'a'`, `'\n'`; a lone `'` stays plain
                ptr += 1;
                let p = if c2 == b'\\' {
                    escape_end(src, ptr, end)
                } else {
                    scan::utf8_span_end(src, ptr + 1, end)
                };
                if byte(src, p, end) == b'\'' && !matches!(c2, b'\n' | b'\r' | b'\'') {
                    emit!(tok::STRING, ptr);
                    emit_span!(
                        if c2 == b'\\' {
                            tok::STRING_ESCAPE
                        } else {
                            tok::STRING
                        },
                        ptr,
                        p
                    );
                    ptr = p + 1;
                    emit!(tok::STRING, ptr);
                } else {
                    emit!(tok::NONE, ptr);
                }
            }
            class::DIGIT => {
                ptr = number_end(src, ptr);
                // a type suffix: `1'i32`, `0xff'u8`, `2.0'f64`
                if at(src, ptr) == b'\'' && is_ident_start(at(src, ptr + 1)) {
                    ptr = name_run_end(src, ptr + 1);
                }
                emit!(tok::NUMBER, ptr);
            }
            class::BACKTICK => {
                // an accent-quoted name: `+`, `type`
                let p = scan::find3(src, ptr + 1, end, b'`', b'\n', b'\r');
                if at(src, p) == b'`' && p < end {
                    ptr = p + 1;
                    emit!(tok::PUNCTUATION_SPECIAL, lhs + 1);
                    emit_span!(
                        if decl {
                            tok::FUNCTION_DEFINITION
                        } else if at(src, ptr) == b'(' {
                            tok::FUNCTION
                        } else {
                            tok::VARIABLE
                        },
                        lhs + 1,
                        p
                    );
                    emit!(tok::PUNCTUATION_SPECIAL, ptr);
                    name_end = ptr;
                    if decl {
                        def_end = ptr;
                        sig.fn_pend = true;
                        sig.fn_angle = 0;
                    }
                } else {
                    ptr += 1;
                    emit!(tok::NONE, ptr);
                }
            }
            class::BRACKET if c == b'{' && c2 == b'.' && at(src, ptr + 2) != b'.' => {
                // pragmas: `{.inline, raises: [].}`
                ptr += 2;
                emit!(tok::PUNCTUATION_BRACKET, ptr);
                pragma = 1;
            }
            class::OP if pragma != 0 && c == b'.' && c2 == b'}' => {
                ptr += 2;
                emit!(tok::PUNCTUATION_BRACKET, ptr);
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
                emit!(tok::PUNCTUATION_BRACKET, ptr);
            }
            class::DELIMITER => {
                ptr += 1;
                emit!(tok::PUNCTUATION_DELIMITER, ptr);
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
                    emit!(tok::PUNCTUATION_SPECIAL, ptr);
                    continue;
                }
                ptr += 1;
                while OPS[at(src, ptr) as usize] {
                    ptr += 1;
                }
                // a lone `.` or `:` is punctuation
                if ptr - lhs == 1 && (c == b'.' || c == b':') {
                    emit!(tok::PUNCTUATION_DELIMITER, ptr);
                    after_dot = c == b'.';
                } else {
                    emit!(tok::OPERATOR, ptr);
                }
            }
            class::NUL if ptr >= end => break,
            _ => {
                ptr += 1;
                emit!(tok::NONE, ptr);
            }
        }
    }
    // SAFETY: the records before `cur` are written.
    unsafe { inst.ext.recs.set_len(cur.offset_from(rp) as usize) };
}
