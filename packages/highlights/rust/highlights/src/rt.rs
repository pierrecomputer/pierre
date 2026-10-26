//! Runtime support for the generated lexers: linear memory, the SIMD
//! operations the WAT uses, traps, and the host functions it imports.

pub const PAGE: usize = 65536;

mod region;

/// Abort on a wasm trap. The lexers never trap on valid input; reaching this
/// means a lexer broke one of its invariants.
#[cold]
#[inline(never)]
pub fn trap() -> ! {
    panic!("highlights: wasm trap")
}

/// Wasm linear memory. On Unix and Windows it lives in an address-space
/// reservation (see [`region`]) that covers every address a wasm access can
/// form, so memory never moves and an access past its end hits unmapped
/// pages instead of other data. Accesses are then unchecked unless the
/// `checked` feature is on. Elsewhere (wasm targets) memory is a `Vec` and
/// every access is bounds-checked.
pub struct Memory {
    region: region::Region,
    /// Where memory lives, kept in step with every resize. All access goes
    /// through this one pointer.
    view: MemView,
}

// SAFETY: `Memory` owns its region; `view` only points into it.
unsafe impl Send for Memory {}

/// The address (and, when accesses are checked, the length) of linear
/// memory. Each generated function copies it into a local, so the address
/// stays in a register instead of being reloaded from the `Instance` after
/// every call. The generated code refreshes it after anything that resizes
/// memory.
#[derive(Clone, Copy)]
pub struct MemView {
    base: *mut u8,
    #[cfg(any(feature = "checked", not(any(unix, windows))))]
    len: usize,
}

macro_rules! access {
    ($self:ident, $addr:ident, $off:ident, $n:expr) => {{
        let at = $addr as u32 as usize + $off as usize;
        #[cfg(any(feature = "checked", not(any(unix, windows))))]
        if at + $n > $self.len {
            trap();
        }
        at
    }};
}

impl Memory {
    pub fn new(pages: usize, init: &[u8; PAGE]) -> Self {
        let mut region = region::Region::new(pages * PAGE);
        let view = MemView::of(&mut region);
        let mut mem = Memory { region, view };
        mem.bytes_mut()[..PAGE].copy_from_slice(init);
        mem
    }

    /// The current address of memory, for a generated function's local.
    #[inline(always)]
    pub fn view(&self) -> MemView {
        self.view
    }

    #[inline(always)]
    pub fn bytes(&self) -> &[u8] {
        // SAFETY: `view` points at the region's `len` committed bytes.
        unsafe { core::slice::from_raw_parts(self.view.base, self.region.len()) }
    }

    #[inline(always)]
    pub fn bytes_mut(&mut self) -> &mut [u8] {
        // SAFETY: as in `bytes`, and `&mut self` makes this the only access.
        unsafe { core::slice::from_raw_parts_mut(self.view.base, self.region.len()) }
    }

    /// Grow to `pages` pages, zero-filling new ones.
    fn resize(&mut self, pages: usize) {
        self.region.commit(pages * PAGE);
        self.view = MemView::of(&mut self.region);
    }

    /// Grow so that at least `len` bytes are addressable.
    pub fn reserve(&mut self, len: usize) {
        if len > self.region.len() {
            self.resize(len.div_ceil(PAGE));
        }
    }

    #[inline(always)]
    pub fn pages(&self) -> i32 {
        (self.region.len() / PAGE) as i32
    }

    pub fn grow(&mut self, delta: i32) -> i32 {
        let old = self.pages();
        let new = old as usize + delta as u32 as usize;
        if new > MAX_PAGES {
            return -1;
        }
        self.resize(new);
        old
    }

    /// `memory.copy`. Copies through the raw address rather than a slice of
    /// all memory, so it doesn't claim the bytes a native lexer is reading.
    #[inline(always)]
    pub fn copy(&mut self, dst: i32, src: i32, n: i32) {
        let (dst, src, n) = (dst as u32 as usize, src as u32 as usize, n as u32 as usize);
        if dst.max(src) + n > self.region.len() {
            trap();
        }
        // SAFETY: both ranges are inside committed memory (checked above).
        unsafe { core::ptr::copy(self.view.ptr(src), self.view.ptr(dst), n) }
    }

