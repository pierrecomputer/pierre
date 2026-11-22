//! WAT sources: src/langs/json.wat src/common.wat src/scan.wat
//!
//! Native JSON lexer, shared by JSON (with JSONC comments), JSON5, and
//! JSONL (a dialect parameter picks the extra forms each one has). One pass
//! over the input: strings are object keys or values by the container they
//! sit in, and numbers, literals, brackets, and delimiters get their fixed
//! colors. The records equal the translated `json`, `json5`, and `jsonl`
//! lexers' records.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;

/// The lexer for each language this module handles.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "json" => Some(json),
        "json5" => Some(json5),
        "jsonl" => Some(jsonl),
        _ => None,
    }
}

/// The dialects, as `$hlJsonImpl` numbers them.
const JSON: u32 = 0;
const JSON5: u32 = 1;
const JSONL: u32 = 2;

/// The deepest container whose kind is remembered (`$mem.jsonStack`).
const STACK: usize = 1024;

/// JSON with JSONC comments (`$hlJson`).
fn json(inst: &mut Instance, base: usize, len: usize) {
    highlight::<JSON>(inst, base, len);
}

/// JSON5 (`$hlJson5`).
fn json5(inst: &mut Instance, base: usize, len: usize) {
    highlight::<JSON5>(inst, base, len);
}

/// JSON Lines (`$hlJsonl`).
fn jsonl(inst: &mut Instance, base: usize, len: usize) {
    highlight::<JSONL>(inst, base, len);
}

/// Whether `c` is ASCII whitespace (`$lexIsSpace`).
#[inline(always)]
const fn is_space(c: u8) -> bool {
    c == 32 || c.wrapping_sub(9) <= 4
}

/// Whether `c` is an ASCII digit (`$lexIsDigit`).
#[inline(always)]
fn is_digit(c: u8) -> bool {
    c.wrapping_sub(b'0') <= 9
}

/// Whether `c` is an ASCII letter.
#[inline(always)]
fn is_letter(c: u8) -> bool {
    (c | 32).wrapping_sub(b'a') <= 25
}

/// Whether `c` starts a JavaScript identifier: a letter, `_`, `$`, or any
/// byte from 128 (`$lexIsIdentStart`).
#[inline(always)]
fn is_ident_start(c: u8) -> bool {
    c >= 0x80 || is_letter(c) || c == b'_' || c == b'$'
}

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run by the input end.
#[inline(always)]
fn space_end(src: Input<'_>, mut p: usize) -> usize {
    // The first two bytes one by one: most gaps are a single space or a
    // line break with indentation.
    // SAFETY: `p` is at most the input end: whitespace runs stop at the NUL
    // after it.
    if !SPACE[unsafe { src.byte_unchecked(p) } as usize] {
        return p;
    }
    p += 1;
    // SAFETY: `p` is at most the input end: whitespace runs stop at the NUL
    // after it.
    if !SPACE[unsafe { src.byte_unchecked(p) } as usize] {
        return p;
    }
    p += 1;
    loop {
        // Skip spaces 8 bytes at a time, then step over one other
        // whitespace byte (TAB to CR) and go on.
        // SAFETY: `p` is at most the input end (the NUL after it ends the run),
        // so its 8 bytes stay inside the slack.
        let w = unsafe { src.word_unchecked(p) };
        let x = w ^ 0x2020_2020_2020_2020;
        if x == 0 {
            p += 8;
            continue;
        }
        p += (x.trailing_zeros() / 8) as usize;
        // SAFETY: `p` is at most the input end: whitespace runs stop at the NUL
        // after it.
        if !SPACE[unsafe { src.byte_unchecked(p) } as usize] {
            return p;
        }
        p += 1;
    }
}

/// ASCII whitespace as a table: space and TAB through CR (`$lexIsSpace`).
static SPACE: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = is_space(c as u8);
        c += 1;
    }
    t
};

/// The end of the run of identifier bytes (letters, digits, `_`, `$`, any
/// byte from 128) from `p` (`$scanIdentRun` with `$`). The NUL after the
/// input ends every run by the input end.
#[inline(always)]
fn ident_run(src: Input<'_>, mut p: usize) -> usize {
    loop {
        // SAFETY: the run starts at or before the input end and stops at the
        // NUL after it at the latest.
        let c = unsafe { src.byte_unchecked(p) };
        if !(is_letter(c) || is_digit(c) || c == b'_' || c == b'$' || c >= 0x80) {
            return p;
        }
        p += 1;
    }
}

