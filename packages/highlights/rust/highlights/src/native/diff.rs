//! WAT sources: src/langs/diff.wat src/common.wat src/scan.wat
//!
//! Native diff and patch lexer. Each line is colored by its first bytes:
//! `+`/`-` payload lines with their markers, `@@` hunk headers, `#`
//! comments, and git metadata (`diff`, `index`, mode, rename, similarity,
//! and binary lines), split into their fields. The records equal the
//! translated `diff` lexer's records.

#[cfg(target_arch = "aarch64")]
use core::arch::aarch64::*;

use super::Lexer;
use super::scan;
use crate::Rec;
use crate::generated::Instance;
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

/// The byte at `i`. Callers read at most 16 bytes past the input end, which
/// the 96-byte input slack covers.
#[inline(always)]
fn at(src: &[u8], i: usize) -> u8 {
    debug_assert!(i < src.len());
    // SAFETY: `i` lies inside the input or its slack (see above).
    unsafe { *src.get_unchecked(i) }
}

/// The 8 bytes at `p` as a little-endian integer. `p` lies at or before
/// the input end, so they lie inside the slack.
#[inline(always)]
fn u64_at(src: &[u8], p: usize) -> u64 {
    debug_assert!(p + 8 <= src.len());
    // SAFETY: see above.
    u64::from_le(unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() })
}

