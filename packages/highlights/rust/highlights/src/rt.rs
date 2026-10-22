//! Runtime support for the generated lexers: linear memory, the SIMD
//! operations the WAT uses, traps, and the host functions it imports.

pub const PAGE: usize = 65536;

/// Abort on a wasm trap. The lexers never trap on valid input; reaching this
/// means a lexer broke one of its invariants.
#[cold]
#[inline(never)]
pub fn trap() -> ! {
    panic!("highlights: wasm trap")
}

/// Wasm linear memory. Accesses are unchecked unless the `checked` feature is
/// on; the lexers keep every read inside the input slack the host reserves.
pub struct Memory {
    buf: Vec<u8>,
}

macro_rules! access {
    ($self:ident, $addr:ident, $off:ident, $n:expr) => {{
        let at = $addr as u32 as usize + $off as usize;
        #[cfg(feature = "checked")]
        if at + $n > $self.buf.len() {
            trap();
        }
        at
    }};
}

impl Memory {
    pub fn new(pages: usize, init: &[u8; PAGE]) -> Self {
        let mut buf = vec![0u8; pages * PAGE];
        buf[..PAGE].copy_from_slice(init);
        Memory { buf }
    }

    #[inline(always)]
    pub fn bytes(&self) -> &[u8] {
        &self.buf
    }

    #[inline(always)]
    pub fn bytes_mut(&mut self) -> &mut [u8] {
        &mut self.buf
    }

    /// Grow so that at least `len` bytes are addressable.
    pub fn reserve(&mut self, len: usize) {
        if len > self.buf.len() {
            let pages = len.div_ceil(PAGE);
            self.buf.resize(pages * PAGE, 0);
        }
    }

    #[inline(always)]
    pub fn pages(&self) -> i32 {
        (self.buf.len() / PAGE) as i32
    }

    pub fn grow(&mut self, delta: i32) -> i32 {
        let old = self.pages();
        let new = old as usize + delta as u32 as usize;
        if new > 65536 {
            return -1;
        }
        self.buf.resize(new * PAGE, 0);
        old
    }

    #[inline(always)]
    fn ptr(&self, at: usize) -> *const u8 {
        // SAFETY: callers stay in bounds; see the type docs.
        unsafe { self.buf.as_ptr().add(at) }
    }

    #[inline(always)]
    fn ptr_mut(&mut self, at: usize) -> *mut u8 {
        // SAFETY: callers stay in bounds; see the type docs.
        unsafe { self.buf.as_mut_ptr().add(at) }
    }

    #[inline(always)]
    pub fn ld_u8(&self, addr: i32, off: u64) -> i32 {
        let at = access!(self, addr, off, 1);
        unsafe { *self.ptr(at) as i32 }
    }

    #[inline(always)]
    pub fn ld_s8(&self, addr: i32, off: u64) -> i32 {
        let at = access!(self, addr, off, 1);
        unsafe { *self.ptr(at) as i8 as i32 }
    }

    #[inline(always)]
    pub fn ld_u16(&self, addr: i32, off: u64) -> i32 {
        let at = access!(self, addr, off, 2);
        unsafe { u16::from_le(self.ptr(at).cast::<u16>().read_unaligned()) as i32 }
    }

    #[inline(always)]
    pub fn ld_s16(&self, addr: i32, off: u64) -> i32 {
        let at = access!(self, addr, off, 2);
        unsafe { i16::from_le(self.ptr(at).cast::<i16>().read_unaligned()) as i32 }
    }

    #[inline(always)]
    pub fn ld_i32(&self, addr: i32, off: u64) -> i32 {
        let at = access!(self, addr, off, 4);
        unsafe { i32::from_le(self.ptr(at).cast::<i32>().read_unaligned()) }
    }

    #[inline(always)]
    pub fn ld_i64(&self, addr: i32, off: u64) -> i64 {
        let at = access!(self, addr, off, 8);
        unsafe { i64::from_le(self.ptr(at).cast::<i64>().read_unaligned()) }
    }

    #[inline(always)]
    pub fn ld_v128(&self, addr: i32, off: u64) -> V128 {
        let at = access!(self, addr, off, 16);
        unsafe { v_load(self.ptr(at)) }
    }

    #[inline(always)]
    pub fn st_i8(&mut self, addr: i32, off: u64, v: i32) {
        let at = access!(self, addr, off, 1);
        unsafe { *self.ptr_mut(at) = v as u8 }
    }

