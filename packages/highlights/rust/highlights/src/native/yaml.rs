//! WAT sources: src/langs/yaml.wat src/common.wat src/scan.wat
//!
//! Native YAML lexer. One pass over the input: comments, quoted and plain
//! scalars (a scalar a `: ` follows is a mapping key), anchors, aliases and
//! tags, document markers, flow brackets, indicators, numbers, and block
//! scalars, whose indented body is one string. The records equal the
//! translated `yaml` lexer's records.

use super::Lexer;
use super::scan;
use crate::Rec;
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

/// The byte at `p`.
#[inline(always)]
fn at(src: &[u8], p: usize) -> u8 {
    debug_assert!(p < src.len());
    // SAFETY: every position read lies at most 16 bytes past the input
    // end, inside the input slack `src` covers.
    unsafe { *src.get_unchecked(p) }
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

/// Token records written through a moving pointer into `inst.ext.recs`,
/// the way the translated `$emitTok` and `$emitGap` write them: a token
/// extends the last record when its color matches, and whitespace extends
/// the last record whatever its color. The vector has room for one record
/// per input byte and every record covers at least one byte, so running
/// out of room means a lexer bug, which traps.
#[derive(Clone, Copy)]
struct Out {
    cur: *mut Rec,
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

    /// Append a non-empty token ending at `end` whose color differs from
    /// the last record's, so it never merges (`$emitTok`).
    #[inline(always)]
    fn push(&mut self, hl: u32, end: usize) {
        debug_assert!(self.last != hl);
        // SAFETY: the trap stops a write at the limit.
        unsafe {
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

    /// The token `[lhs, rhs)`, if not empty (`$emitTok`).
    #[inline(always)]
    fn span(&mut self, hl: u32, lhs: usize, rhs: usize) {
        if lhs < rhs {
            self.tok(hl, rhs);
        }
    }

    /// Whitespace `[lhs, rhs)` extends the last record, or makes a plain
    /// one when there is none (`$emitGap`).
    #[inline(always)]
    fn gap(&mut self, lhs: usize, rhs: usize) {
        if lhs >= rhs {
            return;
        }
        if self.cur == self.start {
            self.tok(tok::NONE, rhs);
        } else {
            // SAFETY: a record exists before `cur`.
            unsafe { (*self.cur.sub(1)).end = rhs as u32 };
        }
    }
}

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run by the input end.
#[inline(always)]
fn space_end(src: &[u8], mut p: usize) -> usize {
    while is_space(at(src, p)) {
        p += 1;
    }
    p
}

/// The end of the run of identifier bytes from `p` (`$scanIdentRun` with
/// `$`, `$lexScanIdent`). The NUL after the input ends every run.
#[inline(always)]
fn ident_run(src: &[u8], mut p: usize) -> usize {
    while is_ident_continue(at(src, p)) {
        p += 1;
    }
    p
}

/// The first `a` or `b` from `p`, or `end` (`$lexFindEither`).
#[inline(always)]
fn find_either(src: &[u8], p: usize, end: usize, a: u8, b: u8) -> usize {
    let mut p = p;
    while p < end {
        let c = at(src, p);
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
fn find_quote(src: &[u8], mut p: usize, end: usize, quote: u8, esc: bool) -> usize {
    if p >= end {
        return p;
    }
    while p < end {
        // SAFETY: `p` is below the input end, so the 16-byte load stays
        // inside the slack.
        let v = unsafe { V::load(src.as_ptr().add(p)) };
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
fn escape_end(src: &[u8], end: usize, p: usize) -> usize {
    let mut e = scan::utf8_span_end(src, p + 2, end);
    if e == p + 2 && at(src, p + 1) == 13 && e < end && at(src, e) == 10 {
        e += 1;
    }
    e
}

/// A number from `p`, at its first digit after any sign
/// (`$lexScanNumber`, `$lexScanNumberBody`).
#[inline(always)]
fn scan_number(src: &[u8], end: usize, mut p: usize) -> usize {
    let hex = p + 1 < end && at(src, p) == b'0' && at(src, p + 1) | 32 == b'x';
    let mut prev = 0u8;
    while p < end {
        let c = at(src, p);
        if is_ident_continue(c) {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            let next = if p + 1 < end { at(src, p + 1) } else { 0 };
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
fn word_hl(src: &[u8], lhs: usize, rhs: usize) -> u32 {
    let n = rhs - lhs;
    if n.wrapping_sub(1) > 4 {
        return tok::STRING;
    }
    if n == 1 {
        return if at(src, lhs) == b'~' {
            tok::CONSTANT_BUILTIN
        } else {
            tok::STRING
        };
    }
    // SAFETY: 8 bytes from a scalar's start stay inside the slack.
    let w8 = unsafe { src.as_ptr().add(lhs).cast::<u64>().read_unaligned() }.to_le();
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
fn skip_horizontal(src: &[u8], end: usize, mut p: usize) -> usize {
    while p < end && is_blank(at(src, p)) {
        p += 1;
    }
    p
}

/// The position after the line break at `p`, if any (`$yamlAfterLine`).
#[inline(always)]
fn after_line(src: &[u8], end: usize, mut p: usize) -> usize {
    if p < end {
        if at(src, p) == 13 {
            p += 1;
        }
        if p < end && at(src, p) == 10 {
            p += 1;
        }
    }
    p
}

/// The leading blanks of the line containing `p` (`$yamlLineIndent`).
fn line_indent(src: &[u8], end: usize, mut p: usize) -> usize {
    while p > 0 && !(at(src, p - 1) == 10 || at(src, p - 1) == 13) {
        p -= 1;
    }
    skip_horizontal(src, end, p) - p
}

/// The end of a block scalar body from `p`: every following line that is
/// blank, or indented deeper than `indent`, belongs to it
/// (`$yamlBlockBodyEnd`).
fn block_body_end(src: &[u8], end: usize, mut p: usize, indent: usize) -> usize {
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
fn block_scalar(src: &[u8], end: usize, mut out: Out, lhs: usize) -> Option<(usize, Out)> {
    let mut p = lhs + 1;
    // Optional chomping (`+`/`-`) and explicit indentation (`1`..`9`).
    while p < end {
        let c = at(src, p);
        if !(c == b'+' || c == b'-' || c.wrapping_sub(b'1') <= 8) {
            break;
        }
        p += 1;
    }
    // The header has to end the line, optionally with a comment after a
    // blank.
    let mut line_end = skip_horizontal(src, end, p);
    let comment = line_end;
    if line_end > p && line_end < end && at(src, line_end) == b'#' {
        line_end = find_either(src, line_end, end, 10, 13);
    }
    if line_end < end && at(src, line_end) != 10 && at(src, line_end) != 13 {
        return None;
    }
    let indent = line_indent(src, end, lhs);
    out.span(tok::PUNCTUATION_DELIMITER, lhs, p);
    out.gap(p, comment);
    out.span(tok::COMMENT, comment, line_end);
    let body = after_line(src, end, line_end);
    out.gap(line_end, body);
    let body_end = block_body_end(src, end, body, indent);
    out.span(tok::STRING, body, body_end);
    Some((body_end, out))
}

/// Whether the `:` at `p` is a mapping-value indicator: followed by a
/// blank, a line break, or the end, or inside a flow collection by `,`,
/// `]`, or `}` (`$yamlColonEnds`).
#[inline(always)]
fn colon_ends(src: &[u8], end: usize, p: usize, flow: u32) -> bool {
    if p >= end || at(src, p) != b':' {
        return false;
    }
    let p = p + 1;
    if p >= end {
        return true;
    }
    let c = at(src, p);
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
fn at_line_start(src: &[u8], p: usize) -> bool {
    p == 0 || at(src, p - 1) == 10 || at(src, p - 1) == 13
}

/// A quoted scalar at `lhs` with quote `q`: a mapping key (property) when
/// a `:` follows its closing quote, else a string, and that `:` as a
/// delimiter. Returns the end (`$hlYaml`, `$lexString`, `$lexRawString`).
#[inline(always)]
fn quoted(src: &[u8], end: usize, mut out: Out, lhs: usize, q: u8) -> (usize, Out) {
    // Probe the closing quote, hopping from quote to backslash, across
    // line breaks.
    let mut p = lhs + 1;
    let mut escaped = false;
    loop {
        p = find_quote(src, p, end, q, q == b'"');
        if p >= end {
            break;
        }
        let c = at(src, p);
        p += 1;
        // `''` escapes a quote inside a single-quoted scalar.
        if c == b'\'' && p < end && at(src, p) == b'\'' {
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
    let hl = if after < end && at(src, after) == b':' {
        tok::PROPERTY
    } else {
        tok::STRING
    };
    if q == b'\'' || !escaped {
        // `$lexRawString` (once per `''` escape, in spans that share a
        // color and so make one token) ends where the probe did: at the
        // first quote no quote follows, its `''` pairs taken left to
        // right. So does `$lexString` on a body with no backslash.
        out.span(hl, lhs, p);
    } else {
        // `$lexString` with multiline set: escapes are their own tokens.
        let mut seg = lhs;
        p = lhs + 1;
        loop {
            p = find_quote(src, p, end, q, true);
            if p >= end {
                break;
            }
            if at(src, p) == q {
                p += 1;
                break;
            }
            out.span(hl, seg, p);
            let e = escape_end(src, end, p);
            out.span(tok::STRING_ESCAPE, p, e);
            p = e;
            seg = p;
        }
        out.span(hl, seg, p);
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
fn block_masks(src: &[u8], b: usize) -> (u64, u64) {
    debug_assert!(b + 64 <= src.len());
    let hi_t = V::from_array(&CLASS_HI);
    let lo_t = V::from_array(&CLASS_LO);
    let mut stop = [V::zero(); 4];
    let mut space = [V::zero(); 4];
    for i in 0..4 {
        // SAFETY: the caller keeps the 64 bytes from `b` inside the slack.
        let v = unsafe { V::load(src.as_ptr().add(b + 16 * i)) };
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
    fn at(src: &[u8], end: usize, blk: usize) -> Self {
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
    fn sync(&mut self, src: &[u8], end: usize, p: usize) {
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
    fn line_end(&self, src: &[u8], end: usize, p: usize) -> usize {
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
                return scan::line_end(src, self.mid + 64, end);
            }
            let s = block + m.trailing_zeros() as usize;
            if s >= end {
                return end;
            }
            let c = at(src, s);
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
    fn space_end(&mut self, src: &[u8], end: usize, p: usize) -> usize {
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
    fn plain_stop(&self, src: &[u8], end: usize, p: usize) -> usize {
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
fn plain_stop_after(src: &[u8], end: usize, mut p: usize, flow: bool) -> usize {
    while p < end {
        let c = at(src, p);
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
fn scan_plain(src: &[u8], end: usize, win: &Window, start: usize, flow: u32) -> (usize, bool) {
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
        let c = at(src, s);
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
        if c == b'#' && !(s > start && is_blank(at(src, s - 1))) {
            p = s + 1;
            continue;
        }
        p = s;
        break;
    }
    // Trailing blanks are a gap, not scalar text.
    while p > start && is_blank(at(src, p - 1)) {
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
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, and this
    // lexer calls no translated function that could reallocate it.
    let src: &[u8] = unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) };
    let v = &mut inst.ext.recs;
    let rp = v.as_mut_ptr();
    // SAFETY: the length and capacity bound the vector's allocation.
    let mut out = unsafe {
        Out {
            cur: rp.add(v.len()),
            start: rp,
            limit: rp.add(v.capacity()),
            last: v.last().map_or(u32::MAX, |r| r.token),
        }
    };
    // `$lexEmitLeadingContinuation`.
    let p = scan::utf8_span_end(src, 0, len);
    out.gap(0, p);
    let out = lex(src, len, out, p);
    // SAFETY: the records before `out.cur` are written, within capacity.
    unsafe { v.set_len(out.cur.offset_from(rp) as usize) };
}

/// A number at `p` (its first digit, after any sign of the token at
/// `lhs`) and the plain-scalar bytes glued to it, as in `12:30:00` or
/// `2024-01-01`: its end, its color, and whether a mapping `:` ends it. A
/// bare number a `: ` follows is a mapping key, as with OpenAPI status
/// codes (`200:`) (`$hlYaml`).
#[inline(always)]
fn number(
    src: &[u8],
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
fn lex(src: &[u8], end: usize, mut out: Out, mut p: usize) -> Out {
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
        let c = at(src, p);
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
                if c == b'-' && at(src, p + 1) == b' ' {
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
                    if p + 3 <= end && at(src, p + 1) == c && at(src, p + 2) == c {
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
                    if digit || (p + 1 < end && is_digit(at(src, p + 1))) {
                        let hl;
                        let colon;
                        (p, hl, colon) = number(src, end, &win, lhs, p + (!digit) as usize, flow);
                        out.tok(hl, p);
                        if colon && at(src, p) == b':' {
                            p += 1;
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
            if hl == tok::PROPERTY && at(src, p) == b':' {
                p += 1;
                out.push(tok::PUNCTUATION_DELIMITER, p);
            }
        }

        // The whitespace after the token extends its record.
        win.sync(src, end, p);
        gap = p;
        p = win.space_end(src, end, p);
        // SAFETY: the token emitted a record.
        unsafe { out.extend(p) };
    }
    out
}
