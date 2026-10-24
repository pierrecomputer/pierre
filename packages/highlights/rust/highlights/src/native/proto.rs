//! WAT sources: src/langs/proto.wat src/common.wat src/scan.wat
//!
//! Native Protocol Buffers lexer. One pass over the input: comments,
//! strings, keywords and builtin types, numbers, punctuation, and names,
//! which are colored by the keyword before them (a message or enum type,
//! an rpc, a package), by what follows them (a field or option name before
//! `=`, a package segment before `.`), or by their case. The records equal
//! the translated `proto` lexer's records.

use super::Lexer;
use super::scan;
use crate::Rec;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::PROTO_WORDS;

/// The lexer for each language this module handles.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "proto" => Some(highlight),
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

/// The byte at `p`, or 0 at or past `end` (`$protoByte`).
#[inline(always)]
fn byte(src: &[u8], end: usize, p: usize) -> u8 {
    if p < end { at(src, p) } else { 0 }
}

/// Whether `c` is ASCII whitespace (`$lexIsSpace`).
#[inline(always)]
const fn is_space(c: u8) -> bool {
    c == 32 || c.wrapping_sub(9) <= 4
}

/// Whether `c` is an ASCII digit (`$lexIsDigit`).
#[inline(always)]
const fn is_digit(c: u8) -> bool {
    c.wrapping_sub(b'0') <= 9
}

/// Whether `c` starts an identifier: a letter, `_`, `$`, or any byte from
/// 128 (`$lexIsIdentStart`).
#[inline(always)]
const fn is_ident_start(c: u8) -> bool {
    c >= 0x80 || (c | 32).wrapping_sub(b'a') <= 25 || c == b'_' || c == b'$'
}

/// Whether `c` continues an identifier (`$lexIsIdentContinue`).
#[inline(always)]
const fn is_ident_continue(c: u8) -> bool {
    is_ident_start(c) || is_digit(c)
}

/// Identifier bytes as a table (`$lexIsIdentContinue`).
static IDENT: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = is_ident_continue(c as u8);
        c += 1;
    }
    t
};

/// Identifier starts as a table (`$lexIsIdentStart`).
static IDENT_START: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = is_ident_start(c as u8);
        c += 1;
    }
    t
};

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

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run by the input end.
#[inline(always)]
fn space_end(src: &[u8], mut p: usize) -> usize {
    while is_space(at(src, p)) {
        p += 1;
    }
    p
}

/// The end of the identifier run from `p` (`$lexScanIdent`,
/// `$scanIdentRun` with `$`). The NUL after the input ends every run.
#[inline(always)]
fn ident_end(src: &[u8], mut p: usize) -> usize {
    while IDENT[at(src, p) as usize] {
        p += 1;
    }
    p
}

/// The end of the spaces and TABs from `p`, bounded by `end`
/// (`$lexSkipSpaceAt`).
#[inline(always)]
fn skip_blanks(src: &[u8], end: usize, mut p: usize) -> usize {
    while p < end && (at(src, p) == b' ' || at(src, p) == b'\t') {
        p += 1;
    }
    p
}

/// Constant-case bytes: 2 for capitals, 1 for digits and `_`, 0 for any
/// other byte.
static CONST_CASE: [u8; 256] = {
    let mut t = [0u8; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = if b.wrapping_sub(b'A') <= 25 {
            2
        } else if is_digit(b) || b == b'_' {
            1
        } else {
            0
        };
        c += 1;
    }
    t
};

/// Whether `[lhs, rhs)` is a constant-case name: at least two bytes of
/// capitals, digits, and `_`, with a capital (`$lexIsConstCase`).
#[inline(always)]
fn is_const_case(src: &[u8], lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = 0;
    for p in lhs..rhs {
        let k = CONST_CASE[at(src, p) as usize];
        if k == 0 {
            return false;
        }
        upper |= k;
    }
    upper & 2 != 0
}

/// The end of the escape at the backslash at `p` (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(src: &[u8], end: usize, p: usize) -> usize {
    let mut e = scan::utf8_span_end(src, p + 2, end);
    if e == p + 2 && at(src, p + 1) == 13 && e < end && at(src, e) == 10 {
        e += 1;
    }
    e
}

