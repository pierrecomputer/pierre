//! WAT sources: src/langs/angular-html.wat src/langs/html.wat src/langs/js.wat src/langs/xml.wat src/common.wat src/scan.wat
//!
//! Native Angular template lexer (`$hlAngularHtml`). It runs the template
//! markup state machine (`$hlTemplateMarkup` with Angular on): text with
//! `{{ }}` interpolations, `@if`/`@for`/`@let` control blocks and their
//! braces, character references, comments and declarations, and tags whose
//! bound attributes (`[x]`, `(x)`, `*x`) take expression values. Angular
//! expressions (`$angularExpression`) are lexed here too: strings, names
//! (keywords, members, calls, pipes), numbers, brackets, and operators.
//! Nothing is delegated. The native lexer only runs on whole input, so the
//! WAT's streaming branches (`$streaming` set) never apply.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::KeywordTable;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::ANGULAR_WORDS;

/// The lexer for each language this module handles.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "angular-html" => Some(highlight),
        _ => None,
    }
}

/// `bytes` as a little-endian integer, the way the WAT writes string
/// constants such as `(i64.const "script")`.
const fn word(bytes: &[u8]) -> u64 {
    let mut w = 0u64;
    let mut i = 0;
    while i < bytes.len() {
        w |= (bytes[i] as u64) << (8 * i);
        i += 1;
    }
    w
}

/// Bytes that end a tag or attribute name (`$htmlNameEnd`).
static NAME_STOP: [bool; 256] = super::tables::byteset(b"\x09\x0a\x0b\x0c\x0d \"'/<=>");

/// Bytes that end an unquoted attribute value (`$htmlValueEnd`).
static VALUE_STOP: [bool; 256] = super::tables::byteset(b"\x09\x0a\x0b\x0c\x0d \"'<>");

/// Space, or TAB through CR (`$lexIsSpace`).
#[inline(always)]
fn is_space(c: u8) -> bool {
    c == b' ' || c.wrapping_sub(9) <= 4
}

/// The first position in `[p, end)` holding `a` or `b`, or `end`
/// (`$lexFindEither`, `$lexFindByte`). Loads may pass `end` into the input
/// slack; matches there are clamped away.
#[inline(always)]
fn find2(src: Input, mut p: usize, end: usize, a: u8, b: u8) -> usize {
    while p < end {
        // SAFETY: `p < end`, at most the input length, so the 16 bytes lie
        // inside the input and its slack.
        let w = unsafe { src.vec_unchecked(p) };
        let k = w.eq(V::splat(a)).or(w.eq(V::splat(b))).first();
        if k < 16 {
            return (p + k).min(end);
        }
        p += 16;
    }
    end
}

/// End of the character reference at the `&` at `ptr`, past its `;`, or
/// `None` when none starts there (`$htmlEntity`).
fn entity_end(src: Input, ptr: usize, end: usize) -> Option<usize> {
    let mut q = ptr + 1;
    if q < end && src.byte(q) == b'#' {
        q += 1;
    }
    while q < end && q - ptr <= 32 {
        let c = src.byte(q);
        if c.wrapping_sub(b'0') > 9 && (c | 32).wrapping_sub(b'a') > 25 {
            break;
        }
        q += 1;
    }
    let min = if src.byte(ptr + 1) == b'#' { 2 } else { 1 };
    if q - ptr <= min || q >= end || src.byte(q) != b';' {
        return None;
    }
    Some(q + 1)
}

/// End of the tag or attribute name from `q` (`$htmlNameEnd`).
#[inline(always)]
fn name_end(src: Input, mut q: usize, end: usize) -> usize {
    // SAFETY: `q < end <= len`.
    while q < end && !NAME_STOP[unsafe { src.byte_unchecked(q) } as usize] {
        q += 1;
    }
    q
}
/// End of the unquoted attribute value from `q` (`$htmlValueEnd`).
#[inline(always)]
fn value_end(src: Input, mut q: usize, end: usize) -> usize {
    // SAFETY: `q < end <= len`.
    while q < end && !VALUE_STOP[unsafe { src.byte_unchecked(q) } as usize] {
        q += 1;
    }
    q
}

