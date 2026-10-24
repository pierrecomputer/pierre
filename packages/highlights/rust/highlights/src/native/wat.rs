//! WAT sources: src/langs/wat.wat src/common.wat src/scan.wat
//!
//! Native WebAssembly text highlighter. One pass over the input: each token
//! is scanned and colored in the same step, with the same rules, in the
//! same order, as the translated `$hlWat`. The records equal the translated
//! lexer's records.

use super::Lexer;
use super::recs::Recs;
use super::scan;
use crate::Rec;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::WAT_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "wat" => Some(highlight),
        _ => None,
    }
}

/// `$watWords` as a perfect hash on a word's bytes. Every word is at most
/// 8 bytes, so a word is one little-endian integer, zero past its end;
/// names hold no NUL here, so equal integers mean equal words.
struct Words {
    keys: [u64; WORD_SLOTS],
    /// The word's 1-based group (`keyword-table.get`).
    groups: [u8; WORD_SLOTS],
    mul: u64,
}

const WORD_SLOTS: usize = 128;

/// The longest word.
const WORD_MAX: usize = 8;

/// The slot of the word whose bytes are `w`.
#[inline(always)]
const fn word_slot(w: u64, mul: u64) -> usize {
    (w.wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros())) as usize
}

/// `s` as a little-endian integer.
const fn word(s: &[u8]) -> u64 {
    let mut w = 0u64;
    let mut i = 0;
    while i < s.len() {
        w |= (s[i] as u64) << (8 * i);
        i += 1;
    }
    w
}

/// The words, placed by searching for a multiplier that gives each its own
/// slot.
static WORDS: Words = {
    let mut mul: u64 = 0x2545_f491_4f6c_dd1d;
    let mut attempt = 0;
    'search: loop {
        assert!(attempt < 20_000, "no collision-free hash: use more slots");
        let mut keys = [0u64; WORD_SLOTS];
        let mut groups = [0u8; WORD_SLOTS];
        let mut i = 0;
        while i < WAT_WORDS.len() {
            let w = WAT_WORDS[i].word;
            assert!(w.len() >= 2 && w.len() <= WORD_MAX);
            let k = word(w);
            let s = word_slot(k, mul);
            if keys[s] != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            keys[s] = k;
            groups[s] = WAT_WORDS[i].group;
            i += 1;
        }
        break Words { keys, groups, mul };
    }
};

/// The 1-based group of the word `[lhs, rhs)`, or 0 (`keyword-table.get
/// $watWords`).
#[inline(always)]
fn word_group(src: &[u8], lhs: usize, rhs: usize) -> u8 {
    let n = rhs - lhs;
    if n.wrapping_sub(2) > WORD_MAX - 2 {
        return 0;
    }
    let w = word_at(src, lhs, n as u32);
    let s = word_slot(w, WORDS.mul);
    if WORDS.keys[s] == w {
        WORDS.groups[s]
    } else {
        0
    }
}

/// Byte classes for the main dispatch.
mod class {
    /// A byte that starts a bare word.
    pub const WORD: u8 = 0;
    pub const SEMICOLON: u8 = 1;
    pub const OPEN_PAREN: u8 = 2;
    pub const CLOSE_PAREN: u8 = 3;
    pub const QUOTE: u8 = 4;
    pub const DOLLAR: u8 = 5;
    /// NUL: the end of the input, or a word byte inside it.
    pub const NUL: u8 = 6;
}

/// The [`class`] of each byte (whitespace never reaches the dispatch).
static CLASS: [u8; 256] = {
    let mut t = [class::WORD; 256];
    t[0] = class::NUL;
    t[b';' as usize] = class::SEMICOLON;
    t[b'(' as usize] = class::OPEN_PAREN;
    t[b')' as usize] = class::CLOSE_PAREN;
    t[b'"' as usize] = class::QUOTE;
    t[b'$' as usize] = class::DOLLAR;
    t
};

/// Bytes that end a name (`$watScanName`): whitespace, `"`, `(`, `)`, `;`,
/// and NUL, which ends one only at the input end.
static NAME_STOP: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = is_space(b) || matches!(b, b'"' | b'(' | b')' | b';' | 0);
        c += 1;
    }
    t
};

