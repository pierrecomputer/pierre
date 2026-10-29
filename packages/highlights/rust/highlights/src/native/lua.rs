//! WAT sources: src/langs/lua.wat src/common.wat src/scan.wat
//!
//! Native Lua highlighter. One pass over the input with the same rules, in
//! the same order, as the translated `$hlLua`; the records equal the
//! translated lexer's records.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::LUA_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "lua" => Some(highlight),
        _ => None,
    }
}

/// Whether `c` is ASCII whitespace: space or TAB through CR (`$lexIsSpace`).
#[inline(always)]
const fn is_space(c: u8) -> bool {
    c == b' ' || c.wrapping_sub(9) <= 4
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

/// Whether `c` continues an identifier (`$lexIsIdentContinue`).
#[inline(always)]
const fn is_ident_continue(c: u8) -> bool {
    is_ident_start(c) || is_digit(c)
}

/// Whether `c` is an uppercase ASCII letter.
#[inline(always)]
const fn is_upper(c: u8) -> bool {
    c.wrapping_sub(b'A') <= 25
}

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run.
#[inline(always)]
fn whitespace_end(src: Input<'_>, mut p: usize) -> usize {
    // Most gaps are short: test a few bytes one by one first.
    for _ in 0..4 {
        // SAFETY: `p` lies at or before the NUL after the input, which
        // ends the run.
        if !is_space(unsafe { src.byte_unchecked(p) }) {
            return p;
        }
        p += 1;
    }
    loop {
        // Skip spaces 8 bytes at a time, then step over one other
        // whitespace byte (TAB to CR) and go on.
        // SAFETY: `p` lies at or before the NUL after the input, so the
        // 8-byte read stays inside the slack.
        let w = unsafe { src.word_unchecked(p) };
        let x = w ^ 0x2020_2020_2020_2020;
        let other =
            (((x & 0x7f7f_7f7f_7f7f_7f7f) + 0x7f7f_7f7f_7f7f_7f7f) | x) & 0x8080_8080_8080_8080;
        if other == 0 {
            p += 8;
            continue;
        }
        p += (other.trailing_zeros() / 8) as usize;
        // SAFETY: `p` lies inside the word just read.
        if !is_space(unsafe { src.byte_unchecked(p) }) {
            return p;
        }
        p += 1;
    }
}

/// The end of the whitespace run from `p` (`$scanWhitespace`), and
/// whether it holds a line break (`$lexGapHasBreak`). The NUL after the
/// input ends every run.
#[inline(always)]
fn whitespace_break_end(src: Input<'_>, mut p: usize) -> (usize, bool) {
    let mut brk = false;
    loop {
        // SAFETY: `p` lies at or before the NUL after the input, which
        // ends the run.
        let c = unsafe { src.byte_unchecked(p) };
        if !is_space(c) {
            return (p, brk);
        }
        brk |= c == b'\n' || c == b'\r';
        p += 1;
    }
}

/// The end of the identifier run from `p`: `[A-Za-z0-9_$]` and bytes from
/// 0x80 (`$lexScanIdent`, `$scanIdentRun`). The NUL after the input ends
/// every run.
#[inline(always)]
fn ident_end(src: Input<'_>, mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..8 {
        // SAFETY: `p` lies at or before the NUL after the input, which
        // ends the run.
        if !IDENT_CONT[unsafe { src.byte_unchecked(p) } as usize] {
            return p;
        }
        p += 1;
    }
    loop {
        // SAFETY: each load starts at or before the NUL after the input,
        // so it stays inside the slack.
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

/// Identifier bytes (`$lexIsIdentContinue`).
static IDENT_CONT: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = is_ident_continue(c as u8);
        c += 1;
    }
    t
};

