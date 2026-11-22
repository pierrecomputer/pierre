//! WAT sources: src/langs/astro.wat src/langs/html.wat src/langs/xml.wat src/common.wat src/scan.wat
//!
//! Native Astro lexer (`$hlAstro`): TypeScript front matter between
//! standalone `---` lines, then HTML with `{...}` expressions
//! (`$braceMarkup`, dialect 1). The file is cut at each `{`, `<!--`
//! comment, and `<script`/`<style` element; the markup between cuts runs
//! through a copy of the native HTML lexer, and a start tag cut by a `{`
//! continues after the expression, while a `{` inside a quoted attribute
//! value stays value text. The front matter, expressions, and script and
//! style bodies run through the translated lexers (`$hlTsx`,
//! `$hlTsxExpression`, `$hlJs`, `$hlCss` and its dialects), as the WAT
//! hands them over. The native lexer only runs on whole input, so the
//! WAT's streaming branches (`$streaming` set) never apply.

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
        "astro" => Some(highlight),
        _ => None,
    }
}

/// Astro's dialect of the shared brace lexing (`$astro` in the WAT); this
/// module is Astro's.
const ASTRO: bool = true;

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
    // SAFETY (both reads): `rhs` is `lhs` plus 6 or 5 and at most the
    // input length, so the 8 bytes from `lhs` stay inside the slack.
    if len == 6
        && (unsafe { src.word_unchecked(lhs) } & 0xFFFF_FFFF_FFFF) | 0x2020_2020_2020
            == word(b"script")
    {
        return 1;
    }
    if len == 5
        && (unsafe { src.word_unchecked(lhs) } & 0xFF_FFFF_FFFF) | 0x20_2020_2020 == word(b"style")
    {
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
        // SAFETY: `p + 8` is at most the end, so the 8 bytes at `p + 1` stay
        // inside the slack.
        if (unsafe { src.word_unchecked(p + 1) } & 0x00FF_FFFF_FFFF_FFFF) | 0x0020_2020_2020_2000
            != word(b"/script")
        {
            return false;
        }
        p + 8
    } else {
        if p + 7 > end {
            return false;
        }
        // SAFETY: `p + 7` is at most the end, so the 8 bytes at `p + 1` stay
        // inside the slack.
        if (unsafe { src.word_unchecked(p + 1) } & 0xFFFF_FFFF_FFFF) | 0x2020_2020_2000
            != word(b"/style")
        {
            return false;
        }
        p + 7
    };
    if tp >= end {
        return true;
    }
    // SAFETY: `tp` is below the end.
    let t = unsafe { src.byte_unchecked(tp) };
    t == b'>' || t == b'/' || is_space(t)
}

/// End of the character reference at the `&` at `ptr`, past its `;`, or
/// `None` when none starts there (`$htmlEntity`).
fn entity_end(src: Input, ptr: usize, end: usize) -> Option<usize> {
    let mut q = ptr + 1;
    // SAFETY: `q` is below the end.
    if q < end && unsafe { src.byte_unchecked(q) } == b'#' {
        q += 1;
    }
    while q < end && q - ptr <= 32 {
        // SAFETY: as above.
        let c = unsafe { src.byte_unchecked(q) };
        if c.wrapping_sub(b'0') > 9 && (c | 32).wrapping_sub(b'a') > 25 {
            break;
        }
        q += 1;
    }
    // SAFETY: `ptr` holds `&`, below the end, so `ptr + 1` is at most the
    // end; `q` is read only below the end.
    let min = if unsafe { src.byte_unchecked(ptr + 1) } == b'#' {
        2
    } else {
        1
    };
    if q - ptr <= min || q >= end || unsafe { src.byte_unchecked(q) } != b';' {
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
        // SAFETY: `p` holds `>`, below the end, and is at least `lhs + 2`.
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
        // SAFETY: `p` is at least `lhs + 2`, below the end.
        if p >= end || !pi || unsafe { src.byte_unchecked(p - 1) } == b'?' {
            break;
        }
        p += 1;
    }
    if p < end { p + 1 } else { end }
}

/// End of the tag or attribute name from `q` (`$htmlNameEnd`).
#[inline(always)]
fn name_end(src: Input, mut q: usize, end: usize) -> usize {
    // SAFETY: `q` is below the end.
    while q < end && !NAME_STOP[unsafe { src.byte_unchecked(q) } as usize] {
        q += 1;
    }
    q
}