/// The byte at `i`. Every caller reads at most 16 bytes past the input
/// end, which the 96-byte input slack covers. The byte at the input end is
/// NUL, which matches none of the bytes a lookahead tests.
#[inline(always)]
fn at(src: &[u8], i: usize) -> u8 {
    debug_assert!(i < src.len());
    // SAFETY: `i` lies inside the input or its slack (see above).
    unsafe { *src.get_unchecked(i) }
}

/// Whether `c` is an ASCII digit (`$lexIsDigit`).
#[inline(always)]
const fn is_digit(c: u8) -> bool {
    c.wrapping_sub(b'0') <= 9
}

/// Whether `c` is an ASCII hex digit (`$lexIsHex`).
#[inline(always)]
const fn is_hex(c: u8) -> bool {
    is_digit(c) || (c | 32).wrapping_sub(b'a') <= 5
}

/// Whether `c` is ASCII whitespace: space or TAB through CR (`$lexIsSpace`).
#[inline(always)]
const fn is_space(c: u8) -> bool {
    c == b' ' || c.wrapping_sub(9) <= 4
}

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run.
#[inline(always)]
fn whitespace_end(src: &[u8], mut p: usize) -> usize {
    loop {
        let c = at(src, p);
        if c == b' ' {
            // Skip spaces 16 bytes at a time (indentation runs long).
            // SAFETY: `p` lies before the NUL after the input, so the
            // 16-byte read stays inside the slack.
            let w = unsafe { V::load(src.as_ptr().add(p)) };
            p += w.ne(V::splat(b' ')).first();
        } else if c.wrapping_sub(9) <= 4 {
            // TAB through CR, one at a time
            p += 1;
        } else {
            return p;
        }
    }
}

/// The end of the name or bare word from `p`: the next whitespace, `"`,
/// `(`, `)`, or `;`, or `end` (`$watScanName`; its identifier runs only
/// speed that scan up); and whether `[p, end)` holds a `.`.
#[inline(always)]
fn name_end(src: &[u8], mut p: usize, end: usize) -> (usize, bool) {
    let mut dot = false;
    // Most names are short: test a few bytes one by one first.
    for _ in 0..12 {
        let c = at(src, p);
        // (a NUL inside the input is a name byte)
        if NAME_STOP[c as usize] && (c != 0 || p >= end) {
            return (p.min(end), dot);
        }
        dot |= c == b'.';
        p += 1;
    }
    loop {
        // SAFETY: `p` lies at or before the NUL after the input, so the
        // 16-byte load stays inside the slack.
        let w = unsafe { V::load(src.as_ptr().add(p)) };
        let space = w.eq(V::splat(b' ')).or(w.sub(V::splat(9)).le(V::splat(4)));
        let paren = w.sub(V::splat(b'(')).le(V::splat(1));
        let other = w.eq(V::splat(b'"')).or(w.eq(V::splat(b';')));
        let k = space.or(paren).or(other).first();
        let d = w.eq(V::splat(b'.')).first();
        dot |= d < k && p + d < end;
        if p + k >= end {
            return (end, dot);
        }
        if k < 16 {
            return (p + k, dot);
        }
        p += 16;
    }
}

/// The first `n` bytes at `p` as a little-endian integer. Reads 8 bytes,
/// which the input slack allows.
#[inline(always)]
fn word_at(src: &[u8], p: usize, n: u32) -> u64 {
    debug_assert!(p + 8 <= src.len());
    // SAFETY: `p` lies before the input end, so `p + 8` lies inside the
    // slack.
    let w = unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() };
    w & (u64::MAX >> (64 - 8 * n))
}

/// The color of the bare word `[lhs, rhs)`, which holds a `.` when `dot`:
/// a number (with its sign, `inf`, `nan`, or a NaN payload), a table word,
/// a dotted instruction (a function), or a keyword (`$watWordHl`).
fn word_hl(src: &[u8], lhs: usize, rhs: usize, dot: bool) -> u32 {
    let mut p = lhs;
    let c = at(src, p);
    if c == b'+' || c == b'-' {
        p += 1;
    }
    if p < rhs && is_digit(at(src, p)) {
        return tok::NUMBER;
    }
    let w3 = word_at(src, p, 3);
    if rhs - p == 3 && (w3 == word(b"inf") || w3 == word(b"nan")) {
        return tok::NUMBER;
    }
    if rhs - p > 6 && word_at(src, p, 6) == word(b"nan:0x") {
        p += 6;
        loop {
            if !is_hex(at(src, p)) {
                break;
            }
            p += 1;
            if p == rhs {
                return tok::NUMBER;
            }
            if at(src, p) == b'_' {
                p += 1;
            }
            if p >= rhs {
                break;
            }
        }
    }
    // (no table word holds a `.`, so a dotted word skips the lookup)
    if dot {
        return tok::FUNCTION;
    }
    match word_group(src, lhs, rhs) {
        1 => tok::TYPE_BUILTIN,
        2 => tok::KEYWORD_CONTROL,
        _ => tok::KEYWORD,
    }
}

