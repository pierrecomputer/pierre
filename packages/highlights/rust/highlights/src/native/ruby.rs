//! WAT sources: src/langs/ruby.wat src/common.wat src/scan.wat
//!
//! Native Ruby highlighter. One pass over the input with the same rules,
//! in the same order, as the translated `$hlRuby`; the records equal the
//! translated lexer's records.

#[cfg(target_arch = "aarch64")]
use core::arch::aarch64::*;

use super::Lexer;
use super::scan;
use super::tables::byteset;
use crate::Rec;
use crate::generated::Instance;
use crate::token_ids as tok;
use crate::wat_tables::RUBY_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "ruby" => Some(highlight),
        _ => None,
    }
}

/// `$rubyWords` as a perfect hash on a word's bytes. A word of up to 16
/// bytes is two little-endian integers, `lo` (bytes 0-7) and `hi` (bytes
/// 8-15), zero past its end; words hold no NUL, so equal integers mean
/// equal words.
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    /// The word's 1-based group.
    groups: [u8; WORD_SLOTS],
    mul: u64,
}

const WORD_SLOTS: usize = 256;

/// The longest word.
const WORD_MAX: usize = 16;

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

/// For each first byte, a bit per length of the words in [`WORDS`]. A name
/// whose bit is clear is no word.
static WORD_LENGTHS: [u32; 256] = {
    let mut t = [0u32; 256];
    let mut i = 0;
    while i < RUBY_WORDS.len() {
        let w = RUBY_WORDS[i].word;
        assert!(w.len() <= WORD_MAX);
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
        let mut i = 0;
        while i < RUBY_WORDS.len() {
            let (lo, hi) = word_key(RUBY_WORDS[i].word);
            let s = word_slot(lo, mul);
            if keys[s].0 != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            keys[s] = (lo, hi);
            groups[s] = RUBY_WORDS[i].group;
            i += 1;
        }
        break Words { keys, groups, mul };
    }
};

/// The first `n` (1 to 8) bytes at `p` as a little-endian integer.
/// Reads 8 bytes, which the input slack allows.
#[inline(always)]
fn word_at(src: &[u8], p: usize, n: usize) -> u64 {
    debug_assert!(p + 8 <= src.len() && (1..=8).contains(&n));
    // SAFETY: `p` lies at or before the input end, so `p + 8` lies inside
    // the slack.
    let w = u64::from_le(unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() });
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

/// The `$rubyWords` group of the word `[lhs, rhs)`, or 0
/// (`keyword-table.get`).
#[inline(always)]
fn word_group(src: &[u8], lhs: usize, rhs: usize) -> u32 {
    let n = rhs - lhs;
    if n > WORD_MAX || WORD_LENGTHS[at(src, lhs) as usize] >> n & 1 == 0 {
        return 0;
    }
    let (lo, hi) = if n <= 8 {
        (word_at(src, lhs, n), 0)
    } else {
        (word_at(src, lhs, 8), word_at(src, lhs + 8, n - 8))
    };
    let s = word_slot(lo, WORDS.mul);
    if WORDS.keys[s] == (lo, hi) {
        WORDS.groups[s] as u32
    } else {
        0
    }
}

/// Operator bytes (`$rubyIsOp`).
const OPS: [bool; 256] = byteset(b"!%&*+-/<=>?^|~");
/// `%` literal letters of the interpolating kinds (`$rubyPercentKind`).
const PERCENT_INTERP: [bool; 256] = byteset(b"IQWrx");

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

/// Whether `c` is an uppercase ASCII letter.
#[inline(always)]
const fn is_upper(c: u8) -> bool {
    c.wrapping_sub(b'A') <= 25
}

/// The byte at `p`. Every caller reads at most 16 bytes past the input
/// end, which the 96-byte input slack covers. The byte at the input end is
/// NUL, which matches none of the bytes a lookahead tests, so a lookahead
/// one byte past a token needs no bounds check.
#[inline(always)]
fn at(src: &[u8], p: usize) -> u8 {
    debug_assert!(p < src.len());
    // SAFETY: `p` lies inside the input or its slack (see above).
    unsafe { *src.get_unchecked(p) }
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
    /// The first record.
    start: *mut Rec,
    limit: *mut Rec,
    /// Token of the last record, or `u32::MAX` when there is none.
    last: u32,
}

impl Out {
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

    /// A token `[lhs, rhs)`, skipped when empty (`$emitTok`).
    #[inline(always)]
    fn span(&mut self, hl: u32, lhs: usize, rhs: usize) {
        if lhs < rhs {
            self.tok(hl, rhs);
        }
    }

    /// Whitespace `[lhs, rhs)` extends the last record (`$emitGap`).
    #[inline(always)]
    fn gap(&mut self, lhs: usize, rhs: usize) {
        if lhs < rhs {
            if self.cur == self.start {
                self.tok(tok::NONE, rhs);
            } else {
                // SAFETY: a record precedes `cur`.
                unsafe { (*self.cur.sub(1)).end = rhs as u32 };
            }
        }
    }

