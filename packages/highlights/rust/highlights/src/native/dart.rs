//! WAT sources: src/langs/dart.wat src/common.wat src/scan.wat
//!
//! Native Dart lexer. One pass over the input: each token is scanned and
//! colored in the same step, with the same rules, in the same order, as the
//! translated `$hlDart`. The records equal the translated lexer's records.
//!
//! The WAT tests its rules in one long chain. Each rule matches its own
//! first bytes, so this lexer dispatches on the first byte's class and, for
//! each class, tests only the rules that can match it, in the WAT's order.
//! A string's body is scanned right after its opener, and again right after
//! the `}` that closes one of its `${…}` interpolations; the WAT scans it at
//! the top of its loop, which comes to the same thing.

use super::Lexer;
use super::scan;
use super::tables::byteset;
use crate::Rec;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::DART_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "dart" => Some(highlight),
        _ => None,
    }
}

/// `$dartWords` as a perfect hash on a word's bytes. A word of up to 16
/// bytes is two little-endian integers, `lo` (bytes 0-7) and `hi` (bytes
/// 8-15), zero past its end; identifiers hold no NUL, so equal integers
/// mean equal words. Each word has its own slot, found from `lo` alone.
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    /// The word's color and capture from its group (`$dartWordHl`), with
    /// [`CONTEXTUAL`] and [`QUOTED`] for the groups that need a word after
    /// them.
    values: [i32; WORD_SLOTS],
    /// For each first byte, a bit per length of the words starting with it.
    lengths: [u32; 256],
    mul: u64,
}

const WORD_SLOTS: usize = 1024;

/// The longest word.
const WORD_MAX: usize = 12;

/// The slot of the word whose first 8 bytes are `lo`.
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

/// The words, placed by searching for a multiplier that gives each its own
/// slot.
static WORDS: Words = {
    let n = DART_WORDS.len();
    let mut lengths = [0u32; 256];
    let mut i = 0;
    while i < n {
        let w = word_entry(i).0;
        assert!(w.len() <= WORD_MAX);
        lengths[w[0] as usize] |= 1 << w.len();
        i += 1;
    }
    let mut mul: u64 = 0x2545_f491_4f6c_dd1d;
    let mut attempt = 0;
    'search: loop {
        assert!(attempt < 100_000, "no collision-free hash: use more slots");
        let mut keys = [(0u64, 0u64); WORD_SLOTS];
        let mut values = [-1i32; WORD_SLOTS];
        let mut i = 0;
        while i < n {
            let (w, value) = word_entry(i);
            let (lo, hi) = word_key(w);
            let s = word_slot(lo, mul);
            if keys[s].0 != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            keys[s] = (lo, hi);
            values[s] = value;
            i += 1;
        }
        break Words {
            keys,
            values,
            lengths,
            mul,
        };
    }
};

/// Word `i` of the table, with its value in [`Words::values`].
const fn word_entry(i: usize) -> (&'static [u8], i32) {
    let g = DART_WORDS[i].group as u32;
    let flags = if g == 3 || g >= 11 { CONTEXTUAL } else { 0 } | if g == 11 { QUOTED } else { 0 };
    (DART_WORDS[i].word, word_hl(g) | flags)
}

/// A word value flag: `get`/`set`, `on`, and `show`/`hide`/`part` are
/// keywords only before a name.
const CONTEXTUAL: i32 = 1 << 16;
/// A word value flag: `show`/`hide`/`part` are keywords before a quote too.
const QUOTED: i32 = 1 << 17;