/// The end of a `(; ;)` comment from `p`, its opener: through the closer
/// that balances it, or `end` (`$watBlockComment`).
#[inline(never)]
fn block_comment_end(src: &[u8], p: usize, end: usize) -> usize {
    let mut depth = 1u32;
    let mut p = p + 2;
    loop {
        // `$lexFindEither`
        p = scan::find3(src, p, end, b'(', b';', b'(');
        if p >= end {
            return end;
        }
        let (c, next) = (at(src, p), at(src, p + 1));
        if c == b'(' && next == b';' {
            depth += 1;
            p += 2;
        } else if c == b';' && next == b')' {
            depth -= 1;
            p += 2;
            if depth == 0 {
                return p;
            }
        } else {
            p += 1;
        }
    }
}

/// The end of the escape at backslash `p`: one character, kept whole when
/// it is UTF-8, and CRLF as one (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(src: &[u8], p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(src, p + 2, end);
    if e == p + 2 && at(src, p + 1) == b'\r' && e < end && at(src, e) == b'\n' {
        e += 1;
    }
    e
}

/// The one-line `"` literal at `p`, with escapes as their own tokens.
/// Returns the end (`$lexString`, `$lexStringBody`).
#[inline(never)]
fn string(src: &[u8], mut recs: Recs, p: usize, end: usize) -> (Recs, usize) {
    let mut seg = p;
    let mut p = p + 1;
    loop {
        p = scan::string_special(src, p, end, b'"');
        if p >= end {
            break;
        }
        let c = at(src, p);
        if c == b'"' {
            p += 1;
            break;
        }
        if c != b'\\' {
            // a raw line break: unterminated, left unconsumed
            break;
        }
        if seg < p {
            recs.tok(tok::STRING, p);
        }
        let e = escape_end(src, p, end);
        recs.tok(tok::STRING_ESCAPE, e);
        p = e;
        seg = p;
    }
    if seg < p {
        recs.tok(tok::STRING, p);
    }
    (recs, p)
}

