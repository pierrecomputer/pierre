//! Token records for the native lexers, written straight into
//! `inst.ext.recs` the way the translated `$emitTok` and `$emitGap` write
//! them: a token extends the last record when its color matches, and
//! whitespace extends the last record whatever its color.

use crate::Rec;
use crate::generated::Instance;
use crate::token_ids as tok;

/// Token records written straight into `inst.ext.recs`, which has room
/// for one record per input byte. The translated emitters that strings,
/// templates, and doc comments delegate to append to the same vector, so
/// [`Recs::store`] and [`Recs::load`] hand it over around those calls.
pub(crate) struct Recs {
    ptr: *mut Rec,
    n: usize,
    /// The vector's capacity.
    cap: usize,
    /// Token of the last record, or `u32::MAX` when there is none.
    last: u32,
}

impl Recs {
    pub(crate) fn load(inst: &mut Instance) -> Self {
        let v = &mut inst.ext.recs;
        Recs {
            ptr: v.as_mut_ptr(),
            n: v.len(),
            cap: v.capacity(),
            last: v.last().map_or(u32::MAX, |r| r.token),
        }
    }

    pub(crate) fn store(&self, inst: &mut Instance) {
        // SAFETY: records `..n` were written, within the reserved capacity.
        unsafe { inst.ext.recs.set_len(self.n) }
    }

    /// Append a non-empty token ending at `end`, merging it into the last
    /// record when the token matches (`$emitTok`). Every record covers at
    /// least one input byte and the vector has room for one per byte, so
    /// running out of room means a lexer bug, which traps.
    #[inline(always)]
    pub(crate) fn tok(&mut self, hl: u32, end: usize) {
        self.n -= (self.last == hl) as usize;
        if self.n == self.cap {
            crate::rt::trap();
        }
        // SAFETY: `n` is below the capacity.
        unsafe {
            self.ptr.add(self.n).write(Rec {
                end: end as u32,
                token: hl,
            })
        };
        self.n += 1;
        self.last = hl;
    }

    /// Whitespace `[lhs, rhs)` extends the last record (`$emitGap`).
    #[inline(always)]
    pub(crate) fn gap(&mut self, lhs: usize, rhs: usize) {
        if lhs >= rhs {
            return;
        }
        if self.n == 0 {
            self.tok(tok::NONE, rhs);
        } else {
            // SAFETY: `n - 1` is a written record.
            unsafe { (*self.ptr.add(self.n - 1)).end = rhs as u32 };
        }
    }
}
