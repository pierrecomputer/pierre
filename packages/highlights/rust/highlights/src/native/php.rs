//! WAT sources: src/langs/php.wat src/langs/html.wat src/langs/xml.wat src/common.wat src/scan.wat
//!
//! Native PHP lexer (`$hlPhp`). A PHP file is markup with `<?php ... ?>`
//! islands: the markup between them runs through a copy of the native
//! HTML lexer (`$hlHtml`), and each island through the PHP code lexer
//! (`$phpCode`): comments, heredocs and nowdocs, strings, variables,
//! numbers, keywords and names (with declaration, member, and named
//! argument context), operators, and punctuation. Input without an opener
//! is a bare code snippet unless it starts with markup. Script and style
//! bodies in markup run through the translated lexers, as the WAT hands
//! them over. The native lexer only runs on whole input, so the WAT's
//! streaming branches (`$streaming` set) never apply.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::KeywordTable;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::PHP_WORDS;

/// The lexer for each language this module handles.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "php" => Some(highlight),
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
        // SAFETY: `p < end <= len`, so `p + 16` stays inside the slack.
        let w = unsafe { src.vec_unchecked(p) };
        let k = w.eq(V::splat(a)).or(w.eq(V::splat(b))).first();
        if k < 16 {
            return (p + k).min(end);
        }
        p += 16;
    }
    end
}

/// Does `[lhs, rhs)` name a raw-text element? 1 script, 2 style, 0 other
/// (`$rawTextKind`).
#[inline(always)]
fn raw_text_kind(src: Input, lhs: usize, rhs: usize) -> u32 {
    let len = rhs.wrapping_sub(lhs);
    // SAFETY: `lhs` is at most the input end, so the 8 bytes from it lie
    // inside the slack.
    let w = unsafe { src.word_unchecked(lhs) };
    if len == 6 && (w & 0xFFFF_FFFF_FFFF) | 0x2020_2020_2020 == word(b"script") {
        return 1;
    }
    if len == 5 && (w & 0xFF_FFFF_FFFF) | 0x20_2020_2020 == word(b"style") {
        return 2;
    }
    0
}

/// Is `p` (a `<`) the start of `</script` (kind 1) or `</style` (other
/// kinds), followed by a byte that ends the name, within a range ending at
/// `end` (`$isRawTextClose`)?
fn is_raw_text_close(src: Input, end: usize, p: usize, kind: u32) -> bool {
    let tp = if kind == 1 {
        if p + 8 > end {
            return false;
        }
        if (src.word(p + 1) & 0x00FF_FFFF_FFFF_FFFF) | 0x0020_2020_2020_2000 != word(b"/script") {
            return false;
        }
        p + 8
    } else {
        if p + 7 > end {
            return false;
        }
        if (src.word(p + 1) & 0xFFFF_FFFF_FFFF) | 0x2020_2020_2000 != word(b"/style") {
            return false;
        }
        p + 7
    };
    if tp >= end {
        return true;
    }
    let t = src.byte(tp);
    t == b'>' || t == b'/' || is_space(t)
}

/// End of the character reference at the `&` at `ptr`, past its `;`, or
/// `None` when none starts there (`$htmlEntity`).
fn entity_end(src: Input, ptr: usize, end: usize) -> Option<usize> {
    // the input up to `end`: reads below `end` need no bounds check of their own
    let s = &src.bytes()[..end];
    let mut q = ptr + 1;
    if q < end && s[q] == b'#' {
        q += 1;
    }
    while q < end && q - ptr <= 32 {
        let c = s[q];
        if c.wrapping_sub(b'0') > 9 && (c | 32).wrapping_sub(b'a') > 25 {
            break;
        }
        q += 1;
    }
    // SAFETY: `ptr` is below the input end, so `ptr + 1` is at most the end.
    let min = if unsafe { src.byte_unchecked(ptr + 1) } == b'#' {
        2
    } else {
        1
    };
    if q - ptr <= min || q >= end || s[q] != b';' {
        return None;
    }
    Some(q + 1)
}

/// End of the `<!--` comment at `lhs`: past `-->` (where `<!-->` and
/// `<!--->` already close), or `end` (`$htmlComment`, `$xmlSection` for a
/// comment).
fn comment_end(src: Input, lhs: usize, end: usize) -> usize {
    let mut p = (lhs + 4).min(end);
    loop {
        p = find2(src, p, end, b'>', b'>');
        if p >= end {
            return end;
        }
        // SAFETY: `p` is below the input end and at least `lhs + 4`.
        if unsafe { src.byte_unchecked(p - 2) } == b'-'
            && unsafe { src.byte_unchecked(p - 1) } == b'-'
        {
            return p + 1;
        }
        p += 1;
    }
}

/// End of the `<!...>` declaration (`pi` false) or `<?...?>` processing
/// instruction at `lhs`: past its close, or `end` (`$htmlDecl`).
fn decl_end(src: Input, lhs: usize, end: usize, pi: bool) -> usize {
    let mut p = lhs + 2;
    loop {
        p = find2(src, p, end, b'>', b'>');
        if p >= end || !pi || src.byte(p - 1) == b'?' {
            break;
        }
        p += 1;
    }
    if p < end { p + 1 } else { end }
}

