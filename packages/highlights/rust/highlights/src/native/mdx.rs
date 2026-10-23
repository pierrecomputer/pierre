//! WAT sources: src/langs/mdx.wat src/langs/markdown.wat src/langs/astro.wat src/languages.wat src/common.wat src/scan.wat src/emit.wat
//!
//! Native MDX lexer (`$hlMdx`): Markdown with JSX tags, `{...}`
//! expressions, and `import`/`export` blocks. The scan finds each `{` and
//! `<` outside fenced code; the Markdown between them runs through a copy
//! of the native Markdown lexer (`$hlMarkdown` on a range), JSX close tags
//! are lexed here, and JSX open tags, expressions, and ESM blocks run
//! through the translated lexers (`$hlTsx`, `$hlTsxExpression`,
//! `$mdxEsmRange`), as the WAT hands them over.
//!
//! The Markdown lexer walks its range byte by byte: line-start constructs
//! (indentation, block quotes, headings, fences, list markers) and then
//! inline constructs (pipes, autolinks, inline HTML, code spans, links,
//! emphasis, escapes), batching plain text in between. Its embedded
//! languages run through the translated lexers: fenced code bodies
//! (`$markdownFenceBody`), inline HTML (`$hlHtml`), and YAML front matter
//! (`$frontMatterOpen` and `$hlYaml`). The native lexer only runs on whole
//! input, so the WAT's streaming branches (`$streaming` set) never apply.

use super::Lexer;
use super::recs::Recs;
use super::scan;
use crate::generated::Instance;
use crate::token_ids as tok;
use crate::wat_tables::MEM_LANGUAGE_NAMES;

/// The lexer for each language this module handles.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "mdx" => Some(highlight),
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

/// The bytes that end a run of plain text (`$markdownPlainEnd`).
#[cfg(not(target_arch = "aarch64"))]
static PLAIN_STOP: [bool; 256] = super::tables::byteset(b"\n\r*<[\\_`|");

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

