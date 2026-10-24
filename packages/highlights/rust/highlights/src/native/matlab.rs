//! WAT sources: src/langs/matlab.wat src/common.wat src/scan.wat
//!
//! Native MATLAB lexer (`$hlMatlab`). One pass over the input: `%`
//! comments, `%{ ... %}` block comments on their own lines, `...`
//! continuations; strings and char arrays with doubled-quote escapes, and
//! the transpose `'`; `@` handles and anonymous functions; names
//! (keywords, function heads with their outputs, name, and parameters,
//! `classdef` lines, members, constants, and calls); numbers, brackets,
//! and operators. The native lexer only runs on whole input, so the WAT's
//! streaming branches (`$streaming` set) never apply.

use super::Lexer;
use super::recs::Recs;
use super::scan;
use super::tables::KeywordTable;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::MATLAB_WORDS;

/// The lexer for each language this module handles.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "matlab" => Some(highlight),
        _ => None,
    }
}

/// The input and its 96-byte slack, read without borrowing `inst`.
fn input<'a>(inst: &Instance, base: usize, len: usize) -> &'a [u8] {
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, and this
    // lexer calls no translated code that could move it.
    unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) }
}

/// The input bytes and their 96-byte slack. Indexing skips the bounds
/// check: every position this module reads is below the input length plus
/// 16, inside the slack.
#[derive(Clone, Copy)]
struct Src<'a>(&'a [u8]);

impl core::ops::Index<usize> for Src<'_> {
    type Output = u8;

    #[inline(always)]
    fn index(&self, i: usize) -> &u8 {
        debug_assert!(i < self.0.len());
        // SAFETY: `i` lies within the input or its slack (see `Src`).
        unsafe { self.0.get_unchecked(i) }
    }
}

/// MATLAB's keyword table (`$matlabWords`): each value is the token in
/// the low byte and, for `function` and `classdef`, what follows in the
/// high byte (1 a function head, 2 a class name).
static WORDS: KeywordTable<512> = KeywordTable::new(MATLAB_WORDS);

/// Space, or TAB through CR (`$lexIsSpace`).
#[inline(always)]
fn is_space(c: u8) -> bool {
    c == b' ' || c.wrapping_sub(9) <= 4
}

/// An ASCII digit (`$lexIsDigit`).
#[inline(always)]
const fn is_digit(c: u8) -> bool {
    c.wrapping_sub(b'0') <= 9
}

/// An identifier's first byte: letters, `_`, `$`, or non-ASCII
/// (`$lexIsIdentStart`).
#[inline(always)]
const fn is_ident_start(c: u8) -> bool {
    c >= 0x80 || (c | 32).wrapping_sub(b'a') <= 25 || c == b'_' || c == b'$'
}

/// An identifier byte (`$lexIsIdentContinue`).
#[inline(always)]
const fn is_ident_continue(c: u8) -> bool {
    is_ident_start(c) || is_digit(c)
}

/// Emit `[lhs, rhs)` as `hl` unless the range is empty (`$emitTok`).
#[inline(always)]
fn emit(recs: &mut Recs, hl: u32, lhs: usize, rhs: usize) {
    if lhs < rhs {
        recs.tok(hl, rhs);
    }
}

/// The byte at `p`, or 0 at or past the end (`$matByte`).
#[inline(always)]
fn byte(src: Src, p: usize, end: usize) -> u8 {
    if p < end { src[p] } else { 0 }
}

/// The first position in `[p, end)` holding one of `set`, or `end`.
#[inline(always)]
fn find_any<const N: usize>(src: Src, mut p: usize, end: usize, set: [u8; N]) -> usize {
    while p < end {
        // SAFETY: `p < end`, at most the input length, so the 16 bytes lie
        // inside the input and its slack.
        let w = unsafe { V::load(src.0.as_ptr().add(p)) };
        let mut hit = w.eq(V::splat(set[0]));
        let mut i = 1;
        while i < N {
            hit = hit.or(w.eq(V::splat(set[i])));
            i += 1;
        }
        let k = hit.first();
        if k < 16 {
            return (p + k).min(end);
        }
        p += 16;
    }
    end
}

