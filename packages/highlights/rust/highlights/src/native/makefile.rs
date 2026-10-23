//! WAT sources: src/langs/makefile.wat src/langs/dockerfile.wat src/common.wat src/scan.wat
//!
//! Native Makefile lexer. A makefile is line-oriented: the first token of
//! each line classifies the line (recipe, assignment, rule, directive, or a
//! `define` body line), and the rest of the line is colored by that mode.
//! `$(...)` references nest. The records equal the translated `makefile`
//! lexer's records.

#[cfg(target_arch = "aarch64")]
use core::arch::aarch64::*;

use super::Lexer;
use super::scan;
use super::tables::{KeywordTable, byteset};
use crate::Rec;
use crate::generated::Instance;
use crate::token_ids as tok;
use crate::wat_tables::MAKEFILE_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "makefile" => Some(highlight),
        _ => None,
    }
}

/// `$makefileWords`.
static WORDS: KeywordTable<4096> = KeywordTable::new(MAKEFILE_WORDS);

/// Bytes that end a word (`$makeIsWordEnd`).
const WORD_END: [bool; 256] = byteset(b"\x00\x09\x0a\x0b\x0c\x0d \"#$'(),:;=\\|");

/// Automatic-variable bytes after `$`.
static AUTO_VAR: [bool; 256] = byteset(b"%*+<?@^|");

/// Bytes that join `=` into an assignment operator (`!=`, `+=`, `?=`).
const BANG_PLUS_QUERY: [bool; 256] = byteset(b"!+?");

/// Shell operator bytes (`$makeIsShellOp`).
static SHELL_OP: [bool; 256] = byteset(b"&;<>|");

/// Bytes where a word scan stops or must look at the next byte: the word
/// ends and `!`, `+`, `?` (see [`scan_word`]).
const WORD_STOP: [bool; 256] = {
    let mut t = WORD_END;
    let mut c = 0;
    while c < 256 {
        t[c] |= BANG_PLUS_QUERY[c];
        c += 1;
    }
    t
};

/// Bytes that only ever start a plain word: no rule before the word rule
/// of `$hlMakefile` can match them, in any mode. (`-` is one too, except at
/// a recipe's command head.)
static PLAIN_WORD: [bool; 256] = {
    let mut t = [false; 256];
    let extra = byteset(b"!+?&-@<>");
    let mut c = 0;
    while c < 256 {
        t[c] = !WORD_END[c] && !extra[c];
        c += 1;
    }
    t
};

/// Bytes [`line_kind`] stops at outside a reference.
const LINE_KIND_STOP: [bool; 256] = byteset(b"\n\r#$=:");

/// Bytes [`dollar`] stops at in a reference body, besides its closer and
/// opener.
static BODY_STOP: [bool; 256] = byteset(b"\n\r$,");

/// Bytes [`quoted`] stops at.
static QUOTED_STOP: [bool; 256] = byteset(b"\n\r\"\\$");

/// Whitespace kinds for the gap scan: 1 a blank, 2 a line break, 0 not
/// whitespace (`$lexIsSpace`).
static SPACE: [u8; 256] = {
    let mut t = [0u8; 256];
    t[b' ' as usize] = 1;
    t[0x09] = 1;
    t[0x0b] = 1;
    t[0x0c] = 1;
    t[b'\n' as usize] = 2;
    t[b'\r' as usize] = 2;
    t
};

/// Identifier bytes (`$scanIdentRun` with `_`).
static IDENT_RUN: [bool; 256] = ident_run_table(b'_');

/// `[A-Za-z0-9_]`, bytes from 0x80, and `x` (`$scanIdentRun`).
const fn ident_run_table(x: u8) -> [bool; 256] {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = b >= 0x80 || (b | 32).wrapping_sub(b'a') <= 25 || is_digit(b) || b == b'_' || b == x;
        c += 1;
    }
    t
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

const WORD_STOP_NIB: ([u8; 16], [u8; 16]) = nibbles(&WORD_STOP);

