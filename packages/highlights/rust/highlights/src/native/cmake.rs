//! WAT sources: src/langs/cmake.wat src/common.wat src/scan.wat
//!
//! Native CMake lexer. A word at parenthesis depth zero is a command,
//! colored by its case-insensitive name; deeper words are arguments, where
//! the uppercase condition operators of `if`/`elseif`/`while` and the
//! boolean constants apply. Quoted arguments carry escapes and `${...}`
//! references, and `[[ ... ]]` bracket arguments and `#[[ ... ]]` bracket
//! comments span lines. The records equal the translated `cmake` lexer's
//! records.

#[cfg(target_arch = "aarch64")]
use core::arch::aarch64::*;

use super::Lexer;
use super::scan;
use super::tables::{KeywordTable, byteset};
use crate::Rec;
use crate::generated::Instance;
use crate::token_ids as tok;
use crate::wat_tables::CMAKE_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "cmake" => Some(highlight),
        _ => None,
    }
}

/// `$cmakeWords`.
static WORDS: KeywordTable<2048> = KeywordTable::new(CMAKE_WORDS);

/// Word bytes: identifier bytes but `$`, and `+`, `-`, `.`, `/`, `:`
/// (`$cmakeIsWordByte`).
const WORD: [bool; 256] = {
    let extra = byteset(b"+-./:");
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = b != b'$' && (is_ident_continue(b) || extra[c]);
        c += 1;
    }
    t
};

/// Bytes that end a word: all but [`WORD`] bytes.
const WORD_STOP: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = !WORD[c];
        c += 1;
    }
    t
};
const WORD_STOP_NIB: ([u8; 16], [u8; 16]) = nibbles(&WORD_STOP);

/// Whitespace: space and TAB through CR (`$lexIsSpace`).
static SPACE: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = is_space(c as u8);
        c += 1;
    }
    t
};

/// The byte at `i`. Callers read at most 16 bytes past the input end, which
/// the 96-byte input slack covers. The byte at the input end is NUL, so at
/// any position up to the end this is also `$cmakeByte`, which reads 0 at
/// and past the end; every `$cmakeByte` position here lies at or before
/// the end.
#[inline(always)]
fn at(src: &[u8], i: usize) -> u8 {
    debug_assert!(i < src.len());
    // SAFETY: `i` lies inside the input or its slack (see above).
    unsafe { *src.get_unchecked(i) }
}

/// Whether `c` is an ASCII digit (`$lexIsDigit`).
#[inline(always)]
const fn is_digit(c: u8) -> bool {
    c.wrapping_sub(b'0') <= 9
}

/// Whether `c` starts an identifier: a letter, `_`, `$`, or any byte from
/// 0x80 (`$lexIsIdentStart`).
#[inline(always)]
const fn is_ident_start(c: u8) -> bool {
    c >= 0x80 || (c | 32).wrapping_sub(b'a') <= 25 || c == b'_' || c == b'$'
}

/// Whether `c` continues an identifier (`$lexIsIdentContinue`).
#[inline(always)]
const fn is_ident_continue(c: u8) -> bool {
    is_ident_start(c) || is_digit(c)
}

/// Whether `c` is ASCII whitespace: space or TAB through CR (`$lexIsSpace`).
#[inline(always)]
const fn is_space(c: u8) -> bool {
    c == b' ' || c.wrapping_sub(9) <= 4
}

/// A byte set as two nibble tables: byte `b` is in the set when
/// `hi[b >> 4] & lo[b & 15]` is nonzero. Each bit stands for a group of
/// high nibbles that admit the same low nibbles; building fails when the
/// set needs more than eight groups.
const fn nibbles(set: &[bool; 256]) -> ([u8; 16], [u8; 16]) {
    let mut rows = [0u16; 16];
    let mut h = 0;
    while h < 16 {
        let mut l = 0;
        while l < 16 {
            if set[h * 16 + l] {
                rows[h] |= 1 << l;
            }
            l += 1;
        }
        h += 1;
    }
    let mut hi = [0u8; 16];
    let mut lo = [0u8; 16];
    let mut groups = [0u16; 8];
    let mut n = 0;
    h = 0;
    while h < 16 {
        if rows[h] != 0 {
            let mut g = 0;
            while g < n && groups[g] != rows[h] {
                g += 1;
            }
            if g == n {
                assert!(n < 8, "too many nibble groups");
                groups[n] = rows[h];
                n += 1;
            }
            hi[h] = 1 << g;
            let mut l = 0;
            while l < 16 {
                if rows[h] >> l & 1 != 0 {
                    lo[l] |= 1 << g;
                }
                l += 1;
            }
        }
        h += 1;
    }
    (hi, lo)
}

