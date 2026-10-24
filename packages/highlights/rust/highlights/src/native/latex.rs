//! WAT sources: src/langs/latex.wat src/common.wat src/scan.wat
//!
//! Native LaTeX lexer. Commands color themselves and the next `{...}`
//! argument (`\section{...}` is a title); `$...$`, `\(...\)`, `\[...\]`,
//! and math environments switch to math, where text is numeric and `^`,
//! `_`, `=` are operators; verbatim-like environments and `\verb` keep
//! their bodies literal. A blank line ends math and arguments. The records
//! equal the translated `latex` lexer's records.

use super::Lexer;
use super::scan;
use super::tables::{KeywordTable, byteset};
use crate::Rec;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::LATEX_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "latex" => Some(highlight),
        _ => None,
    }
}

/// `$latexWords`: each value is a token plus a kind in bits 8 and up.
static WORDS: KeywordTable<2048> = KeywordTable::new(LATEX_WORDS);

/// Bytes that end an environment name (`$latexEnvNameEnd`), and NUL,
/// which ends it only at the input end.
static ENV_NAME_STOP: [bool; 256] = byteset(b"{}\\%$\n\r\x00");

/// Bytes of a control word's name: letters and `@`.
static NAME: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = is_letter(c as u8) || c == b'@' as usize;
        c += 1;
    }
    t
};

/// Whitespace: space and TAB through CR (`$lexIsSpace`).
static SPACE: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = b == b' ' || b.wrapping_sub(9) <= 4;
        c += 1;
    }
    t
};

/// The byte at `i`. Callers read at most 16 bytes past the input end, which
/// the 96-byte input slack covers.
#[inline(always)]
fn at(src: &[u8], i: usize) -> u8 {
    debug_assert!(i < src.len());
    // SAFETY: `i` lies inside the input or its slack (see above).
    unsafe { *src.get_unchecked(i) }
}

/// Whether `c` is an ASCII letter.
#[inline(always)]
const fn is_letter(c: u8) -> bool {
    (c | 32).wrapping_sub(b'a') <= 25
}

/// Token records written through a moving pointer into `inst.ext.recs`,
/// the way the translated `$emitTok` and `$emitGap` write them: a token
/// extends the last record when its color matches, and whitespace extends
/// the last record whatever its color. The vector has room for one record
/// per input byte and every record covers at least one byte, so running
/// out of room means a lexer bug, which traps.
#[derive(Clone, Copy)]
struct Out {
    cur: *mut Rec,
    limit: *mut Rec,
    /// Token of the last record, or `u32::MAX` when there is none.
    last: u32,
}

impl Out {
    /// Append a non-empty token ending at `end` (`$emitTok`).
    #[inline(always)]
    fn tok(&mut self, hl: u32, end: usize) {
        // SAFETY: `cur` stays within the vector's capacity: a merge steps
        // back over the last record, and the trap stops a write at the
        // limit.
        unsafe {
            self.cur = self.cur.sub((self.last == hl) as usize);
            if self.cur == self.limit {
                crate::rt::trap();
            }
            self.cur.write(Rec {
                end: end as u32,
                token: hl,
            });
            self.cur = self.cur.add(1);
        }
        self.last = hl;
    }

    /// `[lhs, rhs)` as `hl` when it is non-empty (`$emitTok`).
    #[inline(always)]
    fn emit(&mut self, hl: u32, lhs: usize, rhs: usize) {
        if lhs < rhs {
            self.tok(hl, rhs);
        }
    }

    /// Whitespace `[lhs, rhs)` extends the last record (`$emitGap`). Every
    /// gap after the input's leading whitespace follows a token's record.
    #[inline(always)]
    fn gap(&mut self, lhs: usize, rhs: usize) {
        if lhs < rhs {
            // SAFETY: the record before `cur` is written (see above).
            unsafe { (*self.cur.sub(1)).end = rhs as u32 };
        }
    }
}

/// The next `a` or `b` from `p`, or `end` (`$lexFindEither`).
#[inline(always)]
fn find_either(src: &[u8], p: usize, end: usize, a: u8, b: u8) -> usize {
    scan::find3(src, p, end, a, b, b)
}

