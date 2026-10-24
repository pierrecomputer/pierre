//! WAT sources: src/langs/markdown.wat src/languages.wat src/common.wat src/scan.wat src/emit.wat
//!
//! Native Markdown lexer. It walks the document byte by byte as `$hlMarkdown`
//! does: line-start constructs (indentation, block quotes, headings, fences,
//! list markers) and then inline constructs (pipes, autolinks, inline HTML,
//! code spans, links, emphasis, escapes), batching plain text in between.
//! Embedded languages run through the translated lexers: fenced code bodies
//! (`$markdownFenceBody`), inline HTML (`$hlHtml`), and YAML front matter
//! (`$frontMatterOpen` and `$hlYaml`). The native lexer only runs on whole
//! input, so the WAT's streaming branches (`$streaming` set) never apply.

use super::Lexer;
use super::recs::Recs;
use super::scan;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::MEM_LANGUAGE_NAMES;

/// The lexer for each language this module handles.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "markdown" => Some(highlight),
        _ => None,
    }
}

/// No list item has started on the current line.
const NO_LIST: usize = usize::MAX;

/// The input and its 96-byte slack, read without borrowing `inst` so the
/// lexer can still call translated functions.
fn input<'a>(inst: &Instance, base: usize, len: usize) -> &'a [u8] {
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory. The slice is
    // derived again after every translated call, which may move memory.
    unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) }
}

/// Space, or TAB through CR (`$lexIsSpace`).
#[inline(always)]
fn is_space(c: u8) -> bool {
    c == b' ' || c.wrapping_sub(9) <= 4
}

/// An ASCII digit (`$lexIsDigit`).
#[inline(always)]
fn is_digit(c: u8) -> bool {
    c.wrapping_sub(b'0') <= 9
}

/// An identifier's first byte: letters, `_`, `$`, or non-ASCII
/// (`$lexIsIdentStart`).
#[inline(always)]
fn is_ident_start(c: u8) -> bool {
    c >= 0x80 || (c | 32).wrapping_sub(b'a') <= 25 || c == b'_' || c == b'$'
}

/// An ASCII letter or digit, or any non-ASCII byte (`$markdownIsAlnum`).
#[inline(always)]
fn is_alnum(c: u8) -> bool {
    c >= 0x80 || is_digit(c) || (c | 32).wrapping_sub(b'a') <= 25
}

/// ASCII punctuation, the bytes a backslash may escape (`$markdownIsPunct`).
#[inline(always)]
fn is_punct(c: u8) -> bool {
    c.wrapping_sub(b'!') <= 14
        || c.wrapping_sub(b':') <= 6
        || c.wrapping_sub(b'[') <= 5
        || c.wrapping_sub(b'{') <= 3
}

/// Bytes that start plain text: bit 0 within a line, bit 1 at a line
/// start, where more bytes open constructs. No rule of `$hlMarkdown`
/// applies to them, so they fall through to its plain-text batch.
static PLAIN_START: [u8; 256] = {
    let inline = super::tables::byteset(b"\n\r|<`[*_\\");
    let line = super::tables::byteset(b" >#`~-+*0123456789");
    let mut t = [0u8; 256];
    let mut i = 0;
    while i < 256 {
        if !inline[i] {
            t[i] = 1;
            if !line[i] {
                t[i] |= 2;
            }
        }
        i += 1;
    }
    t
};

/// The first position in `[p, stop)` whose byte `hit` marks, or `stop`.
/// `hit` maps 16 bytes to a mask of the bytes it looks for. Scans 16 bytes
/// per step; loads may pass `stop` into the input slack, and matches there
/// are clamped away.
#[inline(always)]
fn find_mask(src: &[u8], mut p: usize, stop: usize, hit: impl Fn(V) -> V) -> usize {
    while p < stop {
        // SAFETY: `p < stop`, which is at most the input length, so the
        // 16 bytes lie inside the input and its slack.
        let m = hit(unsafe { V::load(src.as_ptr().add(p)) }).lanes();
        if m.any() {
            return (p + m.first()).min(stop);
        }
        p += 16;
    }
    stop
}

/// The first position in `[p, stop)` whose byte is in `set`, or `stop`.
#[inline(always)]
fn find_any<const N: usize>(src: &[u8], p: usize, stop: usize, set: [u8; N]) -> usize {
    find_mask(src, p, stop, |w| {
        let mut hit = w.eq(V::splat(set[0]));
        let mut i = 1;
        while i < N {
            hit = hit.or(w.eq(V::splat(set[i])));
            i += 1;
        }
        hit
    })
}