/// The first position in `[p, stop)` whose byte is in `set`, or `stop`.
/// Scans 16 bytes per step; loads may pass `stop` into the input slack,
/// and matches there are clamped away.
#[inline(always)]
fn find_any<const N: usize>(src: &[u8], mut p: usize, stop: usize, set: [u8; N]) -> usize {
    #[cfg(target_arch = "aarch64")]
    {
        use core::arch::aarch64::*;
        while p < stop {
            // SAFETY: `p < stop`, which is at most the input length, so the
            // 16 bytes lie inside the input and its slack.
            let mask = unsafe {
                let w = vld1q_u8(src.as_ptr().add(p));
                let mut hit = vceqq_u8(w, vdupq_n_u8(set[0]));
                let mut i = 1;
                while i < N {
                    hit = vorrq_u8(hit, vceqq_u8(w, vdupq_n_u8(set[i])));
                    i += 1;
                }
                vget_lane_u64::<0>(vreinterpret_u64_u8(vshrn_n_u16::<4>(vreinterpretq_u16_u8(
                    hit,
                ))))
            };
            if mask != 0 {
                return (p + (mask.trailing_zeros() / 4) as usize).min(stop);
            }
            p += 16;
        }
        stop
    }
    #[cfg(not(target_arch = "aarch64"))]
    {
        while p < stop && !set.contains(&src[p]) {
            p += 1;
        }
        p.min(stop)
    }
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
    #[cfg(target_arch = "aarch64")]
    #[inline(always)]
    fn plain_end(&self, mut p: usize) -> usize {
        use core::arch::aarch64::*;
        // High nibble groups of the stop bytes, one bit each: 0x0_ (LF,
        // CR), 0x2_ (`*`), 0x3_ (`<`), 0x5_ (`[`, `\`, `_`), 0x6_ (`` ` ``),
        // 0x7_ (`|`).
        const HI: [u8; 16] = [1, 0, 2, 4, 0, 8, 16, 32, 0, 0, 0, 0, 0, 0, 0, 0];
        const LO: [u8; 16] = [16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 8, 44, 1, 0, 8];
        // SAFETY: each load reads 16 bytes at `p < end`, inside the slack.
        unsafe {
            let hi = vld1q_u8(HI.as_ptr());
            let lo = vld1q_u8(LO.as_ptr());
            let nib = vdupq_n_u8(15);
            while p < self.end {
                let w = vld1q_u8(self.src.0.as_ptr().add(p));
                let bits = vandq_u8(
                    vqtbl1q_u8(lo, vandq_u8(w, nib)),
                    vqtbl1q_u8(hi, vshrq_n_u8::<4>(w)),
                );
                let hit = vtstq_u8(bits, bits);
                let mask = vget_lane_u64::<0>(vreinterpret_u64_u8(vshrn_n_u16::<4>(
                    vreinterpretq_u16_u8(hit),
                )));
                if mask != 0 {
                    p += (mask.trailing_zeros() / 4) as usize;
                    return p.min(self.end);
                }
                p += 16;
            }
        }
        self.end
    }

    /// End of the plain text from `p`: the next byte that may start markup,
    /// or the end (`$markdownPlainEnd`).
    #[cfg(not(target_arch = "aarch64"))]
    #[inline(always)]
    fn plain_end(&self, mut p: usize) -> usize {
        while p < self.end && !PLAIN_STOP[self.src[p] as usize] {
            p += 1;
        }
        p
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

/// YAML front matter at `*ptr` through the translated lexers
/// (`$frontMatterOpen`, `$frontMatterClose`, `$markdownYamlRange`,
/// `$frontMatterCloser`). Returns the records and the position after it.
#[cold]
#[inline(never)]
fn front_matter(inst: &mut Instance, base: usize, recs: Recs, mut ptr: usize) -> (Recs, usize) {
    let abs = |p: usize| (base + p) as i32;
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
    }
    (Recs::load(inst), ptr)
}

/// `$hlMarkdown` over `[from, to)` of the input of `len` bytes at lexer
/// memory offset `base` (`$mdxMarkdownRange`). Returns the records.
#[inline(never)]
fn markdown_range(
    inst: &mut Instance,
    base: usize,
    len: usize,
    from: usize,
    to: usize,
    recs: Recs,
) -> Recs {
    let abs = |p: usize| (base + p) as i32;
    let end = to;
    inst.g_srcBase = base as i32;
    inst.g_end = abs(to);
    let mut md = Md {
        src: Src(input(inst, base, len)),
        end,
    };
    let mut recs = recs;

    // $lexEmitLeadingContinuation
    let mut ptr = scan::utf8_span_end(md.src.0, from, end);
    recs.gap(from, ptr);

    // YAML front matter, which only the document start can open
    // (`$frontMatterOpen` answers 0 elsewhere).
    if ptr == 0 {
        (recs, ptr) = front_matter(inst, base, recs, ptr);
        md.src = Src(input(inst, base, len));
    }

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
    inst.g_end = abs(len);
    recs
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

/// An identifier byte (`$lexIsIdentContinue`).
#[inline(always)]
fn is_ident_continue(c: u8) -> bool {
    is_ident_start(c) || is_digit(c)
}

/// `[from, to)` as Markdown, when not empty (`$mdxMarkdownRange`).
#[inline(always)]
fn md_range(
    inst: &mut Instance,
    base: usize,
    len: usize,
    from: usize,
    to: usize,
    recs: Recs,
) -> Recs {
    if from >= to {
        return recs;
    }
    markdown_range(inst, base, len, from, to, recs)
}

/// `[from, to)` as TSX through the translated lexer, except a close tag
/// `</...>`, which is lexed here (`$mdxTsxRange`). Returns the records.
#[inline(never)]
fn tsx_range(
    inst: &mut Instance,
    base: usize,
    len: usize,
    from: usize,
    to: usize,
    mut recs: Recs,
) -> Recs {
    let src = Src(input(inst, base, len));
    if from + 2 <= to && src[from] == b'<' && src[from + 1] == b'/' {
        recs.tok(tok::PUNCTUATION_BRACKET_JSX, from + 2);
        let p = from + 2;
        let mut ptr = p;
        let mut dotted = false;
        while ptr < to {
            let c = src[ptr];
            if !(is_ident_continue(c) || c == b'.' || c == b':' || c == b'-') {
                break;
            }
            if c == b'.' {
                dotted = true;
            }
            ptr += 1;
        }
        let component = dotted || (p < ptr && src[p].wrapping_sub(b'A') <= 25);
        emit(
            &mut recs,
            if component {
                tok::TAG_COMPONENT_JSX
            } else {
                tok::TAG_JSX
            },
            p,
            ptr,
        );
        while ptr < to {
            let lhs = ptr;
            let c = src[ptr];
            if is_space(c) {
                while ptr < to && is_space(src[ptr]) {
                    ptr += 1;
                }
                recs.gap(lhs, ptr);
                continue;
            }
            ptr += 1;
            recs.tok(
                if c == b'>' {
                    tok::PUNCTUATION_BRACKET_JSX
                } else {
                    tok::NONE
                },
                ptr,
            );
        }
        return recs;
    }
    recs.store(inst);
    let save = inst.g_end;
    inst.g_end = (base + to) as i32;
    inst.g_ptr = (base + from) as i32;
    inst.f_hlTsx();
    inst.g_end = save;
    inst.g_ptr = (base + to) as i32;
    Recs::load(inst)
}

/// End of the `{` expression at `p`, through the translated scan
/// (`$tsxExpressionEnd`).
#[inline(never)]
fn expression_end(inst: &mut Instance, base: usize, p: usize) -> usize {
    inst.f_tsxExpressionEnd((base + p) as i32) as usize - base
}

/// End of a `/* */` or `//` comment at the `/` at `p`, or `p` when none
/// starts there; an unclosed comment runs to the end (`$mdxCommentEnd`).
fn comment_end(src: Src, p: usize, end: usize) -> usize {
    if p + 1 >= end {
        return p;
    }
    let c = src[p + 1];
    if c != b'*' && c != b'/' {
        return p;
    }
    if c == b'*' {
        scan::block_comment_end(src.0, p + 2, end)
    } else {
        scan::line_end(src.0, p + 2, end)
    }
}

/// End of one JSX open or close tag at the `<` at `lhs`, including quoted
/// and braced attribute values; `lhs + 1` when no tag closes there
/// (`$mdxJsxEnd`). Braced values are scanned by the translated
/// `$tsxExpressionEnd`, so the caller hands the records over around it.
fn jsx_end(inst: &mut Instance, base: usize, len: usize, lhs: usize) -> usize {
    let end = len;
    let mut src = Src(input(inst, base, len));
    let mut p = lhs + 1;
    if p >= end {
        return lhs + 1;
    }
    let mut c = src[p];
    let mut close = false;
    if c == b'/' {
        close = true;
        p += 1;
        if p >= end {
            return lhs + 1;
        }
        c = src[p];
    }
    if !(is_ident_start(c) || c == b'>') {
        return lhs + 1;
    }
    // a close tag has no attribute values: it ends at the first `>`; a `<`
    // before that starts another tag, so this one never closed
    if close {
        let p = find_any(src.0, p, end, *b"><");
        if p < end && src[p] == b'>' {
            return p + 1;
        }
        return lhs + 1;
    }
    // 0 tag or name, 1 after `=`, 2 an unquoted value
    let mut value = 0;
    while p < end {
        let c = src[p];
        if c == b'>' {
            return p + 1;
        }
        // a stray `<` outside quotes and braces: the tag never closed
        if c == b'<' {
            break;
        }
        if value == 1 && !is_space(c) {
            if c == b'"' || c == b'\'' {
                p = find_any(src.0, p + 1, end, [c]);
                if p < end {
                    p += 1;
                }
                value = 0;
                continue;
            }
            if c == b'{' {
                p = expression_end(inst, base, p);
                src = Src(input(inst, base, len));
                value = 0;
                continue;
            }
            value = 2;
        }
        if value == 0 && c == b'{' {
            p = expression_end(inst, base, p);
            src = Src(input(inst, base, len));
            continue;
        }
        if value == 0 && c == b'/' {
            let to = comment_end(src, p, end);
            if to != p {
                p = to;
                continue;
            }
        }
        if value == 2 && is_space(c) {
            value = 0;
        }
        if value == 0 && c == b'=' {
            value = 1;
        }
        p += 1;
    }
    lhs + 1
}

/// End of the fenced code block opened by the line at `p`, or `None`
/// (`$mdxFenceEnd`). The line prefix is read as the Markdown lexer keeps
/// line-start meaning behind it: spaces, `>` markers, and list markers
/// followed by a blank; the closer is Markdown's (`$markdownFenceClose`).
fn fence_end(md: &Md, mut p: usize) -> Option<usize> {
    let src = md.src;
    let end = md.end;
    let mut quotes: u32 = 0;
    let mut list_start = NO_LIST;
    let mut fence = 0u8;
    while p < end {
        fence = src[p];
        let q;
        if fence == b'>' {
            quotes = quotes.wrapping_add(1);
            q = p + 1;
        } else if fence == b' ' {
            q = p + 1;
        } else {
            q = md.list_marker_end(p);
            // a list marker counts only with a blank after it
            if q == p || q >= end || !is_space(src[q]) {
                break;
            }
            if list_start == NO_LIST {
                list_start = p;
            }
        }
        p = q;
    }
    if p >= end || (fence != b'`' && fence != b'~') {
        return None;
    }
    let mut q = p;
    while q < end && src[q] == fence {
        q += 1;
    }
    let len = q - p;
    let indent = if list_start != NO_LIST {
        (p - list_start) as u32
    } else {
        0
    };
    if len < 3 {
        return None;
    }
    let (close, ended) = md.fence_close(md.after_line(md.line_end(q)), fence, len, quotes, indent);
    if ended {
        return Some(close);
    }
    // unterminated: the block runs to the end, exactly as markdown treats it
    if close >= end {
        return Some(end);
    }
    Some(md.after_line(md.line_end(close)))
}

/// Does the line at `p` open an ESM block: `import` or `export` then a
/// blank, `{`, or `*` (`$mdxEsmStart`)?
fn esm_start(src: Src, p: usize, end: usize) -> bool {
    if p + 7 > end {
        return false;
    }
    let w = &src.0[p..p + 6];
    if w != b"import" && w != b"export" {
        return false;
    }
    let c = src[p + 6];
    c == b' ' || c == b'\t' || c == b'{' || c == b'*'
}

/// A `---` line at the document start opens front matter: the position
/// after the opener's line break, or `None` (`$frontMatterOpen`).
fn front_matter_open(md: &Md, ptr: usize) -> Option<usize> {
    let src = md.src;
    let end = md.end;
    if ptr == 0 && ptr + 3 <= end && &src.0[ptr..ptr + 3] == b"---" && md.line_end(ptr) == ptr + 3 {
        return Some(md.after_line(ptr + 3));
    }
    None
}

/// Start of the first line at or after `p` that is exactly `---`, or the
/// end (`$frontMatterClose`).
fn front_matter_close(md: &Md, mut p: usize) -> usize {
    let src = md.src;
    while p < md.end {
        let line_end = md.line_end(p);
        if line_end - p == 3 && &src.0[p..p + 3] == b"---" {
            return p;
        }
        p = md.after_line(line_end);
    }
    md.end
}

/// The first bytes of a line that may open a fenced block (directly or
/// behind a line prefix: a space, `>`, or a list marker) or an ESM block.
static LINE_OPENS: [bool; 256] = super::tables::byteset(b" >`~-+*0123456789ie");

/// Highlight an MDX document of `len` bytes at lexer memory offset `base`
/// (`$hlMdx`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let end = len;
    inst.g_srcBase = base as i32;
    inst.g_end = (base + len) as i32;
    let mut md = Md {
        src: Src(input(inst, base, len)),
        end,
    };
    let mut recs = Recs::load(inst);
    // $lexEmitLeadingContinuation
    let mut ptr = scan::utf8_span_end(md.src.0, 0, end);
    recs.gap(0, ptr);
    // set once a `>` search from some `<` reached the end: no later `<`
    // can close a tag, so their scans are skipped
    let mut no_close = false;
    // Markdown's YAML front matter stays opaque to MDX braces and angles.
    if let Some(p) = front_matter_open(&md, ptr) {
        let mut to = front_matter_close(&md, p);
        if to < end {
            to = md.after_line(md.line_end(to));
        }
        if ptr < to {
            recs = markdown_range(inst, base, len, ptr, to, recs);
            md.src = Src(input(inst, base, len));
            ptr = to;
        }
    }
    let mut from = ptr;
    let mut p = ptr;
    let mut fence_at = ptr;
    'scan: loop {
        let src = md.src;
        p = find_any(src.0, p, end, *b"{<");
        // Walk whole lines up to the hit, or to the end, skipping fenced
        // blocks and lexing ESM blocks; `fence_at` only moves forward.
        let mut in_fence = false;
        if fence_at < from {
            fence_at = md.after_line(md.line_end(from - 1));
        }
        while fence_at <= p && fence_at < end {
            // Only a line starting with a fence byte, a line prefix (space,
            // `>`, a list marker), or the `i`/`e` of `import`/`export` can
            // open a fence or an ESM block.
            if !LINE_OPENS[src[fence_at] as usize] {
                fence_at = md.after_line(md.line_end(fence_at));
                continue;
            }
            if let Some(to) = fence_end(&md, fence_at) {
                fence_at = to;
                if to > p {
                    in_fence = true;
                    break;
                }
            } else {
                // An `import`/`export` line is JavaScript up to a blank line.
                if esm_start(src, fence_at, end) {
                    recs = md_range(inst, base, len, from, fence_at, recs);
                    recs.store(inst);
                    let to = inst.f_mdxEsmRange((base + fence_at) as i32, 0) as usize - base;
                    recs = Recs::load(inst);
                    md.src = Src(input(inst, base, len));
                    from = to;
                    if p < to {
                        p = to;
                    }
                    fence_at = to;
                    continue 'scan;
                }
                fence_at = md.after_line(md.line_end(fence_at));
            }
        }
        if p >= end {
            break;
        }
        if in_fence {
            p = fence_at;
            continue;
        }
        if src[p] == b'{' {
            // the TSX lexer stops at the outer `}` itself
            recs = md_range(inst, base, len, from, p, recs);
            recs.store(inst);
            inst.g_ptr = (base + p) as i32;
            let closed = inst.f_hlTsxExpression(1, 1, 8, 0);
            ptr = inst.g_ptr as usize - base;
            recs = Recs::load(inst);
            if closed != 0 {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
            }
            md.src = Src(input(inst, base, len));
            from = ptr;
            p = ptr;
            continue;
        }
        // `<`
        if p + 4 <= end && &src.0[p..p + 4] == b"<!--" {
            let to = html_end(&md, inst, base, p, md.line_end(p));
            recs = md_range(inst, base, len, from, to, recs);
            md.src = Src(input(inst, base, len));
            from = to;
            p = to;
            continue;
        }
        let mut to = p + 1;
        if !no_close {
            recs.store(inst);
            to = jsx_end(inst, base, len, p);
            recs = Recs::load(inst);
            md.src = Src(input(inst, base, len));
            // no tag closed here; when no `>` follows at all, every later
            // `<` would rescan to the end for nothing
            if to <= p + 1 && md.find_byte(p + 1, b'>') >= end {
                no_close = true;
            }
        }
        if to > p + 1 {
            recs = md_range(inst, base, len, from, p, recs);
            recs = tsx_range(inst, base, len, p, to, recs);
            md.src = Src(input(inst, base, len));
            from = to;
            p = to;
            continue;
        }
        p += 1;
    }
    recs = md_range(inst, base, len, from, end, recs);
    recs.store(inst);
}
