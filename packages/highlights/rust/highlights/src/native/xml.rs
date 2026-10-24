//! WAT sources: src/langs/xml.wat src/common.wat src/scan.wat
//!
//! Native XML lexer. One pass over the input: text up to the next `<` or
//! `&`, entities, comments, CDATA sections, processing instructions, the
//! doctype with its internal subset, and tags with their attributes. Names
//! are emitted verbatim, so case and HTML's raw-text rules never matter.
//! The records equal the translated `xml` lexer's records.

use super::Lexer;
use super::scan;
use crate::Rec;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;

/// The lexer for each language this module handles.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "xml" => Some(highlight),
        _ => None,
    }
}

/// The byte at `p`.
#[inline(always)]
fn at(src: &[u8], p: usize) -> u8 {
    debug_assert!(p < src.len());
    // SAFETY: every position read lies at most 16 bytes past the input
    // end, inside the input slack `src` covers.
    unsafe { *src.get_unchecked(p) }
}

/// Whether `c` is ASCII whitespace (`$lexIsSpace`).
#[inline(always)]
const fn is_space(c: u8) -> bool {
    c == 32 || c.wrapping_sub(9) <= 4
}

/// Whether `c` continues an identifier: a letter, digit, `_`, `$`, or any
/// byte from 128 (`$lexIsIdentContinue`).
#[inline(always)]
const fn is_ident_continue(c: u8) -> bool {
    c >= 0x80
        || (c | 32).wrapping_sub(b'a') <= 25
        || c.wrapping_sub(b'0') <= 9
        || c == b'_'
        || c == b'$'
}

/// Whether `c` starts an XML name: a letter, `_`, `:`, or any byte from
/// 128 (`$xmlNameStart`).
#[inline(always)]
const fn is_name_start(c: u8) -> bool {
    c >= 0x80 || (c | 32).wrapping_sub(b'a') <= 25 || c == b'_' || c == b':'
}

/// Token records written through a moving pointer into `inst.ext.recs`,
/// the way the translated `$emitTok` and `$emitGap` write them: a token
/// extends the last record when its color matches, and whitespace extends
/// the last record whatever its color. The vector has room for one record
/// per input byte and every record covers at least one byte, so running
/// out of room means a lexer bug, which traps.
#[derive(Clone, Copy)]
struct Out {
    cur: *mut Rec,
    limit: *mut Rec,
    /// Token of the last record, or `u32::MAX` when there is none.
    last: u32,
}

impl Out {
    /// Append a non-empty token ending at `end` (`$emitTok`).
    #[inline(always)]
    fn tok(&mut self, hl: u32, end: usize) {
        if self.last == hl {
            // SAFETY: a record with the last color exists.
            unsafe { self.extend(end) };
            return;
        }
        // SAFETY: the trap stops a write at the limit.
        unsafe {
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

    /// The token `[lhs, rhs)`, if not empty (`$emitTok`).
    #[inline(always)]
    fn span(&mut self, hl: u32, lhs: usize, rhs: usize) {
        if lhs < rhs {
            self.tok(hl, rhs);
        }
    }

    /// Whitespace up to `end` extends the last record (`$emitGap`).
    ///
    /// # Safety
    ///
    /// A record must exist.
    #[inline(always)]
    unsafe fn extend(&mut self, end: usize) {
        // SAFETY: the caller guarantees the record before `cur`.
        unsafe { (*self.cur.sub(1)).end = end as u32 };
    }
}

/// The first `a` or `b` from `p`, or `end` (`$lexFindEither`,
/// `$lexFindByte` when `a` and `b` are equal, `$scanFind3`).
#[inline(always)]
fn find2(src: &[u8], p: usize, end: usize, a: u8, b: u8) -> usize {
    if p >= end {
        return end;
    }
    scan::find3(src, p, end, a, b, b)
}

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run by the input end.
#[inline(always)]
fn space_end(src: &[u8], mut p: usize) -> usize {
    while is_space(at(src, p)) {
        p += 1;
    }
    p
}

/// XML name bytes: letters, digits, `_`, `-`, `.`, `:`, and any byte from
/// 128 (`$xmlScanName`).
static NAME: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = (is_ident_continue(b) && b != b'$') || b == b'-' || b == b'.' || b == b':';
        c += 1;
    }
    t
};

