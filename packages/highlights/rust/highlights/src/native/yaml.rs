//! WAT sources: src/langs/yaml.wat src/common.wat src/scan.wat
//!
//! Native YAML lexer. One pass over the input: comments, quoted and plain
//! scalars (a scalar a `: ` follows is a mapping key), anchors, aliases and
//! tags, document markers, flow brackets, indicators, numbers, and block
//! scalars, whose indented body is one string. The records equal the
//! translated `yaml` lexer's records.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;

/// The lexer for each language this module handles.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "yaml" => Some(highlight),
        _ => None,
    }
}

/// Whether `c` is ASCII whitespace (`$lexIsSpace`).
#[inline(always)]
const fn is_space(c: u8) -> bool {
    c == 32 || c.wrapping_sub(9) <= 4
}

/// Whether `c` is an ASCII digit (`$lexIsDigit`).
#[inline(always)]
fn is_digit(c: u8) -> bool {
    c.wrapping_sub(b'0') <= 9
}

/// Whether `c` continues an identifier: a letter, digit, `_`, `$`, or any
/// byte from 128 (`$lexIsIdentContinue`).
#[inline(always)]
fn is_ident_continue(c: u8) -> bool {
    c >= 0x80 || (c | 32).wrapping_sub(b'a') <= 25 || is_digit(c) || c == b'_' || c == b'$'
}

/// Whether `c` is a blank: a space or TAB.
#[inline(always)]
fn is_blank(c: u8) -> bool {
    c == b' ' || c == b'\t'
}

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run by the input end.
#[inline(always)]
fn space_end(src: Input<'_>, mut p: usize) -> usize {
    // SAFETY: the run starts at or before the input end and stops at the NUL
    // after it at the latest.
    while is_space(unsafe { src.byte_unchecked(p) }) {
        p += 1;
    }
    p
}

/// The end of the run of identifier bytes from `p` (`$scanIdentRun` with
/// `$`, `$lexScanIdent`). The NUL after the input ends every run.
#[inline(always)]
fn ident_run(src: Input<'_>, mut p: usize) -> usize {
    // SAFETY: the run starts at or before the input end and stops at the NUL
    // after it at the latest.
    while is_ident_continue(unsafe { src.byte_unchecked(p) }) {
        p += 1;
    }
    p
}

/// The first `a` or `b` from `p`, or `end` (`$lexFindEither`).
#[inline(always)]
fn find_either(src: Input<'_>, p: usize, end: usize, a: u8, b: u8) -> usize {
    let mut p = p;
    while p < end {
        // SAFETY: `p` is below the input end.
        let c = unsafe { src.byte_unchecked(p) };
        if c == a || c == b {
            return p;
        }
        p += 1;
    }
    end
}

/// The first `quote` (or, when `esc`, backslash) from `p`, or `end`; a
/// cursor at or past `end` stays (`$scanFindSpecial` without line
/// breaks).
#[inline(always)]
fn find_quote(src: Input<'_>, mut p: usize, end: usize, quote: u8, esc: bool) -> usize {
    if p >= end {
        return p;
    }
    while p < end {
        // SAFETY: `p` is below the input end, so its 16 bytes stay inside the
        // slack.
        let v = unsafe { src.vec_unchecked(p) };
        let mut hit = v.eq(V::splat(quote));
        if esc {
            hit = hit.or(v.eq(V::splat(b'\\')));
        }
        let k = hit.first();
        if k < 16 {
            return (p + k).min(end);
        }
        p += 16;
    }
    end
}

/// The end of the escape at the backslash at `p` (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(src: Input<'_>, end: usize, p: usize) -> usize {
    let mut e = scan::utf8_span_end(src.bytes(), p + 2, end);
    // SAFETY: the backslash at `p` lies inside the input, so `p + 1` is at
    // most the input end, and `e` is below it (tested).
    if e == p + 2
        && unsafe { src.byte_unchecked(p + 1) } == 13
        && e < end
        && unsafe { src.byte_unchecked(e) } == 10
    {
        e += 1;
    }
    e
}

