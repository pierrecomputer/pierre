//! WAT sources: src/langs/perl.wat src/common.wat src/scan.wat
//!
//! Native Perl highlighter. One pass over the input with the same rules,
//! in the same order, as the translated `$hlPerl`; the records equal the
//! translated lexer's records.

use super::Lexer;
use super::scan;
use super::tables::{KeywordTable, byteset};
use crate::Rec;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::PERL_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "perl" => Some(highlight),
        _ => None,
    }
}

/// `$perlWords`.
static WORDS: KeywordTable<2048> = KeywordTable::new(PERL_WORDS);

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

/// The `$perlWords` group of the word `[lhs, rhs)`, or 0
/// (`keyword-table.get`).
#[inline(always)]
fn word_group(src: &[u8], lhs: usize, rhs: usize) -> u32 {
    WORDS.group(src, lhs, rhs)
}

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
    // Most gaps are short: test a few bytes one by one first.
    for _ in 0..4 {
        if !is_space(at(src, p)) {
            return p;
        }
        p += 1;
    }
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

/// The end of the whitespace run from `p` (`$scanWhitespace`), and
/// whether it holds a line break (`$lexGapHasBreak`). The NUL after the
/// input ends every run.
#[inline(always)]
fn whitespace_break_end(src: &[u8], mut p: usize) -> (usize, bool) {
    let mut brk = false;
    loop {
        let c = at(src, p);
        if !is_space(c) {
            return (p, brk);
        }
        brk |= c == b'\n' || c == b'\r';
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
    // SAFETY: each 16-byte load starts before `end`, inside the input or
    // its slack.
    unsafe {
        let [b0, b1, b2, b3, b4, b5] = bytes.map(V::splat);
        while p < end {
            let v = V::load(src.as_ptr().add(p));
            let hit = v
                .eq(b0)
                .or(v.eq(b1))
                .or(v.eq(b2).or(v.eq(b3)).or(v.eq(b4).or(v.eq(b5))));
            let k = hit.first();
            if k < 16 {
                return (p + k).min(end);
            }
            p += 16;
        }
        p.min(end)
    }
}

/// Consume lines from `p` through the one holding the delimiter `delim` as
/// one `hl` token; `mode` bit 0 allows indentation before it, bit 2 makes
/// it a word closer (`$perlLineDelimited`, `$perlRangeEq`,
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

/// A quoted body (`$sClose`, `$sOpen`, `$sDepth`, `$sFlags`).
#[derive(Clone, Copy, Default)]
struct Lit {
    close: u8,
    /// The byte that nests, or 0.
    open: u8,
    depth: u32,
    /// Bit 0: escapes and `$name`/`@name` interpolation; bit 1: a regex.
    flags: u32,
}

/// The color of a quoted body with `flags`.
#[inline(always)]
fn lit_hl(flags: u32) -> u32 {
    if flags & 2 != 0 {
        tok::STRING_REGEX
    } else {
        tok::STRING
    }
}

/// Scan a quoted body from `p` with the bytes since `seg` unemitted;
/// returns the end, whether the closer was passed, and the nesting depth
/// still open (`$perlQuoteBody`). The WAT's two cached scans find the first
/// closer, opener, backslash, `$`, or `@` that applies, as one scan does.
fn quote_body(
    src: &[u8],
    end: usize,
    mut out: Out,
    mut p: usize,
    mut seg: usize,
    lit: Lit,
) -> (usize, Out, bool, u32) {
    let Lit {
        close,
        open,
        mut depth,
        flags,
    } = lit;
    let hl = lit_hl(flags);
    let esc = flags & 1 != 0;
    let bytes = [
        close,
        if open != 0 { open } else { close },
        if esc { b'\\' } else { close },
        if esc { b'$' } else { close },
        if esc { b'@' } else { close },
        close,
    ];
    let mut closed = false;
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
            closed = true;
            break;
        }
        if open != 0 && c == open {
            depth += 1;
            p += 1;
            continue;
        }
        if c == b'\\' {
            out.span(hl, seg, p);
            let e = escape_end(src, end, p);
            out.span(tok::STRING_ESCAPE, p, e);
            p = e;
            seg = p;
            continue;
        }
        // `$name`, `${name}`, `@name`: interpolated variables
        let c2 = at(src, p + 1);
        if is_ident_start(c2) || (c == b'$' && c2 == b'{') {
            out.span(hl, seg, p);
            p += 1;
            if c2 == b'{' {
                p = scan::find3(src, p, end, b'}', b'}', b'}');
                if p < end {
                    p += 1;
                }
            } else {
                p = ident_end(src, p);
            }
            out.tok(tok::VARIABLE, p);
            seg = p;
            continue;
        }
        p += 1;
    }
    out.span(hl, seg, p);
    (p, out, closed, depth)
}

