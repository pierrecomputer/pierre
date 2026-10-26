//! WAT sources: src/langs/gdscript.wat src/langs/python.wat src/common.wat src/scan.wat
//!
//! Native GDScript lexer. Names are colored from the keyword and built-in
//! type tables, by case (constants, types), and by position (after
//! `func`/`class`, after `.`, before `(`); `$Node/Path` and `%Unique`
//! node references, `@annotations`, and Python-style strings with Godot
//! escapes and `r`/`&`/`^` prefixes. The records equal the translated
//! `gdscript` lexer's records.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::{KeywordTable, byteset};
use crate::generated::Instance;
use crate::simd::V;
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
fn ident_end(inp: Input, mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..8 {
        // SAFETY: the NUL after the input stops the run.
        if !IDENT[unsafe { inp.byte_unchecked(p) } as usize] {
            return p;
        }
        p += 1;
    }
    loop {
        // SAFETY: each 16-byte load starts at or before the NUL after the
        // input, inside the slack.
        let v = unsafe { inp.vec_unchecked(p) };
        let alpha = v.or(V::splat(0x20)).sub(V::splat(b'a')).le(V::splat(25));
        let digit = v.sub(V::splat(b'0')).le(V::splat(9));
        let extra = v.eq(V::splat(b'_')).or(v.eq(V::splat(b'$')));
        let k = alpha.or(digit).or(extra.or(v.high())).not().first();
        if k < 16 {
            return p + k;
        }
        p += 16;
    }
}