/// End of the tag or attribute name from `q` (`$htmlNameEnd`).
#[inline(always)]
fn name_end(src: Input, mut q: usize, end: usize) -> usize {
    let s = &src.bytes()[..end];
    while q < end && !NAME_STOP[s[q] as usize] {
        q += 1;
    }
    q
}

/// End of the unquoted attribute value from `q` (`$htmlValueEnd`).
#[inline(always)]
fn value_end(src: Input, mut q: usize, end: usize) -> usize {
    let s = &src.bytes()[..end];
    while q < end && !VALUE_STOP[s[q] as usize] {
        q += 1;
    }
    q
}

/// A style tag's attribute name `[lhs, rhs)`: `lang` sets the waiting
/// mark (64), any other name clears it; scripts keep their kind
/// (`$htmlLangName`).
#[inline(always)]
fn lang_name(src: Input, kind: u32, lhs: usize, rhs: usize) -> u32 {
    let kind = kind & 63;
    if kind != 1 && rhs - lhs == 4 && (src.word(lhs) as u32) | 0x2020_2020 == word(b"lang") as u32 {
        return kind | 64;
    }
    kind
}

/// An attribute value `[lhs, rhs)`: after a waiting `lang`, `less`,
/// `scss`, or `sass` (any case) selects that dialect's style kind; the
/// mark clears either way (`$htmlLangValue`).
#[cold]
#[inline(never)]
fn lang_value(src: Input, kind: u32, lhs: usize, rhs: usize) -> u32 {
    let kind = kind & 63;
    if rhs.wrapping_sub(lhs) != 4 {
        return kind;
    }
    let w = (src.word(lhs) as u32) | 0x2020_2020;
    if w == word(b"less") as u32 {
        return 14;
    }
    if w == word(b"scss") as u32 {
        return 15;
    }
    if w == word(b"sass") as u32 {
        return 16;
    }
    kind
}

/// Scan attributes from `*ptr` through `>` or `/>`: 1 for `>`, 2 for
/// `/>`, 0 at `end` or a stray `<`, with the raw-text kind (refined by a
/// style tag's `lang`) in the upper bits (`$htmlAttrs`, `$htmlQuotedBody`).
/// `quote` is the quote of a value left open, 0 for none.
#[inline(always)]
fn attrs(
    src: Input,
    end: usize,
    ptr: &mut usize,
    recs: &mut Recs,
    mut after_eq: bool,
    quote: u8,
    mut kind: u32,
) -> u32 {
    let mut p = *ptr;
    // the input up to `end`: reads below `end` need no bounds check of their own
    let s = &src.bytes()[..end];
    if quote != 0 {
        // $htmlQuotedBody from the range start
        let lhs = p;
        let q = find2(src, p, end, quote, quote);
        p = if q < end { q + 1 } else { end };
        recs.emit(tok::STRING, lhs, p);
    }
    let r = loop {
        if p >= end {
            break 0;
        }
        let lhs = p;
        let c = s[lhs];
        if is_space(c) {
            p += 1;
            while p < end && is_space(s[p]) {
                p += 1;
            }
            recs.gap(lhs, p);
            continue;
        }
        if c == b'>' {
            p += 1;
            recs.tok(tok::PUNCTUATION_BRACKET_HTML, p);
            break 1 | (kind & 63) << 8;
        }
        if after_eq {
            after_eq = false;
            if c == b'"' || c == b'\'' {
                // $htmlQuotedBody
                let q = find2(src, p + 1, end, c, c);
                let closed = q < end;
                p = if closed { q + 1 } else { end };
                recs.tok(tok::STRING, p);
                if kind & 64 != 0 {
                    let rhs = if closed { p - 1 } else { lhs + 1 };
                    kind = lang_value(src, kind, lhs + 1, rhs);
                }
                continue;
            }
            if c == b'<' {
                break 0;
            }
            p = value_end(src, p, end);
            recs.emit(tok::STRING, lhs, p);
            if kind & 64 != 0 {
                kind = lang_value(src, kind, lhs, p);
            }
            continue;
        }
        if c == b'/' {
            p += 1;
            if p < end && s[p] == b'>' {
                p += 1;
                recs.tok(tok::PUNCTUATION_BRACKET_HTML, p);
                break 2 | (kind & 63) << 8;
            }
            recs.tok(tok::NONE, p);
            continue;
        }
        if c == b'=' {
            p += 1;
            recs.tok(tok::PUNCTUATION_DELIMITER_HTML, p);
            after_eq = true;
            continue;
        }
        if c == b'"' || c == b'\'' {
            // $htmlQuotedBody
            let q = find2(src, p + 1, end, c, c);
            p = if q < end { q + 1 } else { end };
            recs.tok(tok::STRING, p);
            continue;
        }
        if c == b'<' {
            break 0;
        }
        p = name_end(src, p, end);
        recs.emit(tok::ATTRIBUTE, lhs, p);
        if kind != 0 {
            kind = lang_name(src, kind, lhs, p);
        }
        // the common `="value"` follower, as the branches above take it
        if p < end && s[p] == b'=' {
            p += 1;
            recs.tok(tok::PUNCTUATION_DELIMITER_HTML, p);
            let lhs = p;
            // SAFETY: `p` is at most the input end.
            let c = unsafe { src.byte_unchecked(p) };
            if p < end && (c == b'"' || c == b'\'') {
                let q = find2(src, p + 1, end, c, c);
                let closed = q < end;
                p = if closed { q + 1 } else { end };
                recs.tok(tok::STRING, p);
                if kind & 64 != 0 {
                    let rhs = if closed { p - 1 } else { lhs + 1 };
                    kind = lang_value(src, kind, lhs + 1, rhs);
                }
            } else {
                after_eq = true;
            }
        }
    };
    *ptr = p;
    r
}