/// Emit `[lhs, rhs)` as `hl` unless the range is empty (`$emitTok`).
#[inline(always)]
fn emit(recs: &mut Recs, hl: u32, lhs: usize, rhs: usize) {
    if lhs < rhs {
        recs.tok(hl, rhs);
    }
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

/// The input being lexed: its bytes (with slack) and its length.
struct Md<'a> {
    src: Src<'a>,
    end: usize,
}

impl Md<'_> {
    /// First CR or LF at or after `p`, or the end (`$markdownLineEnd`,
    /// `$lexFindEither`).
    #[inline(always)]
    fn line_end(&self, p: usize) -> usize {
        find_any(self.src.0, p, self.end, *b"\n\r")
    }

    /// Just past the line break at `p`, or `p` at the end
    /// (`$markdownAfterLine`).
    #[inline(always)]
    fn after_line(&self, p: usize) -> usize {
        let src = self.src;
        if p < self.end {
            if src[p] == b'\r' && p + 1 < self.end && src[p + 1] == b'\n' {
                return p + 2;
            }
            return p + 1;
        }
        p
    }

    /// The next `q` in `[p, stop)`, or `stop`; `p` itself when it is at or
    /// past `stop` (`$scanFindSpecial` without escapes or line breaks).
    #[inline(always)]
    fn find_special(&self, p: usize, stop: usize, q: u8) -> usize {
        if p >= stop {
            return p;
        }
        find_any(self.src.0, p, stop, [q])
    }

    /// The next `q` or backslash in `[p, stop)`, or `stop`; `p` itself when
    /// it is at or past `stop` (`$scanFindSpecial` with escapes).
    #[inline(always)]
    fn find_special_esc(&self, p: usize, stop: usize, q: u8) -> usize {
        if p >= stop {
            return p;
        }
        find_any(self.src.0, p, stop, [q, b'\\'])
    }

    /// The next byte `a` at or after `p`, or the end (`$lexFindByte`).
    #[inline(always)]
    fn find_byte(&self, p: usize, a: u8) -> usize {
        find_any(self.src.0, p, self.end, [a])
    }

    /// End of the backtick run at `p`, bounded by `stop`
    /// (`$markdownTickRunEnd`).
    #[inline(always)]
    fn tick_run_end(&self, mut p: usize, stop: usize) -> usize {
        while p < stop && self.src[p] == b'`' {
            p += 1;
        }
        p
    }

    /// End of the code span whose opening backtick run starts at `lhs`:
    /// just past the first later run of the same length before `line_end`,
    /// or 0 (`$markdownCodeSpanEnd`).
    fn code_span_end(&self, lhs: usize, line_end: usize) -> usize {
        let mut p = self.tick_run_end(lhs, line_end);
        let count = p - lhs;
        loop {
            p = self.find_special(p, line_end, b'`');
            if p >= line_end {
                return 0;
            }
            let q = self.tick_run_end(p, line_end);
            if q - p == count {
                return q;
            }
            p = q;
        }
    }

    /// [`Md::code_span_end`] when the line's end is not known yet: the scan
    /// hops over backticks and line breaks together, so a missing closer
    /// yields the line end from the same pass. Returns the span end and 0,
    /// or 0 and the line end.
    fn code_span_end_open(&self, lhs: usize) -> (usize, usize) {
        let src = self.src;
        let end = self.end;
        let mut p = self.tick_run_end(lhs, end);
        let count = p - lhs;
        loop {
            p = find_any(src.0, p, end, *b"`\n\r");
            if p >= end || src[p] != b'`' {
                return (0, p);
            }
            let q = self.tick_run_end(p, end);
            if q - p == count {
                return (q, 0);
            }
            p = q;
        }
    }

    /// End of a list marker at `p` (below the end), or `p` when none starts
    /// there (`$markdownListMarkerEnd`).
    #[inline(always)]
    fn list_marker_end(&self, p: usize) -> usize {
        let src = self.src;
        let c = src[p];
        if c == b'-' || c == b'+' || c == b'*' {
            return p + 1;
        }
        let mut q = p;
        while q < self.end && is_digit(src[q]) {
            q += 1;
        }
        if q > p && q < self.end && (src[q] == b'.' || src[q] == b')') {
            return q + 1;
        }
        p
    }

    /// Skip up to three spaces from `p`, bounded by `stop`
    /// (`$markdownSkipIndent`).
    #[inline(always)]
    fn skip_indent(&self, mut p: usize, stop: usize) -> usize {
        let mut n = 0;
        while n < 3 && p < stop && self.src[p] == b' ' {
            p += 1;
            n += 1;
        }
        p
    }

    /// The first fence closer line at or after `p`, and whether the body
    /// ended at a line missing its container prefix instead
    /// (`$markdownFenceClose`, `$markdownFenceEnded`). The closer needs
    /// `quotes` quote markers, `indent` columns of list indentation, at
    /// most three spaces, at least `len` `fence` bytes, then blanks.
    /// Returns the end when no closer exists.
    fn fence_close(
        &self,
        mut p: usize,
        fence: u8,
        len: usize,
        quotes: u32,
        indent: u32,
    ) -> (usize, bool) {
        let src = self.src;
        if quotes == 0 && indent == 0 {
            return (self.fence_close_plain(p, fence, len), false);
        }
        while p < self.end {
            let line_end = self.line_end(p);
            let mut q = p;
            'skip: {
                let mut n = quotes;
                while n != 0 {
                    q = self.skip_indent(q, line_end);
                    if q >= line_end || src[q] != b'>' {
                        return (p, true);
                    }
                    q += 1;
                    if q < line_end && src[q] == b' ' {
                        q += 1;
                    }
                    n -= 1;
                }
                let mut n: u32 = 0;
                while n < indent {
                    if q >= line_end {
                        break 'skip;
                    }
                    let c = src[q];
                    if c != b' ' && c != b'\t' {
                        return (p, true);
                    }
                    n = n.wrapping_add(if c == b'\t' { 4 - (n & 3) } else { 1 });
                    q += 1;
                }
                q = self.skip_indent(q, line_end);
                let run = q;
                while q < line_end && src[q] == fence {
                    q += 1;
                }
                if q - run < len {
                    break 'skip;
                }
                while q < line_end && (src[q] == b' ' || src[q] == b'\t') {
                    q += 1;
                }
                if q == line_end {
                    return (p, false);
                }
            }
            p = self.after_line(line_end);
        }
        (self.end, false)
    }

    /// `$markdownFenceClose` for a fence outside block quotes and lists:
    /// the start of the first line from `body` (a line start) that holds
    /// at most three spaces, at least `len` `fence` bytes, then only
    /// blanks; or the end. Only a line whose first byte after those spaces
    /// is `fence` can close, so the scan hops from one `fence` byte to the
    /// next instead of visiting every line.
    fn fence_close_plain(&self, body: usize, fence: u8, len: usize) -> usize {
        let src = self.src;
        let end = self.end;
        let mut f = body;
        loop {
            f = find_any(src.0, f, end, [fence]);
            if f >= end {
                return end;
            }
            // the line start: back over at most three spaces
            let mut s = f;
            while f - s < 3 && s > body && src[s - 1] == b' ' {
                s -= 1;
            }
            let mut q = f;
            while q < end && src[q] == fence {
                q += 1;
            }
            if s == body || src[s - 1] == b'\n' || src[s - 1] == b'\r' {
                let run = q - f;
                while q < end && (src[q] == b' ' || src[q] == b'\t') {
                    q += 1;
                }
                if run >= len && (q >= end || src[q] == b'\n' || src[q] == b'\r') {
                    return s;
                }
            }
            f = q;
        }
    }

    /// End of the plain text from `p`: the next byte that may start markup,
    /// or the end (`$markdownPlainEnd`). Classifies 16 bytes per step by
    /// their low and high nibbles: a byte stops the run when the bit its
    /// high nibble names is set in its low nibble's entry.
    #[inline(always)]
    fn plain_end(&self, p: usize) -> usize {
        // High nibble groups of the stop bytes, one bit each: 0x0_ (LF,
        // CR), 0x2_ (`*`), 0x3_ (`<`), 0x5_ (`[`, `\`, `_`), 0x6_ (`` ` ``),
        // 0x7_ (`|`).
        const HI: [u8; 16] = [1, 0, 2, 4, 0, 8, 16, 32, 0, 0, 0, 0, 0, 0, 0, 0];
        const LO: [u8; 16] = [16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 8, 44, 1, 0, 8];
        let hi = V::from_array(&HI);
        let lo = V::from_array(&LO);
        find_mask(self.src.0, p, self.end, |w| {
            lo.lookup(w.and(V::splat(15))).test(hi.lookup(w.shr::<4>()))
        })
    }

    /// End (just past `>`) of a CommonMark autolink opening at the `<` at
    /// `lhs`, or 0 (`$markdownAutolinkEnd`).
    fn autolink_end(&self, lhs: usize, line_end: usize) -> usize {
        let src = self.src;
        let mut p = lhs + 1;
        while p < line_end {
            let c = src[p];
            if !((c | 32).wrapping_sub(b'a') <= 25
                || c.wrapping_sub(b'+') <= 14
                || c == b'_'
                || c >= 0x80)
            {
                break;
            }
            p += 1;
        }
        if p >= line_end {
            return 0;
        }
        let c = src[p];
        if c == b':'
            && (p - lhs).wrapping_sub(3) <= 30
            && (src[lhs + 1] | 32).wrapping_sub(b'a') <= 25
        {
            loop {
                p += 1;
                if p >= line_end {
                    break;
                }
                let c = src[p];
                if c == b'>' {
                    return p + 1;
                }
                if c <= 32 || c == b'<' || c == 127 {
                    break;
                }
            }
            return 0;
        }
        // email: a non-empty local part, `@`, a non-empty domain, then `>`
        if c != b'@' || p == lhs + 1 {
            return 0;
        }
        let at = p;
        loop {
            p += 1;
            if p >= line_end {
                break;
            }
            let b = src[p];
            if !(is_alnum(b) || b == b'.' || b == b'-') {
                break;
            }
        }
        if p > at + 1 && p < line_end && src[p] == b'>' {
            return p + 1;
        }
        0
    }

    /// The next `c` or backtick in `[p, stop)`, or `stop`
    /// (`$markdownFindEither`).
    #[inline(always)]
    fn find_either(&self, p: usize, stop: usize, c: u8) -> usize {
        find_any(self.src.0, p, stop, [c, b'`'])
    }
}

