//! Vector byte scans for the native lexers, 16 bytes per step.
//!
//! Every scan takes `src` with at least 16 readable bytes past `end` and
//! clamps its result to `end`, like the WAT scans in `src/scan.wat`.

use crate::simd::V;

/// Find the first byte in `[p, end)` whose lane `hit` sets, 16 bytes per
/// step.
macro_rules! find {
    ($src:expr, $p:expr, $end:expr, |$w:ident| $hit:expr) => {{
        let src: &[u8] = $src;
        let end: usize = $end;
        let mut p: usize = $p;
        while p < end {
            debug_assert!(p + 16 <= src.len());
            // SAFETY: `src` holds at least 16 bytes past `end`.
            let $w = unsafe { V::load(src.as_ptr().add(p)) };
            let hit = $hit.lanes();
            if hit.any() {
                p += hit.first();
                break;
            }
            p += 16;
        }
        p.min(end)
    }};
}

/// Find the next CR or LF from `p`.
#[inline(always)]
pub fn line_end(src: &[u8], p: usize, end: usize) -> usize {
    find!(src, p, end, |w| w
        .eq(V::splat(b'\n'))
        .or(w.eq(V::splat(b'\r'))))
}

/// Find `quote`, a backslash, CR, or LF from `p`.
#[inline(always)]
pub fn string_special(src: &[u8], p: usize, end: usize, quote: u8) -> usize {
    find!(src, p, end, |w| w
        .eq(V::splat(quote))
        .or(w.eq(V::splat(b'\\')))
        .or(w.eq(V::splat(b'\n')).or(w.eq(V::splat(b'\r')))))
}

/// Return the position just past the next `*/` from `p`, or `end`.
#[inline(always)]
pub fn block_comment_end(src: &[u8], p: usize, end: usize) -> usize {
    let mut p = p;
    loop {
        p = find!(src, p, end, |w| w.eq(V::splat(b'*')));
        if p >= end {
            return end;
        }
        if src[p + 1] == b'/' {
            return (p + 2).min(end);
        }
        p += 1;
    }
}

/// Extend `e` (clamped to `stop`) over UTF-8 continuation bytes.
#[inline(always)]
pub fn utf8_span_end(src: &[u8], e: usize, stop: usize) -> usize {
    let mut e = e.min(stop);
    while e < stop && src[e] & 0xc0 == 0x80 {
        e += 1;
    }
    e
}

/// Find `a`, `b`, or `c` from `p`.
#[inline(always)]
pub fn find3(src: &[u8], p: usize, end: usize, a: u8, b: u8, c: u8) -> usize {
    find!(src, p, end, |w| w
        .eq(V::splat(a))
        .or(w.eq(V::splat(b)))
        .or(w.eq(V::splat(c))))
}
