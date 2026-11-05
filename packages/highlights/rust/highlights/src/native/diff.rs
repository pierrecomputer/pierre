//! WAT sources: src/langs/diff.wat src/common.wat src/scan.wat
//!
//! Native diff and patch lexer. Each line is colored by its first bytes:
//! `+`/`-` payload lines with their markers, `@@` hunk headers, `#`
//! comments, and git metadata (`diff`, `index`, mode, rename, similarity,
//! and binary lines), split into their fields. The records equal the
//! translated `diff` lexer's records.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "diff" => Some(highlight),
        _ => None,
    }
}

/// The line kinds of `$hlDiff`, by a line's first byte.
mod line {
    pub const PLAIN: u8 = 0;
    /// `+` or `-`.
    pub const PAYLOAD: u8 = 1;
    /// `@`: a hunk header when another `@` follows.
    pub const AT: u8 = 2;
    pub const HASH: u8 = 3;
    /// A byte git metadata starts with: B, c, d, i, n, o, r, or s.
    pub const META: u8 = 4;
}

/// The [`line`] kind of each first byte.
static LINE: [u8; 256] = {
    let mut t = [line::PLAIN; 256];
    t[b'+' as usize] = line::PAYLOAD;
    t[b'-' as usize] = line::PAYLOAD;
    t[b'@' as usize] = line::AT;
    t[b'#' as usize] = line::HASH;
    let meta = b"Bcdinors";
    let mut i = 0;
    while i < meta.len() {
        t[meta[i] as usize] = line::META;
        i += 1;
    }
    t
};

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

/// Whether `c` is an ASCII digit (`$lexIsDigit`).
#[inline(always)]
const fn is_digit(c: u8) -> bool {
    c.wrapping_sub(b'0') <= 9
}

/// Whether `c` is ASCII whitespace: space or TAB through CR (`$lexIsSpace`).
#[inline(always)]
const fn is_space(c: u8) -> bool {
    c == b' ' || c.wrapping_sub(9) <= 4
}

/// Whether `c` is an ASCII hex digit.
#[inline(always)]
const fn is_hex(c: u8) -> bool {
    is_digit(c) || (c | 32).wrapping_sub(b'a') <= 5
}

/// Skip whitespace from `p`, stopping at `line_end` (`$diffSkipSpace`).
#[inline(always)]
fn skip_space(inp: Input, mut p: usize, line_end: usize) -> usize {
    // SAFETY: `p` lies below `line_end`, inside the input.
    while p < line_end && is_space(unsafe { inp.byte_unchecked(p) }) {
        p += 1;
    }
    p
}

/// Skip decimal digits from `p`, stopping at `line_end`
/// (`$diffSkipDigits`).
#[inline(always)]
fn skip_digits(inp: Input, mut p: usize, line_end: usize) -> usize {
    // SAFETY: `p` lies below `line_end`, inside the input.
    while p < line_end && is_digit(unsafe { inp.byte_unchecked(p) }) {
        p += 1;
    }
    p
}

/// Skip hex digits from `p`, stopping at `line_end` (`$scanHexRun` with
/// the rest of the line as its limit).
#[inline(always)]
fn skip_hex(inp: Input, mut p: usize, line_end: usize) -> usize {
    // SAFETY: `p` lies below `line_end`, inside the input.
    while p < line_end && is_hex(unsafe { inp.byte_unchecked(p) }) {
        p += 1;
    }
    p
}

/// A bit per byte of the 64 bytes at `b` (a multiple of 64 at or before
/// the input end), set for CR and LF. Bytes past the input end may set
/// bits too; callers clamp to the end.
#[inline(always)]
fn block_breaks(inp: Input, b: usize) -> u64 {
    // SAFETY: `b` lies at or before the input end, so its 64 bytes lie
    // inside the slack.
    let [v0, v1, v2, v3] = [0, 16, 32, 48].map(|i| unsafe { inp.vec_unchecked(b + i) });
    let hit = |v: V| v.eq(V::splat(b'\n')).or(v.eq(V::splat(b'\r')));
    V::bits64(hit(v0), hit(v1), hit(v2), hit(v3))
}

/// The line breaks of the input, one 64-byte block at a time: `mask` holds
/// a bit per CR or LF byte of the block at `base`.
struct Breaks {
    base: usize,
    mask: u64,
}

