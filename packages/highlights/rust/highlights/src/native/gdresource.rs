//! WAT sources: src/langs/gdresource.wat src/langs/gdscript.wat src/langs/python.wat src/common.wat src/scan.wat
//!
//! Native Godot resource (`.tres`, `.tscn`) lexer. Section headers
//! (`[gd_scene ...]`) name their kind as a tag; `key = value` lines color
//! the key as a property, including TileSet keys such as `0:0/0/terrain`;
//! values are numbers, built-in types, `ExtResource(...)` calls, and
//! strings that may span lines. The records equal the translated
//! `gdresource` lexer's records.

#[cfg(target_arch = "aarch64")]
use core::arch::aarch64::*;

use super::Lexer;
use super::scan;
use super::tables::KeywordTable;
use crate::Rec;
use crate::generated::Instance;
use crate::token_ids as tok;
use crate::wat_tables::{GD_PACKED_WORDS, GD_RESOURCE_WORDS, GD_TYPES};

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "gdresource" => Some(highlight),
        _ => None,
    }
}

/// `$gdResourceWords`: each value is the word's token.
static WORDS: KeywordTable<128> = KeywordTable::new(GD_RESOURCE_WORDS);

/// `$gdTypes`.
static TYPES: KeywordTable<512> = KeywordTable::new(GD_TYPES);

/// `$gdPackedWords`.
static PACKED: KeywordTable<64> = KeywordTable::new(GD_PACKED_WORDS);

/// The token of a one-byte token that is no name, number, or string:
/// brackets, delimiters, and operators for the rest.
static PUNCT: [u8; 256] = {
    let mut t = [tok::OPERATOR as u8; 256];
    let brackets = b"()[]{}";
    let mut i = 0;
    while i < brackets.len() {
        t[brackets[i] as usize] = tok::PUNCTUATION_BRACKET as u8;
        i += 1;
    }
    let delimiters = b",:.";
    i = 0;
    while i < delimiters.len() {
        t[delimiters[i] as usize] = tok::PUNCTUATION_DELIMITER as u8;
        i += 1;
    }
    t
};

/// Whitespace: space and TAB through CR (`$lexIsSpace`).
static SPACE: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = b == b' ' || b.wrapping_sub(9) <= 4;
        c += 1;
    }
    t
};

/// Identifier starts (`$lexIsIdentStart`).
static IDENT_START: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = is_ident_start(c as u8);
        c += 1;
    }
    t
};

/// Identifier bytes with `$` (`$lexScanIdent`).
static IDENT: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = is_ident_continue(c as u8);
        c += 1;
    }
    t
};

/// The byte at `i`. Callers read at most 16 bytes past the input end, which
/// the 96-byte input slack covers. The byte at the input end is NUL, so a
/// lookahead one byte past a token needs no bounds check when NUL can't
/// match what it looks for.
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

/// The first 8 bytes at `p` as a little-endian integer. `p` lies at or
/// before the input end, so they lie inside the slack.
#[inline(always)]
fn u64_at(src: &[u8], p: usize) -> u64 {
    debug_assert!(p + 8 <= src.len());
    // SAFETY: see above.
    u64::from_le(unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() })
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

/// The end of the identifier run from `p`: `[A-Za-z0-9_$]` and bytes from
/// 0x80 (`$lexScanIdent`, `$scanIdentRun`). The NUL after the input ends
/// every run.
#[inline(always)]
fn ident_end(src: &[u8], mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..24 {
        if !IDENT[at(src, p) as usize] {
            return p;
        }
        p += 1;
    }
    #[cfg(target_arch = "aarch64")]
    // SAFETY: each 16-byte load starts at or before the NUL after the
    // input, inside the slack.
    unsafe {
        loop {
            let v = vld1q_u8(src.as_ptr().add(p));
            let alpha = vcleq_u8(
                vsubq_u8(vorrq_u8(v, vdupq_n_u8(0x20)), vdupq_n_u8(b'a')),
                vdupq_n_u8(25),
            );
            let digit = vcleq_u8(vsubq_u8(v, vdupq_n_u8(b'0')), vdupq_n_u8(9));
            let extra = vorrq_u8(vceqq_u8(v, vdupq_n_u8(b'_')), vceqq_u8(v, vdupq_n_u8(b'$')));
            let high = vcltzq_s8(vreinterpretq_s8_u8(v));
            let ok = vorrq_u8(vorrq_u8(alpha, digit), vorrq_u8(extra, high));
            let k = scan::first_lane(vmvnq_u8(ok));
            if k < 16 {
                return p + k;
            }
            p += 16;
        }
    }
    #[cfg(not(target_arch = "aarch64"))]
    {
        while IDENT[at(src, p) as usize] {
            p += 1;
        }
        p
    }
}

