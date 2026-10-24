//! 16-byte SIMD for the lexers, one API on every platform:
//!
//! - aarch64: NEON;
//! - x86-64 with SSSE3, which the x86-64-v2 baseline in `.cargo/config.toml`
//!   provides: SSE;
//! - wasm32 with `simd128` (also set in `.cargo/config.toml`): wasm SIMD;
//! - anywhere else: plain byte arrays.
//!
//! Every backend gives the same result for every operation; the tests
//! compare each one with the array backend. A "mask" is a vector whose
//! lanes are all zeros or all ones, as comparisons return.

/// Sixteen bytes in a SIMD register.
#[derive(Clone, Copy)]
#[repr(transparent)]
pub struct V(imp::Raw);

impl V {
    /// Every lane `b`.
    #[inline(always)]
    pub fn splat(b: u8) -> V {
        V(imp::splat(b))
    }

    /// All lanes zero.
    #[inline(always)]
    pub fn zero() -> V {
        V::splat(0)
    }

    /// The lanes of `a`, lane 0 first.
    #[inline(always)]
    pub fn from_array(a: &[u8; 16]) -> V {
        // SAFETY: `a` holds 16 bytes.
        unsafe { V::load(a.as_ptr()) }
    }

    /// The 16 bytes at `p`.
    ///
    /// # Safety
    /// `p..p + 16` must be readable; it needs no alignment.
    #[inline(always)]
    pub unsafe fn load(p: *const u8) -> V {
        V(unsafe { imp::load(p) })
    }

    /// Write the lanes to `p..p + 16`.
    ///
    /// # Safety
    /// `p..p + 16` must be writable; it needs no alignment.
    #[inline(always)]
    pub unsafe fn store(self, p: *mut u8) {
        unsafe { imp::store(p, self.0) }
    }

    /// A NEON vector as a `V`, for code not yet written against `V`.
    #[cfg(target_arch = "aarch64")]
    #[inline(always)]
    pub fn from_neon(v: core::arch::aarch64::uint8x16_t) -> V {
        V(v)
    }

    /// The lanes, lane 0 first.
    #[inline(always)]
    pub fn to_array(self) -> [u8; 16] {
        let mut a = [0u8; 16];
        // SAFETY: `a` holds 16 bytes.
        unsafe { self.store(a.as_mut_ptr()) };
        a
    }

    /// Mask of lanes where `self == o`.
    #[inline(always)]
    pub fn eq(self, o: V) -> V {
        V(imp::eq(self.0, o.0))
    }

    /// Mask of lanes where `self != o`.
    #[inline(always)]
    pub fn ne(self, o: V) -> V {
        self.eq(o).not()
    }

    /// Mask of lanes where `self <= o`, as unsigned bytes.
    #[inline(always)]
    pub fn le(self, o: V) -> V {
        V(imp::le(self.0, o.0))
    }

    /// Mask of lanes where `self >= o`, as unsigned bytes.
    #[inline(always)]
    pub fn ge(self, o: V) -> V {
        o.le(self)
    }

    /// Mask of lanes where `self < o`, as unsigned bytes.
    #[inline(always)]
    pub fn lt(self, o: V) -> V {
        self.ge(o).not()
    }

    /// Mask of lanes where `self > o`, as unsigned bytes.
    #[inline(always)]
    pub fn gt(self, o: V) -> V {
        self.le(o).not()
    }

    /// Mask of lanes where `self > o`, as signed bytes.
    #[inline(always)]
    pub fn gt_signed(self, o: V) -> V {
        V(imp::gt_signed(self.0, o.0))
    }

    /// Mask of lanes whose high bit is set (negative as signed bytes).
    #[inline(always)]
    pub fn high(self) -> V {
        V::zero().gt_signed(self)
    }

    /// Mask of lanes where `self & o` is not zero.
    #[inline(always)]
    pub fn test(self, o: V) -> V {
        self.and(o).eq(V::zero()).not()
    }

    #[inline(always)]
    pub fn and(self, o: V) -> V {
        V(imp::and(self.0, o.0))
    }

    #[inline(always)]
    pub fn or(self, o: V) -> V {
        V(imp::or(self.0, o.0))
    }

    #[inline(always)]
    pub fn xor(self, o: V) -> V {
        V(imp::xor(self.0, o.0))
    }