/// The raw-text body from `from` to its close tag (or `end`), lexed by the
/// embedded lexer for `kind`. Returns the position of the close tag's `<`
/// (`$htmlRawText`, `$htmlStyleBody`). `src` is the input as made after the
/// last call into translated code.
#[inline(never)]
fn raw_text(
    inst: &mut Instance,
    base: usize,
    src: Input,
    from: usize,
    end: usize,
    kind: u32,
) -> usize {
    let mut p = from;
    loop {
        p = find2(src, p, end, b'<', b'<');
        if p >= end || is_raw_text_close(src, end, p, kind) {
            break;
        }
        p += 1;
    }
    let to = p;
    let save = inst.g_end;
    inst.g_end = (base + to) as i32;
    inst.g_ptr = (base + from) as i32;
    match kind {
        1 => {
            inst.f_hlJs();
            inst.f_ecmaReset();
        }
        14 => inst.f_hlLess(),
        15 => inst.f_hlScss(),
        16 => inst.f_hlSass(),
        _ => inst.f_hlCss(),
    }
    inst.g_end = save;
    inst.g_ptr = (base + to) as i32;
    to
}

/// The next `<` or `&` from `p`, or `end` (`$lexFindEither`). Text runs
/// between tags are mostly short, so the first bytes are checked one at a
/// time before the 16-byte scan.
#[inline(always)]
fn text_end(src: Input, mut p: usize, end: usize) -> usize {
    let stop = (p + 16).min(end);
    while p < stop {
        // SAFETY: `p` is below `stop`, at most the input end.
        let c = unsafe { src.byte_unchecked(p) };
        if c == b'<' || c == b'&' {
            return p;
        }
        p += 1;
    }
    find2(src, p, end, b'<', b'&')
}

/// The HTML main loop over `[ptr, end)` (`$htmlLex`, `$htmlTag`,
/// `$htmlTagEnd`). `src` is the input as made after the last call into
/// translated code. Returns the records.
fn html_lex(
    inst: &mut Instance,
    base: usize,
    len: usize,
    mut src: Input,
    mut ptr: usize,
    end: usize,
    mut recs: Recs,
) -> Recs {
    // the input up to `end`: reads below `end` need no bounds check of their own
    let mut s = &src.bytes()[..end];
    while ptr < end {
        // text run: everything up to the next `<` or `&`
        let text_from = ptr;
        ptr = text_end(src, ptr, end);
        recs.emit(tok::NONE, text_from, ptr);
        if ptr >= end {
            break;
        }
        let lhs = ptr;
        if s[lhs] == b'&' {
            ptr = match entity_end(src, ptr, end) {
                Some(q) => {
                    recs.tok(tok::STRING_SPECIAL, q);
                    q
                }
                None => {
                    recs.tok(tok::NONE, lhs + 1);
                    lhs + 1
                }
            };
            continue;
        }
        // `<`: comment, declaration, close tag, open tag, or plain text
        let c = if lhs + 1 < end { s[lhs + 1] } else { 0 };
        let kind;
        if (c | 32).wrapping_sub(b'a') <= 25 || c == b'_' || c >= 128 {
            // `<name`: a start tag
            ptr = lhs + 1;
            recs.tok(tok::PUNCTUATION_BRACKET_HTML, ptr);
            let q = name_end(src, ptr, end);
            kind = raw_text_kind(src, ptr, q);
            recs.emit(tok::TAG, ptr, q);
            ptr = q;
        } else if c == b'/' {
            // `</name ... >`
            ptr = lhs + 2;
            recs.tok(tok::PUNCTUATION_BRACKET_HTML, ptr);
            let q = name_end(src, ptr, end);
            recs.emit(tok::TAG, ptr, q);
            ptr = q;
            kind = 0;
        } else {
            if c == b'!' {
                // SAFETY: `lhs` is below the input end, so the 8 bytes from it
                // lie inside the slack.
                ptr = if lhs + 4 <= end
                    && (unsafe { src.word_unchecked(lhs) } as u32) == word(b"<!--") as u32
                {
                    let q = comment_end(src, lhs, end);
                    recs.emit(tok::COMMENT, lhs, q);
                    q
                } else {
                    let q = decl_end(src, lhs, end, false);
                    recs.emit(tok::TAG_DOCTYPE, lhs, q);
                    q
                };
            } else if c == b'?' {
                ptr = decl_end(src, lhs, end, true);
                recs.emit(tok::COMMENT, lhs, ptr);
            } else {
                // a lone `<`: plain text
                ptr = lhs + 1;
                recs.tok(tok::NONE, ptr);
            }
            continue;
        }
        let r = attrs(src, end, &mut ptr, &mut recs, false, 0, kind);
        if r & 3 != 0 && r > 255 {
            core::hint::cold_path();
            recs.store(inst);
            ptr = raw_text(inst, base, src, ptr, end, r >> 8);
            recs = Recs::load(inst);
            // SAFETY: `base..base + len + SLACK` is this input in lexer memory;
            // it is made again after every call into translated code.
            src = unsafe { Input::new(inst, base, len) };
            s = &src.bytes()[..end];
        }
    }
    recs
}