/// The first byte from `p` in the set of the nibble tables `nib` (see
/// [`nibbles`]), 16 bytes per step. The caller makes sure a set byte lies
/// within 16 bytes past the input end, or stops the scan itself.
#[inline(always)]
fn find_set(src: &[u8], mut p: usize, nib: &([u8; 16], [u8; 16]), set: &[bool; 256]) -> usize {
    #[cfg(target_arch = "aarch64")]
    // SAFETY: each 16-byte load starts at or before a set byte that lies
    // at most 16 bytes past the input end, inside the slack.
    unsafe {
        let _ = set;
        let hi_t = vld1q_u8(nib.0.as_ptr());
        let lo_t = vld1q_u8(nib.1.as_ptr());
        loop {
            let v = vld1q_u8(src.as_ptr().add(p));
            let hi = vqtbl1q_u8(hi_t, vshrq_n_u8::<4>(v));
            let lo = vqtbl1q_u8(lo_t, vandq_u8(v, vdupq_n_u8(15)));
            let k = scan::first_lane(vtstq_u8(hi, lo));
            if k < 16 {
                return p + k;
            }
            p += 16;
        }
    }
    #[cfg(not(target_arch = "aarch64"))]
    {
        let _ = nib;
        while !set[at(src, p) as usize] {
            p += 1;
        }
        p
    }
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

    /// `[lhs, rhs)` as `hl` when it is non-empty (`$emitTok`).
    #[inline(always)]
    fn emit(&mut self, hl: u32, lhs: usize, rhs: usize) {
        if lhs < rhs {
            self.tok(hl, rhs);
        }
    }

    /// Whitespace `[lhs, rhs)` extends the last record (`$emitGap`). Every
    /// gap after the input's leading whitespace follows a token's record.
    #[inline(always)]
    fn gap(&mut self, lhs: usize, rhs: usize) {
        if lhs < rhs {
            // SAFETY: the record before `cur` is written (see above).
            unsafe { (*self.cur.sub(1)).end = rhs as u32 };
        }
    }
}

/// The end of the escape at backslash `p` (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(src: &[u8], p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(src, p + 2, end);
    if e == p + 2 && at(src, p + 1) == b'\r' && e < end && at(src, e) == b'\n' {
        e += 1;
    }
    e
}