    /// `self & !o`.
    #[inline(always)]
    pub fn andnot(self, o: V) -> V {
        V(imp::andnot(self.0, o.0))
    }

    #[inline(always)]
    #[allow(clippy::should_implement_trait)]
    pub fn not(self) -> V {
        V(imp::not(self.0))
    }

    /// `self - o` in each lane, wrapping.
    #[inline(always)]
    pub fn sub(self, o: V) -> V {
        V(imp::sub(self.0, o.0))
    }

    /// `self + o` in each lane, wrapping.
    #[inline(always)]
    pub fn add(self, o: V) -> V {
        V(imp::add(self.0, o.0))
    }

    /// Each lane shifted right by `N` bits (logical).
    #[inline(always)]
    pub fn shr<const N: i32>(self) -> V {
        V(imp::shr::<N>(self.0))
    }

    /// Look up each lane of `idx` in the 16-byte table `self`: `self[i]`
    /// for an index `i` below 16, and 0 for any other index.
    #[inline(always)]
    pub fn lookup(self, idx: V) -> V {
        V(imp::lookup(self.0, idx.0))
    }

    /// Whether any bit of any lane is set.
    #[inline(always)]
    pub fn any(self) -> bool {
        imp::any(self.0)
    }

    /// The high bit of each lane, lane 0 in bit 0.
    #[inline(always)]
    pub fn bits(self) -> u32 {
        imp::bits(self.0)
    }

    /// For a mask: the index of its first set lane, or 16 when none is set.
    /// To branch on whether any lane is set, test `lanes().any()`, which
    /// skips computing the index.
    #[inline(always)]
    pub fn first(self) -> usize {
        self.lanes().first()
    }

    /// For a mask: its lanes as a [`Lanes`] word, the cheapest form to branch
    /// on or to compare lane positions in.
    #[inline(always)]
    pub fn lanes(self) -> Lanes {
        Lanes(imp::lanes(self.0))
    }

    /// For four masks covering 64 consecutive bytes: one bit per byte, the
    /// first mask's lane 0 in bit 0.
    #[inline(always)]
    pub fn bits64(a: V, b: V, c: V, d: V) -> u64 {
        imp::bits64(a.0, b.0, c.0, d.0)
    }
}

/// A mask's lanes packed into an integer, lane 0 in the lowest bits. Each
/// lane takes [`Lanes::WIDTH`] adjacent bits: 4 on NEON, where that form
/// costs one instruction, and 1 elsewhere. Code built from these methods
/// works for either width.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Lanes(u64);

impl Lanes {
    /// Bits per lane.
    pub const WIDTH: u32 = imp::LANE_WIDTH;

    /// Whether any lane is set.
    #[inline(always)]
    pub fn any(self) -> bool {
        self.0 != 0
    }

    /// The index of the first set lane, or 16 when none is set.
    #[inline(always)]
    pub fn first(self) -> usize {
        if self.0 == 0 {
            16
        } else {
            (self.0.trailing_zeros() / Self::WIDTH) as usize
        }
    }

    /// The lanes before the first set lane (every lane when none is set).
    #[inline(always)]
    pub fn before_first(self) -> Lanes {
        Lanes(self.0.wrapping_sub(1) & !self.0 & imp::LANE_ALL)
    }

    #[inline(always)]
    pub fn and(self, o: Lanes) -> Lanes {
        Lanes(self.0 & o.0)
    }

    #[inline(always)]
    pub fn or(self, o: Lanes) -> Lanes {
        Lanes(self.0 | o.0)
    }

    /// Lanes `0..n`, for `n` up to 16.
    #[inline(always)]
    pub fn first_n(n: usize) -> Lanes {
        let bits = n as u32 * Self::WIDTH;
        Lanes(
            if bits >= 64 {
                u64::MAX
            } else {
                (1u64 << bits) - 1
            } & imp::LANE_ALL,
        )
    }

    /// These lanes with `lane` cleared.
    #[inline(always)]
    pub fn without(self, lane: usize) -> Lanes {
        Lanes(self.0 & !(((1u64 << Self::WIDTH) - 1) << (lane as u32 * Self::WIDTH)))
    }

