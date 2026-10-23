//! WAT sources: src/langs/gdscript.wat src/langs/python.wat src/common.wat src/scan.wat
//!
//! Native GDScript lexer. Names are colored from the keyword and built-in
//! type tables, by case (constants, types), and by position (after
//! `func`/`class`, after `.`, before `(`); `$Node/Path` and `%Unique`
//! node references, `@annotations`, and Python-style strings with Godot
//! escapes and `r`/`&`/`^` prefixes. The records equal the translated
//! `gdscript` lexer's records.

#[cfg(target_arch = "aarch64")]
use core::arch::aarch64::*;

use super::Lexer;
use super::scan;
use super::tables::{KeywordTable, byteset};
use crate::Rec;
use crate::generated::Instance;
use crate::token_ids as tok;
use crate::wat_tables::{GD_PACKED_WORDS, GD_TYPES, GD_WORDS};

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "gdscript" => Some(highlight),
        _ => None,
    }
}

/// `$gdWords`: each value is a token plus a declaration kind from bit 8.
static WORDS: KeywordTable<1024> = KeywordTable::new(GD_WORDS);

/// `$gdTypes`.
static TYPES: KeywordTable<512> = KeywordTable::new(GD_TYPES);

/// `$gdPackedWords`.
static PACKED: KeywordTable<64> = KeywordTable::new(GD_PACKED_WORDS);

/// Whether a name colored with each token is an operand, after which `%`
/// is the modulo operator: all but operator, control, and declaration
/// keywords.
static OPERAND_AFTER: [bool; 256] = {
    let mut t = [true; 256];
    t[tok::KEYWORD_OPERATOR as usize] = false;
    t[tok::KEYWORD_CONTROL as usize] = false;
    t[tok::KEYWORD_DECLARATION as usize] = false;
    t
};

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
    let delimiters = b",;:.";
    i = 0;
    while i < delimiters.len() {
        t[delimiters[i] as usize] = tok::PUNCTUATION_DELIMITER as u8;
        i += 1;
    }
    t
};