/// A number from `p`, at its first digit (`$lexScanNumber`,
/// `$lexScanNumberBody`).
#[inline(always)]
fn scan_number(src: &[u8], end: usize, mut p: usize) -> usize {
    let hex = p + 1 < end && at(src, p) == b'0' && at(src, p + 1) | 32 == b'x';
    let mut prev = 0u8;
    while p < end {
        let c = at(src, p);
        if IDENT[c as usize] {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            let next = if p + 1 < end { at(src, p + 1) } else { 0 };
            if !is_digit(next) {
                break;
            }
            prev = c;
            p += 1;
            continue;
        }
        if (c == b'+' || c == b'-') && ((!hex && prev | 32 == b'e') || prev | 32 == b'p') {
            prev = c;
            p += 1;
            continue;
        }
        break;
    }
    p
}

/// A string at `lhs` with quote `q`, its escapes as separate tokens; a raw
/// line break ends it unconsumed. Returns its end (`$lexString`,
/// `$lexStringBody`, single-line).
#[inline(always)]
fn string(src: &[u8], end: usize, out: &mut Out, lhs: usize, q: u8) -> usize {
    let mut seg = lhs;
    let mut p = lhs + 1;
    loop {
        if p >= end {
            break;
        }
        p = scan::string_special(src, p, end, q);
        if p >= end {
            break;
        }
        let c = at(src, p);
        if c == q {
            p += 1;
            break;
        }
        if c != b'\\' {
            break;
        }
        out.span(tok::STRING, seg, p);
        let e = escape_end(src, end, p);
        out.span(tok::STRING_ESCAPE, p, e);
        p = e;
        seg = p;
    }
    out.span(tok::STRING, seg, p);
    p
}

/// `$protoWords` as a collision-free hash on a word's first 8 bytes and
/// length: each slot holds the word's bytes 0-7 and 8-15 (zero past its
/// end), its length, and its value, the token in the low byte and the
/// next-name capture above it.
#[derive(Clone, Copy)]
struct Entry {
    lo: u64,
    hi: u64,
    /// The word's length in the low byte, its value above it.
    len_value: i64,
}

struct Words {
    entries: [Entry; WORD_SLOTS],
    /// For each first byte, a bit per length of the words starting with it.
    lengths: [u16; 256],
    mul: u64,
}

const WORD_SLOTS: usize = 128;

/// The integers of the word `w`: bytes 0-7 and 8-15, zero past its end.
const fn word_key(w: &[u8]) -> (u64, u64) {
    let mut lo = 0u64;
    let mut hi = 0u64;
    let mut i = 0;
    while i < w.len() {
        if i < 8 {
            lo |= (w[i] as u64) << (8 * i);
        } else {
            hi |= (w[i] as u64) << (8 * (i - 8));
        }
        i += 1;
    }
    (lo, hi)
}

/// The slot of a word with first 8 bytes `lo` and length `n`.
#[inline(always)]
const fn word_slot(lo: u64, n: usize, mul: u64) -> usize {
    ((lo ^ (n as u64) << 59).wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros())) as usize
}

static WORDS: Words = {
    let mut mul: u64 = 0x9e37_79b9_7f4a_7c15;
    let mut attempt = 0;
    'search: loop {
        assert!(attempt < 100_000, "no collision-free word hash");
        let mut w = Words {
            entries: [Entry {
                lo: 0,
                hi: 0,
                len_value: 0,
            }; WORD_SLOTS],
            lengths: [0; 256],
            mul,
        };
        let mut i = 0;
        while i < PROTO_WORDS.len() {
            let k = &PROTO_WORDS[i];
            assert!(k.word.len() >= 2 && k.word.len() <= 15);
            let (lo, hi) = word_key(k.word);
            let s = word_slot(lo, k.word.len(), mul);
            if w.entries[s].len_value != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            w.entries[s] = Entry {
                lo,
                hi,
                len_value: (k.value as i64) << 8 | k.word.len() as i64,
            };
            w.lengths[k.word[0] as usize] |= 1 << k.word.len();
            i += 1;
        }
        break 'search w;
    }
};

/// The value of the word `[lhs, rhs)`, or -1 for an ordinary name; the
/// table cannot hold `required` and `reserved`, which are keywords too
/// (`$protoWordHl`, `keyword-table.value $protoWords`).
#[inline(always)]
fn word_value(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    let w = &WORDS;
    if n > 15 || w.lengths[at(src, lhs) as usize] >> n & 1 == 0 {
        return -1;
    }
    // SAFETY: 16 bytes from a name's start stay inside the slack.
    let (lo, hi) = unsafe {
        let q = src.as_ptr().add(lhs);
        (
            q.cast::<u64>().read_unaligned().to_le(),
            q.add(8).cast::<u64>().read_unaligned().to_le(),
        )
    };
    let lo = if n >= 8 {
        lo
    } else {
        lo & ((1u64 << (8 * n)) - 1)
    };
    let hi = if n > 8 {
        hi & (u64::MAX >> (8 * (16 - n)))
    } else {
        0
    };
    let e = &w.entries[word_slot(lo, n, w.mul)];
    if e.lo == lo && e.hi == hi && e.len_value & 255 == n as i64 {
        return (e.len_value >> 8) as i32;
    }
    // `repeated` puts length 8 under `r` in the prefilter.
    if n == 8 && (lo == word_key(b"required").0 || lo == word_key(b"reserved").0) {
        return tok::KEYWORD as i32;
    }
    -1
}