/// The end of an environment name at `p`: its `}`, or the first byte that
/// cannot be part of a name on this line (`$latexEnvNameEnd`).
#[inline(always)]
fn env_name_end(src: &[u8], mut p: usize, end: usize) -> usize {
    loop {
        while !ENV_NAME_STOP[at(src, p) as usize] {
            p += 1;
        }
        if at(src, p) == 0 && p < end {
            p += 1;
            continue;
        }
        return p;
    }
}

/// The keyword value of the environment name `[lhs, rhs)`, plus 4096 when
/// it ends with `*`, or -1 for an unknown name (`$latexEnvKey`).
#[inline(always)]
fn env_key(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    let star = rhs > lhs && at(src, rhs - 1) == b'*';
    WORDS.value(src, lhs, rhs - star as usize) | (star as i32) << 12
}

/// The end of the plain text from `p`, or the input end, 16 bytes per
/// step. Plain text ends at `#$%&`, `[\]`, `{`, `}`, or LF, and in math
/// also at `^`, `_`, or `=`.
#[inline(always)]
fn text_end(src: &[u8], mut p: usize, end: usize, math: bool) -> usize {
    // `#$%&`, `[\]` (`[\]^_` in math), `{`, `}`, LF, and `=` in math
    let range = V::splat(if math { 4 } else { 2 });
    let extra = V::splat(if math { b'=' } else { b'\n' });
    while p < end {
        // SAFETY: each load starts before the input end, inside the slack.
        let w = unsafe { V::load(src.as_ptr().add(p)) };
        let hit = w
            .sub(V::splat(b'#'))
            .le(V::splat(3))
            .or(w.sub(V::splat(b'[')).le(range))
            .or(w
                .eq(V::splat(b'{'))
                .or(w.eq(V::splat(b'}')))
                .or(w.eq(V::splat(b'\n')).or(w.eq(extra))));
        let k = hit.first();
        if k < 16 {
            return (p + k).min(end);
        }
        p += 16;
    }
    end
}