/// The end of an XML name from `p`: identifier bytes and `-`, with `.`
/// and `:` (`$xmlScanName`, `$scanIdentRun`). The NUL after the input ends
/// every name by the input end.
#[inline(always)]
fn name_end(src: &[u8], mut p: usize) -> usize {
    while NAME[at(src, p) as usize] {
        p += 1;
    }
    p
}

/// The rest of a quoted attribute value from `p` to its closing `quote`,
/// emitted from `lhs` as one string; returns its end (`$xmlQuotedBody`).
#[inline(always)]
fn quoted_body(src: &[u8], end: usize, out: &mut Out, quote: u8, lhs: usize, p: usize) -> usize {
    let q = find2(src, p, end, quote, quote);
    let p = if q < end { q + 1 } else { end };
    out.span(tok::STRING, lhs, p);
    p
}

/// A comment, CDATA section, or processing instruction at `lhs`, its
/// opener of `skip` bytes recognized, up to just past the first `>` that
/// ends `close` (`-->`, `]]>`, or `?>`, the opener's bytes included), or
/// the end. Returns its end, the end of its one token (`$xmlSection`).
fn section(src: &[u8], end: usize, lhs: usize, skip: usize, close: &[u8]) -> usize {
    let mut p = (lhs + skip).min(end);
    let n = close.len();
    loop {
        p = find2(src, p, end, b'>', b'>');
        if p >= end {
            break;
        }
        if &src[p + 1 - n..=p] == close {
            p += 1;
            break;
        }
        p += 1;
    }
    p
}

/// A doctype's body from `p`, after its `<!`: up to the first `>` outside
/// quotes and the `[ ]` internal subset, or the end. Returns its end, the
/// end of the doctype's one token (`$xmlDoctype`, `$xmlDoctypeBody`).
fn doctype(src: &[u8], end: usize, mut p: usize) -> usize {
    let mut depth = 0u32;
    let mut quote = 0u8;
    while p < end {
        if quote != 0 {
            p = find2(src, p, end, quote, quote);
            if p >= end {
                break;
            }
            quote = 0;
            p += 1;
            continue;
        }
        // The next `[`, `]`, `>`, or quote.
        let stop = find2(src, p, end, b'[', b']').min(find2(src, p, end, b'>', b'>'));
        let q = find2(src, p, end, b'"', b'\'');
        p = stop.min(q);
        if p >= end {
            break;
        }
        let c = at(src, p);
        p += 1;
        match c {
            b'"' | b'\'' => quote = c,
            b'[' => depth += 1,
            b']' => depth = depth.saturating_sub(1),
            // `>` closes only outside the internal subset.
            _ => {
                if depth == 0 {
                    break;
                }
            }
        }
    }
    p.min(end)
}

/// An entity at the `&` at `lhs`: up to 32 bytes of identifier bytes or
/// `#`, then `;`. Returns its end, or `None` when it is no entity
/// (`$xmlEntity`).
#[inline(always)]
fn entity(src: &[u8], end: usize, lhs: usize) -> Option<usize> {
    let mut p = lhs + 1;
    loop {
        if p >= end || p - lhs > 32 {
            return None;
        }
        let c = at(src, p);
        if c == b';' {
            if p == lhs + 1 {
                return None;
            }
            return Some(p + 1);
        }
        if !(is_ident_continue(c) || c == b'#') {
            return None;
        }
        p += 1;
    }
}

/// First-byte kinds of the attribute rules, one bit each; bytes of kind 0
/// start a malformed unquoted value.
const K_NAME: u8 = 1;
const K_SPACE: u8 = 2;
const K_QUOTE: u8 = 4;
const K_EQ: u8 = 8;
const K_GT: u8 = 16;
const K_SLASH: u8 = 32;
const K_LT: u8 = 64;