/// The end of at most `max` hex digits from `p`, bounded by `end`
/// (`$scanHexRun`).
#[inline(always)]
fn hex_run(src: Input<'_>, end: usize, mut p: usize, max: usize) -> usize {
    let stop = (p + max).min(end);
    // SAFETY: `p` is below `stop`, which is at most the input end.
    while p < stop && unsafe { src.byte_unchecked(p) }.is_ascii_hexdigit() {
        p += 1;
    }
    p
}

/// The end of the escape at the backslash at `p`: one character, whole
/// with its UTF-8 tail, and the LF of an escaped CRLF (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(src: Input<'_>, end: usize, p: usize) -> usize {
    let mut e = scan::utf8_span_end(src.bytes(), p + 2, end);
    // SAFETY: the backslash at `p` lies below the input end, so `p + 1` is
    // at most the input end, and `e` is below it (tested).
    if e == p + 2
        && unsafe { src.byte_unchecked(p + 1) } == 13
        && e < end
        && unsafe { src.byte_unchecked(e) } == 10
    {
        e += 1;
    }
    e
}

/// The color of the word `[lhs, rhs)`: `true` and `false` are booleans,
/// `null` (and in JSON5 `Infinity` and `NaN`) a builtin constant, anything
/// else plain (`$jsonWordHl`).
#[inline(always)]
fn word_hl(src: Input<'_>, lhs: usize, rhs: usize, json5: bool) -> u32 {
    let w = &src.bytes()[lhs..rhs];
    match w {
        b"true" | b"false" => tok::BOOLEAN,
        b"null" => tok::CONSTANT_BUILTIN,
        b"Infinity" | b"NaN" if json5 => tok::CONSTANT_BUILTIN,
        _ => tok::NONE,
    }
}

/// A string body from `p`, after the opening `quote` at `seg`, colored
/// `hl` with its escapes as separate tokens; returns its end. `\u` and,
/// in JSON5, `\x` escapes span the hex digits present; a raw line break
/// ends the string unconsumed (`$jsonString`).
#[allow(clippy::too_many_arguments)]
#[inline(always)]
fn json_string(
    src: Input<'_>,
    end: usize,
    mut out: Recs,
    hl: u32,
    quote: u8,
    json5: bool,
    mut seg: usize,
    mut p: usize,
) -> (usize, Recs) {
    loop {
        p = string_stop(src, p, quote);
        // SAFETY: the stop scan ends at the NUL after the input at the latest.
        let c = unsafe { src.byte_unchecked(p) };
        if c == quote {
            p += 1;
            break;
        }
        if c != b'\\' {
            // A raw line break, the NUL at the input end, or another
            // control byte, which the string goes on over.
            if c == 10 || c == 13 || p >= end {
                break;
            }
            p += 1;
            continue;
        }
        if seg < p {
            out.tok(hl, p);
        }
        // SAFETY: the backslash at `p` lies below the input end, so `p + 1` is
        // at most the NUL after it.
        let c = unsafe { src.byte_unchecked(p + 1) };
        let e = if c == b'u' || (json5 && c == b'x') {
            let max = if c == b'u' { 4 } else { 2 };
            scan::utf8_span_end(src.bytes(), hex_run(src, end, p + 2, max), end)
        } else {
            escape_end(src, end, p)
        };
        out.tok(tok::STRING_ESCAPE, e);
        p = e;
        seg = p;
    }
    if seg < p {
        out.tok(hl, p);
    }
    (p, out)
}

/// The first byte from `p` that is `quote`, a backslash, or a control
/// byte up to CR: every byte that can end or split a string, and some
/// that can't (TAB, a NUL inside the input), which the caller steps over.
/// The NUL after the input ends every scan.
#[inline(always)]
fn string_stop(src: Input<'_>, mut p: usize, quote: u8) -> usize {
    let q = V::splat(quote);
    let bs = V::splat(b'\\');
    let ctl = V::splat(13);
    loop {
        // SAFETY: the scan stops at the NUL after the input at the latest, so
        // each 16-byte read starts at or before it, inside the slack.
        let v = unsafe { src.vec_unchecked(p) };
        let k = v.eq(q).or(v.eq(bs)).or(v.le(ctl)).first();
        if k < 16 {
            return p + k;
        }
        p += 16;
    }
}