/// A number from `p`, at its first digit after any sign
/// (`$lexScanNumber`, `$lexScanNumberBody`).
#[inline(always)]
fn scan_number(src: Input<'_>, end: usize, mut p: usize) -> usize {
    // SAFETY: `p + 1` is below the input end (tested).
    let hex = p + 1 < end
        && unsafe { src.byte_unchecked(p) } == b'0'
        && unsafe { src.byte_unchecked(p + 1) } | 32 == b'x';
    let mut prev = 0u8;
    while p < end {
        // SAFETY: `p` is below the input end.
        let c = unsafe { src.byte_unchecked(p) };
        if is_ident_continue(c) {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            // SAFETY: `p + 1` is below the input end (tested).
            let next = if p + 1 < end {
                unsafe { src.byte_unchecked(p + 1) }
            } else {
                0
            };
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

/// The color of the plain scalar `[lhs, rhs)`: `~` and the words null,
/// true, false, yes, no, on, and off in any case are constants, anything
/// else a string (`$yamlWordHl`).
#[inline(always)]
fn word_hl(src: Input<'_>, lhs: usize, rhs: usize) -> u32 {
    let n = rhs - lhs;
    if n.wrapping_sub(1) > 4 {
        return tok::STRING;
    }
    if n == 1 {
        // SAFETY: the scalar lies inside the input.
        return if unsafe { src.byte_unchecked(lhs) } == b'~' {
            tok::CONSTANT_BUILTIN
        } else {
            tok::STRING
        };
    }
    // SAFETY: the scalar lies inside the input, so the 8 bytes from its start
    // stay inside the slack.
    let w8 = unsafe { src.word_unchecked(lhs) };
    if n == 5 {
        return if (w8 | 0x20_2020_2020) & 0xff_ffff_ffff == u64::from_le_bytes(*b"false\0\0\0") {
            tok::BOOLEAN
        } else {
            tok::STRING
        };
    }
    let w = (w8 as u32) | 0x2020_2020;
    if n == 4 {
        if w == u32::from_le_bytes(*b"true") {
            return tok::BOOLEAN;
        }
        return if w == u32::from_le_bytes(*b"null") {
            tok::CONSTANT_BUILTIN
        } else {
            tok::STRING
        };
    }
    if n == 3 {
        let w = w & 0xff_ffff;
        return if w == u32::from_le_bytes(*b"yes\0") || w == u32::from_le_bytes(*b"off\0") {
            tok::BOOLEAN
        } else {
            tok::STRING
        };
    }
    let w = w & 0xffff;
    if w == u32::from_le_bytes(*b"no\0\0") || w == u32::from_le_bytes(*b"on\0\0") {
        tok::BOOLEAN
    } else {
        tok::STRING
    }
}

/// The end of the blanks (spaces and TABs) from `p` (`$yamlSkipHorizontal`).
#[inline(always)]
fn skip_horizontal(src: Input<'_>, end: usize, mut p: usize) -> usize {
    // SAFETY: `p` is below the input end.
    while p < end && is_blank(unsafe { src.byte_unchecked(p) }) {
        p += 1;
    }
    p
}

/// The position after the line break at `p`, if any (`$yamlAfterLine`).
#[inline(always)]
fn after_line(src: Input<'_>, end: usize, mut p: usize) -> usize {
    // SAFETY: each read is at a position below the input end (tested).
    if p < end {
        if unsafe { src.byte_unchecked(p) } == 13 {
            p += 1;
        }
        if p < end && unsafe { src.byte_unchecked(p) } == 10 {
            p += 1;
        }
    }
    p
}

/// The leading blanks of the line containing `p` (`$yamlLineIndent`).
fn line_indent(src: Input<'_>, end: usize, mut p: usize) -> usize {
    // SAFETY: `p` is at most the input end and above 0, so `p - 1` is inside
    // the input.
    while p > 0
        && !(unsafe { src.byte_unchecked(p - 1) } == 10
            || unsafe { src.byte_unchecked(p - 1) } == 13)
    {
        p -= 1;
    }
    skip_horizontal(src, end, p) - p
}

/// The end of a block scalar body from `p`: every following line that is
/// blank, or indented deeper than `indent`, belongs to it
/// (`$yamlBlockBodyEnd`).
fn block_body_end(src: Input<'_>, end: usize, mut p: usize, indent: usize) -> usize {
    while p < end {
        let col = skip_horizontal(src, end, p);
        let line_end = find_either(src, col, end, 10, 13);
        if col != line_end && col - p <= indent {
            break;
        }
        p = after_line(src, end, line_end);
    }
    p
}

/// A block scalar at the `|` or `>` at `lhs`: its header, an optional
/// comment, and its indented body as one string. Returns the end, or
/// `None` when the indicator does not end its line, leaving nothing
/// emitted (`$yamlBlockScalar`).
#[inline(never)]
fn block_scalar(src: Input<'_>, end: usize, mut out: Recs, lhs: usize) -> Option<(usize, Recs)> {
    let mut p = lhs + 1;
    // Optional chomping (`+`/`-`) and explicit indentation (`1`..`9`).
    while p < end {
        // SAFETY: `p` is below the input end.
        let c = unsafe { src.byte_unchecked(p) };
        if !(c == b'+' || c == b'-' || c.wrapping_sub(b'1') <= 8) {
            break;
        }
        p += 1;
    }
    // The header has to end the line, optionally with a comment after a
    // blank.
    let mut line_end = skip_horizontal(src, end, p);
    let comment = line_end;
    // SAFETY: `line_end` is below the input end (tested) in both reads.
    if line_end > p && line_end < end && unsafe { src.byte_unchecked(line_end) } == b'#' {
        line_end = find_either(src, line_end, end, 10, 13);
    }
    // SAFETY: `line_end` is below the input end (tested).
    if line_end < end
        && unsafe { src.byte_unchecked(line_end) } != 10
        && unsafe { src.byte_unchecked(line_end) } != 13
    {
        return None;
    }
    let indent = line_indent(src, end, lhs);
    out.emit(tok::PUNCTUATION_DELIMITER, lhs, p);
    out.gap(p, comment);
    out.emit(tok::COMMENT, comment, line_end);
    let body = after_line(src, end, line_end);
    out.gap(line_end, body);
    let body_end = block_body_end(src, end, body, indent);
    out.emit(tok::STRING, body, body_end);
    Some((body_end, out))
}

/// Whether the `:` at `p` is a mapping-value indicator: followed by a
/// blank, a line break, or the end, or inside a flow collection by `,`,
/// `]`, or `}` (`$yamlColonEnds`).
#[inline(always)]
fn colon_ends(src: Input<'_>, end: usize, p: usize, flow: u32) -> bool {
    // SAFETY: `p` is below the input end (tested).
    if p >= end || unsafe { src.byte_unchecked(p) } != b':' {
        return false;
    }
    let p = p + 1;
    if p >= end {
        return true;
    }
    // SAFETY: `p` is below the input end (tested above).
    let c = unsafe { src.byte_unchecked(p) };
    if is_space(c) {
        return true;
    }
    flow != 0 && (c == b',' || c == b']' || c == b'}')
}

/// Whether `c` stops a plain scalar outside a flow collection: a line
/// break, `:`, or `#` (`$yamlScanPlain`).
#[inline(always)]
fn is_plain_stop(c: u8) -> bool {
    c == 10 || c == 13 || c == b':' || c == b'#'
}

/// Whether `c` also stops a plain scalar inside a flow collection
/// (`$yamlScanPlain`).
#[inline(always)]
fn is_flow_stop(c: u8) -> bool {
    c == b',' || c == b'[' || c == b']' || c == b'{' || c == b'}'
}

/// Whether `p` starts a line: the input start, or right after a line
/// break (`$yamlAtLineStart`).
#[inline(always)]
fn at_line_start(src: Input<'_>, p: usize) -> bool {
    // SAFETY: `p` is at most the input end and above 0, so `p - 1` is inside
    // the input.
    p == 0
        || unsafe { src.byte_unchecked(p - 1) } == 10
        || unsafe { src.byte_unchecked(p - 1) } == 13
}

/// A quoted scalar at `lhs` with quote `q`: a mapping key (property) when
/// a `:` follows its closing quote, else a string, and that `:` as a
/// delimiter. Returns the end (`$hlYaml`, `$lexString`, `$lexRawString`).
#[inline(always)]
fn quoted(src: Input<'_>, end: usize, mut out: Recs, lhs: usize, q: u8) -> (usize, Recs) {
    // Probe the closing quote, hopping from quote to backslash, across
    // line breaks.
    let mut p = lhs + 1;
    let mut escaped = false;
    loop {
        p = find_quote(src, p, end, q, q == b'"');
        if p >= end {
            break;
        }
        // SAFETY: `p` is below the input end (tested above, and below).
        let c = unsafe { src.byte_unchecked(p) };
        p += 1;
        // `''` escapes a quote inside a single-quoted scalar.
        if c == b'\'' && p < end && unsafe { src.byte_unchecked(p) } == b'\'' {
            p += 1;
            continue;
        }
        if c == q {
            break;
        }
        // A backslash: step over the byte it escapes.
        escaped = true;
        if p < end {
            p += 1;
        }
    }
    let after = skip_horizontal(src, end, p);
    // SAFETY: `after` is below the input end (tested).
    let hl = if after < end && unsafe { src.byte_unchecked(after) } == b':' {
        tok::PROPERTY
    } else {
        tok::STRING
    };
    if q == b'\'' || !escaped {
        // `$lexRawString` (once per `''` escape, in spans that share a
        // color and so make one token) ends where the probe did: at the
        // first quote no quote follows, its `''` pairs taken left to
        // right. So does `$lexString` on a body with no backslash.
        out.emit(hl, lhs, p);
    } else {
        // `$lexString` with multiline set: escapes are their own tokens.
        let mut seg = lhs;
        p = lhs + 1;
        loop {
            p = find_quote(src, p, end, q, true);
            if p >= end {
                break;
            }
            // SAFETY: `p` is below the input end (tested above).
            if unsafe { src.byte_unchecked(p) } == q {
                p += 1;
                break;
            }
            out.emit(hl, seg, p);
            let e = escape_end(src, end, p);
            out.emit(tok::STRING_ESCAPE, p, e);
            p = e;
            seg = p;
        }
        out.emit(hl, seg, p);
    }
    // The key's `:` is the value indicator even when glued to the value.
    if hl == tok::PROPERTY && p <= after {
        out.gap(p, after);
        p = after + 1;
        out.tok(tok::PUNCTUATION_DELIMITER, p);
    }
    (p, out)
}

/// Byte classes as two nibble tables: byte `b` is in a class when
/// `CLASS_HI[b >> 4] & CLASS_LO[b & 15]` has one of its bits. Plain-scalar
/// stops: 1 for LF and CR, 2 for `:`, 4 for `#`; whitespace: 8 for TAB to
/// CR, 16 for a space.
const CLASS_HI: [u8; 16] = [1 | 8, 0, 4 | 16, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const CLASS_LO: [u8; 16] = [16, 0, 0, 4, 0, 0, 0, 0, 0, 8, 1 | 2 | 8, 8, 8, 1 | 8, 0, 0];
const STOP_BITS: u8 = 1 | 2 | 4;
const SPACE_BITS: u8 = 8 | 16;

/// The plain-stop and non-whitespace masks of the 64 bytes from `b`, one
/// bit per byte. `b + 64` must lie inside the input slack.
#[inline(always)]
fn block_masks(src: Input<'_>, b: usize) -> (u64, u64) {
    let hi_t = V::from_array(&CLASS_HI);
    let lo_t = V::from_array(&CLASS_LO);
    let mut stop = [V::zero(); 4];
    let mut space = [V::zero(); 4];
    for i in 0..4 {
        // SAFETY: every window block starts at or before the input end, so its
        // 64 bytes stay inside the slack.
        let v = unsafe { src.vec_unchecked(b + 16 * i) };
        let class = hi_t
            .lookup(v.shr::<4>())
            .and(lo_t.lookup(v.and(V::splat(15))));
        stop[i] = class.test(V::splat(STOP_BITS));
        space[i] = class.test(V::splat(SPACE_BITS));
    }
    (
        V::bits64(stop[0], stop[1], stop[2], stop[3]),
        !V::bits64(space[0], space[1], space[2], space[3]),
    )
}

/// Bit masks of two adjacent 64-byte blocks of the input, the second
/// starting at `mid`: for each byte, whether it stops a plain scalar
/// outside a flow collection, and whether it is not whitespace. A scan
/// over the window is a shift and a bit count, so the next token's start
/// does not wait on a vector scan of the bytes before it.
#[derive(Clone, Copy)]
struct Window {
    mid: usize,
    stop0: u64,
    text0: u64,
    stop1: u64,
    text1: u64,
}

impl Window {
    /// The window from block `blk`. The second block's masks are loaded
    /// only when it starts by the input end `end`; past it every scan's
    /// result is clamped to the end, or stops at the NUL after the input.
    #[inline(always)]
    fn at(src: Input<'_>, end: usize, blk: usize) -> Self {
        let (stop0, text0) = block_masks(src, blk);
        let mid = blk + 64;
        let (stop1, text1) = if mid <= end {
            block_masks(src, mid)
        } else {
            (u64::MAX, u64::MAX)
        };
        Window {
            mid,
            stop0,
            text0,
            stop1,
            text1,
        }
    }

    /// Move the window so that `p` lies in its first block.
    #[inline(always)]
    fn sync(&mut self, src: Input<'_>, end: usize, p: usize) {
        if p < self.mid {
            return;
        }
        if p < self.mid + 64 {
            let mid = self.mid + 64;
            let (stop1, text1) = if mid <= end {
                block_masks(src, mid)
            } else {
                (u64::MAX, u64::MAX)
            };
            *self = Window {
                mid,
                stop0: self.stop1,
                text0: self.text1,
                stop1,
                text1,
            };
        } else {
            core::hint::cold_path();
            *self = Window::at(src, end, p & !63);
        }
    }

    /// The first line break after the `#` at `p`, which lies in the first
    /// block, or `end` (`$scanToLineEnd`): the window's stop bits from
    /// there, the `:` and `#` ones cleared.
    #[inline(always)]
    fn line_end(&self, src: Input<'_>, end: usize, p: usize) -> usize {
        let base = self.mid - 64;
        let mut block = base;
        // The `#` is bit 0.
        let mut m = (self.stop0 >> ((p - base) & 63) >> 1) << ((p - base) & 63) << 1;
        loop {
            if m == 0 {
                core::hint::cold_path();
                if block == base {
                    block = self.mid;
                    m = self.stop1;
                    continue;
                }
                return scan::line_end(src.bytes(), self.mid + 64, end);
            }
            let s = block + m.trailing_zeros() as usize;
            if s >= end {
                return end;
            }
            // SAFETY: `s` is below the input end (tested above).
            let c = unsafe { src.byte_unchecked(s) };
            if c == 10 || c == 13 {
                return s;
            }
            m &= m - 1;
        }
    }

    /// The end of the whitespace run from `p`, which lies in the first
    /// block (`$scanWhitespace`). The window moves so that the end lies in
    /// its first block too.
    #[inline(always)]
    fn space_end(&mut self, src: Input<'_>, end: usize, p: usize) -> usize {
        // `sync` keeps `p` in the first block, whose start is `mid - 64`:
        // its offset there is `(p - mid) & 63`.
        let m = self.text0 >> (p.wrapping_sub(self.mid) & 63);
        if m != 0 {
            return p + m.trailing_zeros() as usize;
        }
        let e = if self.text1 != 0 {
            self.mid + self.text1.trailing_zeros() as usize
        } else {
            core::hint::cold_path();
            space_end(src, self.mid + 64)
        };
        self.sync(src, end, e);
        e
    }

    /// The first plain-scalar stop from `p` (at or after the window
    /// start) outside a flow collection, clamped to `end`.
    #[inline(always)]
    fn plain_stop(&self, src: Input<'_>, end: usize, p: usize) -> usize {
        let off = p - (self.mid - 64);
        if off < 64 {
            let m = self.stop0 >> off;
            if m != 0 {
                return (p + m.trailing_zeros() as usize).min(end);
            }
            core::hint::cold_path();
            if self.stop1 != 0 {
                return (self.mid + self.stop1.trailing_zeros() as usize).min(end);
            }
        } else if off < 128 {
            let m = self.stop1 >> (off - 64);
            if m != 0 {
                return (p + m.trailing_zeros() as usize).min(end);
            }
        }
        core::hint::cold_path();
        plain_stop_after(src, end, p.max(self.mid + 64), false)
    }
}

/// The first plain-scalar stop from `p`, or `end`, byte by byte; with
/// `flow`, the flow indicators too.
#[cold]
#[inline(never)]
fn plain_stop_after(src: Input<'_>, end: usize, mut p: usize, flow: bool) -> usize {
    while p < end {
        // SAFETY: `p` is below the input end.
        let c = unsafe { src.byte_unchecked(p) };
        if is_plain_stop(c) || (flow && is_flow_stop(c)) {
            return p;
        }
        p += 1;
    }
    end
}

/// The end of a plain scalar from `start`: up to its line end, a `:` that
/// [`colon_ends`] accepts, or a `#` after a blank, and inside a flow
/// collection a flow indicator; trailing blanks are left out. Also returns
/// whether that `:` ended it (`$yamlScanPlain`).
#[inline(always)]
fn scan_plain(src: Input<'_>, end: usize, win: &Window, start: usize, flow: u32) -> (usize, bool) {
    let mut p = start;
    let mut colon = false;
    loop {
        let s = if flow == 0 {
            win.plain_stop(src, end, p)
        } else {
            plain_stop_after(src, end, p, true)
        };
        if s >= end {
            p = end;
            break;
        }
        // SAFETY: `s` is below the input end (tested above).
        let c = unsafe { src.byte_unchecked(s) };
        // A `:` that does not end the scalar, as in `http://x`, and a `#`
        // glued to the text before it are scalar bytes.
        if c == b':' {
            if colon_ends(src, end, s, flow) {
                p = s;
                colon = true;
                break;
            }
            p = s + 1;
            continue;
        }
        // SAFETY: `s - 1` lies between `start` and `s`, below the input end.
        if c == b'#' && !(s > start && is_blank(unsafe { src.byte_unchecked(s - 1) })) {
            p = s + 1;
            continue;
        }
        p = s;
        break;
    }
    // Trailing blanks are a gap, not scalar text.
    // SAFETY: `p - 1` lies between `start` and the scalar end, below the input
    // end.
    while p > start && is_blank(unsafe { src.byte_unchecked(p - 1) }) {
        p -= 1;
    }
    (p, colon)
}

/// First-byte kinds of the main rules, one bit each; bytes of kind 0 start
/// a plain scalar.
const K_HASH: u8 = 1;
const K_QUOTE: u8 = 2;
const K_TAG: u8 = 4;
const K_DASH: u8 = 8;
const K_DOT: u8 = 16;
const K_NUMBER: u8 = 32;
const K_BRACKET: u8 = 64;
const K_PUNCT: u8 = 128;

/// The kind of every byte.
static KIND: [u8; 256] = {
    let mut t = [0u8; 256];
    t[b'#' as usize] = K_HASH;
    t[b'"' as usize] = K_QUOTE;
    t[b'\'' as usize] = K_QUOTE;
    t[b'&' as usize] = K_TAG;
    t[b'*' as usize] = K_TAG;
    t[b'!' as usize] = K_TAG;
    t[b'-' as usize] = K_DASH;
    t[b'.' as usize] = K_DOT;
    t[b'+' as usize] = K_NUMBER;
    let mut d = b'0';
    while d <= b'9' {
        t[d as usize] = K_NUMBER;
        d += 1;
    }
    t[b'[' as usize] = K_BRACKET;
    t[b']' as usize] = K_BRACKET;
    t[b'{' as usize] = K_BRACKET;
    t[b'}' as usize] = K_BRACKET;
    t[b'|' as usize] = K_PUNCT;
    t[b'>' as usize] = K_PUNCT;
    t[b',' as usize] = K_PUNCT;
    t[b'?' as usize] = K_PUNCT;
    t[b':' as usize] = K_PUNCT;
    t
};

/// Lex the input at `base` (`$hlYaml`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: `base..base + len + SLACK` lies inside lexer memory, and this
    // lexer calls no translated function that could move it.
    let src = unsafe { Input::new(inst, base, len) };
    let mut out = Recs::load(inst);
    // `$lexEmitLeadingContinuation`.
    let p = scan::utf8_span_end(src.bytes(), 0, len);
    out.gap(0, p);
    lex(src, len, out, p).store(inst);
}

/// A number at `p` (its first digit, after any sign of the token at
/// `lhs`) and the plain-scalar bytes glued to it, as in `12:30:00` or
/// `2024-01-01`: its end, its color, and whether a mapping `:` ends it. A
/// bare number a `: ` follows is a mapping key, as with OpenAPI status
/// codes (`200:`) (`$hlYaml`).
#[inline(always)]
fn number(
    src: Input<'_>,
    end: usize,
    win: &Window,
    lhs: usize,
    p: usize,
    flow: u32,
) -> (usize, u32, bool) {
    let num_end = scan_number(src, end, p);
    // The WAT scans the plain scalar again after a number that runs on,
    // from where this scan stopped: that finds the same stop and ends
    // where this one did, so its result is this one's.
    let (p, colon) = scan_plain(src, end, win, num_end, flow);
    let hl = if colon {
        tok::PROPERTY
    } else if p == num_end {
        tok::NUMBER
    } else {
        word_hl(src, lhs, p)
    };
    (p, hl, colon)
}

/// The lexer loop, from the start of the input (`$hlYaml` outside a
/// resumed block scalar). Each pass lexes one token at `p` and then the
/// whitespace after it.
fn lex(src: Input<'_>, end: usize, mut out: Recs, mut p: usize) -> Recs {
    // Open `[` and `{` flow collections.
    let mut flow = 0u32;
    let mut win = Window::at(src, end, p & !63);
    // The whitespace before the first token; there may be no record yet.
    // `gap` is where the whitespace before the current token starts.
    let mut gap = p;
    p = win.space_end(src, end, p);
    out.gap(gap, p);
    while p < end {
        let lhs = p;
        // SAFETY: `p` is below the input end.
        let c = unsafe { src.byte_unchecked(p) };
        let k = KIND[c as usize];
        // The rules match disjoint first bytes, except where a rule tests
        // more than its first byte; a byte it then turns down goes on to
        // the later rules, in the WAT's order, and at last to the plain
        // scalar.
        'done: {
            'plain: {
                if k == 0 {
                    break 'plain;
                }
                // `- `, the common block sequence entry: no document marker
                // or number, so the `-` indicator below.
                // SAFETY: `p` is below the input end, so `p + 1` is at most the
                // NUL after it.
                if c == b'-' && unsafe { src.byte_unchecked(p + 1) } == b' ' {
                    p += 1;
                    out.tok(tok::PUNCTUATION_DELIMITER, p);
                    break 'done;
                }
                if k & K_HASH != 0 {
                    // A `#` opens a comment after a blank or at a line
                    // start.
                    if !(p != gap || at_line_start(src, p)) {
                        break 'plain;
                    }
                    // `$lexLineComment`.
                    p = win.line_end(src, end, p);
                    out.tok(tok::COMMENT, p);
                    break 'done;
                }
                if k & K_QUOTE != 0 {
                    (p, out) = quoted(src, end, out, lhs, c);
                    break 'done;
                }
                // Anchors, aliases, and tags.
                if k & K_TAG != 0 {
                    p = ident_run(src, p + 1);
                    out.tok(tok::TYPE, p);
                    break 'done;
                }
                if k & K_BRACKET != 0 {
                    if c == b'[' || c == b'{' {
                        flow += 1;
                    } else {
                        flow = flow.saturating_sub(1);
                    }
                    p += 1;
                    out.tok(tok::PUNCTUATION_BRACKET, p);
                    break 'done;
                }
                // Document markers, numbers with a sign, and the `-`
                // indicator.
                if k & (K_DASH | K_DOT) != 0 {
                    // SAFETY: `p + 2` is below the input end (tested).
                    if p + 3 <= end
                        && unsafe { src.byte_unchecked(p + 1) } == c
                        && unsafe { src.byte_unchecked(p + 2) } == c
                    {
                        p += 3;
                        out.tok(tok::PUNCTUATION_SPECIAL, p);
                        break 'done;
                    }
                    if c == b'.' {
                        break 'plain;
                    }
                }
                if k & (K_DASH | K_NUMBER) != 0 {
                    let digit = is_digit(c);
                    // SAFETY: `p + 1` is below the input end (tested).
                    if digit || (p + 1 < end && is_digit(unsafe { src.byte_unchecked(p + 1) })) {
                        let hl;
                        let colon;
                        (p, hl, colon) = number(src, end, &win, lhs, p + (!digit) as usize, flow);
                        out.tok(hl, p);
                        // SAFETY: a token ends at or before the input end.
                        if colon && unsafe { src.byte_unchecked(p) } == b':' {
                            p += 1;
                            // (`colon` makes the number's color property)
                            out.push(tok::PUNCTUATION_DELIMITER, p);
                        }
                        break 'done;
                    }
                    if c == b'+' {
                        break 'plain;
                    }
                    // `-`.
                    p += 1;
                    out.tok(tok::PUNCTUATION_DELIMITER, p);
                    break 'done;
                }
                // `|`, `>`, `,`, `?`, and `:`.
                if (c == b'|' || c == b'>')
                    && let Some((e, o)) = block_scalar(src, end, out, lhs)
                {
                    p = e;
                    out = o;
                    break 'done;
                }
                // A `:` that does not end a key, as in `:foo`, starts a
                // plain scalar.
                if c == b':' && !colon_ends(src, end, p, flow) {
                    break 'plain;
                }
                p += 1;
                out.tok(tok::PUNCTUATION_DELIMITER, p);
                break 'done;
            }
            // Plain scalar: a mapping key when a `: ` follows.
            let colon;
            (p, colon) = scan_plain(src, end, &win, lhs, flow);
            let hl = if p == lhs {
                // Unreachable from the rules above, which take every byte
                // a plain scalar would stop at first; kept as the WAT has
                // it.
                core::hint::cold_path();
                p += 1;
                if colon_ends(src, end, skip_horizontal(src, end, p), flow) {
                    tok::PROPERTY
                } else {
                    word_hl(src, lhs, p)
                }
            } else if colon {
                tok::PROPERTY
            } else {
                word_hl(src, lhs, p)
            };
            out.tok(hl, p);
            // A key's `:` right after it is the next token.
            // SAFETY: a token ends at or before the input end.
            if hl == tok::PROPERTY && unsafe { src.byte_unchecked(p) } == b':' {
                p += 1;
                out.push(tok::PUNCTUATION_DELIMITER, p);
            }
        }

        // The whitespace after the token extends its record.
        win.sync(src, end, p);
        gap = p;
        p = win.space_end(src, end, p);
        out.extend(p);
    }
    out
}