/// The failed-emphasis cache of `$markdownEmphasisEnd`: no closer for an
/// underscore opener of width `count` exists before `before`.
struct UnderNoClose {
    before: usize,
    count: usize,
}

/// End of the emphasis opened at `lhs` by `count` (1 or 2) `c` markers and
/// closed by an equal run on the line, or 0 (`$markdownEmphasisEnd`).
#[inline(always)]
fn emphasis_end(
    md: &Md,
    under: &mut UnderNoClose,
    lhs: usize,
    c: u8,
    count: usize,
    line_end: usize,
) -> usize {
    let src = md.src;
    let mut p = lhs + count;
    if c == b'_' {
        // `_` opens only when left-flanking.
        if (lhs > 0 && is_alnum(src[lhs - 1])) || p >= line_end || is_space(src[p]) {
            return 0;
        }
        if lhs < under.before && count == under.count {
            return 0;
        }
    }
    loop {
        p = md.find_either(p, line_end, c);
        if p >= line_end {
            if c == b'_' {
                under.before = line_end;
                under.count = count;
            }
            return 0;
        }
        // A code span hides the markers inside it.
        if src[p] == b'`' {
            let q = md.code_span_end(p, line_end);
            p = if q != 0 {
                q
            } else {
                md.tick_run_end(p, line_end)
            };
            continue;
        }
        let mut q = p + 1;
        if count == 2 {
            q = if q < line_end && src[q] == c {
                p + 2
            } else {
                0
            };
        }
        if q != 0 && (c != b'_' || q >= line_end || src[q] >= 0x80 || !is_alnum(src[q])) {
            return q;
        }
        p += 1;
    }
}