/// Angular's keyword table (`$angularWords`).
static WORDS: KeywordTable<512> = KeywordTable::new(ANGULAR_WORDS);

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

/// The first byte of an XML name: letters, `_`, `:`, or non-ASCII
/// (`$xmlNameStart`).
#[inline(always)]
fn is_xml_name_start(c: u8) -> bool {
    c >= 0x80 || (c | 32).wrapping_sub(b'a') <= 25 || c == b'_' || c == b':'
}

/// The bytes of an identifier run: letters, digits, `_`, `$`, and every
/// byte from 128 (`$scanIdentRun` with `$`).
static IDENT: [bool; 256] = {
    let mut t = [false; 256];
    let mut i = 0;
    while i < 256 {
        t[i] = is_ident_continue(i as u8);
        i += 1;
    }
    t
};

/// End of the identifier run from `p` (`$lexScanIdent`).
#[inline(always)]
fn ident_end(src: Input, mut p: usize, end: usize) -> usize {
    // the NUL at the input end, which `end` always is here, stops the run
    debug_assert!(src.byte(end) == 0);
    // SAFETY: `p <= end`, and the run stops at the NUL at `end` at the latest.
    while IDENT[unsafe { src.byte_unchecked(p) } as usize] {
        p += 1;
    }
    p
}

/// End of the whitespace run from `p` (`$scanWhitespace`).
#[inline(always)]
fn space_end(src: Input, mut p: usize, end: usize) -> usize {
    // the NUL at the input end, which `end` always is here, stops the run
    debug_assert!(src.byte(end) == 0);
    // SAFETY: `p <= end`, and the run stops at the NUL at `end` at the latest.
    while is_space(unsafe { src.byte_unchecked(p) }) {
        p += 1;
    }
    p
}

/// End of the spaces and tabs from `p` (`$lexSkipSpaceAt`).
#[inline(always)]
fn blanks_end(src: Input, mut p: usize, end: usize) -> usize {
    // SAFETY: `p < end <= len`.
    while p < end && matches!(unsafe { src.byte_unchecked(p) }, b' ' | b'\t') {
        p += 1;
    }
    p
}

/// The byte at `p`, or 0 at or past the end (`$tsxByte`).
#[inline(always)]
fn byte_at(src: Input, p: usize, end: usize) -> u8 {
    if p < end {
        // SAFETY: `p < end <= len`.
        unsafe { src.byte_unchecked(p) }
    } else {
        0
    }
}

/// The keyword token for `[from, to)`, or a variable (`$angularKeyword`).
#[inline(always)]
fn keyword(src: Input, from: usize, to: usize) -> u32 {
    let hl = WORDS.value(src.bytes(), from, to);
    if hl >= 0 { hl as u32 } else { tok::VARIABLE }
}

/// End of at most `max` hex digits from `p`, bounded by `end`
/// (`$scanHexRun`).
fn hex_run_end(src: Input, mut p: usize, max: usize, end: usize) -> usize {
    let stop = (p + max).min(end);
    while p < stop {
        let c = src.byte(p);
        if c.wrapping_sub(b'0') > 9 && (c | 32).wrapping_sub(b'a') > 5 {
            break;
        }
        p += 1;
    }
    p
}