/// `$hlHtml` over `[ptr, end)`: leading UTF-8 continuation bytes as a gap
/// (`$lexEmitLeadingContinuation`), then the HTML main loop, which stops
/// at `end`. `src` is the input as made after the last call into
/// translated code. Returns the records.
fn hl_html(
    inst: &mut Instance,
    base: usize,
    len: usize,
    src: Input,
    ptr: usize,
    end: usize,
    mut recs: Recs,
) -> Recs {
    let p = scan::utf8_span_end(src.bytes(), ptr, end);
    recs.gap(ptr, p);
    html_lex(inst, base, len, src, p, end, recs)
}

/// PHP's keyword table (`$phpWords`), for names of five bytes or more.
static PHP_TABLE: KeywordTable<1024> = KeywordTable::new(PHP_WORDS);

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
    let s = &src.bytes()[..end];
    while p < end && IDENT[s[p] as usize] {
        p += 1;
    }
    p
}

/// End of the whitespace run from `p` (`$scanWhitespace`,
/// `$phpSkipWhitespaceAt`).
#[inline(always)]
fn space_end(src: Input, mut p: usize, end: usize) -> usize {
    let s = &src.bytes()[..end];
    while p < end && is_space(s[p]) {
        p += 1;
    }
    p
}

/// End of the spaces and tabs from `p` (`$lexSkipSpaceAt`,
/// `$phpBlanksAt`).
#[inline(always)]
fn blanks_end(src: Input, mut p: usize, end: usize) -> usize {
    let s = &src.bytes()[..end];
    while p < end && (s[p] == b' ' || s[p] == b'\t') {
        p += 1;
    }
    p
}

/// Is `<?php` (then a space or the end) or `<?=` at `p` (`$phpIsOpen`)?
#[inline(always)]
fn is_open(src: Input, p: usize, end: usize) -> bool {
    if p + 3 > end || src.byte(p + 1) != b'?' {
        return false;
    }
    if src.byte(p + 2) == b'=' {
        return true;
    }
    if p + 5 > end || ((src.word(p + 2) as u32) | 0x20_2020) & 0xFF_FFFF != word(b"php") as u32 {
        return false;
    }
    p + 5 == end || is_space(src.byte(p + 5))
}

/// The next PHP opener from `p`, or `end` (`$phpFindOpen`).
fn find_open(src: Input, mut p: usize, end: usize) -> usize {
    loop {
        p = find2(src, p, end, b'<', b'<');
        if p >= end {
            return end;
        }
        if is_open(src, p, end) {
            return p;
        }
        p += 1;
    }
}

/// Does the text at `p` start markup: a tag, a comment or doctype, or a
/// close tag (`$phpLooksLikeMarkup`)?
fn looks_like_markup(src: Input, p: usize, end: usize) -> bool {
    if p + 1 >= end || src.byte(p) != b'<' {
        return false;
    }
    let c = src.byte(p + 1);
    is_ident_start(c) || c == b'!' || c == b'/'
}

/// End of the line comment at `lhs` whose marker is `skip` bytes long: the
/// line end, or an earlier `?>` (`$phpLineComment`).
fn line_comment_end(src: Input, end: usize, lhs: usize, skip: usize) -> usize {
    let mut p = (lhs + skip).min(end);
    let line_end = find2(src, p, end, b'\n', b'\r');
    loop {
        let close = find2(src, p, line_end, b'?', b'?');
        if close >= line_end {
            return line_end;
        }
        if close + 1 < line_end && src.byte(close + 1) == b'>' {
            return close;
        }
        p = close + 1;
    }
}

/// SCREAMING_CASE: at least two bytes, at least one uppercase letter, and
/// only `[A-Z0-9_]` (`$lexIsConstCase`).
fn is_const_case(src: Input, lhs: usize, rhs: usize) -> bool {
    if rhs.wrapping_sub(lhs) < 2 {
        return false;
    }
    let mut upper = false;
    for c in &src.bytes()[lhs..rhs] {
        let c = *c;
        if c.wrapping_sub(b'A') <= 25 {
            upper = true;
        } else if !(is_digit(c) || c == b'_') {
            return false;
        }
    }
    upper
}