/// End of the number at `p`, with radix digits, separators, exponents,
/// and suffixes, and a `.` only before a digit (`$lexScanNumber`,
/// `$lexScanNumberBody`). `hex` keeps `e` from taking a sign.
fn number_body_end(src: Src, mut p: usize, end: usize, hex: bool) -> usize {
    let mut prev = 0u8;
    while p < end {
        let c = src[p];
        if is_ident_continue(c) {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            let next = byte(src, p + 1, end);
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

/// End of the number at `p` (`$lexScanNumber`).
#[inline(always)]
fn number_end(src: Src, p: usize, end: usize) -> usize {
    let hex = p + 1 < end && src[p] == b'0' && src[p + 1] | 0x20 == b'x';
    number_body_end(src, p, end, hex)
}

/// The bytes of an identifier run: letters, digits, `_`, and every byte
/// from 128 (`$scanIdentRun` with `_`).
static IDENT: [bool; 256] = {
    let mut t = [false; 256];
    let mut i = 0;
    while i < 256 {
        let c = i as u8;
        t[i] = c >= 0x80 || (c | 32).wrapping_sub(b'a') <= 25 || is_digit(c) || c == b'_';
        i += 1;
    }
    t
};

/// End of the identifier run from `p`, also taking `extra`
/// (`$scanIdentRun`).
#[inline(always)]
fn ident_end(src: Src, mut p: usize, end: usize, extra: u8) -> usize {
    // the NUL at the input end, which `end` always is here, stops the run
    debug_assert!(src[end] == 0);
    while IDENT[src[p] as usize] || src[p] == extra {
        p += 1;
    }
    p
}

/// End of the spaces and tabs from `p` (`$lexSkipSpaceAt`).
#[inline(always)]
fn blanks_end(src: Src, mut p: usize, end: usize) -> usize {
    // the NUL at the input end, which `end` always is here, stops the run
    debug_assert!(src[end] == 0);
    while src[p] == b' ' || src[p] == b'\t' {
        p += 1;
    }
    p
}

/// MATLAB's operator bytes (`$matIsOp`).
static OP: [bool; 256] = super::tables::byteset(b"!&*+-/:<=>\\^|~");

/// Byte classes for the dispatch in [`highlight`].
mod class {
    /// Plain text: no rule takes the byte.
    pub(super) const OTHER: u8 = 0;
    /// Letters, `_`, and bytes from 128: a name.
    pub(super) const NAME: u8 = 1;
    pub(super) const DIGIT: u8 = 2;
    pub(super) const DOT: u8 = 3;
    /// [`super::OP`] bytes.
    pub(super) const OP: u8 = 4;
    /// `()[]{}`.
    pub(super) const BRACKET: u8 = 5;
    /// `,` and `;`.
    pub(super) const DELIMITER: u8 = 6;
    /// `"` and `'`.
    pub(super) const QUOTE: u8 = 7;
    pub(super) const PERCENT: u8 = 8;
    pub(super) const AT: u8 = 9;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    let mut i = 0;
    while i < 256 {
        let c = i as u8;
        t[i] = match c {
            b'0'..=b'9' => class::DIGIT,
            b'.' => class::DOT,
            b'(' | b')' | b'[' | b']' | b'{' | b'}' => class::BRACKET,
            b',' | b';' => class::DELIMITER,
            b'"' | b'\'' => class::QUOTE,
            b'%' => class::PERCENT,
            b'@' => class::AT,
            b'$' => class::OTHER,
            _ if OP[i] => class::OP,
            _ if is_ident_start(c) => class::NAME,
            _ => class::OTHER,
        };
        i += 1;
    }
    t
};

/// The token of the name `[lhs, rhs)` in the low byte and the head
/// capture in the high byte, or -1 for an ordinary name (`$matWordHl`).
#[inline(always)]
fn word_hl(src: Src, lhs: usize, rhs: usize) -> i32 {
    WORDS.value(src.0, lhs, rhs)
}

/// Whether only blanks separate `p` from the end of its line
/// (`$matRestBlank`).
fn rest_blank(src: Src, p: usize, end: usize) -> bool {
    let p = blanks_end(src, p, end);
    let c = byte(src, p, end);
    p >= end || c == b'\n' || c == b'\r'
}

/// SCREAMING_CASE: at least two bytes, an uppercase letter, and only
/// `[A-Z0-9_]` (`$lexIsConstCase`).
fn is_const_case(src: Src, lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = false;
    for i in lhs..rhs {
        let c = src[i];
        if c.wrapping_sub(b'A') <= 25 {
            upper = true;
        } else if !(is_digit(c) || c == b'_') {
            return false;
        }
    }
    upper
}

/// A `%{` block comment at `lhs`, its opener alone on its line: through
/// the line holding a lone `%}`, or the end (`$matBlockComment`). Returns
/// its end.
#[cold]
#[inline(never)]
fn block_comment_end(src: Src, lhs: usize, end: usize) -> usize {
    let mut ptr = scan::line_end(src.0, lhs, end);
    while ptr < end {
        // step over the break, then test the next line
        ptr += 1;
        let line = blanks_end(src, ptr, end);
        if byte(src, line, end) == b'%'
            && byte(src, line + 1, end) == b'}'
            && rest_blank(src, line + 2, end)
        {
            return line + 2;
        }
        ptr = scan::line_end(src.0, ptr, end);
    }
    ptr
}

/// A text (`"`) or char array (`'`) from `lhs`: a doubled quote escapes
/// itself, and the literal ends at the quote or the line break. Returns its
/// end (`$matQuoted`).
fn quoted(src: Src, end: usize, lhs: usize, q: u8, recs: &mut Recs) -> usize {
    let mut seg = lhs;
    let mut ptr = lhs + 1;
    loop {
        let p = find_any(src, ptr, end, [q, b'\n', b'\r']);
        ptr = p;
        if p >= end || src[p] != q {
            break;
        }
        ptr = p + 1;
        if byte(src, ptr, end) != q {
            break;
        }
        emit(recs, tok::STRING, seg, p);
        ptr = p + 2;
        recs.tok(tok::STRING_ESCAPE, ptr);
        seg = ptr;
    }
    emit(recs, tok::STRING, seg, ptr);
    ptr
}

/// Highlight MATLAB source of `len` bytes at lexer memory offset `base`
/// (`$hlMatlab`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let src = Src(input(inst, base, len));
    let end = len;
    let mut recs = Recs::load(inst);
    // $lexEmitLeadingContinuation
    let mut ptr = scan::utf8_span_end(src.0, 0, end);
    recs.gap(0, ptr);
    // 1 after `function`, where names are outputs until one is followed by
    // `(` or ends the head; 2 after that name, waiting for its `(`
    let mut fn_head: u32 = 0;
    // inside the `[a, b]` output list
    let mut fn_out = false;
    // open parens, and the depth of a parameter list
    let mut paren: u32 = 0;
    let mut fn_depth: u32 = 0;
    let mut after_value = false;
    let mut line_head = true;
    let mut member = false;
    let mut class_line = false;
    loop {
        let gap = ptr;
        // a line break ends a statement and a function head
        let mut line_break = false;
        // the NUL at the input end stops the run
        while is_space(src[ptr]) {
            line_break |= src[ptr] == b'\n' || src[ptr] == b'\r';
            ptr += 1;
        }
        if line_break {
            line_head = true;
            after_value = false;
            fn_head = 0;
            fn_out = false;
            class_line = false;
        }
        recs.gap(gap, ptr);
        if ptr >= end {
            break;
        }
        let lhs = ptr;
        let c = src[ptr];
        let at_head = line_head;
        line_head = false;

        match CLASS[c as usize] {
            class::NAME => {
                ptr = ident_end(src, ptr, end, b'_');
                let rhs = ptr;
                let p = blanks_end(src, rhs, end);
                let pc = byte(src, p, end);
                let kind = if member { -1 } else { word_hl(src, lhs, rhs) };
                let mut hl;
                if kind >= 0 {
                    hl = (kind & 255) as u32;
                    if kind >> 8 == 1 {
                        fn_head = 1;
                    }
                    // `classdef Name < Base`: the names on the line are types
                    if kind >> 8 == 2 {
                        class_line = true;
                    }
                    // `end` inside an index is a value
                    after_value = hl == tok::BOOLEAN
                        || hl == tok::CONSTANT_BUILTIN
                        || (rhs - lhs == 3 && &src.0[lhs..lhs + 3] == b"end");
                } else {
                    after_value = true;
                    if member {
                        hl = if pc == b'(' {
                            tok::FUNCTION_METHOD
                        } else {
                            tok::PROPERTY
                        };
                    } else if fn_head == 1 {
                        // `function [a, b] = name(x)`: outputs, then the name
                        if fn_out || pc == b'=' {
                            hl = tok::VARIABLE;
                        } else {
                            hl = tok::FUNCTION_DEFINITION;
                            fn_head = 2;
                        }
                    } else if fn_depth != 0 && paren == fn_depth {
                        hl = tok::VARIABLE_PARAMETER;
                    } else if is_const_case(src, lhs, rhs) {
                        hl = tok::CONSTANT;
                    } else {
                        hl = if pc == b'(' {
                            tok::FUNCTION
                        } else {
                            tok::VARIABLE
                        };
                    }
                    if class_line {
                        hl = tok::TYPE;
                    }
                }
                recs.tok(hl, rhs);
                member = false;
                continue;
            }
            class::OP => {
                while OP[byte(src, ptr, end) as usize] {
                    ptr += 1;
                }
                recs.tok(tok::OPERATOR, ptr);
                after_value = false;
                member = false;
                continue;
            }
            class::BRACKET => {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
                if c == b'(' {
                    paren = paren.wrapping_add(1);
                    if fn_head == 2 {
                        fn_depth = paren;
                        fn_head = 0;
                    }
                }
                if c == b')' {
                    if paren == fn_depth {
                        fn_depth = 0;
                    }
                    paren = paren.saturating_sub(1);
                }
                if c == b'[' {
                    fn_out = fn_head == 1;
                }
                if c == b']' {
                    fn_out = false;
                }
                after_value = c == b')' || c == b']' || c == b'}';
                member = false;
                continue;
            }
            class::DELIMITER => {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                after_value = false;
                member = false;
                continue;
            }
            class::DIGIT => {
                ptr = number_end(src, ptr, end);
                emit(&mut recs, tok::NUMBER, lhs, ptr);
                after_value = true;
                member = false;
                continue;
            }
            // `"` opens a string; `'` glued to a value transposes it, and
            // elsewhere opens a char array
            class::QUOTE => {
                if c == b'\'' && after_value && gap == lhs {
                    ptr += 1;
                    recs.tok(tok::OPERATOR, ptr);
                } else {
                    ptr = quoted(src, end, lhs, c, &mut recs);
                }
                after_value = true;
                member = false;
                continue;
            }
            // `%{` alone on a line opens a block comment; any other `%`
            // comments out the rest of the line
            class::PERCENT => {
                let c2 = byte(src, ptr + 1, end);
                ptr = if at_head && c2 == b'{' && rest_blank(src, ptr + 2, end) {
                    block_comment_end(src, lhs, end)
                } else {
                    scan::line_end(src.0, ptr + 1, end)
                };
                emit(&mut recs, tok::COMMENT, lhs, ptr);
                continue;
            }
            // `@(x) ...` anonymous functions and `@name` handles
            class::AT => {
                let c2 = byte(src, ptr + 1, end);
                ptr += 1;
                recs.tok(tok::PUNCTUATION_SPECIAL, ptr);
                if c2 == b'(' {
                    fn_head = 2;
                }
                if is_ident_start(c2) {
                    let lhs = ptr;
                    ptr = ident_end(src, ptr, end, b'.');
                    emit(&mut recs, tok::FUNCTION, lhs, ptr);
                }
                after_value = false;
                member = false;
                continue;
            }
            class::DOT => {
                let c2 = byte(src, ptr + 1, end);
                // `...` continues the statement; the rest of the line is a comment
                if c2 == b'.' && byte(src, ptr + 2, end) == b'.' {
                    ptr = scan::line_end(src.0, (ptr + 3).min(end), end);
                    emit(&mut recs, tok::COMMENT, lhs, ptr);
                    continue;
                }
                if is_digit(c2) {
                    ptr = number_end(src, ptr, end);
                    emit(&mut recs, tok::NUMBER, lhs, ptr);
                    after_value = true;
                    member = false;
                    continue;
                }
                // `.name` selects a field; `.*`, `./`, `.^`, and `.'` are operators
                if OP[c2 as usize] || c2 == b'\'' {
                    ptr += 2;
                    recs.tok(tok::OPERATOR, ptr);
                    after_value = c2 == b'\'';
                } else {
                    ptr += 1;
                    recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                    member = true;
                    after_value = false;
                }
                continue;
            }
            _ => {}
        }

        ptr = scan::utf8_span_end(src.0, ptr + 1, end);
        recs.tok(tok::NONE, ptr);
        member = false;
    }
    recs.store(inst);
}
