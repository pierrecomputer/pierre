//! WAT sources: src/langs/gdresource.wat src/langs/gdscript.wat src/langs/python.wat src/common.wat src/scan.wat
//!
//! Native Godot resource (`.tres`, `.tscn`) lexer. Section headers
//! (`[gd_scene ...]`) name their kind as a tag; `key = value` lines color
//! the key as a property, including TileSet keys such as `0:0/0/terrain`;
//! values are numbers, built-in types, `ExtResource(...)` calls, and
//! strings that may span lines. The records equal the translated
//! `gdresource` lexer's records.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::KeywordTable;
use crate::generated::Instance;
use crate::simd::V;
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
    for _ in 0..24 {
        // SAFETY: the NUL after the input stops the run.
        if !IDENT[unsafe { inp.byte_unchecked(p) } as usize] {
            return p;
        }
        p += 1;
    }
    loop {
        // SAFETY: each load starts at or before the NUL after the input,
        // which ends the run, so its 16 bytes lie inside the slack.
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
    // SAFETY: `p` lies inside the input, so `p + 1` is at most the NUL
    // after it.
    let hex = unsafe { inp.byte_unchecked(p) == b'0' && inp.byte_unchecked(p + 1) | 0x20 == b'x' };
    let mut prev = 0u8;
    // SAFETY (the reads in this loop): `p` starts inside the input, the NUL
    // after it stops the number, and `p + 1` stays inside the slack.
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

/// The nearest byte before `p` on its line that is not a space or tab,
/// or 0 at the line's (or the input's) start (`$lexLineByteBefore`).
#[inline(always)]
fn line_byte_before(inp: Input, mut p: usize) -> u8 {
    while p > 0 {
        p -= 1;
        // SAFETY: `p` is below the starting position, inside the input.
        let c = unsafe { inp.byte_unchecked(p) };
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
fn skip_space_at(inp: Input, mut p: usize) -> usize {
    // SAFETY: `p` starts at or before the input end, and the NUL there
    // stops the run.
    while unsafe { inp.byte_unchecked(p) } == b' ' || unsafe { inp.byte_unchecked(p) } == b'\t' {
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
fn string_body(inp: Input, end: usize, mut ptr: usize, mut seg: usize, out: &mut Recs) -> usize {
    let mut o = *out;
    loop {
        ptr = scan::find3(inp.bytes(), ptr, end, b'"', b'\\', b'"');
        if ptr >= end {
            break;
        }
        // SAFETY: `ptr` is below the input end (tested above).
        if unsafe { inp.byte_unchecked(ptr) } == b'"' {
            ptr += 1;
            break;
        }
        // A backslash escapes the next character, or continues the line
        // when it precedes LF or CRLF.
        let mut e = escape_end(inp, ptr, end);
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
        ptr = e;
    }
    o.emit(tok::STRING, seg, ptr);
    *out = o;
    ptr
}

/// Lex the Godot resource input of `len` bytes at `base`
/// (`$hlGdresource`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: the input and its slack lie inside lexer memory, and this
    // lexer calls no translated code that could move it.
    let inp = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut o = Recs::load(inst);

    // right after a `[` that starts its line: the next name is a section
    // kind
    let mut header = false;

    // `$lexEmitLeadingContinuation` and the leading whitespace: one gap,
    // which writes the first record when there is none yet.
    let mut ptr = scan::utf8_span_end(inp.bytes(), 0, end);
    // SAFETY: the NUL after the input stops the run.
    while SPACE[unsafe { inp.byte_unchecked(ptr) } as usize] {
        ptr += 1;
    }
    o.gap(0, ptr);
    while ptr < end {
        let gap = ptr;
        // SAFETY (the whitespace reads): `ptr` lies inside the input, and
        // the NUL at its end stops the run.
        let b = unsafe { inp.byte_unchecked(ptr) };
        if (b == b' ' || b == b'\n') && !SPACE[unsafe { inp.byte_unchecked(ptr + 1) } as usize] {
            // one space or line break
            ptr += 1;
        } else {
            while SPACE[unsafe { inp.byte_unchecked(ptr) } as usize] {
                ptr += 1;
            }
        }
        if gap < ptr {
            o.extend(ptr)
        }
        if ptr >= end {
            break;
        }
        let lhs = ptr;
        // SAFETY: `ptr` is below the input end (tested above).
        let mut c = unsafe { inp.byte_unchecked(ptr) };

        // Names, the most common tokens, come first: no earlier rule
        // matches a name's first byte.
        if IDENT_START[c as usize] {
            ptr = ident_end(inp, ptr + 1);
            // SAFETY (this run and the `=` test): names end at or before
            // the input end, and the NUL there stops them.
            while unsafe { inp.byte_unchecked(ptr) } == b'/' {
                ptr = ident_end(inp, ptr + 1);
            }
            let p = skip_space_at(inp, ptr);
            // (a key before `=` is a property whatever the tables say)
            if unsafe { inp.byte_unchecked(p) } == b'=' {
                o.tok(tok::PROPERTY, ptr);
                header = false;
                continue;
            }
            let mut hl = WORDS.value(inp.bytes(), lhs, ptr);
            if hl == tok::TAG as i32 && !header {
                hl = -1;
            }
            if hl < 0 {
                hl = type_hl(inp, lhs, ptr);
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
            ptr = scan::line_end(inp.bytes(), ptr + 1, end);
            o.tok(tok::COMMENT, ptr);
            continue;
        }
        // SAFETY (the lookaheads after `c`): `ptr` is below the input end,
        // so `ptr + 1` is at most the NUL after it.
        if c == b'&' && unsafe { inp.byte_unchecked(ptr + 1) } == b'"' {
            ptr += 1;
            c = b'"';
        }
        if c == b'"' {
            // A string without escapes is one token.
            let q = scan::find3(inp.bytes(), ptr + 1, end, b'"', b'\\', b'"');
            // SAFETY: `q` is below the input end (tested first).
            if q < end && unsafe { inp.byte_unchecked(q) } == b'"' {
                ptr = q + 1;
                o.tok(tok::STRING, ptr);
            } else {
                let mut t = o;
                ptr = string_body(inp, end, ptr + 1, lhs, &mut t);
                o = t;
            }
            header = false;
            continue;
        }
        // TileSet keys such as `0:0/0/terrain = 1` must be checked before
        // numbers.
        if c.wrapping_sub(b'0') <= 9 && line_byte_before(inp, lhs) == 0 {
            let mut q = ident_end(inp, ptr);
            // SAFETY (this run and the `=` test): names and spaces end at or
            // before the input end, and the NUL there stops them.
            while unsafe { inp.byte_unchecked(q) } == b'/'
                || unsafe { inp.byte_unchecked(q) } == b':'
            {
                q = ident_end(inp, q + 1);
            }
            if unsafe { inp.byte_unchecked(skip_space_at(inp, q)) } == b'=' {
                ptr = q;
                o.tok(tok::PROPERTY, ptr);
                header = false;
                continue;
            }
        }
        if c.wrapping_sub(b'0') <= 9
            || (c == b'.' && unsafe { inp.byte_unchecked(ptr + 1) }.wrapping_sub(b'0') <= 9)
        {
            ptr = number_end(inp, ptr);
            o.tok(tok::NUMBER, ptr);
            header = false;
            continue;
        }
        // Brackets inside values must not open section headers.
        header = c == b'[' && line_byte_before(inp, lhs) == 0;
        let hl = PUNCT[c as usize] as u32;
        ptr += 1;
        o.tok(hl, ptr);
    }
    o.store(inst);
}