/// The token for a bare uppercase-first name that is not a call: a class
/// before `::`, a SCREAMING_CASE constant, or a plain name
/// (`$phpUpperName`).
fn upper_name(src: Input, end: usize, lhs: usize, rhs: usize) -> u32 {
    let s = &src.bytes()[..end];
    if rhs + 1 < end && s[rhs] == b':' && s[rhs + 1] == b':' {
        return tok::TYPE;
    }
    // SAFETY: the name `[lhs, rhs)` lies inside the input, so `lhs + 1` is
    // at most its end.
    if unsafe { src.byte_unchecked(lhs + 1) }.wrapping_sub(b'a') <= 25 {
        return tok::VARIABLE;
    }
    if is_const_case(src, lhs, rhs) {
        return tok::CONSTANT;
    }
    tok::VARIABLE
}

/// For each first byte, a bit per length of the PHP keywords that start
/// with it.
static PHP_LENGTHS: [u32; 256] = {
    let mut t = [0u32; 256];
    let mut i = 0;
    while i < PHP_WORDS.len() {
        let w = PHP_WORDS[i].word;
        t[w[0] as usize] |= 1 << w.len();
        i += 1;
    }
    t
};

/// The 16 bytes at `p` with `A`-`Z` lowered, then 16 zero bytes.
#[inline(always)]
fn lower16(src: Input, p: usize) -> [u8; 32] {
    // SAFETY: `p` is below the input end, so the 16 bytes from it lie
    // inside the slack.
    let v = unsafe { src.vec_unchecked(p) };
    let upper = v.sub(V::splat(b'A')).le(V::splat(25));
    let mut out = [0u8; 32];
    out[..16].copy_from_slice(&v.or(upper.and(V::splat(32))).to_array());
    out
}