    #[inline(always)]
    pub fn st_i16(&mut self, addr: i32, off: u64, v: i32) {
        let at = access!(self, addr, off, 2);
        unsafe {
            self.ptr_mut(at)
                .cast::<u16>()
                .write_unaligned((v as u16).to_le())
        }
    }

    #[inline(always)]
    pub fn st_i32(&mut self, addr: i32, off: u64, v: i32) {
        let at = access!(self, addr, off, 4);
        unsafe { self.ptr_mut(at).cast::<i32>().write_unaligned(v.to_le()) }
    }

    #[inline(always)]
    pub fn st_i64(&mut self, addr: i32, off: u64, v: i64) {
        let at = access!(self, addr, off, 8);
        unsafe { self.ptr_mut(at).cast::<i64>().write_unaligned(v.to_le()) }
    }

    #[inline(always)]
    pub fn st_v128(&mut self, addr: i32, off: u64, v: V128) {
        let at = access!(self, addr, off, 16);
        unsafe { v_store(self.ptr_mut(at), v) }
    }

    #[inline(always)]
    pub fn ld_u8_l(&self, addr: i32, off: u64) -> i64 {
        self.ld_u8(addr, off) as i64
    }

    #[inline(always)]
    pub fn ld_u16_l(&self, addr: i32, off: u64) -> i64 {
        self.ld_u16(addr, off) as i64
    }

    #[inline(always)]
    pub fn ld_u32_l(&self, addr: i32, off: u64) -> i64 {
        self.ld_i32(addr, off) as u32 as i64
    }

    #[inline(always)]
    pub fn st_i8_l(&mut self, addr: i32, off: u64, v: i64) {
        self.st_i8(addr, off, v as i32)
    }

    #[inline(always)]
    pub fn st_i16_l(&mut self, addr: i32, off: u64, v: i64) {
        self.st_i16(addr, off, v as i32)
    }

    #[inline(always)]
    pub fn st_i32_l(&mut self, addr: i32, off: u64, v: i64) {
        self.st_i32(addr, off, v as i32)
    }

    #[inline(always)]
    pub fn copy(&mut self, dst: i32, src: i32, n: i32) {
        let (dst, src, n) = (dst as u32 as usize, src as u32 as usize, n as u32 as usize);
        if dst.max(src) + n > self.buf.len() {
            trap();
        }
        self.buf.copy_within(src..src + n, dst);
    }

    #[inline(always)]
    pub fn fill(&mut self, dst: i32, v: i32, n: i32) {
        let (dst, n) = (dst as u32 as usize, n as u32 as usize);
        if dst + n > self.buf.len() {
            trap();
        }
        self.buf[dst..dst + n].fill(v as u8);
    }
}

// ---------------------------------------------------------------------------
// SIMD: the i8x16 subset the lexers use, on NEON with a portable fallback.

#[cfg(target_arch = "aarch64")]
#[allow(dead_code)]
mod simd {
    use core::arch::aarch64::*;

    pub type V128 = uint8x16_t;

