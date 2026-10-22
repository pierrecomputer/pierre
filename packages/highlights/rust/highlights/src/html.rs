//! HTML rendering from token records.
//!
//! The output matches the wasm emitter's mode 0: one `<pre><code>` wrapper,
//! flat spans with inline colors, and adjacent tokens with the same style
//! sharing a span. Writes go through a raw cursor into capacity reserved up
//! front, so the per-token work is a few fixed-size stores.

use crate::{Rec, TOKEN_TYPES};

/// Openers are copied as one 64-byte block; later writes overwrite the tail.
const OPENER_SLOT: usize = 64;

/// HTML for one packed theme table (five bytes per token: RGBA, then font
/// flags), rendered from token records.
pub struct HtmlTheme {
    /// Five-byte style value per token; 0 means no span.
    values: Vec<u64>,
    /// `<span style="...">` per token, padded to [`OPENER_SLOT`] bytes.
    openers: Vec<[u8; OPENER_SLOT]>,
    opener_lens: Vec<u8>,
    prologue: Vec<u8>,
}

fn push_rgba(out: &mut Vec<u8>, v: u32) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    out.push(b'#');
    let bytes = v.to_le_bytes();
    let n = if bytes[3] == 0xff { 3 } else { 4 };
    for b in &bytes[..n] {
        out.push(HEX[(b >> 4) as usize]);
        out.push(HEX[(b & 15) as usize]);
    }
}

fn token_slot(name: &str) -> usize {
    TOKEN_TYPES
        .iter()
        .position(|t| *t == name)
        .expect("token type")
}

impl HtmlTheme {
    pub fn new(table: &[u8]) -> Self {
        let rec = |i: usize| -> (u32, u8) {
            let r = table.get(i * 5..i * 5 + 5).unwrap_or(&[0; 5]);
            (u32::from_le_bytes(r[..4].try_into().unwrap()), r[4])
        };
        let mut values = vec![];
        let mut openers = vec![];
        let mut opener_lens = vec![];
        for i in 0..TOKEN_TYPES.len() {
            let (rgba, style) = rec(i);
            values.push(rgba as u64 | (style as u64) << 32);
            let mut o = b"<span style=\"color:".to_vec();
            if rgba != 0 {
                push_rgba(&mut o, rgba);
            } else {
                o.extend_from_slice(b"inherit");
            }
            if style & 0x10 != 0 {
                o.extend_from_slice(b";font-style:italic");
            }
            if style & 15 != 0 {
                o.extend_from_slice(b";font-weight:");
                o.push(b'0' + (style & 15));
                o.extend_from_slice(b"00");
            }
            o.extend_from_slice(b"\">");
            let mut slot = [0u8; OPENER_SLOT];
            slot[..o.len()].copy_from_slice(&o);
            openers.push(slot);
            opener_lens.push(o.len() as u8);
        }
        let mut prologue = b"<pre class=\"highlights\" style=\"".to_vec();
        let (bg, _) = rec(token_slot("background"));
        if bg != 0 {
            prologue.extend_from_slice(b"background-color:");
            push_rgba(&mut prologue, bg);
            prologue.push(b';');
        }
        let (fg, _) = rec(token_slot("foreground"));
        if fg != 0 {
            prologue.extend_from_slice(b"color:");
            push_rgba(&mut prologue, fg);
        }
        prologue.extend_from_slice(b"\"><code>");
        HtmlTheme {
            values,
            openers,
            opener_lens,
            prologue,
        }
    }