/// Emit the block-quote prefix of the line at `p` - up to `quotes` levels
/// of at most three spaces, `>`, and one optional blank - and return where
/// the line's content starts (`$markdownQuotePrefix`).
#[inline(always)]
fn quote_prefix(md: &Md, recs: &mut Recs, mut p: usize, line_end: usize, mut quotes: u32) -> usize {
    let src = md.src;
    while quotes != 0 {
        let q = md.skip_indent(p, line_end);
        if q >= line_end || src[q] != b'>' {
            break;
        }
        recs.gap(p, q);
        p = q + 1;
        recs.tok(tok::PUNCTUATION_MARKUP, p);
        if p < line_end && src[p] == b' ' {
            p += 1;
            recs.gap(p - 1, p);
        }
        quotes -= 1;
    }
    p
}

/// Emit the closing fence line at `ptr` - its block-quote prefix as markup,
/// then the fence through the line break - and return the position past it
/// (`$markdownFenceCloser`).
#[inline(always)]
fn fence_closer(md: &Md, recs: &mut Recs, ptr: usize, quotes: u32) -> usize {
    let line_end = md.line_end(ptr);
    let after = md.after_line(line_end);
    let lhs = quote_prefix(md, recs, ptr, line_end, quotes);
    emit(recs, tok::PUNCTUATION_DELIMITER, lhs, after);
    after
}