/// The end of the number at `p` (`$lexScanNumber`, `$lexScanNumberBody`).
/// The NUL after the input stops it.
fn number_end(src: &[u8], mut p: usize) -> usize {
    let hex = at(src, p) == b'0' && at(src, p + 1) | 0x20 == b'x';
    let mut prev = 0u8;
    loop {
        let c = at(src, p);
        if IDENT[c as usize] {
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

/// The end of the escape at backslash `p` (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(src: &[u8], p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(src, p + 2, end);
    if e == p + 2 && at(src, p + 1) == b'\r' && e < end && at(src, e) == b'\n' {
        e += 1;
    }
    e
}

/// The end of at most `max` hex digits from `p`, bounded by `end`
/// (`$scanHexRun`).
#[inline(always)]
fn hex_run(src: &[u8], mut p: usize, max: usize, end: usize) -> usize {
    let stop = (p + max).min(end);
    while p < stop {
        let c = at(src, p);
        if !(is_digit(c) || (c | 32).wrapping_sub(b'a') <= 5) {
            break;
        }
        p += 1;
    }
    p
}

/// The built-in type token of the name `[lhs, rhs)`, or -1: the integer
/// vectors share their float twins' entries, `Transform3D` and the packed
/// arrays are matched apart (`$gdTypeHl`).
fn type_hl(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    let len = rhs - lhs;
    let mut rhs = rhs;
    let w = u64_at(src, lhs);
    if len == 8 && w & 0xffff_ffff_ffff == word(b"Vector") && at(src, lhs + 7) == b'i' {
        rhs -= 1;
    }
    if len == 11 && w == word(b"Transfor") && u64_at(src, lhs + 7) as u32 == word(b"rm3D") as u32 {
        return tok::TYPE_BUILTIN as i32;
    }
    if len >= 15
        && w & 0xffff_ffff_ffff == word(b"Packed")
        && u64_at(src, rhs - 5) & 0xff_ffff_ffff == word(b"Array")
    {
        return PACKED.value(src, lhs + 6, rhs - 5);
    }
    TYPES.value(src, lhs, rhs)
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

/// The nearest byte before `p` on its line that is not a space or tab,
/// or 0 at the line's (or the input's) start (`$lexLineByteBefore`).
#[inline(always)]
fn line_byte_before(src: &[u8], mut p: usize) -> u8 {
    while p > 0 {
        p -= 1;
        let c = at(src, p);
        if c == b'\n' || c == b'\r' {
            return 0;
        }
        if c != b' ' && c != b'\t' {
            return c;
        }
    }
    0
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

/// A double-quoted string body from `ptr`, with the bytes since `seg`
/// (its opening quote) not yet emitted: it spans lines, and escapes get
/// their own tokens, with Godot's `\uXXXX` and `\UXXXXXX`. Returns the
/// end (`$pyStringBody` with one quote byte, multiline, not raw, without
/// format fields, with `$hexU` 6).
#[inline(never)]
fn string_body(src: &[u8], end: usize, mut ptr: usize, mut seg: usize, out: &mut Out) -> usize {
    let mut o = *out;
    loop {
        ptr = scan::find3(src, ptr, end, b'"', b'\\', b'"');
        if ptr >= end {
            break;
        }
        if at(src, ptr) == b'"' {
            ptr += 1;
            break;
        }
        // A backslash escapes the next character, or continues the line
        // when it precedes LF or CRLF.
        let mut e = escape_end(src, ptr, end);
        if ptr + 1 < end {
            let u = at(src, ptr + 1);
            if u == b'u' || u == b'U' {
                e = hex_run(src, e, if u == b'u' { 4 } else { 6 }, end);
            }
        }
        o.emit(tok::STRING, seg, ptr);
        o.emit(tok::STRING_ESCAPE, ptr, e);
        seg = e;
        ptr = e;
    }
    o.emit(tok::STRING, seg, ptr);
    *out = o;
    ptr
}

/// Lex the Godot resource input of `len` bytes at `base`
/// (`$hlGdresource`).
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

    // right after a `[` that starts its line: the next name is a section
    // kind
    let mut header = false;

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
    while ptr < end {
        let gap = ptr;
        let b = at(src, ptr);
        if (b == b' ' || b == b'\n') && !SPACE[at(src, ptr + 1) as usize] {
            // one space or line break
            ptr += 1;
        } else {
            while SPACE[at(src, ptr) as usize] {
                ptr += 1;
            }
        }
        o.gap(gap, ptr);
        if ptr >= end {
            break;
        }
        let lhs = ptr;
        let mut c = at(src, ptr);

        // Names, the most common tokens, come first: no earlier rule
        // matches a name's first byte.
        if IDENT_START[c as usize] {
            ptr = ident_end(src, ptr + 1);
            while at(src, ptr) == b'/' {
                ptr = ident_end(src, ptr + 1);
            }
            let p = skip_space_at(src, ptr);
            // (a key before `=` is a property whatever the tables say)
            if at(src, p) == b'=' {
                o.tok(tok::PROPERTY, ptr);
                header = false;
                continue;
            }
            let mut hl = WORDS.value(src, lhs, ptr);
            if hl == tok::TAG as i32 && !header {
                hl = -1;
            }
            if hl < 0 {
                hl = type_hl(src, lhs, ptr);
            }
            if hl < 0 {
                hl = if c.wrapping_sub(b'A') <= 25 {
                    tok::TYPE
                } else {
                    tok::VARIABLE
                } as i32;
            }
            o.tok(hl as u32, ptr);
            header = false;
            continue;
        }
        if c == b';' {
            ptr = scan::line_end(src, ptr + 1, end);
            o.tok(tok::COMMENT, ptr);
            continue;
        }
        if c == b'&' && at(src, ptr + 1) == b'"' {
            ptr += 1;
            c = b'"';
        }
        if c == b'"' {
            // A string without escapes is one token.
            let q = scan::find3(src, ptr + 1, end, b'"', b'\\', b'"');
            if q < end && at(src, q) == b'"' {
                ptr = q + 1;
                o.tok(tok::STRING, ptr);
            } else {
                let mut t = o;
                ptr = string_body(src, end, ptr + 1, lhs, &mut t);
                o = t;
            }
            header = false;
            continue;
        }
        // TileSet keys such as `0:0/0/terrain = 1` must be checked before
        // numbers.
        if c.wrapping_sub(b'0') <= 9 && line_byte_before(src, lhs) == 0 {
            let mut q = ident_end(src, ptr);
            while at(src, q) == b'/' || at(src, q) == b':' {
                q = ident_end(src, q + 1);
            }
            if at(src, skip_space_at(src, q)) == b'=' {
                ptr = q;
                o.tok(tok::PROPERTY, ptr);
                header = false;
                continue;
            }
        }
        if c.wrapping_sub(b'0') <= 9 || (c == b'.' && at(src, ptr + 1).wrapping_sub(b'0') <= 9) {
            ptr = number_end(src, ptr);
            o.tok(tok::NUMBER, ptr);
            header = false;
            continue;
        }
        // Brackets inside values must not open section headers.
        header = c == b'[' && line_byte_before(src, lhs) == 0;
        let hl = PUNCT[c as usize] as u32;
        ptr += 1;
        o.tok(hl, ptr);
    }
    // SAFETY: the records before `cur` are written.
    unsafe { inst.ext.recs.set_len(o.cur.offset_from(start) as usize) };
}