/// The attribute-rule kind of every byte.
static KIND: [u8; 256] = {
    let mut t = [0u8; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = if is_name_start(b) {
            K_NAME
        } else if is_space(b) {
            K_SPACE
        } else {
            match b {
                b'"' | b'\'' => K_QUOTE,
                b'=' => K_EQ,
                b'>' => K_GT,
                b'/' => K_SLASH,
                b'<' => K_LT,
                _ => 0,
            }
        };
        c += 1;
    }
    t
};

/// The attributes after a tag name at `p`, up to and including `>` or
/// `/>`, or up to a stray `<` or the end. Returns the end (`$xmlAttrs`
/// with no quote left open). The rules match disjoint first bytes, so they
/// are tested by kind, the common ones first.
fn attrs(src: &[u8], end: usize, win: &Window, out: &mut Out, mut p: usize) -> usize {
    loop {
        if p >= end {
            return p;
        }
        let lhs = p;
        let c = at(src, p);
        let k = KIND[c as usize];
        if k & K_NAME != 0 {
            p = win.name_end(src, p);
            out.tok(tok::ATTRIBUTE, p);
            // `name="value"`: the `=` and quote rules below, taken here.
            // The NUL after the input matches neither.
            if at(src, p) == b'=' {
                p += 1;
                out.tok(tok::PUNCTUATION_DELIMITER_HTML, p);
                let q = at(src, p);
                if q == b'"' || q == b'\'' {
                    p = quoted_body(src, end, out, q, p, p + 1);
                    // The tag's `>` often follows: its rule below.
                    if at(src, p) == b'>' {
                        p += 1;
                        out.tok(tok::PUNCTUATION_BRACKET_HTML, p);
                        return p;
                    }
                }
            }
            continue;
        }
        if k & K_SPACE != 0 {
            p = space_end(src, p);
            // SAFETY: the tag name's record exists.
            unsafe { out.extend(p) };
            continue;
        }
        if k & K_GT != 0 {
            p += 1;
            out.tok(tok::PUNCTUATION_BRACKET_HTML, p);
            return p;
        }
        if k & K_SLASH != 0 && p + 1 < end && at(src, p + 1) == b'>' {
            p += 2;
            out.tok(tok::PUNCTUATION_BRACKET_HTML, p);
            return p;
        }
        if k & K_EQ != 0 {
            p += 1;
            out.tok(tok::PUNCTUATION_DELIMITER_HTML, p);
            continue;
        }
        if k & K_QUOTE != 0 {
            p = quoted_body(src, end, out, c, lhs, p + 1);
            continue;
        }
        // A stray `<` starts the next tag: a tag that never closed ends
        // here.
        if k & K_LT != 0 {
            return p;
        }
        // A malformed unquoted attribute value or stray punctuation.
        p += 1;
        while p < end {
            let c = at(src, p);
            if is_space(c) || c == b'>' || c == b'<' {
                break;
            }
            p += 1;
        }
        out.tok(tok::STRING, p);
    }
}

/// Name bytes as two nibble tables: byte `b` is one when
/// `NAME_HI[b >> 4] & NAME_LO[b & 15]` is nonzero. Bits: 1 for `-` and
/// `.`, 2 for digits and `:`, 4 for `A`-`O` and `a`-`o`, 8 for `P`-`Z` and
/// `p`-`z`, 16 for `_`, 32 for bytes from 128.
const NAME_HI: [u8; 16] = [0, 0, 1, 2, 4, 8 | 16, 4, 8, 32, 32, 32, 32, 32, 32, 32, 32];
const NAME_LO: [u8; 16] = {
    let mut t = [0u8; 16];
    let mut l = 0;
    while l < 16 {
        let mut m = 32;
        if l == 13 || l == 14 {
            m |= 1;
        }
        if l <= 10 {
            m |= 2 | 8;
        }
        if l >= 1 {
            m |= 4;
        }
        if l == 15 {
            m |= 16;
        }
        t[l] = m;
        l += 1;
    }
    t
};