/// Emit a link's `](uri)`: `]` at `close`, `)` at `rhs`
/// (`$markdownLinkTail`).
#[inline(always)]
fn link_tail(recs: &mut Recs, close: usize, rhs: usize) {
    recs.tok(tok::PUNCTUATION_BRACKET, close + 2);
    emit(recs, tok::LINK_URI, close + 2, rhs);
    recs.tok(tok::PUNCTUATION_BRACKET, rhs + 1);
}

/// Emit the link `[text](uri)` whose `[` is at `lhs`, `]` at `close`, and
/// `)` at `rhs` (`$markdownLink`).
#[inline(always)]
fn link(recs: &mut Recs, lhs: usize, close: usize, rhs: usize) {
    recs.tok(tok::PUNCTUATION_BRACKET, lhs + 1);
    emit(recs, tok::LINK_TEXT, lhs + 1, close);
    link_tail(recs, close, rhs);
}

/// Match an image inside a link, `[![alt](src)](href)`, whose `[` is at
/// `lhs` and whose first `]` is at `alt`. Emit it and return the end after
/// `)` when it fits on the line, else emit nothing and return 0
/// (`$markdownImageLink`).
#[inline(always)]
fn image_link(md: &Md, recs: &mut Recs, lhs: usize, line_end: usize, alt: usize) -> usize {
    let src = md.src;
    if lhs + 3 >= line_end || src[lhs + 1] != b'!' || src[lhs + 2] != b'[' {
        return 0;
    }
    // each of `](`, `)](`, and `)` must follow on the line
    if md.find_special(lhs + 3, alt, b'[') < alt {
        return 0;
    }
    if alt + 1 >= line_end || src[alt + 1] != b'(' {
        return 0;
    }
    let img = md.find_special(alt + 2, line_end, b')');
    if img + 2 >= line_end || src[img + 1] != b']' || src[img + 2] != b'(' {
        return 0;
    }
    let href = md.find_special(img + 3, line_end, b')');
    if href >= line_end {
        return 0;
    }
    recs.tok(tok::PUNCTUATION_BRACKET, lhs + 1);
    recs.tok(tok::NONE, lhs + 2);
    link(recs, lhs + 2, alt, img);
    link_tail(recs, img + 1, href);
    href + 1
}

/// The language named by `src[lhs..rhs]`, ignoring ASCII case, or 0
/// (plain) when there is none (`$languageByName`). The names are grouped
/// by length in the lexer memory at `$mem.languageNames`.
fn language_by_name(inst: &Instance, src: &[u8], lhs: usize, rhs: usize) -> i32 {
    let len = rhs.wrapping_sub(lhs);
    if len.wrapping_sub(1) > 17 {
        return 0;
    }
    let mem = inst.mem.bytes();
    let u16_at = |a: usize| u16::from_le_bytes([mem[a], mem[a + 1]]) as usize;
    let u64_at = |s: &[u8], a: usize| u64::from_le_bytes(s[a..a + 8].try_into().unwrap());
    let mut record = MEM_LANGUAGE_NAMES + u16_at(MEM_LANGUAGE_NAMES + 2 * len);
    let stop = MEM_LANGUAGE_NAMES + u16_at(MEM_LANGUAGE_NAMES + 2 + 2 * len);
    const LOWER: u64 = 0x2020_2020_2020_2020;
    let mask_of = |n: usize| {
        if n >= 8 {
            u64::MAX
        } else {
            (1u64 << (n * 8)) - 1
        }
    };
    let word = u64_at(src, lhs) | LOWER;
    let mask = mask_of(len);
    'alias: while record < stop {
        if (word ^ u64_at(mem, record + 1)) & mask == 0 {
            // a name over eight bytes compares its remaining chunks
            let mut i = 8;
            while i < len {
                let chunk = u64_at(src, lhs + i) | LOWER;
                if (chunk ^ u64_at(mem, record + 1 + i)) & mask_of(len - i) != 0 {
                    record += len + 1;
                    continue 'alias;
                }
                i += 8;
            }
            return mem[record] as i32;
        }
        record += len + 1;
    }
    0
}