/// Skip spaces and tabs from `p` on the current line (`$lexSkipSpaceAt`).
#[inline(always)]
fn skip_space_at(src: Input<'_>, mut p: usize) -> usize {
    // SAFETY: `p` lies at or before the NUL after the input, which ends
    // the run.
    while unsafe { src.byte_unchecked(p) } == b' ' || unsafe { src.byte_unchecked(p) } == b'\t' {
        p += 1;
    }
    p
}

/// The end of the number at `p` (`$lexScanNumber`, `$lexScanNumberBody`).
fn number_end(src: Input<'_>, mut p: usize) -> usize {
    // SAFETY (each read here): the number starts inside the input and
    // stops at or before the NUL after it, so `p + 1` lies inside the
    // slack.
    let hex = unsafe { src.byte_unchecked(p) } == b'0'
        && unsafe { src.byte_unchecked(p + 1) } | 0x20 == b'x';
    let mut prev = 0u8;
    loop {
        let c = unsafe { src.byte_unchecked(p) };
        if is_ident_continue(c) {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            if !is_digit(unsafe { src.byte_unchecked(p + 1) }) {
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

/// The end of the escape at backslash `p` (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(src: Input<'_>, end: usize, p: usize) -> usize {
    let mut e = scan::utf8_span_end(src.bytes(), p + 2, end);
    if e == p + 2 && src.byte(p + 1) == b'\r' && e < end && src.byte(e) == b'\n' {
        e += 1;
    }
    e
}

/// SCREAMING_CASE: at least two bytes, one uppercase letter, and only
/// `[A-Z0-9_]` (`$lexIsConstCase`).
fn is_const_case(src: Input<'_>, lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = false;
    for &c in &src.bytes()[lhs..rhs] {
        if is_upper(c) {
            upper = true;
        } else if !(is_digit(c) || c == b'_') {
            return false;
        }
    }
    upper
}

/// `$luaWords` as a perfect hash on a word's bytes: every word is at most
/// 8 bytes, read as one little-endian integer, zero past its end; words
/// hold no NUL, so equal integers mean equal words.
struct Words {
    keys: [u64; WORD_SLOTS],
    /// The word's `keyword-table.value`.
    values: [u16; WORD_SLOTS],
    mul: u64,
}

const WORD_SLOTS: usize = 64;

/// The slot of the word whose integer is `lo`.
#[inline(always)]
const fn word_slot(lo: u64, mul: u64) -> usize {
    (lo.wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros())) as usize
}

/// The integer of the word `w`.
const fn word_key(w: &[u8]) -> u64 {
    let mut lo = 0u64;
    let mut i = 0;
    while i < w.len() {
        lo |= (w[i] as u64) << (8 * i);
        i += 1;
    }
    lo
}

/// For each first byte, a bit per length of the words in [`WORDS`]. A name
/// whose bit is clear is no word.
static WORD_LENGTHS: [u16; 256] = {
    let mut t = [0u16; 256];
    let mut i = 0;
    while i < LUA_WORDS.len() {
        let w = LUA_WORDS[i].word;
        assert!(w.len() <= 8);
        t[w[0] as usize] |= 1 << w.len();
        i += 1;
    }
    t
};

/// The words, placed by searching for a multiplier that gives each its own
/// slot.
static WORDS: Words = {
    let mut mul: u64 = 0x2545_f491_4f6c_dd1d;
    let mut attempt = 0;
    'search: loop {
        assert!(attempt < 20_000, "no collision-free hash: use more slots");
        let mut keys = [0u64; WORD_SLOTS];
        let mut values = [0u16; WORD_SLOTS];
        let mut i = 0;
        while i < LUA_WORDS.len() {
            let lo = word_key(LUA_WORDS[i].word);
            let s = word_slot(lo, mul);
            if keys[s] != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            let v = LUA_WORDS[i].value;
            assert!(v >= 0 && v < 0x10000);
            keys[s] = lo;
            values[s] = v as u16;
            i += 1;
        }
        break Words { keys, values, mul };
    }
};

/// The `$luaWords` value of the word `[lhs, rhs)`, or -1
/// (`keyword-table.value`).
#[inline(always)]
fn word_value(src: Input<'_>, lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    // SAFETY: the word lies inside the input.
    if n > 8 || WORD_LENGTHS[unsafe { src.byte_unchecked(lhs) } as usize] >> n & 1 == 0 {
        return -1;
    }
    // SAFETY: `lhs` lies before the input end, so `lhs + 8` lies inside
    // the slack.
    let w = unsafe { src.word_unchecked(lhs) };
    let lo = w & (u64::MAX >> (64 - 8 * n));
    let s = word_slot(lo, WORDS.mul);
    if WORDS.keys[s] == lo {
        WORDS.values[s] as i32
    } else {
        -1
    }
}

/// Whether `c` is an ASCII hex digit (`$lexIsHex`).
#[inline(always)]
const fn is_hex(c: u8) -> bool {
    is_digit(c) || (c | 32).wrapping_sub(b'a') <= 5
}

/// The end of the number at `lhs`, with hexadecimal float fractions
/// (`$lexScanHexNumber` with no exponent required).
fn hex_number_end(src: Input<'_>, end: usize, lhs: usize) -> usize {
    let p = number_end(src, lhs);
    // SAFETY: the number starts inside the input, so `lhs + 1` lies at
    // or before its end.
    if !(unsafe { src.byte_unchecked(lhs) } == b'0'
        && unsafe { src.byte_unchecked(lhs + 1) } | 32 == b'x')
        || p >= end
    {
        return p;
    }
    // SAFETY: `p` is before the input end (tested above).
    let (c, next) = unsafe { (src.byte_unchecked(p), src.byte_unchecked(p + 1)) };
    if !(c == b'.' && (is_hex(next) || next | 32 == b'p')) {
        return p;
    }
    if next | 32 == b'p' {
        let mut q = p + 1;
        while q < end && (is_hex(src.byte(q)) || src.byte(q) == b'_') {
            q += 1;
        }
        if q >= end || src.byte(q) | 32 != b'p' {
            return p;
        }
        q += 1;
        if q < end && (src.byte(q) == b'+' || src.byte(q) == b'-') {
            q += 1;
        }
        if q >= end || !is_digit(src.byte(q)) {
            return p;
        }
    }
    number_body_end(src, p + 1, true)
}

/// The end of a number's body from `p` (`$lexScanNumberBody`). The NUL
/// after the input ends it.
fn number_body_end(src: Input<'_>, mut p: usize, hex: bool) -> usize {
    let mut prev = 0u8;
    loop {
        // SAFETY: `p` starts at or before the input end, and the NUL there
        // ends the number, so every read is at most one byte past it.
        let c = unsafe { src.byte_unchecked(p) };
        if is_ident_continue(c) {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            // SAFETY: as above.
            if !is_digit(unsafe { src.byte_unchecked(p + 1) }) {
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

/// A one-line quoted string from the `quote` at `lhs`, with escapes colored
/// apart; a raw line break ends it unconsumed (`$lexString`,
/// `$lexStringBody`).
#[inline(never)]
fn string(src: Input<'_>, end: usize, mut out: Recs, lhs: usize, quote: u8) -> (usize, Recs) {
    let mut p = lhs + 1;
    let mut seg = lhs;
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
            break;
        }
        out.emit(tok::STRING, seg, p);
        let e = escape_end(src, end, p);
        out.emit(tok::STRING_ESCAPE, p, e);
        p = e;
        seg = p;
    }
    out.emit(tok::STRING, seg, p);
    (p, out)
}

/// A long bracket `[[...]]`, `[==[...]==]` after a `prefix`-byte prefix at
/// `lhs`, colored `hl`; `None` when no long bracket opens there
/// (`$luaLong`).
#[cold]
#[inline(never)]
fn long(
    src: Input<'_>,
    end: usize,
    mut out: Recs,
    lhs: usize,
    prefix: usize,
    hl: u32,
) -> Option<(usize, Recs)> {
    let bracket = lhs + prefix;
    if bracket >= end || src.byte(bracket) != b'[' {
        return None;
    }
    let mut p = bracket + 1;
    let mut eq = 0usize;
    while p < end && src.byte(p) == b'=' {
        eq += 1;
        p += 1;
    }
    if p >= end || src.byte(p) != b'[' {
        return None;
    }
    let mut q = p + 1;
    loop {
        q = scan::find3(src.bytes(), q, end, b']', b']', b']');
        if q >= end {
            break;
        }
        let mut r = q + 1;
        let mut i = 0;
        while i < eq && r < end && src.byte(r) == b'=' {
            i += 1;
            r += 1;
        }
        if i == eq && r < end && src.byte(r) == b']' {
            q = r + 1;
            break;
        }
        q += 1;
    }
    out.emit(hl, lhs, q);
    Some((q, out))
}

/// Byte classes for the main dispatch.
mod class {
    /// A letter, `_`, `$`, or any byte from 0x80: a name.
    pub const IDENT: u8 = 0;
    /// Anything else: one byte colored `operator`.
    pub const OTHER: u8 = 1;
    pub const DIGIT: u8 = 2;
    pub const DASH: u8 = 3;
    pub const HASH: u8 = 4;
    /// `"` or `'`.
    pub const QUOTE: u8 = 5;
    pub const OPEN_SQUARE: u8 = 6;
    pub const DOT: u8 = 7;
    pub const COLON: u8 = 8;
    /// `(`, `)`, `]`, `{`, `}`.
    pub const BRACKET: u8 = 9;
    /// `,` or `;`.
    pub const DELIM: u8 = 10;
    /// NUL: the end of the input, or one byte colored `operator` inside it.
    pub const NUL: u8 = 11;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    let mut c = 1;
    t[0] = class::NUL;
    while c < 256 {
        let b = c as u8;
        t[c] = if is_ident_start(b) {
            class::IDENT
        } else if is_digit(b) {
            class::DIGIT
        } else {
            match b {
                b'-' => class::DASH,
                b'#' => class::HASH,
                b'"' | b'\'' => class::QUOTE,
                b'[' => class::OPEN_SQUARE,
                b'.' => class::DOT,
                b':' => class::COLON,
                b'(' | b')' | b']' | b'{' | b'}' => class::BRACKET,
                b',' | b';' => class::DELIM,
                _ => class::OTHER,
            }
        };
        c += 1;
    }
    t
};

/// Lex the Lua input of `len` bytes at `base` (`$hlLua`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: `base..base + len + SLACK` lies inside lexer memory, and this
    // lexer calls no translated function that could move it.
    let src = unsafe { Input::new(inst, base, len) };
    let out = lex(src, len, Recs::load(inst));
    out.store(inst);
}

/// The lexer loop (`$hlLua`), with comments (`$lexLineComment`) inline.
fn lex(src: Input<'_>, end: usize, mut out: Recs) -> Recs {
    // `$lexEmitLeadingContinuation`, then the leading whitespace.
    let lead = scan::utf8_span_end(src.bytes(), 0, end);
    out.gap(0, lead);
    let mut p = whitespace_end(src, lead);
    out.gap(lead, p);

    // after `function`: the next name is a definition
    let mut decl = false;
    // after `.` or `:`: the next name is a member
    let mut member = false;

    'next: loop {
        // The gap before the next token. Lua keeps no line state.
        // SAFETY: every rule stops at or before the input end, so `p + 1`
        // lies inside the slack.
        let c = unsafe { src.byte_unchecked(p) };
        if c == b' ' && !is_space(unsafe { src.byte_unchecked(p + 1) }) {
            p += 1;
            out.extend(p);
        } else if is_space(c) {
            p = whitespace_break_end(src, p + 1).0;
            out.extend(p);
        }
        let lhs = p;
        // SAFETY: `p` lies at or before the input end.
        let c = unsafe { src.byte_unchecked(p) };
        let c2 = unsafe { src.byte_unchecked(p + 1) };

        match CLASS[c as usize] {
            class::IDENT => {
                // A chain of names joined by `.` or `:` (`vim.opt.tabstop`)
                // runs in this loop.
                let mut lhs = lhs;
                let mut c = c;
                loop {
                    p = ident_end(src, p + 1);
                    let group = word_value(src, lhs, p);
                    let mut hl = if group < 0 {
                        tok::VARIABLE
                    } else {
                        (group & 255) as u32
                    };
                    if decl {
                        hl = tok::FUNCTION_DEFINITION;
                        decl = false;
                    } else if member {
                        let q = skip_space_at(src, p);
                        // SAFETY: `q` lies at or before the input end.
                        hl = if unsafe { src.byte_unchecked(q) } == b'(' {
                            tok::FUNCTION_METHOD
                        } else {
                            tok::PROPERTY
                        };
                        member = false;
                    } else if hl == tok::VARIABLE
                        // SAFETY: the skip stops at or before the input end.
                        && unsafe { src.byte_unchecked(skip_space_at(src, p)) } == b'('
                    {
                        hl = tok::FUNCTION;
                    }
                    // `function` opens a definition; the token test keeps a
                    // `function` captured as a definition from opening another
                    if hl == tok::KEYWORD_DECLARATION && group > 255 {
                        decl = true;
                    }
                    if hl == tok::VARIABLE
                        && (is_upper(c) || c == b'_')
                        && is_const_case(src, lhs, p)
                    {
                        // (only `[A-Z_]` can start a constant name)
                        hl = tok::CONSTANT;
                    }
                    out.tok(hl, p);
                    // `.`, `:`, `(`, `)`, or `,` right after a name: its rule
                    // runs here, without the gap and dispatch steps
                    // SAFETY (each read in this chain): `p` lies at or
                    // before the input end, so `p + 2` lies inside the
                    // slack; each extended record is the token just written.
                    let n = unsafe { src.byte_unchecked(p) };
                    let n2 = unsafe { src.byte_unchecked(p + 1) };
                    if (n == b'.' || n == b':') && n2 != n && !(n == b'.' && is_digit(n2)) {
                        p += 1;
                        out.tok(tok::PUNCTUATION_DELIMITER, p);
                        member = true;
                        decl = false;
                        if CLASS[n2 as usize] == class::IDENT {
                            lhs = p;
                            c = n2;
                            continue;
                        }
                    } else if n == b' '
                        && n2 == b'='
                        && unsafe { src.byte_unchecked(p + 2) } == b' '
                    {
                        // ` = `: the operator between one-space gaps, then
                        // maybe another name
                        out.extend(p + 1);
                        out.tok(tok::OPERATOR, p + 2);
                        p += 3;
                        out.extend(p);
                        decl = false;
                        member = false;
                        let n3 = unsafe { src.byte_unchecked(p) };
                        if CLASS[n3 as usize] == class::IDENT {
                            lhs = p;
                            c = n3;
                            continue;
                        }
                    } else if n == b' ' && CLASS[n2 as usize] == class::IDENT {
                        // one space, then another name
                        p += 1;
                        out.extend(p);
                        lhs = p;
                        c = n2;
                        continue;
                    } else if n == b'(' || n == b')' {
                        p += 1;
                        out.tok(tok::PUNCTUATION_BRACKET, p);
                        decl = false;
                        member = false;
                        // then maybe a name
                        if n == b'(' && CLASS[n2 as usize] == class::IDENT {
                            lhs = p;
                            c = n2;
                            continue;
                        }
                    } else if n == b',' {
                        p += 1;
                        out.tok(tok::PUNCTUATION_DELIMITER, p);
                        decl = false;
                        member = false;
                        // one space, then another name
                        let n3 = unsafe { src.byte_unchecked(p + 1) };
                        if n2 == b' ' && CLASS[n3 as usize] == class::IDENT {
                            p += 1;
                            out.extend(p);
                            lhs = p;
                            c = n3;
                            continue;
                        }
                    }
                    break;
                }
            }
            class::DASH if c2 == b'-' => {
                // SAFETY: `p` is at or before the input end, so `p + 2` lies
                // inside the slack.
                if unsafe { src.byte_unchecked(p + 2) } == b'['
                    && let Some((q, o)) = long(src, end, out, lhs, 2, tok::COMMENT)
                {
                    (p, out) = (q, o);
                    continue 'next;
                }
                // `--` comments; `---` doc comments
                // SAFETY: as above.
                let hl = if unsafe { src.byte_unchecked(p + 2) } == b'-' && p + 2 < end {
                    tok::COMMENT_DOC
                } else {
                    tok::COMMENT
                };
                p = scan::line_end(src.bytes(), (p + 2).min(end), end);
                out.tok(hl, p);
            }
            class::HASH if c2 == b'!' => {
                // a `#!` shebang line
                p = scan::line_end(src.bytes(), (p + 2).min(end), end);
                out.tok(tok::COMMENT, p);
            }
            class::QUOTE => {
                // A one-line literal without escapes is one token.
                let close = scan::string_special(src.bytes(), p + 1, end, c);
                // SAFETY: the scan stops at or before the input end.
                if unsafe { src.byte_unchecked(close) } == c && close < end {
                    p = close + 1;
                    out.tok(tok::STRING, p);
                    // `,` or `)` right after a literal: its rule runs here
                    // SAFETY: `p` is at most the input end.
                    let n = unsafe { src.byte_unchecked(p) };
                    if n == b',' {
                        p += 1;
                        out.tok(tok::PUNCTUATION_DELIMITER, p);
                    } else if n == b')' {
                        p += 1;
                        out.tok(tok::PUNCTUATION_BRACKET, p);
                    }
                } else {
                    (p, out) = string(src, end, out, lhs, c);
                }
                decl = false;
                member = false;
            }
            class::OPEN_SQUARE => {
                if (c2 == b'[' || c2 == b'=')
                    && let Some((q, o)) = long(src, end, out, lhs, 0, tok::STRING)
                {
                    (p, out) = (q, o);
                    decl = false;
                    member = false;
                    continue 'next;
                }
                p += 1;
                out.tok(tok::PUNCTUATION_BRACKET, p);
                decl = false;
                member = false;
            }
            class::DIGIT => {
                p = hex_number_end(src, end, p);
                out.tok(tok::NUMBER, p);
                decl = false;
                member = false;
            }
            class::DOT if is_digit(c2) => {
                p = hex_number_end(src, end, p);
                out.tok(tok::NUMBER, p);
                decl = false;
                member = false;
            }
            class::DOT | class::COLON => {
                p += 1;
                if c2 == c {
                    p += 1;
                    // SAFETY: `c2` is not the NUL, so `p` is at most the input
                    // end.
                    if c == b'.' && unsafe { src.byte_unchecked(p) } == b'.' {
                        p += 1;
                    }
                    out.tok(
                        if c == b'.' {
                            tok::OPERATOR
                        } else {
                            tok::PUNCTUATION_DELIMITER
                        },
                        p,
                    );
                    member = false;
                } else {
                    out.tok(tok::PUNCTUATION_DELIMITER, p);
                    member = true;
                }
                decl = false;
            }
            class::BRACKET => {
                p += 1;
                out.tok(tok::PUNCTUATION_BRACKET, p);
                decl = false;
                member = false;
            }
            class::DELIM => {
                p += 1;
                out.tok(tok::PUNCTUATION_DELIMITER, p);
                decl = false;
                member = false;
            }
            class::NUL if p >= end => break,
            _ => {
                p += 1;
                out.tok(tok::OPERATOR, p);
                decl = false;
                member = false;
            }
        }
    }
    out
}