    #[inline(always)]
    pub fn v_zero() -> V128 {
        unsafe { vdupq_n_u8(0) }
    }
    #[inline(always)]
    pub unsafe fn v_load(p: *const u8) -> V128 {
        unsafe { vld1q_u8(p) }
    }
    #[inline(always)]
    pub unsafe fn v_store(p: *mut u8, v: V128) {
        unsafe { vst1q_u8(p, v) }
    }
    #[inline(always)]
    pub fn v_splat(x: i32) -> V128 {
        unsafe { vdupq_n_u8(x as u8) }
    }
    #[inline(always)]
    pub fn v_eq(a: V128, b: V128) -> V128 {
        unsafe { vceqq_u8(a, b) }
    }
    #[inline(always)]
    pub fn v_ne(a: V128, b: V128) -> V128 {
        unsafe { vmvnq_u8(vceqq_u8(a, b)) }
    }
    #[inline(always)]
    pub fn v_ge_u(a: V128, b: V128) -> V128 {
        unsafe { vcgeq_u8(a, b) }
    }
    #[inline(always)]
    pub fn v_le_u(a: V128, b: V128) -> V128 {
        unsafe { vcleq_u8(a, b) }
    }
    #[inline(always)]
    pub fn v_gt_s(a: V128, b: V128) -> V128 {
        unsafe { vcgtq_s8(vreinterpretq_s8_u8(a), vreinterpretq_s8_u8(b)) }
    }
    #[inline(always)]
    pub fn v_sub(a: V128, b: V128) -> V128 {
        unsafe { vsubq_u8(a, b) }
    }
    #[inline(always)]
    pub fn v_and(a: V128, b: V128) -> V128 {
        unsafe { vandq_u8(a, b) }
    }
    #[inline(always)]
    pub fn v_or(a: V128, b: V128) -> V128 {
        unsafe { vorrq_u8(a, b) }
    }
    #[inline(always)]
    pub fn v_xor(a: V128, b: V128) -> V128 {
        unsafe { veorq_u8(a, b) }
    }
    #[inline(always)]
    pub fn v_any_true(a: V128) -> i32 {
        unsafe { (vmaxvq_u8(a) != 0) as i32 }
    }
    #[inline(always)]
    pub fn v_const(x: u128) -> V128 {
        unsafe { v_load(x.to_le_bytes().as_ptr()) }
    }
    #[inline(always)]
    pub fn v_not(a: V128) -> V128 {
        unsafe { vmvnq_u8(a) }
    }
    #[inline(always)]
    pub fn v_andnot(a: V128, b: V128) -> V128 {
        unsafe { vbicq_u8(a, b) }
    }
    /// One bit per lane from each lane's top bit, like `i8x16.bitmask`.
    #[inline(always)]
    pub fn v_bitmask(a: V128) -> i32 {
        unsafe {
            let bits = vshrq_n_u8::<7>(a);
            let p16 = vreinterpretq_u16_u8(bits);
            let p32 = vreinterpretq_u32_u16(vsraq_n_u16::<7>(p16, p16));
            let p64 = vreinterpretq_u64_u32(vsraq_n_u32::<14>(p32, p32));
            let p = vreinterpretq_u8_u64(vsraq_n_u64::<28>(p64, p64));
            (vgetq_lane_u8::<0>(p) as i32) | ((vgetq_lane_u8::<8>(p) as i32) << 8)
        }
    }
}

#[cfg(not(target_arch = "aarch64"))]
#[allow(dead_code)]
mod simd {
    #[derive(Clone, Copy)]
    pub struct V128([u8; 16]);

    #[inline(always)]
    fn map2(a: V128, b: V128, f: impl Fn(u8, u8) -> bool) -> V128 {
        V128(core::array::from_fn(|i| {
            if f(a.0[i], b.0[i]) { 0xff } else { 0 }
        }))
    }

    #[inline(always)]
    pub fn v_zero() -> V128 {
        V128([0; 16])
    }
    #[inline(always)]
    pub unsafe fn v_load(p: *const u8) -> V128 {
        V128(unsafe { p.cast::<[u8; 16]>().read_unaligned() })
    }
    #[inline(always)]
    pub unsafe fn v_store(p: *mut u8, v: V128) {
        unsafe { p.cast::<[u8; 16]>().write_unaligned(v.0) }
    }
    #[inline(always)]
    pub fn v_splat(x: i32) -> V128 {
        V128([x as u8; 16])
    }
    #[inline(always)]
    pub fn v_eq(a: V128, b: V128) -> V128 {
        map2(a, b, |x, y| x == y)
    }
    #[inline(always)]
    pub fn v_ne(a: V128, b: V128) -> V128 {
        map2(a, b, |x, y| x != y)
    }
    #[inline(always)]
    pub fn v_ge_u(a: V128, b: V128) -> V128 {
        map2(a, b, |x, y| x >= y)
    }
    #[inline(always)]
    pub fn v_le_u(a: V128, b: V128) -> V128 {
        map2(a, b, |x, y| x <= y)
    }
    #[inline(always)]
    pub fn v_gt_s(a: V128, b: V128) -> V128 {
        map2(a, b, |x, y| (x as i8) > (y as i8))
    }
    #[inline(always)]
    pub fn v_sub(a: V128, b: V128) -> V128 {
        V128(core::array::from_fn(|i| a.0[i].wrapping_sub(b.0[i])))
    }
    #[inline(always)]
    pub fn v_and(a: V128, b: V128) -> V128 {
        V128(core::array::from_fn(|i| a.0[i] & b.0[i]))
    }
    #[inline(always)]
    pub fn v_or(a: V128, b: V128) -> V128 {
        V128(core::array::from_fn(|i| a.0[i] | b.0[i]))
    }
    #[inline(always)]
    pub fn v_xor(a: V128, b: V128) -> V128 {
        V128(core::array::from_fn(|i| a.0[i] ^ b.0[i]))
    }
    #[inline(always)]
    pub fn v_any_true(a: V128) -> i32 {
        a.0.iter().any(|&x| x != 0) as i32
    }
    #[inline(always)]
    pub fn v_const(x: u128) -> V128 {
        V128(x.to_le_bytes())
    }
    #[inline(always)]
    pub fn v_not(a: V128) -> V128 {
        V128(core::array::from_fn(|i| !a.0[i]))
    }
    #[inline(always)]
    pub fn v_andnot(a: V128, b: V128) -> V128 {
        V128(core::array::from_fn(|i| a.0[i] & !b.0[i]))
    }
    #[inline(always)]
    pub fn v_bitmask(a: V128) -> i32 {
        let mut m = 0;
        for (i, x) in a.0.iter().enumerate() {
            m |= ((x >> 7) as i32) << i;
        }
        m
    }
}