/// Highlight a Markdown document of `len` bytes at lexer memory offset
/// `base` (`$hlMarkdown`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let abs = |p: usize| (base + p) as i32;
    let end = len;
    inst.g_srcBase = base as i32;
    inst.g_end = abs(len);
    let mut md = Md {
        src: Src(input(inst, base, len)),
        end,
    };
    let mut recs = Recs::load(inst);

    // $lexEmitLeadingContinuation
    let mut ptr = scan::utf8_span_end(md.src.0, 0, end);
    recs.gap(0, ptr);

    // YAML front matter.
    recs.store(inst);
    inst.g_ptr = abs(ptr);
    let body = inst.f_frontMatterOpen();
    if body != 0 {
        let mut r = Recs::load(inst);
        emit(&mut r, tok::PUNCTUATION_SPECIAL, ptr, body as usize - base);
        r.store(inst);
        let close = inst.f_frontMatterClose(body);
        // $markdownYamlRange
        let save = inst.g_end;
        inst.g_end = close;
        inst.g_ptr = body;
        inst.f_hlYaml();
        inst.g_end = save;
        inst.g_ptr = close;
        inst.f_frontMatterCloser(close);
        ptr = inst.g_ptr as usize - base;
        md.src = Src(input(inst, base, len));
    }
    recs = Recs::load(inst);

    let mut line_start = ptr == 0 || md.src[ptr - 1] == b'\n' || md.src[ptr - 1] == b'\r';
    let mut quotes: u32 = 0;
    let mut list_start = NO_LIST;
    // End of the line the cursor is on, valid only while `ptr` stays below.
    let mut line_cache = 0usize;
    // Failed scans on this line: no tag closes before `html_no_close`, and
    // no link starting before `link_no_close` can complete.
    let mut html_no_close = 0usize;
    let mut link_no_close = 0usize;
    let mut link_close = 0usize;
    let mut under = UnderNoClose {
        before: 0,
        count: 0,
    };

    while ptr < end {
        let src = md.src;
        // A byte no rule applies to starts plain text; the byte that ends
        // it always has a rule, so it is dispatched right after.
        if PLAIN_START[src[ptr] as usize] & (1 << line_start as u8) != 0 {
            line_start = false;
            ptr = md.plain_end(ptr + 1);
            recs.tok(tok::NONE, ptr);
            if ptr >= end {
                break;
            }
        }
        let lhs = ptr;
        let c = src[ptr];

        // Newline bytes are gaps and reset block-prefix recognition.
        if c == b'\n' || c == b'\r' {
            ptr = md.after_line(ptr);
            // the next line's leading spaces, as the indentation rule
            // below takes them
            ptr = md.skip_indent(ptr, end);
            recs.gap(lhs, ptr);
            line_start = true;
            quotes = 0;
            list_start = NO_LIST;
            continue;
        }

        if line_start {
            match c {
                // Up to three leading spaces retain line-start meaning.
                b' ' => {
                    let mut count = 0;
                    while ptr < end && src[ptr] == b' ' && count < 3 {
                        ptr += 1;
                        count += 1;
                    }
                    recs.gap(lhs, ptr);
                    continue;
                }

                // Block quote marker.
                b'>' => {
                    ptr += 1;
                    recs.tok(tok::PUNCTUATION_MARKUP, ptr);
                    quotes = quotes.wrapping_add(1);
                    // the blanks after it, as the indentation rule takes them
                    let q = md.skip_indent(ptr, end);
                    recs.gap(ptr, q);
                    ptr = q;
                    continue;
                }

                // ATX heading.
                b'#' => {
                    let mut p = ptr;
                    while p < end && src[p] == b'#' {
                        p += 1;
                    }
                    if p - ptr <= 6 && p < end && is_space(src[p]) {
                        recs.tok(tok::TITLE, p);
                        ptr = p;
                        let line_end = md.line_end(ptr);
                        // The blanks after the marker stay on the line.
                        let p = ptr;
                        while ptr < line_end && is_space(src[ptr]) {
                            ptr += 1;
                        }
                        recs.gap(p, ptr);
                        emit(&mut recs, tok::TITLE, ptr, line_end);
                        ptr = line_end;
                        line_start = false;
                        continue;
                    }
                }

                // Fenced code block.
                b'`' | b'~' => {
                    let fence = c;
                    let mut p = ptr;
                    while p < end && src[p] == fence {
                        p += 1;
                    }
                    let fence_len = p - ptr;
                    if fence_len >= 3 {
                        let line_end = md.line_end(ptr);
                        let mut q = p;
                        while q < line_end && is_space(src[q]) {
                            q += 1;
                        }
                        // Pandoc and Quarto brace the language: `{python}`, `{.rust}`.
                        if q < line_end && src[q] == b'{' {
                            q += 1;
                            if q < line_end && src[q] == b'.' {
                                q += 1;
                            }
                        }
                        let info = q;
                        // The language word also ends at attributes glued to it.
                        while q < line_end {
                            let c = src[q];
                            if is_space(c) || c == b',' || c == b':' || c == b'{' || c == b'}' {
                                break;
                            }
                            q += 1;
                        }
                        let lang = language_by_name(inst, src.0, info, q);
                        let indent = if list_start != NO_LIST {
                            (ptr - list_start) as u32
                        } else {
                            0
                        };
                        let body = md.after_line(line_end);
                        recs.tok(tok::PUNCTUATION_DELIMITER, body);
                        let (close, ended) = md.fence_close(body, fence, fence_len, quotes, indent);
                        // $markdownFenceBody: a body with a language or behind
                        // block-quote markers runs through the translated lexers.
                        if quotes != 0 || lang != 0 {
                            recs.store(inst);
                            inst.f_markdownFenceBody(lang, abs(body), abs(close), quotes as i32, 0);
                            recs = Recs::load(inst);
                            md.src = Src(input(inst, base, len));
                        } else {
                            emit(&mut recs, tok::TEXT_LITERAL, body, close);
                        }
                        ptr = close;
                        if !ended && close < end {
                            ptr = fence_closer(&md, &mut recs, ptr, quotes);
                        }
                        line_start = true;
                        quotes = 0;
                        list_start = NO_LIST;
                        continue;
                    }
                }

                // Unordered and ordered list markers.
                b'-' | b'+' | b'*' | b'0'..=b'9' => {
                    let p = md.list_marker_end(ptr);
                    if p > ptr && p < end && is_space(src[p]) {
                        if list_start == NO_LIST {
                            list_start = ptr;
                        }
                        ptr = p;
                        recs.tok(tok::PUNCTUATION_LIST_MARKER, ptr);
                        // the blanks after it, as the indentation rule
                        // takes them
                        let q = md.skip_indent(ptr, end);
                        recs.gap(ptr, q);
                        ptr = q;
                        continue;
                    }
                }
                _ => {}
            }
            line_start = false;
        }

        match c {
            // Pipe-table punctuation.
            b'|' => {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_MARKUP, ptr);
                continue;
            }

            // Autolinks, else inline HTML.
            b'<' => {
                if ptr >= line_cache {
                    line_cache = md.line_end(ptr);
                }
                let q = md.autolink_end(ptr, line_cache);
                if q != 0 {
                    let p = q - 1;
                    recs.tok(tok::PUNCTUATION_BRACKET, ptr + 1);
                    emit(&mut recs, tok::LINK_URI, ptr + 1, p);
                    recs.tok(tok::PUNCTUATION_BRACKET, q);
                    ptr = q;
                    continue;
                }
                if ptr >= html_no_close {
                    let html_end = html_end(&md, inst, base, ptr, line_cache);
                    if html_end == 0 {
                        html_no_close = line_cache;
                    }
                    if html_end > ptr + 1 {
                        // $markdownHtmlRange
                        recs.store(inst);
                        let save = inst.g_end;
                        inst.g_end = abs(html_end);
                        inst.g_ptr = abs(ptr);
                        inst.f_hlHtml();
                        inst.g_end = save;
                        inst.g_ptr = abs(html_end);
                        recs = Recs::load(inst);
                        md.src = Src(input(inst, base, len));
                        ptr = html_end;
                        continue;
                    }
                }
            }

            // Inline code run. A missing closer consumes to the line end.
            b'`' => {
                if ptr < line_cache {
                    ptr = md.code_span_end(ptr, line_cache);
                    if ptr == 0 {
                        ptr = line_cache;
                    }
                } else {
                    let (q, line_end) = md.code_span_end_open(ptr);
                    ptr = if q != 0 { q } else { line_end };
                }
                emit(&mut recs, tok::TEXT_LITERAL, lhs, ptr);
                continue;
            }

            // `[label](uri)` links.
            b'[' => {
                if ptr >= line_cache {
                    line_cache = md.line_end(ptr);
                }
                if ptr + 1 > link_no_close {
                    if ptr >= link_close {
                        link_close = md.find_special(ptr + 1, line_cache, b']');
                    }
                    let p = link_close;
                    let q = image_link(&md, &mut recs, ptr, line_cache, p);
                    if q != 0 {
                        ptr = q;
                        continue;
                    }
                    let mut q = ptr + 1;
                    loop {
                        q = md.find_special_esc(q, p, b'[');
                        if q >= p || src[q] == b'[' {
                            break;
                        }
                        q += 2;
                    }
                    if q < p {
                        ptr = q;
                        recs.tok(tok::NONE, ptr);
                        continue;
                    }
                    if p + 1 < line_cache && src[p] == b']' && src[p + 1] == b'(' {
                        let q = md.find_special(p + 2, line_cache, b')');
                        if q < line_cache {
                            link(&mut recs, ptr, p, q);
                            ptr = q + 1;
                            continue;
                        }
                        link_no_close = line_cache;
                    } else {
                        link_no_close = if p >= line_cache { line_cache } else { p };
                    }
                }
            }

            // Strong/emphasis spans.
            b'*' | b'_' => {
                let count = if ptr + 1 < end && src[ptr + 1] == c {
                    2
                } else {
                    1
                };
                if ptr >= line_cache {
                    line_cache = md.line_end(ptr);
                }
                let close = emphasis_end(&md, &mut under, lhs, c, count, line_cache);
                if close != 0 {
                    ptr = close;
                    recs.tok(
                        if count == 2 {
                            tok::EMPHASIS_STRONG
                        } else {
                            tok::EMPHASIS
                        },
                        ptr,
                    );
                    continue;
                }
                // a `_` run that did not open emphasis is plain text as a whole
                if c == b'_' {
                    while ptr < end && src[ptr] == b'_' {
                        ptr += 1;
                    }
                    recs.tok(tok::NONE, ptr);
                    continue;
                }
            }

            // Backslash escape: only ASCII punctuation can be escaped.
            b'\\' => {
                ptr += 1;
                if ptr < end && is_punct(src[ptr]) {
                    ptr += 1;
                    recs.tok(tok::STRING_ESCAPE, ptr);
                } else {
                    recs.tok(tok::NONE, ptr);
                }
                continue;
            }
            _ => {}
        }

        // Batch ordinary text up to the next potentially meaningful byte.
        ptr = md.plain_end(ptr + 1);
        recs.tok(tok::NONE, ptr);
    }
    recs.store(inst);
}

