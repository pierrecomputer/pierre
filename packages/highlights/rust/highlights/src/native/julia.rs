//! WAT sources: src/langs/julia.wat src/common.wat src/scan.wat
//!
//! Native Julia lexer (`$hlJulia`). One pass over the input: nested
//! `#= =#` and line comments; strings, triple-quoted strings, commands, and
//! prefixed (`r"..."`, `raw"..."`) strings, with `$name` and `$(...)`
//! interpolation lexed as code; character literals and the adjoint `'`;
//! macros; names (keywords, declared functions, types, and modules,
//! members, constants, calls, and `f(x) = ...` definitions); numbers,
//! symbols, brackets, and operators. The native lexer only runs on whole
//! input, so the WAT's streaming branches (`$streaming` set) never apply.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::KeywordTable;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::JULIA_WORDS;

/// The lexer for each language this module handles.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "julia" => Some(highlight),
        _ => None,
    }
}

/// Julia's keyword table (`$juliaWords`): each value is the token in the
/// low byte and, for declaration keywords, the capture of the next name in
/// the high byte (1 a function, 2 a type, 3 a module).
static WORDS: KeywordTable<512> = KeywordTable::new(JULIA_WORDS);

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

/// A hex digit (`$lexIsHex`).
#[inline(always)]
fn is_hex(c: u8) -> bool {
    is_digit(c) || (c | 32).wrapping_sub(b'a') <= 5
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

/// The byte at `p`, or 0 at or past the end (`$jlByte`).
#[inline(always)]
fn byte(src: Input, p: usize, end: usize) -> u8 {
    // SAFETY: `p < end <= len`.
    if p < end {
        unsafe { src.byte_unchecked(p) }
    } else {
        0
    }
}

/// The first position in `[p, end)` holding one of `set`, or `end`.
#[inline(always)]
fn find_any<const N: usize>(src: Input, mut p: usize, end: usize, set: [u8; N]) -> usize {
    while p < end {
        // SAFETY: `p < end <= len`, so `p + 16` stays inside the slack.
        let w = unsafe { src.vec_unchecked(p) };
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
fn number_body_end(src: Input, mut p: usize, end: usize, hex: bool) -> usize {
    let mut prev = 0u8;
    while p < end {
        let c = src.byte(p);
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

/// End of the escape at the backslash at `p`: one character, kept whole
/// when it is UTF-8, and the LF of an escaped CRLF (`$lexEscapeEnd`).
fn escape_end(src: Input, p: usize, end: usize) -> usize {
    let e = scan::utf8_span_end(src.bytes(), p + 2, end);
    if e == p + 2 && src.byte(p + 1) == b'\r' && e < end && src.byte(e) == b'\n' {
        return e + 1;
    }
    e
}

/// End of the number at `p` (`$lexScanNumber`).
#[inline(always)]
fn number_end(src: Input, p: usize, end: usize) -> usize {
    let hex = p + 1 < end && src.byte(p) == b'0' && src.byte(p + 1) | 0x20 == b'x';
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
fn ident_end(src: Input, mut p: usize, end: usize, extra: u8) -> usize {
    // the NUL at the input end, which `end` always is here, stops the run
    debug_assert!(src.byte(end) == 0 && extra != 0);
    // SAFETY: `p <= end == len`, and the run stops at the NUL at `end` at
    // the latest (`extra` is never NUL).
    while IDENT[unsafe { src.byte_unchecked(p) } as usize]
        || unsafe { src.byte_unchecked(p) } == extra
    {
        p += 1;
    }
    p
}

/// End of the spaces and tabs from `p` (`$lexSkipSpaceAt`).
#[inline(always)]
fn blanks_end(src: Input, mut p: usize, end: usize) -> usize {
    // the NUL at the input end, which `end` always is here, stops the run
    debug_assert!(src.byte(end) == 0);
    // SAFETY: `p <= end == len`, and the run stops at the NUL at `end` at
    // the latest.
    while unsafe { src.byte_unchecked(p) } == b' ' || unsafe { src.byte_unchecked(p) } == b'\t' {
        p += 1;
    }
    p
}

/// Julia's operator bytes (`$jlIsOp`).
static OP: [bool; 256] = super::tables::byteset(b"!$%&*+-/:<=>?\\^|~");

/// Byte classes for the dispatch in [`highlight`].
mod class {
    /// Plain text: no rule takes the byte.
    pub(super) const OTHER: u8 = 0;
    /// Letters, `_`, and bytes from 128: a name.
    pub(super) const NAME: u8 = 1;
    pub(super) const DIGIT: u8 = 2;
    pub(super) const DOT: u8 = 3;
    pub(super) const COLON: u8 = 4;
    /// [`super::OP`] bytes other than `:`.
    pub(super) const OP: u8 = 5;
    /// `()[]{}`.
    pub(super) const BRACKET: u8 = 6;
    /// `,` and `;`.
    pub(super) const DELIMITER: u8 = 7;
    /// `"` and backtick.
    pub(super) const QUOTE: u8 = 8;
    pub(super) const SQUOTE: u8 = 9;
    pub(super) const HASH: u8 = 10;
    pub(super) const AT: u8 = 11;
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
            b':' => class::COLON,
            b'(' | b')' | b'[' | b']' | b'{' | b'}' => class::BRACKET,
            b',' | b';' => class::DELIMITER,
            b'"' | b'`' => class::QUOTE,
            b'\'' => class::SQUOTE,
            b'#' => class::HASH,
            b'@' => class::AT,
            b'$' => class::OP,
            _ if OP[i] => class::OP,
            _ if is_ident_start(c) => class::NAME,
            _ => class::OTHER,
        };
        i += 1;
    }
    t
};

/// The token of the name `[lhs, rhs)` in the low byte and the next-name
/// capture in the high byte, or -1 for an ordinary name (`$jlWordHl`).
#[inline(always)]
fn word_hl(src: Input, lhs: usize, rhs: usize) -> i32 {
    let v = WORDS.value(src.bytes(), lhs, rhs);
    if v >= 0 {
        return v;
    }
    if rhs - lhs == 5 && &src.bytes()[lhs..lhs + 5] == b"where" {
        return tok::KEYWORD_OPERATOR as i32;
    }
    -1
}

/// Whether the parenthesised list opening at `p` closes on the same line
/// and is followed by a single `=`: `f(x) = x + 1` (`$jlDefinedAhead`).
fn defined_ahead(src: Input, mut p: usize, end: usize) -> bool {
    let mut depth: i32 = 0;
    while p < end {
        let c = src.byte(p);
        if c == b'\n' || c == b'\r' {
            break;
        }
        p += 1;
        if c == b'(' {
            depth = depth.wrapping_add(1);
        }
        if c == b')' {
            depth = depth.wrapping_sub(1);
            if depth == 0 {
                let p = blanks_end(src, p, end);
                return byte(src, p, end) == b'=' && byte(src, p + 1, end) != b'=';
            }
        }
    }
    false
}

/// SCREAMING_CASE with an underscore: at least two bytes, an uppercase
/// letter, only `[A-Z0-9_]`, and a `_` (`$jlIsConstName`,
/// `$lexIsConstCase`).
fn is_const_name(src: Input, lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = false;
    for i in lhs..rhs {
        let c = src.byte(i);
        if c.wrapping_sub(b'A') <= 25 {
            upper = true;
        } else if !(is_digit(c) || c == b'_') {
            return false;
        }
    }
    upper && src.bytes()[lhs..rhs].contains(&b'_')
}

/// A `#= ... =#` comment at `lhs`, nesting, through its balancing closer or
/// the end. Returns its end (`$lexNestedBlockComment`, `$lexNestedScan`).
fn nested_comment_end(src: Input, lhs: usize, end: usize) -> usize {
    let mut p = (lhs + 2).min(end);
    let mut depth: u32 = 1;
    loop {
        // the earliest `#=` or `=#` whose second byte lies before the end
        loop {
            if p + 1 >= end {
                return end;
            }
            let (a, b) = (src.byte(p), src.byte(p + 1));
            if (a == b'#' && b == b'=') || (a == b'=' && b == b'#') {
                break;
            }
            p += 1;
        }
        if src.byte(p) == b'#' {
            depth += 1;
            p += 2;
            continue;
        }
        depth -= 1;
        p += 2;
        if depth == 0 {
            return p;
        }
    }
}

/// A string or command body from `*ptr`, with the bytes from `seg` not
/// yet emitted (`$jlStringBody`). `q` is the quote byte, `triple` the
/// three-quote form, `hl` the body's token; an interpolating body
/// (`expand`) carries `$name` variables and `$(` splices, unless `nested`
/// (inside a splice); a `raw` body only escapes quotes and backslashes.
/// Returns 1 past the closer, 2 past a `$(` (emitted as
/// punctuation.special), and 0 at the end.
#[allow(clippy::too_many_arguments)]
fn string_body(
    src: Input,
    end: usize,
    ptr: &mut usize,
    recs: &mut Recs,
    q: u8,
    triple: bool,
    expand: bool,
    raw: bool,
    nested: bool,
    hl: u32,
    mut seg: usize,
) -> u32 {
    let mut p = *ptr;
    let mut stop = p;
    // the next `$` before `stop`; `None` forces a new search
    let mut dollar: Option<usize> = Some(p);
    let status = loop {
        // a new quote/backslash stop also forces a new `$` search; without
        // interpolation a `$` never stops the scan
        if p >= stop {
            stop = if p < end {
                find_any(src, p, end, [q, b'\\'])
            } else {
                p
            };
            dollar = if expand { None } else { Some(stop) };
        }
        if expand && dollar.is_none_or(|d| p > d) {
            dollar = Some(if p < stop {
                find_any(src, p, stop, *b"$")
            } else {
                p
            });
        }
        let d = dollar.unwrap_or(stop);
        p = if d < stop { d } else { stop };
        if p >= end {
            break 0;
        }
        let c = src.byte(p);
        if c == q {
            if !triple || (byte(src, p + 1, end) == q && byte(src, p + 2, end) == q) {
                p += if triple { 3 } else { 1 };
                recs.emit(hl, seg, p);
                *ptr = p;
                return 1;
            }
            p += 1;
            continue;
        }
        // a backslash or `$`: flush the body so far
        recs.emit(hl, seg, p);
        seg = p;
        if c == b'\\' {
            if raw {
                let c2 = byte(src, p + 1, end);
                p += if c2 == b'"' || c2 == b'\\' { 2 } else { 1 };
                continue;
            }
            let e = escape_end(src, p, end);
            recs.emit(tok::STRING_ESCAPE, p, e);
            p = e;
            seg = p;
            continue;
        }
        // `$`: a splice or a name
        let c2 = byte(src, p + 1, end);
        if c2 == b'(' && !nested {
            p += 2;
            recs.emit(tok::PUNCTUATION_SPECIAL, seg, p);
            *ptr = p;
            return 2;
        }
        if is_ident_start(c2) && c2 != b'$' {
            p = ident_end(src, p + 1, end, b'_');
            recs.emit(tok::VARIABLE, seg, p);
            seg = p;
            continue;
        }
        p += 1;
    };
    recs.emit(hl, seg, p);
    *ptr = p;
    status
}

/// Highlight Julia source of `len` bytes at lexer memory offset `base`
/// (`$hlJulia`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: `base..base + len + SLACK` is this input in lexer memory;
    // it is made again after every call into translated code.
    let src = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut recs = Recs::load(inst);
    // $lexEmitLeadingContinuation
    let mut ptr = scan::utf8_span_end(src.bytes(), 0, end);
    recs.gap(0, ptr);
    // 1 `"`, 2 `"""`, 3 and 4 the non-interpolating prefixed forms, 7 and
    // 8 `raw`, 5 a backtick command; 0 outside a string body
    let mut str_kind: u32 = 0;
    let mut str_hl = tok::STRING;
    // the start of the body bytes not yet emitted
    let mut seg = 0usize;
    // parentheses open inside a `$(` splice, and the body to return to
    let mut interp: u32 = 0;
    let mut interp_kind: u32 = 0;
    // the capture after a declaration keyword: 1 function, 2 type, 3 module
    let mut expect: i32 = 0;
    let mut member = false;
    let mut import_ctx = false;
    let mut stmt_head = true;
    let mut after_value = false;
    let mut depth: u32 = 0;
    loop {
        if str_kind != 0 {
            if ptr >= end {
                break;
            }
            if seg == 0 {
                seg = ptr;
            }
            let status = string_body(
                src,
                end,
                &mut ptr,
                &mut recs,
                if str_kind == 5 { b'`' } else { b'"' },
                str_kind & 1 == 0,
                str_kind <= 2 || str_kind == 5,
                str_kind >= 7,
                interp != 0,
                str_hl,
                seg,
            );
            seg = ptr;
            if status == 2 {
                interp_kind = str_kind;
                interp = 1;
                str_kind = 0;
                seg = 0;
                after_value = false;
            } else if status == 1 {
                str_kind = 0;
                seg = 0;
                after_value = true;
            }
            continue;
        }

        let gap = ptr;
        // a line break ends an import line and starts a statement
        let mut line_break = false;
        // SAFETY: `ptr <= end == len`, and the run stops at the NUL at `end`
        // at the latest.
        while let c = unsafe { src.byte_unchecked(ptr) }
            && is_space(c)
        {
            line_break |= c == b'\n' || c == b'\r';
            ptr += 1;
        }
        if line_break {
            import_ctx = false;
            stmt_head = true;
            after_value = false;
        }
        recs.gap(gap, ptr);
        if ptr >= end {
            break;
        }
        let lhs = ptr;
        let c = src.byte(ptr);

        match CLASS[c as usize] {
            class::NAME => {
                ptr = ident_end(src, ptr, end, b'_');
                // `push!` and other mutating names end in `!`
                if byte(src, ptr, end) == b'!' && byte(src, ptr + 1, end) != b'=' {
                    ptr += 1;
                }
                let rhs = ptr;
                let p = blanks_end(src, rhs, end);
                // `r"..."`, `raw"..."`, `b"..."`: a prefix, then a raw body
                if byte(src, rhs, end) == b'"' {
                    recs.tok(tok::FUNCTION, rhs);
                    str_hl = if rhs - lhs == 1 && c == b'r' {
                        tok::STRING_REGEX
                    } else {
                        tok::STRING
                    };
                    str_kind = 3;
                    if byte(src, rhs + 1, end) == b'"' && byte(src, rhs + 2, end) == b'"' {
                        str_kind = 4;
                        ptr += 2;
                    }
                    if rhs - lhs == 3 && &src.bytes()[lhs..lhs + 3] == b"raw" {
                        str_kind += 4;
                    }
                    ptr += 1;
                    recs.tok(str_hl, ptr);
                    seg = ptr;
                    member = false;
                    continue;
                }
                let kind = if member || import_ctx {
                    -1
                } else {
                    word_hl(src, lhs, rhs)
                };
                let hl;
                if kind >= 0 {
                    hl = (kind & 255) as u32;
                    if kind >> 8 != 0 {
                        expect = kind >> 8;
                    }
                    if hl == tok::KEYWORD_IMPORT {
                        import_ctx = true;
                    }
                    // `end` closes an index or a block and stands as a value, as
                    // does `begin` in `x[begin:end]`
                    let len = rhs - lhs;
                    after_value = hl == tok::BOOLEAN
                        || hl == tok::CONSTANT_BUILTIN
                        || (len == 3 && &src.bytes()[lhs..lhs + 3] == b"end")
                        || (len == 5 && &src.bytes()[lhs..lhs + 5] == b"begin");
                } else {
                    after_value = true;
                    hl = if import_ctx {
                        tok::NAMESPACE
                    } else if expect != 0 {
                        // `function Base.show(` qualifies the name; the module
                        // part keeps the capture open
                        if byte(src, rhs, end) == b'.' {
                            tok::NAMESPACE
                        } else {
                            let hl = match expect {
                                2 => tok::TYPE,
                                3 => tok::NAMESPACE,
                                _ => tok::FUNCTION_DEFINITION,
                            };
                            expect = 0;
                            hl
                        }
                    } else if member {
                        if byte(src, p, end) == b'(' {
                            tok::FUNCTION_METHOD
                        } else {
                            tok::PROPERTY
                        }
                    } else if is_const_name(src, lhs, rhs) {
                        tok::CONSTANT
                    } else if c.wrapping_sub(b'A') <= 25 {
                        tok::TYPE
                    } else if byte(src, p, end) == b'(' {
                        // `f(x) = ...` at a statement head defines f
                        if stmt_head && defined_ahead(src, p, end) {
                            tok::FUNCTION_DEFINITION
                        } else {
                            tok::FUNCTION
                        }
                    } else {
                        tok::VARIABLE
                    };
                }
                recs.tok(hl, rhs);
                member = false;
                stmt_head = false;
                continue;
            }
            class::OP => {
                loop {
                    let b = byte(src, ptr, end);
                    if !(OP[b as usize] || b == b'.') || b == b'#' {
                        break;
                    }
                    ptr += 1;
                }
                recs.tok(tok::OPERATOR, ptr);
                member = false;
                after_value = false;
                stmt_head = false;
                continue;
            }
            class::BRACKET => {
                ptr += 1;
                if interp != 0 {
                    if c == b'(' {
                        interp += 1;
                    }
                    if c == b')' {
                        interp -= 1;
                        if interp == 0 {
                            // the paren matching `$(` returns to the string body
                            recs.tok(tok::PUNCTUATION_SPECIAL, ptr);
                            str_kind = interp_kind;
                            interp_kind = 0;
                            seg = ptr;
                            member = false;
                            continue;
                        }
                    }
                }
                let closing = c == b')' || c == b']' || c == b'}';
                if closing {
                    depth = depth.saturating_sub(1);
                } else {
                    depth = depth.wrapping_add(1);
                }
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
                after_value = closing;
                member = false;
                stmt_head = false;
                if c == b'(' {
                    expect = 0;
                }
                continue;
            }
            class::DELIMITER => {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                member = false;
                after_value = false;
                if c == b';' {
                    stmt_head = depth == 0;
                    expect = 0;
                    import_ctx = false;
                }
                continue;
            }
            class::DIGIT => {
                ptr = number_end(src, ptr, end);
                recs.emit(tok::NUMBER, lhs, ptr);
                member = false;
                after_value = true;
                stmt_head = false;
                continue;
            }
            class::DOT => {
                let c2 = byte(src, ptr + 1, end);
                let c3 = byte(src, ptr + 2, end);
                if is_digit(c2) {
                    ptr = number_end(src, ptr, end);
                    recs.emit(tok::NUMBER, lhs, ptr);
                    member = false;
                    after_value = true;
                    stmt_head = false;
                    continue;
                }
                // `.name` selects a field; `.+` and `...` are operators
                if !OP[c2 as usize] {
                    if c2 == b'.' {
                        ptr += 2;
                        if c3 == b'.' {
                            ptr += 1;
                        }
                        recs.tok(tok::OPERATOR, ptr);
                        after_value = false;
                    } else {
                        ptr += 1;
                        recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                        member = true;
                        after_value = false;
                    }
                    stmt_head = false;
                    continue;
                }
                // `.+` and other dotted operators

                loop {
                    let b = byte(src, ptr, end);
                    if !(OP[b as usize] || b == b'.') || b == b'#' {
                        break;
                    }
                    ptr += 1;
                }
                recs.tok(tok::OPERATOR, ptr);
                member = false;
                after_value = false;
                stmt_head = false;
                continue;
            }
            class::COLON => {
                let c2 = byte(src, ptr + 1, end);
                // `:sym` quotes a symbol; a `:` after a value is a range
                if !after_value && is_ident_start(c2) && c2 != b'$' {
                    ptr = ident_end(src, ptr + 1, end, b'!');
                    recs.tok(tok::STRING_SPECIAL_SYMBOL, ptr);
                    after_value = true;
                    stmt_head = false;
                    continue;
                }

                loop {
                    let b = byte(src, ptr, end);
                    if !(OP[b as usize] || b == b'.') || b == b'#' {
                        break;
                    }
                    ptr += 1;
                }
                recs.tok(tok::OPERATOR, ptr);
                member = false;
                after_value = false;
                stmt_head = false;
                continue;
            }
            // string and command openers; the body is scanned at the loop top
            class::QUOTE => {
                let c2 = byte(src, ptr + 1, end);
                let c3 = byte(src, ptr + 2, end);
                str_kind = if c == b'`' { 5 } else { 1 };
                str_hl = if c == b'`' {
                    tok::STRING_SPECIAL
                } else {
                    tok::STRING
                };
                if c == b'"' && c2 == b'"' && c3 == b'"' {
                    str_kind = 2;
                    ptr += 2;
                }
                ptr += 1;
                recs.tok(str_hl, ptr);
                seg = ptr;
                member = false;
                continue;
            }
            // `'`: the adjoint of a value, else a character literal
            class::SQUOTE => {
                let c2 = byte(src, ptr + 1, end);
                if after_value && gap == lhs {
                    ptr += 1;
                    recs.tok(tok::OPERATOR, ptr);
                    continue;
                }
                let mut e = if c2 == b'\\' {
                    escape_end(src, ptr + 1, end)
                } else {
                    scan::utf8_span_end(src.bytes(), ptr + 2, end)
                };
                // `'\u00e9'` carries hex digits after the escape
                while e < ptr + 12 && is_hex(byte(src, e, end)) {
                    e += 1;
                }
                if c2 > 32 && byte(src, e, end) == b'\'' {
                    ptr = e + 1;
                    recs.tok(tok::STRING, ptr);
                    after_value = true;
                } else {
                    ptr += 1;
                    recs.tok(tok::OPERATOR, ptr);
                    after_value = false;
                }
                member = false;
                continue;
            }
            // `#= ... =#` nests
            class::HASH => {
                let c2 = byte(src, ptr + 1, end);
                ptr = if c2 == b'=' {
                    nested_comment_end(src, lhs, end)
                } else {
                    scan::line_end(src.bytes(), ptr + 1, end)
                };
                recs.emit(tok::COMMENT, lhs, ptr);
                continue;
            }
            class::AT => {
                let c2 = byte(src, ptr + 1, end);
                // `@macro` and `@.`
                if is_ident_start(c2) || c2 == b'.' {
                    ptr = ident_end(src, ptr + 2, end, b'!');
                    recs.tok(tok::FUNCTION, ptr);
                    after_value = false;
                    member = false;
                    continue;
                }
            }
            _ => {}
        }

        ptr = scan::utf8_span_end(src.bytes(), ptr + 1, end);
        recs.tok(tok::NONE, ptr);
        member = false;
        stmt_head = false;
    }
    recs.store(inst);
}
