//! SIMD byte scans for the native lexers, 16 bytes per step.
//!
//! Every scan takes `src` with at least 16 readable bytes past `end` and
//! clamps its result to `end`, like the WAT scans in `src/scan.wat`.

#[cfg(target_arch = "aarch64")]
use core::arch::aarch64::*;

/// Index of the first set lane in a NEON compare result, or 16.
#[cfg(target_arch = "aarch64")]
#[inline(always)]
fn first_lane(hit: uint8x16_t) -> usize {
    unsafe {
        let nib = vget_lane_u64::<0>(vreinterpret_u64_u8(vshrn_n_u16::<4>(vreinterpretq_u16_u8(
            hit,
        ))));
        if nib == 0 {
            16
        } else {
            (nib.trailing_zeros() / 4) as usize
        }
    }
}

/// Find the first byte in `[p, end)` for which `hit` is set, using a vector
/// predicate and its scalar twin for non-NEON targets.
macro_rules! find {
    ($src:expr, $p:expr, $end:expr, |$w:ident| $vec:expr, |$b:ident| $scalar:expr) => {{
        let src: &[u8] = $src;
        let end: usize = $end;
        let mut p: usize = $p;
        while p < end {
            #[cfg(target_arch = "aarch64")]
            let k = unsafe {
                let $w = vld1q_u8(src.as_ptr().add(p));
                first_lane($vec)
            };
            #[cfg(not(target_arch = "aarch64"))]
            let k = (0..16)
                .find(|&i| {
                    let $b = src[p + i];
                    $scalar
                })
                .unwrap_or(16);
            if k < 16 {
                p += k;
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
    find!(
        src,
        p,
        end,
        |w| vorrq_u8(
            vceqq_u8(w, vdupq_n_u8(b'\n')),
            vceqq_u8(w, vdupq_n_u8(b'\r'))
        ),
        |b| b == b'\n' || b == b'\r'
    )
}

/// Find `quote`, a backslash, CR, or LF from `p`.
#[inline(always)]
pub fn string_special(src: &[u8], p: usize, end: usize, quote: u8) -> usize {
    find!(
        src,
        p,
        end,
        |w| {
            vorrq_u8(
                vorrq_u8(
                    vceqq_u8(w, vdupq_n_u8(quote)),
                    vceqq_u8(w, vdupq_n_u8(b'\\')),
                ),
                vorrq_u8(
                    vceqq_u8(w, vdupq_n_u8(b'\n')),
                    vceqq_u8(w, vdupq_n_u8(b'\r')),
                ),
            )
        },
        |b| b == quote || b == b'\\' || b == b'\n' || b == b'\r'
    )
}

/// Return the position just past the next `*/` from `p`, or `end`.
#[inline(always)]
pub fn block_comment_end(src: &[u8], p: usize, end: usize) -> usize {
    let mut p = p;
    loop {
        p = find!(src, p, end, |w| vceqq_u8(w, vdupq_n_u8(b'*')), |b| b
            == b'*');
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
    find!(
        src,
        p,
        end,
        |w| vorrq_u8(
            vorrq_u8(vceqq_u8(w, vdupq_n_u8(a)), vceqq_u8(w, vdupq_n_u8(b))),
            vceqq_u8(w, vdupq_n_u8(c))
        ),
        |x| x == a || x == b || x == c
    )
}
