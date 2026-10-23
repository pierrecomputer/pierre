//! WAT sources: src/langs/graphql.wat src/common.wat src/scan.wat
//!
//! Native GraphQL lexer. One pass over the input: comments, strings and
//! block strings, variables, directives, spreads, numbers, punctuation,
//! and names, which are colored by the keyword before them (a type, an
//! operation or fragment name, a spread fragment), by their case, or by
//! what follows them (an argument, a field with arguments, a field). The
//! records equal the translated `graphql` lexer's records.

use super::Lexer;
use super::scan;
use crate::Rec;
use crate::generated::Instance;
use crate::token_ids as tok;
use crate::wat_tables::GRAPHQL_WORDS;

/// The lexer for each language this module handles.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "graphql" => Some(highlight),
        _ => None,
    }
}

/// `$graphqlWords` as a collision-free hash on a word's first 8 bytes and
/// length: each slot holds the word's bytes 0-7 and 8-15 (zero past its
/// end), its length, and its value, the token in the low byte and, above
/// it, the name capture the word primes for the next name.
struct Words {
    lo: [u64; WORD_SLOTS],
    hi: [u64; WORD_SLOTS],
    len: [u8; WORD_SLOTS],
    value: [i32; WORD_SLOTS],
    /// For each first byte, a bit per length of the words starting with it.
    lengths: [u16; 256],
    mul: u64,
}

const WORD_SLOTS: usize = 64;

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
            lo: [0; WORD_SLOTS],
            hi: [0; WORD_SLOTS],
            len: [0; WORD_SLOTS],
            value: [-1; WORD_SLOTS],
            lengths: [0; 256],
            mul,
        };
        let mut i = 0;
        while i < GRAPHQL_WORDS.len() {
            let k = &GRAPHQL_WORDS[i];
            assert!(k.word.len() >= 2 && k.word.len() <= 15);
            let (lo, hi) = word_key(k.word);
            let s = word_slot(lo, k.word.len(), mul);
            if w.len[s] != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            w.lo[s] = lo;
            w.hi[s] = hi;
            w.len[s] = k.word.len() as u8;
            w.value[s] = k.value;
            w.lengths[k.word[0] as usize] |= 1 << k.word.len();
            i += 1;
        }
        break 'search w;
    }
};