/// The token for the name `[lhs, rhs)`: a keyword (any case) or a
/// variable (`$phpWordHl`).
fn word_hl(src: Input, lhs: usize, rhs: usize) -> u32 {
    let n = rhs - lhs;
    if n.wrapping_sub(2) > 10 {
        return tok::VARIABLE;
    }
    // SAFETY: `lhs` is below the input end, so the 8 bytes from it lie
    // inside the slack.
    let folded = unsafe { src.word_unchecked(lhs) } | 0x2020_2020_2020_2020;
    match n {
        2 => {
            let w = folded & 0xFFFF;
            if w == word(b"if") || w == word(b"do") {
                return tok::KEYWORD_CONTROL;
            }
            if w == word(b"as") || w == word(b"fn") {
                return tok::KEYWORD;
            }
            tok::VARIABLE
        }
        3 => {
            let w = folded & 0xFF_FFFF;
            if w == word(b"new") || w == word(b"use") || w == word(b"var") {
                return tok::KEYWORD;
            }
            if w == word(b"for") || w == word(b"try") {
                return tok::KEYWORD_CONTROL;
            }
            if w == word(b"int") {
                return tok::TYPE_BUILTIN;
            }
            tok::VARIABLE
        }
        4 => {
            let w = folded & 0xFFFF_FFFF;
            if w == word(b"true") {
                return tok::BOOLEAN;
            }
            if w == word(b"null") {
                return tok::CONSTANT_BUILTIN;
            }
            if w == word(b"else") || w == word(b"case") || w == word(b"echo") || w == word(b"goto")
            {
                return tok::KEYWORD_CONTROL;
            }
            if w == word(b"enum") {
                return tok::KEYWORD_DECLARATION;
            }
            if w == word(b"bool") || w == word(b"void") {
                return tok::TYPE_BUILTIN;
            }
            tok::VARIABLE
        }
        _ => {
            // no keyword has this first letter and length
            // SAFETY: `lhs` is below the input end.
            let first = unsafe { src.byte_unchecked(lhs) };
            let first = if first.wrapping_sub(b'A') <= 25 {
                first | 32
            } else {
                first
            };
            if PHP_LENGTHS[first as usize] >> n & 1 == 0 {
                return tok::VARIABLE;
            }
            // the name with A-Z lowered, as `$mem.lexLowerScratch` holds it
            let lower = lower16(src, lhs);
            let hl = PHP_TABLE.value(&lower, 0, n);
            if hl >= 0 { hl as u32 } else { tok::VARIABLE }
        }
    }
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
        ptr = find2(src, ptr, end, quote, b'\\');
        if ptr >= end {
            break;
        }
        // SAFETY: `ptr` is below the input end (tested above).
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

/// A single-quoted string body from `ptr`, emitted from `seg`, where only
/// `\'` and `\\` are escapes. Returns its end (`$phpSingleBody`).
fn single_body(src: Input, end: usize, mut ptr: usize, mut seg: usize, recs: &mut Recs) -> usize {
    loop {
        ptr = find2(src, ptr, end, b'\'', b'\\');
        if ptr >= end {
            break;
        }
        // SAFETY: `ptr` is below the input end (tested above), so `ptr + 1`
        // is at most the end.
        let (b, c) = unsafe { (src.byte_unchecked(ptr), src.byte_unchecked(ptr + 1)) };
        if b == b'\'' {
            ptr += 1;
            break;
        }
        if ptr + 1 < end && (c == b'\'' || c == b'\\') {
            recs.emit(tok::STRING, seg, ptr);
            seg = ptr + 2;
            recs.tok(tok::STRING_ESCAPE, seg);
            ptr = seg;
        } else {
            ptr += 1;
        }
    }
    recs.emit(tok::STRING, seg, ptr);
    ptr
}

/// Just past the line break at `p`, or `p` at the end (`$phpAfterLine`).
#[inline(always)]
fn after_line(src: Input, p: usize, end: usize) -> usize {
    if p < end {
        if src.byte(p) == b'\r' && p + 1 < end && src.byte(p + 1) == b'\n' {
            return p + 2;
        }
        return p + 1;
    }
    p
}

/// Do the `n` bytes at `a` equal those at `b`, all before `end`
/// (`$phpBytesEq`)?
fn bytes_eq(src: Input, end: usize, a: usize, b: usize, n: usize) -> bool {
    a + n <= end && src.bytes()[a..a + n] == src.bytes()[b..b + n]
}

/// A heredoc or nowdoc body from `body` through the line whose first
/// non-blank run is the `n`-byte label at `delim` (not followed by an
/// identifier byte), or the end. Returns the position after the label or
/// the end (`$phpHeredocBody`).
fn heredoc_body(
    src: Input,
    end: usize,
    body: usize,
    delim: usize,
    n: usize,
    recs: &mut Recs,
) -> usize {
    let mut line = body;
    loop {
        if line >= end {
            recs.emit(tok::STRING, body, end);
            return end;
        }
        let start = blanks_end(src, line, end);
        if bytes_eq(src, end, start, delim, n) {
            let c = start + n;
            if c >= end || !is_ident_continue(src.byte(c)) {
                recs.emit(tok::STRING, body, line);
                recs.gap(line, start);
                recs.emit(tok::STRING, start, start + n);
                return start + n;
            }
        }
        line = after_line(src, find2(src, line, end, b'\n', b'\r'), end);
    }
}

/// `<<<ID`, `<<<"ID"`, or `<<<'ID'` at `lhs`, through the closing label.
/// Returns its end, or `None` to leave `<<<` to the caller
/// (`$phpHeredoc`).
#[cold]
#[inline(never)]
fn heredoc(src: Input, end: usize, lhs: usize, mut recs: Recs) -> (Option<usize>, Recs) {
    let r = heredoc_at(src, end, lhs, &mut recs);
    (r, recs)
}

/// [`heredoc`] with the records by reference.
#[inline(always)]
fn heredoc_at(src: Input, end: usize, lhs: usize, recs: &mut Recs) -> Option<usize> {
    let mut p = blanks_end(src, lhs + 3, end);
    if p >= end {
        return None;
    }
    let mut quote = src.byte(p);
    if quote == b'"' || quote == b'\'' {
        p += 1;
    } else {
        quote = 0;
    }
    if p >= end {
        return None;
    }
    let c = src.byte(p);
    if !is_ident_start(c) || c == b'$' {
        return None;
    }
    let delim = p;
    while p < end {
        let c = src.byte(p);
        if !is_ident_continue(c) || c == b'$' {
            break;
        }
        p += 1;
    }
    let n = p - delim;
    if quote != 0 {
        if p >= end || src.byte(p) != quote {
            return None;
        }
        p += 1;
    }
    let start = blanks_end(src, p, end);
    if start < end && src.byte(start) != b'\n' && src.byte(start) != b'\r' {
        return None;
    }
    recs.tok(tok::OPERATOR, lhs + 3);
    recs.emit(tok::STRING, lhs + 3, p);
    recs.gap(p, start);
    let body = after_line(src, start, end);
    recs.gap(start, body);
    Some(heredoc_body(src, end, body, delim, n, recs))
}

/// Byte classes for the dispatch of [`php_code`].
mod class {
    /// A one-byte operator, unless a rule below claims the byte.
    pub(super) const OTHER: u8 = 0;
    /// Letters, `_`, and bytes from 128: a name.
    pub(super) const IDENT: u8 = 1;
    pub(super) const DOLLAR: u8 = 2;
    pub(super) const DIGIT: u8 = 3;
    /// `"`, `'`, and backtick.
    pub(super) const QUOTE: u8 = 4;
    pub(super) const SLASH: u8 = 5;
    pub(super) const HASH: u8 = 6;
    pub(super) const LT: u8 = 7;
    pub(super) const QUESTION: u8 = 8;
    pub(super) const DOT: u8 = 9;
    pub(super) const MINUS: u8 = 10;
    pub(super) const COLON: u8 = 11;
    /// `()[]{}`.
    pub(super) const BRACKET: u8 = 12;
    /// `,` and `;`.
    pub(super) const DELIMITER: u8 = 13;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    let mut i = 0;
    while i < 256 {
        let c = i as u8;
        t[i] = match c {
            b'$' => class::DOLLAR,
            b'0'..=b'9' => class::DIGIT,
            b'"' | b'\'' | b'`' => class::QUOTE,
            b'/' => class::SLASH,
            b'#' => class::HASH,
            b'<' => class::LT,
            b'?' => class::QUESTION,
            b'.' => class::DOT,
            b'-' => class::MINUS,
            b':' => class::COLON,
            b'(' | b')' | b'[' | b']' | b'{' | b'}' => class::BRACKET,
            b',' | b';' => class::DELIMITER,
            _ if is_ident_start(c) => class::IDENT,
            _ => class::OTHER,
        };
        i += 1;
    }
    t
};

/// PHP code from `ptr`, stopping before a `?>` or at `end`. `sig` is the
/// named-argument position flag (`$sigPattern`). Returns the stop and the
/// records (`$phpCode`). The WAT tests the rules one after another; each
/// byte class here takes the rules that can apply to its bytes, in the
/// same order, and a byte no rule takes is a one-byte operator.
#[inline(always)]
fn php_code(
    src: Input,
    end: usize,
    mut ptr: usize,
    mut recs: Recs,
    sig: &mut u32,
) -> (usize, Recs) {
    // 1 a function name follows, 2 a class-like name, 3 the class of `new`
    let mut decl = 0u32;
    // 1 after `->`, 2 after `::`
    let mut member = 0u32;
    // the input up to `end`: reads below `end` need no bounds check of their own
    let s = &src.bytes()[..end];
    loop {
        let lhs = ptr;
        ptr = space_end(src, ptr, end);
        recs.gap(lhs, ptr);
        if ptr >= end {
            break;
        }
        let lhs = ptr;
        let c = s[ptr];
        let next = if ptr + 1 < end { s[ptr + 1] } else { 0 };
        match CLASS[c as usize] {
            class::IDENT => {
                ptr = ident_end(src, ptr, end);
                let mut hl = word_hl(src, lhs, ptr);
                if decl != 0 {
                    // `new` (decl 3) names a class unless a keyword follows
                    if decl < 3 || hl == tok::VARIABLE {
                        hl = if decl == 1 {
                            tok::FUNCTION_DEFINITION
                        } else {
                            tok::TYPE_CLASS
                        };
                    }
                    // in a qualified `new A\B` the segments before `\` are
                    // namespaces and the class name is still pending
                    if decl == 3 && ptr < end && s[ptr] == b'\\' {
                        hl = tok::NAMESPACE;
                    } else {
                        decl = 0;
                    }
                } else if member != 0 {
                    let p = blanks_end(src, ptr, end);
                    hl = if p < end && s[p] == b'(' {
                        tok::FUNCTION_METHOD
                    } else {
                        tok::PROPERTY
                    };
                    // a class constant after `::`
                    if member == 2
                        && hl == tok::PROPERTY
                        && c.wrapping_sub(b'A') <= 25
                        && is_const_case(src, lhs, ptr)
                    {
                        hl = tok::CONSTANT;
                    }
                    member = 0;
                } else if hl == tok::VARIABLE {
                    let p = blanks_end(src, ptr, end);
                    if p < end && s[p] == b'(' {
                        hl = tok::FUNCTION;
                    } else if c.wrapping_sub(b'A') <= 25 {
                        hl = upper_name(src, end, lhs, ptr);
                    }
                    // a PHP 8 named call argument: `name:` after `(` or `,`
                    let after = if p + 1 < end { s[p + 1] } else { 0 };
                    if *sig & (p < end && s[p] == b':' && after != b':') as u32 != 0 {
                        hl = tok::VARIABLE_PARAMETER;
                    }
                } else if hl == tok::KEYWORD_DECLARATION {
                    // a declaration keyword primes the name that follows
                    decl = if ptr - lhs == 8
                        // SAFETY: `lhs` is below the input end.
                        && unsafe { src.word_unchecked(lhs) } | 0x2020_2020_2020_2020
                            == word(b"function")
                    {
                        1
                    } else {
                        2
                    };
                } else if ptr - lhs == 3
                    // SAFETY: `lhs` is below the input end.
                    && ((unsafe { src.word_unchecked(lhs) } as u32) | 0x20_2020) & 0xFF_FFFF
                        == word(b"new") as u32
                {
                    decl = 3;
                }
                recs.tok(hl, ptr);
                *sig = 0;
                continue;
            }
            class::DOLLAR => {
                ptr = ident_end(src, ptr + 1, end);
                recs.tok(tok::VARIABLE, ptr);
                decl = 0;
                member = 0;
                *sig = 0;
                continue;
            }
            class::BRACKET => {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
                decl = 0;
                member = 0;
                // an open paren puts the next bare word in named-argument position
                *sig = (c == b'(') as u32;
                continue;
            }
            class::DELIMITER => {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                decl = 0;
                member = 0;
                *sig = (c == b',') as u32;
                continue;
            }
            class::COLON => {
                if next == b':' {
                    ptr += 2;
                    recs.tok(tok::OPERATOR, ptr);
                    decl = 0;
                    // after `::`, SCREAMING_CASE names class constants
                    member = 2;
                    *sig = 0;
                } else {
                    ptr += 1;
                    recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                    decl = 0;
                    member = 0;
                    *sig = 0;
                }
                continue;
            }
            class::MINUS => {
                if next == b'>' {
                    ptr += 2;
                    recs.tok(tok::OPERATOR, ptr);
                    decl = 0;
                    member = 1;
                    *sig = 0;
                    continue;
                }
            }
            class::QUOTE => {
                ptr = if c == b'\'' {
                    single_body(src, end, ptr + 1, lhs, &mut recs)
                } else {
                    string(src, end, lhs, c, &mut recs)
                };
                decl = 0;
                member = 0;
                continue;
            }
            class::DIGIT => {
                ptr = number_end(src, ptr, end);
                recs.emit(tok::NUMBER, lhs, ptr);
                decl = 0;
                member = 0;
                continue;
            }
            class::DOT => {
                if is_digit(next) {
                    ptr = number_end(src, ptr, end);
                    recs.emit(tok::NUMBER, lhs, ptr);
                    decl = 0;
                    member = 0;
                    continue;
                }
            }
            class::QUESTION => {
                if next == b'>' {
                    break;
                }
            }
            class::SLASH => {
                if next == b'/' {
                    ptr = line_comment_end(src, end, lhs, 2);
                    recs.emit(tok::COMMENT, lhs, ptr);
                    continue;
                }
                if next == b'*' {
                    ptr = scan::block_comment_end(src.bytes(), (lhs + 2).min(end), end);
                    recs.emit(tok::COMMENT, lhs, ptr);
                    continue;
                }
            }
            class::HASH => {
                if next != b'[' {
                    ptr = line_comment_end(src, end, lhs, 1);
                    recs.emit(tok::COMMENT, lhs, ptr);
                    continue;
                }
            }
            class::LT if next == b'<' && ptr + 2 < end && s[ptr + 2] == b'<' => {
                let r;
                (r, recs) = heredoc(src, end, lhs, recs);
                if let Some(p) = r {
                    ptr = p;
                    decl = 0;
                    member = 0;
                    continue;
                }
            }
            _ => {}
        }
        ptr += 1;
        recs.tok(
            if c == b'#' && next == b'[' {
                tok::ATTRIBUTE
            } else {
                tok::OPERATOR
            },
            ptr,
        );
        // `function &name` and the `\` of `new \A\B` keep the pending name
        if decl != 0 && c != b'&' && c != b'\\' {
            decl = 0;
        }
        member = 0;
    }
    (ptr, recs)
}

/// Highlight a PHP file of `len` bytes at lexer memory offset `base`
/// (`$hlPhp`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let end = len;
    // SAFETY: `base..base + len + SLACK` is this input in lexer memory;
    // it is made again after every call into translated code.
    let mut src = unsafe { Input::new(inst, base, len) };
    let mut recs = Recs::load(inst);
    // $lexEmitLeadingContinuation
    let mut ptr = scan::utf8_span_end(src.bytes(), 0, end);
    recs.gap(0, ptr);
    'out: {
        let mut snippet = false;
        let open = find_open(src, ptr, end);
        if open == end {
            let p = space_end(src, ptr, end);
            if p >= end {
                recs.gap(ptr, end);
                break 'out;
            }
            if looks_like_markup(src, p, end) {
                recs = hl_html(inst, base, len, src, ptr, end, recs);
                break 'out;
            }
            snippet = true;
        }
        // the html prefix
        if !snippet && ptr < open {
            recs = hl_html(inst, base, len, src, ptr, open, recs);
            // SAFETY: `base..base + len + SLACK` is this input in lexer memory;
            // it is made again after every call into translated code.
            src = unsafe { Input::new(inst, base, len) };
            ptr = open;
        }
        if ptr >= end {
            break 'out;
        }
        loop {
            // a snippet has no opener before its code
            if !snippet {
                let open = ptr;
                ptr += if src.byte(ptr + 2) == b'=' { 3 } else { 5 };
                recs.emit(tok::PREPROC, open, ptr);
            }
            snippet = false;
            let mut sig = inst.g_sigPattern as u32;
            (ptr, recs) = php_code(src, end, ptr, recs, &mut sig);
            inst.g_sigPattern = sig as i32;
            if ptr + 1 < end && src.byte(ptr) == b'?' && src.byte(ptr + 1) == b'>' {
                ptr += 2;
                recs.tok(tok::PREPROC, ptr);
            } else {
                break;
            }
            let open = find_open(src, ptr, end);
            if ptr < open {
                recs = hl_html(inst, base, len, src, ptr, open, recs);
                // SAFETY: `base..base + len + SLACK` is this input in lexer memory;
                // it is made again after every call into translated code.
                src = unsafe { Input::new(inst, base, len) };
                ptr = open;
            }
            if ptr >= end {
                break;
            }
        }
    }
    recs.store(inst);
}