    /// `memory.fill`, through the raw address like [`Memory::copy`].
    #[inline(always)]
    pub fn fill(&mut self, dst: i32, v: i32, n: i32) {
        let (dst, n) = (dst as u32 as usize, n as u32 as usize);
        if dst + n > self.region.len() {
            trap();
        }
        // SAFETY: the range is inside committed memory (checked above).
        unsafe { core::ptr::write_bytes(self.view.ptr(dst), v as u8, n) }
    }
}

/// The most pages wasm32 memory can have (4 GiB).
const MAX_PAGES: usize = 65536;

impl MemView {
    fn of(region: &mut region::Region) -> Self {
        MemView {
            base: region.base(),
            #[cfg(any(feature = "checked", not(any(unix, windows))))]
            len: region.len(),
        }
    }

    #[inline(always)]
    fn ptr(self, at: usize) -> *mut u8 {
        // SAFETY: `at` is at most a 32-bit address plus a 32-bit offset,
        // inside the reservation (or bounds-checked; see `Memory`).
        unsafe { self.base.add(at) }
    }

    #[inline(always)]
    pub fn ld_u8(self, addr: i32, off: u64) -> i32 {
        let at = access!(self, addr, off, 1);
        unsafe { *self.ptr(at) as i32 }
    }

    #[inline(always)]
    pub fn ld_s8(self, addr: i32, off: u64) -> i32 {
        let at = access!(self, addr, off, 1);
        unsafe { *self.ptr(at) as i8 as i32 }
    }

    #[inline(always)]
    pub fn ld_u16(self, addr: i32, off: u64) -> i32 {
        let at = access!(self, addr, off, 2);
        unsafe { u16::from_le(self.ptr(at).cast::<u16>().read_unaligned()) as i32 }
    }

    #[inline(always)]
    pub fn ld_s16(self, addr: i32, off: u64) -> i32 {
        let at = access!(self, addr, off, 2);
        unsafe { i16::from_le(self.ptr(at).cast::<i16>().read_unaligned()) as i32 }
    }

    #[inline(always)]
    pub fn ld_i32(self, addr: i32, off: u64) -> i32 {
        let at = access!(self, addr, off, 4);
        unsafe { i32::from_le(self.ptr(at).cast::<i32>().read_unaligned()) }
    }

    #[inline(always)]
    pub fn ld_i64(self, addr: i32, off: u64) -> i64 {
        let at = access!(self, addr, off, 8);
        unsafe { i64::from_le(self.ptr(at).cast::<i64>().read_unaligned()) }
    }

    #[inline(always)]
    pub fn ld_v128(self, addr: i32, off: u64) -> V128 {
        let at = access!(self, addr, off, 16);
        unsafe { v_load(self.ptr(at)) }
    }

    #[inline(always)]
    pub fn st_i8(self, addr: i32, off: u64, v: i32) {
        let at = access!(self, addr, off, 1);
        unsafe { *self.ptr(at) = v as u8 }
    }

    #[inline(always)]
    pub fn st_i16(self, addr: i32, off: u64, v: i32) {
        let at = access!(self, addr, off, 2);
        unsafe {
            self.ptr(at)
                .cast::<u16>()
                .write_unaligned((v as u16).to_le())
        }
    }

    #[inline(always)]
    pub fn st_i32(self, addr: i32, off: u64, v: i32) {
        let at = access!(self, addr, off, 4);
        unsafe { self.ptr(at).cast::<i32>().write_unaligned(v.to_le()) }
    }

    #[inline(always)]
    pub fn st_i64(self, addr: i32, off: u64, v: i64) {
        let at = access!(self, addr, off, 8);
        unsafe { self.ptr(at).cast::<i64>().write_unaligned(v.to_le()) }
    }