/// The value of the word `[lhs, rhs)`, or -1 when it is none
/// (`keyword-table.value $graphqlWords`).
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
    let s = word_slot(lo, n, w.mul);
    if w.lo[s] == lo && w.hi[s] == hi && w.len[s] as usize == n {
        w.value[s]
    } else {
        -1
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

/// The byte at `p`, or 0 at or past `end` (`$gqlByte`).
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

/// Name bytes: letters, digits, `_`, and bytes from 128 (`$scanIdentRun`
/// with `_`).
static NAME: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = is_ident_continue(c as u8) && c != b'$' as usize;
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
        // SAFETY: `cur` stays within the vector's capacity: a merge steps
        // back over the last record, and the trap stops a write at the
        // limit.
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

    /// Append a non-empty token ending at `end` whose color differs from
    /// the last record's, so it never merges (`$emitTok`).
    #[inline(always)]
    fn push(&mut self, hl: u32, end: usize) {
        debug_assert!(self.last != hl);
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

/// The end of the name run from `p` (`$scanIdentRun` with `_`). The NUL
/// after the input ends every run by the input end.
#[inline(always)]
fn name_end(src: &[u8], mut p: usize) -> usize {
    while NAME[at(src, p) as usize] {
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
        if is_ident_continue(c) {
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

/// A string at `lhs`, its escapes as separate tokens; a raw line break
/// ends it unconsumed. Returns its end (`$lexString`, `$lexStringBody`,
/// single-line).
#[inline(always)]
fn string(src: &[u8], end: usize, out: &mut Out, lhs: usize) -> usize {
    let mut seg = lhs;
    let mut p = lhs + 1;
    loop {
        if p >= end {
            break;
        }
        p = scan::string_special(src, p, end, b'"');
        if p >= end {
            break;
        }
        let c = at(src, p);
        if c == b'"' {
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

/// A `"""` block string at `lhs`, up to a `"""` not after a backslash, or
/// the end. Returns its end (`$gqlBlockString`).
fn block_string(src: &[u8], end: usize, lhs: usize) -> usize {
    let mut p = lhs + 3;
    loop {
        p = if p >= end {
            end
        } else {
            scan::find3(src, p, end, b'"', b'"', b'"')
        };
        if p >= end {
            return end;
        }
        if byte(src, end, p + 1) == b'"' && byte(src, end, p + 2) == b'"' && at(src, p - 1) != b'\\'
        {
            return p + 3;
        }
        p += 1;
    }
}

/// Byte classes as two nibble tables: byte `b` is in a class when
/// `CLASS_HI[b >> 4] & CLASS_LO[b & 15]` has one of its bits. Whitespace: 1
/// for TAB to CR, 2 for a space; name bytes: 4 for digits, 8 for `A`-`O`
/// and `a`-`o`, 16 for `P`-`Z` and `p`-`z`, 32 for `_`, 128 for bytes from
/// 128.
const CLASS_HI: [u8; 16] = [
    1,
    0,
    2,
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
        t[l] = m;
        l += 1;
    }
    t
};
const SPACE_BITS: u8 = 1 | 2;
const NAME_BITS: u8 = !SPACE_BITS;

/// The non-whitespace and non-name masks of the 64 bytes from `b`, one bit
/// per byte. `b + 64` must lie inside the input slack.
#[inline(always)]
fn block_masks(src: &[u8], b: usize) -> (u64, u64) {
    debug_assert!(b + 64 <= src.len());
    #[cfg(target_arch = "aarch64")]
    // SAFETY: the caller keeps the 64 bytes from `b` inside the slack.
    unsafe {
        use core::arch::aarch64::*;
        let base = src.as_ptr().add(b);
        let weights =
            vld1q_u8([1u8, 2, 4, 8, 16, 32, 64, 128, 1, 2, 4, 8, 16, 32, 64, 128].as_ptr());
        let hi_t = vld1q_u8(CLASS_HI.as_ptr());
        let lo_t = vld1q_u8(CLASS_LO.as_ptr());
        let mut space = [vdupq_n_u8(0); 4];
        let mut name = [vdupq_n_u8(0); 4];
        for i in 0..4 {
            let v = vld1q_u8(base.add(16 * i));
            let class = vandq_u8(
                vqtbl1q_u8(hi_t, vshrq_n_u8::<4>(v)),
                vqtbl1q_u8(lo_t, vandq_u8(v, vdupq_n_u8(15))),
            );
            space[i] = vandq_u8(vtstq_u8(class, vdupq_n_u8(SPACE_BITS)), weights);
            name[i] = vandq_u8(vtstq_u8(class, vdupq_n_u8(NAME_BITS)), weights);
        }
        // Sum the weighted lanes pairwise: lane 0 of the result holds the
        // whitespace bits and lane 1 the name bits, byte 0 first.
        let w = vpaddq_u8(vpaddq_u8(space[0], space[1]), vpaddq_u8(space[2], space[3]));
        let n = vpaddq_u8(vpaddq_u8(name[0], name[1]), vpaddq_u8(name[2], name[3]));
        let both = vreinterpretq_u64_u8(vpaddq_u8(w, n));
        (!vgetq_lane_u64::<0>(both), !vgetq_lane_u64::<1>(both))
    }
    #[cfg(not(target_arch = "aarch64"))]
    {
        let mut text = 0u64;
        let mut other = 0u64;
        for i in 0..64 {
            let c = at(src, b + i);
            if !is_space(c) {
                text |= 1 << i;
            }
            if !NAME[c as usize] {
                other |= 1 << i;
            }
        }
        (text, other)
    }
}

/// Bit masks of two adjacent 64-byte blocks of the input, the second
/// starting at `mid`: for each byte, whether it is not whitespace, and
/// whether it is not a name byte. A scan over the window is a shift and a
/// bit count, so the next token's start does not wait on a scan of the
/// bytes before it.
#[derive(Clone, Copy)]
struct Window {
    mid: usize,
    text0: u64,
    other0: u64,
    text1: u64,
    other1: u64,
}

impl Window {
    /// The window from block `blk`. The second block's masks are loaded
    /// only when it starts by the input end `end`; past it every scan
    /// stops at the NUL after the input.
    #[inline(always)]
    fn at(src: &[u8], end: usize, blk: usize) -> Self {
        let (text0, other0) = block_masks(src, blk);
        let mid = blk + 64;
        let (text1, other1) = if mid <= end {
            block_masks(src, mid)
        } else {
            (u64::MAX, u64::MAX)
        };
        Window {
            mid,
            text0,
            other0,
            text1,
            other1,
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
            let (text1, other1) = if mid <= end {
                block_masks(src, mid)
            } else {
                (u64::MAX, u64::MAX)
            };
            *self = Window {
                mid,
                text0: self.text1,
                other0: self.other1,
                text1,
                other1,
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

    /// The end of the name from `p`, which lies in the first block
    /// (`$scanIdentRun` with `_`).
    #[inline(always)]
    fn name_end(&self, src: &[u8], p: usize) -> usize {
        // As in `space_end`.
        let m = self.other0 >> (p.wrapping_sub(self.mid) & 63);
        if m != 0 {
            return p + m.trailing_zeros() as usize;
        }
        core::hint::cold_path();
        if self.other1 != 0 {
            return self.mid + self.other1.trailing_zeros() as usize;
        }
        name_end(src, self.mid + 64)
    }
}

/// Bytes that start a name: letters, `_`, and bytes from 128
/// (`$lexIsIdentStart` without `$`).
static NAME_START: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = is_ident_start(c as u8) && c != b'$' as usize;
        c += 1;
    }
    t
};

/// Kinds of the single-byte punctuation tokens.
const K_BRACKET: u8 = 1;
const K_DELIMITER: u8 = 2;
const K_OPERATOR: u8 = 3;

/// The punctuation kind of every byte, 0 for bytes the other rules take.
static PUNCT: [u8; 256] = {
    let mut t = [0u8; 256];
    t[b'(' as usize] = K_BRACKET;
    t[b')' as usize] = K_BRACKET;
    t[b'[' as usize] = K_BRACKET;
    t[b']' as usize] = K_BRACKET;
    t[b'{' as usize] = K_BRACKET;
    t[b'}' as usize] = K_BRACKET;
    t[b',' as usize] = K_DELIMITER;
    t[b':' as usize] = K_DELIMITER;
    t[b'!' as usize] = K_OPERATOR;
    t[b'=' as usize] = K_OPERATOR;
    t[b'|' as usize] = K_OPERATOR;
    t[b'&' as usize] = K_OPERATOR;
    t
};

/// Lex the input at `base` (`$hlGraphql`).
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

/// The lexer loop, from the first token (`$hlGraphql`). Each pass lexes
/// one token at `p` and then the whitespace after it.
fn lex(src: &[u8], end: usize, mut out: Out, mut p: usize) -> Out {
    // The capture of the next name: 1 type, 2 operation or fragment
    // definition, 3 fragment spread.
    let mut expect = 0u32;
    // Open parens, where `name:` is an argument rather than a field.
    let mut paren = 0u32;
    let mut win = Window::at(src, end, p & !63);
    while p < end {
        let lhs = p;
        let c = at(src, p);
        'done: {
            // A name: letters, `_`, and bytes from 128 start no earlier
            // rule, so the name rule goes first.
            if NAME_START[c as usize] {
                p = win.name_end(src, p);
                let rhs = p;
                // The byte after the name and its blanks, read only by the
                // rules that need it.
                let after = || byte(src, end, skip_blanks(src, end, rhs));
                let mut g = word_value(src, lhs, rhs);
                // The contextual keywords need a name, brace, directive,
                // paren, or `&` after them on the same line.
                if g & 255 == tok::KEYWORD as i32 {
                    let after = after();
                    if !(is_ident_start(after)
                        || after == b'{'
                        || after == b'@'
                        || after == b'('
                        || after == b'&')
                    {
                        g = -1;
                    }
                }
                let hl;
                if g >= 0 {
                    hl = (g & 255) as u32;
                    expect = (g as u32) >> 8;
                } else if expect != 0 {
                    // `on FIELD_DEFINITION` names a directive location.
                    hl = match expect {
                        2 => tok::FUNCTION_DEFINITION,
                        3 => tok::FUNCTION,
                        _ => {
                            if is_const_case(src, lhs, rhs) {
                                tok::CONSTANT
                            } else {
                                tok::TYPE
                            }
                        }
                    };
                    expect = 0;
                } else if c.wrapping_sub(b'A') <= 25 {
                    hl = if is_const_case(src, lhs, rhs) {
                        tok::CONSTANT
                    } else {
                        tok::TYPE
                    };
                } else {
                    // `name:` is an argument inside parens and a field
                    // elsewhere; `name(` a field with arguments.
                    let after = after();
                    hl = if after == b':' && paren != 0 {
                        tok::VARIABLE_PARAMETER
                    } else if after == b'(' {
                        tok::FUNCTION
                    } else {
                        tok::PROPERTY
                    };
                }
                out.tok(hl, rhs);
                // A `:` right after the name: its rule below, taken here.
                if at(src, rhs) == b':' {
                    p += 1;
                    out.push(tok::PUNCTUATION_DELIMITER, p);
                }
                break 'done;
            }
            // Brackets, `,`, `:`, and operators start no earlier rule.
            let k = PUNCT[c as usize];
            if k != 0 {
                p += 1;
                if k == K_BRACKET {
                    out.tok(tok::PUNCTUATION_BRACKET, p);
                    if c == b'(' {
                        paren += 1;
                    }
                    if c == b')' && paren > 0 {
                        paren -= 1;
                    }
                    expect = 0;
                } else if k == K_DELIMITER {
                    out.tok(tok::PUNCTUATION_DELIMITER, p);
                } else {
                    out.tok(tok::OPERATOR, p);
                }
                break 'done;
            }
            let c2 = byte(src, end, p + 1);
            let c3 = byte(src, end, p + 2);
            if c == b'#' {
                // `$lexLineComment`.
                p = scan::line_end(src, p + 1, end);
                out.tok(tok::COMMENT, p);
                break 'done;
            }
            if c == b'"' {
                if c2 == b'"' && c3 == b'"' {
                    core::hint::cold_path();
                    p = block_string(src, end, lhs);
                    out.tok(tok::STRING, p);
                } else {
                    p = string(src, end, &mut out, lhs);
                }
                break 'done;
            }
            if c == b'$' && is_ident_start(c2) {
                p = name_end(src, p + 1);
                out.tok(tok::VARIABLE, p);
                break 'done;
            }
            if c == b'@' && is_ident_start(c2) {
                p = name_end(src, p + 1);
                out.tok(tok::ATTRIBUTE, p);
                break 'done;
            }
            // `...Fragment` and `... on Type`.
            if c == b'.' && c2 == b'.' && c3 == b'.' {
                p += 3;
                out.tok(tok::PUNCTUATION_SPECIAL, p);
                expect = 3;
                break 'done;
            }
            if is_digit(c) || (c == b'-' && is_digit(c2)) {
                p = scan_number(src, end, p + (!is_digit(c)) as usize);
                out.tok(tok::NUMBER, p);
                break 'done;
            }
            // Brackets, `,`, `:`, and operators were taken above.
            p = scan::utf8_span_end(src, p + 1, end);
            out.tok(tok::NONE, p);
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
