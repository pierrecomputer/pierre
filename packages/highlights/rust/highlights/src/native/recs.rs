//! Token records for the native lexers, written straight into
//! `inst.ext.recs` the way the translated `$emitTok` and `$emitGap` write
//! them: a token extends the last record when its color matches, and
//! whitespace extends the last record whatever its color.

use crate::Rec;
use crate::generated::Instance;
use crate::token_ids as tok;

/// Token records written straight into `inst.ext.recs`, which has room
/// for one record per input byte, through a moving pointer. Hold it in a
/// local and pass it by value (or `&mut` to a local copy) so it stays in
/// registers. The translated emitters that strings, templates, and doc
/// comments may delegate to append to the same vector, so [`Recs::store`]
/// and [`Recs::load`] hand it over around those calls.
///
/// It is three machine words, which stay in registers across calls; a
/// fourth (such as a start pointer) gets spilled and reloaded around them.
#[derive(Clone, Copy)]
pub(crate) struct Recs {
    /// One past the last written record.
    cur: *mut Rec,
    /// One past the vector's capacity.
    limit: *mut Rec,
    /// Token of the last record, or `u32::MAX` when there is none.
    last: u32,
}

impl Recs {
    pub(crate) fn load(inst: &mut Instance) -> Self {
        let v = &mut inst.ext.recs;
        let start = v.as_mut_ptr();
        // SAFETY: `len` and `capacity` stay within the allocation, or one
        // past its end.
        let (cur, limit) = unsafe { (start.add(v.len()), start.add(v.capacity())) };
        Recs {
            cur,
            limit,
            last: v.last().map_or(u32::MAX, |r| r.token),
        }
    }

    /// Hand the records written so far back to `inst.ext.recs`.
    pub(crate) fn store(self, inst: &mut Instance) {
        let v = &mut inst.ext.recs;
        // SAFETY: `cur` was derived from this vector's buffer, which has not
        // moved since `load`, and the records before it are written, within
        // the capacity.
        unsafe { v.set_len(self.cur.offset_from(v.as_ptr()) as usize) }
    }

    /// Whether no record is written yet: `last` names the last record's
    /// token whenever one exists.
    #[inline(always)]
    pub(crate) fn is_empty(self) -> bool {
        self.last == u32::MAX
    }

    /// Append a non-empty token ending at `end`, merging it into the last
    /// record when the token matches (`$emitTok`). Every record covers at
    /// least one input byte and the vector has room for one per byte, so
    /// running out of room means a lexer bug, which traps.
    #[inline(always)]
    pub(crate) fn tok(&mut self, hl: u32, end: usize) {
        // SAFETY: a merge steps back onto the last record, which exists
        // whenever `last` matches a token; the write is below `limit`.
        unsafe {
            self.cur = self.cur.sub((self.last == hl) as usize);
            if self.cur == self.limit {
                crate::rt::trap();
            }
            self.cur.write(Rec {
                end: end as u32,
                token: hl,
            });
            self.cur = self.cur.add(1);
        }
        self.last = hl;
    }

    /// [`Recs::tok`] deciding the merge with a branch instead of stepping
    /// back: cheaper where merges are rare and the branch predicts well.
    #[inline(always)]
    pub(crate) fn tok_branching(&mut self, hl: u32, end: usize) {
        if self.last == hl {
            self.extend(end);
        } else {
            self.push(hl, end);
        }
    }

    /// Append a record for a token known to differ from the last one, so no
    /// merge is possible (a delimiter after a token of another color). A
    /// matching token would leave two records where `tok` writes one,
    /// which parity catches; debug builds assert it.
    #[inline(always)]
    pub(crate) fn push(&mut self, hl: u32, end: usize) {
        debug_assert!(self.last != hl);
        if self.cur == self.limit {
            crate::rt::trap();
        }
        // SAFETY: `cur` is below `limit` (checked above).
        unsafe {
            self.cur.write(Rec {
                end: end as u32,
                token: hl,
            });
            self.cur = self.cur.add(1);
        }
        self.last = hl;
    }

    /// The token `[lhs, rhs)`, skipped when empty (`$emitTok`).
    #[inline(always)]
    pub(crate) fn emit(&mut self, hl: u32, lhs: usize, rhs: usize) {
        if lhs < rhs {
            self.tok(hl, rhs);
        }
    }

    /// Move the last record's end to `end`: whitespace or a continuation
    /// joining it. There must be a record; with none, this traps.
    #[inline(always)]
    pub(crate) fn extend(&mut self, end: usize) {
        if self.is_empty() {
            crate::rt::trap();
        }
        // SAFETY: the record before `cur` is written.
        unsafe { (*self.cur.sub(1)).end = end as u32 };
    }

    /// [`Recs::extend`] without the check, for a hot path where a record
    /// always exists.
    ///
    /// # Safety
    /// A record must be written.
    #[inline(always)]
    pub(crate) unsafe fn extend_unchecked(&mut self, end: usize) {
        debug_assert!(!self.is_empty());
        // SAFETY: the caller guarantees the record before `cur`.
        unsafe { (*self.cur.sub(1)).end = end as u32 };
    }

    /// Whitespace `[lhs, rhs)` extends the last record, or starts a `none`
    /// record when there is none (`$emitGap`).
    #[inline(always)]
    pub(crate) fn gap(&mut self, lhs: usize, rhs: usize) {
        if lhs >= rhs {
            return;
        }
        if self.is_empty() {
            self.tok(tok::NONE, rhs);
        } else {
            self.extend(rhs);
        }
    }
}
