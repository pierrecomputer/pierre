//! WAT sources: src/langs/vue.wat src/langs/html.wat src/langs/xml.wat src/common.wat src/scan.wat
//!
//! Native Vue lexer (`$hlVue`). It cuts the file at tags, comments, and
//! `{{ }}` interpolations. Vue tags are lexed here: directive attribute
//! values (`v-`, `:`, `@`, `#`) are TSX expressions, other values strings.
//! The markup between cuts runs through a copy of the native HTML lexer
//! (`$hlHtml`). Interpolations, directive values, and script and style
//! bodies run through the translated lexers (`$hlTsxExpression`, `$hlTsx`,
//! `$hlJs`, `$hlCss` and its dialects), as the WAT hands them over. The
//! native lexer only runs on whole input, so the WAT's streaming branches
//! (`$streaming` set) never apply.

use super::Lexer;
use super::recs::Recs;
use super::scan;
use crate::generated::Instance;
use crate::token_ids as tok;

/// The lexer for each language this module handles.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "vue" => Some(highlight),
        _ => None,
    }
}

/// The input and its 96-byte slack, read without borrowing `inst` so the
/// lexer can still call translated functions.
fn input<'a>(inst: &Instance, base: usize, len: usize) -> &'a [u8] {
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory. The slice is
    // derived again after every translated call, which may move memory.
    unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) }
}

/// The input bytes and their 96-byte slack. Indexing skips the bounds
/// check: every position this module reads is below the input length plus
/// 16, inside the slack.
#[derive(Clone, Copy)]
struct Src<'a>(&'a [u8]);

impl Src<'_> {
    /// The little-endian 64-bit word at `i`.
    #[inline(always)]
    fn u64_at(&self, i: usize) -> u64 {
        debug_assert!(i + 8 <= self.0.len());
        // SAFETY: `i` lies within the input, so 8 bytes from it lie inside
        // the input and its slack.
        u64::from_le(unsafe { self.0.as_ptr().add(i).cast::<u64>().read_unaligned() })
    }

    /// The little-endian 32-bit word at `i`.
    #[inline(always)]
    fn u32_at(&self, i: usize) -> u32 {
        debug_assert!(i + 4 <= self.0.len());
        // SAFETY: as for `u64_at`.
        u32::from_le(unsafe { self.0.as_ptr().add(i).cast::<u32>().read_unaligned() })
    }
}

