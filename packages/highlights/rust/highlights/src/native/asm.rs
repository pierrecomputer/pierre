//! WAT sources: src/langs/asm.wat src/common.wat src/scan.wat
//!
//! Native assembly highlighter. One pass over the input: each token is
//! scanned and colored in the same step, with the same rules, in the same
//! order, as the translated `$hlAsm`. The records equal the translated
//! lexer's records.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "asm" => Some(highlight),
        _ => None,
    }
}

/// Byte classes for the main dispatch.
mod class {
    /// An identifier start other than `$`.
    pub const IDENT: u8 = 0;
    pub const DIGIT: u8 = 1;
    pub const SLASH: u8 = 2;
    pub const SEMICOLON: u8 = 3;
    pub const HASH: u8 = 4;
    pub const DOLLAR: u8 = 5;
    pub const PERCENT: u8 = 6;
    /// `"` or `'`.
    pub const QUOTE: u8 = 7;
    pub const DOT: u8 = 8;
    /// `(`, `)`, `[`, `]`.
    pub const BRACKET: u8 = 9;
    /// `,` or `:`.
    pub const DELIMITER: u8 = 10;
    /// Anything else: one byte colored `operator`.
    pub const OTHER: u8 = 11;
    /// NUL: the end of the input, or one operator byte inside it.
    pub const NUL: u8 = 12;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    t[0] = class::NUL;
    let mut c = 1;
    while c < 256 {
        let b = c as u8;
        t[c] = match b {
            b'$' => class::DOLLAR,
            _ if is_ident_start(b) => class::IDENT,
            _ if is_digit(b) => class::DIGIT,
            b'/' => class::SLASH,
            b';' => class::SEMICOLON,
            b'#' => class::HASH,
            b'%' => class::PERCENT,
            b'"' | b'\'' => class::QUOTE,
            b'.' => class::DOT,
            b'(' | b')' | b'[' | b']' => class::BRACKET,
            b',' | b':' => class::DELIMITER,
            _ => class::OTHER,
        };
        c += 1;
    }
    t
};

/// Identifier bytes (`$lexIsIdentContinue`).
static IDENT_CONT: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = is_ident_start(c as u8) || is_digit(c as u8);
        c += 1;
    }
    t
};

/// The byte at `i`, or 0 at and past `end`.
#[inline(always)]
fn byte(src: Input, i: usize, end: usize) -> u8 {
    // SAFETY: `i` is before the input end (tested first).
    if i < end {
        unsafe { src.byte_unchecked(i) }
    } else {
        0
    }
}

/// Whether `c` is an ASCII digit (`$lexIsDigit`).
#[inline(always)]
const fn is_digit(c: u8) -> bool {
    c.wrapping_sub(b'0') <= 9
}

/// Whether `c` starts an identifier: a letter, `_`, `$`, or any byte from
/// 0x80 (`$lexIsIdentStart`).
#[inline(always)]
const fn is_ident_start(c: u8) -> bool {
    c >= 0x80 || (c | 32).wrapping_sub(b'a') <= 25 || c == b'_' || c == b'$'
}

/// Whether `c` is ASCII whitespace: space or TAB through CR (`$lexIsSpace`).
#[inline(always)]
const fn is_space(c: u8) -> bool {
    c == b' ' || c.wrapping_sub(9) <= 4
}

/// The end of the whitespace run from `p` (`$scanWhitespace`), and whether
/// it holds a line break. The NUL after the input ends every run.
#[inline(always)]
fn whitespace_end(src: Input, mut p: usize) -> (usize, bool) {
    let mut brk = false;
    loop {
        // SAFETY: `p` starts at or before the input end, and the NUL there
        // ends the run, so `p` never passes it; 8 bytes from there stay
        // inside the slack.
        let c = unsafe { src.byte_unchecked(p) };
        if c == b' ' {
            // Skip spaces 8 bytes at a time.
            // SAFETY: as above.
            let w = unsafe { src.word_unchecked(p) };
            let x = w ^ 0x2020_2020_2020_2020;
            let other =
                (((x & 0x7f7f_7f7f_7f7f_7f7f) + 0x7f7f_7f7f_7f7f_7f7f) | x) & 0x8080_8080_8080_8080;
            p += if other == 0 {
                8
            } else {
                (other.trailing_zeros() / 8) as usize
            };
        } else if c.wrapping_sub(9) <= 4 {
            // TAB through CR, one at a time
            brk |= c == b'\n' || c == b'\r';
            p += 1;
        } else {
            return (p, brk);
        }
    }
}