/// The value in [`Words::values`] of the word `[lhs, rhs)`, or -1 when it
/// is none (`keyword-table.get $dartWords`, `$dartWordHl`).
#[inline(always)]
fn word_kind(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    if n > WORD_MAX || WORDS.lengths[at(src, lhs) as usize] >> n & 1 == 0 {
        return -1;
    }
    // SAFETY: `lhs` lies inside the input, so 16 bytes from it lie inside
    // the slack.
    let (lo, hi) = unsafe {
        let p = src.as_ptr().add(lhs);
        (
            p.cast::<u64>().read_unaligned(),
            p.add(8).cast::<u64>().read_unaligned(),
        )
    };
    let lo = u64::from_le(lo) & if n >= 8 { u64::MAX } else { (1 << (8 * n)) - 1 };
    // (`n` is at most 12, so the shift stays below 64)
    let hi = u64::from_le(hi) & ((1 << (8 * n.saturating_sub(8))) - 1);
    let s = word_slot(lo, WORDS.mul);
    if WORDS.keys[s] == (lo, hi) {
        WORDS.values[s]
    } else {
        -1
    }
}

/// Operator bytes (`$dartIsOp`).
static OPS: [bool; 256] = byteset(b"!%&*+-/<=>?^|~");

/// Operator bytes that double: `&&`, `++`, `--`, `<<`, `>>`, `??`, `||`.
static DOUBLES: [bool; 256] = byteset(b"&+-<>?|");