/// Bytes that end a reference's head word: all but `[A-Za-z0-9_-]` and bytes from 0x80
/// (`$scanIdentRun` with `-`).
const HEAD_STOP: [bool; 256] = {
    let run = ident_run_table(b'-');
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = !run[c];
        c += 1;
    }
    t
};
const HEAD_STOP_NIB: ([u8; 16], [u8; 16]) = nibbles(&HEAD_STOP);
const LINE_KIND_NIB: ([u8; 16], [u8; 16]) = nibbles(&LINE_KIND_STOP);

/// The line modes of `$hlMakefile`.
const RECIPE: u32 = 1;
const ASSIGN: u32 = 2;
const RULE: u32 = 3;
const PLAIN: u32 = 4;
const DEFINE_BODY: u32 = 5;
const RULE_VAR: u32 = 6;

/// The byte at `i`. Callers read at most 16 bytes past the input end, which
/// the 96-byte input slack covers. The byte at the input end is NUL, so at
/// any position up to the end this is also `$makeByte`, which reads 0 at
/// and past the end; every `$makeByte` position here lies at or before
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

/// The first `n` bytes at `p` as a little-endian integer. Reads 8 bytes,
/// which the input slack allows.
#[inline(always)]
fn word_at(src: &[u8], p: usize, n: u32) -> u64 {
    debug_assert!(p + 8 <= src.len());
    // SAFETY: `p` lies at or before the input end, so `p + 8` lies inside
    // the slack.
    let w = unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() };
    w & (u64::MAX >> (64 - 8 * n))
}