impl Breaks {
    /// The next CR or LF at or after `p`, or `end` (`$scanToLineEnd`).
    /// `p` lies at or after the block's start.
    #[inline(always)]
    fn next(&mut self, inp: Input, mut p: usize, end: usize) -> usize {
        loop {
            if p - self.base >= 64 {
                self.base = p & !63;
                if self.base >= end {
                    return end;
                }
                self.mask = block_breaks(inp, self.base);
            }
            let m = self.mask & (u64::MAX << (p - self.base));
            if m != 0 {
                return (self.base + m.trailing_zeros() as usize).min(end);
            }
            p = self.base + 64;
        }
    }
}

/// The git metadata line `[lhs, line_end)` whose first byte is one that
/// metadata starts with; a line of no known form is plain (the metadata
/// rules of `$hlDiff`).
#[inline(never)]
fn metadata(inp: Input, lhs: usize, line_end: usize, o: &mut Recs) {
    let len = line_end - lhs;
    // SAFETY: `lhs` lies inside the input, so every read below at most 17
    // bytes past it lies inside the slack.
    let (w0, w1) = unsafe { (inp.word_unchecked(lhs), inp.word_unchecked(lhs + 8)) };

    // `diff` is a function, its first argument a parameter, and paths
    // plain.
    if len >= 4
        && w0 as u32 == word(b"diff") as u32
        && (lhs + 4 == line_end || is_space(unsafe { inp.byte_unchecked(lhs + 4) }))
    {
        o.tok(tok::FUNCTION, lhs + 4);
        let mut p = lhs + 4;
        let gap = p;
        p = skip_space(inp, p, line_end);
        if gap < p {
            o.extend(p);
        }
        let arg = p;
        // SAFETY: `p` lies below `line_end`, inside the input.
        while p < line_end && !is_space(unsafe { inp.byte_unchecked(p) }) {
            p += 1;
        }
        o.emit(tok::VARIABLE_PARAMETER, arg, p);
        o.emit(tok::NONE, p, line_end);
        return;
    }

    // Split an index line into its keyword, commits, separator, and mode.
    if len >= 5
        && w0 & 0xff_ffff_ffff == word(b"index")
        && (lhs + 5 == line_end || is_space(unsafe { inp.byte_unchecked(lhs + 5) }))
    {
        o.tok(tok::KEYWORD, lhs + 5);
        let mut p = lhs + 5;
        let gap = p;
        p = skip_space(inp, p, line_end);
        if gap < p {
            o.extend(p);
        }

        let hex = p;
        p = skip_hex(inp, p, line_end);
        if p == hex {
            o.emit(tok::NONE, p, line_end);
            return;
        }
        o.tok(tok::CONSTANT, p);
        // SAFETY: `p` lies inside the input, so its word lies inside the slack.
        if p + 2 > line_end || unsafe { inp.word_unchecked(p) } as u16 != word(b"..") as u16 {
            o.emit(tok::NONE, p, line_end);
            return;
        }
        o.tok(tok::PUNCTUATION_SPECIAL, p + 2);
        p += 2;

        let hex = p;
        p = skip_hex(inp, p, line_end);
        if p == hex {
            o.emit(tok::NONE, p, line_end);
            return;
        }
        o.tok(tok::CONSTANT, p);

        let gap = p;
        p = skip_space(inp, p, line_end);
        if gap < p {
            o.extend(p);
        }
        let num = p;
        p = skip_digits(inp, p, line_end);
        o.emit(tok::NUMBER, num, p);
        o.emit(tok::NONE, p, line_end);
        return;
    }

    // Similarity metadata is a label, with its score and percent numeric.
    if len >= 16 && w0 == word(b"similari") && w1 == word(b"ty index") {
        let mut p = skip_space(inp, lhs + 16, line_end);
        o.tok(tok::LABEL, p);
        let num = p;
        p = skip_digits(inp, p, line_end);
        o.emit(tok::NUMBER, num, p);
        // SAFETY: `p` lies below `line_end`, inside the input.
        if p < line_end && unsafe { inp.byte_unchecked(p) } == b'%' {
            o.tok(tok::NUMBER, p + 1);
            p += 1;
        }
        o.emit(tok::LABEL, p, line_end);
        return;
    }

    // File-mode changes are labels with a numeric mode override.
    let mut p = 0;
    if len >= 13 && w0 == word(b"new file") && w1 & 0xff_ffff_ffff == word(b" mode") {
        p = lhs + 13;
    }
    if len >= 17
        && w0 == word(b"deleted ")
        && w1 == word(b"file mod")
        && unsafe { inp.byte_unchecked(lhs + 16) } == b'e'
    {
        p = lhs + 17;
    }
    if len >= 8 && (w0 == word(b"new mode") || w0 == word(b"old mode")) {
        p = lhs + 8;
    }
    if p != 0 {
        p = skip_space(inp, p, line_end);
        o.tok(tok::LABEL, p);
        let num = p;
        p = skip_digits(inp, p, line_end);
        o.emit(tok::NUMBER, num, p);
        o.emit(tok::LABEL, p, line_end);
        return;
    }

    // Rename/copy and binary-change metadata are labels.
    if (len >= 11 && w0 == word(b"rename f") && w1 & 0xff_ffff == word(b"rom"))
        || (len >= 9 && w0 == word(b"rename t") && unsafe { inp.byte_unchecked(lhs + 8) } == b'o')
        || (len >= 9 && w0 == word(b"copy fro") && unsafe { inp.byte_unchecked(lhs + 8) } == b'm')
        || (len >= 7 && w0 & 0x00ff_ffff_ffff_ffff == word(b"copy to"))
        || (len >= 12 && w0 == word(b"Binary f") && w1 as u32 == word(b"iles") as u32)
    {
        o.tok(tok::LABEL, line_end);
        return;
    }

    o.emit(tok::NONE, lhs, line_end);
}