/// Lex the WebAssembly text input of `len` bytes at `base` (`$hlWat`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, which is not
    // reallocated while this lexer runs.
    let src: &[u8] = unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) };
    let end = len;

    // Records are written through `cur`, which moves along
    // `inst.ext.recs`'s buffer from `rp` to at most `limit`; `last` is the
    // last record's token, or `u32::MAX`.
    let mut rp = inst.ext.recs.as_mut_ptr();
    // SAFETY: `len` records are written.
    let mut cur = unsafe { rp.add(inst.ext.recs.len()) };
    // SAFETY: one past the allocation.
    let mut limit = unsafe { rp.add(inst.ext.recs.capacity()) };
    let mut last = inst.ext.recs.last().map_or(u32::MAX, |r| r.token);
    // Append a non-empty token ending at `end`, merging it into the last
    // record when the token matches (`$emitTok`). Running out of room
    // means a lexer bug, which traps.
    macro_rules! emit {
        ($hl:expr, $end:expr $(,)?) => {{
            let hl: u32 = $hl;
            // SAFETY: `cur` stays within `rp..limit`; a merge rewrites the
            // last record.
            unsafe {
                cur = cur.sub((last == hl) as usize);
                if cur == limit {
                    crate::rt::trap();
                }
                cur.write(Rec {
                    end: $end as u32,
                    token: hl,
                });
                cur = cur.add(1);
            }
            last = hl;
        }};
    }
    // Whitespace `[lhs, rhs)` extends the last record (`$emitGap`).
    macro_rules! gap {
        ($lhs:expr, $rhs:expr) => {{
            let (lhs, rhs): (usize, usize) = ($lhs, $rhs);
            if lhs < rhs {
                if cur == rp {
                    emit!(tok::NONE, rhs);
                } else {
                    // SAFETY: the record before `cur` is written.
                    unsafe { (*cur.sub(1)).end = rhs as u32 };
                }
            }
        }};
    }
    // Whitespace up to `rhs` extends the last record, which exists.
    macro_rules! extend {
        ($rhs:expr) => {{
            debug_assert!(cur > rp);
            // SAFETY: a record precedes every gap after the first token.
            unsafe { (*cur.sub(1)).end = $rhs as u32 };
        }};
    }
    // Run an out-of-line helper that writes its records through `Recs`.
    macro_rules! with_recs {
        (|$recs:ident| $call:expr) => {{
            // SAFETY: the records before `cur` are written.
            unsafe { inst.ext.recs.set_len(cur.offset_from(rp) as usize) };
            let $recs = Recs::load(inst);
            let ($recs, p) = $call;
            $recs.store(inst);
            rp = inst.ext.recs.as_mut_ptr();
            // SAFETY: `len` records are written.
            cur = unsafe { rp.add(inst.ext.recs.len()) };
            // SAFETY: one past the allocation.
            limit = unsafe { rp.add(inst.ext.recs.capacity()) };
            last = inst.ext.recs.last().map_or(u32::MAX, |r| r.token);
            p
        }};
    }

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src, 0, end);
    gap!(0, ptr);
    // Leading whitespace; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    gap!(ptr, first);
    ptr = first;

    loop {
        let s = at(src, ptr);
        if s == b' ' && !is_space(at(src, ptr + 1)) {
            // one space
            ptr += 1;
            extend!(ptr);
        } else if is_space(s) {
            ptr = whitespace_end(src, ptr + 1);
            extend!(ptr);
        }
        let lhs = ptr;
        let c = at(src, ptr);
        let next = at(src, ptr + 1);

        let class = CLASS[c as usize];
        // Words, the most common tokens, skip the jump table.
        if class == class::WORD {
            let dot;
            (ptr, dot) = name_end(src, ptr + 1, end);
            // (the scan starts after the first byte, which may be `.`)
            emit!(word_hl(src, lhs, ptr, dot || c == b'.'), ptr);
            // a `)` right after the word: its rule runs here
            if at(src, ptr) == b')' {
                ptr += 1;
                while at(src, ptr) == b')' {
                    ptr += 1;
                }
                emit!(tok::PUNCTUATION_BRACKET, ptr);
            }
            continue;
        }
        // `$` names too
        if class == class::DOLLAR {
            ptr = name_end(src, ptr + 1, end).0;
            emit!(tok::VARIABLE, ptr);
            // a `)` right after the name: its rule runs here
            if at(src, ptr) == b')' {
                ptr += 1;
                while at(src, ptr) == b')' {
                    ptr += 1;
                }
                emit!(tok::PUNCTUATION_BRACKET, ptr);
            }
            continue;
        }
        // `(`, as common as words, skips it too
        if c == b'(' && next != b';' {
            ptr += 1;
            emit!(tok::PUNCTUATION_BRACKET, ptr);
            continue;
        }
        match class {
            class::SEMICOLON if next == b';' => {
                // `$lexLineComment`, `$scanToLineEnd`
                ptr = scan::line_end(src, ptr + 2, end);
                emit!(tok::COMMENT, ptr);
            }
            class::OPEN_PAREN if next == b';' => {
                ptr = block_comment_end(src, ptr, end);
                emit!(tok::COMMENT, ptr);
            }
            class::QUOTE => {
                ptr = with_recs!(|recs| string(src, recs, ptr, end));
            }
            class::OPEN_PAREN | class::CLOSE_PAREN => {
                ptr += 1;
                // a run of `)` is one record: equal colors merge
                while at(src, ptr) == b')' {
                    ptr += 1;
                }
                emit!(tok::PUNCTUATION_BRACKET, ptr);
            }
            class::SEMICOLON => {
                ptr += 1;
                emit!(tok::PUNCTUATION_DELIMITER, ptr);
            }
            class::NUL if ptr >= end => break,
            _ => {
                // the word run always advances: whitespace, quotes, parens,
                // and `;` are consumed by the rules above
                let dot;
                (ptr, dot) = name_end(src, ptr + 1, end);
                // (the scan starts after the first byte, which may be `.`)
                emit!(word_hl(src, lhs, ptr, dot || c == b'.'), ptr);
            }
        }
    }
    // SAFETY: the records before `cur` are written.
    unsafe { inst.ext.recs.set_len(cur.offset_from(rp) as usize) };
}