/// The 4 bytes at `p` as a little-endian integer (see [`u64_at`]).
#[inline(always)]
fn u32_at(src: &[u8], p: usize) -> u32 {
    u64_at(src, p) as u32
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
fn skip_space(src: &[u8], mut p: usize, line_end: usize) -> usize {
    while p < line_end && is_space(at(src, p)) {
        p += 1;
    }
    p
}

/// Skip decimal digits from `p`, stopping at `line_end`
/// (`$diffSkipDigits`).
#[inline(always)]
fn skip_digits(src: &[u8], mut p: usize, line_end: usize) -> usize {
    while p < line_end && is_digit(at(src, p)) {
        p += 1;
    }
    p
}

/// Skip hex digits from `p`, stopping at `line_end` (`$scanHexRun` with
/// the rest of the line as its limit).
#[inline(always)]
fn skip_hex(src: &[u8], mut p: usize, line_end: usize) -> usize {
    while p < line_end && is_hex(at(src, p)) {
        p += 1;
    }
    p
}

/// A bit per byte of the 64 bytes at `b` (a multiple of 64 at or before
/// the input end), set for CR and LF. Bytes past the input end may set
/// bits too; callers clamp to the end.
#[inline(always)]
fn block_breaks(src: &[u8], b: usize) -> u64 {
    debug_assert!(b + 64 <= src.len());
    #[cfg(target_arch = "aarch64")]
    // SAFETY: `b` lies at or before the input end, so its 64 bytes lie
    // inside the 96-byte slack.
    unsafe {
        let bits: [u8; 16] = [1, 2, 4, 8, 16, 32, 64, 128, 1, 2, 4, 8, 16, 32, 64, 128];
        let bits = vld1q_u8(bits.as_ptr());
        let p = src.as_ptr().add(b);
        let hit = |v: uint8x16_t| {
            vandq_u8(
                vorrq_u8(
                    vceqq_u8(v, vdupq_n_u8(b'\n')),
                    vceqq_u8(v, vdupq_n_u8(b'\r')),
                ),
                bits,
            )
        };
        let m0 = hit(vld1q_u8(p));
        let m1 = hit(vld1q_u8(p.add(16)));
        let m2 = hit(vld1q_u8(p.add(32)));
        let m3 = hit(vld1q_u8(p.add(48)));
        let s = vpaddq_u8(vpaddq_u8(m0, m1), vpaddq_u8(m2, m3));
        let s = vpaddq_u8(s, s);
        vgetq_lane_u64::<0>(vreinterpretq_u64_u8(s))
    }
    #[cfg(not(target_arch = "aarch64"))]
    {
        let mut m = 0u64;
        for i in 0..64 {
            let c = src[b + i];
            m |= ((c == b'\n' || c == b'\r') as u64) << i;
        }
        m
    }
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
    fn next(&mut self, src: &[u8], mut p: usize, end: usize) -> usize {
        loop {
            if p - self.base >= 64 {
                self.base = p & !63;
                if self.base >= end {
                    return end;
                }
                self.mask = block_breaks(src, self.base);
            }
            let m = self.mask & (u64::MAX << (p - self.base));
            if m != 0 {
                return (self.base + m.trailing_zeros() as usize).min(end);
            }
            p = self.base + 64;
        }
    }
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

    /// `[lhs, rhs)` as `hl` when it is non-empty (`$emitTok`).
    #[inline(always)]
    fn emit(&mut self, hl: u32, lhs: usize, rhs: usize) {
        if lhs < rhs {
            self.tok(hl, rhs);
        }
    }

    /// Whitespace `[lhs, rhs)` extends the last record (`$emitGap`). Every
    /// gap after the input's leading line breaks follows a token's record:
    /// each line holds a byte, and every nonempty line emits a token.
    #[inline(always)]
    fn gap(&mut self, lhs: usize, rhs: usize) {
        if lhs < rhs {
            // SAFETY: the record before `cur` is written (see above).
            unsafe { (*self.cur.sub(1)).end = rhs as u32 };
        }
    }
}

/// The git metadata line `[lhs, line_end)` whose first byte is one that
/// metadata starts with; a line of no known form is plain (the metadata
/// rules of `$hlDiff`).
#[inline(never)]
fn metadata(src: &[u8], lhs: usize, line_end: usize, o: &mut Out) {
    let len = line_end - lhs;
    let w0 = u64_at(src, lhs);
    let w1 = u64_at(src, lhs + 8);

    // `diff` is a function, its first argument a parameter, and paths
    // plain.
    if len >= 4
        && w0 as u32 == word(b"diff") as u32
        && (lhs + 4 == line_end || is_space(at(src, lhs + 4)))
    {
        o.tok(tok::FUNCTION, lhs + 4);
        let mut p = lhs + 4;
        let gap = p;
        p = skip_space(src, p, line_end);
        o.gap(gap, p);
        let arg = p;
        while p < line_end && !is_space(at(src, p)) {
            p += 1;
        }
        o.emit(tok::VARIABLE_PARAMETER, arg, p);
        o.emit(tok::NONE, p, line_end);
        return;
    }

    // Split an index line into its keyword, commits, separator, and mode.
    if len >= 5
        && w0 & 0xff_ffff_ffff == word(b"index")
        && (lhs + 5 == line_end || is_space(at(src, lhs + 5)))
    {
        o.tok(tok::KEYWORD, lhs + 5);
        let mut p = lhs + 5;
        let gap = p;
        p = skip_space(src, p, line_end);
        o.gap(gap, p);

        let hex = p;
        p = skip_hex(src, p, line_end);
        if p == hex {
            o.emit(tok::NONE, p, line_end);
            return;
        }
        o.tok(tok::CONSTANT, p);
        if p + 2 > line_end || u32_at(src, p) as u16 != word(b"..") as u16 {
            o.emit(tok::NONE, p, line_end);
            return;
        }
        o.tok(tok::PUNCTUATION_SPECIAL, p + 2);
        p += 2;

        let hex = p;
        p = skip_hex(src, p, line_end);
        if p == hex {
            o.emit(tok::NONE, p, line_end);
            return;
        }
        o.tok(tok::CONSTANT, p);

        let gap = p;
        p = skip_space(src, p, line_end);
        o.gap(gap, p);
        let num = p;
        p = skip_digits(src, p, line_end);
        o.emit(tok::NUMBER, num, p);
        o.emit(tok::NONE, p, line_end);
        return;
    }

    // Similarity metadata is a label, with its score and percent numeric.
    if len >= 16 && w0 == word(b"similari") && w1 == word(b"ty index") {
        let mut p = skip_space(src, lhs + 16, line_end);
        o.tok(tok::LABEL, p);
        let num = p;
        p = skip_digits(src, p, line_end);
        o.emit(tok::NUMBER, num, p);
        if p < line_end && at(src, p) == b'%' {
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
    if len >= 17 && w0 == word(b"deleted ") && w1 == word(b"file mod") && at(src, lhs + 16) == b'e'
    {
        p = lhs + 17;
    }
    if len >= 8 && (w0 == word(b"new mode") || w0 == word(b"old mode")) {
        p = lhs + 8;
    }
    if p != 0 {
        p = skip_space(src, p, line_end);
        o.tok(tok::LABEL, p);
        let num = p;
        p = skip_digits(src, p, line_end);
        o.emit(tok::NUMBER, num, p);
        o.emit(tok::LABEL, p, line_end);
        return;
    }

    // Rename/copy and binary-change metadata are labels.
    if (len >= 11 && w0 == word(b"rename f") && w1 & 0xff_ffff == word(b"rom"))
        || (len >= 9 && w0 == word(b"rename t") && at(src, lhs + 8) == b'o')
        || (len >= 9 && w0 == word(b"copy fro") && at(src, lhs + 8) == b'm')
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
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, which is not
    // reallocated while this lexer runs.
    let src: &[u8] = unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) };
    let end = len;
    let v = &mut inst.ext.recs;
    let start = v.as_mut_ptr();
    let mut o = Out {
        // SAFETY: `len` records are written.
        cur: unsafe { start.add(v.len()) },
        // SAFETY: one past the allocation.
        limit: unsafe { start.add(v.capacity()) },
        last: v.last().map_or(u32::MAX, |r| r.token),
    };

    // `$lexEmitLeadingContinuation` and the line breaks of any empty first
    // lines: one gap, which writes the first record when there is none
    // yet. (An empty line emits no token.)
    let mut ptr = scan::utf8_span_end(src, 0, end);
    while at(src, ptr) == b'\n' || at(src, ptr) == b'\r' {
        ptr += 1;
    }
    if ptr > 0 {
        if o.cur == start {
            o.tok(tok::NONE, ptr);
        } else {
            o.gap(0, ptr);
        }
    }
    let mut breaks = Breaks {
        base: 0,
        mask: block_breaks(src, 0),
    };
    while ptr < end {
        let lhs = ptr;
        let c = at(src, ptr);
        let line_end = breaks.next(src, ptr, end);
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
                if at(src, p) == c {
                    if n >= 4
                        && u32_at(src, lhs) & 0xff_ffff == c as u32 * 0x01_0101
                        && is_space(at(src, lhs + 3))
                    {
                        p = lhs + 3;
                    } else {
                        // (the byte at the line end, a break or NUL, stops
                        // it)
                        while at(src, p) == c {
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
            line::AT if n >= 2 && at(src, lhs + 1) == b'@' => o.tok(tok::ATTRIBUTE, line_end),
            line::HASH => o.tok(tok::COMMENT, line_end),
            line::META => {
                let mut t = o;
                metadata(src, lhs, line_end, &mut t);
                o = t;
            }
            _ => o.emit(tok::NONE, lhs, line_end),
        }

        // the line breaks after the line
        ptr = line_end;
        while at(src, ptr) == b'\n' || at(src, ptr) == b'\r' {
            ptr += 1;
        }
        o.gap(line_end, ptr);
    }
    // SAFETY: the records before `cur` are written.
    unsafe { inst.ext.recs.set_len(o.cur.offset_from(start) as usize) };
}
