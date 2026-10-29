//! The input as a native lexer reads it: `len` bytes, then a NUL and the
//! rest of the slack, all readable. Reads are bounds-checked against that
//! whole range; the `_unchecked` twins skip the check in release builds and
//! assert it in builds with debug assertions (the checked fuzz build).

use crate::generated::Instance;
use crate::simd::V;

/// Readable bytes past the input: a NUL, then slack (`INPUT_SLACK`).
pub(crate) const SLACK: usize = 96;

/// The lexer's input, `len` bytes plus [`SLACK`]. Only the slice is
/// stored, so `Input` is two machine words and passes in registers like a
/// plain `&[u8]`, keeping the slice's no-aliasing guarantee: with a third
/// field, the compiler re-reads input bytes after every record write.
#[derive(Clone, Copy)]
pub(crate) struct Input<'a> {
    bytes: &'a [u8],
}

impl<'a> Input<'a> {
    /// The input of `len` bytes at `base` in lexer memory. The slice does
    /// not borrow `inst`, so the lexer can still call translated functions.
    /// On Unix and Windows lexer memory never moves (see `rt::Memory`), so
    /// the slice stays valid across those calls.
    ///
    /// # Safety
    /// The result must not outlive the lexer call, and the input bytes must
    /// not change while it is used. On wasm targets, where growing memory
    /// moves it, it must not be used after a call into translated code that
    /// may grow memory.
    #[inline(always)]
    pub(crate) unsafe fn new(inst: &Instance, base: usize, len: usize) -> Input<'a> {
        let mem = inst.mem.bytes();
        assert!(base + len + SLACK <= mem.len());
        // SAFETY: in bounds (checked above); the caller keeps memory in place
        // for as long as the slice is used.
        let bytes = unsafe { core::slice::from_raw_parts(mem.as_ptr().add(base), len + SLACK) };
        Input { bytes }
    }

    /// The input bytes, without the slack.
    #[inline(always)]
    pub(crate) fn len(self) -> usize {
        self.bytes.len() - SLACK
    }

    /// Every readable byte: the input, then the slack.
    #[inline(always)]
    pub(crate) fn bytes(self) -> &'a [u8] {
        self.bytes
    }

    /// The byte at `i` (the NUL at `len`, slack after it).
    #[inline(always)]
    pub(crate) fn byte(self, i: usize) -> u8 {
        self.bytes[i]
    }

    /// The 8 bytes at `i` as a little-endian integer.
    #[inline(always)]
    pub(crate) fn word(self, i: usize) -> u64 {
        u64::from_le_bytes(self.bytes[i..i + 8].try_into().unwrap())
    }

    /// The 16 bytes at `i`.
    #[inline(always)]
    pub(crate) fn vec(self, i: usize) -> V {
        V::from_array(self.bytes[i..i + 16].try_into().unwrap())
    }

    /// [`Input::byte`] without the bounds check.
    ///
    /// # Safety
    /// `i` must be below `len + SLACK`.
    #[inline(always)]
    pub(crate) unsafe fn byte_unchecked(self, i: usize) -> u8 {
        debug_assert!(i < self.bytes.len());
        unsafe { *self.bytes.get_unchecked(i) }
    }

    /// [`Input::word`] without the bounds check.
    ///
    /// # Safety
    /// `i + 8` must be at most `len + SLACK`.
    #[inline(always)]
    pub(crate) unsafe fn word_unchecked(self, i: usize) -> u64 {
        debug_assert!(i + 8 <= self.bytes.len());
        unsafe { u64::from_le(self.bytes.as_ptr().add(i).cast::<u64>().read_unaligned()) }
    }

    /// [`Input::vec`] without the bounds check.
    ///
    /// # Safety
    /// `i + 16` must be at most `len + SLACK`.
    #[inline(always)]
    pub(crate) unsafe fn vec_unchecked(self, i: usize) -> V {
        debug_assert!(i + 16 <= self.bytes.len());
        unsafe { V::load(self.bytes.as_ptr().add(i)) }
    }
}