/// `[from, to)` as `hl`, with backslash escapes (`\uXXXX`, `\u{...}`,
/// `\xXX`, or one character) as their own tokens (`$emitEscaped`).
#[inline(always)]
fn emit_escaped(src: Input, end: usize, recs: &mut Recs, hl: u32, from: usize, to: usize) {
    let mut seg = from;
    let mut from = from;
    loop {
        if from < to {
            from = find2(src, from, to, b'\\', b'\\');
        }
        if from >= to {
            break;
        }
        recs.emit(hl, seg, from);
        let c = byte_at(src, from + 1, end);
        let e = if c == b'u' {
            if byte_at(src, from + 2, end) == b'{' {
                // `\u{...}`: the hex run and its closing brace
                let mut e = hex_run_end(src, from + 3, 16, end);
                if e < to && src.byte(e) == b'}' {
                    e += 1;
                }
                e
            } else {
                hex_run_end(src, from + 2, 4, end)
            }
        } else if c == b'x' {
            hex_run_end(src, from + 2, 2, end)
        } else {
            from + 2
        };
        let e = scan::utf8_span_end(src.bytes(), e, to);
        recs.emit(tok::STRING_ESCAPE, from, e);
        from = e;
        seg = e;
    }
    recs.emit(hl, seg, to);
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

/// A `quote`d string body from `ptr`, emitted from `seg`, which may span
/// lines, with escapes as their own tokens. Returns its end and the
/// status: 1 after the closing quote, 2 after an escaped line break at the
/// end, else 0 (`$lexStringBody` for a string).
fn string_body(
    src: Input,
    end: usize,
    mut ptr: usize,
    mut seg: usize,
    quote: u8,
    recs: &mut Recs,
) -> (usize, u32) {
    let mut status = 0;
    loop {
        if ptr < end {
            ptr = find2(src, ptr, end, quote, b'\\');
        }
        if ptr >= end {
            break;
        }
        // SAFETY: `ptr` is below the input end (tested above).
        if unsafe { src.byte_unchecked(ptr) } == quote {
            ptr += 1;
            status = 1;
            break;
        }
        recs.emit(tok::STRING, seg, ptr);
        let e = escape_end(src, ptr, end);
        recs.emit(tok::STRING_ESCAPE, ptr, e);
        ptr = e;
        if ptr == end && ptr > seg && (src.byte(ptr - 1) == b'\n' || src.byte(ptr - 1) == b'\r') {
            status = 2;
        }
        seg = ptr;
    }
    recs.emit(tok::STRING, seg, ptr);
    (ptr, status)
}

/// End of the number at `p` (`$lexScanNumber`, `$lexScanNumberBody`).
fn number_end(src: Input, mut p: usize, end: usize) -> usize {
    let s = &src.bytes()[..end];
    let hex = p + 1 < end && s[p] == b'0' && s[p + 1] | 0x20 == b'x';
    let mut prev = 0u8;
    while p < end {
        let c = s[p];
        if is_ident_continue(c) {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            let next = if p + 1 < end { s[p + 1] } else { 0 };
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

/// An Angular expression from `*ptr` (`$angularExpression`). `state`
/// packs the markup mode to return to (bits 0-5), the expression kind
/// (bits 7-9: 1 interpolation, 2 binding, 3 block header, 4 `@let`
/// assignment, 5 awaiting a block header), an open string's quote (bits
/// 10-16), the bracket depth (bits 17-28), and the member or pipe context
/// (bits 29-30). Returns the state to continue with: the markup state once
/// the expression ends, or the packed expression state at the end.
#[inline(always)]
fn expression(src: Input, end: usize, ptr: &mut usize, recs: &mut Recs, state: u32) -> u32 {
    let mode = state & 63;
    let mut expr = state >> 7 & 7;
    let mut quote = (state >> 10 & 127) as u8;
    let mut depth = state >> 17 & 4095;
    let mut member = state >> 29;
    let mut ptr_ = *ptr;
    // A string left open: only possible on entry, since a string opened
    // below either closes or runs to the end.
    if quote != 0 && ptr_ < end {
        let status;
        (ptr_, status) = string_body(src, end, ptr_, ptr_, quote, recs);
        if status != 0 {
            quote = 0;
        }
    }
    let r = 'done: loop {
        if ptr_ >= end {
            break 'done mode | expr << 7 | (quote as u32) << 10 | depth << 17 | member << 29;
        }
        let p = ptr_;
        // SAFETY: `p < end <= len`.
        let c = unsafe { src.byte_unchecked(p) };
        // A name: no rule before the name rules applies to a name byte,
        // so names are tested first.
        if is_ident_start(c) {
            if expr == 5 {
                ptr_ = ident_end(src, p, end);
                recs.tok(keyword(src, p, ptr_), ptr_);
                continue;
            }
            ptr_ = ident_end(src, p, end);
            // a member or pipe name's token never depends on the keyword
            let mut hl = if member != 0 {
                if member == 1 {
                    tok::PROPERTY
                } else {
                    tok::FUNCTION
                }
            } else {
                let hl = keyword(src, p, ptr_);
                if hl == tok::KEYWORD_CONTROL {
                    tok::VARIABLE
                } else {
                    hl
                }
            };
            if member != 2 && byte_at(src, blanks_end(src, ptr_, end), end) == b'(' {
                hl = if member != 0 {
                    tok::FUNCTION_METHOD
                } else {
                    tok::FUNCTION
                };
            }
            recs.tok(hl, ptr_);
            member = 0;
            // a `.` right after the name, as the operator rules take it
            // SAFETY: `ptr_` is below the input end (tested first), so
            // `ptr_ + 1` is at most the end.
            if ptr_ < end
                && unsafe { src.byte_unchecked(ptr_) } == b'.'
                && !is_digit(unsafe { src.byte_unchecked(ptr_ + 1) })
            {
                ptr_ += 1;
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr_);
                member = 1;
            }
            continue;
        }
        // whitespace, unless it ends an unquoted binding below
        if is_space(c) && !(expr == 2 && mode == 5) {
            ptr_ = space_end(src, p, end);
            recs.gap(p, ptr_);
            continue;
        }
        if expr == 2 {
            if c as u32 == mode {
                ptr_ = p + 1;
                recs.tok(tok::STRING, ptr_);
                break 'done 3;
            }
            if mode == 5 && (is_space(c) || c == b'>') {
                break 'done 3;
            }
        }
        if expr == 5 {
            if is_ident_start(c) {
                ptr_ = ident_end(src, p, end);
                recs.tok(keyword(src, p, ptr_), ptr_);
                continue;
            }
            if c == b'(' {
                ptr_ = p + 1;
                recs.tok(tok::PUNCTUATION_BRACKET, ptr_);
                expr = 3;
                continue;
            }
            if c == b';' {
                ptr_ = p + 1;
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr_);
            }
            break 'done 1;
        }
        if depth == 0 {
            if expr == 1 && c == b'}' && byte_at(src, p + 1, end) == b'}' {
                ptr_ = p + 2;
                recs.tok(tok::PUNCTUATION_SPECIAL, ptr_);
                break 'done mode;
            }
            if (expr == 3 && c == b')') || (expr == 4 && c == b';') {
                ptr_ = p + 1;
                recs.tok(
                    if expr == 3 {
                        tok::PUNCTUATION_BRACKET
                    } else {
                        tok::PUNCTUATION_DELIMITER
                    },
                    ptr_,
                );
                break 'done 1;
            }
        }
        if c == b'"' || c == b'\'' || c == b'`' {
            quote = c;
            member = 0;
            let status;
            (ptr_, status) = string_body(src, end, p + 1, p, quote, recs);
            if status != 0 {
                quote = 0;
            }
            continue;
        }
        member = 0;
        if is_digit(c) || (c == b'.' && is_digit(byte_at(src, p + 1, end))) {
            ptr_ = number_end(src, p, end);
            recs.emit(tok::NUMBER, p, ptr_);
            continue;
        }
        ptr_ = p + 1;
        let mut hl = tok::OPERATOR;
        if c == b'(' || c == b'[' || c == b'{' {
            depth += (depth < 4095) as u32;
            hl = tok::PUNCTUATION_BRACKET;
        }
        if c == b')' || c == b']' || c == b'}' {
            depth -= (depth != 0) as u32;
            hl = tok::PUNCTUATION_BRACKET;
        }
        if c == b';' || c == b':' || c == b',' {
            hl = tok::PUNCTUATION_DELIMITER;
        }
        if c == b'.' {
            hl = tok::PUNCTUATION_DELIMITER;
            member = 1;
        }
        if c == b'|' {
            if byte_at(src, ptr_, end) == b'|' {
                ptr_ += 1;
            } else {
                member = 2;
            }
        }
        recs.tok(hl, ptr_);
    };
    *ptr = ptr_;
    r
}

/// Text bytes: 1 for those that end a text run (`<`, `&`, `@`, `{`,
/// `}`), 2 for a backslash, which starts an escape.
static TEXT: [u8; 256] = {
    let mut t = [0u8; 256];
    t[b'<' as usize] = 1;
    t[b'&' as usize] = 1;
    t[b'@' as usize] = 1;
    t[b'{' as usize] = 1;
    t[b'}' as usize] = 1;
    t[b'\\' as usize] = 2;
    t
};

/// The template markup state machine from `ptr` over `[ptr, end)`
/// (`$hlTemplateMarkup` with Angular on). Markup modes in `state` bits
/// 0-5: 1 text, 2 tag name, 3 attributes, 4 value, 5 unquoted value, 6
/// comment, 7 declaration, 8 processing instruction, 34 or 39 a quoted
/// value; bit 6 marks a bound attribute, and bits from 7 an expression
/// (see [`expression`]). Returns the records.
fn markup(src: Input, end: usize, mut ptr: usize, mut state: u32, mut recs: Recs) -> Recs {
    let from = ptr;
    // the input up to `end`: reads below `end` need no bounds check of their own
    let s = &src.bytes()[..end];
    while ptr < end {
        let p = ptr;
        let c = s[p];
        // plain text mode, the most common state
        if state == 1 {
            if c == b'<' {
                let c = byte_at(src, p + 1, end);
                if c == b'!' || c == b'?' {
                    state = if c == b'?' { 8 } else { 7 };
                    if p + 4 <= end && (src.word(p) as u32) == word(b"<!--") as u32 {
                        state = 6;
                    }
                    continue;
                }
                if c == b'/' || is_xml_name_start(c) {
                    ptr = p + if c == b'/' { 2 } else { 1 };
                    recs.tok(tok::PUNCTUATION_BRACKET_HTML, ptr);
                    state = 2;
                    // the tag name, as mode 2 takes it: a name start byte
                    // never ends a name
                    if c != b'/' || (ptr < end && !NAME_STOP[s[ptr] as usize]) {
                        ptr = name_end(src, ptr, end);
                        recs.tok(tok::TAG, ptr);
                        state = 3;
                        // `>` right after the name, as attribute mode takes it
                        if ptr < end && s[ptr] == b'>' {
                            ptr += 1;
                            recs.tok(tok::PUNCTUATION_BRACKET_HTML, ptr);
                            state = 1;
                        }
                    }
                    continue;
                }
            }
            if c == b'{' && byte_at(src, p + 1, end) == b'{' {
                ptr = p + 2;
                recs.tok(tok::PUNCTUATION_SPECIAL, ptr);
                state = 129;
                continue;
            }
            if c == b'@' {
                let q = ident_end(src, p + 1, end);
                let hl = keyword(src, p + 1, q);
                if hl == tok::KEYWORD_CONTROL || hl == tok::KEYWORD_DECLARATION {
                    ptr = q;
                    recs.tok(hl, ptr);
                    state = if hl == tok::KEYWORD_DECLARATION {
                        513
                    } else {
                        641
                    };
                    continue;
                }
            }
            if c == b'{' || c == b'}' {
                ptr = p + 1;
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
                continue;
            }
            if c == b'&'
                && let Some(q) = entity_end(src, p, end)
            {
                ptr = q;
                recs.tok(tok::STRING_SPECIAL, ptr);
                continue;
            }
            // the text run, noting whether it holds a backslash
            ptr = p + 1;
            while ptr < end && TEXT[s[ptr] as usize] == 0 {
                ptr += 1;
            }
            let mut escapes = c == b'\\';
            if ptr < end && s[ptr] == b'\\' {
                core::hint::cold_path();
                escapes = true;
                while ptr < end && TEXT[s[ptr] as usize] != 1 {
                    ptr += 1;
                }
            }
            if escapes {
                emit_escaped(src, end, &mut recs, tok::NONE, p, ptr);
            } else {
                recs.tok(tok::NONE, ptr);
            }
            continue;
        }
        if state & 896 != 0 {
            state = expression(src, end, &mut ptr, &mut recs, state);
            continue;
        }
        let mode = state & 63;
        if mode <= 5 {
            // An attribute name: every byte the rules below take before the
            // name rule ends a name, so in attribute mode names come first.
            if mode == 3 && !NAME_STOP[c as usize] {
                ptr = name_end(src, p, end);
                state = 3 | if c == b'[' || c == b'(' || c == b'*' {
                    64
                } else {
                    0
                };
                // the common `="` follower, as the rules below take it
                if ptr + 1 < end && s[ptr] == b'=' {
                    let q = s[ptr + 1];
                    if q == b'"' || q == b'\'' {
                        recs.tok(tok::ATTRIBUTE, ptr);
                        ptr += 1;
                        recs.tok(tok::PUNCTUATION_DELIMITER_HTML, ptr);
                        ptr += 1;
                        recs.tok(tok::STRING, ptr);
                        state = q as u32 | if state & 64 != 0 { 256 } else { 0 };
                        continue;
                    }
                }
                recs.tok(tok::ATTRIBUTE, ptr);
                continue;
            }
            if is_space(c) {
                ptr = space_end(src, p, end);
                recs.gap(p, ptr);
                if mode == 5 {
                    state = 3;
                }
                continue;
            }
            ptr = p + 1;
            let mut hl = tok::PUNCTUATION_BRACKET_HTML;
            if c == b'>' {
                state = 1;
            } else {
                if c == b'<' {
                    ptr = p;
                    state = 1;
                    continue;
                }
                if c == b'"' || c == b'\'' {
                    state = c as u32 | if state & 64 != 0 { 256 } else { 0 };
                    recs.tok(tok::STRING, ptr);
                    continue;
                }
                if mode == 4 || mode == 5 {
                    if state & 64 != 0 {
                        ptr = p;
                        state = 261;
                        continue;
                    }
                    ptr = value_end(src, p, end);
                    state = 5;
                    emit_escaped(src, end, &mut recs, tok::STRING, p, ptr);
                    continue;
                }
                if c == b'=' {
                    state = 4 | (state & 64);
                    hl = tok::PUNCTUATION_DELIMITER_HTML;
                } else if c != b'/' {
                    ptr = name_end(src, p, end);
                    hl = if mode == 2 { tok::TAG } else { tok::ATTRIBUTE };
                    state = 3 | if mode != 2 && (c == b'[' || c == b'(' || c == b'*') {
                        64
                    } else {
                        0
                    };
                }
            }
            recs.emit(hl, p, ptr);
            continue;
        }
        if mode == 34 || mode == 39 {
            let q = mode as u8;
            ptr = find2(src, ptr, end, q, b'{');
            if byte_at(src, ptr, end) == b'{' {
                emit_escaped(src, end, &mut recs, tok::STRING, p, ptr);
                let p = ptr;
                if byte_at(src, ptr + 1, end) == b'{' {
                    state = mode | 128;
                    ptr += 2;
                    recs.tok(tok::PUNCTUATION_SPECIAL, ptr);
                } else {
                    ptr += 1;
                    recs.emit(tok::STRING, p, ptr);
                }
                continue;
            }
            if ptr < end {
                ptr += 1;
                state = 3;
            }
            emit_escaped(src, end, &mut recs, tok::STRING, p, ptr);
            continue;
        }
        if mode >= 6 {
            loop {
                ptr = find2(src, ptr, end, b'>', b'>');
                if ptr >= end {
                    break;
                }
                if mode == 7
                    || (mode == 6
                        && ptr - from >= 2
                        && src.byte(ptr - 2) == b'-'
                        && src.byte(ptr - 1) == b'-')
                    || (mode == 8 && ptr > from && src.byte(ptr - 1) == b'?')
                {
                    state = 1;
                }
                ptr += 1;
                if state == 1 {
                    break;
                }
            }
            recs.emit(
                if mode == 7 {
                    tok::TAG_DOCTYPE
                } else {
                    tok::COMMENT
                },
                p,
                ptr,
            );
            continue;
        }
    }
    recs
}

/// Highlight an Angular template of `len` bytes at lexer memory offset
/// `base` (`$hlAngularHtml`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let src = unsafe { Input::new(inst, base, len) };
    let mut recs = Recs::load(inst);
    // $lexEmitLeadingContinuation
    let ptr = scan::utf8_span_end(src.bytes(), 0, len);
    recs.gap(0, ptr);
    let recs = markup(src, len, ptr, 1, recs);
    recs.store(inst);
}