/// The loose number tail from `p`: digits, dots, and exponents with their
/// sign (`$jsonNumber`). The NUL after the input stops it.
#[inline(always)]
fn json_number(src: Input<'_>, mut p: usize) -> usize {
    let mut prev = 0u8;
    loop {
        // SAFETY: the number starts at or before the input end and stops at the
        // NUL after it at the latest.
        let c = unsafe { src.byte_unchecked(p) };
        let consume = is_digit(c)
            || c == b'.'
            || c | 32 == b'e'
            || ((c == b'+' || c == b'-') && prev | 32 == b'e');
        if !consume {
            return p;
        }
        prev = c;
        p += 1;
    }
}

/// A JSON5 number at `p`: an optional sign, then `0x` hex digits,
/// `Infinity` or `NaN`, or a decimal with an optional leading or trailing
/// dot. Returns its color and end; a sign before another word takes that
/// word's color (`$json5Number`).
#[inline(always)]
fn json5_number(src: Input<'_>, end: usize, mut p: usize) -> (u32, usize) {
    // SAFETY: the number starts below the input end, so the byte after its
    // sign is at most the NUL after it.
    let mut c = unsafe { src.byte_unchecked(p) };
    if c == b'+' || c == b'-' {
        p += 1;
        // The NUL after the input reads as the WAT's 0 past the end.
        // SAFETY: see above.
        c = unsafe { src.byte_unchecked(p) };
    }
    let lhs = p;
    if is_letter(c) {
        p = ident_run(src, p);
        return (word_hl(src, lhs, p, true), p);
    }
    // SAFETY: `p + 1` is below the input end (tested).
    if c == b'0' && p + 1 < end && unsafe { src.byte_unchecked(p + 1) } | 32 == b'x' {
        return (tok::NUMBER, hex_run(src, end, p + 2, end - p));
    }
    (tok::NUMBER, json_number(src, p))
}