    /// The lanes not set (of the 16).
    #[inline(always)]
    #[allow(clippy::should_implement_trait)]
    pub fn not(self) -> Lanes {
        Lanes(!self.0 & imp::LANE_ALL)
    }
}

#[cfg(target_arch = "aarch64")]
mod imp {
    use core::arch::aarch64::*;

    pub type Raw = uint8x16_t;

    // SAFETY (whole module): NEON is part of the aarch64 baseline.

    #[inline(always)]
    pub fn splat(b: u8) -> Raw {
        unsafe { vdupq_n_u8(b) }
    }
    #[inline(always)]
    pub unsafe fn load(p: *const u8) -> Raw {
        unsafe { vld1q_u8(p) }
    }
    #[inline(always)]
    pub unsafe fn store(p: *mut u8, v: Raw) {
        unsafe { vst1q_u8(p, v) }
    }
    #[inline(always)]
    pub fn eq(a: Raw, b: Raw) -> Raw {
        unsafe { vceqq_u8(a, b) }
    }
    #[inline(always)]
    pub fn le(a: Raw, b: Raw) -> Raw {
        unsafe { vcleq_u8(a, b) }
    }
    #[inline(always)]
    pub fn gt_signed(a: Raw, b: Raw) -> Raw {
        unsafe { vcgtq_s8(vreinterpretq_s8_u8(a), vreinterpretq_s8_u8(b)) }
    }
    #[inline(always)]
    pub fn and(a: Raw, b: Raw) -> Raw {
        unsafe { vandq_u8(a, b) }
    }
    #[inline(always)]
    pub fn or(a: Raw, b: Raw) -> Raw {
        unsafe { vorrq_u8(a, b) }
    }
    #[inline(always)]
    pub fn xor(a: Raw, b: Raw) -> Raw {
        unsafe { veorq_u8(a, b) }
    }
    #[inline(always)]
    pub fn andnot(a: Raw, b: Raw) -> Raw {
        unsafe { vbicq_u8(a, b) }
    }
    #[inline(always)]
    pub fn not(a: Raw) -> Raw {
        unsafe { vmvnq_u8(a) }
    }
    #[inline(always)]
    pub fn sub(a: Raw, b: Raw) -> Raw {
        unsafe { vsubq_u8(a, b) }
    }
    #[inline(always)]
    pub fn add(a: Raw, b: Raw) -> Raw {
        unsafe { vaddq_u8(a, b) }
    }
    #[inline(always)]
    pub fn shr<const N: i32>(a: Raw) -> Raw {
        unsafe { vshrq_n_u8::<N>(a) }
    }
    #[inline(always)]
    pub fn lookup(table: Raw, idx: Raw) -> Raw {
        unsafe { vqtbl1q_u8(table, idx) }
    }
    #[inline(always)]
    pub fn any(a: Raw) -> bool {
        unsafe { vmaxvq_u8(a) != 0 }
    }
    /// One bit per lane, from a mask: each lane keeps its own bit of a
    /// byte, and three pairwise adds gather the bytes.
    #[inline(always)]
    fn mask_bits(m: Raw) -> Raw {
        const BIT: [u8; 16] = [1, 2, 4, 8, 16, 32, 64, 128, 1, 2, 4, 8, 16, 32, 64, 128];
        unsafe { vandq_u8(m, vld1q_u8(BIT.as_ptr())) }
    }
    /// Each lane's top bit, shifted down and folded together with shifting
    /// accumulates, as `i8x16.bitmask` gives it.
    #[inline(always)]
    pub fn bits(a: Raw) -> u32 {
        unsafe {
            let bits = vshrq_n_u8::<7>(a);
            let p16 = vreinterpretq_u16_u8(bits);
            let p32 = vreinterpretq_u32_u16(vsraq_n_u16::<7>(p16, p16));
            let p64 = vreinterpretq_u64_u32(vsraq_n_u32::<14>(p32, p32));
            let p = vreinterpretq_u8_u64(vsraq_n_u64::<28>(p64, p64));
            vgetq_lane_u8::<0>(p) as u32 | (vgetq_lane_u8::<8>(p) as u32) << 8
        }
    }
    pub const LANE_WIDTH: u32 = 4;
    pub const LANE_ALL: u64 = u64::MAX;
    /// Four bits per lane: a narrowing shift keeps the middle nibble of
    /// each 16-bit pair.
    #[inline(always)]
    pub fn lanes(m: Raw) -> u64 {
        unsafe {
            vget_lane_u64::<0>(vreinterpret_u64_u8(vshrn_n_u16::<4>(vreinterpretq_u16_u8(
                m,
            ))))
        }
    }
    #[inline(always)]
    pub fn bits64(a: Raw, b: Raw, c: Raw, d: Raw) -> u64 {
        unsafe {
            let ab = vpaddq_u8(mask_bits(a), mask_bits(b));
            let cd = vpaddq_u8(mask_bits(c), mask_bits(d));
            let s = vpaddq_u8(ab, cd);
            let s = vpaddq_u8(s, s);
            vgetq_lane_u64::<0>(vreinterpretq_u64_u8(s))
        }
    }
}