/// Kinds of the single-byte punctuation tokens.
const K_BRACKET: u8 = 1;
const K_DELIMITER: u8 = 2;
const K_DOT: u8 = 3;
const K_EQUALS: u8 = 4;

/// The punctuation kind of every byte, 0 for bytes the other rules take;
/// none of these bytes starts an earlier rule.
static PUNCT: [u8; 256] = {
    let mut t = [0u8; 256];
    let b = b"()<>[]{}";
    let mut i = 0;
    while i < b.len() {
        t[b[i] as usize] = K_BRACKET;
        i += 1;
    }
    t[b',' as usize] = K_DELIMITER;
    t[b';' as usize] = K_DELIMITER;
    t[b':' as usize] = K_DELIMITER;
    t[b'.' as usize] = K_DOT;
    t[b'=' as usize] = K_EQUALS;
    t
};

/// Byte classes as two nibble tables: byte `b` is in a class when
/// `CLASS_HI[b >> 4] & CLASS_LO[b & 15]` has one of its bits. Whitespace: 1
/// for TAB to CR, 2 for a space; identifier bytes: 4 for digits, 8 for
/// `A`-`O` and `a`-`o`, 16 for `P`-`Z` and `p`-`z`, 32 for `_`, 64 for `$`,
/// 128 for bytes from 128.
const CLASS_HI: [u8; 16] = [
    1,
    0,
    2 | 64,
    4,
    8,
    16 | 32,
    8,
    16,
    128,
    128,
    128,
    128,
    128,
    128,
    128,
    128,
];
const CLASS_LO: [u8; 16] = {
    let mut t = [0u8; 16];
    let mut l = 0;
    while l < 16 {
        let mut m = 128;
        if l >= 9 && l <= 13 {
            m |= 1;
        }
        if l == 0 {
            m |= 2;
        }
        if l <= 9 {
            m |= 4;
        }
        if l >= 1 {
            m |= 8;
        }
        if l <= 10 {
            m |= 16;
        }
        if l == 15 {
            m |= 32;
        }
        if l == 4 {
            m |= 64;
        }
        t[l] = m;
        l += 1;
    }
    t
};
const SPACE_BITS: u8 = 1 | 2;
const IDENT_BITS: u8 = !SPACE_BITS;

/// The non-whitespace, non-identifier, and line-break (CR and LF) masks of
/// the 64 bytes from `b`, one bit per byte. `b + 64` must lie inside the
/// input slack.
#[inline(always)]
fn block_masks(src: &[u8], b: usize) -> (u64, u64, u64) {
    debug_assert!(b + 64 <= src.len());
    let hi_t = V::from_array(&CLASS_HI);
    let lo_t = V::from_array(&CLASS_LO);
    let mut space = [V::zero(); 4];
    let mut ident = [V::zero(); 4];
    let mut lines = [V::zero(); 4];
    for i in 0..4 {
        // SAFETY: the caller keeps the 64 bytes from `b` inside the slack.
        let v = unsafe { V::load(src.as_ptr().add(b + 16 * i)) };
        lines[i] = v.eq(V::splat(10)).or(v.eq(V::splat(13)));
        let class = hi_t
            .lookup(v.shr::<4>())
            .and(lo_t.lookup(v.and(V::splat(15))));
        space[i] = class.test(V::splat(SPACE_BITS));
        ident[i] = class.test(V::splat(IDENT_BITS));
    }
    (
        !V::bits64(space[0], space[1], space[2], space[3]),
        !V::bits64(ident[0], ident[1], ident[2], ident[3]),
        V::bits64(lines[0], lines[1], lines[2], lines[3]),
    )
}

/// Bit masks of two adjacent 64-byte blocks of the input, the second
/// starting at `mid`: for each byte, whether it is not whitespace, and
/// whether it is not an identifier byte. A scan over the window is a shift
/// and a bit count, so the next token's start does not wait on a scan of
/// the bytes before it.
#[derive(Clone, Copy)]
struct Window {
    mid: usize,
    text0: u64,
    other0: u64,
    lines0: u64,
    text1: u64,
    other1: u64,
    lines1: u64,
}