/// The masks of the bytes that end text (`<` and `&`) and of the bytes
/// that are not name bytes among the 64 bytes from `b`, one bit per byte.
/// `b + 64` must lie inside the input slack.
#[inline(always)]
fn block_masks(src: &[u8], b: usize) -> (u64, u64) {
    debug_assert!(b + 64 <= src.len());
    let hi_t = V::from_array(&NAME_HI);
    let lo_t = V::from_array(&NAME_LO);
    let mut stop = [V::zero(); 4];
    let mut name = [V::zero(); 4];
    for i in 0..4 {
        // SAFETY: the caller keeps the 64 bytes from `b` inside the slack.
        let v = unsafe { V::load(src.as_ptr().add(b + 16 * i)) };
        stop[i] = v.eq(V::splat(b'<')).or(v.eq(V::splat(b'&')));
        let class = hi_t
            .lookup(v.shr::<4>())
            .and(lo_t.lookup(v.and(V::splat(15))));
        name[i] = class.test(class);
    }
    (
        V::bits64(stop[0], stop[1], stop[2], stop[3]),
        !V::bits64(name[0], name[1], name[2], name[3]),
    )
}

/// Bit masks of two adjacent 64-byte blocks of the input, the second
/// starting at `mid`: the bytes that end text, and the bytes that are not
/// name bytes. Finding the end of text or of a name is a shift and a bit
/// count, so the next token's start does not wait on a scan of the bytes
/// before it.
#[derive(Clone, Copy)]
struct Window {
    mid: usize,
    stop0: u64,
    other0: u64,
    stop1: u64,
    other1: u64,
}

impl Window {
    /// The window from block `blk`. The second block's masks are loaded
    /// only when it starts by the input end `end`; past it the results are
    /// clamped to the end, or stop at the NUL after the input.
    #[inline(always)]
    fn at(src: &[u8], end: usize, blk: usize) -> Self {
        let (stop0, other0) = block_masks(src, blk);
        let mid = blk + 64;
        let (stop1, other1) = if mid <= end {
            block_masks(src, mid)
        } else {
            (u64::MAX, u64::MAX)
        };
        Window {
            mid,
            stop0,
            other0,
            stop1,
            other1,
        }
    }

    /// Move the window so that `p`, at most `end`, lies in its first
    /// block.
    #[inline(always)]
    fn sync(&mut self, src: &[u8], end: usize, p: usize) {
        if p < self.mid {
            return;
        }
        if p < self.mid + 64 {
            let mid = self.mid + 64;
            let (stop1, other1) = if mid <= end {
                block_masks(src, mid)
            } else {
                (u64::MAX, u64::MAX)
            };
            *self = Window {
                mid,
                stop0: self.stop1,
                other0: self.other1,
                stop1,
                other1,
            };
        } else {
            *self = Window::at(src, end, p & !63);
        }
    }

    /// The first `<` or `&` from `p`, or `end` (`$lexFindEither`).
    #[inline(always)]
    fn text_end(&mut self, src: &[u8], end: usize, mut p: usize) -> usize {
        loop {
            self.sync(src, end, p);
            let m = self.stop0 >> (p.wrapping_sub(self.mid) & 63);
            if m != 0 {
                return (p + m.trailing_zeros() as usize).min(end);
            }
            if self.stop1 != 0 {
                return (self.mid + self.stop1.trailing_zeros() as usize).min(end);
            }
            p = self.mid + 64;
            if p >= end {
                return end;
            }
        }
    }

    /// The end of the name from `p`, at least the window start
    /// (`$xmlScanName`).
    #[inline(always)]
    fn name_end(&self, src: &[u8], p: usize) -> usize {
        let off = p - (self.mid - 64);
        if off < 64 {
            let m = self.other0 >> off;
            if m != 0 {
                return p + m.trailing_zeros() as usize;
            }
            if self.other1 != 0 {
                return self.mid + self.other1.trailing_zeros() as usize;
            }
        } else if off < 128 {
            let m = self.other1 >> (off - 64);
            if m != 0 {
                return p + m.trailing_zeros() as usize;
            }
        }
        name_end(src, p.max(self.mid + 64))
    }
}