#[cfg(all(target_arch = "x86_64", target_feature = "ssse3"))]
mod imp {
    use core::arch::x86_64::*;

    pub type Raw = __m128i;

    // SAFETY (whole module): SSE2 is part of the x86-64 baseline, and this
    // backend is only compiled with SSSE3 enabled.

    #[inline(always)]
    pub fn splat(b: u8) -> Raw {
        unsafe { _mm_set1_epi8(b as i8) }
    }
    #[inline(always)]
    pub unsafe fn load(p: *const u8) -> Raw {
        unsafe { _mm_loadu_si128(p.cast()) }
    }
    #[inline(always)]
    pub unsafe fn store(p: *mut u8, v: Raw) {
        unsafe { _mm_storeu_si128(p.cast(), v) }
    }
    #[inline(always)]
    pub fn eq(a: Raw, b: Raw) -> Raw {
        unsafe { _mm_cmpeq_epi8(a, b) }
    }
    #[inline(always)]
    pub fn le(a: Raw, b: Raw) -> Raw {
        unsafe { _mm_cmpeq_epi8(_mm_min_epu8(a, b), a) }
    }
    #[inline(always)]
    pub fn gt_signed(a: Raw, b: Raw) -> Raw {
        unsafe { _mm_cmpgt_epi8(a, b) }
    }
    #[inline(always)]
    pub fn and(a: Raw, b: Raw) -> Raw {
        unsafe { _mm_and_si128(a, b) }
    }
    #[inline(always)]
    pub fn or(a: Raw, b: Raw) -> Raw {
        unsafe { _mm_or_si128(a, b) }
    }
    #[inline(always)]
    pub fn xor(a: Raw, b: Raw) -> Raw {
        unsafe { _mm_xor_si128(a, b) }
    }
    #[inline(always)]
    pub fn andnot(a: Raw, b: Raw) -> Raw {
        // `_mm_andnot_si128(x, y)` is `!x & y`.
        unsafe { _mm_andnot_si128(b, a) }
    }
    #[inline(always)]
    pub fn not(a: Raw) -> Raw {
        unsafe { _mm_xor_si128(a, _mm_set1_epi8(-1)) }
    }
    #[inline(always)]
    pub fn sub(a: Raw, b: Raw) -> Raw {
        unsafe { _mm_sub_epi8(a, b) }
    }
    #[inline(always)]
    pub fn add(a: Raw, b: Raw) -> Raw {
        unsafe { _mm_add_epi8(a, b) }
    }
    #[inline(always)]
    pub fn shr<const N: i32>(a: Raw) -> Raw {
        // A 16-bit shift, with the bits that crossed from the next byte
        // cleared.
        unsafe { _mm_and_si128(_mm_srli_epi16::<N>(a), _mm_set1_epi8((0xffu8 >> N) as i8)) }
    }
    #[inline(always)]
    pub fn lookup(table: Raw, idx: Raw) -> Raw {
        // `pshufb` gives 0 for an index with its high bit set and uses the
        // low four bits otherwise; set the high bit of indices 16..=127 too.
        unsafe {
            let big = _mm_cmpgt_epi8(idx, _mm_set1_epi8(15));
            _mm_shuffle_epi8(table, _mm_or_si128(idx, big))
        }
    }
    #[inline(always)]
    pub fn any(a: Raw) -> bool {
        unsafe { _mm_movemask_epi8(_mm_cmpeq_epi8(a, _mm_setzero_si128())) != 0xffff }
    }
    #[inline(always)]
    pub fn bits(a: Raw) -> u32 {
        unsafe { _mm_movemask_epi8(a) as u32 }
    }
    pub const LANE_WIDTH: u32 = 1;
    pub const LANE_ALL: u64 = 0xffff;
    #[inline(always)]
    pub fn lanes(m: Raw) -> u64 {
        bits(m) as u64
    }
    #[inline(always)]
    pub fn bits64(a: Raw, b: Raw, c: Raw, d: Raw) -> u64 {
        bits(a) as u64 | (bits(b) as u64) << 16 | (bits(c) as u64) << 32 | (bits(d) as u64) << 48
    }
}