/// The end of the identifier run from `p`: `[A-Za-z0-9_$]` and bytes from
/// 0x80 (`$lexScanIdent`, `$scanIdentRun`). The NUL after the input ends
/// every run.
#[inline(always)]
fn ident_end(src: Input, mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..8 {
        // SAFETY: `p` starts at or before the input end, and the NUL there
        // ends the run, so `p` never passes it.
        if !IDENT_CONT[unsafe { src.byte_unchecked(p) } as usize] {
            return p;
        }
        p += 1;
    }
    loop {
        // SAFETY: as above; 16 bytes from at most the input end stay inside
        // the slack.
        let v = unsafe { src.vec_unchecked(p) };
        let alpha = v.or(V::splat(0x20)).sub(V::splat(b'a')).le(V::splat(25));
        let digit = v.sub(V::splat(b'0')).le(V::splat(9));
        let extra = v.eq(V::splat(b'_')).or(v.eq(V::splat(b'$')));
        let ok = alpha.or(digit).or(extra.or(v.high()));
        let k = ok.not().first();
        if k < 16 {
            return p + k;
        }
        p += 16;
    }
}

/// Skip spaces and tabs from `p` on the current line (`$lexSkipSpaceAt`).
#[inline(always)]
fn skip_space_at(src: Input, mut p: usize) -> usize {
    // SAFETY: `p` starts at or before the input end, and the NUL there
    // ends the run.
    while unsafe { src.byte_unchecked(p) } == b' ' || unsafe { src.byte_unchecked(p) } == b'\t' {
        p += 1;
    }
    p
}