    /// Render the first `len` bytes of `input` from their token records into
    /// `out`. `input` must extend at least 16 bytes past `len`.
    pub fn render(&self, input: &[u8], len: usize, recs: &[Rec], out: &mut Vec<u8>) {
        assert!(input.len() >= len + 16);
        assert!(recs.last().is_none_or(|r| r.end as usize <= len));
        out.clear();
        // Escaping grows a byte to at most five; each record adds at most a
        // close and an opener slot; wide stores write up to 16 bytes extra.
        let cap = len * 5 + recs.len() * (7 + OPENER_SLOT) + self.prologue.len() + 64;
        out.reserve(cap);
        let base = out.as_mut_ptr();
        // SAFETY: every write below stays within `cap` bytes of `base`, and
        // every read of `input` stays within `len + 16` bytes.
        unsafe {
            let mut dst = base;
            core::ptr::copy_nonoverlapping(self.prologue.as_ptr(), dst, self.prologue.len());
            dst = dst.add(self.prologue.len());
            let src = input.as_ptr();
            let mut open = 0u64;
            let mut start = 0usize;
            for r in recs {
                let end = r.end as usize;
                let token = r.token as usize;
                let val = *self.values.get_unchecked(token);
                if val != open {
                    if open != 0 {
                        dst.cast::<[u8; 8]>().write_unaligned(*b"</span>\0");
                        dst = dst.add(7);
                    }
                    if val != 0 {
                        dst.cast::<[u8; OPENER_SLOT]>()
                            .write_unaligned(*self.openers.get_unchecked(token));
                        dst = dst.add(*self.opener_lens.get_unchecked(token) as usize);
                    }
                    open = val;
                }
                dst = escape(src.add(start), end - start, dst);
                start = end;
            }
            if open != 0 {
                dst.cast::<[u8; 8]>().write_unaligned(*b"</span>\0");
                dst = dst.add(7);
            }
            dst.cast::<[u8; 16]>()
                .write_unaligned(*b"</code></pre>\0\0\0");
            dst = dst.add(13);
            out.set_len(dst.offset_from(base) as usize);
        }
    }
}

/// Copy `n` bytes from `src` to `dst`, escaping `&`, `<`, and `>`, 16 bytes
/// Copy `n` bytes from `src` to `dst`, escaping `&`, `<`, and `>`, 16 bytes
/// per step: one compare finds every special in the block, and each one is
/// replaced without rescanning. Reads and writes may run 16 bytes past the
/// range.
#[inline(always)]
unsafe fn escape(mut src: *const u8, n: usize, mut dst: *mut u8) -> *mut u8 {
    unsafe {
        let end = src.add(n);
        while src < end {
            let take = (end.offset_from(src) as usize).min(16);
            // Four bits per byte, set for a special.
            let mut mask = specials16(src);
            if take < 16 {
                mask &= (1u64 << (take * 4)) - 1;
            }
            let mut from = 0;
            while mask != 0 {
                let k = mask.trailing_zeros() as usize / 4;
                core::ptr::copy_nonoverlapping(src.add(from), dst, 16);
                dst = dst.add(k - from);
                let (rep, rep_len): ([u8; 8], usize) = match *src.add(k) {
                    b'&' => (*b"&amp;\0\0\0", 5),
                    b'<' => (*b"&lt;\0\0\0\0", 4),
                    _ => (*b"&gt;\0\0\0\0", 4),
                };
                dst.cast::<[u8; 8]>().write_unaligned(rep);
                dst = dst.add(rep_len);
                from = k + 1;
                mask &= !(0xf << (k * 4));
            }
            core::ptr::copy_nonoverlapping(src.add(from), dst, 16);
            dst = dst.add(take - from);
            src = src.add(take);
        }
        dst
    }
}

/// Four bits per byte of the 16 at `p`, set where the byte is `&`, `<`,
/// or `>`.
#[inline(always)]
unsafe fn specials16(p: *const u8) -> u64 {
    #[cfg(target_arch = "aarch64")]
    unsafe {
        use core::arch::aarch64::*;
        let w = vld1q_u8(p);
        // `<` and `>` differ only in bit 1.
        let hit = vorrq_u8(
            vceqq_u8(vandq_u8(w, vdupq_n_u8(0xfd)), vdupq_n_u8(b'<')),
            vceqq_u8(w, vdupq_n_u8(b'&')),
        );
        vget_lane_u64::<0>(vreinterpret_u64_u8(vshrn_n_u16::<4>(vreinterpretq_u16_u8(
            hit,
        ))))
    }
    #[cfg(not(target_arch = "aarch64"))]
    unsafe {
        let mut m = 0u64;
        for i in 0..16 {
            let b = *p.add(i);
            if b == b'&' || b == b'<' || b == b'>' {
                m |= 0xf << (i * 4);
            }
        }
        m
    }
}