#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
mod imp {
    use core::arch::wasm32::*;

    pub type Raw = v128;

    #[inline(always)]
    pub fn splat(b: u8) -> Raw {
        u8x16_splat(b)
    }
    #[inline(always)]
    pub unsafe fn load(p: *const u8) -> Raw {
        unsafe { v128_load(p.cast()) }
    }
    #[inline(always)]
    pub unsafe fn store(p: *mut u8, v: Raw) {
        unsafe { v128_store(p.cast(), v) }
    }
    #[inline(always)]
    pub fn eq(a: Raw, b: Raw) -> Raw {
        u8x16_eq(a, b)
    }
    #[inline(always)]
    pub fn le(a: Raw, b: Raw) -> Raw {
        u8x16_le(a, b)
    }
    #[inline(always)]
    pub fn gt_signed(a: Raw, b: Raw) -> Raw {
        i8x16_gt(a, b)
    }
    #[inline(always)]
    pub fn and(a: Raw, b: Raw) -> Raw {
        v128_and(a, b)
    }
    #[inline(always)]
    pub fn or(a: Raw, b: Raw) -> Raw {
        v128_or(a, b)
    }
    #[inline(always)]
    pub fn xor(a: Raw, b: Raw) -> Raw {
        v128_xor(a, b)
    }
    #[inline(always)]
    pub fn andnot(a: Raw, b: Raw) -> Raw {
        v128_andnot(a, b)
    }
    #[inline(always)]
    pub fn not(a: Raw) -> Raw {
        v128_not(a)
    }
    #[inline(always)]
    pub fn sub(a: Raw, b: Raw) -> Raw {
        u8x16_sub(a, b)
    }
    #[inline(always)]
    pub fn add(a: Raw, b: Raw) -> Raw {
        u8x16_add(a, b)
    }
    #[inline(always)]
    pub fn shr<const N: i32>(a: Raw) -> Raw {
        u8x16_shr(a, N as u32)
    }
    #[inline(always)]
    pub fn lookup(table: Raw, idx: Raw) -> Raw {
        i8x16_swizzle(table, idx)
    }
    #[inline(always)]
    pub fn any(a: Raw) -> bool {
        v128_any_true(a)
    }
    #[inline(always)]
    pub fn bits(a: Raw) -> u32 {
        u8x16_bitmask(a) as u32
    }
    pub const LANE_WIDTH: u32 = 1;
    pub const LANE_ALL: u64 = 0xffff;
    #[inline(always)]
    pub fn lanes(m: Raw) -> u64 {
        bits(m) as u64
    }
    #[inline(always)]
    pub fn bits64(a: Raw, b: Raw, c: Raw, d: Raw) -> u64 {
        bits(a) as u64 | (bits(b) as u64) << 16 | (bits(c) as u64) << 32 | (bits(d) as u64) << 48
    }
}

#[cfg(not(any(
    target_arch = "aarch64",
    all(target_arch = "x86_64", target_feature = "ssse3"),
    all(target_arch = "wasm32", target_feature = "simd128"),
)))]
use array as imp;

/// The plain-array backend: the reference the tests compare the others
/// with, and the backend where no SIMD is available.
#[allow(dead_code)]
mod array {
    pub type Raw = [u8; 16];

    #[inline(always)]
    fn map(a: Raw, f: impl Fn(u8) -> u8) -> Raw {
        core::array::from_fn(|i| f(a[i]))
    }
    #[inline(always)]
    fn zip(a: Raw, b: Raw, f: impl Fn(u8, u8) -> u8) -> Raw {
        core::array::from_fn(|i| f(a[i], b[i]))
    }
    #[inline(always)]
    fn mask(t: bool) -> u8 {
        if t { 0xff } else { 0 }
    }