/// `s` as a little-endian integer.
const fn word(s: &[u8]) -> u64 {
    let mut w = 0u64;
    let mut i = 0;
    while i < s.len() {
        w |= (s[i] as u64) << (8 * i);
        i += 1;
    }
    w
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

/// The end of the word at `p`: bytes up to a word end, or up to a `!`,
/// `+`, or `?` right before `=` (`$makeScanWord`). NUL is a word end, so
/// the input end stops the scan.
#[inline(always)]
fn scan_word(src: &[u8], mut p: usize, end: usize) -> usize {
    let _ = end;
    loop {
        // (the first stop lies at or before the input end)
        p = find_set(src, p, &WORD_STOP_NIB, &WORD_STOP);
        if !BANG_PLUS_QUERY[at(src, p) as usize] || at(src, p + 1) == b'=' {
            return p;
        }
        p += 1;
    }
}

/// Skip spaces and tabs from `p` on the current line (`$lexSkipSpaceAt`).
/// The NUL after the input stops it.
#[inline(always)]
fn skip_space_at(src: &[u8], mut p: usize) -> usize {
    while at(src, p) == b' ' || at(src, p) == b'\t' {
        p += 1;
    }
    p
}

/// The end of the run of `table` bytes from `p` (`$scanIdentRun`). The
/// NUL after the input ends every run.
#[inline(always)]
fn ident_run(src: &[u8], mut p: usize, table: &[bool; 256]) -> usize {
    while table[at(src, p) as usize] {
        p += 1;
    }
    p
}

/// Whether `[lhs, rhs)` spells `endef` (`$makeIsEndef`).
#[inline(always)]
fn is_endef(src: &[u8], lhs: usize, rhs: usize) -> bool {
    rhs - lhs == 5 && word_at(src, lhs, 5) == word(b"endef")
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

/// Whether a target-specific assignment follows a rule's `:` at `p`
/// (`$makeTargetVar`).
fn target_var(src: &[u8], p: usize) -> bool {
    let p = skip_space_at(src, p);
    let mut q = p;
    loop {
        let c = at(src, q);
        if !(is_ident_continue(c) || c == b'-' || c == b'.') {
            break;
        }
        q += 1;
    }
    if q == p {
        return false;
    }
    q = skip_space_at(src, q);
    let c = at(src, q);
    if BANG_PLUS_QUERY[c as usize] {
        q += 1;
    }
    if c == b':' {
        q += 1;
        if at(src, q) == b':' {
            q += 1;
        }
    }
    at(src, q) == b'='
}

/// Classify the logical line at `p` by its first unbracketed separator:
/// 1 a rule, 2 an assignment, 3 a rule with a target-specific assignment,
/// 0 none (`$makeLineKind`).
fn line_kind(src: &[u8], mut p: usize, end: usize) -> u32 {
    loop {
        // the scan stops at the input end itself
        #[cfg(target_arch = "aarch64")]
        {
            // SAFETY: each load starts before the input end, inside the
            // slack.
            unsafe {
                let hi_t = vld1q_u8(LINE_KIND_NIB.0.as_ptr());
                let lo_t = vld1q_u8(LINE_KIND_NIB.1.as_ptr());
                loop {
                    if p >= end {
                        return 0;
                    }
                    let v = vld1q_u8(src.as_ptr().add(p));
                    let hi = vqtbl1q_u8(hi_t, vshrq_n_u8::<4>(v));
                    let lo = vqtbl1q_u8(lo_t, vandq_u8(v, vdupq_n_u8(15)));
                    let k = scan::first_lane(vtstq_u8(hi, lo));
                    if k < 16 {
                        p += k;
                        break;
                    }
                    p += 16;
                }
            }
        }
        #[cfg(not(target_arch = "aarch64"))]
        while p < end && !LINE_KIND_STOP[at(src, p) as usize] {
            p += 1;
        }
        if p >= end {
            return 0;
        }
        let mut c = at(src, p);
        match c {
            b'$' => {
                let open = at(src, p + 1);
                if open == b'(' || open == b'{' {
                    let close = if open == b'(' { b')' } else { b'}' };
                    let mut depth = 1u32;
                    p += 2;
                    while depth != 0 {
                        if p >= end {
                            return 0;
                        }
                        let c = at(src, p);
                        if c == b'\n' || c == b'\r' || c == b'#' {
                            return 0;
                        }
                        if c == open {
                            depth = depth.wrapping_add(1);
                        }
                        if c == close {
                            depth = depth.wrapping_sub(1);
                        }
                        p += 1;
                    }
                    continue;
                }
                p += 1;
            }
            b'=' => return 2,
            b':' => {
                p += 1;
                c = at(src, p);
                if c == b':' {
                    p += 1;
                    c = at(src, p);
                }
                if c == b'=' {
                    return 2;
                }
                return if target_var(src, p) { 3 } else { 1 };
            }
            // a line break or a comment
            _ => return 0,
        }
    }
}

/// [`dollar`] for a reference nested in another one's body.
#[inline(never)]
fn dollar_nested(src: &[u8], end: usize, ptr: usize, out: &mut Out, nest: u32) -> usize {
    dollar(src, end, ptr, out, nest)
}

/// The reference or escape whose `$` sits at `ptr`; `nest` counts the
/// enclosing references. Returns the end (`$makeDollar`).
#[inline(always)]
fn dollar(src: &[u8], end: usize, mut ptr: usize, out: &mut Out, nest: u32) -> usize {
    let mut o = *out;
    let c = at(src, ptr + 1);
    if !(c == b'(' || c == b'{') {
        if c == b'$' {
            ptr += 2;
            let n = at(src, ptr);
            if is_ident_start(n) && n != b'$' {
                ptr = ident_run(src, ptr, &IDENT_RUN);
            }
            o.tok(tok::VARIABLE, ptr);
        } else if AUTO_VAR[c as usize] {
            ptr += 2;
            o.tok(tok::VARIABLE_SPECIAL, ptr);
        } else if is_ident_start(c) && c != b'$' {
            ptr = scan::utf8_span_end(src, ptr + 2, end);
            o.tok(tok::VARIABLE, ptr);
        } else {
            ptr += 1;
            o.tok(tok::NONE, ptr);
        }
        *out = o;
        return ptr;
    }
    let open = c;
    let close = if c == b'(' { b')' } else { b'}' };
    ptr += 2;
    o.tok(tok::PUNCTUATION_SPECIAL, ptr);
    let mut lhs = ptr;
    ptr = skip_space_at(src, ptr);
    o.gap(lhs, ptr);
    lhs = ptr;
    let c = at(src, ptr);
    // the head: an automatic variable with its D/F modifier, or a word
    if AUTO_VAR[c as usize] {
        ptr += 1;
        if at(src, ptr) | 2 == b'F' {
            ptr += 1;
        }
        o.tok(tok::VARIABLE_SPECIAL, ptr);
    } else {
        // (NUL ends the head, so the scan stops at the input end)
        ptr = find_set(src, ptr, &HEAD_STOP_NIB, &HEAD_STOP);
        let rhs = ptr;
        if rhs > lhs {
            let next = at(src, skip_space_at(src, rhs));
            // `addprefix` cannot sit in the table beside `addsuffix`
            let hl = if next != close
                && (WORDS.group(src, lhs, rhs) == 5
                    || (rhs - lhs == 9
                        && word_at(src, lhs, 8) == word(b"addprefi")
                        && at(src, lhs + 8) == b'x'))
            {
                tok::FUNCTION
            } else {
                tok::VARIABLE
            };
            o.tok(hl, rhs);
            // `$(NAME)`: the closer right after the head
            if next == close && at(src, rhs) == close {
                ptr += 1;
                o.tok(tok::PUNCTUATION_SPECIAL, ptr);
                *out = o;
                return ptr;
            }
        }
    }
    // the body up to the balancing closer: nested references, argument
    // separators, and plain runs
    let mut depth = 0u32;
    lhs = ptr;
    while ptr < end {
        let c = at(src, ptr);
        if c == close {
            if depth == 0 {
                o.emit(tok::NONE, lhs, ptr);
                ptr += 1;
                o.tok(tok::PUNCTUATION_SPECIAL, ptr);
                *out = o;
                return ptr;
            }
            depth = depth.wrapping_sub(1);
        } else if c == open {
            depth = depth.wrapping_add(1);
        } else if BODY_STOP[c as usize] {
            if c == b'\n' || c == b'\r' {
                break;
            }
            if c == b'$' && nest < 64 {
                o.emit(tok::NONE, lhs, ptr);
                let mut t = o;
                ptr = dollar_nested(src, end, ptr, &mut t, nest + 1);
                o = t;
                lhs = ptr;
                continue;
            }
            if c == b',' && depth == 0 {
                o.emit(tok::NONE, lhs, ptr);
                ptr += 1;
                o.tok(tok::PUNCTUATION_DELIMITER, ptr);
                lhs = ptr;
                continue;
            }
        }
        // (UTF-8 continuation bytes never stop the body, so stepping one
        // byte at a time ends where `$utf8SpanEnd` steps end)
        ptr += 1;
    }
    o.emit(tok::NONE, lhs, ptr);
    *out = o;
    ptr
}

/// A double-quoted string in a recipe, with `$` references and `\`
/// escapes. Returns the end (`$makeQuoted`).
#[inline(never)]
fn quoted(src: &[u8], end: usize, mut ptr: usize, out: &mut Out) -> usize {
    let mut o = *out;
    let mut seg = ptr;
    ptr += 1;
    while ptr < end {
        let c = at(src, ptr);
        if !QUOTED_STOP[c as usize] {
            // (UTF-8 continuation bytes never stop the string, so stepping
            // one byte at a time ends where `$utf8SpanEnd` steps end)
            ptr += 1;
            continue;
        }
        if c == b'\n' || c == b'\r' {
            break;
        }
        if c == b'"' {
            ptr += 1;
            break;
        }
        if c == b'\\' {
            o.emit(tok::STRING, seg, ptr);
            let e = escape_end(src, ptr, end);
            o.emit(tok::STRING_ESCAPE, ptr, e);
            ptr = e;
            seg = e;
            continue;
        }
        // `$`
        o.emit(tok::STRING, seg, ptr);
        ptr = dollar(src, end, ptr, &mut o, 0);
        seg = ptr;
    }
    o.emit(tok::STRING, seg, ptr);
    *out = o;
    ptr
}

/// The `\` at `ptr` before blanks and a line break, or the input end,
/// joins the next line: emit the backslash and consume the break as a gap,
/// returning the new position. `None`, consuming nothing, before any other
/// byte (`$dockerLineJoin`).
#[inline(always)]
fn line_join(src: &[u8], end: usize, ptr: usize, o: &mut Out) -> Option<usize> {
    let mut p = skip_space_at(src, ptr + 1);
    if p < end {
        let c = at(src, p);
        if c != b'\n' && c != b'\r' {
            return None;
        }
        p += 1;
        if c == b'\r' && at(src, p) == b'\n' {
            p += 1;
        }
    }
    let p = p.min(end);
    o.tok(tok::PUNCTUATION_SPECIAL, ptr + 1);
    o.gap(ptr + 1, p);
    Some(p)
}

/// Lex the Makefile input of `len` bytes at `base` (`$hlMakefile`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, which is not
    // reallocated while this lexer runs.
    let src: &[u8] = unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) };
    let end = len;
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
            let p = $f(src, end, $($arg,)* &mut t);
            o = t;
            p
        }};
    }

    let mut line_head = true;
    let mut mode = 0u32;
    let mut targets = false;
    let mut expect_var = false;
    let mut cmd_head = false;
    let mut in_rule = false;
    let mut define = false;

    // `$lexEmitLeadingContinuation` and the leading whitespace: one gap,
    // which writes the first record when there is none yet. The line state
    // is already that of a line start, and the TAB-led line test needs a
    // rule or define before it, so only the record changes.
    let mut ptr = scan::utf8_span_end(src, 0, end);
    while SPACE[at(src, ptr) as usize] != 0 {
        ptr += 1;
    }
    if ptr > 0 {
        if o.cur == start {
            o.tok(tok::NONE, ptr);
        } else {
            o.gap(0, ptr);
        }
    }
    loop {
        let gap = ptr;
        let mut c = at(src, ptr);
        // `p` is the line's first byte: after the last CR or LF in the
        // gap, or the gap start when the gap holds none
        let mut p = gap;
        if c == b' ' && SPACE[at(src, ptr + 1) as usize] == 0 {
            // one space
            ptr += 1;
            o.gap(gap, ptr);
            c = at(src, ptr);
        } else if c == b'\n' && SPACE[at(src, ptr + 1) as usize] == 0 {
            // one line break
            ptr += 1;
            p = ptr;
            line_head = true;
            o.gap(gap, ptr);
            c = at(src, ptr);
        } else if SPACE[c as usize] != 0 {
            loop {
                let k = SPACE[c as usize];
                if k == 0 {
                    break;
                }
                ptr += 1;
                if k == 2 {
                    p = ptr;
                }
                c = at(src, ptr);
            }
            if p > gap {
                line_head = true;
            }
            o.gap(gap, ptr);
        }
        if ptr >= end {
            break;
        }
        let lhs = ptr;

        // Words in the middle of a line, the most common tokens, skip the
        // rule chain: no rule before the word rule matches their first
        // byte.
        if !line_head && (PLAIN_WORD[c as usize] || (c == b'-' && !(mode == RECIPE && cmd_head))) {
            ptr = scan_word(src, ptr + 1, end);
            let c2 = at(src, lhs + 1);
            let mut hl = tok::NONE;
            if expect_var {
                hl = tok::VARIABLE;
                expect_var = false;
            } else if targets {
                // `.PHONY` and the other special targets
                hl = if c == b'.' && c2.wrapping_sub(b'A') <= 25 {
                    tok::KEYWORD
                } else {
                    tok::FUNCTION
                };
            } else if mode == RECIPE {
                if cmd_head {
                    hl = tok::FUNCTION;
                    cmd_head = false;
                } else if is_digit(c)
                    && !is_ident_continue(at(src, ptr))
                    && number_end(src, lhs) == ptr
                {
                    hl = tok::NUMBER;
                }
            }
            o.tok(hl, ptr);
            continue;
        }
        let c2 = at(src, ptr + 1);

        if line_head {
            line_head = false;
            mode = PLAIN;
            targets = false;
            expect_var = false;
            cmd_head = false;
            if c == b'#' {
                ptr = scan::line_end(src, ptr + 1, end);
                o.tok(tok::COMMENT, ptr);
                continue;
            }
            if p < ptr && at(src, p) == b'\t' {
                // a TAB-led line is a recipe under a rule and a body line
                // inside a define
                if in_rule {
                    mode = RECIPE;
                    cmd_head = true;
                }
                if define {
                    mode = DEFINE_BODY;
                }
            }
            if mode != RECIPE {
                if define {
                    mode = DEFINE_BODY;
                    let rhs = scan_word(src, ptr, end);
                    if is_endef(src, lhs, rhs) {
                        ptr = rhs;
                        o.tok(tok::KEYWORD, ptr);
                        define = false;
                        continue;
                    }
                } else {
                    let kind = line_kind(src, ptr, end);
                    in_rule = kind == 1;
                    if kind == 1 {
                        mode = RULE;
                        targets = true;
                    }
                    if kind == 3 {
                        mode = RULE_VAR;
                        targets = true;
                    }
                    if kind == 2 {
                        mode = ASSIGN;
                        expect_var = true;
                    }
                    // a directive word heads the line
                    if is_ident_start(c) || c == b'-' {
                        let rhs = scan_word(src, ptr, end);
                        let g = WORDS.group(src, lhs, rhs);
                        if (1..=4).contains(&g) {
                            ptr = rhs;
                            let hl = if g == 1 {
                                tok::KEYWORD_CONTROL
                            } else if g == 2 {
                                tok::KEYWORD_IMPORT
                            } else {
                                tok::KEYWORD
                            };
                            o.emit(hl, lhs, ptr);
                            in_rule = false;
                            targets = false;
                            if g >= 3 {
                                expect_var = true;
                                if mode != ASSIGN {
                                    mode = PLAIN;
                                }
                            }
                            if g == 3 {
                                define = true;
                            }
                            // `else ifeq (...)`: the next word heads the line
                            if ptr - lhs == 4 && word_at(src, lhs, 4) == word(b"else") {
                                line_head = true;
                            }
                            continue;
                        }
                        if is_endef(src, lhs, rhs) {
                            ptr = rhs;
                            o.tok(tok::KEYWORD, ptr);
                            continue;
                        }
                    }
                }
            }
        }

        match c {
            // `\` before the line break continues the logical line
            b'\\' => {
                if let Some(q) = line_join(src, end, ptr, &mut o) {
                    ptr = q;
                    continue;
                }
                // `\#` is a literal `#`, not a comment
                if c2 == b'#' {
                    ptr += 2;
                    o.tok(tok::STRING_ESCAPE, ptr);
                    continue;
                }
                ptr = scan::utf8_span_end(src, ptr + 1, end);
                o.tok(tok::NONE, ptr);
                continue;
            }
            b'#' => {
                // `$lexLineComment`
                ptr = scan::line_end(src, ptr + 1, end);
                o.tok(tok::COMMENT, ptr);
                continue;
            }
            b'$' => {
                ptr = dollar(src, end, ptr, &mut o, 0);
                cmd_head = false;
                expect_var = false;
                continue;
            }
            _ => {}
        }

        // the assignment operator: `=`, `:=`, `::=`, `?=`, `+=`, `!=`
        if mode == ASSIGN
            && (c == b'='
                || ((BANG_PLUS_QUERY[c as usize] || c == b':')
                    && (c2 == b'=' || (c2 == b':' && at(src, ptr + 2) == b'='))))
        {
            ptr += 1;
            while at(src, ptr) == b':' {
                ptr += 1;
            }
            if at(src, ptr) == b'=' {
                ptr += 1;
            }
            o.tok(tok::OPERATOR, ptr);
            expect_var = false;
            continue;
        }
        // a rule's separator, order-only bar, and inline recipe
        if mode == RULE || mode == RULE_VAR {
            if c == b':' || c == b'&' {
                ptr += 1;
                if at(src, ptr) == b':' {
                    ptr += 1;
                }
                o.tok(tok::PUNCTUATION_DELIMITER, ptr);
                targets = false;
                // a target-specific assignment follows its rule's `:`
                if mode == RULE_VAR {
                    mode = ASSIGN;
                    expect_var = true;
                }
                continue;
            }
            if c == b'|' {
                ptr += 1;
                o.tok(tok::OPERATOR, ptr);
                continue;
            }
            if c == b';' {
                ptr += 1;
                o.tok(tok::PUNCTUATION_DELIMITER, ptr);
                mode = RECIPE;
                cmd_head = true;
                continue;
            }
        }
        // recipe text is shell: strings, operators, and command words
        if mode == RECIPE {
            if (c == b'+' || c == b'-' || c == b'@') && cmd_head {
                ptr += 1;
                o.tok(tok::OPERATOR, ptr);
                continue;
            }
            if c == b'\'' {
                // `$lexRawString`: to the closing quote or the line break
                ptr = scan::find3(src, ptr + 1, end, b'\'', b'\n', b'\r');
                if ptr < end && at(src, ptr) == b'\'' {
                    ptr += 1;
                }
                o.tok(tok::STRING, ptr);
                cmd_head = false;
                continue;
            }
            if c == b'"' {
                ptr = call!(quoted(ptr));
                cmd_head = false;
                continue;
            }
            if SHELL_OP[c as usize] {
                while SHELL_OP[at(src, ptr) as usize] {
                    ptr += 1;
                }
                o.tok(tok::OPERATOR, ptr);
                if c == b';' || c == b'&' || c == b'|' {
                    cmd_head = true;
                }
                continue;
            }
            if c == b'(' || c == b')' {
                ptr += 1;
                o.tok(tok::PUNCTUATION_BRACKET, ptr);
                continue;
            }
        }
        if c == b'(' || c == b')' || c == b',' {
            ptr += 1;
            let hl = if c == b',' {
                tok::PUNCTUATION_DELIMITER
            } else {
                tok::PUNCTUATION_BRACKET
            };
            o.tok(hl, ptr);
            continue;
        }

        // a word: target, variable name, command, or plain text
        if !WORD_END[c as usize] {
            ptr = scan_word(src, ptr, end);
            if ptr == lhs {
                ptr = scan::utf8_span_end(src, ptr + 1, end);
            }
            let rhs = ptr;
            let mut hl = tok::NONE;
            if expect_var {
                hl = tok::VARIABLE;
                expect_var = false;
            } else if targets {
                // `.PHONY` and the other special targets
                hl = if c == b'.' && c2.wrapping_sub(b'A') <= 25 {
                    tok::KEYWORD
                } else {
                    tok::FUNCTION
                };
            } else if mode == RECIPE && cmd_head {
                hl = tok::FUNCTION;
                cmd_head = false;
            } else if mode == RECIPE
                && is_digit(c)
                && !is_ident_continue(at(src, rhs))
                && number_end(src, lhs) == rhs
            {
                hl = tok::NUMBER;
            }
            o.tok(hl, ptr);
            continue;
        }

        ptr = scan::utf8_span_end(src, ptr + 1, end);
        o.tok(tok::NONE, ptr);
        cmd_head = false;
    }
    // SAFETY: the records before `cur` are written.
    unsafe { inst.ext.recs.set_len(o.cur.offset_from(start) as usize) };
}