pub use simd::*;

// ---------------------------------------------------------------------------
// Native emitter.

/// A token record: the token covers input bytes from the previous record's
/// `end` (or 0) to `end`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(C)]
pub struct Rec {
    pub end: u32,
    pub token: u32,
}

/// Host state the generated `Instance` carries next to the wasm globals.
#[derive(Default)]
pub struct Ext {
    /// Route `$emitTok`/`$emitGap` into `recs` instead of the wasm emitter.
    pub native: bool,
    pub recs: Vec<Rec>,
    /// Lexing one chunk of a larger input: a gap before the chunk's first
    /// token goes to `lead_gap_end` instead of a record, because it extends
    /// whatever record the previous chunk ended with.
    pub chunked: bool,
    pub lead_gap_end: u32,
}

/// `$Token.none`: the style of a gap before any token.
const TOKEN_NONE: u32 = 0;

// Host imports.

use crate::generated::Instance;

impl Instance {
    /// The native `$emitTok`: append a record for `[lhs, rhs)`, extending the
    /// previous record when the token matches, like the wasm `$recTok`. The
    /// generated code calls it when `ext.native` is set, and the wasm
    /// emitter otherwise. It reads no wasm global but `$srcBase`, which the
    /// translator never caches in a local.
    #[inline(always)]
    pub fn emit_tok_native(&mut self, hl: i32, lhs: i32, rhs: i32) {
        if lhs as u32 >= rhs as u32 {
            return;
        }
        let end = rhs.wrapping_sub(self.g_srcBase) as u32;
        let recs = &mut self.ext.recs;
        if let Some(last) = recs.last_mut()
            && last.token == hl as u32
        {
            last.end = end;
            return;
        }
        recs.push(Rec {
            end,
            token: hl as u32,
        });
    }

    /// The native `$emitGap`: whitespace keeps the previous record's token.
    #[inline(always)]
    pub fn emit_gap_native(&mut self, lhs: i32, rhs: i32) {
        if lhs as u32 >= rhs as u32 {
            return;
        }
        let end = rhs.wrapping_sub(self.g_srcBase) as u32;
        match self.ext.recs.last_mut() {
            Some(last) => last.end = end,
            None if self.ext.chunked => self.ext.lead_gap_end = end,
            None => self.ext.recs.push(Rec {
                end,
                token: TOKEN_NONE,
            }),
        }
    }

    /// Decode the UTF-8 code point at `ptr` (`bits` bytes long).
    fn code_point_at(&self, ptr: i32, bits: i32) -> Option<char> {
        let at = ptr as u32 as usize;
        let bytes = self.mem.bytes().get(at..at + bits as usize)?;
        core::str::from_utf8(bytes).ok()?.chars().next()
    }

    /// `env.is_id_start`: whether the code point at `ptr` can start an
    /// ECMAScript identifier.
    pub fn host_is_id_start(&mut self, ptr: i32, bits: i32) -> i32 {
        self.code_point_at(ptr, bits)
            .is_some_and(unicode_ident::is_xid_start) as i32
    }

    /// `env.is_id_continue`: whether the code point at `ptr` can continue an
    /// ECMAScript identifier, including ZWNJ and ZWJ.
    pub fn host_is_id_continue(&mut self, ptr: i32, bits: i32) -> i32 {
        self.code_point_at(ptr, bits).is_some_and(|c| {
            c == '\u{200c}' || c == '\u{200d}' || unicode_ident::is_xid_continue(c)
        }) as i32
    }
}