/// Lex the input at `base` (`$hlXml`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, and this
    // lexer calls no translated function that could reallocate it.
    let src: &[u8] = unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) };
    let v = &mut inst.ext.recs;
    let rp = v.as_mut_ptr();
    // SAFETY: the length and capacity bound the vector's allocation.
    let mut out = unsafe {
        Out {
            cur: rp.add(v.len()),
            limit: rp.add(v.capacity()),
            last: v.last().map_or(u32::MAX, |r| r.token),
        }
    };
    // `$lexEmitLeadingContinuation`: a gap, so with no record yet it makes
    // one plain record.
    let p = scan::utf8_span_end(src, 0, len);
    if p > 0 {
        if out.cur == rp {
            out.tok(tok::NONE, p);
        } else {
            // SAFETY: a record exists.
            unsafe { out.extend(p) };
        }
    }
    let out = lex(src, len, out, p);
    // SAFETY: the records before `out.cur` are written, within capacity.
    unsafe { v.set_len(out.cur.offset_from(rp) as usize) };
}

/// The lexer loop, from the start of the input (`$hlXml` outside a
/// resumed tag).
fn lex(src: &[u8], end: usize, mut out: Out, mut p: usize) -> Out {
    let mut win = Window::at(src, end, p & !63);
    while p < end {
        // Text up to the next `<` or `&`.
        let lhs = p;
        p = win.text_end(src, end, p);
        out.span(tok::NONE, lhs, p);
        if p >= end {
            break;
        }
        let lhs = p;
        let c = at(src, p);
        if c == b'&' {
            match entity(src, end, lhs) {
                Some(e) => {
                    p = e;
                    out.tok(tok::STRING_SPECIAL, p);
                }
                None => {
                    p += 1;
                    out.tok(tok::NONE, p);
                }
            }
            continue;
        }

        // Exact, case-sensitive openers, which all start `<!` or `<?`.
        let c2 = at(src, p + 1);
        if c2 == b'!' || c2 == b'?' {
            core::hint::cold_path();
            if p + 4 <= end && &src[p..p + 4] == b"<!--" {
                p = section(src, end, lhs, 4, b"-->");
                out.tok(tok::COMMENT, p);
                continue;
            }
            if p + 9 <= end && &src[p..p + 9] == b"<![CDATA[" {
                p = section(src, end, lhs, 9, b"]]>");
                out.tok(tok::TEXT_LITERAL, p);
                continue;
            }
            if p + 2 <= end && &src[p..p + 2] == b"<?" {
                p = section(src, end, lhs, 2, b"?>");
                out.tok(tok::PREPROC, p);
                continue;
            }
            if p + 9 <= end && &src[p..p + 9] == b"<!DOCTYPE" {
                p = doctype(src, end, p + 2);
                out.tok(tok::TAG_DOCTYPE, p);
                continue;
            }
        }

        // Ordinary tags.
        p += 1;
        // The NUL after the input is neither `/` nor a name byte.
        if at(src, p) == b'/' {
            p += 1;
        }
        let name = p;
        if KIND[at(src, p) as usize] & K_NAME != 0 {
            out.tok(tok::PUNCTUATION_BRACKET_HTML, name);
            p = win.name_end(src, p);
            out.tok(tok::TAG, p);
            // A tag with no attributes ends at once: the attributes' `>`
            // rule, taken here.
            if at(src, p) == b'>' {
                p += 1;
                out.tok(tok::PUNCTUATION_BRACKET_HTML, p);
                continue;
            }
            p = attrs(src, end, &win, &mut out, p);
            continue;
        }
        p = lhs + 1;
        out.tok(tok::NONE, p);
    }
    out
}