    #[inline(always)]
    pub fn splat(b: u8) -> Raw {
        [b; 16]
    }
    #[inline(always)]
    pub unsafe fn load(p: *const u8) -> Raw {
        unsafe { p.cast::<Raw>().read_unaligned() }
    }
    #[inline(always)]
    pub unsafe fn store(p: *mut u8, v: Raw) {
        unsafe { p.cast::<Raw>().write_unaligned(v) }
    }
    #[inline(always)]
    pub fn eq(a: Raw, b: Raw) -> Raw {
        zip(a, b, |x, y| mask(x == y))
    }
    #[inline(always)]
    pub fn le(a: Raw, b: Raw) -> Raw {
        zip(a, b, |x, y| mask(x <= y))
    }
    #[inline(always)]
    pub fn gt_signed(a: Raw, b: Raw) -> Raw {
        zip(a, b, |x, y| mask(x as i8 > y as i8))
    }
    #[inline(always)]
    pub fn and(a: Raw, b: Raw) -> Raw {
        zip(a, b, |x, y| x & y)
    }
    #[inline(always)]
    pub fn or(a: Raw, b: Raw) -> Raw {
        zip(a, b, |x, y| x | y)
    }
    #[inline(always)]
    pub fn xor(a: Raw, b: Raw) -> Raw {
        zip(a, b, |x, y| x ^ y)
    }
    #[inline(always)]
    pub fn andnot(a: Raw, b: Raw) -> Raw {
        zip(a, b, |x, y| x & !y)
    }
    #[inline(always)]
    pub fn not(a: Raw) -> Raw {
        map(a, |x| !x)
    }
    #[inline(always)]
    pub fn sub(a: Raw, b: Raw) -> Raw {
        zip(a, b, u8::wrapping_sub)
    }
    #[inline(always)]
    pub fn add(a: Raw, b: Raw) -> Raw {
        zip(a, b, u8::wrapping_add)
    }
    #[inline(always)]
    pub fn shr<const N: i32>(a: Raw) -> Raw {
        map(a, |x| x >> N)
    }
    #[inline(always)]
    pub fn lookup(table: Raw, idx: Raw) -> Raw {
        map(idx, |i| if i < 16 { table[i as usize] } else { 0 })
    }
    #[inline(always)]
    pub fn any(a: Raw) -> bool {
        a.iter().any(|&x| x != 0)
    }
    #[inline(always)]
    pub fn bits(a: Raw) -> u32 {
        a.iter()
            .enumerate()
            .fold(0, |m, (i, &x)| m | ((x >> 7) as u32) << i)
    }
    pub const LANE_WIDTH: u32 = 1;
    pub const LANE_ALL: u64 = 0xffff;
    #[inline(always)]
    pub fn lanes(m: Raw) -> u64 {
        bits(m) as u64
    }
    #[inline(always)]
    pub fn first(m: Raw) -> usize {
        m.iter().position(|&x| x != 0).unwrap_or(16)
    }
    #[inline(always)]
    pub fn bits64(a: Raw, b: Raw, c: Raw, d: Raw) -> u64 {
        bits(a) as u64 | (bits(b) as u64) << 16 | (bits(c) as u64) << 32 | (bits(d) as u64) << 48
    }
}

#[cfg(test)]
mod tests {
    use super::{Lanes, V, array};

    /// Deterministic inputs: edge bytes and xorshift noise.
    fn inputs() -> Vec<[u8; 16]> {
        let mut out = vec![
            [0; 16],
            [0xff; 16],
            core::array::from_fn(|i| i as u8),
            core::array::from_fn(|i| (i * 17) as u8),
            core::array::from_fn(|i| 0x80 + i as u8),
            core::array::from_fn(|i| 15 + i as u8),
        ];
        let mut s = 0x9e37_79b9_7f4a_7c15u64;
        for _ in 0..2000 {
            out.push(core::array::from_fn(|_| {
                s ^= s << 13;
                s ^= s >> 7;
                s ^= s << 17;
                // Bias toward small values so table lookups hit both sides
                // of 16.
                if s & 3 == 0 {
                    (s >> 8) as u8 & 31
                } else {
                    (s >> 8) as u8
                }
            }));
        }
        out
    }

