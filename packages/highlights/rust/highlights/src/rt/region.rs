//! The memory behind wasm linear memory.
//!
//! On Unix and Windows, a [`Region`] reserves address space for every
//! address a wasm access can form: a 32-bit address plus a 32-bit static
//! offset plus a 16-byte access. Only the committed prefix is readable and
//! writable; the rest is unmapped, so a stray access faults instead of
//! touching other data. Growing commits more of the reservation in place,
//! so memory never moves.
//!
//! Wasm targets can't reserve address space; there a `Vec` holds memory,
//! growing moves it, and every access is bounds-checked (see `access!`).

#[cfg(any(unix, windows))]
use super::PAGE;

/// Address space reserved per memory: any 32-bit address plus any 32-bit
/// offset (8 GiB), plus room for the widest access. Only committed pages
/// use physical memory.
#[cfg(any(unix, windows))]
const RESERVE: usize = (1 << 33) + PAGE;

/// The most bytes that can be committed: wasm32's 4 GiB.
#[cfg(any(unix, windows))]
const MAX_LEN: usize = 1 << 32;

#[cfg(unix)]
pub(super) struct Region {
    base: *mut u8,
    len: usize,
}

#[cfg(unix)]
impl Region {
    /// Reserve the address space and commit the first `len` bytes.
    pub(super) fn new(len: usize) -> Region {
        // SAFETY: a fresh private anonymous mapping, at no fixed address.
        let base = unsafe {
            libc::mmap(
                core::ptr::null_mut(),
                RESERVE,
                libc::PROT_NONE,
                libc::MAP_PRIVATE | libc::MAP_ANON | libc::MAP_NORESERVE,
                -1,
                0,
            )
        };
        if base == libc::MAP_FAILED {
            panic!("highlights: cannot reserve lexer memory");
        }
        let mut region = Region {
            base: base.cast(),
            len: 0,
        };
        region.commit(len);
        region
    }

    /// Make the first `len` bytes readable and writable. New bytes read as
    /// zero (fresh anonymous pages).
    pub(super) fn commit(&mut self, len: usize) {
        assert!(len <= MAX_LEN);
        if len <= self.len {
            return;
        }
        // SAFETY: `[self.len, len)` lies inside this region's reservation,
        // and `self.len` is a multiple of the wasm page size, so of the OS
        // page size.
        let ok = unsafe {
            libc::mprotect(
                self.base.add(self.len).cast(),
                len - self.len,
                libc::PROT_READ | libc::PROT_WRITE,
            )
        };
        if ok != 0 {
            panic!("highlights: cannot commit lexer memory");
        }
        self.len = len;
    }

    pub(super) fn base(&mut self) -> *mut u8 {
        self.base
    }

    pub(super) fn len(&self) -> usize {
        self.len
    }
}

#[cfg(unix)]
impl Drop for Region {
    fn drop(&mut self) {
        // SAFETY: the reservation made in `new`, unmapped once.
        unsafe { libc::munmap(self.base.cast(), RESERVE) };
    }
}

#[cfg(windows)]
mod win {
    use core::ffi::c_void;

    pub(super) const MEM_COMMIT: u32 = 0x1000;
    pub(super) const MEM_RESERVE: u32 = 0x2000;
    pub(super) const MEM_RELEASE: u32 = 0x8000;
    pub(super) const PAGE_NOACCESS: u32 = 0x01;
    pub(super) const PAGE_READWRITE: u32 = 0x04;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        pub(super) fn VirtualAlloc(
            address: *mut c_void,
            size: usize,
            kind: u32,
            protect: u32,
        ) -> *mut c_void;
        pub(super) fn VirtualFree(address: *mut c_void, size: usize, kind: u32) -> i32;
    }
}

#[cfg(windows)]
pub(super) struct Region {
    base: *mut u8,
    len: usize,
}

#[cfg(windows)]
impl Region {
    /// Reserve the address space and commit the first `len` bytes.
    pub(super) fn new(len: usize) -> Region {
        // SAFETY: a fresh reservation at no fixed address.
        let base = unsafe {
            win::VirtualAlloc(
                core::ptr::null_mut(),
                RESERVE,
                win::MEM_RESERVE,
                win::PAGE_NOACCESS,
            )
        };
        if base.is_null() {
            panic!("highlights: cannot reserve lexer memory");
        }
        let mut region = Region {
            base: base.cast(),
            len: 0,
        };
        region.commit(len);
        region
    }

    /// Make the first `len` bytes readable and writable. New bytes read as
    /// zero (freshly committed pages).
    pub(super) fn commit(&mut self, len: usize) {
        assert!(len <= MAX_LEN);
        if len <= self.len {
            return;
        }
        // SAFETY: `[self.len, len)` lies inside this region's reservation.
        let at = unsafe {
            win::VirtualAlloc(
                self.base.add(self.len).cast(),
                len - self.len,
                win::MEM_COMMIT,
                win::PAGE_READWRITE,
            )
        };
        if at.is_null() {
            panic!("highlights: cannot commit lexer memory");
        }
        self.len = len;
    }

    pub(super) fn base(&mut self) -> *mut u8 {
        self.base
    }

    pub(super) fn len(&self) -> usize {
        self.len
    }
}

#[cfg(windows)]
impl Drop for Region {
    fn drop(&mut self) {
        // SAFETY: the reservation made in `new`, released once.
        unsafe { win::VirtualFree(self.base.cast(), 0, win::MEM_RELEASE) };
    }
}

#[cfg(not(any(unix, windows)))]
pub(super) struct Region {
    buf: Vec<u8>,
}

#[cfg(not(any(unix, windows)))]
impl Region {
    pub(super) fn new(len: usize) -> Region {
        Region { buf: vec![0; len] }
    }

    /// Grow to `len` bytes, zero-filling. This may move memory.
    pub(super) fn commit(&mut self, len: usize) {
        if len > self.buf.len() {
            self.buf.resize(len, 0);
        }
    }

    pub(super) fn base(&mut self) -> *mut u8 {
        self.buf.as_mut_ptr()
    }

    pub(super) fn len(&self) -> usize {
        self.buf.len()
    }
}
