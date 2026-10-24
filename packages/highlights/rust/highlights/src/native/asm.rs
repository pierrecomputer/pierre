//! WAT sources: src/langs/asm.wat src/common.wat src/scan.wat
//!
//! Native assembly highlighter. One pass over the input: each token is
//! scanned and colored in the same step, with the same rules, in the same
//! order, as the translated `$hlAsm`. The records equal the translated
//! lexer's records.

use super::Lexer;
use super::recs::Recs;
use super::scan;
use crate::Rec;
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

/// The byte at `i`. Every caller reads at most 16 bytes past the input
/// end, which the 96-byte input slack covers. The byte at the input end is
/// NUL, which matches none of the bytes a lookahead tests.
#[inline(always)]
fn at(src: &[u8], i: usize) -> u8 {
    debug_assert!(i < src.len());
    // SAFETY: `i` lies inside the input or its slack (see above).
    unsafe { *src.get_unchecked(i) }
}

/// The byte at `i`, or 0 at and past `end`.
#[inline(always)]
fn byte(src: &[u8], i: usize, end: usize) -> u8 {
    if i < end { at(src, i) } else { 0 }
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
fn whitespace_end(src: &[u8], mut p: usize) -> (usize, bool) {
    let mut brk = false;
    loop {
        let c = at(src, p);
        if c == b' ' {
            // Skip spaces 8 bytes at a time.
            // SAFETY: `p` lies before the NUL after the input, so the
            // 8-byte read stays inside the slack.
            let w = unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() };
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
fn ident_end(src: &[u8], mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..8 {
        if !IDENT_CONT[at(src, p) as usize] {
            return p;
        }
        p += 1;
    }
    loop {
        // SAFETY: each 16-byte load starts at or before the NUL after the
        // input, inside the slack.
        let v = unsafe { V::load(src.as_ptr().add(p)) };
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
fn skip_space_at(src: &[u8], mut p: usize) -> usize {
    while at(src, p) == b' ' || at(src, p) == b'\t' {
        p += 1;
    }
    p
}

/// The end of the number body from `p`: radix digits, separators,
/// exponents, and suffixes, with `.` only before a digit (`$lexScanNumber`,
/// `$lexScanNumberBody`).
fn number_end(src: &[u8], mut p: usize) -> usize {
    let hex = at(src, p) == b'0' && at(src, p + 1) | 0x20 == b'x';
    let mut prev = 0u8;
    loop {
        let c = at(src, p);
        if IDENT_CONT[c as usize] {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            let next = at(src, p + 1);
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
fn load32(src: &[u8], p: usize) -> u32 {
    debug_assert!(p + 4 <= src.len());
    // SAFETY: `p` lies before the input end, so `p + 4` lies inside the
    // slack.
    unsafe { src.as_ptr().add(p).cast::<u32>().read_unaligned() }
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
fn is_register(src: &[u8], lhs: usize, rhs: usize) -> bool {
    let n = rhs - lhs;
    let c = at(src, lhs) | 32;
    if n > 1 && (c == b'r' || c == b'x' || c == b'w') && is_digit(at(src, lhs + 1)) {
        return true;
    }
    // RISC-V argument, temporary and saved registers: one letter and one or
    // two digits
    if n.wrapping_sub(2) <= 1
        && (c == b'a' || c == b't' || c == b's')
        && is_digit(at(src, lhs + 1))
        && (n == 2 || is_digit(at(src, lhs + 2)))
    {
        return true;
    }
    let mut w = load32(src, lhs) | 0x2020_2020;
    // vector registers: `xmm0`..`zmm31`
    if n.wrapping_sub(4) <= 1
        && w & 0x00ff_ff00 == 0x006d_6d00
        && c.wrapping_sub(b'x') <= 2
        && is_digit(at(src, lhs + 3))
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
fn escape_end(src: &[u8], p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(src, p + 2, end);
    if e == p + 2 && at(src, p + 1) == b'\r' && e < end && at(src, e) == b'\n' {
        e += 1;
    }
    e
}

/// The one-line quoted literal whose `quote` is at `p`, with escapes as
/// their own tokens. Returns the end (`$lexString`, `$lexStringBody`).
#[inline(never)]
fn string(src: &[u8], mut recs: Recs, p: usize, end: usize, quote: u8) -> (Recs, usize) {
    let mut seg = p;
    let mut p = p + 1;
    loop {
        p = scan::string_special(src, p, end, quote);
        if p >= end {
            break;
        }
        let c = at(src, p);
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
    // the next word is in mnemonic position (a statement starts)
    let mut expect_mnemonic = true;
    // Leading whitespace; every later gap follows a token's record.
    let (first, brk) = whitespace_end(src, ptr);
    if brk {
        expect_mnemonic = true;
    }
    gap!(ptr, first);
    ptr = first;

    loop {
        let s = at(src, ptr);
        if s == b' ' && !is_space(at(src, ptr + 1)) {
            // one space
            ptr += 1;
            extend!(ptr);
        } else if is_space(s) {
            // a line break in the gap puts the next word in mnemonic
            // position
            let (e, brk) = whitespace_end(src, ptr);
            if brk {
                expect_mnemonic = true;
            }
            ptr = e;
            extend!(ptr);
        }
        let lhs = ptr;
        let c = at(src, ptr);
        let next = at(src, ptr + 1);

        let class = CLASS[c as usize];
        // Names, the most common tokens, skip the jump table.
        if class == class::IDENT {
            ptr = ident_end(src, ptr + 1);
            let p = skip_space_at(src, ptr);
            let hl = if at(src, p) == b':' {
                tok::LABEL
            } else if expect_mnemonic {
                tok::KEYWORD
            } else if is_register(src, lhs, ptr) {
                tok::VARIABLE_SPECIAL
            } else {
                tok::VARIABLE
            };
            emit!(hl, ptr);
            expect_mnemonic = hl == tok::LABEL;
            continue;
        }
        match class {
            class::SLASH if next == b'*' => {
                // GNU as accepts C block comments alongside `;`, `//`, `#`
                // (`$lexBlockComment`, `$scanBlockCommentEnd`)
                ptr = scan::block_comment_end(src, ptr + 2, end);
                emit!(tok::COMMENT, ptr);
            }
            class::SLASH if next == b'/' => {
                ptr = scan::line_end(src, ptr + 2, end);
                emit!(tok::COMMENT, ptr);
            }
            class::HASH | class::DOLLAR
                if is_digit(next)
                    || ((next == b'+' || next == b'-') && is_digit(byte(src, ptr + 2, end))) =>
            {
                // a `#`/`$` prefixed number
                ptr += 1;
                if at(src, ptr) == b'+' || at(src, ptr) == b'-' {
                    ptr += 1;
                }
                ptr = number_end(src, ptr);
                emit!(tok::NUMBER, ptr);
                expect_mnemonic = false;
            }
            class::SEMICOLON | class::HASH => {
                // `$lexLineComment`, `$scanToLineEnd`
                ptr = scan::line_end(src, ptr + 1, end);
                emit!(tok::COMMENT, ptr);
            }
            class::QUOTE => {
                ptr = with_recs!(|recs| string(src, recs, ptr, end, c));
                expect_mnemonic = false;
            }
            class::DIGIT => {
                ptr = number_end(src, ptr + 1);
                // a digit run opening a statement with a `:` glued on is a
                // GNU as local label, `1:  jmp 1b`, and like any label leaves
                // the mnemonic position open
                if expect_mnemonic && at(src, ptr) == b':' {
                    emit!(tok::LABEL, ptr);
                } else {
                    emit!(tok::NUMBER, ptr);
                    expect_mnemonic = false;
                }
            }
            class::PERCENT | class::DOLLAR => {
                ptr = ident_end(src, ptr + 1);
                emit!(tok::VARIABLE_SPECIAL, ptr);
                expect_mnemonic = false;
            }
            class::DOT => {
                ptr = ident_end(src, ptr + 1);
                let p = skip_space_at(src, ptr);
                let label = at(src, p) == b':';
                emit!(if label { tok::LABEL } else { tok::PREPROC }, ptr);
                expect_mnemonic = label;
            }
            class::BRACKET => {
                ptr += 1;
                emit!(tok::PUNCTUATION_BRACKET, ptr);
            }
            class::DELIMITER => {
                ptr += 1;
                emit!(tok::PUNCTUATION_DELIMITER, ptr);
            }
            class::NUL if ptr >= end => break,
            _ => {
                // any other byte is an operator
                ptr += 1;
                emit!(tok::OPERATOR, ptr);
            }
        }
    }
    // SAFETY: the records before `cur` are written.
    unsafe { inst.ext.recs.set_len(cur.offset_from(rp) as usize) };
}
