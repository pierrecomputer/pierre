//! WAT sources: src/langs/r.wat src/common.wat src/scan.wat
//!
//! Native R lexer (`$hlR`). One pass over the input: comments (roxygen
//! `#'` as doc comments), strings, backtick names, raw strings, `%op%`
//! operators, `\(x)` lambdas, `...` and `..1`, names (keywords, members
//! after `$`/`@`, namespaces before `::`, function definitions and calls,
//! parameters and named arguments), numbers, brackets, and operators. The
//! native lexer only runs on whole input, so the WAT's streaming branches
//! (`$streaming` set) never apply.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::KeywordTable;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::R_WORDS;

/// The lexer for each language this module handles.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "r" => Some(highlight),
        _ => None,
    }
}

/// R's keyword table (`$rWords`): groups 1 control, 2 `function`, 3
/// booleans, 4 built-in constants, 5 `in`.
static WORDS: KeywordTable<128> = KeywordTable::new(R_WORDS);

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

/// The bytes of an R name run: letters, digits, `_`, `.`, and every byte
/// from 128 (`$scanIdentRun` with `.`).
static NAME: [bool; 256] = {
    let mut t = [false; 256];
    let mut i = 0;
    while i < 256 {
        let c = i as u8;
        t[i] =
            c >= 0x80 || (c | 32).wrapping_sub(b'a') <= 25 || is_digit(c) || c == b'_' || c == b'.';
        i += 1;
    }
    t
};

/// Byte classes for the dispatch in [`highlight`].
mod class {
    /// Plain text: no rule takes the byte.
    pub(super) const OTHER: u8 = 0;
    /// Letters (but `r`/`R`), `_`, and bytes from 128: a name.
    pub(super) const NAME: u8 = 1;
    /// `r` and `R`: a raw string prefix, else a name.
    pub(super) const R: u8 = 2;
    pub(super) const DIGIT: u8 = 3;
    pub(super) const DOT: u8 = 4;
    /// `"` and `'`.
    pub(super) const QUOTE: u8 = 5;
    pub(super) const BACKTICK: u8 = 6;
    pub(super) const HASH: u8 = 7;
    pub(super) const PERCENT: u8 = 8;
    pub(super) const BACKSLASH: u8 = 9;
    /// `()[]{}`.
    pub(super) const BRACKET: u8 = 10;
    /// `,` and `;`.
    pub(super) const DELIMITER: u8 = 11;
    /// `$` and `@`.
    pub(super) const MEMBER: u8 = 12;
    /// [`super::OP`] bytes.
    pub(super) const OP: u8 = 13;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    let mut i = 0;
    while i < 256 {
        let c = i as u8;
        t[i] = match c {
            b'r' | b'R' => class::R,
            b'0'..=b'9' => class::DIGIT,
            b'.' => class::DOT,
            b'"' | b'\'' => class::QUOTE,
            b'`' => class::BACKTICK,
            b'#' => class::HASH,
            b'%' => class::PERCENT,
            b'\\' => class::BACKSLASH,
            b'(' | b')' | b'[' | b']' | b'{' | b'}' => class::BRACKET,
            b',' | b';' => class::DELIMITER,
            b'$' | b'@' => class::MEMBER,
            b'!' | b'&' | b'*' | b'+' | b'-' | b'/' | b':' | b'<' | b'=' | b'>' | b'?' | b'^'
            | b'|' | b'~' => class::OP,
            _ if is_ident_start(c) => class::NAME,
            _ => class::OTHER,
        };
        i += 1;
    }
    t
};

/// R's operator bytes (`$rIsOp`).
static OP: [bool; 256] = super::tables::byteset(b"!&*+-/:<=>?^|~");

/// The byte at `p`, or 0 at or past the end (`$rByte`).
#[inline(always)]
fn byte(src: Input, p: usize, end: usize) -> u8 {
    // SAFETY: `p < end <= len`.
    if p < end {
        unsafe { src.byte_unchecked(p) }
    } else {
        0
    }
}

/// The byte at `p`, at most the input end, which this lexer's `end`
/// always is: the NUL there reads as the 0 that `$rByte` gives at the end.
#[inline(always)]
fn upto(src: Input, p: usize, end: usize) -> u8 {
    debug_assert!(p <= end && src.byte(end) == 0);
    // SAFETY: `p <= end == len`.
    unsafe { src.byte_unchecked(p) }
}