/// Lex the LaTeX input of `len` bytes at `base` (`$hlLatex`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, which is not
    // reallocated while this lexer runs.
    let src: &[u8] = unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) };
    let end = len;
    let v = &mut inst.ext.recs;
    let start = v.as_mut_ptr();
    let mut o = Out {
        // SAFETY: `len` records are written.
        cur: unsafe { start.add(v.len()) },
        // SAFETY: one past the allocation.
        limit: unsafe { start.add(v.capacity()) },
        last: v.last().map_or(u32::MAX, |r| r.token),
    };

    // 0 text, 1 `$`, 2 `$$`, 3 `\(`, 4 `\[`, 5 a math environment
    let mut math = 0u32;
    // the key of an open verbatim or comment environment, or 0
    let mut raw = 0i32;
    let mut depth = 0u32;
    // the token for the next `{...}` argument, and whether an optional
    // `[...]` is open before it
    let mut pend = 0u32;
    let mut pend_opt = false;
    // the token and brace depth of the open argument, plus 256 when it
    // opened inside math; and the argument it interrupted
    let mut arg_hl = 0u32;
    let mut arg_depth = 0u32;
    let mut outer_hl = 0u32;
    let mut outer_depth = 0u32;
    // no token since the last LF
    let mut line_empty = false;

    // `$lexEmitLeadingContinuation` and the leading whitespace: one gap,
    // which writes the first record when there is none yet. Its line
    // breaks change no state: blank lines reset what is already reset, and
    // the token after them clears `line_empty`.
    let mut ptr = scan::utf8_span_end(src, 0, end);
    while SPACE[at(src, ptr) as usize] {
        ptr += 1;
    }
    if ptr > 0 {
        if o.cur == start {
            o.tok(tok::NONE, ptr);
        } else {
            o.gap(0, ptr);
        }
    }
    loop {
        // a verbatim or comment body
        if raw != 0 {
            let mut p = ptr;
            loop {
                p = find_either(src, p, end, b'\\', b'\\');
                if p >= end {
                    break;
                }
                if p + 5 <= end && src[p..p + 4] == *b"\\end" && at(src, p + 4) == b'{' {
                    let q = env_name_end(src, p + 5, end);
                    if q < end && at(src, q) == b'}' && env_key(src, p + 5, q) == raw {
                        break;
                    }
                }
                p += 1;
            }
            o.emit((raw & 255) as u32, ptr, p);
            ptr = p;
            if p >= end {
                break;
            }
            raw = 0;
        }

        let gap = ptr;
        let mut c = at(src, ptr);
        if c == b' ' && !SPACE[at(src, ptr + 1) as usize] {
            // one space
            ptr += 1;
            o.gap(gap, ptr);
        } else if SPACE[c as usize] {
            loop {
                // A blank line ends math and arguments.
                if c == b'\n' {
                    if line_empty {
                        math = 0;
                        pend = 0;
                        pend_opt = false;
                        arg_hl = 0;
                        arg_depth = 0;
                        outer_hl = 0;
                        outer_depth = 0;
                        depth = 0;
                    }
                    line_empty = true;
                }
                ptr += 1;
                c = at(src, ptr);
                if !SPACE[c as usize] {
                    break;
                }
            }
            o.gap(gap, ptr);
        }
        if ptr >= end {
            break;
        }
        line_empty = false;
        let lhs = ptr;
        let c = at(src, lhs);
        let c2 = at(src, lhs + 1);

        // `true` for the one-byte bracket token after a brace or square
        // bracket's state change; `false` for plain text
        let bracket = match c {
            b'%' => {
                ptr = scan::line_end(src, ptr + 1, end);
                o.tok(tok::COMMENT, ptr);
                continue;
            }
            b'$' => {
                pend *= pend_opt as u32;
                let mut q = 1;
                if math == 0 {
                    q = 1 + (c2 == b'$') as usize;
                    math = q as u32;
                } else {
                    if math == 1 {
                        math = 0;
                    }
                    // display math closes only with `$$`
                    if math == 2 && c2 == b'$' {
                        q = 2;
                        math = 0;
                    }
                }
                ptr = lhs + q;
                o.tok(tok::PUNCTUATION_BRACKET, ptr);
                continue;
            }
            b'{' => {
                depth = depth.wrapping_add(1);
                if pend != 0 && !pend_opt {
                    outer_hl = arg_hl;
                    outer_depth = arg_depth;
                    arg_hl = pend | if math != 0 { 256 } else { 0 };
                    arg_depth = depth;
                    pend = 0;
                }
                true
            }
            b'}' => {
                if arg_depth != 0 && depth == arg_depth {
                    arg_hl = outer_hl;
                    arg_depth = outer_depth;
                    outer_hl = 0;
                    outer_depth = 0;
                }
                depth = depth.saturating_sub(1);
                pend = 0;
                pend_opt = false;
                true
            }
            b'[' => {
                pend_opt = pend != 0;
                true
            }
            b']' => {
                pend_opt = false;
                true
            }
            b'&' => {
                pend *= pend_opt as u32;
                ptr = lhs + 1;
                o.tok(tok::PUNCTUATION_DELIMITER, ptr);
                continue;
            }
            b'#' => {
                pend *= pend_opt as u32;
                if c2.wrapping_sub(b'1') <= 8 {
                    ptr = lhs + 2;
                    o.tok(tok::VARIABLE_PARAMETER, ptr);
                    continue;
                }
                false
            }
            b'^' | b'_' | b'=' => {
                if math != 0 {
                    ptr = lhs + 1;
                    o.tok(tok::OPERATOR, ptr);
                    continue;
                }
                false
            }
            b'\\' => {
                // a command inside a pending command's `[...]` keeps it
                // pending
                pend *= pend_opt as u32;
                let mut p = lhs + 1;
                // a control symbol: `\\`, `\%`, or the math delimiters
                // `\(` `\)` `\[` `\]`; a backslash before a line break
                // stays alone
                if !(is_letter(c2) || c2 == b'@') {
                    let mut hl = tok::FUNCTION;
                    if c2 == b'(' || c2 == b'[' {
                        if math == 0 {
                            math = if c2 == b'(' { 3 } else { 4 };
                        }
                        hl = tok::PUNCTUATION_BRACKET;
                    }
                    if c2 == b')' || c2 == b']' {
                        if math == if c2 == b')' { 3 } else { 4 } {
                            math = 0;
                        }
                        hl = tok::PUNCTUATION_BRACKET;
                    }
                    if p < end && c2 != b'\n' && c2 != b'\r' {
                        p = scan::utf8_span_end(src, p + 1, end);
                    }
                    ptr = p;
                    o.emit(hl, lhs, p);
                    continue;
                }
                // a control word: letters and `@`, then an optional `*`
                // (the NUL at the input end stops the name)
                let mut q = p + 1;
                while NAME[at(src, q) as usize] {
                    q += 1;
                }
                let v = WORDS.value(src, p, q);
                let kind = v >> 8;
                if at(src, q) == b'*' && q < end {
                    q += 1;
                }
                ptr = q;
                let mut hl = tok::FUNCTION;
                if (kind as u32) <= 3 {
                    if !pend_opt {
                        pend = (v & 255) as u32;
                    }
                    hl = match kind {
                        1 => tok::KEYWORD,
                        2 => tok::KEYWORD_IMPORT,
                        3 => tok::PUNCTUATION_LIST_MARKER,
                        _ => tok::FUNCTION,
                    };
                }
                if kind == 4 {
                    hl = tok::KEYWORD;
                }
                o.tok(hl, ptr);
                // `\verb|...|`: the body ends at the delimiter or the line
                if kind == 5 {
                    let d = at(src, ptr);
                    if ptr < end && d.wrapping_sub(33) <= 93 && !is_letter(d) {
                        let mut p = find_either(src, ptr + 1, end, d, b'\n');
                        if p < end && at(src, p) == d {
                            p += 1;
                        }
                        o.emit(tok::TEXT_LITERAL, ptr, p);
                        ptr = p;
                    }
                }
                // `\begin{name}` and `\end{name}` on one line; without a
                // closed name on this line, the next group still names it
                if kind == 4 {
                    // `\end` is the four-byte command
                    let is_end = ptr - lhs == 4;
                    let p = {
                        let mut s = ptr;
                        while at(src, s) == b' ' || at(src, s) == b'\t' {
                            s += 1;
                        }
                        s
                    };
                    let mut q = p;
                    if p < end && at(src, p) == b'{' {
                        q = env_name_end(src, p + 1, end);
                    }
                    if q == p || q >= end || at(src, q) != b'}' {
                        pend = tok::TYPE;
                        continue;
                    }
                    o.gap(ptr, p);
                    o.tok(tok::PUNCTUATION_BRACKET, p + 1);
                    o.emit(tok::TYPE, p + 1, q);
                    ptr = q + 1;
                    o.tok(tok::PUNCTUATION_BRACKET, ptr);
                    let v = env_key(src, p + 1, q);
                    let kind = if v >= 0 { (v & 4095) >> 8 } else { -1 };
                    if is_end {
                        if kind == 6 && math == 5 {
                            math = 0;
                        }
                        continue;
                    }
                    if kind == 6 && math == 0 {
                        math = 5;
                    }
                    if kind >= 7 {
                        raw = v;
                        // Verbatim, lstlisting, and minted options and
                        // minted's language, on the `\begin` line, precede
                        // the body
                        while (8..=10).contains(&kind) && ptr < end {
                            let c = at(src, ptr);
                            if c != b'[' && c != b'{' {
                                break;
                            }
                            let p = find_either(src, ptr + 1, end, c + 2, b'\n');
                            if p >= end || at(src, p) == b'\n' {
                                break;
                            }
                            o.tok(tok::PUNCTUATION_BRACKET, ptr + 1);
                            o.emit(tok::NONE, ptr + 1, p);
                            ptr = p + 1;
                            o.tok(tok::PUNCTUATION_BRACKET, ptr);
                        }
                    }
                }
                continue;
            }
            _ => false,
        };
        if bracket {
            ptr = lhs + 1;
            o.tok(tok::PUNCTUATION_BRACKET, ptr);
            continue;
        }

        // plain text up to the next special byte or line break; it ends a
        // pending argument unless it sits in that command's `[...]`
        pend *= pend_opt as u32;
        ptr = text_end(src, lhs + 1, end, math != 0);
        let mut hl = if math != 0 { tok::NUMBER } else { tok::NONE };
        if arg_depth != 0 && (arg_hl >= 256 || math == 0) {
            hl = arg_hl & 255;
        }
        o.tok(hl, ptr);
    }
    // SAFETY: the records before `cur` are written.
    unsafe { inst.ext.recs.set_len(o.cur.offset_from(start) as usize) };
}