/// The end of the number at `p` (`$lexScanNumber`, `$lexScanNumberBody`).
/// The NUL after the input stops it.
fn number_end(src: &[u8], mut p: usize) -> usize {
    let hex = at(src, p) == b'0' && at(src, p + 1) | 0x20 == b'x';
    let mut prev = 0u8;
    loop {
        let c = at(src, p);
        if is_ident_continue(c) {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            if !is_digit(at(src, p + 1)) {
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

/// The command word `[lhs, rhs)` lowercased for its case-insensitive table
/// group, as the WAT's lowercase scratch copy (`$lexLowerCopy`): bytes
/// 0-31 as four little-endian integers, `A-Z` lowered. Only its first
/// `rhs - lhs` bytes are meaningful.
#[inline(always)]
fn lower_word(src: &[u8], lhs: usize) -> [u8; 32] {
    // Lowercase 8 bytes at a time: a byte is uppercase when its low 7 bits
    // are at least `A`, not above `Z`, and its top bit is clear.
    let lower = |w: u64| {
        let h = w & 0x7f7f_7f7f_7f7f_7f7f;
        let ge_a = h + 0x3f3f_3f3f_3f3f_3f3f;
        let gt_z = h + 0x2525_2525_2525_2525;
        let upper = ge_a & !gt_z & !w & 0x8080_8080_8080_8080;
        w | upper >> 2
    };
    let mut buf = [0u8; 32];
    let mut i = 0;
    while i < 32 {
        // SAFETY: `lhs` lies at or before the input end, so 32 bytes from it
        // lie inside the slack.
        let w = unsafe { src.as_ptr().add(lhs + i).cast::<u64>().read_unaligned() };
        buf[i..i + 8].copy_from_slice(&lower(u64::from_le(w)).to_le_bytes());
        i += 8;
    }
    buf
}

/// Whether the `n`-byte lowercased command `low` is `if`, `elseif`, or
/// `while`, whose arguments carry the operator words
/// (`$cmakeIsCondition`).
#[inline(always)]
fn is_condition(low: &[u8; 32], n: usize) -> bool {
    match n {
        2 => low[..2] == *b"if",
        5 => low[..5] == *b"while",
        6 => low[..6] == *b"elseif",
        _ => false,
    }
}

/// SCREAMING_CASE: at least two bytes, one uppercase letter, and only
/// `[A-Z0-9_]` (`$lexIsConstCase`).
#[inline(always)]
fn is_const_case(src: &[u8], lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = false;
    for p in lhs..rhs {
        let c = at(src, p);
        if c.wrapping_sub(b'A') <= 25 {
            upper = true;
        } else if !(is_digit(c) || c == b'_') {
            return false;
        }
    }
    upper
}

/// The number of `=` between the brackets of a `[=*[` opener at `p`, or
/// `None` when the bytes there open no bracket comment or argument
/// (`$cmakeBracketEquals`).
#[inline(always)]
fn bracket_equals(src: &[u8], p: usize) -> Option<usize> {
    let mut p = p + 1;
    let mut n = 0;
    while at(src, p) == b'=' {
        p += 1;
        n += 1;
    }
    if at(src, p) != b'[' || n > 30 {
        return None;
    }
    Some(n)
}

/// The bracket body whose `[=*[` opener with `n` equals signs sits at
/// `ptr`, through its `]=*]` closer or the input end, as `hl`; a closer
/// right after the byte `escape` (the WAT's `$streamB`, when nonzero)
/// does not count. Returns the end (`$cmakeBracketBody`,
/// `$streamResumeFixed`).
#[inline(never)]
fn bracket_body(
    src: &[u8],
    end: usize,
    ptr: usize,
    n: usize,
    hl: u32,
    escape: i32,
    o: &mut Out,
) -> usize {
    let lhs = ptr + n + 2;
    o.emit(hl, ptr, lhs);
    let len = n + 2;
    let mut p = lhs;
    loop {
        p = scan::find3(src, p, end, b']', b']', b']');
        if p + len > end {
            break;
        }
        let mut matched =
            src[p + 1..p + len - 1].iter().all(|&b| b == b'=') && src[p + len - 1] == b']';
        if escape != 0 && p > lhs && src[p - 1] as i32 == escape {
            matched = false;
        }
        if matched {
            o.emit(hl, lhs, p + len);
            return p + len;
        }
        p += 1;
    }
    o.emit(hl, lhs, end);
    end
}

/// Whether the `$` at `p` opens a `${name}`, `$ENV{name}`, or
/// `$CACHE{name}` reference or a `$<...>` generator expression
/// (`$cmakeIsRefOpen`).
#[inline(always)]
fn is_ref_open(src: &[u8], p: usize) -> bool {
    let mut p = p + 1;
    while at(src, p).wrapping_sub(b'A') <= 25 {
        p += 1;
    }
    let c = at(src, p);
    c == b'{' || c == b'<'
}

/// The reference opening at `ptr` (see [`is_ref_open`]): a variable
/// through the brace balancing its opener, or a generator expression as
/// `string.special` through the balancing `>`, ending at a line break
/// when unbalanced. Returns the end (`$cmakeReference`).
#[inline(always)]
fn reference(src: &[u8], end: usize, ptr: usize, o: &mut Out) -> usize {
    let lhs = ptr;
    let mut ptr = ptr + 1;
    while at(src, ptr).wrapping_sub(b'A') <= 25 {
        ptr += 1;
    }
    let open = at(src, ptr);
    let (close, hl) = if open == b'<' {
        (b'>', tok::STRING_SPECIAL)
    } else {
        (b'}', tok::VARIABLE)
    };
    let mut depth = 0u32;
    while ptr < end {
        let c = at(src, ptr);
        if c == b'\n' || c == b'\r' {
            break;
        }
        ptr += 1;
        if c == open {
            depth = depth.wrapping_add(1);
        }
        if c == close {
            depth = depth.wrapping_sub(1);
            if depth == 0 {
                break;
            }
        }
    }
    o.emit(hl, lhs, ptr);
    ptr
}

/// The quoted argument whose opening quote sits at `seg`, with escapes and
/// references emitted separately; it may span lines. Returns the end
/// (`$cmakeQuotedBody`).
#[inline(never)]
fn quoted(src: &[u8], end: usize, seg: usize, out: &mut Out) -> usize {
    let mut o = *out;
    let mut seg = seg;
    let mut ptr = seg + 1;
    loop {
        let p = scan::find3(src, ptr, end, b'"', b'\\', b'$');
        if p >= end {
            ptr = end;
            break;
        }
        let c = at(src, p);
        if c == b'"' {
            ptr = p + 1;
            break;
        }
        if c == b'\\' {
            o.emit(tok::STRING, seg, p);
            let e = escape_end(src, p, end);
            o.emit(tok::STRING_ESCAPE, p, e);
            ptr = e;
            seg = e;
            continue;
        }
        if is_ref_open(src, p) {
            o.emit(tok::STRING, seg, p);
            ptr = reference(src, end, p, &mut o);
            seg = ptr;
            continue;
        }
        ptr = p + 1;
    }
    o.emit(tok::STRING, seg, ptr);
    *out = o;
    ptr
}

/// Lex the CMake input of `len` bytes at `base` (`$hlCmake`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, which is not
    // reallocated while this lexer runs.
    let src: &[u8] = unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) };
    let end = len;
    // A bracket body's closer does not count right after this byte, when it
    // is nonzero: the WAT reads `$streamB` there without setting it.
    let escape = inst.g_streamB;
    let v = &mut inst.ext.recs;
    let start = v.as_mut_ptr();
    let mut o = Out {
        // SAFETY: `len` records are written.
        cur: unsafe { start.add(v.len()) },
        // SAFETY: one past the allocation.
        limit: unsafe { start.add(v.capacity()) },
        last: v.last().map_or(u32::MAX, |r| r.token),
    };
    // Call an out-of-line helper that writes records through a copy of the
    // writer, so the loop's writer stays in registers.
    macro_rules! call {
        ($f:ident($($arg:expr),*)) => {{
            let mut t = o;
            let r = $f(src, end, $($arg,)* &mut t);
            o = t;
            r
        }};
    }

    // open parentheses: a word at depth zero is a command
    let mut depth = 0u32;
    // inside the arguments of `if`, `elseif`, or `while`
    let mut cond = false;
    // right after `set(`, `unset(`, or `option(`
    let mut set_var = false;

    // `$lexEmitLeadingContinuation` and the leading whitespace: one gap,
    // which writes the first record when there is none yet.
    let mut ptr = scan::utf8_span_end(src, 0, end);
    while SPACE[at(src, ptr) as usize] {
        ptr += 1;
    }
    if ptr > 0 {
        if o.cur == start {
            o.tok(tok::NONE, ptr);
        } else {
            o.gap(0, ptr);
        }
    }
    // A word from `lhs`: a command at depth zero, an argument deeper.
    macro_rules! word {
        ($lhs:expr) => {{
            let lhs: usize = $lhs;
            // (NUL ends the word, so the scan stops at the input end)
            ptr = find_set(src, ptr + 1, &WORD_STOP_NIB, &WORD_STOP);
            let rhs = ptr;
            let hl;
            if depth == 0 {
                let n = rhs - lhs;
                let low = lower_word(src, lhs);
                let g = if n <= 31 { WORDS.group(&low, 0, n) } else { 0 };
                cond = is_condition(&low, n);
                set_var = g == 3;
                hl = if g == 1 {
                    tok::KEYWORD_CONTROL
                } else if g == 2 {
                    tok::KEYWORD_IMPORT
                } else {
                    tok::FUNCTION
                };
            } else {
                let g = WORDS.group(src, lhs, rhs);
                let mut h = if is_const_case(src, lhs, rhs) {
                    tok::CONSTANT
                } else {
                    tok::NONE
                };
                if set_var {
                    h = tok::VARIABLE;
                }
                if g == 4 && cond {
                    h = tok::KEYWORD_OPERATOR;
                }
                if g == 5 {
                    h = tok::BOOLEAN;
                }
                set_var = false;
                hl = h;
            }
            o.tok(hl, rhs);
        }};
    }

    loop {
        let gap = ptr;
        while SPACE[at(src, ptr) as usize] {
            ptr += 1;
        }
        o.gap(gap, ptr);
        if ptr >= end {
            break;
        }
        let lhs = ptr;
        let c = at(src, ptr);

        // Words, the most common tokens, skip the rule chain: no earlier
        // rule matches a word byte but a digit.
        if WORD[c as usize] && !is_digit(c) {
            word!(lhs);
            continue;
        }

        match c {
            // `#[[ ... ]]` bracket comments span lines; any other `#`
            // comments out the rest of the line
            b'#' => {
                let n = if at(src, ptr + 1) == b'[' {
                    bracket_equals(src, ptr + 1)
                } else {
                    None
                };
                if let Some(n) = n {
                    ptr += 1;
                    o.tok(tok::COMMENT, ptr);
                    ptr = call!(bracket_body(ptr, n, tok::COMMENT, escape));
                } else {
                    ptr = scan::line_end(src, ptr + 1, end);
                    o.tok(tok::COMMENT, ptr);
                }
                continue;
            }
            // `[[ ... ]]` bracket arguments are verbatim strings
            b'[' => {
                if let Some(n) = bracket_equals(src, ptr) {
                    ptr = call!(bracket_body(ptr, n, tok::STRING, escape));
                    set_var = false;
                    continue;
                }
            }
            b'"' => {
                ptr = call!(quoted(ptr));
                set_var = false;
                continue;
            }
            b'$' => {
                if is_ref_open(src, ptr) {
                    ptr = reference(src, end, ptr, &mut o);
                    set_var = false;
                    continue;
                }
            }
            // unquoted arguments take escapes too
            b'\\' => {
                ptr = escape_end(src, ptr, end);
                o.tok(tok::STRING_ESCAPE, ptr);
                continue;
            }
            b'(' => {
                ptr += 1;
                o.tok(tok::PUNCTUATION_BRACKET, ptr);
                depth = depth.wrapping_add(1);
                continue;
            }
            b')' => {
                ptr += 1;
                o.tok(tok::PUNCTUATION_BRACKET, ptr);
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    cond = false;
                    set_var = false;
                }
                continue;
            }
            b';' => {
                ptr += 1;
                o.tok(tok::PUNCTUATION_DELIMITER, ptr);
                continue;
            }
            _ => {}
        }

        // a number stands alone: `3.16`, `17`; digits that lead into a
        // name such as `2d.cpp` belong to the word
        if is_digit(c) {
            let e = number_end(src, ptr);
            if !WORD[at(src, e) as usize] {
                ptr = e;
                o.tok(tok::NUMBER, ptr);
                set_var = false;
                continue;
            }
        }
        if WORD[c as usize] {
            word!(lhs);
            continue;
        }

        ptr = scan::utf8_span_end(src, ptr + 1, end);
        o.tok(tok::NONE, ptr);
    }
    // SAFETY: the records before `cur` are written.
    unsafe { inst.ext.recs.set_len(o.cur.offset_from(start) as usize) };
}