/// What a bare word sets, packed: its token (bits 0-7), the `decl` it opens
/// (bits 8-9: 1 after `sub`, 2 after `package`), whether a value may
/// follow (bit 16), and bit 31 to tell it from 0, an ordinary identifier.
const fn word_info(hl: u32, decl: u32) -> u32 {
    hl | decl << 8 | ((hl != tok::VARIABLE_SPECIAL) as u32) << 16 | 1 << 31
}

/// [`word_info`] for each `$perlWords` group (`$perlWordHl`).
static GROUP_INFO: [u32; 10] = [
    0,
    word_info(tok::KEYWORD_CONTROL, 0),
    word_info(tok::KEYWORD_DECLARATION, 1),
    word_info(tok::KEYWORD_DECLARATION, 2),
    word_info(tok::KEYWORD_DECLARATION, 0),
    word_info(tok::KEYWORD_IMPORT, 0),
    word_info(tok::KEYWORD_OPERATOR, 0),
    word_info(tok::FUNCTION, 0),
    word_info(tok::KEYWORD, 0),
    word_info(tok::FUNCTION, 0),
];

/// The [`word_info`] of a bare word, or 0 for an ordinary identifier
/// (`$perlWordHl`).
#[inline(always)]
fn word_hl(src: &[u8], lhs: usize, rhs: usize) -> u32 {
    let g = word_group(src, lhs, rhs);
    if g == 0 {
        let n = rhs - lhs;
        if n == 1 && at(src, lhs) == b'x' {
            return word_info(tok::KEYWORD_OPERATOR, 0);
        }
        if n == 5 && word_at(src, lhs, 5) == word(b"undef") {
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

/// The quote-like operator spelled by the word `[lhs, rhs)`: 1 for
/// `q`/`qw`, 2 for `qq`, 3 for `m`/`qr`, 4 for `s`/`tr`/`y`, or 0
/// (`$perlQuoteKind`).
#[inline(always)]
fn quote_kind(src: &[u8], lhs: usize, rhs: usize) -> u32 {
    match rhs - lhs {
        1 => match at(src, lhs) {
            b'q' => 1,
            b'm' => 3,
            b's' | b'y' => 4,
            _ => 0,
        },
        2 => match word_at(src, lhs, 2) {
            w if w == word(b"qw") => 1,
            w if w == word(b"qq") => 2,
            w if w == word(b"qr") => 3,
            w if w == word(b"tr") => 4,
            _ => 0,
        },
        _ => 0,
    }
}

/// The closing delimiter for a body opened with `open` (`$perlCloser`).
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

/// Lex the Perl input of `len` bytes at `base` (`$hlPerl`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let mem = inst.mem.bytes();
    // The byte before the input, which the hash-key rule reads for a name
    // at the input start.
    let before = mem[base - 1];
    let mem_ptr = mem.as_ptr();
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
    let out = lex(src, len, out, before);
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
    /// `$`, `@`, `%`, `&`.
    pub const SIGIL: u8 = 6;
    pub const COLON: u8 = 7;
    pub const LT: u8 = 8;
    pub const DOT: u8 = 9;
    pub const DASH: u8 = 10;
    pub const EQ: u8 = 11;
    /// `(`, `[`, `{`, `)`, `]`, `}`.
    pub const BRACKET: u8 = 12;
    /// `,` or `;`.
    pub const DELIM: u8 = 13;
    /// Another operator byte (`$perlIsOp`).
    pub const OP: u8 = 14;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 15;
}

/// Operator bytes (`$perlIsOp`).
const OPS: [bool; 256] = byteset(b"!%&*+-./<=>?^|~");

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
                b'$' | b'@' | b'%' | b'&' => class::SIGIL,
                b':' => class::COLON,
                b'<' => class::LT,
                b'.' => class::DOT,
                b'-' => class::DASH,
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

/// The lexer loop (`$hlPerl` with no streaming), with its inline rules:
/// line breaks in gaps (`$lexGapHasBreak`), comments (`$lexLineComment`),
/// operators (`$perlIsOp`), and bounded lookahead (`$perlByte`, which the
/// NUL after the input stands in for). `before` is the byte before the
/// input.
fn lex(src: &[u8], end: usize, mut out: Out, before: u8) -> Out {
    // `$lexEmitLeadingContinuation`, then the leading whitespace: the state
    // is already that of a line start, so only the record changes.
    let lead = scan::utf8_span_end(src, 0, end);
    out.gap(0, lead);
    let mut p = whitespace_end(src, lead);
    out.gap(lead, p);

    let mut line_head = true;
    // where a value may start, so `/` opens a match
    let mut operand = true;
    // 1 after `sub`, 2 after `package`
    let mut decl: u32 = 0;
    // 1 after `->`, 2 after `::`
    let mut member: u32 = 0;
    // the open quoted body; `s_second` when a second body follows
    let mut s_active = false;
    let mut s = Lit::default();
    let mut s_second = false;
    let mut seg = 0usize;
    let mut hd_len = 0usize;
    let mut hd_delim = 0usize;
    let mut hd_strip = false;
    let mut data = false;

    'next: loop {
        // Emit `[lhs, p)` as `hl`; a member access ends with any token
        // (`$tok`).
        macro_rules! tok {
            ($hl:expr) => {{
                out.tok($hl, p);
                member = 0;
                continue 'next;
            }};
        }
        // Brackets, `,`, and `;` right after a token: their rules run here,
        // without the gap and dispatch steps.
        macro_rules! follow {
            () => {{
                loop {
                    let n = at(src, p);
                    if n == b',' || n == b';' {
                        p += 1;
                        out.tok(tok::PUNCTUATION_DELIMITER, p);
                        decl = 0;
                        operand = true;
                    } else if CLASS[n as usize] == class::BRACKET {
                        p += 1;
                        out.tok(tok::PUNCTUATION_BRACKET, p);
                        decl = 0;
                        operand = n == b'(' || n == b'[' || n == b'{';
                    } else {
                        continue 'next;
                    }
                }
            }};
        }
        // A value token: a `/` next is an operator (`$valueTok`).
        macro_rules! value {
            ($hl:expr) => {{
                operand = false;
                tok!($hl)
            }};
        }
        // A punctuation or operator token: a value may start next
        // (`$opTok`).
        macro_rules! op {
            ($hl:expr) => {{
                operand = true;
                tok!($hl)
            }};
        }
        // A quoted-body opener (`$literal`); the body is scanned at the top
        // of the loop.
        // Scan the open quoted body from `p` (the top-of-loop rule for
        // `$sActive`).
        macro_rules! body {
            () => {{
                let closed;
                (p, out, closed, s.depth) = quote_body(src, end, out, p, seg, s);
                seg = p;
                if closed {
                    if s_second {
                        // `s{a}{b}` opens its second body with fresh
                        // brackets; `s/a/b/` continues to the next closer
                        s_second = false;
                        if s.open != 0 {
                            p = skip_space_at(src, p);
                            out.gap(seg, p);
                            seg = p;
                            s.open = if p < end { src[p] } else { 0 };
                            s.close = closer(s.open);
                            if s.open == s.close || p >= end {
                                s_active = false;
                            } else {
                                p += 1;
                                out.tok(tok::STRING_REGEX, p);
                                seg = p;
                            }
                        }
                    } else {
                        // a match or substitution carries its flag letters
                        if s.flags & 2 != 0 {
                            p = ident_end(src, p);
                            out.span(tok::STRING_REGEX, seg, p);
                        }
                        s_active = false;
                        operand = false;
                    }
                }
            }};
        }
        // A quoted-body opener (`$literal`); the body is scanned at the top
        // of the loop. With no heredoc pending, which the top checks
        // first, it is scanned right away: the opener and the body's first
        // bytes share a color, so the body's first token starts at the
        // opener.
        macro_rules! literal {
            ($lhs:expr, $lit:expr, $second:expr) => {{
                s = $lit;
                s_second = $second;
                s_active = true;
                if hd_len != 0 {
                    seg = p;
                    tok!(lit_hl(s.flags))
                }
                member = 0;
                seg = $lhs;
                body!();
                continue 'next;
            }};
        }

        if data | (hd_len != 0) | s_active {
            core::hint::cold_path();
            let gap = p;
            // everything after `__END__` or `__DATA__` is data
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
                    operand = true;
                    continue 'next;
                }
            }
            // an open quoted body
            if s_active {
                if p >= end {
                    break;
                }
                body!();
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
            let brk;
            (p, brk) = whitespace_break_end(src, p + 1);
            out.extend(p);
            if c == b'\n' || c == b'\r' || brk {
                line_head = true;
                hd_len = 0;
            }
        }
        let lhs = p;
        let c = at(src, p);
        let c2 = at(src, p + 1);
        let at_head = line_head;
        line_head = false;

        // A name, or a `$` that no sigil rule takes (`$lexIsIdentStart`
        // includes `$`).
        macro_rules! name {
            () => {{
                p = ident_end(src, p + 1);
                let rhs = p;
                let q = skip_space_at(src, rhs);
                // quote-like operators: `q{}`, `qw()`, `m//`, `s///`,
                // `tr///`
                let kind = if member != 0 {
                    0
                } else {
                    quote_kind(src, lhs, rhs)
                };
                if kind != 0 {
                    let open = if q < end { src[q] } else { 0 };
                    // the delimiter is any punctuation except `,`, `;`,
                    // `=`, and `)`, which follow a name used as a word
                    // instead
                    if open > 32
                        && open < 128
                        && !(is_ident_continue(open)
                            || open == b','
                            || open == b';'
                            || open == b'='
                            || open == b')'
                            || (open == b'#' && q > rhs))
                    {
                        p = q + 1;
                        let close = closer(open);
                        literal!(
                            lhs,
                            Lit {
                                close,
                                // only the bracket kinds nest
                                open: if close == open { 0 } else { open },
                                depth: 0,
                                flags: if kind == 1 {
                                    0
                                } else if kind >= 3 {
                                    3
                                } else {
                                    1
                                },
                            },
                            kind == 4
                        )
                    }
                }
                let info = if member != 0 {
                    0
                } else {
                    word_hl(src, lhs, rhs)
                };
                let hl;
                if info != 0 {
                    hl = info & 255;
                    decl = (info >> 8) & 3;
                    operand = info >> 16 & 1 != 0;
                } else if decl != 0 {
                    hl = if decl == 1 {
                        tok::FUNCTION_DEFINITION
                    } else {
                        tok::NAMESPACE
                    };
                    // a `::` path keeps the head open
                    if !(at(src, rhs) == b':' && at(src, rhs + 1) == b':') {
                        decl = 0;
                    }
                    operand = false;
                } else if member == 1 {
                    hl = if at(src, q) == b'(' {
                        tok::FUNCTION_METHOD
                    } else {
                        tok::PROPERTY
                    };
                    operand = false;
                } else if at(src, rhs) == b':' && at(src, rhs + 1) == b':' {
                    // `Foo::Bar` is a package
                    hl = tok::NAMESPACE;
                    operand = false;
                } else if at(src, q) == b'(' {
                    // `Foo::bar(` a function
                    hl = tok::FUNCTION;
                    operand = true;
                } else if (is_upper(c) || c == b'_') && is_const_case(src, lhs, rhs) {
                    // (only `[A-Z_]` can start a constant name)
                    hl = tok::CONSTANT;
                    operand = false;
                } else if is_upper(c) {
                    hl = if member == 2 {
                        tok::NAMESPACE
                    } else {
                        tok::TYPE
                    };
                    // The WAT sets `operand` to 0 here and then to 1 after
                    // the branch, so a value may start after a type name.
                    operand = true;
                } else {
                    // a bare lowercase word before `=>` or alone inside
                    // `{}` is a hash key; otherwise it names a function
                    let prev = if lhs > 0 { src[lhs - 1] } else { before };
                    hl = if (at(src, q) == b'=' && at(src, q + 1) == b'>')
                        || (at(src, q) == b'}' && prev == b'{')
                    {
                        tok::STRING_SPECIAL_SYMBOL
                    } else {
                        tok::FUNCTION
                    };
                    operand = true;
                }
                out.tok(hl, p);
                member = 0;
                follow!()
            }};
        }

        // An operator run from `lhs`, stopped before a match opener
        // (`$perlIsOp`); `//` is defined-or.
        macro_rules! operator {
            () => {{
                loop {
                    let b = at(src, p);
                    if !OPS[b as usize] {
                        break;
                    }
                    if p > lhs && b == b'/' && !(p == lhs + 1 && c == b'/') {
                        break;
                    }
                    p += 1;
                }
                op!(tok::OPERATOR)
            }};
        }

        let class = CLASS[c as usize];
        // SAFETY: every class is at most `class::NUL`.
        unsafe { core::hint::assert_unchecked(class <= class::NUL) };
        match class {
            class::IDENT => {
                if at_head
                    && c == b'_'
                    && (word_at(src, lhs, 7) == word(b"__END__")
                        || word_at(src, lhs, 8) == word(b"__DATA__"))
                {
                    let n = lhs + if at(src, lhs + 2) == b'D' { 8 } else { 7 };
                    if !is_ident_continue(if n < end { src[n] } else { 0 }) {
                        data = true;
                        continue 'next;
                    }
                }
                name!()
            }
            class::QUOTE => {
                // A literal without escapes or interpolation is one token.
                let close = if c == b'\'' {
                    scan::find3(src, p + 1, end, c, c, c)
                } else {
                    find_any(src, p + 1, end, [c, b'\\', b'$', b'@', c, c])
                };
                if at(src, close) == c && close < end && hd_len == 0 {
                    p = close + 1;
                    out.tok(tok::STRING, p);
                    member = 0;
                    operand = false;
                    follow!()
                }
                p += 1;
                literal!(
                    lhs,
                    Lit {
                        close: c,
                        open: 0,
                        depth: 0,
                        flags: (c != b'\'') as u32,
                    },
                    false
                )
            }
            class::HASH => {
                // `$lexLineComment`
                p = scan::line_end(src, p + 1, end);
                out.tok(tok::COMMENT, p);
                continue 'next;
            }
            class::SIGIL => {
                // sigils: `$x`, `@x`, `%x`, `$#x`, `${x}`, `$_`, `$1`, `$$`,
                // `&sub`
                if CLASS[c2 as usize] == class::IDENT {
                    // a name right after the sigil, the common case
                    p = ident_end(src, p + 2);
                    // `$Foo::bar` keeps its package path
                    while at(src, p) == b':'
                        && at(src, p + 1) == b':'
                        && is_ident_start(at(src, p + 2))
                    {
                        p = ident_end(src, p + 2);
                    }
                    out.tok(
                        if c == b'&' {
                            tok::FUNCTION
                        } else {
                            tok::VARIABLE
                        },
                        p,
                    );
                    member = 0;
                    operand = false;
                    follow!()
                }
                let mut q = p + 1;
                if c == b'$' && c2 == b'#' {
                    q += 1;
                }
                let kind = if q < end { src[q] } else { 0 };
                if is_ident_start(kind)
                    || (c == b'$'
                        && (is_digit(kind)
                            || kind == b'{'
                            || (!is_space(kind) && kind != 0 && c2 != b'#')))
                {
                    p = q;
                    if is_ident_continue(kind) {
                        // `$Foo::bar` keeps its package path
                        loop {
                            p = ident_end(src, p);
                            if !(at(src, p) == b':'
                                && at(src, p + 1) == b':'
                                && is_ident_start(at(src, p + 2)))
                            {
                                break;
                            }
                            p += 2;
                        }
                    } else if kind == b'{' {
                        p = scan::find3(src, p, end, b'}', b'}', b'}');
                        if p < end {
                            p += 1;
                        }
                    } else {
                        p += 1;
                    }
                    out.tok(
                        if c == b'&' {
                            tok::FUNCTION
                        } else if is_ident_start(kind) {
                            tok::VARIABLE
                        } else {
                            tok::VARIABLE_SPECIAL
                        },
                        p,
                    );
                    member = 0;
                    operand = false;
                    follow!()
                }
                if c == b'$' {
                    name!()
                }
                if c == b'@' {
                    p += 1;
                    op!(tok::NONE)
                }
                operator!()
            }
            class::DIGIT => {
                p = number_end(src, p);
                out.tok(tok::NUMBER, p);
                member = 0;
                operand = false;
                follow!()
            }
            class::BRACKET => {
                p += 1;
                // a closer ends a value; an opener starts one
                operand = c == b'(' || c == b'[' || c == b'{';
                decl = 0;
                tok!(tok::PUNCTUATION_BRACKET)
            }
            class::DELIM => {
                p += 1;
                decl = 0;
                op!(tok::PUNCTUATION_DELIMITER)
            }
            class::DASH if c2 == b'>' => {
                // `->` names a member
                p += 2;
                out.tok(tok::PUNCTUATION_DELIMITER, p);
                member = 1;
                operand = false;
                continue 'next;
            }
            class::COLON => {
                if c2 == b':' {
                    // `::` names a member
                    p += 2;
                    out.tok(tok::PUNCTUATION_DELIMITER, p);
                    member = 2;
                    operand = false;
                    continue 'next;
                }
                p += 1;
                op!(tok::PUNCTUATION_DELIMITER)
            }
            class::DOT if is_digit(c2) => {
                p = number_end(src, p);
                value!(tok::NUMBER)
            }
            class::SLASH if operand => {
                // `/regex/`
                p += 1;
                literal!(
                    lhs,
                    Lit {
                        close: b'/',
                        open: 0,
                        depth: 0,
                        flags: 3,
                    },
                    false
                )
            }
            class::EQ if at_head && (c2 | 32).wrapping_sub(b'a') <= 25 => {
                // POD: a `=word` line opens documentation that runs to
                // `=cut`
                (p, out) = line_delimited(src, end, out, p, b"=cut", 8, tok::COMMENT_DOC);
                line_head = true;
                operand = true;
                continue 'next;
            }
            class::LT if c2 == b'<' => {
                // heredoc openers: `<<EOF`, `<<"EOF"`, `<<'EOF'`, `<<~EOF`
                let strip = at(src, p + 2) == b'~';
                hd_strip = strip;
                let q = p + 2 + strip as usize;
                let kind = if q < end { src[q] } else { 0 };
                let opens = kind == b'"' || kind == b'\'' || is_upper(kind);
                // a blank after anything but a digit makes a glued `<<` an
                // argument
                if opens
                    && (operand
                        || strip
                        || (!at_head
                            && lhs > gap
                            && at(src, gap - 1).wrapping_sub(b'0') > 9
                            && heredoc_argument(src, end, q)))
                {
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
                    value!(tok::STRING)
                }
                operator!()
            }
            class::NUL if p >= end => break,
            class::OTHER | class::NUL => {
                p += 1;
                op!(tok::NONE)
            }
            _ => operator!(),
        }
    }
    out
}