/// The string-stop and whitespace classes as two nibble tables: byte `b`
/// is in a class when `CLASS_HI[b >> 4] & CLASS_LO[b & 15]` has one of its
/// bits. Stop bits: 1 for NUL to CR, 2 for `"`, 4 for a backslash;
/// whitespace bits: 8 for TAB to CR, 16 for a space.
const CLASS_HI: [u8; 16] = [1 | 8, 0, 2 | 16, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const CLASS_LO: [u8; 16] = {
    let mut t = [0u8; 16];
    let mut l = 0;
    while l < 16 {
        let mut m = 0;
        if l <= 13 {
            m |= 1;
        }
        if l == 2 {
            m |= 2;
        }
        if l == 12 {
            m |= 4;
        }
        if l >= 9 && l <= 13 {
            m |= 8;
        }
        if l == 0 {
            m |= 16;
        }
        t[l] = m;
        l += 1;
    }
    t
};
const STOP_BITS: u8 = 1 | 2 | 4;
const SPACE_BITS: u8 = 8 | 16;

/// Bit masks of two adjacent 64-byte blocks of the input, the second
/// starting at `mid`: for each byte, whether it can stop a string (`"`, a
/// backslash, or a control byte up to CR, as [`string_stop`] tests) and
/// whether it is not whitespace. A scan over the window is a shift and a
/// bit count, so the next token's start does not wait on a vector scan of
/// the bytes before it.
#[derive(Clone, Copy)]
struct Window {
    mid: usize,
    stop0: u64,
    text0: u64,
    stop1: u64,
    text1: u64,
}

/// The string-stop and non-whitespace masks of the 64 bytes from `b`.
/// `b + 64` must lie inside the input slack.
#[inline(always)]
fn block_masks(src: Input<'_>, b: usize) -> (u64, u64) {
    let hi_t = V::from_array(&CLASS_HI);
    let lo_t = V::from_array(&CLASS_LO);
    let mut stop = [V::zero(); 4];
    let mut space = [V::zero(); 4];
    for i in 0..4 {
        // SAFETY: every window block starts at or before the input end, so its
        // 64 bytes stay inside the slack.
        let v = unsafe { src.vec_unchecked(b + 16 * i) };
        let class = hi_t
            .lookup(v.shr::<4>())
            .and(lo_t.lookup(v.and(V::splat(15))));
        stop[i] = class.test(V::splat(STOP_BITS));
        space[i] = class.test(V::splat(SPACE_BITS));
    }
    (
        V::bits64(stop[0], stop[1], stop[2], stop[3]),
        !V::bits64(space[0], space[1], space[2], space[3]),
    )
}

impl Window {
    /// The window from block `blk`. The second block's masks are loaded
    /// only when it starts by the input end `end`; past it they are never
    /// read, since the NUL after the input stops every scan.
    #[inline(always)]
    fn at(src: Input<'_>, end: usize, blk: usize) -> Self {
        let (stop0, text0) = block_masks(src, blk);
        let mid = blk + 64;
        let (stop1, text1) = if mid <= end {
            block_masks(src, mid)
        } else {
            (u64::MAX, u64::MAX)
        };
        Window {
            mid,
            stop0,
            text0,
            stop1,
            text1,
        }
    }

    /// Move the window so that `p` lies in its first block.
    #[inline(always)]
    fn sync(&mut self, src: Input<'_>, end: usize, p: usize) {
        if p < self.mid {
            return;
        }
        if p < self.mid + 64 {
            let mid = self.mid + 64;
            let (stop1, text1) = if mid <= end {
                block_masks(src, mid)
            } else {
                (u64::MAX, u64::MAX)
            };
            *self = Window {
                mid,
                stop0: self.stop1,
                text0: self.text1,
                stop1,
                text1,
            };
        } else {
            core::hint::cold_path();
            *self = Window::at(src, end, p & !63);
        }
    }

    /// The end of the whitespace run from `p`, which lies in the first
    /// block (`$scanWhitespace`). The window moves so that the end lies in
    /// its first block too.
    #[inline(always)]
    fn space_end(&mut self, src: Input<'_>, end: usize, p: usize) -> usize {
        // `sync` keeps `p` in the first block, whose start is `mid - 64`:
        // its offset there is `(p - mid) & 63`.
        let m = self.text0 >> (p.wrapping_sub(self.mid) & 63);
        if m != 0 {
            return p + m.trailing_zeros() as usize;
        }
        let e = if self.text1 != 0 {
            self.mid + self.text1.trailing_zeros() as usize
        } else {
            core::hint::cold_path();
            space_end(src, self.mid + 64)
        };
        self.sync(src, end, e);
        e
    }

    /// The first byte after the quote at `lhs`, which lies in the first
    /// block, that can stop a string, as [`string_stop`] finds it, or
    /// `None` past the window.
    #[inline(always)]
    fn string_stop(&self, lhs: usize) -> Option<usize> {
        // As in `space_end`; the quote is bit 0.
        let m = (self.stop0 >> (lhs.wrapping_sub(self.mid) & 63)) >> 1;
        if m != 0 {
            return Some(lhs + 1 + m.trailing_zeros() as usize);
        }
        // Less common: the string goes on into the second block.
        core::hint::cold_path();
        if self.stop1 != 0 {
            return Some(self.mid + self.stop1.trailing_zeros() as usize);
        }
        None
    }
}

/// First-byte kinds of the main rules, one bit each.
const K_QUOTE: u8 = 1;
const K_OPEN: u8 = 2;
const K_CLOSE: u8 = 4;
const K_COMMA: u8 = 8;
const K_COLON: u8 = 16;
const K_NUMBER: u8 = 32;
const K_SLASH: u8 = 64;

/// The kind of every byte.
static KIND: [u8; 256] = {
    let mut t = [0u8; 256];
    t[b'"' as usize] = K_QUOTE;
    t[b'{' as usize] = K_OPEN;
    t[b'[' as usize] = K_OPEN;
    t[b'}' as usize] = K_CLOSE;
    t[b']' as usize] = K_CLOSE;
    t[b',' as usize] = K_COMMA;
    t[b':' as usize] = K_COLON;
    t[b'-' as usize] = K_NUMBER;
    let mut d = b'0';
    while d <= b'9' {
        t[d as usize] = K_NUMBER;
        d += 1;
    }
    t[b'/' as usize] = K_SLASH;
    t
};

/// An object key's color when `key`, else a string's.
#[inline(always)]
fn key_or_string(key: bool) -> u32 {
    if key {
        tok::PROPERTY_JSON_KEY
    } else {
        tok::STRING
    }
}

/// Lex the input at `base` as dialect `D` (`$hlJson`, `$hlJson5`,
/// `$hlJsonl`).
fn highlight<const D: u32>(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: `base..base + len + SLACK` lies inside lexer memory, and this
    // lexer calls no translated function that could move it.
    let src = unsafe { Input::new(inst, base, len) };
    let mut out = Recs::load(inst);
    // `$lexEmitLeadingContinuation`, then the leading whitespace: both are
    // gaps, so with no record yet they make one plain record. Depth and the
    // key flag start cleared, so the JSONL line reset has nothing to clear.
    let p = space_end(src, scan::utf8_span_end(src.bytes(), 0, len));
    out.gap(0, p);
    lex::<D>(src, len, out, p).store(inst);
}

/// The lexer loop for every dialect, from the start of the input
/// (`$hlJsonImpl` with no string left open by a streamed chunk).
fn lex<const D: u32>(src: Input<'_>, end: usize, mut out: Recs, mut p: usize) -> Recs {
    let json5 = D == JSON5;
    // Open containers, and for each of the first `STACK`, whether it is an
    // object.
    let mut depth = 0usize;
    let mut stack = [0u8; STACK];
    // The color of the next string: an object key or a string. A JSON5
    // name is a key when this says so.
    let mut string_hl = tok::STRING;
    // What a comma sets `string_hl` to: a key when the current container
    // is a remembered object.
    let mut object_hl = tok::STRING;
    // The leading whitespace was taken before the loop, and each pass
    // starts at a token and takes the whitespace after it.
    let mut win = Window::at(src, end, p & !63);
    while p < end {
        let mut lhs = p;
        // SAFETY: `p` is below the input end.
        let c = unsafe { src.byte_unchecked(p) };
        // The rules match disjoint first bytes: one bit test each.
        let k = KIND[c as usize];
        'token: {
            // String (object key or value).
            if k & K_QUOTE != 0 {
                loop {
                    let hl = string_hl;
                    // Most strings end at their closing quote with no escape:
                    // the first stop byte is that quote.
                    if let Some(e) = win.string_stop(lhs)
                        // SAFETY: a string stop lies at or before the NUL after
                        // the input.
                        && unsafe { src.byte_unchecked(e) } == b'"'
                    {
                        p = e + 1;
                        out.tok(hl, p);
                    } else {
                        (p, out) = json_string(src, end, out, hl, c, json5, lhs, lhs + 1);
                    }
                    string_hl = tok::STRING;
                    // A key's colon or a value's comma often follows at once:
                    // the rules below, taken here without the dispatch. The
                    // string's last record is a string, key, or escape.
                    // SAFETY: a string ends at or before the input end.
                    let c = unsafe { src.byte_unchecked(p) };
                    if c == b':' {
                        p += 1;
                        out.push(tok::PUNCTUATION_DELIMITER, p);
                        // `: "value"` in the window's first block: the space
                        // joins the colon's record, and the value string
                        // follows.
                        // SAFETY: the colon lay below the input end, so `p + 1`
                        // is at most the NUL after it.
                        if unsafe { src.byte_unchecked(p) } == b' '
                            && unsafe { src.byte_unchecked(p + 1) } == b'"'
                            && p + 1 < win.mid
                        {
                            p += 1;
                            out.extend(p);
                            lhs = p;
                            continue;
                        }
                    } else if c == b',' {
                        string_hl = object_hl;
                        p += 1;
                        out.push(tok::PUNCTUATION_DELIMITER, p);
                    }
                    break;
                }
                break 'token;
            }

            // Containers and separators, tested before numbers: the rules
            // match disjoint first bytes, and these are the more common.
            if k & K_OPEN != 0 {
                if depth < STACK {
                    stack[depth] = (c == b'{') as u8;
                }
                object_hl = key_or_string(depth < STACK && c == b'{');
                depth += 1;
                string_hl = key_or_string(c == b'{');
                p += 1;
                out.tok(tok::PUNCTUATION_BRACKET, p);
                break 'token;
            }
            if k & K_CLOSE != 0 {
                depth = depth.saturating_sub(1);
                object_hl = key_or_string(depth > 0 && depth <= STACK && stack[depth - 1] != 0);
                string_hl = tok::STRING;
                p += 1;
                out.tok(tok::PUNCTUATION_BRACKET, p);
                // A comma often follows at once: its rule below, taken here
                // without the dispatch.
                // SAFETY: a bracket ends at or before the input end.
                if unsafe { src.byte_unchecked(p) } == b',' {
                    string_hl = object_hl;
                    p += 1;
                    out.push(tok::PUNCTUATION_DELIMITER, p);
                }
                break 'token;
            }
            if k & K_COMMA != 0 {
                // The next string is a key again when the current container is
                // an object.
                string_hl = object_hl;
                p += 1;
                out.tok(tok::PUNCTUATION_DELIMITER, p);
                break 'token;
            }
            if k & K_COLON != 0 {
                string_hl = tok::STRING;
                p += 1;
                out.tok(tok::PUNCTUATION_DELIMITER, p);
                break 'token;
            }

            // Number.
            if k & K_NUMBER != 0 {
                if json5 {
                    let hl;
                    (hl, p) = json5_number(src, end, p);
                    out.tok(hl, p);
                } else {
                    p = json_number(src, p + 1);
                    out.tok(tok::NUMBER, p);
                }
                // SAFETY: a number ends at or before the input end.
                if unsafe { src.byte_unchecked(p) } == b',' {
                    string_hl = object_hl;
                    p += 1;
                    out.push(tok::PUNCTUATION_DELIMITER, p);
                }
                break 'token;
            }

            // JSONC comments. The NUL after the input reads as the WAT's 0
            // past the end.
            if k & K_SLASH != 0 {
                // SAFETY: `p` is below the input end, so `p + 1` is at most
                // the NUL after it.
                let c2 = unsafe { src.byte_unchecked(p + 1) };
                if c2 == b'/' {
                    p = scan::line_end(src.bytes(), p + 2, end);
                    out.tok(tok::COMMENT, p);
                    break 'token;
                }
                if c2 == b'*' {
                    // `$lexBlockComment`.
                    p = scan::block_comment_end(src.bytes(), p + 2, end);
                    out.tok(tok::COMMENT, p);
                    break 'token;
                }
                p += 1;
                out.tok(tok::NONE, p);
                break 'token;
            }

            // Words: `true`/`false` are booleans, `null` a builtin constant,
            // anything else plain. JSON5 names follow JavaScript identifiers,
            // `\uXXXX` escapes included, and can be object keys.
            if is_letter(c)
                // SAFETY: `p` is below the input end, so `p + 1` is at most the
                // NUL after it.
                || (json5
                    && (is_ident_start(c)
                        || (c == b'\\' && unsafe { src.byte_unchecked(p + 1) } == b'u')))
            {
                if json5 {
                    loop {
                        p = ident_run(src, p);
                        // SAFETY: a run ends at or before the input end, and
                        // a backslash lies before it, so the byte after it is
                        // in the input or its NUL.
                        if unsafe { src.byte_unchecked(p) } == b'\\'
                            && unsafe { src.byte_unchecked(p + 1) } == b'u'
                        {
                            p = hex_run(src, end, p + 2, 4);
                            continue;
                        }
                        break;
                    }
                } else {
                    p += 1;
                    // SAFETY: the word starts below the input end and stops at
                    // the NUL after it at the latest.
                    while is_letter(unsafe { src.byte_unchecked(p) }) {
                        p += 1;
                    }
                }
                let hl = if json5 && string_hl == tok::PROPERTY_JSON_KEY {
                    tok::PROPERTY_JSON_KEY
                } else {
                    word_hl(src, lhs, p, json5)
                };
                out.tok(hl, p);
                // SAFETY: a word ends at or before the input end.
                if unsafe { src.byte_unchecked(p) } == b',' {
                    string_hl = object_hl;
                    p += 1;
                    out.push(tok::PUNCTUATION_DELIMITER, p);
                }
                break 'token;
            }

            // JSON5: single-quoted strings, and numbers that start with `+` or
            // `.`.
            if json5 {
                if c == b'\'' {
                    let hl = string_hl;
                    (p, out) = json_string(src, end, out, hl, c, true, lhs, p + 1);
                    string_hl = tok::STRING;
                    break 'token;
                }
                // SAFETY: `p + 1` is below the input end (tested).
                if c == b'+'
                    || (c == b'.' && p + 1 < end && is_digit(unsafe { src.byte_unchecked(p + 1) }))
                {
                    let hl;
                    (hl, p) = json5_number(src, end, p);
                    out.tok(hl, p);
                    break 'token;
                }
            }

            // Anything else: one plain byte.
            p += 1;
            out.tok(tok::NONE, p);
        }

        // The whitespace after the token extends its record (a no-op when
        // there is none).
        win.sync(src, end, p);
        let gap = p;
        p = win.space_end(src, end, p);
        out.extend(p);
        if D == JSONL && p > gap && src.bytes()[gap..p].contains(&b'\n') {
            depth = 0;
            object_hl = tok::STRING;
            string_hl = tok::STRING;
        }
    }
    out
}