    /// Whitespace up to `end` extends the last record, which exists.
    #[inline(always)]
    fn extend(&mut self, end: usize) {
        debug_assert!(self.cur > self.start);
        // SAFETY: a record precedes every gap after the first token.
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

/// Skip spaces and tabs from `p` on the current line (`$lexSkipSpaceAt`).
#[inline(always)]
fn skip_space_at(src: &[u8], mut p: usize) -> usize {
    while at(src, p) == b' ' || at(src, p) == b'\t' {
        p += 1;
    }
    p
}

/// The end of the number at `p` (`$lexScanNumber`, `$lexScanNumberBody`).
fn number_end(src: &[u8], mut p: usize) -> usize {
    let hex = at(src, p) == b'0' && at(src, p + 1) | 0x20 == b'x';
    let mut prev = 0u8;
    loop {
        let c = at(src, p);
        if is_ident_continue(c) {
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

/// The end of the escape at backslash `p` (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(src: &[u8], end: usize, p: usize) -> usize {
    let mut e = scan::utf8_span_end(src, p + 2, end);
    if e == p + 2 && at(src, p + 1) == b'\r' && e < end && at(src, e) == b'\n' {
        e += 1;
    }
    e
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

/// The first byte from `p` equal to one of `bytes`, or `end`.
#[inline(always)]
fn find_any(src: &[u8], mut p: usize, end: usize, bytes: [u8; 6]) -> usize {
    #[cfg(target_arch = "aarch64")]
    // SAFETY: each 16-byte load starts before `end`, inside the input or
    // its slack.
    unsafe {
        let b0 = vdupq_n_u8(bytes[0]);
        let b1 = vdupq_n_u8(bytes[1]);
        let b2 = vdupq_n_u8(bytes[2]);
        let b3 = vdupq_n_u8(bytes[3]);
        let b4 = vdupq_n_u8(bytes[4]);
        let b5 = vdupq_n_u8(bytes[5]);
        while p < end {
            let v = vld1q_u8(src.as_ptr().add(p));
            let hit = vorrq_u8(
                vorrq_u8(vceqq_u8(v, b0), vceqq_u8(v, b1)),
                vorrq_u8(
                    vorrq_u8(vceqq_u8(v, b2), vceqq_u8(v, b3)),
                    vorrq_u8(vceqq_u8(v, b4), vceqq_u8(v, b5)),
                ),
            );
            let k = scan::first_lane(hit);
            if k < 16 {
                return (p + k).min(end);
            }
            p += 16;
        }
        p.min(end)
    }
    #[cfg(not(target_arch = "aarch64"))]
    {
        while p < end && !bytes.contains(&src[p]) {
            p += 1;
        }
        p.min(end)
    }
}

/// An open literal body (`$sClose`, `$sOpen`, `$sDepth`, `$sFlags`).
#[derive(Clone, Copy, Default)]
struct Lit {
    close: u8,
    /// The byte that nests, or 0.
    open: u8,
    depth: u32,
    /// Bit 0: escapes and `#{}`; bit 1: a regex; bit 2: a symbol; bit 3:
    /// one line.
    flags: u32,
}

/// The color of a literal body with `flags`.
#[inline(always)]
fn lit_hl(flags: u32) -> u32 {
    if flags & 2 != 0 {
        tok::STRING_REGEX
    } else if flags & 4 != 0 {
        tok::STRING_SPECIAL_SYMBOL
    } else {
        tok::STRING
    }
}

/// Scan a literal body from `p` with the bytes since `seg` unemitted; returns
/// the end, the status (1 past the closer, 2 past a `#{`, 0 at the end or
/// at the line break of a one-line body) and the nesting depth still open
/// (`$rubyLiteralBody`). The WAT's two cached scans find the first closer,
/// opener, backslash, `#`, or line break that applies, as one scan does.
fn literal_body(
    src: &[u8],
    end: usize,
    mut out: Out,
    mut p: usize,
    mut seg: usize,
    lit: Lit,
    nested: bool,
) -> (usize, Out, u32, u32) {
    let Lit {
        close,
        open,
        mut depth,
        flags,
    } = lit;
    let hl = lit_hl(flags);
    let esc = flags & 1 != 0;
    let nl = flags & 8 != 0;
    let bytes = [
        close,
        if open != 0 { open } else { close },
        if esc { b'\\' } else { close },
        if esc { b'#' } else { close },
        if nl { b'\n' } else { close },
        if nl { b'\r' } else { close },
    ];
    let mut status = 0;
    loop {
        p = find_any(src, p, end, bytes);
        if p >= end {
            break;
        }
        let c = at(src, p);
        if c == close {
            if depth != 0 {
                depth -= 1;
                p += 1;
                continue;
            }
            p += 1;
            // a regex carries its flag letters
            if flags & 2 != 0 {
                p = ident_end(src, p).min(end).max(p);
            }
            status = 1;
            break;
        }
        if open != 0 && c == open {
            depth += 1;
            p += 1;
            continue;
        }
        if c == b'\n' || c == b'\r' {
            break;
        }
        if c == b'\\' {
            out.span(hl, seg, p);
            let e = escape_end(src, end, p);
            out.span(tok::STRING_ESCAPE, p, e);
            p = e;
            seg = p;
            continue;
        }
        // `#{` opens an interpolation
        if at(src, p + 1) == b'{' && p + 1 < end && !nested {
            out.span(hl, seg, p);
            p += 2;
            out.tok(tok::PUNCTUATION_SPECIAL, p);
            return (p, out, 2, depth);
        }
        p += 1;
    }
    out.span(hl, seg, p);
    (p, out, status, depth)
}

/// Consume lines from `p` through the one holding the delimiter `delim` as
/// one `hl` token; `mode` bit 0 allows indentation before it, bit 2 makes
/// it a word closer (`$rubyLineDelimited`, `$rubyRangeEq`,
/// `$lineDelimiterEnds`).
#[cold]
#[inline(never)]
fn line_delimited(
    src: &[u8],
    end: usize,
    mut out: Out,
    mut p: usize,
    delim: &[u8],
    mode: u32,
    hl: u32,
) -> (usize, Out) {
    let n = delim.len();
    let body = p;
    while p < end {
        let mut line = p;
        if mode & 1 != 0 {
            line = skip_space_at(src, line).min(end).max(line);
        }
        if line + n <= end
            && src[line..line + n] == *delim
            && delimiter_ends(src, end, line + n, mode)
        {
            out.span(hl, body, p);
            let lhs = p;
            p = scan::line_end(src, p, end);
            if p < end {
                p += 1;
            }
            out.span(hl, lhs, p);
            return (p, out);
        }
        p = scan::line_end(src, p, end);
        if p < end {
            p += 1;
        }
    }
    out.span(hl, body, p);
    (p, out)
}

/// Whether the delimiter ending at `p` closes the body
/// (`$lineDelimiterEnds`).
fn delimiter_ends(src: &[u8], end: usize, p: usize, trim: u32) -> bool {
    if p >= end {
        return true;
    }
    let c = src[p];
    if c == b'\n' || c == b'\r' {
        return true;
    }
    if trim & 4 != 0 {
        return is_space(c);
    }
    if trim & 8 != 0 {
        return (c | 32).wrapping_sub(b'a') > 25;
    }
    false
}

/// Whether a bare heredoc argument follows at `p` (`$lexHeredocArgument`).
fn heredoc_argument(src: &[u8], end: usize, mut p: usize) -> bool {
    let c = at(src, p);
    if c == b'"' || c == b'\'' {
        return true;
    }
    while p < end && is_ident_continue(src[p]) {
        p += 1;
    }
    p = skip_space_at(src, p);
    if p >= end {
        return true;
    }
    matches!(src[p], b'\n' | b'\r' | b';' | b',' | b')' | b'.' | b'#')
}

/// Whether the word at `p` can be a bare argument: not a keyword
/// (`$rubyArgWord`).
fn arg_word(src: &[u8], p: usize) -> bool {
    word_group(src, p, ident_end(src, p)) == 0
}

/// What a bare word sets, packed: its token (bits 0-7), the `decl` it opens
/// (bits 8-9: 1 after `def`, 2 after `class`/`module`), the `operand` that
/// follows (bits 16-17), and bit 31 to tell it from 0, an ordinary
/// identifier.
const fn word_info(hl: u32, decl: u32) -> u32 {
    // keywords and word operators expect a value next; `puts`-style
    // methods take a heredoc or literal argument
    let operand = if hl == tok::FUNCTION {
        2
    } else {
        (hl == tok::KEYWORD_CONTROL
            || hl == tok::KEYWORD_DECLARATION
            || hl == tok::KEYWORD_OPERATOR) as u32
    };
    hl | decl << 8 | operand << 16 | 1 << 31
}

/// [`word_info`] for each `$rubyWords` group (`$rubyWordHl`).
static GROUP_INFO: [u32; 10] = [
    0,
    word_info(tok::KEYWORD_CONTROL, 0),
    word_info(tok::KEYWORD_DECLARATION, 1),
    word_info(tok::KEYWORD_DECLARATION, 2),
    word_info(tok::KEYWORD_DECLARATION, 0),
    word_info(tok::KEYWORD_OPERATOR, 0),
    word_info(tok::BOOLEAN, 0),
    word_info(tok::CONSTANT_BUILTIN, 0),
    word_info(tok::VARIABLE_SPECIAL, 0),
    word_info(tok::FUNCTION, 0),
];

/// The [`word_info`] of a bare word, or 0 for an ordinary identifier
/// (`$rubyWordHl`).
#[inline(always)]
fn word_hl(src: &[u8], lhs: usize, rhs: usize) -> u32 {
    let g = word_group(src, lhs, rhs);
    if g == 0 {
        let n = rhs - lhs;
        if n >= 6 && word_at(src, lhs, 5) == word(b"attr_") {
            return word_info(tok::FUNCTION, 0);
        }
        if n >= 5 && word_at(src, lhs, 2) == word(b"__") && word_at(src, rhs - 2, 2) == word(b"__")
        {
            return word_info(tok::VARIABLE_SPECIAL, 0);
        }
        return 0;
    }
    GROUP_INFO[g as usize]
}

/// The closing delimiter for a literal opened with `open` (`$rubyCloser`).
#[inline(always)]
fn closer(open: u8) -> u8 {
    match open {
        b'(' => b')',
        b'[' => b']',
        b'{' => b'}',
        b'<' => b'>',
        _ => open,
    }
}

/// Lex the Ruby input of `len` bytes at `base` (`$hlRuby`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, and this
    // lexer calls no translated function that could reallocate it.
    let src: &[u8] = unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) };
    let v = &mut inst.ext.recs;
    let rp = v.as_mut_ptr();
    // SAFETY: the length and capacity bound the vector's allocation.
    let out = unsafe {
        Out {
            cur: rp.add(v.len()),
            start: rp,
            limit: rp.add(v.capacity()),
            last: v.last().map_or(u32::MAX, |r| r.token),
        }
    };
    let out = lex(src, len, out);
    // SAFETY: the records before `out.cur` are written, within capacity.
    unsafe { v.set_len(out.cur.offset_from(rp) as usize) };
}

/// Byte classes for the main dispatch.
mod class {
    /// A letter, `_`, or any byte from 0x80: a name.
    pub const IDENT: u8 = 0;
    /// Anything else: one byte colored `none`.
    pub const OTHER: u8 = 1;
    pub const DIGIT: u8 = 2;
    pub const HASH: u8 = 3;
    /// `"`, `'`, or a backtick.
    pub const QUOTE: u8 = 4;
    pub const SLASH: u8 = 5;
    pub const PERCENT: u8 = 6;
    pub const COLON: u8 = 7;
    pub const AT: u8 = 8;
    pub const DOLLAR: u8 = 9;
    pub const LT: u8 = 10;
    pub const DOT: u8 = 11;
    pub const AMP: u8 = 12;
    pub const QUESTION: u8 = 13;
    pub const EQ: u8 = 14;
    /// `(`, `[`, `{`, `)`, `]`, `}`.
    pub const BRACKET: u8 = 15;
    /// `,` or `;`.
    pub const DELIM: u8 = 16;
    /// Another operator byte (`$rubyIsOp`).
    pub const OP: u8 = 17;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 18;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    let mut c = 1;
    t[0] = class::NUL;
    while c < 256 {
        let b = c as u8;
        t[c] = if is_ident_start(b) && b != b'$' {
            class::IDENT
        } else if is_digit(b) {
            class::DIGIT
        } else {
            match b {
                b'#' => class::HASH,
                b'"' | b'\'' | b'`' => class::QUOTE,
                b'/' => class::SLASH,
                b'%' => class::PERCENT,
                b':' => class::COLON,
                b'@' => class::AT,
                b'$' => class::DOLLAR,
                b'<' => class::LT,
                b'.' => class::DOT,
                b'&' => class::AMP,
                b'?' => class::QUESTION,
                b'=' => class::EQ,
                b'(' | b'[' | b'{' | b')' | b']' | b'}' => class::BRACKET,
                b',' | b';' => class::DELIM,
                _ if OPS[c] => class::OP,
                _ => class::OTHER,
            }
        };
        c += 1;
    }
    t
};

/// The lexer loop (`$hlRuby` with no streaming), with its inline rules:
/// line breaks in gaps (`$lexGapHasBreak`), comments (`$lexLineComment`),
/// `%` literal kinds (`$rubyPercentKind`), operators (`$rubyIsOp`), and
/// bounded lookahead (`$rubyByte`, which the NUL after the input stands in
/// for).
fn lex(src: &[u8], end: usize, mut out: Out) -> Out {
    // `$lexEmitLeadingContinuation`, then the leading whitespace: the state
    // is already that of a line start, so only the record changes.
    let lead = scan::utf8_span_end(src, 0, end);
    out.gap(0, lead);
    let mut p = whitespace_end(src, lead);
    out.gap(lead, p);

    let mut line_head = true;
    // 1 where a value may start, 2 right after a plain name
    let mut operand: u32 = 1;
    // 1 after `def`, 2 after `class` or `module`
    let mut decl: u32 = 0;
    // 1 after `.` or `&.`, 2 after `::`
    let mut member: u32 = 0;
    // braces open in a `#{}` interpolation
    let mut interp: u32 = 0;
    // the open literal body and the one suspended by an interpolation
    let mut s_active = false;
    let mut s = Lit::default();
    let mut i = Lit::default();
    let mut seg = 0usize;
    let mut hd_len = 0usize;
    let mut hd_delim = 0usize;
    let mut hd_strip = false;
    let mut data = false;

    'next: loop {
        // Emit `[lhs, p)` as `hl`; a member access ends with any token
        // (`$tok`).
        macro_rules! tok {
            ($lhs:expr, $hl:expr) => {{
                out.tok($hl, p);
                member = 0;
                continue 'next;
            }};
        }
        // A value token: a `/`, `%`, or `<<` next is an operator (`$valueTok`).
        macro_rules! value {
            ($lhs:expr, $hl:expr) => {{
                operand = 0;
                tok!($lhs, $hl)
            }};
        }
        // A punctuation or operator token: a value may start next (`$opTok`).
        macro_rules! op {
            ($lhs:expr, $hl:expr) => {{
                operand = 1;
                tok!($lhs, $hl)
            }};
        }
        // A literal opener with body `$lit` (`$literal`); the body is scanned
        // at the top of the loop.
        // The body is scanned at the top of the loop. With no heredoc
        // pending, which the top checks first, it is scanned right away:
        // the opener and the body's first bytes share a color, so the
        // body's first token starts at the opener.
        macro_rules! literal {
            ($lhs:expr, $lit:expr) => {{
                s = $lit;
                member = 0;
                if hd_len != 0 {
                    s_active = true;
                    seg = p;
                    out.tok(lit_hl(s.flags), p);
                    continue 'next;
                }
                let status;
                (p, out, status, s.depth) = literal_body(src, end, out, p, $lhs, s, interp != 0);
                seg = p;
                if status == 2 {
                    // `#{` opened an interpolation
                    i = s;
                    interp = 1;
                    operand = 1;
                } else if status == 1 || s.flags & 8 != 0 {
                    // closed, or a one-line body cut by a line break
                    operand = 0;
                } else {
                    // a body left open runs to the input end
                    break 'next;
                }
                continue 'next;
            }};
        }

        // An operator run from `lhs` (`$rubyIsOp` bytes and `.`).
        macro_rules! operator {
            ($lhs:expr) => {{
                while OPS[at(src, p) as usize] || at(src, p) == b'.' {
                    p += 1;
                }
                // `def ==(other)` names an operator method
                if decl == 1 {
                    decl = 0;
                }
                op!($lhs, tok::OPERATOR)
            }};
        }

        if data | (hd_len != 0) | s_active {
            core::hint::cold_path();
            let gap = p;
            // everything after `__END__` is data
            if data {
                if p < end {
                    out.span(tok::COMMENT, gap, end);
                }
                break;
            }
            if hd_len != 0 {
                // the pending heredoc body starts after this line's break,
                // so skip blanks only and consume just the LF or CRLF
                let q = skip_space_at(src, p);
                let c = at(src, q);
                if (c == b'\n' || c == b'\r') && q < end {
                    p = q + 1;
                    if c == b'\r' && at(src, p) == b'\n' && p < end {
                        p += 1;
                    }
                    out.gap(gap, p);
                    let delim = &src[hd_delim..hd_delim + hd_len];
                    (p, out) =
                        line_delimited(src, end, out, p, delim, hd_strip as u32, tok::STRING);
                    hd_len = 0;
                    line_head = true;
                    operand = 1;
                    continue 'next;
                }
            }
            // an open literal body
            if s_active {
                if p >= end {
                    break;
                }
                let status;
                (p, out, status, s.depth) = literal_body(src, end, out, p, seg, s, interp != 0);
                seg = p;
                if status == 2 {
                    // `#{` opened an interpolation: code until the matching
                    // `}`
                    i = s;
                    interp = 1;
                    s_active = false;
                    operand = 1;
                } else if status == 1 || s.flags & 8 != 0 {
                    // closed, or a one-line body cut by a line break
                    s_active = false;
                    operand = 0;
                }
                continue 'next;
            }
        }

        // The gap before the next token.
        let gap = p;
        let c = at(src, p);
        if c == b' ' && !is_space(at(src, p + 1)) {
            // one space: no line break
            p += 1;
            out.extend(p);
        } else if is_space(c) {
            p = whitespace_end(src, p + 1);
            out.extend(p);
            if c == b'\n' || c == b'\r' || scan::line_end(src, gap + 1, p) < p {
                line_head = true;
                operand = 1;
                decl = 0;
                hd_len = 0;
            }
        }
        let lhs = p;
        let c = at(src, p);
        let c2 = at(src, p + 1);
        let at_head = line_head;
        line_head = false;

        match CLASS[c as usize] {
            class::IDENT => {
                if at_head
                    && c == b'_'
                    && word_at(src, lhs, 7) == word(b"__END__")
                    && !is_ident_continue(if lhs + 7 < end { src[lhs + 7] } else { 0 })
                {
                    data = true;
                    continue 'next;
                }
                // A chain of names joined by `.` (`a.b.c`) runs in this loop.
                let mut lhs = lhs;
                let mut c = c;
                loop {
                    p = ident_end(src, p + 1);
                    // a method name may end in `?` or `!`, but not before `=`
                    let n = at(src, p);
                    if (n == b'?' || n == b'!') && at(src, p + 1) != b'=' {
                        p += 1;
                    }
                    let rhs = p;
                    // `key:` is a symbol key, unless it is `key::Scope`
                    if at(src, rhs) == b':' && at(src, rhs + 1) != b':' && member == 0 {
                        p = rhs + 1;
                        out.tok(tok::STRING_SPECIAL_SYMBOL, p);
                        operand = 1;
                        decl = 0;
                        continue 'next;
                    }
                    // The WAT tests `member` with a bitwise `i32.and`, so after
                    // `::` (member 2) the word is still looked up.
                    let kind = if member & (decl == 0) as u32 != 0 {
                        0
                    } else {
                        word_hl(src, lhs, rhs)
                    };
                    let hl;
                    if kind != 0 {
                        hl = kind & 255;
                        decl = (kind >> 8) & 3;
                        // `def self.name` keeps the head open through `self`
                        if hl == tok::VARIABLE_SPECIAL && at(src, rhs) == b'.' {
                            decl = 1;
                        }
                        operand = (kind >> 16) & 3;
                    } else if decl != 0 {
                        hl = if decl == 1 {
                            tok::FUNCTION_DEFINITION
                        } else {
                            tok::TYPE
                        };
                        // `class Foo::Bar` keeps the head open through the scope
                        if !(at(src, rhs) == b':' && at(src, rhs + 1) == b':') {
                            decl = 0;
                        }
                        operand = 0;
                    } else if member != 0 {
                        // `Foo::Bar` is a constant
                        hl = if member == 2 && is_upper(c) {
                            if is_const_case(src, lhs, rhs) {
                                tok::CONSTANT
                            } else {
                                tok::TYPE
                            }
                        } else {
                            tok::FUNCTION_METHOD
                        };
                        operand = 0;
                    } else if (is_upper(c) || c == b'_') && is_const_case(src, lhs, rhs) {
                        // (only `[A-Z_]` can start a constant name)
                        hl = tok::CONSTANT;
                        operand = 0;
                    } else if is_upper(c) {
                        hl = tok::TYPE;
                        operand = 0;
                    } else {
                        // a name before `(` or before an argument on the same
                        // line is a method call; anything else is a variable
                        // and may take a heredoc
                        let q = skip_space_at(src, rhs);
                        let n = at(src, q);
                        let call = at(src, rhs) == b'('
                            || (q > rhs
                                && (n == b'"'
                                    || n == b'\''
                                    || n == b'@'
                                    || (n == b':' && is_ident_start(at(src, q + 1)))
                                    || (is_ident_start(n) && arg_word(src, q))));
                        if call {
                            hl = tok::FUNCTION;
                            operand = 1;
                        } else {
                            hl = tok::VARIABLE;
                            operand = 2;
                        }
                    }
                    out.tok(hl, p);
                    member = 0;
                    // `.`, `(`, `)`, or `,` right after a name: its rule runs
                    // here, without the gap and dispatch steps
                    let n = at(src, p);
                    if n == b'.' {
                        let n2 = at(src, p + 1);
                        if n2 != b'.' && !is_digit(n2) {
                            p += 1;
                            out.tok(tok::PUNCTUATION_DELIMITER, p);
                            member = 1;
                            operand = 0;
                            if CLASS[n2 as usize] == class::IDENT {
                                lhs = p;
                                c = n2;
                                continue;
                            }
                        }
                    } else if n == b':' && at(src, p + 1) == b':' {
                        // `::` names a member
                        p += 2;
                        out.tok(tok::PUNCTUATION_DELIMITER, p);
                        member = 2;
                        operand = 0;
                        let n2 = at(src, p);
                        if CLASS[n2 as usize] == class::IDENT {
                            lhs = p;
                            c = n2;
                            continue;
                        }
                    } else if n == b' ' {
                        // one space, then another name
                        let n2 = at(src, p + 1);
                        if CLASS[n2 as usize] == class::IDENT {
                            p += 1;
                            out.extend(p);
                            lhs = p;
                            c = n2;
                            continue;
                        }
                    } else if n == b'\n' && hd_len == 0 {
                        // a line break and indentation, with no heredoc
                        // body to take first; then maybe another name
                        p = whitespace_end(src, p + 1);
                        out.extend(p);
                        line_head = true;
                        operand = 1;
                        decl = 0;
                        let n2 = at(src, p);
                        if CLASS[n2 as usize] == class::IDENT && n2 != b'_' {
                            line_head = false;
                            lhs = p;
                            c = n2;
                            continue;
                        }
                    } else if n == b'(' {
                        p += 1;
                        out.tok(tok::PUNCTUATION_BRACKET, p);
                        operand = 1;
                        decl = 0;
                        // then maybe a name
                        let n2 = at(src, p);
                        if CLASS[n2 as usize] == class::IDENT {
                            lhs = p;
                            c = n2;
                            continue;
                        }
                    } else if n == b')' {
                        p += 1;
                        out.tok(tok::PUNCTUATION_BRACKET, p);
                        operand = 0;
                        decl = 0;
                    } else if n == b',' {
                        p += 1;
                        out.tok(tok::PUNCTUATION_DELIMITER, p);
                        operand = 1;
                        decl = 0;
                    }
                    continue 'next;
                }
            }
            class::QUOTE => {
                // A run of literals joined by `, ` (`"-d", "--debug"`) runs in
                // this loop.
                let mut lhs = lhs;
                let mut c = c;
                loop {
                    // A literal without escapes or `#` is one token.
                    let close = if c == b'\'' {
                        scan::find3(src, p + 1, end, c, c, c)
                    } else {
                        scan::find3(src, p + 1, end, c, b'\\', b'#')
                    };
                    if at(src, close) == c && close < end && hd_len == 0 {
                        p = close + 1;
                        out.tok(tok::STRING, p);
                        member = 0;
                        operand = 0;
                        // `,` or `)` right after a literal: its rule runs here
                        let n = at(src, p);
                        if n == b',' {
                            p += 1;
                            out.tok(tok::PUNCTUATION_DELIMITER, p);
                            operand = 1;
                            decl = 0;
                            // one space, then another literal
                            let n2 = at(src, p + 1);
                            if at(src, p) == b' ' && (n2 == b'"' || n2 == b'\'') {
                                p += 1;
                                out.extend(p);
                                lhs = p;
                                c = n2;
                                continue;
                            }
                        } else if n == b')' {
                            p += 1;
                            out.tok(tok::PUNCTUATION_BRACKET, p);
                            decl = 0;
                        }
                        continue 'next;
                    }
                    p += 1;
                    literal!(
                        lhs,
                        Lit {
                            close: c,
                            open: 0,
                            depth: 0,
                            flags: (c != b'\'') as u32,
                        }
                    )
                }
            }
            class::HASH => {
                // `$lexLineComment`
                p = scan::line_end(src, p + 1, end);
                out.tok(tok::COMMENT, p);
                continue 'next;
            }
            class::DIGIT => {
                p = number_end(src, p);
                value!(lhs, tok::NUMBER)
            }
            class::BRACKET => {
                p += 1;
                if interp != 0 {
                    if c == b'{' {
                        interp += 1;
                    }
                    if c == b'}' {
                        interp -= 1;
                        if interp == 0 {
                            // the brace matching `#{` returns to the body
                            out.tok(tok::PUNCTUATION_SPECIAL, p);
                            s = i;
                            s_active = true;
                            seg = p;
                            member = 0;
                            decl = 0;
                            continue 'next;
                        }
                    }
                }
                // a closer ends a value; an opener starts one
                operand = (c == b'(' || c == b'[' || c == b'{') as u32;
                decl = 0;
                tok!(lhs, tok::PUNCTUATION_BRACKET)
            }
            class::DOT => {
                if is_digit(c2) {
                    p = number_end(src, p);
                    value!(lhs, tok::NUMBER)
                }
                if c2 != b'.' {
                    // `.` names a member
                    p += 1;
                    out.tok(tok::PUNCTUATION_DELIMITER, p);
                    member = 1;
                    operand = 0;
                    continue 'next;
                }
                operator!(lhs)
            }
            class::COLON => {
                // `:symbol`, `:"symbol"`, and `:+`; `::` is a scope
                // delimiter
                if c2 == b':' {
                    p += 2;
                    out.tok(tok::PUNCTUATION_DELIMITER, p);
                    member = 2;
                    operand = 0;
                    continue 'next;
                }
                if c2 == b'"' || c2 == b'\'' {
                    p += 2;
                    literal!(
                        lhs,
                        Lit {
                            close: c2,
                            open: 0,
                            depth: 0,
                            flags: 12 | (c2 != b'\'') as u32,
                        }
                    )
                }
                if is_ident_start(c2) {
                    p = ident_end(src, p + 1);
                    let n = at(src, p);
                    if n == b'?' || n == b'!' || n == b'=' {
                        p += 1;
                    }
                    value!(lhs, tok::STRING_SPECIAL_SYMBOL)
                }
                // The WAT tests `operand` with a bitwise `i32.and` against a
                // 0/1 flag, so `operand` 2 (after a plain name) does not
                // count here, nor for `/` and `%` below.
                if OPS[c2 as usize] && operand & 1 != 0 {
                    p += 1;
                    while OPS[at(src, p) as usize] {
                        p += 1;
                    }
                    value!(lhs, tok::STRING_SPECIAL_SYMBOL)
                }
                p += 1;
                op!(lhs, tok::PUNCTUATION_DELIMITER)
            }
            class::AT => {
                // `@ivar`, `@@cvar`
                if is_ident_start(c2) || (c2 == b'@' && is_ident_start(at(src, p + 2))) {
                    p += 1 + (c2 == b'@') as usize;
                    if is_ident_continue(at(src, p)) {
                        p = ident_end(src, p);
                    } else {
                        p += 1;
                    }
                    value!(lhs, tok::VARIABLE_SPECIAL)
                }
                p += 1;
                op!(lhs, tok::NONE)
            }
            class::DOLLAR => {
                // `$global`; the WAT steps over a second `@` here too, so a
                // `$@` that ends the input ends its token one byte past it
                if c2 > 32 {
                    p += 1 + (c2 == b'@') as usize;
                    if is_ident_continue(at(src, p)) && p < end {
                        p = ident_end(src, p);
                    } else {
                        p += 1;
                    }
                    if p > end {
                        core::hint::cold_path();
                        out.tok(tok::VARIABLE_SPECIAL, p);
                        break 'next;
                    }
                    value!(lhs, tok::VARIABLE_SPECIAL)
                }
                p += 1;
                op!(lhs, tok::NONE)
            }
            class::SLASH if operand & 1 != 0 => {
                // `/regex/`
                p += 1;
                literal!(
                    lhs,
                    Lit {
                        close: b'/',
                        open: 0,
                        depth: 0,
                        flags: 11,
                    }
                )
            }
            class::PERCENT if operand & 1 != 0 => {
                // `%w[...]` literals
                let kind = if PERCENT_INTERP[c2 as usize] {
                    1
                } else if matches!(c2, b'q' | b'w' | b'i' | b's') {
                    2
                } else {
                    0
                };
                let q = p + if kind != 0 { 2 } else { 1 };
                let open = if q < end { src[q] } else { 0 };
                if open > 32 && open < 128 && !is_ident_continue(open) {
                    p = q + 1;
                    let close = closer(open);
                    let mut flags = (kind != 2) as u32;
                    if c2 == b'r' {
                        flags = 3;
                    }
                    if c2 == b's' || c2 == b'i' {
                        flags |= 4;
                    }
                    if c2 == b'I' {
                        flags = 5;
                    }
                    literal!(
                        lhs,
                        Lit {
                            close,
                            // only the bracket kinds nest
                            open: if close == open { 0 } else { open },
                            depth: 0,
                            flags,
                        }
                    )
                }
                operator!(lhs)
            }
            class::LT if c2 == b'<' => {
                // heredoc openers: `<<~ID`, `<<-ID`, `<<ID` with an
                // uppercase name or a quoted one
                let c3 = at(src, p + 2);
                let strip = c3 == b'~' || c3 == b'-';
                let q = p + 2 + strip as usize;
                let kind = if q < end { src[q] } else { 0 };
                let opens = kind == b'"'
                    || kind == b'\''
                    || is_upper(kind)
                    || (strip && is_ident_start(kind));
                // a blank after anything but a digit makes a glued `<<` a
                // command argument
                let arg = !at_head
                    && lhs > gap
                    && at(src, gap - 1).wrapping_sub(b'0') > 9
                    && heredoc_argument(src, end, q);
                hd_strip = strip;
                // The WAT combines these with bitwise `i32.and`/`i32.or`:
                // `operand` 2 alone does not open a heredoc.
                if (opens as u32) & (operand | strip as u32 | arg as u32) != 0 {
                    if kind == b'"' || kind == b'\'' {
                        hd_delim = q + 1;
                        p = scan::find3(src, hd_delim, end, kind, kind, kind);
                        hd_len = p - hd_delim;
                        if p < end {
                            p += 1;
                        }
                    } else {
                        hd_delim = q;
                        p = ident_end(src, q);
                        hd_len = p - hd_delim;
                    }
                    value!(lhs, tok::STRING)
                }
                operator!(lhs)
            }
            class::EQ if at_head && word_at(src, lhs, 5) == word(b"=begi") => {
                // `=begin` ... `=end` at a line start
                p = scan::line_end(src, p, end);
                if p < end {
                    p += 1;
                }
                out.tok(tok::COMMENT, p);
                (p, out) = line_delimited(src, end, out, p, b"=end", 4, tok::COMMENT);
                line_head = true;
                continue 'next;
            }
            class::DELIM => {
                p += 1;
                decl = 0;
                op!(lhs, tok::PUNCTUATION_DELIMITER)
            }
            class::AMP if c2 == b'.' => {
                // `&.` names a member
                p += 2;
                out.tok(tok::PUNCTUATION_DELIMITER, p);
                member = 1;
                operand = 0;
                continue 'next;
            }
            class::QUESTION if operand == 1 => {
                // `?a`, `?"`, `?\n` character literals where a value must
                // start; like Ruby, `?ab` is not one
                let q = p + if c2 == b'\\' { 2 } else { 1 };
                let b = if q < end { src[q] } else { 0 };
                if b > 32 {
                    let e = scan::utf8_span_end(src, q + 1, end);
                    let after = if e < end { src[e] } else { 0 };
                    if c2 == b'\\' || !is_ident_continue(b) || !is_ident_continue(after) {
                        p = e;
                        value!(lhs, tok::STRING)
                    }
                }
                operator!(lhs)
            }
            class::NUL if p >= end => break,
            class::OTHER | class::NUL => {
                p += 1;
                op!(lhs, tok::NONE)
            }
            _ => operator!(lhs),
        }
    }
    out
}