    #[inline(always)]
    pub fn st_v128(self, addr: i32, off: u64, v: V128) {
        let at = access!(self, addr, off, 16);
        unsafe { v_store(self.ptr(at), v) }
    }

    #[inline(always)]
    pub fn ld_u8_l(self, addr: i32, off: u64) -> i64 {
        self.ld_u8(addr, off) as i64
    }

    #[inline(always)]
    pub fn ld_u16_l(self, addr: i32, off: u64) -> i64 {
        self.ld_u16(addr, off) as i64
    }

    #[inline(always)]
    pub fn ld_u32_l(self, addr: i32, off: u64) -> i64 {
        self.ld_i32(addr, off) as u32 as i64
    }

    #[inline(always)]
    pub fn st_i8_l(self, addr: i32, off: u64, v: i64) {
        self.st_i8(addr, off, v as i32)
    }

    #[inline(always)]
    pub fn st_i16_l(self, addr: i32, off: u64, v: i64) {
        self.st_i16(addr, off, v as i32)
    }

    #[inline(always)]
    pub fn st_i32_l(self, addr: i32, off: u64, v: i64) {
        self.st_i32(addr, off, v as i32)
    }
}

// ---------------------------------------------------------------------------
// SIMD: the i8x16 subset the translated lexers use, on the shared backends
// in `crate::simd`.

pub type V128 = crate::simd::V;

#[inline(always)]
pub fn v_zero() -> V128 {
    V128::zero()
}
/// # Safety
/// `p..p + 16` must be readable.
#[inline(always)]
pub unsafe fn v_load(p: *const u8) -> V128 {
    unsafe { V128::load(p) }
}
/// # Safety
/// `p..p + 16` must be writable.
#[inline(always)]
pub unsafe fn v_store(p: *mut u8, v: V128) {
    unsafe { v.store(p) }
}
#[inline(always)]
pub fn v_splat(x: i32) -> V128 {
    V128::splat(x as u8)
}
#[inline(always)]
pub fn v_eq(a: V128, b: V128) -> V128 {
    a.eq(b)
}
#[inline(always)]
pub fn v_ne(a: V128, b: V128) -> V128 {
    a.ne(b)
}
#[inline(always)]
pub fn v_ge_u(a: V128, b: V128) -> V128 {
    a.ge(b)
}
#[inline(always)]
pub fn v_le_u(a: V128, b: V128) -> V128 {
    a.le(b)
}
#[inline(always)]
pub fn v_gt_s(a: V128, b: V128) -> V128 {
    a.gt_signed(b)
}
#[inline(always)]
pub fn v_sub(a: V128, b: V128) -> V128 {
    a.sub(b)
}
#[inline(always)]
pub fn v_and(a: V128, b: V128) -> V128 {
    a.and(b)
}
#[inline(always)]
pub fn v_or(a: V128, b: V128) -> V128 {
    a.or(b)
}
#[inline(always)]
pub fn v_xor(a: V128, b: V128) -> V128 {
    a.xor(b)
}
#[inline(always)]
pub fn v_any_true(a: V128) -> i32 {
    a.any() as i32
}
#[inline(always)]
pub fn v_const(x: u128) -> V128 {
    V128::from_array(&x.to_le_bytes())
}
// Part of the translator's operation set, though the current WAT has no use for it.
#[allow(dead_code)]
#[inline(always)]
pub fn v_not(a: V128) -> V128 {
    a.not()
}
// Part of the translator's operation set, though the current WAT has no use for it.
#[allow(dead_code)]
#[inline(always)]
pub fn v_andnot(a: V128, b: V128) -> V128 {
    a.andnot(b)
}
/// One bit per lane from each lane's top bit, like `i8x16.bitmask`.
#[inline(always)]
pub fn v_bitmask(a: V128) -> i32 {
    a.bits() as i32
}

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