/// The end of the number at `p` (`$lexScanNumber`, `$lexScanNumberBody`).
/// The NUL after the input stops it.
fn number_end(inp: Input, mut p: usize) -> usize {
    let mut prev = 0u8;
    // SAFETY (the reads in this function): `p` starts inside the input, the
    // NUL after it stops the number, and `p + 1` stays inside the slack.
    let hex = unsafe { inp.byte_unchecked(p) == b'0' && inp.byte_unchecked(p + 1) | 0x20 == b'x' };
    loop {
        let c = unsafe { inp.byte_unchecked(p) };
        if IDENT[c as usize] {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            if !is_digit(unsafe { inp.byte_unchecked(p + 1) }) {
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
fn escape_end(inp: Input, p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(inp.bytes(), p + 2, end);
    // SAFETY: the backslash at `p` lies inside the input, so `p + 1` is at
    // most the NUL after it, and `e` is below the input end (tested first).
    if e == p + 2
        && unsafe { inp.byte_unchecked(p + 1) } == b'\r'
        && e < end
        && unsafe { inp.byte_unchecked(e) } == b'\n'
    {
        e += 1;
    }
    e
}

/// The end of at most `max` hex digits from `p`, bounded by `end`
/// (`$scanHexRun`).
#[inline(always)]
fn hex_run(inp: Input, mut p: usize, max: usize, end: usize) -> usize {
    let stop = (p + max).min(end);
    while p < stop {
        // SAFETY: `p` is below `stop`, at most the input end.
        let c = unsafe { inp.byte_unchecked(p) };
        if !(is_digit(c) || (c | 32).wrapping_sub(b'a') <= 5) {
            break;
        }
        p += 1;
    }
    p
}

/// SCREAMING_CASE: at least two bytes, one uppercase letter, and only
/// `[A-Z0-9_]` (`$lexIsConstCase`).
fn is_const_case(inp: Input, lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = false;
    for p in lhs..rhs {
        // SAFETY: the name lies inside the input.
        let c = unsafe { inp.byte_unchecked(p) };
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
fn type_hl(inp: Input, lhs: usize, rhs: usize) -> i32 {
    let len = rhs - lhs;
    let mut rhs = rhs;
    // SAFETY (the reads in this function): the name lies inside the input,
    // so each 8 bytes read from inside it end inside the slack.
    let w = unsafe { inp.word_unchecked(lhs) };
    if len == 8
        && w & 0xffff_ffff_ffff == word(b"Vector")
        && unsafe { inp.byte_unchecked(lhs + 7) } == b'i'
    {
        rhs -= 1;
    }
    if len == 11
        && w == word(b"Transfor")
        && unsafe { inp.word_unchecked(lhs + 7) } as u32 == word(b"rm3D") as u32
    {
        return tok::TYPE_BUILTIN as i32;
    }
    if len >= 15
        && w & 0xffff_ffff_ffff == word(b"Packed")
        && unsafe { inp.word_unchecked(rhs - 5) } & 0xff_ffff_ffff == word(b"Array")
    {
        return PACKED.value(inp.bytes(), lhs + 6, rhs - 5);
    }
    TYPES.value(inp.bytes(), lhs, rhs)
}

/// A string body from `ptr` with the bytes since `seg` (its prefix and
/// opening quote) not yet emitted: escapes get their own tokens unless
/// `raw`, with Godot's `\uXXXX` and `\UXXXXXX`; a triple-quoted body spans
/// lines. Returns the end (`$pyStringBody` without format fields, with
/// `$hexU` 6; the status only matters to a stream).
#[inline(never)]
#[allow(clippy::too_many_arguments)]
fn string_body(
    inp: Input,
    end: usize,
    mut ptr: usize,
    quote: u8,
    raw: bool,
    triple: bool,
    mut seg: usize,
    out: &mut Recs,
) -> usize {
    let mut o = *out;
    loop {
        ptr = if triple {
            scan::find3(inp.bytes(), ptr, end, quote, b'\\', quote)
        } else {
            scan::string_special(inp.bytes(), ptr, end, quote)
        };
        if ptr >= end {
            break;
        }
        // SAFETY: `ptr` is below the input end (tested above).
        let c = unsafe { inp.byte_unchecked(ptr) };
        if c == quote {
            if triple {
                // SAFETY: `ptr + 2` is below the input end (tested first).
                if ptr + 2 < end
                    && unsafe { inp.byte_unchecked(ptr + 1) } == quote
                    && unsafe { inp.byte_unchecked(ptr + 2) } == quote
                {
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
            let mut e = escape_end(inp, ptr, end);
            if !raw {
                if ptr + 1 < end {
                    // SAFETY: `ptr + 1` is below the input end (tested above).
                    let u = unsafe { inp.byte_unchecked(ptr + 1) };
                    if u == b'u' || u == b'U' {
                        e = hex_run(inp, e, if u == b'u' { 4 } else { 6 }, end);
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
    // SAFETY: the input and its slack lie inside lexer memory, and this
    // lexer calls no translated code that could move it.
    let inp = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut o = Recs::load(inst);

    // 1 after `func`/`signal`, 2 after `class`/`class_name`/`enum`
    let mut decl = 0u32;
    // after `.`
    let mut member = false;
    // after a value, where `%` is the modulo operator
    let mut operand = false;

    // `$lexEmitLeadingContinuation` and the leading whitespace: one gap,
    // which writes the first record when there is none yet. Its line
    // breaks clear state that is already clear.
    let mut ptr = scan::utf8_span_end(inp.bytes(), 0, end);
    // SAFETY: the NUL after the input stops the run.
    while SPACE[unsafe { inp.byte_unchecked(ptr) } as usize] {
        ptr += 1;
    }
    o.gap(0, ptr);
    while ptr < end {
        let gap = ptr;
        let mut brk = false;
        // SAFETY: the NUL at the input end stops the run.
        while SPACE[unsafe { inp.byte_unchecked(ptr) } as usize] {
            // SAFETY: `ptr` holds a space byte, inside the input.
            let b = unsafe { inp.byte_unchecked(ptr) };
            brk |= b == b'\n' || b == b'\r';
            ptr += 1;
        }
        if brk {
            operand = false;
            decl = 0;
        }
        if gap < ptr {
            // SAFETY: a token precedes every gap after the leading one.
            unsafe { o.extend_unchecked(ptr) }
        }
        if ptr >= end {
            break;
        }
        let lhs = ptr;
        // SAFETY: `ptr` is below the input end (tested above), so `ptr + 1`
        // is at most the NUL after it.
        let (mut c, n) = unsafe { (inp.byte_unchecked(ptr), inp.byte_unchecked(ptr + 1)) };

        // Names, the most common tokens, skip the rule chain: no earlier
        // rule matches a name's first byte but `$` (a node path) and an `r`
        // before a quote (a raw string).
        if is_ident_start(c) && c != b'$' && !(c == b'r' && (n == b'"' || n == b'\'')) {
            ptr = ident_end(inp, ptr + 1);
            let mut p = ptr;
            // SAFETY: the name ends at or before the input end, and the NUL
            // there stops the run.
            while unsafe { inp.byte_unchecked(p) } == b' '
                || unsafe { inp.byte_unchecked(p) } == b'\t'
            {
                p += 1;
            }
            // SAFETY: the run above ends at or before the input end.
            let call = unsafe { inp.byte_unchecked(p) } == b'(';
            let group = WORDS.value(inp.bytes(), lhs, ptr);
            let mut hl = (group & 255) as u32;
            if group < 0 {
                let t = type_hl(inp, lhs, ptr);
                hl = t as u32;
                if t < 0 {
                    hl = if is_const_case(inp, lhs, ptr) {
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
            ptr = scan::line_end(inp.bytes(), ptr + 1, end);
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
            // SAFETY: `ptr + 2` is below the input end (tested first).
            let triple = ptr + 2 < end
                && unsafe { inp.byte_unchecked(ptr + 1) } == quote
                && unsafe { inp.byte_unchecked(ptr + 2) } == quote;
            ptr += if triple { 3 } else { 1 };
            let mut t = o;
            ptr = string_body(inp, end, ptr, quote, raw, triple, lhs, &mut t);
            o = t;
            operand = true;
            member = false;
            decl = 0;
            continue;
        }
        if c == b'@' {
            ptr = ident_end(inp, ptr + 1);
            o.tok(tok::ATTRIBUTE, ptr);
            continue;
        }
        if c == b'$' || (!operand && c == b'%' && is_ident_start(n)) {
            ptr = ident_end(inp, ptr + 1);
            // SAFETY: names end at or before the input end, and the NUL there
            // stops them.
            while unsafe { inp.byte_unchecked(ptr) } == b'/' {
                ptr = ident_end(inp, ptr + 1);
            }
            o.tok(tok::VARIABLE_SPECIAL, ptr);
            operand = true;
            member = false;
            continue;
        }
        if is_digit(c) || (c == b'.' && is_digit(n)) {
            ptr = number_end(inp, ptr);
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
    o.store(inst);
}