/// End of inline HTML starting at the `<` at `lhs` on a line ending at
/// `line_end`: `lhs + 1` when the next byte rules out a tag, 0 when a tag
/// could start but has no closer on the line. Script and style tags extend
/// through their closing tag or the end (`$markdownHtmlEnd`). The tag-name
/// checks (`$htmlNameEnd`, `$rawTextKind`, `$isRawTextClose`) run
/// translated.
fn html_end(md: &Md, inst: &mut Instance, base: usize, lhs: usize, line_end: usize) -> usize {
    let src = md.src;
    let end = md.end;
    let abs = |p: usize| (base + p) as i32;
    let mut p = lhs + 1;
    if p >= end {
        return p;
    }
    let c = src[p];
    if !(c == b'/' || c == b'!' || c == b'?' || is_ident_start(c) || c == b':') {
        return p;
    }
    // HTML comments need their real terminator, not the first `>`.
    if lhs + 4 <= end && &src.0[lhs..lhs + 4] == b"<!--" {
        p = lhs + 4;
        loop {
            p = md.find_byte(p, b'-');
            if p >= end {
                break;
            }
            if p + 3 <= end && &src.0[p..p + 3] == b"-->" {
                return p + 3;
            }
            p += 1;
        }
        return end;
    }
    // The tag ends at the first `>` outside quotes on the line; without
    // one, nothing at or after `p` closes a tag.
    loop {
        p = find_any(src.0, p, line_end, *b">\"'");
        if p >= line_end {
            return 0;
        }
        let c = src[p];
        p += 1;
        if c == b'>' {
            break;
        }
        p = md.find_special(p, line_end, c);
        if p >= line_end {
            return 0;
        }
        p += 1;
    }
    // raw-text elements: run through the close tag the HTML lexer stops at
    if is_ident_start(src[lhs + 1]) {
        let name_end = inst.f_htmlNameEnd(abs(lhs + 1));
        let kind = inst.f_rawTextKind(abs(lhs + 1), name_end);
        if kind != 0 {
            let mut q = p;
            loop {
                q = md.find_byte(q, b'<');
                if q >= end {
                    break;
                }
                if inst.f_isRawTextClose(abs(q), kind) != 0 {
                    q = md.find_byte(q, b'>');
                    if q < end {
                        return q + 1;
                    }
                    return end;
                }
                q += 1;
            }
            return end;
        }
    }
    p
}