/// End of the unquoted attribute value from `q` (`$htmlValueEnd`).
#[inline(always)]
fn value_end(src: Input, mut q: usize, end: usize) -> usize {
    // SAFETY: `q` is below the end.
    while q < end && !VALUE_STOP[unsafe { src.byte_unchecked(q) } as usize] {
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
    // SAFETY: the name starts below the end, so its 8 bytes stay inside the
    // slack.
    if kind != 1
        && rhs - lhs == 4
        && (unsafe { src.word_unchecked(lhs) } as u32) | 0x2020_2020 == word(b"lang") as u32
    {
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
    // SAFETY: the value starts at or before the end, so its 8 bytes stay
    // inside the slack.
    let w = (unsafe { src.word_unchecked(lhs) } as u32) | 0x2020_2020;
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
/// `after_eq` marks a pending value and `quote` the quote of a value left
/// open (0 for none). At `end` the unfinished tag's state is stored in
/// `*open` as `$htmlOpenTag` packs it: 1, `after_eq` << 1, the open quote
/// << 8, and the kind << 16.
#[inline(always)]
#[allow(clippy::too_many_arguments)]
fn attrs(
    src: Input,
    end: usize,
    ptr: &mut usize,
    recs: &mut Recs,
    mut after_eq: bool,
    mut quote: u8,
    mut kind: u32,
    open: &mut u32,
) -> u32 {
    let mut p = *ptr;
    if quote != 0 {
        // $htmlQuotedBody from the range start
        let lhs = p;
        let q = find2(src, p, end, quote, quote);
        if q < end {
            p = q + 1;
            quote = 0;
        } else {
            p = end;
        }
        recs.emit(tok::STRING, lhs, p);
    }
    let r = loop {
        if p >= end {
            *open = 1 | (after_eq as u32) << 1 | (quote as u32) << 8 | kind << 16;
            break 0;
        }
        let lhs = p;
        // SAFETY: `lhs` is below the end.
        let c = unsafe { src.byte_unchecked(lhs) };
        if is_space(c) {
            p += 1;
            // SAFETY: `p` is below the end.
            while p < end && is_space(unsafe { src.byte_unchecked(p) }) {
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
                quote = if closed { 0 } else { c };
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
            // SAFETY: `p` is below the end.
            if p < end && unsafe { src.byte_unchecked(p) } == b'>' {
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
            let closed = q < end;
            p = if closed { q + 1 } else { end };
            quote = if closed { 0 } else { c };
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
        // SAFETY: `p` is below the end.
        if p < end && unsafe { src.byte_unchecked(p) } == b'=' {
            p += 1;
            recs.tok(tok::PUNCTUATION_DELIMITER_HTML, p);
            let lhs = p;
            // SAFETY: `p` is below the end.
            if p < end
                && (unsafe { src.byte_unchecked(p) } == b'"'
                    || unsafe { src.byte_unchecked(p) } == b'\'')
            {
                let c = unsafe { src.byte_unchecked(p) };
                let q = find2(src, p + 1, end, c, c);
                let closed = q < end;
                p = if closed { q + 1 } else { end };
                quote = if closed { 0 } else { c };
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
    // SAFETY: `base..base + len + SLACK` is this input in lexer memory;
    // it is made again after every call into translated code.
    let src = unsafe { Input::new(inst, base, len) };
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
        // SAFETY: `p` is below `stop`, at most the end.
        let c = unsafe { src.byte_unchecked(p) };
        if c == b'<' || c == b'&' {
            return p;
        }
        p += 1;
    }
    find2(src, p, end, b'<', b'&')
}

/// The HTML main loop over `[ptr, end)` (`$htmlLex`, `$htmlTag`,
/// `$htmlTagEnd`) of a range the brace lexing bounds. Returns the records
/// and the state of a start tag the range end cut (`$htmlOpenTag`), or 0.
/// `input` is the input as the caller last made it; it is made again here
/// after every call into translated code, so it stays current for the
/// caller.
fn html_lex(
    inst: &mut Instance,
    base: usize,
    len: usize,
    input: &mut Input,
    mut ptr: usize,
    end: usize,
    mut recs: Recs,
) -> (Recs, u32) {
    let mut src = *input;
    let mut open = 0;
    while ptr < end {
        // text run: everything up to the next `<` or `&`
        let text_from = ptr;
        ptr = text_end(src, ptr, end);
        recs.emit(tok::NONE, text_from, ptr);
        if ptr >= end {
            break;
        }
        let lhs = ptr;
        // SAFETY: `lhs` is below the end.
        if unsafe { src.byte_unchecked(lhs) } == b'&' {
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
        // SAFETY: `lhs + 1` is below the end.
        let c = if lhs + 1 < end {
            unsafe { src.byte_unchecked(lhs + 1) }
        } else {
            0
        };
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
                // SAFETY: `lhs + 4` is at most the end.
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
        let r = attrs(src, end, &mut ptr, &mut recs, false, 0, kind, &mut open);
        if r & 3 != 0 && r > 255 {
            core::hint::cold_path();
            recs.store(inst);
            ptr = raw_text(inst, base, len, ptr, end, r >> 8);
            recs = Recs::load(inst);
            // SAFETY: `base..base + len + SLACK` is this input in lexer memory;
            // it is made again after every call into translated code.
            src = unsafe { Input::new(inst, base, len) };
            *input = src;
        }
    }
    (recs, open)
}

/// 1 for `<script`, 2 for `<style` at the `<` at `p`, each followed by a
/// byte that ends the name (or the end), else 0 (`$braceRawKind`).
#[inline(always)]
fn brace_raw_kind(src: Input, p: usize, end: usize) -> u32 {
    let q = p + 1;
    let mut kind = 0;
    if q + 6 <= end {
        kind = raw_text_kind(src, q, q + 6);
    }
    if kind == 0 && q + 5 <= end {
        kind = raw_text_kind(src, q, q + 5);
    }
    if kind != 0 {
        let q = q + if kind == 1 { 6 } else { 5 };
        if q < end {
            // SAFETY: `q` is below the end.
            let c = unsafe { src.byte_unchecked(q) };
            if !(is_space(c) || c == b'>' || c == b'/') {
                return 0;
            }
        }
    }
    kind
}

/// The next position at or after `p` where an HTML range must stop: a
/// `{`, a `<!--` comment, or a `<script`/`<style` element; `end` when there
/// is none (`$braceNextCut`).
fn next_cut(src: Input, mut p: usize, end: usize) -> usize {
    loop {
        p = find2(src, p, end, b'{', b'<');
        if p >= end {
            return end;
        }
        // SAFETY: `p` is below the end, so its 8 bytes stay inside the slack.
        if unsafe { src.byte_unchecked(p) } == b'{'
            || brace_raw_kind(src, p, end) != 0
            || (p + 4 <= end && (unsafe { src.word_unchecked(p) } as u32) == word(b"<!--") as u32)
        {
            return p;
        }
        p += 1;
    }
}

/// The brace lexer's state over the whole input, with the instance for the
/// parts that run translated.
struct Brace<'i> {
    inst: &'i mut Instance,
    base: usize,
    len: usize,
    src: Input<'static>,
    /// The cursor (`$ptr`).
    ptr: usize,
    recs: Recs,
}

impl Brace<'_> {
    /// Derive the records and input slice again after a translated call.
    #[inline(always)]
    fn reload(&mut self) {
        self.recs = Recs::load(self.inst);
        // SAFETY: `base..base + len + SLACK` is this input in lexer memory;
        // it is made again after every call into translated code.
        self.src = unsafe { Input::new(self.inst, self.base, self.len) };
    }

    /// `[from, to)` as HTML; returns the state of a start tag the range
    /// end cut, or 0 (`$braceHtmlRange`).
    fn html_range(&mut self, from: usize, to: usize) -> u32 {
        if from >= to {
            return 0;
        }
        let open;
        (self.recs, open) = html_lex(
            self.inst,
            self.base,
            self.len,
            &mut self.src,
            from,
            to,
            self.recs,
        );
        self.ptr = to;
        open
    }

    /// The raw-text body from the cursor (`$htmlTagEnd` for the packed
    /// attribute result `r`).
    fn tag_end(&mut self, r: u32) {
        if r & 3 != 0 && r > 255 {
            self.recs.store(self.inst);
            self.ptr = raw_text(self.inst, self.base, self.len, self.ptr, self.len, r >> 8);
            self.reload();
        }
    }

    /// A start tag at the cursor over the whole input, then its raw-text
    /// body (`$htmlTag`, `$htmlTagEnd`).
    fn tag(&mut self) {
        let src = self.src;
        let end = self.len;
        self.ptr += 1;
        self.recs.tok(tok::PUNCTUATION_BRACKET_HTML, self.ptr);
        let q = name_end(src, self.ptr, end);
        let kind = raw_text_kind(src, self.ptr, q);
        self.recs.emit(tok::TAG, self.ptr, q);
        self.ptr = q;
        let mut open = 0;
        let r = attrs(
            src,
            end,
            &mut self.ptr,
            &mut self.recs,
            false,
            0,
            kind,
            &mut open,
        );
        self.tag_end(r);
    }

    /// The `{` expression at `from`, through the translated TSX lexer;
    /// true after its closing `}` (`$braceExpression`). In Astro the TSX
    /// lexer takes the opening `{` itself; Svelte's dialect emits it and a
    /// block marker here.
    fn expression(&mut self, from: usize, tag: u32) -> bool {
        let src = self.src;
        let end = self.len;
        let mut p = from;
        if !ASTRO {
            self.recs.tok(tok::PUNCTUATION_SPECIAL, from + 1);
            p = from + 1;
            if p < end {
                let c = src.byte(p);
                if c == b'#' || c == b':' || c == b'/' || c == b'@' {
                    let mut marker_end = p + 1;
                    while marker_end < end && (src.byte(marker_end) | 32).wrapping_sub(b'a') <= 25 {
                        marker_end += 1;
                    }
                    self.recs.tok(tok::KEYWORD_CONTROL, marker_end);
                    p = marker_end;
                }
            }
        }
        let base = self.base;
        self.recs.store(self.inst);
        self.inst.g_ptr = (base + p) as i32;
        let closed = self
            .inst
            .f_hlTsxExpression(1, ASTRO as i32, 7 + ASTRO as i32, tag as i32);
        self.ptr = self.inst.g_ptr as usize - base;
        self.reload();
        if closed != 0 {
            self.ptr += 1;
            self.recs.tok(
                if ASTRO {
                    tok::PUNCTUATION_BRACKET
                } else {
                    tok::PUNCTUATION_SPECIAL
                },
                self.ptr,
            );
            return true;
        }
        false
    }

    /// The rest of a start tag after a `{` cut it, from the cursor: `tag`
    /// is its packed state (`$htmlOpenTag`). Attributes run to the next
    /// cut, tag end, stray `<`, or the end; each `{` starts another
    /// expression, except inside an Astro quoted value (`$braceTagRest`).
    fn tag_rest(&mut self, mut tag: u32) {
        let end = self.len;
        loop {
            let quote = (tag >> 8 & 255) as u8;
            // an Astro quoted `{` is value text, so the next cut lies beyond it
            let cut = next_cut(self.src, self.ptr + (ASTRO && quote != 0) as usize, end);
            let mut open = 0;
            let src = self.src;
            let r = attrs(
                src,
                cut,
                &mut self.ptr,
                &mut self.recs,
                false,
                quote,
                tag >> 16,
                &mut open,
            );
            self.tag_end(r);
            tag = open;
            // SAFETY: `self.ptr` is below the end.
            if tag == 0 || self.ptr >= end || unsafe { self.src.byte_unchecked(self.ptr) } != b'{' {
                break;
            }
            if !(ASTRO && tag & 0xff00 != 0) && !self.expression(self.ptr, tag) {
                break;
            }
        }
    }

    /// The `{` at the cursor: an expression (or, in Astro, value text in a
    /// quoted attribute value), and when it sits inside a start tag (`tag`
    /// nonzero) the rest of that tag (`$braceBrace`).
    fn brace(&mut self, tag: u32) {
        if ASTRO && tag & 0xff00 != 0 {
            self.tag_rest(tag);
            return;
        }
        if self.expression(self.ptr, tag) && tag != 0 {
            self.tag_rest(tag);
        }
    }

    /// HTML ranges between cuts, each `{` an expression, and script and
    /// style elements and comments lexed whole (`$braceMarkup`).
    fn markup(&mut self) {
        let end = self.len;
        let mut from = self.ptr;
        loop {
            let p = next_cut(self.src, from, end);
            let tag = self.html_range(from, p);
            if p >= end {
                break;
            }
            self.ptr = p;
            // SAFETY: `p` is below the end.
            if unsafe { self.src.byte_unchecked(p) } == b'{' {
                self.brace(tag);
            } else if brace_raw_kind(self.src, p, end) != 0 {
                self.tag();
            } else {
                let q = comment_end(self.src, p, end);
                self.recs.emit(tok::COMMENT, p, q);
                self.ptr = q;
            }
            from = self.ptr;
        }
        self.ptr = end;
    }
}

/// End of the line from `p`: the next CR or LF, or `end`
/// (`$astroLineEnd`).
#[inline(always)]
fn line_end(src: Input, p: usize, end: usize) -> usize {
    find2(src, p, end, b'\n', b'\r')
}

/// Just past the line break at `p`, or `p` at the end (`$astroAfterLine`).
#[inline(always)]
fn after_line(src: Input, p: usize, end: usize) -> usize {
    if p < end {
        // SAFETY: `p` and `p + 1` are read only below the end.
        if unsafe { src.byte_unchecked(p) } == b'\r'
            && p + 1 < end
            && unsafe { src.byte_unchecked(p + 1) } == b'\n'
        {
            return p + 2;
        }
        return p + 1;
    }
    p
}

/// A `---` line at the document start opens front matter: the position
/// after the opener's line break, or `None` (`$frontMatterOpen`).
fn front_matter_open(src: Input, ptr: usize, end: usize) -> Option<usize> {
    if ptr == 0
        && ptr + 3 <= end
        && (src.word(ptr) as u32) & 0xFF_FFFF == word(b"---") as u32
        && line_end(src, ptr, end) == ptr + 3
    {
        return Some(after_line(src, ptr + 3, end));
    }
    None
}

/// Start of the first line at or after `p` that is exactly `---`, or
/// `end` (`$frontMatterClose`).
fn front_matter_close(src: Input, mut p: usize, end: usize) -> usize {
    while p < end {
        let line_end = line_end(src, p, end);
        // SAFETY: `p` lies below the end, so its 8 bytes stay inside the slack.
        if line_end - p == 3
            && (unsafe { src.word_unchecked(p) } as u32) & 0xFF_FFFF == word(b"---") as u32
        {
            return p;
        }
        p = after_line(src, line_end, end);
    }
    end
}

/// The Astro lexer from `ptr` (`$hlAstro`): the front matter, if the
/// document opens one, then `$braceMarkup`.
fn astro(lx: &mut Brace) {
    let end = lx.len;
    let src = lx.src;
    if let Some(body) = front_matter_open(src, lx.ptr, end) {
        lx.recs.tok(tok::PUNCTUATION_SPECIAL, body);
        let close = front_matter_close(src, body, end);
        // $astroTsxRange
        if body < close {
            let base = lx.base;
            lx.recs.store(lx.inst);
            let save = lx.inst.g_end;
            lx.inst.g_end = (base + close) as i32;
            lx.inst.g_ptr = (base + body) as i32;
            lx.inst.f_hlTsx();
            lx.inst.g_end = save;
            lx.inst.g_ptr = (base + close) as i32;
            lx.reload();
        }
        lx.ptr = close;
        // $frontMatterCloser
        if close < end {
            let src = lx.src;
            let after = after_line(src, line_end(src, close, end), end);
            lx.recs.emit(tok::PUNCTUATION_SPECIAL, close, after);
            lx.ptr = after;
        }
    }
    lx.markup();
}

/// Highlight an Astro file of `len` bytes at lexer memory offset `base`
/// (`$hlAstro`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: `base..base + len + SLACK` is this input in lexer memory;
    // it is made again after every call into translated code.
    let src = unsafe { Input::new(inst, base, len) };
    let mut recs = Recs::load(inst);
    // $lexEmitLeadingContinuation
    let ptr = scan::utf8_span_end(src.bytes(), 0, len);
    recs.gap(0, ptr);
    let mut lx = Brace {
        inst,
        base,
        len,
        src,
        ptr,
        recs,
    };
    astro(&mut lx);
    lx.recs.store(lx.inst);
}