/// End of the name run from `p` (`$scanIdentRun` with `.`).
#[inline(always)]
fn name_end(src: Input, mut p: usize, end: usize) -> usize {
    // the NUL at the input end, which `end` always is here, stops the run
    debug_assert!(src.byte(end) == 0);
    // SAFETY: `p <= end == len`, and the run stops at the NUL at `end` at
    // the latest.
    while NAME[unsafe { src.byte_unchecked(p) } as usize] {
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

/// End of the whitespace run from `p` (`$scanWhitespace`).
#[inline(always)]
fn space_end(src: Input, mut p: usize, end: usize) -> usize {
    // the NUL at the input end, which `end` always is here, stops the run
    debug_assert!(src.byte(end) == 0);
    // SAFETY: `p <= end == len`, and the run stops at the NUL at `end` at
    // the latest.
    while is_space(unsafe { src.byte_unchecked(p) }) {
        p += 1;
    }
    p
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
    let s = &src.bytes()[..end];
    while p < end {
        let c = s[p];
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

/// End of the number at `lhs`, extended over a hexadecimal fraction
/// (`0x1.f`, `0x1.p2`) (`$lexScanHexNumber` without a required exponent).
#[inline(always)]
fn number_end(src: Input, lhs: usize, end: usize) -> usize {
    let hex = lhs + 1 < end && src.byte(lhs) == b'0' && src.byte(lhs + 1) | 0x20 == b'x';
    let ptr = number_body_end(src, lhs, end, hex);
    if hex && ptr < end {
        let next = byte(src, ptr + 1, end);
        if src.byte(ptr) == b'.' && (is_hex(next) || next | 32 == b'p') {
            if next | 32 == b'p' {
                let mut p = ptr + 1;
                while p < end && (is_hex(src.byte(p)) || src.byte(p) == b'_') {
                    p += 1;
                }
                if p >= end || src.byte(p) | 32 != b'p' {
                    return ptr;
                }
                p += 1;
                if p < end && (src.byte(p) == b'+' || src.byte(p) == b'-') {
                    p += 1;
                }
                if p >= end || !is_digit(src.byte(p)) {
                    return ptr;
                }
            }
            return number_body_end(src, ptr + 1, end, true);
        }
    }
    ptr
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

/// The `quote`d string at `lhs`, which may span lines, with escapes as
/// their own tokens. Returns its end (`$lexString`, `$lexStringBody`).
fn string(src: Input, end: usize, lhs: usize, quote: u8, recs: &mut Recs) -> usize {
    let mut ptr = lhs + 1;
    let mut seg = lhs;
    loop {
        ptr = find_any(src, ptr, end, [quote, b'\\']);
        if ptr >= end {
            break;
        }
        // SAFETY: `ptr < end`.
        if unsafe { src.byte_unchecked(ptr) } == quote {
            ptr += 1;
            break;
        }
        recs.emit(tok::STRING, seg, ptr);
        let e = escape_end(src, ptr, end);
        recs.emit(tok::STRING_ESCAPE, ptr, e);
        ptr = e;
        seg = ptr;
    }
    recs.emit(tok::STRING, seg, ptr);
    ptr
}

/// Whether the name before `p`, its following blanks already skipped, is
/// assigned a function: `<-`, `<<-`, or a single `=` follows on the line,
/// then `function` or a `\(` lambda (`$rDefinedAhead`).
#[inline(always)]
fn defined_ahead(src: Input, mut p: usize, end: usize) -> bool {
    if byte(src, p, end) == b'<' {
        p += 1;
        if byte(src, p, end) == b'<' {
            p += 1;
        }
        if byte(src, p, end) != b'-' {
            return false;
        }
        p += 1;
    } else {
        if byte(src, p, end) != b'=' || byte(src, p + 1, end) == b'=' {
            return false;
        }
        p += 1;
    }
    let p = blanks_end(src, p, end);
    if byte(src, p, end) == b'\\' && byte(src, p + 1, end) == b'(' {
        return true;
    }
    if p + 8 > end {
        return false;
    }
    let after = byte(src, p + 8, end);
    src.word(p) == u64::from_le_bytes(*b"function") && !(is_ident_continue(after) || after == b'.')
}

/// A raw string `r"(...)"`, `R'[...]'`, or `r"---(...)---"` whose prefix
/// is at `lhs`: through its closer (the matching bracket, the same dashes,
/// and the quote) or the end, as one string. Returns its end, or `None`
/// when the bytes are not a raw string opener (`$rRawString`, with
/// `$streamResumeFixed` finding the closer). The closer scan honors the
/// escape byte in `$streamB` as the WAT's does; the stream registers the
/// WAT leaves are written back to the instance.
#[cold]
#[inline(never)]
fn raw_string(
    inst: &mut Instance,
    src: Input,
    end: usize,
    lhs: usize,
    recs: &mut Recs,
) -> Option<usize> {
    let q = byte(src, lhs + 1, end);
    let mut p = lhs + 2;
    let mut n = 0;
    while byte(src, p, end) == b'-' {
        p += 1;
        n += 1;
    }
    if n > 30 {
        return None;
    }
    let close = match byte(src, p, end) {
        b'(' | b')' => b')',
        b'[' | b']' => b']',
        b'{' | b'}' => b'}',
        _ => return None,
    };
    // the closer, as `$mem.streamDelimiter` holds it
    let mut delim = [b'-'; 32];
    delim[0] = close;
    delim[n + 1] = q;
    let dlen = n + 2;
    let body = p + 1;
    recs.tok(tok::STRING, body);
    // $streamResumeFixed
    let escape = inst.g_streamB;
    let mut p = body;
    loop {
        p = find_any(src, p, end, [close]);
        if p + dlen > end {
            recs.emit(tok::STRING, body, end);
            inst.g_streamA = dlen as i32;
            inst.g_streamHl = tok::STRING as i32;
            return Some(end);
        }
        let mut matched = src.bytes()[p + 1..p + dlen] == delim[1..dlen];
        if escape != 0 && p > body && src.byte(p - 1) as i32 == escape {
            matched = false;
        }
        if matched {
            recs.emit(tok::STRING, body, p + dlen);
            inst.g_streamMode = 0;
            inst.g_streamA = 0;
            inst.g_streamHl = 0;
            return Some(p + dlen);
        }
        p += 1;
    }
}

/// Highlight R source of `len` bytes at lexer memory offset `base`
/// (`$hlR`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: `base..base + len + SLACK` is this input in lexer memory;
    // it is made again after every call into translated code.
    let src = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut recs = Recs::load(inst);
    // $lexEmitLeadingContinuation
    let mut ptr = scan::utf8_span_end(src.bytes(), 0, end);
    recs.gap(0, ptr);
    // 1 after `$` or `@`
    let mut member = false;
    // open parens, and the depth of the formals a `function(` or `\(` head
    // opened, where bare names are parameters
    let mut paren: u32 = 0;
    let mut fn_head = false;
    let mut fn_depth: u32 = 0;
    loop {
        let gap = ptr;
        ptr = space_end(src, ptr, end);
        recs.gap(gap, ptr);
        if ptr >= end {
            break;
        }
        let lhs = ptr;
        // SAFETY: `ptr < end`.
        let c = unsafe { src.byte_unchecked(ptr) };
        let at_fn = fn_head;
        fn_head = false;

        // Each byte class takes the rules of `$hlR` that can apply to its
        // bytes, in the WAT's order; a byte no rule takes is plain text.
        macro_rules! name {
            () => {{
                ptr = name_end(src, ptr, end);
                let rhs = ptr;
                let p = blanks_end(src, rhs, end);
                let g = if member {
                    0
                } else {
                    WORDS.group(src.bytes(), lhs, rhs)
                };
                let hl = if g != 0 {
                    match g {
                        2 => {
                            fn_head = true;
                            tok::KEYWORD_DECLARATION
                        }
                        3 => tok::BOOLEAN,
                        4 => tok::CONSTANT_BUILTIN,
                        5 => tok::KEYWORD_OPERATOR,
                        _ => tok::KEYWORD_CONTROL,
                    }
                } else if member {
                    if upto(src, p, end) == b'(' {
                        tok::FUNCTION_METHOD
                    } else {
                        tok::PROPERTY
                    }
                } else if upto(src, rhs, end) == b':' && upto(src, rhs + 1, end) == b':' {
                    tok::NAMESPACE
                } else if matches!(upto(src, p, end), b'<' | b'=') && defined_ahead(src, p, end) {
                    tok::FUNCTION_DEFINITION
                } else if upto(src, p, end) == b'(' {
                    tok::FUNCTION
                } else if (fn_depth != 0 && paren == fn_depth)
                    || (paren != 0 && upto(src, p, end) == b'=' && upto(src, p + 1, end) != b'=')
                {
                    // formals, and `name =` arguments of a call
                    tok::VARIABLE_PARAMETER
                } else {
                    tok::VARIABLE
                };
                recs.tok(hl, rhs);
                member = false;
                // a `(` right after the name, as the bracket rule takes it
                if upto(src, rhs, end) == b'(' {
                    ptr = rhs + 1;
                    recs.tok(tok::PUNCTUATION_BRACKET, ptr);
                    paren = paren.wrapping_add(1);
                    if fn_head {
                        fn_depth = paren;
                    }
                    fn_head = false;
                }
                continue;
            }};
        }
        macro_rules! number {
            () => {{
                ptr = number_end(src, ptr, end);
                recs.emit(tok::NUMBER, lhs, ptr);
                member = false;
                continue;
            }};
        }
        match CLASS[c as usize] {
            class::NAME => name!(),
            class::OP => {
                ptr += 1;
                while OP[upto(src, ptr, end) as usize] {
                    ptr += 1;
                }
                recs.tok(tok::OPERATOR, ptr);
                member = false;
                continue;
            }
            class::BRACKET => {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
                if c == b'(' {
                    paren = paren.wrapping_add(1);
                    if at_fn {
                        fn_depth = paren;
                    }
                }
                if c == b')' {
                    if paren == fn_depth {
                        fn_depth = 0;
                    }
                    paren = paren.saturating_sub(1);
                }
                member = false;
                continue;
            }
            class::DELIMITER => {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                member = false;
                continue;
            }
            class::MEMBER => {
                // `$` and `@` reach into lists and slots
                ptr += 1;
                recs.tok(tok::OPERATOR, ptr);
                member = true;
                continue;
            }
            class::DIGIT => number!(),
            class::QUOTE => {
                ptr = string(src, end, lhs, c, &mut recs);
                member = false;
                continue;
            }
            class::HASH => {
                let c2 = upto(src, ptr + 1, end);
                // `#'` roxygen comments document the next object
                ptr = scan::line_end(src.bytes(), ptr + 1, end);
                recs.tok(
                    if c2 == b'\'' {
                        tok::COMMENT_DOC
                    } else {
                        tok::COMMENT
                    },
                    ptr,
                );
                continue;
            }
            class::R => {
                let c2 = upto(src, ptr + 1, end);
                let c3 = byte(src, ptr + 2, end);
                if (c2 == b'"' || c2 == b'\'')
                    && (c3 == b'-' || c3 == b'(' || c3 == b'[' || c3 == b'{')
                    && let Some(p) = raw_string(inst, src, end, lhs, &mut recs)
                {
                    ptr = p;
                    member = false;
                    continue;
                }
                name!()
            }
            class::DOT => {
                let c2 = upto(src, ptr + 1, end);
                // `...` and `..1`
                if c2 == b'.' {
                    ptr = name_end(src, ptr + 2, end);
                    recs.tok(tok::VARIABLE_SPECIAL, ptr);
                    member = false;
                    continue;
                }
                // names may start with `.`
                if is_ident_start(c2) && c2 != b'$' {
                    name!()
                }
                if is_digit(c2) {
                    number!()
                }
            }
            class::BACKTICK => {
                // $lexRawString: through the closing backtick, else up to
                // the line break
                ptr = find_any(src, ptr + 1, end, *b"`\n\r");
                if ptr < end && src.byte(ptr) == b'`' {
                    ptr += 1;
                }
                recs.tok(tok::VARIABLE, ptr);
                member = false;
                continue;
            }
            class::PERCENT => {
                // `%in%`, `%>%`, and other user operators
                let p = find_any(src, ptr + 1, end, *b"%\n\r");
                ptr = if p < end && src.byte(p) == b'%' {
                    p + 1
                } else {
                    ptr + 1
                };
                recs.tok(tok::OPERATOR, ptr);
                member = false;
                continue;
            }
            class::BACKSLASH => {
                let c2 = upto(src, ptr + 1, end);
                // `\(x)` lambda
                if c2 == b'(' {
                    ptr += 1;
                    recs.tok(tok::KEYWORD_DECLARATION, ptr);
                    fn_head = true;
                    continue;
                }
            }
            _ => {}
        }
        ptr = scan::utf8_span_end(src.bytes(), ptr + 1, end);
        recs.tok(tok::NONE, ptr);
        member = false;
    }
    recs.store(inst);
}