/// Lex the diff input of `len` bytes at `base` (`$hlDiff`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: the input and its slack lie inside lexer memory, and this
    // lexer calls no translated code that could move it.
    let inp = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut o = Recs::load(inst);

    // `$lexEmitLeadingContinuation` and the line breaks of any empty first
    // lines: one gap, which writes the first record when there is none
    // yet. (An empty line emits no token.)
    let mut ptr = scan::utf8_span_end(inp.bytes(), 0, end);
    while inp.byte(ptr) == b'\n' || inp.byte(ptr) == b'\r' {
        ptr += 1;
    }
    o.gap(0, ptr);
    let mut breaks = Breaks {
        base: 0,
        mask: block_breaks(inp, 0),
    };
    while ptr < end {
        let lhs = ptr;
        // SAFETY: `ptr` lies inside the input.
        let c = unsafe { inp.byte_unchecked(ptr) };
        let line_end = breaks.next(inp, ptr, end);
        let n = line_end - lhs;

        // Addition/deletion markers are punctuation; only their payload
        // is diff-colored. A `+++ `/`--- ` file header marks just its
        // three bytes, so the path keeps the diff color.
        match LINE[c as usize] {
            // Addition/deletion markers are punctuation; only their
            // payload is diff-colored. A `+++ `/`--- ` file header marks
            // just its three bytes, so the path keeps the diff color.
            line::PAYLOAD => {
                let mut p = lhs + 1;
                // (a single marker, the common case, can't open a header)
                // SAFETY: `p` lies at or before the input end.
                if unsafe { inp.byte_unchecked(p) } == c {
                    if n >= 4
                        // SAFETY: `lhs` lies inside the input, so its word
                        // lies inside the slack.
                        && unsafe { inp.word_unchecked(lhs) } as u32 & 0xff_ffff
                            == c as u32 * 0x01_0101
                        // SAFETY: `lhs + 3` lies below `line_end`.
                        && is_space(unsafe { inp.byte_unchecked(lhs + 3) })
                    {
                        p = lhs + 3;
                    } else {
                        // (the byte at the line end, a break or NUL, stops
                        // it)
                        // SAFETY: the run stops at the line end, inside the
                        // input or at its NUL.
                        while unsafe { inp.byte_unchecked(p) } == c {
                            p += 1;
                        }
                    }
                }
                o.tok(tok::PUNCTUATION_SPECIAL, p);
                let hl = if c == b'+' {
                    tok::DIFF_PLUS
                } else {
                    tok::DIFF_MINUS
                };
                o.emit(hl, p, line_end);
            }
            // SAFETY: `lhs + 1` lies at or before the input end.
            line::AT if n >= 2 && unsafe { inp.byte_unchecked(lhs + 1) } == b'@' => {
                o.tok(tok::ATTRIBUTE, line_end)
            }
            line::HASH => o.tok(tok::COMMENT, line_end),
            line::META => {
                let mut t = o;
                metadata(inp, lhs, line_end, &mut t);
                o = t;
            }
            _ => o.emit(tok::NONE, lhs, line_end),
        }

        // the line breaks after the line
        ptr = line_end;
        // SAFETY: the NUL at the input end stops the run inside the input.
        while unsafe { inp.byte_unchecked(ptr) } == b'\n'
            || unsafe { inp.byte_unchecked(ptr) } == b'\r'
        {
            ptr += 1;
        }
        if line_end < ptr {
            o.extend(ptr);
        }
    }
    o.store(inst);
}