/// Byte classes for the main dispatch.
mod class {
    /// An identifier start: a letter, `_`, `$`, or any byte from 0x80. An
    /// `r` may also open a raw string.
    pub const IDENT: u8 = 0;
    /// Anything else: one byte colored `none`.
    pub const OTHER: u8 = 1;
    pub const DIGIT: u8 = 2;
    pub const SLASH: u8 = 3;
    /// `"` or `'`.
    pub const QUOTE: u8 = 4;
    pub const AT: u8 = 5;
    /// `(`, `)`, `[`, `]`, `{`, or `}`.
    pub const BRACKET: u8 = 6;
    /// `,` or `;`.
    pub const DELIMITER: u8 = 7;
    pub const COLON: u8 = 8;
    pub const DOT: u8 = 9;
    /// `?`: `?.` is member access, else an operator.
    pub const QUESTION: u8 = 10;
    /// Any other operator byte (`$dartIsOp`).
    pub const OP: u8 = 11;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 12;
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
        } else {
            match b {
                0 => class::NUL,
                b'/' => class::SLASH,
                b'"' | b'\'' => class::QUOTE,
                b'@' => class::AT,
                b'(' | b')' | b'[' | b']' | b'{' | b'}' => class::BRACKET,
                b',' | b';' => class::DELIMITER,
                b':' => class::COLON,
                b'.' => class::DOT,
                b'?' => class::QUESTION,
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
        t[c] = is_ident_continue(c as u8);
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

/// Whether `c` continues an identifier (`$lexIsIdentContinue`).
#[inline(always)]
const fn is_ident_continue(c: u8) -> bool {
    is_ident_start(c) || is_digit(c)
}

/// Whether `c` is ASCII whitespace: space or TAB through CR (`$lexIsSpace`).
#[inline(always)]
const fn is_space(c: u8) -> bool {
    c == b' ' || c.wrapping_sub(9) <= 4
}

/// Whether `c` is an ASCII capital letter.
#[inline(always)]
const fn is_upper(c: u8) -> bool {
    c.wrapping_sub(b'A') <= 25
}

/// Token records written through a moving pointer into `inst.ext.recs`,
/// the way the translated `$emitTok` and `$emitGap` write them: a token
/// extends the last record when its color matches, and whitespace extends
/// the last record whatever its color. The vector has room for one record
/// per input byte and every record covers at least one byte, so running
/// out of room means a lexer bug, which traps.
#[derive(Clone, Copy)]
struct Out {
    cur: *mut Rec,
    limit: *mut Rec,
    /// Token of the last record, or `u32::MAX` when there is none.
    last: u32,
}

impl Out {
    fn load(inst: &mut Instance) -> Self {
        let v = &mut inst.ext.recs;
        let ptr = v.as_mut_ptr();
        Out {
            // SAFETY: `len` records are written; `capacity` is one past
            // the allocation.
            cur: unsafe { ptr.add(v.len()) },
            limit: unsafe { ptr.add(v.capacity()) },
            last: v.last().map_or(u32::MAX, |r| r.token),
        }
    }

    fn store(self, inst: &mut Instance) {
        let v = &mut inst.ext.recs;
        // SAFETY: the records before `cur` are written, within the
        // capacity.
        unsafe { v.set_len(self.cur.offset_from(v.as_ptr()) as usize) };
    }

    /// Append a non-empty token ending at `end` (`$emitTok`).
    #[inline(always)]
    fn tok(&mut self, hl: u32, end: usize) {
        // SAFETY: `cur` stays within the vector's capacity: a merge steps
        // back over the last record, and the trap stops a write at the
        // limit.
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

    /// The token `[lhs, rhs)` when it is not empty (`$emitTok`).
    #[inline(always)]
    fn tok_from(&mut self, hl: u32, lhs: usize, rhs: usize) {
        if lhs < rhs {
            self.tok(hl, rhs);
        }
    }

    /// Whitespace up to `end` extends the last record (`$emitGap`).
    ///
    /// # Safety
    ///
    /// A record must exist.
    #[inline(always)]
    unsafe fn extend(&mut self, end: usize) {
        // SAFETY: the caller guarantees the record before `cur`.
        unsafe { (*self.cur.sub(1)).end = end as u32 };
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
    // SAFETY: each 16-byte load starts at or before the NUL after the
    // input, inside the slack.
    unsafe {
        loop {
            let v = V::load(src.as_ptr().add(p));
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
}

/// Skip spaces and tabs from `p` on the current line (`$lexSkipSpaceAt`).
#[inline(always)]
fn skip_space_at(src: &[u8], mut p: usize) -> usize {
    while at(src, p) == b' ' || at(src, p) == b'\t' {
        p += 1;
    }
    p
}

/// SCREAMING_CASE: at least two bytes, one uppercase letter, and only
/// `[A-Z0-9_]` (`$lexIsConstCase`).
#[inline(always)]
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

/// The end of the number at `lhs`: radix digits, separators, exponents,
/// and suffixes, with `.` only before a digit (`$lexScanNumber`,
/// `$lexScanNumberBody`).
#[inline(always)]
fn number_end(src: &[u8], lhs: usize) -> usize {
    let hex = at(src, lhs) == b'0' && at(src, lhs + 1) | 32 == b'x';
    let mut p = lhs;
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

/// The end of the nested block comment whose `/*` is at `lhs`: through the
/// `*/` that balances it, or the end. Pairs are found left to right, each
/// consuming both its bytes (`$lexNestedBlockComment`, `$lexNestedScan`).
#[inline(never)]
fn nested_comment_end(src: &[u8], lhs: usize, end: usize) -> usize {
    let mut p = lhs + 2;
    let mut depth = 1u32;
    loop {
        // the earliest `/*` or `*/` at or after `p`
        loop {
            p = scan::find3(src, p, end, b'/', b'*', b'*');
            if p + 1 >= end || matches!((at(src, p), at(src, p + 1)), (b'/', b'*') | (b'*', b'/')) {
                break;
            }
            p += 1;
        }
        if p + 1 >= end {
            return end;
        }
        if at(src, p) == b'/' {
            depth += 1;
            p += 2;
            continue;
        }
        depth -= 1;
        p += 2;
        if depth == 0 {
            return p;
        }
    }
}

/// The end of the name run from `p` inside a string template: letters,
/// digits, `_`, and bytes from 0x80, but not `$` (`$scanIdentRun` with
/// `_`). The NUL after the input ends every run.
#[inline(always)]
fn template_name_end(src: &[u8], mut p: usize) -> usize {
    loop {
        let c = at(src, p);
        if !IDENT_CONT[c as usize] || c == b'$' {
            return p;
        }
        p += 1;
    }
}

/// The first byte from `p` that is one of `set`, or `end`.
#[inline(always)]
fn find_any(src: &[u8], mut p: usize, end: usize, set: [u8; 6]) -> usize {
    while p < end {
        // SAFETY: `p` lies before the input end, so 16 bytes from it lie
        // inside the slack.
        let w = unsafe { V::load(src.as_ptr().add(p)) };
        let hit = (w.eq(V::splat(set[0])).or(w.eq(V::splat(set[1]))))
            .or(w.eq(V::splat(set[2])).or(w.eq(V::splat(set[3]))))
            .or(w.eq(V::splat(set[4])).or(w.eq(V::splat(set[5]))));
        let k = hit.first();
        if k < 16 {
            return (p + k).min(end);
        }
        p += 16;
    }
    p.min(end)
}

/// A `$` at `p` in a string body whose bytes from `seg` are not yet
/// emitted: `${` opens an interpolation unless `nested`, `$name` is a
/// variable, and any other `$` is string text. Returns the position after
/// it and the start of the body's unemitted bytes, or `None` after emitting
/// `${` (`$stringDollarAt` with dialect 0).
#[inline(always)]
fn string_dollar_at(
    src: &[u8],
    out: &mut Out,
    seg: usize,
    p: usize,
    nested: bool,
) -> (usize, Option<usize>) {
    let c2 = at(src, p + 1);
    if c2 == b'{' && !nested {
        out.tok_from(tok::STRING, seg, p);
        out.tok(tok::PUNCTUATION_SPECIAL, p + 2);
        return (p + 2, None);
    }
    if is_ident_start(c2) && c2 != b'$' {
        out.tok_from(tok::STRING, seg, p);
        let e = template_name_end(src, p + 1);
        out.tok(tok::VARIABLE, e);
        return (e, Some(e));
    }
    (p + 1, Some(seg))
}

/// Whether the operator `[lhs, rhs)` is made only of `<`, `>`, and `?`
/// (`$lexIsTypeGlue`).
#[inline(always)]
fn is_type_glue(src: &[u8], lhs: usize, rhs: usize) -> bool {
    (lhs..rhs).all(|p| matches!(at(src, p), b'<' | b'>' | b'?'))
}

/// The color of a word of `group` and its next-name capture in the high
/// byte (1 = type, 2 = function), or -1 for an ordinary identifier
/// (`$dartWordHl`).
const fn word_hl(g: u32) -> i32 {
    (match g {
        0 => return -1,
        1 | 12 => tok::KEYWORD_CONTROL,
        11 | 4 => tok::KEYWORD_IMPORT,
        2 | 3 => tok::KEYWORD_DECLARATION | (g - 1) << 8,
        5 => tok::KEYWORD_DECLARATION,
        6 => tok::TYPE_BUILTIN,
        7 => tok::BOOLEAN,
        8 => tok::CONSTANT_BUILTIN,
        9 => tok::VARIABLE_SPECIAL,
        _ => tok::KEYWORD_OPERATOR,
    }) as i32
}

/// A string kind: its quote byte, [`TRIPLE`] for a `'''`/`"""` body, and
/// [`RAW`] for an `r` literal (`$strKind`).
const TRIPLE: u32 = 256;
const RAW: u32 = 512;

/// Scan a string body from `p`, its bytes from `p` on not yet emitted:
/// plain runs, escapes, and `$name` interpolations; a raw literal keeps
/// backslashes and dollars plain. Inside an interpolation (`nested`), `${`
/// stays text. Returns the end and whether a `${` that opens an
/// interpolation ended the scan; otherwise the body ends past its closing
/// quote, at a raw line break of a single-line string, or at the end
/// (`$dartStringBody`, `$stringEscapeAt`).
#[inline(never)]
fn string_body(
    src: &[u8],
    out: &mut Out,
    mut p: usize,
    end: usize,
    kind: u32,
    nested: bool,
) -> (usize, bool) {
    let mut seg = p;
    let q = kind as u8;
    let triple = kind & TRIPLE != 0;
    let raw = kind & RAW != 0;
    // the stop bytes: the quote, plus backslash and `$` unless raw, plus
    // CR/LF in a single-line string
    let (e, d) = if raw { (q, q) } else { (b'\\', b'$') };
    let (n, r) = if triple { (q, q) } else { (b'\n', b'\r') };
    let set = [q, e, n, r, d, q];
    loop {
        p = find_any(src, p, end, set);
        if p >= end {
            break;
        }
        let c = at(src, p);
        if c == q {
            if !triple || (at(src, p + 1) == q && at(src, p + 2) == q) {
                p += if triple { 3 } else { 1 };
                break;
            }
            p += 1;
            continue;
        }
        // a raw line break ends a single-line string, unconsumed
        if c == b'\n' || c == b'\r' {
            break;
        }
        if c == b'\\' {
            out.tok_from(tok::STRING, seg, p);
            p = escape_end(src, p, end);
            out.tok(tok::STRING_ESCAPE, p);
            seg = p;
            continue;
        }
        // `$`: an interpolation when a brace or a name follows
        let (np, s) = string_dollar_at(src, out, seg, p, nested);
        p = np;
        match s {
            Some(s) => seg = s,
            None => return (p, true),
        }
    }
    out.tok_from(tok::STRING, seg, p);
    (p, false)
}

/// Lex the Dart input of `len` bytes at `base` (`$hlDart`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, which is not
    // reallocated while this lexer runs: it calls no translated code.
    let src: &[u8] = unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) };
    let end = len;
    let mut out = Out::load(inst);

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src, 0, end);
    if ptr > 0 {
        out.tok(tok::NONE, ptr);
    }
    // Leading whitespace; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    if first > ptr {
        if ptr == 0 {
            out.tok(tok::NONE, first);
        } else {
            // SAFETY: the leading continuation wrote a record.
            unsafe { out.extend(first) };
        }
    }
    ptr = first;

    // the pending next-name capture: 1 = type, 2 = function
    let mut expect = 0u32;
    // right after `.`, `?.`, or a cascade
    let mut member = false;
    // right after a type, through the glue of a generic, nullable, or
    // qualified type
    let mut after_type = false;
    // brace depth inside a `${…}` interpolation, 0 outside one
    let mut interp = 0u32;
    // the string an interpolation returns to (`$strKind`)
    let mut interp_kind = 0u32;

    // Call the out-of-line helper `f(src, out, args…)` on a copy of `out`,
    // then take the copy back, so `out` itself never leaves registers.
    macro_rules! with_copy {
        ($f:ident($($a:expr),*)) => {{
            let mut copy = out;
            let r = $f(src, &mut copy, $($a),*);
            out = copy;
            r
        }};
    }
    // The string body of `kind` from `ptr` (the `$strKind` step at the top
    // of `$hlDart`'s loop): a `${` that opens an interpolation leaves its
    // expression to the loop.
    macro_rules! string_body {
        ($kind:expr) => {{
            let kind: u32 = $kind;
            let (p, opened) = with_copy!(string_body(ptr, end, kind, interp != 0));
            ptr = p;
            if opened {
                interp_kind = kind;
                interp = 1;
            }
        }};
    }
    // The string opener at `ptr` - an optional `r`, then one or three
    // quotes - and its body.
    macro_rules! string {
        () => {{
            let mut kind = 0;
            if at(src, ptr) == b'r' {
                kind = RAW;
                ptr += 1;
            }
            let q = at(src, ptr);
            kind |= q as u32;
            if at(src, ptr + 1) == q && at(src, ptr + 2) == q {
                kind |= TRIPLE;
                ptr += 3;
            } else {
                ptr += 1;
            }
            out.tok(tok::STRING, ptr);
            member = false;
            after_type = false;
            string_body!(kind);
        }};
    }

    loop {
        let gap = ptr;
        let mut c = at(src, ptr);
        if c == b' ' && !is_space(at(src, ptr + 1)) {
            ptr += 1;
            // SAFETY: a record precedes every gap after the first token.
            unsafe { out.extend(ptr) };
            c = at(src, ptr);
        } else if is_space(c) {
            ptr = whitespace_end(src, ptr + 1);
            // SAFETY: as above.
            unsafe { out.extend(ptr) };
            c = at(src, ptr);
        }
        let lhs = ptr;
        let class = CLASS[c as usize];

        // Names, the most common tokens, skip the jump table.
        if class == class::IDENT {
            if c == b'r' && matches!(at(src, ptr + 1), b'"' | b'\'') {
                string!();
                continue;
            }
            let rhs = ident_end(src, ptr + 1);
            ptr = rhs;
            let next = at(src, skip_space_at(src, rhs));
            let mut kind = word_kind(src, lhs, rhs);
            // `get`/`set`, `on`, and `show`/`hide`/`part` are keywords only
            // before a name - or, for `part`, its quoted path
            if kind >= CONTEXTUAL {
                kind = if is_ident_start(next)
                    || (kind & QUOTED != 0 && (next == b'"' || next == b'\''))
                {
                    kind & 0xffff
                } else {
                    -1
                };
            }
            let hl;
            if kind >= 0 {
                hl = (kind & 255) as u32;
                // a bare keyword either arms the next-name capture or ends
                // it; `x.new` names nothing
                if !member {
                    expect = kind as u32 >> 8;
                }
                after_type = hl == tok::TYPE_BUILTIN;
            } else if expect != 0 {
                hl = if expect == 1 {
                    tok::TYPE
                } else {
                    tok::FUNCTION_DEFINITION
                };
                after_type = expect == 1;
                expect = 0;
            } else if member {
                // `Foo.bar(` is a method, `Foo.Bar` a nested or prefixed
                // type, `obj.field` a field
                if next == b'(' {
                    hl = tok::FUNCTION_METHOD;
                    after_type = false;
                } else {
                    after_type = is_upper(c);
                    hl = if after_type { tok::TYPE } else { tok::PROPERTY };
                }
            } else if next == b'(' {
                // `Foo(` is a constructor; a lowercase name after a type is
                // the function being declared
                hl = if is_upper(c) {
                    tok::TYPE
                } else if after_type {
                    tok::FUNCTION_DEFINITION
                } else {
                    tok::FUNCTION
                };
                after_type = false;
            } else if (is_upper(c) || c == b'_') && is_const_case(src, lhs, rhs) {
                // (only `[A-Z_]` can start a constant name)
                hl = tok::CONSTANT;
                after_type = false;
            } else {
                after_type = is_upper(c);
                hl = if after_type { tok::TYPE } else { tok::VARIABLE };
            }
            out.tok(hl, rhs);
            member = false;
            // `(` right after a name: its rule runs here, without the gap
            // and dispatch steps
            if at(src, ptr) == b'(' {
                ptr += 1;
                out.tok(tok::PUNCTUATION_BRACKET, ptr);
                after_type = false;
                expect = 0;
            }
            continue;
        }

        let c2 = at(src, ptr + 1);
        match class {
            class::BRACKET => {
                ptr += 1;
                if interp != 0 {
                    if c == b'{' {
                        interp += 1;
                    }
                    if c == b'}' {
                        interp -= 1;
                        if interp == 0 {
                            // the brace matching `${` returns to the string
                            // body
                            out.tok(tok::PUNCTUATION_SPECIAL, ptr);
                            member = false;
                            expect = 0;
                            after_type = false;
                            let kind = interp_kind;
                            interp_kind = 0;
                            string_body!(kind);
                            continue;
                        }
                    }
                }
                out.tok(tok::PUNCTUATION_BRACKET, ptr);
                member = false;
                // list brackets keep a type pending; the others end it along
                // with any declaration head
                if c != b'[' && c != b']' {
                    after_type = false;
                    expect = 0;
                }
            }
            class::DELIMITER => {
                ptr += 1;
                out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                member = false;
                expect = 0;
                if c == b';' {
                    after_type = false;
                }
            }
            class::COLON => {
                ptr += 1;
                out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                member = false;
                after_type = false;
            }
            class::DOT | class::DIGIT if class == class::DIGIT || is_digit(c2) => {
                ptr = number_end(src, ptr);
                out.tok(tok::NUMBER, ptr);
                member = false;
                after_type = false;
            }
            // `.` member access, `..` cascade, `...` spread
            class::DOT => {
                // (the byte two on, or 0 past the end)
                let c3 = if ptr + 2 < end { at(src, ptr + 2) } else { 0 };
                ptr += 1;
                if c2 == b'.' {
                    ptr += 1;
                    if c3 == b'.' {
                        ptr += 1;
                    }
                    out.tok(tok::OPERATOR, ptr);
                    after_type = false;
                } else {
                    out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                }
                // a cascade names a member too; a spread does not
                member = c3 != b'.';
            }
            class::QUESTION if c2 == b'.' => {
                ptr += 2;
                out.tok(tok::OPERATOR, ptr);
                member = true;
                after_type = false;
            }
            class::QUOTE => {
                // a one-line literal without escapes or `$` is one token
                let close = find_any(src, ptr + 1, end, [c, b'\\', b'\n', b'\r', b'$', c]);
                if at(src, close) == c && c2 != c {
                    ptr = close + 1;
                    out.tok(tok::STRING, ptr);
                    member = false;
                    after_type = false;
                } else {
                    string!();
                }
            }
            class::SLASH if c2 == b'/' => {
                let doc = at(src, ptr + 2) == b'/';
                ptr = scan::line_end(src, ptr + 2, end);
                out.tok(if doc { tok::COMMENT_DOC } else { tok::COMMENT }, ptr);
            }
            class::SLASH if c2 == b'*' => {
                // Dart block comments nest
                let doc = at(src, ptr + 2) == b'*' && at(src, ptr + 3) != b'/';
                ptr = nested_comment_end(src, ptr, end);
                out.tok(if doc { tok::COMMENT_DOC } else { tok::COMMENT }, ptr);
            }
            class::AT if is_ident_start(c2) => {
                // annotations
                ptr = ident_end(src, ptr + 1);
                out.tok(tok::ATTRIBUTE, ptr);
                member = false;
            }
            class::OP | class::SLASH | class::QUESTION => {
                ptr += 1;
                if (c == b'=' && c2 == b'>') || (c == b'~' && c2 == b'/') {
                    ptr += 1;
                    if c == b'~' && at(src, ptr) == b'=' {
                        ptr += 1;
                    }
                } else if c2 == b'=' || (c == c2 && DOUBLES[c as usize]) {
                    // two bytes in, so the third is `c3`
                    let c3 = at(src, ptr + 1);
                    ptr += 1;
                    if (c == b'>' || c == b'?') && (c3 == b'>' || c3 == b'=') {
                        ptr += 1;
                        if c == b'>' && at(src, ptr) == b'=' {
                            ptr += 1;
                        }
                    }
                    if c == b'<' && c3 == b'=' {
                        ptr += 1;
                    }
                }
                out.tok(tok::OPERATOR, ptr);
                member = false;
                // the angles of a generic - `>>` closes two - and a nullable
                // `?` keep the type pending; any other operator ends it, and
                // so does a spaced one: `count > limit()`
                if !is_type_glue(src, lhs, ptr) || gap != lhs {
                    after_type = false;
                }
            }
            class::NUL if ptr >= end => break,
            _ => {
                ptr += 1;
                out.tok(tok::NONE, ptr);
                member = false;
                after_type = false;
            }
        }
    }
    out.store(inst);
}
