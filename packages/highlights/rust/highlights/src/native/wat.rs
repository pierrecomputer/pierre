//! WAT sources: src/langs/wat.wat src/common.wat src/scan.wat
//!
//! Native WebAssembly text highlighter. One pass over the input: each token
//! is scanned and colored in the same step, with the same rules, in the
//! same order, as the translated `$hlWat`. The records equal the translated
//! lexer's records.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
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
fn word_group(src: Input, lhs: usize, rhs: usize) -> u8 {
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
fn whitespace_end(src: Input, mut p: usize) -> usize {
    loop {
        // SAFETY: `p` starts at or before the input end, and the NUL there
        // ends the run, so `p` never passes it; 16 bytes from there stay
        // inside the slack.
        let c = unsafe { src.byte_unchecked(p) };
        if c == b' ' {
            // Skip spaces 16 bytes at a time (indentation runs long).
            // SAFETY: as above.
            let w = unsafe { src.vec_unchecked(p) };
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
fn name_end(src: Input, mut p: usize, end: usize) -> (usize, bool) {
    let mut dot = false;
    // Most names are short: test a few bytes one by one first.
    for _ in 0..12 {
        // SAFETY: `p` starts at or before the input end, and the NUL there
        // stops the scan, so `p` never passes it.
        let c = unsafe { src.byte_unchecked(p) };
        // (a NUL inside the input is a name byte)
        if NAME_STOP[c as usize] && (c != 0 || p >= end) {
            return (p.min(end), dot);
        }
        dot |= c == b'.';
        p += 1;
    }
    loop {
        // SAFETY: `p` is at or before the input end (a load that reaches it
        // returns), so 16 bytes from there stay inside the slack.
        let w = unsafe { src.vec_unchecked(p) };
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

/// The first `n` bytes at `p` as a little-endian integer.
#[inline(always)]
fn word_at(src: Input, p: usize, n: u32) -> u64 {
    // SAFETY: every caller passes a position at or before the input end,
    // so the 8 bytes stay inside the slack.
    (unsafe { src.word_unchecked(p) }) & (u64::MAX >> (64 - 8 * n))
}

/// The color of the bare word `[lhs, rhs)`, which holds a `.` when `dot`:
/// a number (with its sign, `inf`, `nan`, or a NaN payload), a table word,
/// a dotted instruction (a function), or a keyword (`$watWordHl`).
fn word_hl(src: Input, lhs: usize, rhs: usize, dot: bool) -> u32 {
    let mut p = lhs;
    // SAFETY: the word lies inside the input, so every read here, at most
    // `rhs`, is at or before the input end.
    let c = unsafe { src.byte_unchecked(p) };
    if c == b'+' || c == b'-' {
        p += 1;
    }
    // SAFETY: as above.
    if p < rhs && is_digit(unsafe { src.byte_unchecked(p) }) {
        return tok::NUMBER;
    }
    let w3 = word_at(src, p, 3);
    if rhs - p == 3 && (w3 == word(b"inf") || w3 == word(b"nan")) {
        return tok::NUMBER;
    }
    if rhs - p > 6 && word_at(src, p, 6) == word(b"nan:0x") {
        p += 6;
        loop {
            // SAFETY: as above.
            if !is_hex(unsafe { src.byte_unchecked(p) }) {
                break;
            }
            p += 1;
            if p == rhs {
                return tok::NUMBER;
            }
            // SAFETY: as above.
            if unsafe { src.byte_unchecked(p) } == b'_' {
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
fn block_comment_end(src: Input, p: usize, end: usize) -> usize {
    let mut depth = 1u32;
    let mut p = p + 2;
    loop {
        // `$lexFindEither`
        p = scan::find3(src.bytes(), p, end, b'(', b';', b'(');
        if p >= end {
            return end;
        }
        // SAFETY: `p` is before the input end (tested above).
        let (c, next) = unsafe { (src.byte_unchecked(p), src.byte_unchecked(p + 1)) };
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
fn escape_end(src: Input, p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(src.bytes(), p + 2, end);
    if e == p + 2 && src.byte(p + 1) == b'\r' && e < end && src.byte(e) == b'\n' {
        e += 1;
    }
    e
}

/// The one-line `"` literal at `p`, with escapes as their own tokens.
/// Returns the end (`$lexString`, `$lexStringBody`).
#[inline(never)]
fn string(src: Input, mut recs: Recs, p: usize, end: usize) -> (Recs, usize) {
    let mut seg = p;
    let mut p = p + 1;
    loop {
        p = scan::string_special(src.bytes(), p, end, b'"');
        if p >= end {
            break;
        }
        // SAFETY: `p` is before the input end (tested above).
        let c = unsafe { src.byte_unchecked(p) };
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
    // SAFETY: `base..base + len + SLACK` lies inside lexer memory, which
    // nothing moves while this lexer runs (it calls no translated code).
    let src = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut recs = Recs::load(inst);

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src.bytes(), 0, end);
    recs.gap(0, ptr);
    // Leading whitespace; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    recs.gap(ptr, first);
    ptr = first;

    // `ptr` never passes the input end: every scan stops at the NUL there.
    loop {
        // SAFETY: `ptr` is at or before the input end (see above).
        let s = unsafe { src.byte_unchecked(ptr) };
        // SAFETY: as above.
        if s == b' ' && !is_space(unsafe { src.byte_unchecked(ptr + 1) }) {
            // one space
            ptr += 1;
            // SAFETY: every pass of this loop writes a record or ends it,
            // and the first pass starts after the leading whitespace.
            unsafe { recs.extend_unchecked(ptr) };
        } else if is_space(s) {
            ptr = whitespace_end(src, ptr + 1);
            // SAFETY: as above.
            unsafe { recs.extend_unchecked(ptr) };
        }
        let lhs = ptr;
        // SAFETY: `ptr` is at or before the input end.
        let c = unsafe { src.byte_unchecked(ptr) };
        // SAFETY: as above.
        let next = unsafe { src.byte_unchecked(ptr + 1) };

        let class = CLASS[c as usize];
        // Words, the most common tokens, skip the jump table.
        if class == class::WORD {
            let dot;
            (ptr, dot) = name_end(src, ptr + 1, end);
            // (the scan starts after the first byte, which may be `.`)
            recs.tok(word_hl(src, lhs, ptr, dot || c == b'.'), ptr);
            // a `)` right after the word: its rule runs here
            // SAFETY: names end at or before the input end.
            if unsafe { src.byte_unchecked(ptr) } == b')' {
                ptr += 1;
                // SAFETY: a run of `)` stops at the NUL after the input.
                while unsafe { src.byte_unchecked(ptr) } == b')' {
                    ptr += 1;
                }
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
            }
            continue;
        }
        // `$` names too
        if class == class::DOLLAR {
            ptr = name_end(src, ptr + 1, end).0;
            recs.tok(tok::VARIABLE, ptr);
            // a `)` right after the name: its rule runs here
            // SAFETY: names end at or before the input end.
            if unsafe { src.byte_unchecked(ptr) } == b')' {
                ptr += 1;
                // SAFETY: a run of `)` stops at the NUL after the input.
                while unsafe { src.byte_unchecked(ptr) } == b')' {
                    ptr += 1;
                }
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
            }
            continue;
        }
        // `(`, as common as words, skips it too
        if c == b'(' && next != b';' {
            ptr += 1;
            recs.tok(tok::PUNCTUATION_BRACKET, ptr);
            continue;
        }
        match class {
            class::SEMICOLON if next == b';' => {
                // `$lexLineComment`, `$scanToLineEnd`
                ptr = scan::line_end(src.bytes(), ptr + 2, end);
                recs.tok(tok::COMMENT, ptr);
            }
            class::OPEN_PAREN if next == b';' => {
                ptr = block_comment_end(src, ptr, end);
                recs.tok(tok::COMMENT, ptr);
            }
            class::QUOTE => {
                (recs, ptr) = string(src, recs, ptr, end);
            }
            class::OPEN_PAREN | class::CLOSE_PAREN => {
                ptr += 1;
                // a run of `)` is one record: equal colors merge
                // SAFETY: the run stops at the NUL after the input.
                while unsafe { src.byte_unchecked(ptr) } == b')' {
                    ptr += 1;
                }
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
            }
            class::SEMICOLON => {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
            }
            class::NUL if ptr >= end => break,
            _ => {
                // the word run always advances: whitespace, quotes, parens,
                // and `;` are consumed by the rules above
                let dot;
                (ptr, dot) = name_end(src, ptr + 1, end);
                // (the scan starts after the first byte, which may be `.`)
                recs.tok(word_hl(src, lhs, ptr, dot || c == b'.'), ptr);
            }
        }
    }
    recs.store(inst);
}