/// The end of the number body from `p`: radix digits, separators,
/// exponents, and suffixes, with `.` only before a digit (`$lexScanNumber`,
/// `$lexScanNumberBody`).
fn number_end(src: Input, mut p: usize) -> usize {
    // SAFETY: `p` starts at or before the input end, and the NUL there
    // ends the number, so every read is at most one byte past it.
    let hex = unsafe { src.byte_unchecked(p) } == b'0'
        && unsafe { src.byte_unchecked(p + 1) } | 0x20 == b'x';
    let mut prev = 0u8;
    loop {
        // SAFETY: as above.
        let c = unsafe { src.byte_unchecked(p) };
        if IDENT_CONT[c as usize] {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            // SAFETY: as above.
            let next = unsafe { src.byte_unchecked(p + 1) };
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

/// The four bytes at `p` as a little-endian integer. The input slack covers
/// the read past a short name.
#[inline(always)]
fn load32(src: Input, p: usize) -> u32 {
    // SAFETY: `p` is a name's start, before the input end, so the 8 bytes
    // read stay inside the slack.
    (unsafe { src.word_unchecked(p) }) as u32
}

/// `s` (up to four bytes) as a little-endian integer.
const fn word(s: &[u8]) -> u32 {
    let mut w = 0u32;
    let mut i = 0;
    while i < s.len() {
        w |= (s[i] as u32) << (8 * i);
        i += 1;
    }
    w
}

/// Whether `[lhs, rhs)` names a machine register (`$asmIsRegister`): the
/// WAT's tests in its order, on bytes lowered by OR-ing in 0x20.
fn is_register(src: Input, lhs: usize, rhs: usize) -> bool {
    let n = rhs - lhs;
    // SAFETY: `lhs` is a name's start, before the input end, so every read
    // here (at most `lhs + 3`) stays inside the slack.
    let c = unsafe { src.byte_unchecked(lhs) } | 32;
    if n > 1
        && (c == b'r' || c == b'x' || c == b'w')
        // SAFETY: as above.
        && is_digit(unsafe { src.byte_unchecked(lhs + 1) })
    {
        return true;
    }
    // RISC-V argument, temporary and saved registers: one letter and one or
    // two digits
    if n.wrapping_sub(2) <= 1
        && (c == b'a' || c == b't' || c == b's')
        // SAFETY: as above.
        && is_digit(unsafe { src.byte_unchecked(lhs + 1) })
        // SAFETY: as above.
        && (n == 2 || is_digit(unsafe { src.byte_unchecked(lhs + 2) }))
    {
        return true;
    }
    let mut w = load32(src, lhs) | 0x2020_2020;
    // vector registers: `xmm0`..`zmm31`
    if n.wrapping_sub(4) <= 1
        && w & 0x00ff_ff00 == 0x006d_6d00
        && c.wrapping_sub(b'x') <= 2
        // SAFETY: as above.
        && is_digit(unsafe { src.byte_unchecked(lhs + 3) })
    {
        return true;
    }
    if n > 3 {
        return n == 4 && w == word(b"zero");
    }
    if n == 2 {
        w &= 0xffff;
        // x86 `al`/`ah`/`ax` through `dl`/`dh`/`dx`
        let second = w >> 8;
        if c.wrapping_sub(b'a') <= 3
            && (second == b'x' as u32 || second == b'l' as u32 || second == b'h' as u32)
        {
            return true;
        }
        // x86 segment registers `cs`, `ds`, `es`, `fs`, `gs`, `ss`
        if second == b's' as u32 && (c.wrapping_sub(b'c') <= 4 || c == b's') {
            return true;
        }
        return [
            b"sp", b"fp", b"lr", b"pc", b"si", b"di", b"bp", b"ra", b"gp", b"tp",
        ]
        .iter()
        .any(|r| w == word(*r));
    }
    if n != 3 {
        return false;
    }
    // without the `e`/`r` prefix, only the x86-64 low bytes of the index and
    // pointer registers remain
    if c != b'e' && c != b'r' {
        w &= 0xff_ffff;
        return [b"sil", b"dil", b"spl", b"bpl"]
            .iter()
            .any(|r| w == word(*r));
    }
    // the two bytes after the `e`/`r` prefix
    w = (w >> 8) & 0xffff;
    [
        b"ax", b"bx", b"cx", b"dx", b"si", b"di", b"bp", b"sp", b"ip",
    ]
    .iter()
    .any(|r| w == word(*r))
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

/// The one-line quoted literal whose `quote` is at `p`, with escapes as
/// their own tokens. Returns the end (`$lexString`, `$lexStringBody`).
#[inline(never)]
fn string(src: Input, mut recs: Recs, p: usize, end: usize, quote: u8) -> (Recs, usize) {
    let mut seg = p;
    let mut p = p + 1;
    loop {
        p = scan::string_special(src.bytes(), p, end, quote);
        if p >= end {
            break;
        }
        // SAFETY: `p` is before the input end (tested above).
        let c = unsafe { src.byte_unchecked(p) };
        if c == quote {
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

/// Lex the assembly input of `len` bytes at `base` (`$hlAsm`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: `base..base + len + SLACK` lies inside lexer memory, which
    // nothing moves while this lexer runs (it calls no translated code).
    let src = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut recs = Recs::load(inst);

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src.bytes(), 0, end);
    recs.gap(0, ptr);
    // the next word is in mnemonic position (a statement starts)
    let mut expect_mnemonic = true;
    // Leading whitespace; every later gap follows a token's record.
    let (first, brk) = whitespace_end(src, ptr);
    if brk {
        expect_mnemonic = true;
    }
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
            // SAFETY: every pass of this loop writes a record or ends it, and
            // the first pass starts after the leading whitespace.
            unsafe { recs.extend_unchecked(ptr) };
        } else if is_space(s) {
            // a line break in the gap puts the next word in mnemonic
            // position
            let (e, brk) = whitespace_end(src, ptr);
            if brk {
                expect_mnemonic = true;
            }
            ptr = e;
            // SAFETY: as above.
            unsafe { recs.extend_unchecked(ptr) };
        }
        let lhs = ptr;
        // SAFETY: `ptr` is at or before the input end.
        let c = unsafe { src.byte_unchecked(ptr) };
        // SAFETY: as above.
        let next = unsafe { src.byte_unchecked(ptr + 1) };

        let class = CLASS[c as usize];
        // Names, the most common tokens, skip the jump table.
        if class == class::IDENT {
            ptr = ident_end(src, ptr + 1);
            let p = skip_space_at(src, ptr);
            // SAFETY: the NUL at the input end stops the name and the space
            // run.
            let hl = if unsafe { src.byte_unchecked(p) } == b':' {
                tok::LABEL
            } else if expect_mnemonic {
                tok::KEYWORD
            } else if is_register(src, lhs, ptr) {
                tok::VARIABLE_SPECIAL
            } else {
                tok::VARIABLE
            };
            recs.tok(hl, ptr);
            expect_mnemonic = hl == tok::LABEL;
            continue;
        }
        match class {
            class::SLASH if next == b'*' => {
                // GNU as accepts C block comments alongside `;`, `//`, `#`
                // (`$lexBlockComment`, `$scanBlockCommentEnd`)
                ptr = scan::block_comment_end(src.bytes(), ptr + 2, end);
                recs.tok(tok::COMMENT, ptr);
            }
            class::SLASH if next == b'/' => {
                ptr = scan::line_end(src.bytes(), ptr + 2, end);
                recs.tok(tok::COMMENT, ptr);
            }
            class::HASH | class::DOLLAR
                if is_digit(next)
                    || ((next == b'+' || next == b'-') && is_digit(byte(src, ptr + 2, end))) =>
            {
                // a `#`/`$` prefixed number
                ptr += 1;
                if next == b'+' || next == b'-' {
                    ptr += 1;
                }
                ptr = number_end(src, ptr);
                recs.tok(tok::NUMBER, ptr);
                expect_mnemonic = false;
            }
            class::SEMICOLON | class::HASH => {
                // `$lexLineComment`, `$scanToLineEnd`
                ptr = scan::line_end(src.bytes(), ptr + 1, end);
                recs.tok(tok::COMMENT, ptr);
            }
            class::QUOTE => {
                (recs, ptr) = string(src, recs, ptr, end, c);
                expect_mnemonic = false;
            }
            class::DIGIT => {
                ptr = number_end(src, ptr + 1);
                // a digit run opening a statement with a `:` glued on is a
                // GNU as local label, `1:  jmp 1b`, and like any label leaves
                // the mnemonic position open
                // SAFETY: the NUL at the input end stops the number.
                if expect_mnemonic && unsafe { src.byte_unchecked(ptr) } == b':' {
                    recs.tok(tok::LABEL, ptr);
                } else {
                    recs.tok(tok::NUMBER, ptr);
                    expect_mnemonic = false;
                }
            }
            class::PERCENT | class::DOLLAR => {
                ptr = ident_end(src, ptr + 1);
                recs.tok(tok::VARIABLE_SPECIAL, ptr);
                expect_mnemonic = false;
            }
            class::DOT => {
                ptr = ident_end(src, ptr + 1);
                let p = skip_space_at(src, ptr);
                // SAFETY: the NUL at the input end stops the name and the
                // space run.
                let label = unsafe { src.byte_unchecked(p) } == b':';
                recs.tok(if label { tok::LABEL } else { tok::PREPROC }, ptr);
                expect_mnemonic = label;
            }
            class::BRACKET => {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
            }
            class::DELIMITER => {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
            }
            class::NUL if ptr >= end => break,
            _ => {
                // any other byte is an operator
                ptr += 1;
                recs.tok(tok::OPERATOR, ptr);
            }
        }
    }
    recs.store(inst);
}