impl Window {
    /// The window from block `blk`. The second block's masks are loaded
    /// only when it starts by the input end `end`; past it every scan
    /// stops at the NUL after the input.
    #[inline(always)]
    fn at(src: &[u8], end: usize, blk: usize) -> Self {
        let (text0, other0, lines0) = block_masks(src, blk);
        let mid = blk + 64;
        let (text1, other1, lines1) = if mid <= end {
            block_masks(src, mid)
        } else {
            (u64::MAX, u64::MAX, u64::MAX)
        };
        Window {
            mid,
            text0,
            other0,
            lines0,
            text1,
            other1,
            lines1,
        }
    }

    /// Move the window so that `p` lies in its first block.
    #[inline(always)]
    fn sync(&mut self, src: &[u8], end: usize, p: usize) {
        if p < self.mid {
            return;
        }
        if p < self.mid + 64 {
            let mid = self.mid + 64;
            let (text1, other1, lines1) = if mid <= end {
                block_masks(src, mid)
            } else {
                (u64::MAX, u64::MAX, u64::MAX)
            };
            *self = Window {
                mid,
                text0: self.text1,
                other0: self.other1,
                lines0: self.lines1,
                text1,
                other1,
                lines1,
            };
        } else {
            core::hint::cold_path();
            *self = Window::at(src, end, p & !63);
        }
    }

    /// The end of the whitespace run from `p`, which lies in the first
    /// block (`$scanWhitespace`). The window moves so that the end lies in
    /// its first block too.
    #[inline(always)]
    fn space_end(&mut self, src: &[u8], end: usize, p: usize) -> usize {
        // `sync` keeps `p` in the first block, whose start is `mid - 64`:
        // its offset there is `(p - mid) & 63`.
        let m = self.text0 >> (p.wrapping_sub(self.mid) & 63);
        if m != 0 {
            return p + m.trailing_zeros() as usize;
        }
        let e = if self.text1 != 0 {
            self.mid + self.text1.trailing_zeros() as usize
        } else {
            core::hint::cold_path();
            space_end(src, self.mid + 64)
        };
        self.sync(src, end, e);
        e
    }

    /// The first CR or LF from `p`, which lies in the first block, or
    /// `end` (`$scanToLineEnd`).
    #[inline(always)]
    fn line_end(&self, src: &[u8], end: usize, p: usize) -> usize {
        // As in `space_end`.
        let m = self.lines0 >> (p.wrapping_sub(self.mid) & 63);
        if m != 0 {
            return (p + m.trailing_zeros() as usize).min(end);
        }
        if self.lines1 != 0 {
            return (self.mid + self.lines1.trailing_zeros() as usize).min(end);
        }
        core::hint::cold_path();
        scan::line_end(src, self.mid + 64, end)
    }

    /// The end of the identifier run from `p`, which lies in the first
    /// block (`$lexScanIdent`).
    #[inline(always)]
    fn ident_end(&self, src: &[u8], p: usize) -> usize {
        // As in `space_end`.
        let m = self.other0 >> (p.wrapping_sub(self.mid) & 63);
        if m != 0 {
            return p + m.trailing_zeros() as usize;
        }
        core::hint::cold_path();
        if self.other1 != 0 {
            return self.mid + self.other1.trailing_zeros() as usize;
        }
        ident_end(src, self.mid + 64)
    }
}

/// Lex the input at `base` (`$hlProto`).
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
    // `$lexEmitLeadingContinuation`, then the leading whitespace: both are
    // gaps, so with no record yet they make one plain record.
    let p = space_end(src, scan::utf8_span_end(src, 0, len));
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

