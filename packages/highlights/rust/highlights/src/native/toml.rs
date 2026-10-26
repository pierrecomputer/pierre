//! WAT sources: src/langs/toml.wat src/common.wat src/scan.wat
//!
//! Native TOML lexer. One pass over the input: comments, keys (bare,
//! quoted, and dotted, in key context and table headers), the four string
//! forms with TOML's escapes, booleans, numbers in every radix, special
//! floats, RFC 3339 dates and times, and the brackets of headers, arrays,
//! and inline tables. The records equal the translated `toml` lexer's
//! records.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;

/// The lexer for each language this module handles.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "toml" => Some(highlight),
        _ => None,
    }
}

/// The deepest container whose kind is remembered (`$mem.tomlStack`).
const STACK: usize = 1024;

/// The byte at `p`, or 0 at or past `end` (`$tomlByte`).
#[inline(always)]
fn byte(src: Input<'_>, end: usize, p: usize) -> u8 {
    // SAFETY: `p` is below the input end `end`.
    if p < end {
        unsafe { src.byte_unchecked(p) }
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
fn is_hex(c: u8) -> bool {
    is_digit(c) || (c | 32).wrapping_sub(b'a') <= 5
}

/// Whether `c` may appear in a bare key: `[A-Za-z0-9_-]`
/// (`$tomlIsBareKey`).
#[inline(always)]
const fn is_bare_key(c: u8) -> bool {
    is_digit(c) || (c | 32).wrapping_sub(b'a') <= 25 || c == b'_' || c == b'-'
}

/// The end of the bare-key run `[A-Za-z0-9_-]` from `p`; bytes from 0x80
/// end it (`$tomlBareKeyEnd`). The NUL after the input ends every run.
#[inline(always)]
fn bare_key_end(src: Input<'_>, mut p: usize) -> usize {
    // SAFETY: the NUL at the input end stops the run.
    while KIND[unsafe { src.byte_unchecked(p) } as usize] & K_BARE != 0 {
        p += 1;
    }
    p
}

/// Whether `c` is a digit of `base` (2, 8, 10, or 16).
#[inline(always)]
fn is_base_digit(c: u8, base: u32) -> bool {
    if base == 16 {
        is_hex(c)
    } else {
        (c.wrapping_sub(b'0') as u32) < base
    }
}

/// The end of the digits of `base` from `p`, with underscores only
/// between digits (`$tomlScanDigits`).
#[inline(always)]
fn scan_digits(src: Input<'_>, end: usize, mut p: usize, base: u32) -> usize {
    // SAFETY: `p` is below the input end `end` (tested first).
    if p >= end || !is_base_digit(unsafe { src.byte_unchecked(p) }, base) {
        return p;
    }
    p += 1;
    while p < end {
        // SAFETY: `p` is below the input end `end`.
        let c = unsafe { src.byte_unchecked(p) };
        if is_base_digit(c, base) {
            p += 1;
            continue;
        }
        // SAFETY: `p + 1` is below the input end `end` (tested first).
        if c != b'_' || p + 1 >= end || !is_base_digit(unsafe { src.byte_unchecked(p + 1) }, base) {
            break;
        }
        p += 2;
    }
    p
}

/// The bytes after a value: TAB, LF, CR, space, `#`, `,`, `]`, and `}`.
static VALUE_END: [bool; 256] = byteset(b"\x09\x0a\x0d #,]}");

/// Whether a value may end at `p`: the end, or one of [`VALUE_END`]
/// (`$tomlIsValueEnd`).
#[inline(always)]
fn is_value_end(src: Input<'_>, end: usize, p: usize) -> bool {
    // SAFETY: `p` is below the input end `end` (tested first).
    p >= end || VALUE_END[unsafe { src.byte_unchecked(p) } as usize]
}

/// The two-digit number at `p`, or -1 unless both bytes are digits
/// before `end` (`$tomlTwoDigitValue`).
#[inline(always)]
fn two_digit_value(src: Input<'_>, end: usize, p: usize) -> i32 {
    if p + 2 > end {
        return -1;
    }
    // SAFETY: `p + 1` is below the input end `end` (tested above).
    let (a, b) = unsafe { (src.byte_unchecked(p), src.byte_unchecked(p + 1)) };
    if !(is_digit(a) && is_digit(b)) {
        return -1;
    }
    (a - b'0') as i32 * 10 + (b - b'0') as i32
}

/// Whether two digits at `p` read a number in `[min, max]`
/// (`$tomlTwoDigits`).
#[inline(always)]
fn two_digits(src: Input<'_>, end: usize, p: usize, min: i32, max: i32) -> bool {
    (two_digit_value(src, end, p).wrapping_sub(min) as u32) <= (max - min) as u32
}

/// Whether `p` starts an `HH:MM` hour and minute (`$tomlHourMinute`).
#[inline(always)]
fn hour_minute(src: Input<'_>, end: usize, p: usize) -> bool {
    byte(src, end, p + 2) == b':'
        && two_digits(src, end, p, 0, 23)
        && two_digits(src, end, p + 3, 0, 59)
}

/// The end of the whitespace a line-ending backslash trims: spaces, TABs,
/// LFs, and CRLFs from `q` (`$tomlTrimEnd`).
fn trim_end(src: Input<'_>, end: usize, mut q: usize) -> usize {
    while q < end {
        let c = src.byte(q);
        if c == 9 || c == 10 || c == 32 {
            q += 1;
            continue;
        }
        if c != 13 || q + 1 >= end || src.byte(q + 1) != 10 {
            break;
        }
        q += 2;
    }
    q
}

/// The first `"`, backslash, or (unless `multiline`) CR or LF from `p`, or
/// `end`; a cursor at or past `end` stays (`$scanFindSpecial`).
#[inline(always)]
fn find_basic(src: Input<'_>, p: usize, end: usize, multiline: bool) -> usize {
    if p >= end {
        return p;
    }
    if multiline {
        scan::find3(src.bytes(), p, end, b'"', b'\\', b'"')
    } else {
        scan::string_special(src.bytes(), p, end, b'"')
    }
}

/// The escape characters after a backslash.
static ESCAPES: [bool; 256] = byteset(b"\x22\x5cbefnrt");

/// A basic string body from `p`, after its opening quote(s), colored `hl`
/// from `seg`, with TOML's escape productions as escapes and the three to
/// five quotes that close a multi-line string. Returns its end
/// (`$tomlBasicStringBody` with no trim run carried in).
fn basic_string_body(
    src: Input<'_>,
    end: usize,
    out: &mut Recs,
    multiline: bool,
    hl: u32,
    mut seg: usize,
    mut p: usize,
) -> usize {
    while p < end {
        // The closing quote, an escape, and, single-line, the raw line
        // break that leaves the string unterminated.
        p = find_basic(src, p, end, multiline);
        if p >= end {
            break;
        }
        // SAFETY: `p` is below the input end (tested above).
        let c = unsafe { src.byte_unchecked(p) };
        if c != b'"' && c != b'\\' {
            break;
        }
        if c == b'"' {
            if !multiline {
                p += 1;
                break;
            }
            let mut quotes = 0;
            // SAFETY: `p` is below the input end (tested first).
            while quotes < 5 && p < end && unsafe { src.byte_unchecked(p) } == b'"' {
                quotes += 1;
                p += 1;
            }
            if quotes >= 3 {
                break;
            }
            continue;
        }
        // Only TOML escape productions get the escape color.
        out.emit(hl, seg, p);
        let mut e = p + 1;
        let mut escape = false;
        if p + 1 < end {
            // SAFETY: `p + 1` is below the input end (tested above).
            let c = unsafe { src.byte_unchecked(p + 1) };
            if ESCAPES[c as usize] {
                e = p + 2;
                escape = true;
            }
            // `\xHH`, `\uHHHH`, and `\UHHHHHHHH` need all their hex digits.
            let digits = match c {
                b'x' => 2,
                b'u' => 4,
                b'U' => 8,
                _ => 0,
            };
            if digits != 0 {
                let q = hex_run(src, end, p + 2, digits);
                if q == p + 2 + digits {
                    e = q;
                    escape = true;
                }
            }
            // A line-ending backslash: the escape spans the line break and
            // every blank line and indentation up to the next content.
            if multiline {
                let mut q = p + 1;
                while q < end && (src.byte(q) == 9 || src.byte(q) == 32) {
                    q += 1;
                }
                let mut line = false;
                if q < end {
                    let c = src.byte(q);
                    if c == 10 {
                        q += 1;
                        line = true;
                    }
                    if c == 13 && q + 1 < end && src.byte(q + 1) == 10 {
                        q += 2;
                        line = true;
                    }
                }
                if line {
                    e = trim_end(src, end, q);
                    escape = true;
                }
            }
        }
        out.emit(if escape { tok::STRING_ESCAPE } else { hl }, p, e);
        p = e;
        seg = p;
    }
    out.emit(hl, seg, p);
    p
}

/// The end of at most `max` hex digits from `p`, bounded by `end`
/// (`$scanHexRun`).
#[inline(always)]
fn hex_run(src: Input<'_>, end: usize, mut p: usize, max: usize) -> usize {
    let stop = (p + max).min(end);
    // SAFETY: `p` is below `stop`, at most the input end.
    while p < stop && is_hex(unsafe { src.byte_unchecked(p) }) {
        p += 1;
    }
    p
}

/// A basic string at `lhs`: `"` single-line or `"""` multi-line. Returns
/// its end (`$tomlBasicString`).
#[inline(never)]
fn basic_string(
    src: Input<'_>,
    end: usize,
    mut out: Recs,
    multiline: bool,
    hl: u32,
    lhs: usize,
) -> (usize, Recs) {
    let p = (lhs + if multiline { 3 } else { 1 }).min(end);
    let p = basic_string_body(src, end, &mut out, multiline, hl, lhs, p);
    (p, out)
}

/// A `'''` multi-line literal string at `lhs`, closed by a run of three to
/// five quotes. Returns its end (`$tomlLiteralString`,
/// `$tomlLiteralStringBody`, `$lexFindByte`).
#[inline(always)]
fn literal_string(src: Input<'_>, end: usize, out: &mut Recs, hl: u32, lhs: usize) -> usize {
    let mut p = (lhs + 3).min(end);
    loop {
        p = if p >= end {
            end
        } else {
            scan::find3(src.bytes(), p, end, b'\'', b'\'', b'\'')
        };
        if p >= end {
            break;
        }
        let mut quotes = 0;
        // SAFETY: `p` is below the input end (tested first).
        while quotes < 5 && p < end && unsafe { src.byte_unchecked(p) } == b'\'' {
            quotes += 1;
            p += 1;
        }
        if quotes >= 3 {
            break;
        }
    }
    out.emit(hl, lhs, p);
    p
}

/// A single-line literal string at `lhs`, up to its closing quote or the
/// raw line break that leaves it unterminated. Returns its end
/// (`$lexRawString`, `$lexRawStringBody`).
#[inline(always)]
fn raw_string(src: Input<'_>, end: usize, out: &mut Recs, hl: u32, lhs: usize) -> usize {
    let mut p = lhs + 1;
    if p < end {
        p = scan::string_special(src.bytes(), p, end, b'\'');
        // A backslash does not escape here: step over it.
        // SAFETY: `p` is below the input end (tested first).
        while p < end && unsafe { src.byte_unchecked(p) } == b'\\' {
            p = scan::string_special(src.bytes(), p + 1, end, b'\'');
        }
    }
    // SAFETY: `p` is below the input end (tested first).
    if p < end && unsafe { src.byte_unchecked(p) } == b'\'' {
        p += 1;
    }
    out.emit(hl, lhs, p);
    p
}

/// A date, time, or date-time at `lhs` (the fixed-width RFC 3339
/// grammar), or `None` (`$hlToml`).
fn date_time(src: Input<'_>, end: usize, lhs: usize) -> Option<usize> {
    let mut date = false;
    let mut time = true;
    let mut q = lhs;
    // SAFETY: `lhs + 7` is below the input end `end` (tested first).
    if lhs + 10 <= end
        && unsafe { src.byte_unchecked(lhs + 4) } == b'-'
        && unsafe { src.byte_unchecked(lhs + 7) } == b'-'
    {
        // The year's two-digit halves and the month, -1 where not digits.
        let year = two_digit_value(src, end, lhs);
        let r = two_digit_value(src, end, lhs + 2);
        let n = two_digit_value(src, end, lhs + 5);
        if (year | r) >= 0 && (n.wrapping_sub(1) as u32) <= 11 {
            // Days in the month: 28 plus the month's two bits of
            // 0x3bbeecc, plus one in a leap February.
            let leap = n == 2 && (if r != 0 { r } else { year }) & 3 == 0;
            let limit = 28 + ((0x3bbeeccu32 >> ((n as u32) << 1)) & 3) as i32 + leap as i32;
            if two_digits(src, end, lhs + 8, 1, limit) {
                let p = lhs + 10;
                let c = byte(src, end, p);
                if c | 32 == b't' || (c == b' ' && hour_minute(src, end, p + 1)) {
                    date = true;
                    q = p + 1;
                } else {
                    time = false;
                    if is_value_end(src, end, p) {
                        return Some(p);
                    }
                }
            }
        }
    }
    if time && hour_minute(src, end, q) {
        let mut p = q + 5;
        let mut seconds = false;
        if byte(src, end, p) == b':' && two_digits(src, end, p + 1, 0, 60) {
            p += 3;
            seconds = true;
        }
        // SAFETY: `p + 1` is below the input end `end` (tested first).
        if seconds
            && p + 1 < end
            && unsafe { src.byte_unchecked(p) } == b'.'
            && is_digit(unsafe { src.byte_unchecked(p + 1) })
        {
            p += 1;
            // SAFETY: `p` is below the input end `end` (tested first).
            while p < end && is_digit(unsafe { src.byte_unchecked(p) }) {
                p += 1;
            }
        }
        if date {
            let c = byte(src, end, p);
            if c | 32 == b'z' {
                p += 1;
            } else if (c == b'+' || c == b'-') && hour_minute(src, end, p + 1) {
                p += 6;
            }
        }
        if is_value_end(src, end, p) {
            return Some(p);
        }
    }
    None
}

/// Byte classes as two nibble tables: byte `b` is in a class when
/// `CLASS_HI[b >> 4] & CLASS_LO[b & 15]` has one of its bits. Basic-string
/// stops: 1 for LF and CR, 2 for `"`, 4 for a backslash; whitespace: 1 for
/// LF and CR, 8 for TAB, 16 for a space.
const CLASS_HI: [u8; 16] = [1 | 8, 0, 2 | 16, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const CLASS_LO: [u8; 16] = [16, 0, 2, 0, 0, 0, 0, 0, 0, 8, 1, 0, 4, 1, 0, 0];
const STOP_BITS: u8 = 1 | 2 | 4;
const SPACE_BITS: u8 = 1 | 8 | 16;

/// Bare-key bytes as two nibble tables (see [`CLASS_HI`]): 1 for digits,
/// 2 for `A`-`O` and `a`-`o`, 4 for `P`-`Z` and `p`-`z`, 8 for `_`, 16 for
/// `-`.
const BARE_HI: [u8; 16] = [0, 0, 16, 1, 2, 4 | 8, 2, 4, 0, 0, 0, 0, 0, 0, 0, 0];
const BARE_LO: [u8; 16] = {
    let mut t = [0u8; 16];
    let mut l = 0;
    while l < 16 {
        let mut m = 0;
        if l <= 9 {
            m |= 1;
        }
        if l >= 1 {
            m |= 2;
        }
        if l <= 10 {
            m |= 4;
        }
        if l == 15 {
            m |= 8;
        }
        if l == 13 {
            m |= 16;
        }
        t[l] = m;
        l += 1;
    }
    t
};

/// The basic-string-stop, non-whitespace, and non-bare-key masks of the 64
/// bytes from `b`, one bit per byte. `b + 64` must lie inside the input
/// slack.
#[inline(always)]
fn block_masks(src: Input<'_>, b: usize) -> (u64, u64, u64) {
    let hi_t = V::from_array(&CLASS_HI);
    let lo_t = V::from_array(&CLASS_LO);
    let bare_hi_t = V::from_array(&BARE_HI);
    let bare_lo_t = V::from_array(&BARE_LO);
    let mut stop = [V::zero(); 4];
    let mut space = [V::zero(); 4];
    let mut other = [V::zero(); 4];
    for i in 0..4 {
        // SAFETY: every window block starts at or before the input end, so its
        // 64 bytes stay inside the slack.
        let v = unsafe { src.vec_unchecked(b + 16 * i) };
        let hi = v.shr::<4>();
        let lo = v.and(V::splat(15));
        let class = hi_t.lookup(hi).and(lo_t.lookup(lo));
        stop[i] = class.test(V::splat(STOP_BITS));
        space[i] = class.test(V::splat(SPACE_BITS));
        let key = bare_hi_t.lookup(hi).and(bare_lo_t.lookup(lo));
        other[i] = key.test(key);
    }
    (
        V::bits64(stop[0], stop[1], stop[2], stop[3]),
        !V::bits64(space[0], space[1], space[2], space[3]),
        !V::bits64(other[0], other[1], other[2], other[3]),
    )
}

/// Bit masks of two adjacent 64-byte blocks of the input, the second
/// starting at `mid`: for each byte, whether it stops a basic string (`"`,
/// a backslash, CR, or LF), whether it is not TOML whitespace (TAB, LF,
/// CR, space), and whether it is not a bare-key byte. A scan over the
/// window is a shift and a bit count, so the next token's start does not
/// wait on a vector scan of the bytes before it.
#[derive(Clone, Copy)]
struct Window {
    mid: usize,
    stop0: u64,
    text0: u64,
    other0: u64,
    stop1: u64,
    text1: u64,
    other1: u64,
}

impl Window {
    /// The window from block `blk`. The second block's masks are loaded
    /// only when it starts by the input end `end`; past it every scan's
    /// result is clamped to the end, or stops at the NUL after the input.
    #[inline(always)]
    fn at(src: Input<'_>, end: usize, blk: usize) -> Self {
        let (stop0, text0, other0) = block_masks(src, blk);
        let mid = blk + 64;
        let (stop1, text1, other1) = if mid <= end {
            block_masks(src, mid)
        } else {
            (u64::MAX, u64::MAX, u64::MAX)
        };
        Window {
            mid,
            stop0,
            text0,
            other0,
            stop1,
            text1,
            other1,
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
            let (stop1, text1, other1) = if mid <= end {
                block_masks(src, mid)
            } else {
                (u64::MAX, u64::MAX, u64::MAX)
            };
            *self = Window {
                mid,
                stop0: self.stop1,
                text0: self.text1,
                other0: self.other1,
                stop1,
                text1,
                other1,
            };
        } else {
            core::hint::cold_path();
            *self = Window::at(src, end, p & !63);
        }
    }

    /// The end of the whitespace run from `p`, which lies in the first
    /// block, and whether the run holds an LF (`$hlToml`). The window moves
    /// so that the end lies in its first block too.
    #[inline(always)]
    fn space_end(&mut self, src: Input<'_>, end: usize, p: usize) -> (usize, bool) {
        // `sync` keeps `p` in the first block, whose start is `mid - 64`:
        // its offset there is `(p - mid) & 63`.
        let off = p.wrapping_sub(self.mid) & 63;
        let m = self.text0 >> off;
        if m != 0 {
            let n = m.trailing_zeros();
            // The run's line breaks are its stop bits: LFs and CRs.
            let mut breaks = (self.stop0 >> off) & ((1u64 << n) - 1);
            let mut lf = false;
            while breaks != 0 {
                // SAFETY: the bit marks a byte of the whitespace run from `p`,
                // which ends at or before the input end.
                if unsafe { src.byte_unchecked(p + breaks.trailing_zeros() as usize) } == 10 {
                    lf = true;
                    break;
                }
                breaks &= breaks - 1;
            }
            return (p + n as usize, lf);
        }
        core::hint::cold_path();
        let e = if self.text1 != 0 {
            self.mid + self.text1.trailing_zeros() as usize
        } else {
            space_end_after(src, end, self.mid + 64)
        };
        self.sync(src, end, e);
        (e, has_lf(src, p, e))
    }

    /// The first CR or LF after the `#` at `p`, which lies in the first
    /// block, or `end` (`$scanToLineEnd`): the window's stop bits from
    /// there, the quote and backslash ones cleared.
    #[inline(always)]
    fn line_end(&self, src: Input<'_>, end: usize, p: usize) -> usize {
        let base = self.mid - 64;
        let off = (p - base) & 63;
        let mut block = base;
        // Bits after the `#`.
        let mut m = (self.stop0 >> off >> 1) << off << 1;
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

    /// The end of the bare key from `p`, which lies in the first block
    /// (`$tomlBareKeyEnd`).
    #[inline(always)]
    fn bare_key_end(&self, src: Input<'_>, p: usize) -> usize {
        // As in `space_end`.
        let m = self.other0 >> (p.wrapping_sub(self.mid) & 63);
        if m != 0 {
            return p + m.trailing_zeros() as usize;
        }
        core::hint::cold_path();
        if self.other1 != 0 {
            return self.mid + self.other1.trailing_zeros() as usize;
        }
        bare_key_end(src, self.mid + 64)
    }

    /// The first basic-string stop after the quote at `lhs`, which lies in
    /// the first block, or `None` past the window.
    #[inline(always)]
    fn string_stop(&self, lhs: usize) -> Option<usize> {
        // As in `space_end`; the quote is bit 0.
        let m = (self.stop0 >> (lhs.wrapping_sub(self.mid) & 63)) >> 1;
        if m != 0 {
            return Some(lhs + 1 + m.trailing_zeros() as usize);
        }
        core::hint::cold_path();
        if self.stop1 != 0 {
            return Some(self.mid + self.stop1.trailing_zeros() as usize);
        }
        None
    }
}

/// Whether `[lhs, rhs)` holds an LF.
#[inline(never)]
fn has_lf(src: Input<'_>, lhs: usize, rhs: usize) -> bool {
    src.bytes()[lhs..rhs].contains(&10)
}

/// The end of the TOML whitespace (TAB, LF, CR, space) from `p`, bounded
/// by `end`, byte by byte.
#[cold]
#[inline(never)]
fn space_end_after(src: Input<'_>, end: usize, mut p: usize) -> usize {
    while p < end && matches!(src.byte(p), 9 | 10 | 13 | 32) {
        p += 1;
    }
    p
}

/// First-byte kinds of the rules, one bit each; bytes of kind 0 are
/// malformed atoms in value context.
const K_HASH: u16 = 1;
const K_QUOTE: u16 = 2;
/// Bytes of a bare key.
const K_BARE: u16 = 4;
const K_EQ: u16 = 8;
/// `[`, `]`, `{`, `}`, `.`, and `,`.
const K_PUNCT: u16 = 16;
/// `t`, `f`, `i`, `n`, `+`, `-`, and digits: bytes a constant or number
/// can start with.
const K_VALUE: u16 = 32;

/// The kind of every byte.
static KIND: [u16; 256] = {
    let mut t = [0u16; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        let mut k = 0;
        if is_bare_key(b) {
            k |= K_BARE;
        }
        if matches!(b, b't' | b'f' | b'i' | b'n' | b'+' | b'-') || is_digit(b) {
            k |= K_VALUE;
        }
        k |= match b {
            b'#' => K_HASH,
            b'"' | b'\'' => K_QUOTE,
            b'=' => K_EQ,
            b'[' | b']' | b'{' | b'}' | b'.' | b',' => K_PUNCT,
            _ => 0,
        };
        t[c] = k;
        c += 1;
    }
    t
};

/// A string at `lhs` with quote `c`, colored `hl`, in any of its four
/// forms. Returns its end (`$hlToml`).
#[inline(always)]
fn string(
    src: Input<'_>,
    end: usize,
    mut out: Recs,
    c: u8,
    hl: u32,
    triple: bool,
    lhs: usize,
) -> (usize, Recs) {
    if c == b'"' {
        return basic_string(src, end, out, triple, hl, lhs);
    }
    let p = if triple {
        literal_string(src, end, &mut out, hl, lhs)
    } else {
        raw_string(src, end, &mut out, hl, lhs)
    };
    (p, out)
}

/// A value in value context at `lhs`: a boolean, a special float, a date
/// or time, a number, or a malformed atom. Returns its end and color
/// (`$hlToml`).
#[inline(always)]
fn value(src: Input<'_>, end: usize, lhs: usize, c: u8) -> (usize, u32) {
    // Booleans and special floats are exact, case-sensitive atoms,
    // compared as the low bytes of an 8-byte load.
    // SAFETY: `lhs` is below the input end, so the 8 bytes from it stay
    // inside the slack.
    let w = unsafe { src.word_unchecked(lhs) };
    if lhs + 4 <= end && w & 0xffff_ffff == atom(b"true") && is_value_end(src, end, lhs + 4) {
        return (lhs + 4, tok::CONSTANT);
    }
    if lhs + 5 <= end && w & 0xff_ffff_ffff == atom(b"false") && is_value_end(src, end, lhs + 5) {
        return (lhs + 5, tok::CONSTANT);
    }
    // `s` skips an optional sign.
    let s = lhs + (c == b'+' || c == b'-') as usize;
    // SAFETY: `s` is at most the input end, so the 8 bytes from it stay
    // inside the slack.
    let w = unsafe { src.word_unchecked(s) } & 0xff_ffff;
    if s + 3 <= end && (w == atom(b"inf") || w == atom(b"nan")) && is_value_end(src, end, s + 3) {
        return (s + 3, tok::NUMBER);
    }
    // Dates and times.
    if let Some(e) = date_time(src, end, lhs) {
        return (e, tok::STRING_SPECIAL);
    }
    // Radix integers are unsigned and need at least one digit.
    // SAFETY: `lhs + 1` is below the input end `end` (tested first).
    if lhs + 1 < end && unsafe { src.byte_unchecked(lhs) } == b'0' {
        // SAFETY: as above.
        let base = match unsafe { src.byte_unchecked(lhs + 1) } {
            b'x' => 16,
            b'o' => 8,
            b'b' => 2,
            _ => 0,
        };
        if base != 0 {
            let q = lhs + 2;
            let e = scan_digits(src, end, q, base);
            if e > q {
                return (e, tok::NUMBER);
            }
        }
    }
    // Decimal integers and floats.
    // SAFETY: `s` is below the input end `end` (tested first).
    if s < end && is_digit(unsafe { src.byte_unchecked(s) }) {
        // SAFETY: as above.
        let mut e = if unsafe { src.byte_unchecked(s) } == b'0' {
            s + 1
        } else {
            scan_digits(src, end, s, 10)
        };
        // SAFETY: `e + 1` is below the input end `end` (tested first).
        if e + 1 < end
            && unsafe { src.byte_unchecked(e) } == b'.'
            && is_digit(unsafe { src.byte_unchecked(e + 1) })
        {
            e = scan_digits(src, end, e + 1, 10);
        }
        if byte(src, end, e) | 32 == b'e' {
            let mut q = e + 1;
            let c = byte(src, end, q);
            if c == b'+' || c == b'-' {
                q += 1;
            }
            let r = scan_digits(src, end, q, 10);
            if r > q {
                e = r;
            }
        }
        return (e, tok::NUMBER);
    }
    (atom_end(src, end, lhs), tok::NONE)
}

/// The little-endian integer of the bytes of `w`, at most 8.
const fn atom(w: &[u8]) -> u64 {
    let mut x = 0u64;
    let mut i = 0;
    while i < w.len() {
        x |= (w[i] as u64) << (8 * i);
        i += 1;
    }
    x
}

/// The end of a malformed atom at `lhs`: it stays plain and stops before
/// TOML punctuation, after at least one byte (`$hlToml`).
#[inline(always)]
fn atom_end(src: Input<'_>, end: usize, lhs: usize) -> usize {
    let mut p = lhs;
    while !is_value_end(src, end, p) {
        // SAFETY: `p` is below the input end, or it would be a value end.
        let c = unsafe { src.byte_unchecked(p) };
        if matches!(c, b'=' | b'.' | b'"' | b'\'' | b'[' | b'{') {
            break;
        }
        p += 1;
    }
    if p == lhs { p + 1 } else { p }
}

/// Lex the input at `base` (`$hlToml`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: `base..base + len + SLACK` lies inside lexer memory, and this
    // lexer calls no translated function that could move it.
    let src = unsafe { Input::new(inst, base, len) };
    let mut out = Recs::load(inst);
    // `$lexEmitLeadingContinuation`, then the leading whitespace: both are
    // gaps. A line break there changes nothing: the state is already the
    // one it would set.
    let p = space_end_after(src, len, scan::utf8_span_end(src.bytes(), 0, len));
    out.gap(0, p);
    lex(src, len, out, p).store(inst);
}

/// The lexer loop, from the first token (`$hlToml` outside a resumed
/// multi-line string). Each pass lexes one token at `p` and then the
/// whitespace after it.
fn lex(src: Input<'_>, end: usize, mut out: Recs, mut p: usize) -> Recs {
    // Key context: a bare word is a key.
    let mut key = true;
    // Inside a `[table]` or `[[array]]` header.
    let mut header = false;
    // Open arrays and inline tables, and for each of the first `STACK`,
    // whether it is an inline table.
    let mut depth = 0usize;
    let mut stack = [0u8; STACK];
    let mut win = Window::at(src, end, p & !63);
    while p < end {
        let lhs = p;
        // SAFETY: `p` is below the input end.
        let c = unsafe { src.byte_unchecked(p) };
        let k = KIND[c as usize];
        // The rules match disjoint first bytes, except where a rule tests
        // more than its first byte or the context; a byte it turns down
        // goes on to the later rules, in the WAT's order.
        'done: {
            // A bare key can be all digits, so key context wins. Bare-key
            // bytes are never `#` or a quote, so this rule goes first.
            if (key || header) && k & K_BARE != 0 {
                p = win.bare_key_end(src, p);
                out.tok(tok::PROPERTY, p);
                // `key = value`: the rules below take the spaces as gaps
                // and the `=` as an operator that enters value context.
                // SAFETY: a key ends at or before the input end.
                let d = unsafe { src.byte_unchecked(p) };
                // SAFETY: a key ends at or before the input end, so `p + 2`
                // stays inside the slack.
                if d == b' '
                    && unsafe { src.byte_unchecked(p + 1) } == b'='
                    && unsafe { src.byte_unchecked(p + 2) } == b' '
                {
                    // SAFETY: the key's record is written above.
                    unsafe { out.extend_unchecked(p + 1) };
                    p += 2;
                    out.tok(tok::OPERATOR, p);
                    p += 1;
                    // SAFETY: the operator's record is written above.
                    unsafe { out.extend_unchecked(p) };
                    key = false;
                } else if d == b'.' {
                    // A dotted key's dot: its rule below, taken here.
                    p += 1;
                    out.tok(tok::PUNCTUATION_DELIMITER, p);
                } else if header && d == b']' {
                    // The header's closing bracket: the `]` rule below.
                    p += 1;
                    // SAFETY: the `]` lies before the input end, so `p` is at
                    // most the NUL after it.
                    if unsafe { src.byte_unchecked(p) } == b']' {
                        p += 1;
                    }
                    header = false;
                    key = false;
                    out.tok(tok::PUNCTUATION_BRACKET, p);
                }
                break 'done;
            }
            // Comments always run to the line end (`$lexLineComment`).
            if k & K_HASH != 0 {
                p = win.line_end(src, end, p);
                out.tok(tok::COMMENT, p);
                break 'done;
            }
            // Quoted keys are properties, values strings.
            if k & K_QUOTE != 0 {
                let hl = if key || header {
                    tok::PROPERTY
                } else {
                    tok::STRING
                };
                // Most strings are single-line basic strings with no
                // escape: the first stop byte is the closing quote. When it
                // is not the next byte, `"""` cannot open a multi-line one.
                if c == b'"'
                    && let Some(e) = win.string_stop(lhs)
                    && e > lhs + 1
                    && e < end
                    // SAFETY: `e` is below the input end (tested above).
                    && unsafe { src.byte_unchecked(e) } == b'"'
                {
                    p = e + 1;
                    out.tok(hl, p);
                    // An array's comma often follows at once: its rule
                    // below, taken here.
                    // SAFETY: `e` is below the input end, so `p` is at most
                    // the NUL after it.
                    if unsafe { src.byte_unchecked(p) } == b',' {
                        key = depth != 0 && depth <= STACK && stack[depth - 1] != 0;
                        p += 1;
                        out.tok(tok::PUNCTUATION_DELIMITER, p);
                    }
                    break 'done;
                }
                let triple = !(key || header)
                    && p + 3 <= end
                    && byte(src, end, p + 1) == c
                    && byte(src, end, p + 2) == c;
                (p, out) = string(src, end, out, c, hl, triple, lhs);
                break 'done;
            }
            // Assignment enters value context.
            if k & K_EQ != 0 {
                key = false;
                p += 1;
                out.tok(tok::OPERATOR, p);
                break 'done;
            }
            if k & K_PUNCT != 0 {
                p += 1;
                match c {
                    // A bracket in key context opens a table header;
                    // otherwise an array.
                    b'[' => {
                        if key && depth == 0 {
                            header = true;
                        } else {
                            if depth < STACK {
                                stack[depth] = 0;
                            }
                            depth += 1;
                            key = false;
                        }
                        if header && byte(src, end, p) == b'[' {
                            p += 1;
                        }
                        out.tok(tok::PUNCTUATION_BRACKET, p);
                    }
                    b']' => {
                        if header && byte(src, end, p) == b']' {
                            p += 1;
                        }
                        if header {
                            header = false;
                            key = false;
                        } else {
                            depth = depth.saturating_sub(1);
                        }
                        out.tok(tok::PUNCTUATION_BRACKET, p);
                    }
                    // A container stack tells arrays from inline tables.
                    b'{' => {
                        if depth < STACK {
                            stack[depth] = 1;
                        }
                        depth += 1;
                        key = true;
                        out.tok(tok::PUNCTUATION_BRACKET, p);
                    }
                    b'}' => {
                        depth = depth.saturating_sub(1);
                        key = false;
                        out.tok(tok::PUNCTUATION_BRACKET, p);
                    }
                    _ => {
                        if c == b',' {
                            key = depth != 0 && depth <= STACK && stack[depth - 1] != 0;
                        }
                        out.tok(tok::PUNCTUATION_DELIMITER, p);
                    }
                }
                break 'done;
            }
            let hl;
            if k & K_VALUE != 0 {
                (p, hl) = value(src, end, lhs, c);
            } else {
                p = atom_end(src, end, lhs);
                hl = tok::NONE;
            }
            out.tok(hl, p);
        }

        // The whitespace after the token extends its record; a line break
        // in it ends a header and, outside containers, returns to key
        // context.
        win.sync(src, end, p);
        // SAFETY: a token ends at or before the input end.
        if matches!(unsafe { src.byte_unchecked(p) }, 9 | 10 | 13 | 32) {
            let lf;
            (p, lf) = win.space_end(src, end, p);
            // SAFETY: every rule above emits a token, so a record exists.
            unsafe { out.extend_unchecked(p) };
            if lf {
                header = false;
                if depth == 0 {
                    key = true;
                }
            }
        }
    }
    out
}