    /// A mask made from `a`: lanes with an odd value set.
    fn mask_of(a: [u8; 16]) -> [u8; 16] {
        a.map(|x| if x & 1 == 1 { 0xff } else { 0 })
    }

    #[test]
    fn every_operation_matches_the_array_backend() {
        let ins = inputs();
        for w in ins.windows(2) {
            let (x, y) = (w[0], w[1]);
            let (a, b) = (V::from_array(&x), V::from_array(&y));
            assert_eq!(a.eq(b).to_array(), array::eq(x, y), "eq");
            assert_eq!(a.le(b).to_array(), array::le(x, y), "le");
            assert_eq!(a.ge(b).to_array(), array::le(y, x), "ge");
            assert_eq!(a.lt(b).to_array(), array::not(array::le(y, x)), "lt");
            assert_eq!(a.gt(b).to_array(), array::not(array::le(x, y)), "gt");
            assert_eq!(
                a.gt_signed(b).to_array(),
                array::gt_signed(x, y),
                "gt_signed"
            );
            assert_eq!(a.and(b).to_array(), array::and(x, y), "and");
            assert_eq!(a.or(b).to_array(), array::or(x, y), "or");
            assert_eq!(a.xor(b).to_array(), array::xor(x, y), "xor");
            assert_eq!(a.andnot(b).to_array(), array::andnot(x, y), "andnot");
            assert_eq!(a.not().to_array(), array::not(x), "not");
            assert_eq!(a.sub(b).to_array(), array::sub(x, y), "sub");
            assert_eq!(a.add(b).to_array(), array::add(x, y), "add");
            assert_eq!(a.shr::<4>().to_array(), array::shr::<4>(x), "shr 4");
            assert_eq!(a.shr::<1>().to_array(), array::shr::<1>(x), "shr 1");
            assert_eq!(a.shr::<7>().to_array(), array::shr::<7>(x), "shr 7");
            assert_eq!(a.lookup(b).to_array(), array::lookup(x, y), "lookup");
            assert_eq!(a.any(), array::any(x), "any");
            assert_eq!(a.bits(), array::bits(x), "bits");
            assert_eq!(
                a.high().to_array(),
                x.map(|v| if v >= 0x80 { 0xff } else { 0 }),
                "high"
            );
            assert_eq!(
                a.test(b).to_array(),
                array::not(array::eq(array::and(x, y), [0; 16])),
                "test"
            );
            let (mx, my) = (mask_of(x), mask_of(y));
            let (ma, mb) = (V::from_array(&mx), V::from_array(&my));
            assert_eq!(ma.first(), array::first(mx), "first");
            let (la, lb) = (ma.lanes(), mb.lanes());
            assert_eq!(la.any(), mx.iter().any(|&v| v != 0), "lanes any");
            assert_eq!(la.first(), array::first(mx), "lanes first");
            let before = |m: [u8; 16]| -> [u8; 16] {
                let f = array::first(m);
                core::array::from_fn(|i| if i < f { 0xff } else { 0 })
            };
            assert_eq!(
                la.before_first(),
                V::from_array(&before(mx)).lanes(),
                "before_first"
            );
            assert_eq!(la.and(lb), ma.and(mb).lanes(), "lanes and");
            assert_eq!(la.or(lb), ma.or(mb).lanes(), "lanes or");
            assert_eq!(la.not(), ma.not().lanes(), "lanes not");
            let n = (y[0] % 17) as usize;
            let prefix: [u8; 16] = core::array::from_fn(|i| if i < n { 0xff } else { 0 });
            assert_eq!(Lanes::first_n(n), V::from_array(&prefix).lanes(), "first_n");
            let lane = (y[1] % 16) as usize;
            let mut cleared = mx;
            cleared[lane] = 0;
            assert_eq!(la.without(lane), V::from_array(&cleared).lanes(), "without");
            assert_eq!(
                V::bits64(ma, mb, ma.not(), mb.not()),
                array::bits64(mx, my, array::not(mx), array::not(my)),
                "bits64"
            );
        }
        assert_eq!(V::zero().first(), 16);
        assert!(!V::zero().any());
    }
}