impl core::ops::Index<usize> for Src<'_> {
    type Output = u8;

    #[inline(always)]
    fn index(&self, i: usize) -> &u8 {
        debug_assert!(i < self.0.len());
        // SAFETY: `i` lies within the input or its slack (see `Src`).
        unsafe { self.0.get_unchecked(i) }
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

/// Emit `[lhs, rhs)` as `hl` unless the range is empty (`$emitTok`).
#[inline(always)]
fn emit(recs: &mut Recs, hl: u32, lhs: usize, rhs: usize) {
    if lhs < rhs {
        recs.tok(hl, rhs);
    }
}

/// The first position in `[p, end)` holding `a` or `b`, or `end`
/// (`$lexFindEither`, `$lexFindByte`). Loads may pass `end` into the input
/// slack; matches there are clamped away.
#[inline(always)]
fn find2(src: Src, mut p: usize, end: usize, a: u8, b: u8) -> usize {
    #[cfg(target_arch = "aarch64")]
    {
        use core::arch::aarch64::*;
        while p < end {
            // SAFETY: `p < end`, at most the input length, so the 16 bytes
            // lie inside the input and its slack.
            let k = unsafe {
                let w = vld1q_u8(src.0.as_ptr().add(p));
                scan::first_lane(vorrq_u8(
                    vceqq_u8(w, vdupq_n_u8(a)),
                    vceqq_u8(w, vdupq_n_u8(b)),
                ))
            };
            if k < 16 {
                return (p + k).min(end);
            }
            p += 16;
        }
        end
    }
    #[cfg(not(target_arch = "aarch64"))]
    {
        while p < end && src[p] != a && src[p] != b {
            p += 1;
        }
        p.min(end)
    }
}

/// Does `[lhs, rhs)` name a raw-text element? 1 script, 2 style, 0 other
/// (`$rawTextKind`).
#[inline(always)]
fn raw_text_kind(src: Src, lhs: usize, rhs: usize) -> u32 {
    let len = rhs.wrapping_sub(lhs);
    if len == 6 && (src.u64_at(lhs) & 0xFFFF_FFFF_FFFF) | 0x2020_2020_2020 == word(b"script") {
        return 1;
    }
    if len == 5 && (src.u64_at(lhs) & 0xFF_FFFF_FFFF) | 0x20_2020_2020 == word(b"style") {
        return 2;
    }
    0
}

/// Is `p` (a `<`) the start of `</script` (kind 1) or `</style` (other
/// kinds), followed by a byte that ends the name, within a range ending at
/// `end` (`$isRawTextClose`)?
fn is_raw_text_close(src: Src, end: usize, p: usize, kind: u32) -> bool {
    let tp = if kind == 1 {
        if p + 8 > end {
            return false;
        }
        if (src.u64_at(p + 1) & 0x00FF_FFFF_FFFF_FFFF) | 0x0020_2020_2020_2000 != word(b"/script") {
            return false;
        }
        p + 8
    } else {
        if p + 7 > end {
            return false;
        }
        if (src.u64_at(p + 1) & 0xFFFF_FFFF_FFFF) | 0x2020_2020_2000 != word(b"/style") {
            return false;
        }
        p + 7
    };
    if tp >= end {
        return true;
    }
    let t = src[tp];
    t == b'>' || t == b'/' || is_space(t)
}

/// End of the character reference at the `&` at `ptr`, past its `;`, or
/// `None` when none starts there (`$htmlEntity`).
fn entity_end(src: Src, ptr: usize, end: usize) -> Option<usize> {
    let mut q = ptr + 1;
    if q < end && src[q] == b'#' {
        q += 1;
    }
    while q < end && q - ptr <= 32 {
        let c = src[q];
        if c.wrapping_sub(b'0') > 9 && (c | 32).wrapping_sub(b'a') > 25 {
            break;
        }
        q += 1;
    }
    let min = if src[ptr + 1] == b'#' { 2 } else { 1 };
    if q - ptr <= min || q >= end || src[q] != b';' {
        return None;
    }
    Some(q + 1)
}

/// End of the `<!--` comment at `lhs`: past `-->` (where `<!-->` and
/// `<!--->` already close), or `end` (`$htmlComment`, `$xmlSection` for a
/// comment).
fn comment_end(src: Src, lhs: usize, end: usize) -> usize {
    let mut p = (lhs + 4).min(end);
    loop {
        p = find2(src, p, end, b'>', b'>');
        if p >= end {
            return end;
        }
        if src[p - 2] == b'-' && src[p - 1] == b'-' {
            return p + 1;
        }
        p += 1;
    }
}

/// End of the `<!...>` declaration (`pi` false) or `<?...?>` processing
/// instruction at `lhs`: past its close, or `end` (`$htmlDecl`).
fn decl_end(src: Src, lhs: usize, end: usize, pi: bool) -> usize {
    let mut p = lhs + 2;
    loop {
        p = find2(src, p, end, b'>', b'>');
        if p >= end || !pi || src[p - 1] == b'?' {
            break;
        }
        p += 1;
    }
    if p < end { p + 1 } else { end }
}

/// End of the tag or attribute name from `q` (`$htmlNameEnd`).
#[inline(always)]
fn name_end(src: Src, mut q: usize, end: usize) -> usize {
    while q < end && !NAME_STOP[src[q] as usize] {
        q += 1;
    }
    q
}

/// End of the unquoted attribute value from `q` (`$htmlValueEnd`).
#[inline(always)]
fn value_end(src: Src, mut q: usize, end: usize) -> usize {
    while q < end && !VALUE_STOP[src[q] as usize] {
        q += 1;
    }
    q
}

/// A style tag's attribute name `[lhs, rhs)`: `lang` sets the waiting
/// mark (64), any other name clears it; scripts keep their kind
/// (`$htmlLangName`).
#[inline(always)]
fn lang_name(src: Src, kind: u32, lhs: usize, rhs: usize) -> u32 {
    let kind = kind & 63;
    if kind != 1 && rhs - lhs == 4 && src.u32_at(lhs) | 0x2020_2020 == word(b"lang") as u32 {
        return kind | 64;
    }
    kind
}

/// An attribute value `[lhs, rhs)`: after a waiting `lang`, `less`,
/// `scss`, or `sass` (any case) selects that dialect's style kind; the
/// mark clears either way (`$htmlLangValue`).
#[cold]
#[inline(never)]
fn lang_value(src: Src, kind: u32, lhs: usize, rhs: usize) -> u32 {
    let kind = kind & 63;
    if rhs.wrapping_sub(lhs) != 4 {
        return kind;
    }
    let w = src.u32_at(lhs) | 0x2020_2020;
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
    src: Src,
    end: usize,
    ptr: &mut usize,
    recs: &mut Recs,
    mut after_eq: bool,
    quote: u8,
    mut kind: u32,
) -> u32 {
    let mut p = *ptr;
    if quote != 0 {
        // $htmlQuotedBody from the range start
        let lhs = p;
        let q = find2(src, p, end, quote, quote);
        p = if q < end { q + 1 } else { end };
        emit(recs, tok::STRING, lhs, p);
    }
    let r = loop {
        if p >= end {
            break 0;
        }
        let lhs = p;
        let c = src[lhs];
        if is_space(c) {
            p += 1;
            while p < end && is_space(src[p]) {
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
            emit(recs, tok::STRING, lhs, p);
            if kind & 64 != 0 {
                kind = lang_value(src, kind, lhs, p);
            }
            continue;
        }
        if c == b'/' {
            p += 1;
            if p < end && src[p] == b'>' {
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
        emit(recs, tok::ATTRIBUTE, lhs, p);
        if kind != 0 {
            kind = lang_name(src, kind, lhs, p);
        }
        // the common `="value"` follower, as the branches above take it
        if p < end && src[p] == b'=' {
            p += 1;
            recs.tok(tok::PUNCTUATION_DELIMITER_HTML, p);
            let lhs = p;
            let c = src[p];
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
/// (`$htmlRawText`, `$htmlStyleBody`).
#[inline(never)]
fn raw_text(
    inst: &mut Instance,
    base: usize,
    len: usize,
    from: usize,
    end: usize,
    kind: u32,
) -> usize {
    let src = Src(input(inst, base, len));
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
fn text_end(src: Src, mut p: usize, end: usize) -> usize {
    let stop = (p + 16).min(end);
    while p < stop {
        let c = src[p];
        if c == b'<' || c == b'&' {
            return p;
        }
        p += 1;
    }
    find2(src, p, end, b'<', b'&')
}

/// The HTML main loop over `[ptr, end)` (`$htmlLex`, `$htmlTag`,
/// `$htmlTagEnd`). Returns the records.
fn html_lex(
    inst: &mut Instance,
    base: usize,
    len: usize,
    mut ptr: usize,
    end: usize,
    mut recs: Recs,
) -> Recs {
    let mut src = Src(input(inst, base, len));
    while ptr < end {
        // text run: everything up to the next `<` or `&`
        let text_from = ptr;
        ptr = text_end(src, ptr, end);
        emit(&mut recs, tok::NONE, text_from, ptr);
        if ptr >= end {
            break;
        }
        let lhs = ptr;
        if src[lhs] == b'&' {
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
        let c = if lhs + 1 < end { src[lhs + 1] } else { 0 };
        let kind;
        if (c | 32).wrapping_sub(b'a') <= 25 || c == b'_' || c >= 128 {
            // `<name`: a start tag
            ptr = lhs + 1;
            recs.tok(tok::PUNCTUATION_BRACKET_HTML, ptr);
            let q = name_end(src, ptr, end);
            kind = raw_text_kind(src, ptr, q);
            emit(&mut recs, tok::TAG, ptr, q);
            ptr = q;
        } else if c == b'/' {
            // `</name ... >`
            ptr = lhs + 2;
            recs.tok(tok::PUNCTUATION_BRACKET_HTML, ptr);
            let q = name_end(src, ptr, end);
            emit(&mut recs, tok::TAG, ptr, q);
            ptr = q;
            kind = 0;
        } else {
            if c == b'!' {
                ptr = if lhs + 4 <= end && src.u32_at(lhs) == word(b"<!--") as u32 {
                    let q = comment_end(src, lhs, end);
                    emit(&mut recs, tok::COMMENT, lhs, q);
                    q
                } else {
                    let q = decl_end(src, lhs, end, false);
                    emit(&mut recs, tok::TAG_DOCTYPE, lhs, q);
                    q
                };
            } else if c == b'?' {
                ptr = decl_end(src, lhs, end, true);
                emit(&mut recs, tok::COMMENT, lhs, ptr);
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
            ptr = raw_text(inst, base, len, ptr, end, r >> 8);
            recs = Recs::load(inst);
            src = Src(input(inst, base, len));
        }
    }
    recs
}

/// `$hlHtml` over `[ptr, end)`: leading UTF-8 continuation bytes as a gap
/// (`$lexEmitLeadingContinuation`), then the HTML main loop, which stops
/// at `end`. Returns the records.
#[inline(never)]
fn hl_html(
    inst: &mut Instance,
    base: usize,
    len: usize,
    ptr: usize,
    end: usize,
    mut recs: Recs,
) -> Recs {
    let src = Src(input(inst, base, len));
    let p = scan::utf8_span_end(src.0, ptr, end);
    recs.gap(ptr, p);
    html_lex(inst, base, len, p, end, recs)
}

/// [`hl_html`] over `[from, to)` (not empty), with plain text (no `<` or
/// `&`, not starting with a UTF-8 continuation byte) emitted directly as
/// the HTML lexer would emit it: one text token.
#[inline(always)]
fn html_range(
    inst: &mut Instance,
    base: usize,
    len: usize,
    from: usize,
    to: usize,
    mut recs: Recs,
) -> Recs {
    let src = Src(input(inst, base, len));
    if src[from] & 0xc0 != 0x80 && text_end(src, from, to) == to {
        recs.tok(tok::NONE, to);
        return recs;
    }
    hl_html(inst, base, len, from, to, recs)
}

/// An identifier's first byte: letters, `_`, `$`, or non-ASCII
/// (`$lexIsIdentStart`).
#[inline(always)]
fn is_ident_start(c: u8) -> bool {
    c >= 0x80 || (c | 32).wrapping_sub(b'a') <= 25 || c == b'_' || c == b'$'
}

/// `[from, to)` (not empty) as TSX through the translated lexer
/// (`$vueTsxRange`). Returns the records.
#[inline(never)]
fn tsx_range(inst: &mut Instance, base: usize, from: usize, to: usize, recs: Recs) -> Recs {
    recs.store(inst);
    let save = inst.g_end;
    inst.g_end = (base + to) as i32;
    inst.g_ptr = (base + from) as i32;
    inst.f_hlTsx();
    inst.g_end = save;
    inst.g_ptr = (base + to) as i32;
    Recs::load(inst)
}

/// `{{ ... }}` at `p`: the braces, and the expression between them
/// through the translated TSX lexer (`$hlTsxExpression`). Returns the
/// position after it and the records.
#[inline(never)]
fn interpolation(inst: &mut Instance, base: usize, p: usize, mut recs: Recs) -> (usize, Recs) {
    recs.tok(tok::PUNCTUATION_SPECIAL, p + 2);
    recs.store(inst);
    inst.g_ptr = (base + p + 2) as i32;
    let closed = inst.f_hlTsxExpression(2, 0, 6, 0);
    let mut ptr = inst.g_ptr as usize - base;
    let mut recs = Recs::load(inst);
    if closed != 0 {
        ptr += 2;
        recs.tok(tok::PUNCTUATION_SPECIAL, ptr);
    }
    (ptr, recs)
}

/// The attributes of a Vue tag from `*ptr` through `>` or `/>`: 1 for
/// `>`, 2 for `/>`, 0 at a stray `<` or the end, with the raw-text kind in
/// the upper bits (`$vueAttrs`). `state` 0 expects a name, 1 follows a
/// name, 2 follows `=`, 3 is inside a quoted value; `directive` marks the
/// pending value as an expression, which runs through the translated TSX
/// lexer.
#[inline(always)]
fn vue_attrs(
    inst: &mut Instance,
    base: usize,
    len: usize,
    ptr: &mut usize,
    mut recs: Recs,
    mut kind: u32,
) -> (u32, Recs) {
    let end = len;
    let mut src = Src(input(inst, base, len));
    let mut p = *ptr;
    let mut state = 0u32;
    let mut directive = false;
    let mut quote = 0u8;
    // the quoted value opened in this call
    let mut fresh = false;
    let r = loop {
        if p >= end {
            break 0;
        }
        if state == 3 {
            // the value body up to its closing quote
            let lhs = p;
            let q = find2(src, p, end, quote, quote);
            if directive {
                let to = q.min(end);
                if lhs < to {
                    recs = tsx_range(inst, base, lhs, to, recs);
                    src = Src(input(inst, base, len));
                }
                if q < end {
                    p = q + 1;
                    recs.tok(tok::STRING, p);
                    state = 0;
                } else {
                    p = end;
                }
            } else {
                if q < end {
                    p = q + 1;
                    state = 0;
                } else {
                    p = end;
                }
                emit(&mut recs, tok::STRING, lhs, p);
                if kind & 64 != 0 {
                    let rhs = if fresh && state == 0 { q } else { lhs };
                    kind = lang_value(src, kind, lhs, rhs);
                }
            }
            fresh = false;
            continue;
        }
        let lhs = p;
        let c = src[lhs];
        // whitespace: every state survives it
        if is_space(c) {
            p += 1;
            while p < end && is_space(src[p]) {
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
        if c == b'<' {
            break 0;
        }
        // after a name only `=` continues the attribute
        if state == 1 {
            state = 0;
            if c == b'=' {
                p += 1;
                recs.tok(tok::PUNCTUATION_DELIMITER_HTML, p);
                state = 2;
                continue;
            }
        }
        // the value after `=`: quoted, or a lenient unquoted run
        if state == 2 {
            state = 0;
            if c == b'"' || c == b'\'' {
                quote = c;
                p += 1;
                recs.tok(tok::STRING, p);
                state = 3;
                fresh = true;
                continue;
            }
            if c == b'/' && p + 1 < end && src[p + 1] == b'>' {
                p += 2;
                recs.tok(tok::PUNCTUATION_BRACKET_HTML, p);
                break 2 | (kind & 63) << 8;
            }
            p = value_end(src, p, end);
            if directive {
                recs = tsx_range(inst, base, lhs, p, recs);
                src = Src(input(inst, base, len));
            } else {
                recs.tok(tok::STRING, p);
            }
            if kind & 64 != 0 {
                kind = lang_value(src, kind, lhs, p);
            }
            continue;
        }
        // an attribute name; `/>` closes, other stray punctuation is plain
        if c == b'/' {
            p += 1;
            if p < end && src[p] == b'>' {
                p += 1;
                recs.tok(tok::PUNCTUATION_BRACKET_HTML, p);
                break 2 | (kind & 63) << 8;
            }
            recs.tok(tok::NONE, p);
            continue;
        }
        if c == b'=' || c == b'"' || c == b'\'' {
            p += 1;
            recs.tok(tok::NONE, p);
            continue;
        }
        directive =
            c == b':' || c == b'@' || c == b'#' || (c == b'v' && p + 1 < end && src[p + 1] == b'-');
        p = name_end(src, p, end);
        emit(&mut recs, tok::ATTRIBUTE, lhs, p);
        if kind != 0 {
            kind = lang_name(src, kind, lhs, p);
        }
        state = 1;
        // the common `="` follower, as states 1 and 2 take it
        if p + 1 < end && src[p] == b'=' {
            let q = src[p + 1];
            if q == b'"' || q == b'\'' {
                p += 1;
                recs.tok(tok::PUNCTUATION_DELIMITER_HTML, p);
                quote = q;
                p += 1;
                recs.tok(tok::STRING, p);
                state = 3;
                fresh = true;
            }
        }
    };
    *ptr = p;
    (r, recs)
}

/// Highlight a Vue file of `len` bytes at lexer memory offset `base`
/// (`$hlVue`, `$vueTag`, `$vueHtmlRange`). The file is cut at comments,
/// tags, and `{{`; the markup between cuts is HTML.
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let end = len;
    let mut src = Src(input(inst, base, len));
    let mut recs = Recs::load(inst);
    // $lexEmitLeadingContinuation
    let mut ptr = scan::utf8_span_end(src.0, 0, len);
    recs.gap(0, ptr);
    let mut from = ptr;
    let mut p = ptr;
    loop {
        p = find2(src, p, end, b'{', b'<');
        if p >= end {
            break;
        }
        let c = src[p];
        if c == b'<' {
            if p + 4 <= end && src.u32_at(p) == word(b"<!--") as u32 {
                if from < p {
                    recs = html_range(inst, base, len, from, p, recs);
                    src = Src(input(inst, base, len));
                }
                ptr = comment_end(src, p, end);
                emit(&mut recs, tok::COMMENT, p, ptr);
                from = ptr;
                p = ptr;
                continue;
            }
            // Tags are Vue's own; declarations remain the HTML lexer's.
            let n = src[p + 1];
            if p + 1 < end
                && (is_ident_start(n) || (n == b'/' && p + 2 < end && is_ident_start(src[p + 2])))
            {
                if from < p {
                    recs = html_range(inst, base, len, from, p, recs);
                    src = Src(input(inst, base, len));
                }
                // $vueTag
                ptr = p + 1;
                let close = n == b'/';
                if close {
                    ptr += 1;
                }
                recs.tok(tok::PUNCTUATION_BRACKET_HTML, ptr);
                let q = name_end(src, ptr, end);
                let kind = if close { 0 } else { raw_text_kind(src, ptr, q) };
                emit(&mut recs, tok::TAG, ptr, q);
                ptr = q;
                let r;
                (r, recs) = vue_attrs(inst, base, len, &mut ptr, recs, kind);
                if r & 3 != 0 && r > 255 {
                    recs.store(inst);
                    ptr = raw_text(inst, base, len, ptr, end, r >> 8);
                    recs = Recs::load(inst);
                }
                src = Src(input(inst, base, len));
                from = ptr;
                p = ptr;
                continue;
            }
        }
        if c == b'{' && p + 1 < end && src[p + 1] == b'{' {
            if from < p {
                recs = html_range(inst, base, len, from, p, recs);
            }
            (ptr, recs) = interpolation(inst, base, p, recs);
            src = Src(input(inst, base, len));
            from = ptr;
            p = ptr;
            continue;
        }
        p += 1;
    }
    if from < end {
        recs = html_range(inst, base, len, from, end, recs);
    }
    recs.store(inst);
}