/// The lexer loop, from the first token (`$hlProto`). Each pass lexes one
/// token at `p` and then the whitespace after it.
fn lex(src: &[u8], end: usize, mut out: Out, mut p: usize) -> Out {
    // The pending next-name capture: 1 type, 2 function, 3 namespace.
    let mut expect = 0u32;
    // After `.`: a lowercase name is a package segment.
    let mut member = false;
    let mut win = Window::at(src, end, p & !63);
    while p < end {
        let lhs = p;
        let c = at(src, p);
        'done: {
            // A name. Identifier starts begin no earlier rule.
            if IDENT_START[c as usize] {
                p = win.ident_end(src, p);
                let rhs = p;
                // The byte after the name and its blanks, read only by the
                // rules that need it.
                let after = || byte(src, end, skip_blanks(src, end, rhs));
                let kind = if member {
                    -1
                } else {
                    word_value(src, lhs, rhs)
                };
                let hl;
                if kind >= 0 {
                    hl = (kind & 255) as u32;
                    expect = (kind as u32) >> 8;
                } else if expect != 0 {
                    hl = match expect {
                        1 => tok::TYPE,
                        2 => tok::FUNCTION_DEFINITION,
                        _ => tok::NAMESPACE,
                    };
                    // A dotted package keeps its capture.
                    if expect != 3 || after() != b'.' {
                        expect = 0;
                    }
                } else if is_const_case(src, lhs, rhs) {
                    hl = tok::CONSTANT;
                } else {
                    let after = after();
                    hl = if after == b'=' {
                        tok::PROPERTY
                    } else if c.wrapping_sub(b'A') <= 25 {
                        tok::TYPE
                    } else if member || after == b'.' {
                        tok::NAMESPACE
                    } else {
                        tok::VARIABLE
                    };
                }
                out.tok(hl, rhs);
                member = false;
                // `name = `: the rules below take the spaces as gaps and
                // the `=` as an operator that ends any capture.
                if at(src, rhs) == b' ' && at(src, rhs + 1) == b'=' && at(src, rhs + 2) == b' ' {
                    // SAFETY: the name's record exists.
                    unsafe { out.extend(rhs + 1) };
                    p = rhs + 2;
                    out.tok(tok::OPERATOR, p);
                    p += 1;
                    // SAFETY: the operator's record exists.
                    unsafe { out.extend(p) };
                    expect = 0;
                    // A field number and its `;`: the number rule below.
                    if is_digit(at(src, p)) {
                        p = scan_number(src, end, p);
                        out.tok(tok::NUMBER, p);
                        if at(src, p) == b';' {
                            p += 1;
                            out.tok(tok::PUNCTUATION_DELIMITER, p);
                        }
                    }
                }
                break 'done;
            }
            let k = PUNCT[c as usize];
            if k != 0 {
                p += 1;
                if k == K_BRACKET {
                    out.tok(tok::PUNCTUATION_BRACKET, p);
                    expect = 0;
                } else if k == K_DELIMITER {
                    out.tok(tok::PUNCTUATION_DELIMITER, p);
                    expect = 0;
                } else if k == K_DOT {
                    out.tok(tok::PUNCTUATION_DELIMITER, p);
                    member = true;
                    break 'done;
                } else {
                    out.tok(tok::OPERATOR, p);
                    expect = 0;
                }
                member = false;
                break 'done;
            }
            let c2 = byte(src, end, p + 1);
            if c == b'/' && c2 == b'/' {
                // `$lexLineComment`: the `//` is no line break. A comment
                // on the next line after only whitespace joins the same
                // record, as the gap and the second comment would: take it
                // here.
                loop {
                    p = win.line_end(src, end, p);
                    win.sync(src, end, p);
                    let next = win.space_end(src, end, p);
                    if at(src, next) == b'/' && at(src, next + 1) == b'/' {
                        p = next;
                        continue;
                    }
                    // The whitespace after the last comment extends its
                    // record; the window has moved past the comment's end.
                    out.tok(tok::COMMENT, p);
                    // SAFETY: the comment's record exists.
                    unsafe { out.extend(next) };
                    p = next;
                    break 'done;
                }
            }
            if c == b'/' && c2 == b'*' {
                // `$lexBlockComment`.
                p = scan::block_comment_end(src, p + 2, end);
                out.tok(tok::COMMENT, p);
                break 'done;
            }
            if c == b'"' || c == b'\'' {
                p = string(src, end, &mut out, lhs, c);
                member = false;
                break 'done;
            }
            if is_digit(c) || ((c == b'-' || c == b'+') && is_digit(c2)) {
                p = scan_number(src, end, p + (!is_digit(c)) as usize);
                out.tok(tok::NUMBER, p);
                member = false;
                // A field's `;` often follows: its rule below, taken here.
                if at(src, p) == b';' {
                    p += 1;
                    out.tok(tok::PUNCTUATION_DELIMITER, p);
                    expect = 0;
                }
                break 'done;
            }
            if c == b'.' {
                p += 1;
                out.tok(tok::PUNCTUATION_DELIMITER, p);
                member = true;
                break 'done;
            }
            if c == b'=' {
                p += 1;
                out.tok(tok::OPERATOR, p);
                member = false;
                expect = 0;
                break 'done;
            }
            p += 1;
            out.tok(tok::NONE, p);
            member = false;
        }

        // The whitespace after the token extends its record (a no-op when
        // there is none).
        win.sync(src, end, p);
        p = win.space_end(src, end, p);
        // SAFETY: the token emitted a record.
        unsafe { out.extend(p) };
    }
    out
}