/// String prefixes before a quote (`r`, `&`, `^`, `$`).
static PREFIX: [bool; 256] = byteset(b"r&^$");

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
    for _ in 0..8 {
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

/// SCREAMING_CASE: at least two bytes, one uppercase letter, and only
/// `[A-Z0-9_]` (`$lexIsConstCase`).
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

/// A string body from `ptr` with the bytes since `seg` (its prefix and
/// opening quote) not yet emitted: escapes get their own tokens unless
/// `raw`, with Godot's `\uXXXX` and `\UXXXXXX`; a triple-quoted body spans
/// lines. Returns the end (`$pyStringBody` without format fields, with
/// `$hexU` 6; the status only matters to a stream).
#[inline(never)]
#[allow(clippy::too_many_arguments)]
fn string_body(
    src: &[u8],
    end: usize,
    mut ptr: usize,
    quote: u8,
    raw: bool,
    triple: bool,
    mut seg: usize,
    out: &mut Out,
) -> usize {
    let mut o = *out;
    loop {
        ptr = if triple {
            scan::find3(src, ptr, end, quote, b'\\', quote)
        } else {
            scan::string_special(src, ptr, end, quote)
        };
        if ptr >= end {
            break;
        }
        let c = at(src, ptr);
        if c == quote {
            if triple {
                if ptr + 2 < end && at(src, ptr + 1) == quote && at(src, ptr + 2) == quote {
                    ptr += 3;
                    break;
                }
            } else {
                ptr += 1;
                break;
            }
        }
        if !triple && (c == b'\n' || c == b'\r') {
            break;
        }
        // A backslash escapes the next character, or continues the line
        // when it precedes LF or CRLF. Raw literals keep the bytes as plain
        // body.
        if c == b'\\' {
            let mut e = escape_end(src, ptr, end);
            if !raw {
                if ptr + 1 < end {
                    let u = at(src, ptr + 1);
                    if u == b'u' || u == b'U' {
                        e = hex_run(src, e, if u == b'u' { 4 } else { 6 }, end);
                    }
                }
                o.emit(tok::STRING, seg, ptr);
                o.emit(tok::STRING_ESCAPE, ptr, e);
                seg = e;
            }
            ptr = e;
            continue;
        }
        ptr += 1;
    }
    o.emit(tok::STRING, seg, ptr);
    *out = o;
    ptr
}

/// Lex the GDScript input of `len` bytes at `base` (`$hlGdscript`).
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

    // 1 after `func`/`signal`, 2 after `class`/`class_name`/`enum`
    let mut decl = 0u32;
    // after `.`
    let mut member = false;
    // after a value, where `%` is the modulo operator
    let mut operand = false;

    // `$lexEmitLeadingContinuation` and the leading whitespace: one gap,
    // which writes the first record when there is none yet. Its line
    // breaks clear state that is already clear.
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
        let mut brk = false;
        while SPACE[at(src, ptr) as usize] {
            brk |= at(src, ptr) == b'\n' || at(src, ptr) == b'\r';
            ptr += 1;
        }
        if brk {
            operand = false;
            decl = 0;
        }
        o.gap(gap, ptr);
        if ptr >= end {
            break;
        }
        let lhs = ptr;
        let mut c = at(src, ptr);
        let n = at(src, ptr + 1);

        // Names, the most common tokens, skip the rule chain: no earlier
        // rule matches a name's first byte but `$` (a node path) and an `r`
        // before a quote (a raw string).
        if is_ident_start(c) && c != b'$' && !(c == b'r' && (n == b'"' || n == b'\'')) {
            ptr = ident_end(src, ptr + 1);
            let mut p = ptr;
            while at(src, p) == b' ' || at(src, p) == b'\t' {
                p += 1;
            }
            let call = at(src, p) == b'(';
            let group = WORDS.value(src, lhs, ptr);
            let mut hl = (group & 255) as u32;
            if group < 0 {
                let t = type_hl(src, lhs, ptr);
                hl = t as u32;
                if t < 0 {
                    hl = if is_const_case(src, lhs, ptr) {
                        tok::CONSTANT
                    } else if c.wrapping_sub(b'A') <= 25 {
                        tok::TYPE
                    } else if call {
                        tok::FUNCTION
                    } else {
                        tok::VARIABLE
                    };
                }
            }
            if decl != 0 {
                hl = if decl == 1 {
                    tok::FUNCTION_DEFINITION
                } else {
                    tok::TYPE
                };
            }
            if member {
                hl = if call {
                    tok::FUNCTION_METHOD
                } else {
                    tok::PROPERTY
                };
            }
            o.tok(hl, ptr);
            decl = if hl == tok::KEYWORD_DECLARATION {
                (group as u32) >> 8
            } else {
                0
            };
            member = false;
            operand = OPERAND_AFTER[hl as usize & 255];
            continue;
        }
        if c == b'#' {
            ptr = scan::line_end(src, ptr + 1, end);
            o.tok(
                if n == b'#' {
                    tok::COMMENT_DOC
                } else {
                    tok::COMMENT
                },
                ptr,
            );
            continue;
        }
        let raw = c == b'r';
        if (n == b'"' || n == b'\'') && (PREFIX[c as usize] || (!operand && c == b'%')) {
            ptr += 1;
            c = n;
        }
        if c == b'"' || c == b'\'' {
            let quote = c;
            let triple = ptr + 2 < end && at(src, ptr + 1) == quote && at(src, ptr + 2) == quote;
            ptr += if triple { 3 } else { 1 };
            let mut t = o;
            ptr = string_body(src, end, ptr, quote, raw, triple, lhs, &mut t);
            o = t;
            operand = true;
            member = false;
            decl = 0;
            continue;
        }
        if c == b'@' {
            ptr = ident_end(src, ptr + 1);
            o.tok(tok::ATTRIBUTE, ptr);
            continue;
        }
        if c == b'$' || (!operand && c == b'%' && is_ident_start(n)) {
            ptr = ident_end(src, ptr + 1);
            while at(src, ptr) == b'/' {
                ptr = ident_end(src, ptr + 1);
            }
            o.tok(tok::VARIABLE_SPECIAL, ptr);
            operand = true;
            member = false;
            continue;
        }
        if is_digit(c) || (c == b'.' && is_digit(n)) {
            ptr = number_end(src, ptr);
            o.tok(tok::NUMBER, ptr);
            operand = true;
            member = false;
            continue;
        }
        ptr += 1;
        let mut hl = PUNCT[c as usize] as u32;
        if c == b':' && n == b'=' {
            ptr += 1;
            hl = tok::OPERATOR;
        }
        o.tok(hl, ptr);
        operand = c == b')' || c == b']' || c == b'}';
        member = c == b'.';
        decl = 0;
    }
    // SAFETY: the records before `cur` are written.
    unsafe { inst.ext.recs.set_len(o.cur.offset_from(start) as usize) };
}
