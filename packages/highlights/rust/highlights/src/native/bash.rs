//! WAT sources: src/langs/bash.wat src/common.wat src/scan.wat
//!
//! Native Bash highlighter. One pass over the input: each token is scanned
//! and colored in the same step, with the same rules, in the same order, as
//! the translated `$hlBash`. The records equal the translated lexer's
//! records.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::BASH_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "bash" => Some(highlight),
        _ => None,
    }
}

/// `$bashWords` as a perfect hash on a word's bytes: every word is at most
/// 8 bytes, read as one little-endian integer, zero past its end; words
/// hold no NUL, so equal integers mean equal words.
struct Words {
    keys: [u64; WORD_SLOTS],
    /// The word's 1-based group.
    groups: [u8; WORD_SLOTS],
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
    while i < BASH_WORDS.len() {
        let w = BASH_WORDS[i].word;
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
        let mut groups = [0u8; WORD_SLOTS];
        let mut i = 0;
        while i < BASH_WORDS.len() {
            let lo = word_key(BASH_WORDS[i].word);
            let s = word_slot(lo, mul);
            if keys[s] != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            keys[s] = lo;
            groups[s] = BASH_WORDS[i].group;
            i += 1;
        }
        break Words { keys, groups, mul };
    }
};

/// The `$bashWords` group of the word `[lhs, rhs)`, or 0
/// (`keyword-table.get`).
#[inline(always)]
fn word_group(src: Input<'_>, lhs: usize, rhs: usize) -> u32 {
    let n = rhs - lhs;
    // SAFETY: the word lies inside the input.
    if n > 8 || WORD_LENGTHS[unsafe { src.byte_unchecked(lhs) } as usize] >> n & 1 == 0 {
        return 0;
    }
    // SAFETY: the word lies inside the input, so `lhs + 8` lies inside
    // the slack.
    let lo = unsafe { src.word_unchecked(lhs) } & (u64::MAX >> (64 - 8 * n));
    let s = word_slot(lo, WORDS.mul);
    if WORDS.keys[s] == lo {
        WORDS.groups[s] as u32
    } else {
        0
    }
}

/// Special parameter bytes after `$` besides digits (`$bashIsSpecialParam`).
const SPECIAL_PARAM: [bool; 256] = byteset(b"!#*-?@");
/// Bytes a backslash escapes inside double quotes (`$bashDoubleBody`).
const DOUBLE_ESCAPES: [bool; 256] = byteset(b"$`\"\\\x0a");
/// Metacharacters that end a bare heredoc delimiter (`$bashIsWordEnd`).
const WORD_END: [bool; 256] = byteset(b"&();<>|");

/// Byte classes for the main dispatch.
mod class {
    /// A letter, `_`, or any byte from 0x80: a word.
    pub const IDENT: u8 = 0;
    /// Anything else: one byte colored `none`.
    pub const OTHER: u8 = 1;
    pub const DIGIT: u8 = 2;
    pub const HASH: u8 = 3;
    pub const SQUOTE: u8 = 4;
    pub const DQUOTE: u8 = 5;
    pub const BACKTICK: u8 = 6;
    pub const DOLLAR: u8 = 7;
    pub const LT: u8 = 8;
    /// `-`, `.`, `/`: a flag or path word, a number, or one byte.
    pub const PUNCT: u8 = 9;
    pub const TILDE: u8 = 10;
    pub const OPEN_PAREN: u8 = 11;
    pub const CLOSE_PAREN: u8 = 12;
    /// `[`, `]`, `{`, `}`.
    pub const BRACKET: u8 = 13;
    /// An operator byte other than `<` and `~` (`$bashIsOp`).
    pub const OP: u8 = 14;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 15;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    let mut c = 1;
    t[0] = class::NUL;
    while c < 256 {
        let b = c as u8;
        t[c] = if is_ident_start(b) && b != b'$' {
            class::IDENT
        } else if is_digit(b) {
            class::DIGIT
        } else {
            match b {
                b'#' => class::HASH,
                b'\'' => class::SQUOTE,
                b'"' => class::DQUOTE,
                b'`' => class::BACKTICK,
                b'$' => class::DOLLAR,
                b'<' => class::LT,
                b'-' | b'.' | b'/' => class::PUNCT,
                b'~' => class::TILDE,
                b'(' => class::OPEN_PAREN,
                b')' => class::CLOSE_PAREN,
                b'[' | b']' | b'{' | b'}' => class::BRACKET,
                b'!' | b'&' | b';' | b'=' | b'>' | b'|' => class::OP,
                _ => class::OTHER,
            }
        };
        c += 1;
    }
    t
};

/// Word bytes: identifier bytes without `$`, and `-`, `.`, `/`
/// (`$bashScanWord`).
static WORD: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = (is_ident_continue(b) && b != b'$') || b == b'-' || b == b'.' || b == b'/';
        c += 1;
    }
    t
};

/// Name bytes after `$`: identifier bytes without `$` (`$scanIdentRun`
/// with 0; NUL is handled by the caller).
static NAME: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = is_ident_continue(b) && b != b'$';
        c += 1;
    }
    t
};

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

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run.
#[inline(always)]
fn whitespace_end(src: Input<'_>, mut p: usize) -> usize {
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

/// The end of the word from `p`: identifier bytes without `$`, and `-`,
/// `.`, `/` (`$bashScanWord`, `$scanIdentRun`). The NUL after the input
/// ends every run.
#[inline(always)]
fn word_end(src: Input<'_>, mut p: usize) -> usize {
    // Most words are short: test a few bytes one by one first.
    for _ in 0..8 {
        // SAFETY: `p` lies at or before the NUL after the input, which
        // ends the run.
        if !WORD[unsafe { src.byte_unchecked(p) } as usize] {
            return p;
        }
        p += 1;
    }
    loop {
        // SAFETY: each load starts at or before the NUL after the input,
        // so it stays inside the slack.
        let v = unsafe { src.vec_unchecked(p) };
        let alpha = v.or(V::splat(0x20)).sub(V::splat(b'a')).le(V::splat(25));
        // `-`, `.`, `/`, and digits are 0x2d to 0x39
        let punct = v.sub(V::splat(b'-')).le(V::splat(12));
        let under = v.eq(V::splat(b'_'));
        let ok = alpha.or(punct).or(under.or(v.high()));
        let k = ok.not().first();
        if k < 16 {
            return p + k;
        }
        p += 16;
    }
}

/// The end of the name after `$` from `p`: identifier bytes without `$`,
/// and NUL bytes inside the input (`$scanIdentRun` with 0), clamped to
/// `end`.
#[inline(always)]
fn name_end(src: Input<'_>, end: usize, mut p: usize) -> usize {
    loop {
        // SAFETY: `p` lies at or before the NUL after the input, which
        // ends the run.
        let c = unsafe { src.byte_unchecked(p) };
        if NAME[c as usize] || (c == 0 && p < end) {
            p += 1;
            continue;
        }
        return p;
    }
}

/// Skip spaces and tabs from `p` on the current line (`$lexSkipSpaceAt`).
/// The NUL after the input ends every run.
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
/// The NUL after the input ends it.
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
    // SAFETY: the backslash at `p` lies inside the input, so `p + 1` lies
    // at or before its end; `e` lies inside it.
    if e == p + 2
        && unsafe { src.byte_unchecked(p + 1) } == b'\r'
        && e < end
        && unsafe { src.byte_unchecked(e) } == b'\n'
    {
        e += 1;
    }
    e
}

/// A multiline literal opened by the `quote` at `lhs`, with backslash
/// escapes colored apart; returns its end (`$lexString`, `$lexStringBody`).
#[cold]
#[inline(never)]
fn string(
    src: Input<'_>,
    end: usize,
    mut out: Recs,
    lhs: usize,
    quote: u8,
    hl: u32,
) -> (usize, Recs) {
    let mut p = lhs + 1;
    let mut seg = lhs;
    loop {
        p = scan::find3(src.bytes(), p, end, quote, b'\\', quote);
        if p >= end {
            break;
        }
        // SAFETY: `p` lies inside the input.
        if unsafe { src.byte_unchecked(p) } == quote {
            p += 1;
            break;
        }
        out.emit(hl, seg, p);
        let e = escape_end(src, end, p);
        out.emit(tok::STRING_ESCAPE, p, e);
        p = e;
        seg = p;
    }
    out.emit(hl, seg, p);
    (p, out)
}

/// The body of a quoted `$(`/`$((` from `p` with `depth` parens open
/// (`$bashSubstScan`).
#[cold]
#[inline(never)]
fn subst_scan(
    src: Input<'_>,
    end: usize,
    mut out: Recs,
    mut p: usize,
    mut depth: i32,
) -> (usize, Recs) {
    let seg = p;
    loop {
        p = scan::find3(src.bytes(), p, end, b'(', b')', b'(');
        if p >= end {
            break;
        }
        // SAFETY: `p` lies inside the input.
        if unsafe { src.byte_unchecked(p) } == b'(' {
            depth = depth.wrapping_add(1);
        } else {
            depth = depth.wrapping_sub(1);
            if depth == 0 {
                break;
            }
        }
        p += 1;
    }
    out.emit(tok::STRING_SPECIAL, seg, p);
    if p < end {
        p += 1;
        out.tok(tok::PUNCTUATION_SPECIAL, p);
    }
    (p, out)
}

/// The expansion at the `$` at `lhs`, outside quotes with `quoted` false;
/// returns its end and whether it opened `$((` (`$bashDollar`,
/// `$bashBraceScan`, `$bashIsSpecialParam`).
#[inline(always)]
fn dollar(src: Input<'_>, end: usize, out: &mut Recs, lhs: usize, quoted: bool) -> (usize, bool) {
    // SAFETY: the `$` lies inside the input, so `lhs + 1` lies at or
    // before its end.
    let c = unsafe { src.byte_unchecked(lhs + 1) };
    let mut p = lhs + 2;
    if c == b'{' {
        out.tok(tok::PUNCTUATION_SPECIAL, p);
        let seg = p;
        p = scan::find3(src.bytes(), p, end, b'}', b'\n', b'\r');
        out.emit(tok::VARIABLE, seg, p);
        // SAFETY: `p` lies inside the input.
        if p < end && unsafe { src.byte_unchecked(p) } == b'}' {
            p += 1;
            out.tok(tok::PUNCTUATION_SPECIAL, p);
        }
        return (p, false);
    }
    if c == b'(' {
        // SAFETY: `$(` lies inside the input, so `p` lies at or before its
        // end.
        let arith = unsafe { src.byte_unchecked(p) } == b'(';
        p += arith as usize;
        out.tok(tok::PUNCTUATION_SPECIAL, p);
        if quoted {
            let (q, o) = subst_scan(src, end, *out, p, 1 + arith as i32);
            *out = o;
            return (q, false);
        }
        return (p, arith);
    }
    if CLASS[c as usize] == class::IDENT {
        p = name_end(src, end, p);
    } else if !(c == b'$' || is_digit(c) || SPECIAL_PARAM[c as usize]) {
        // a literal `$`, also at the input end
        p = lhs + 1;
    }
    out.tok(tok::VARIABLE, p);
    (p, false)
}

/// The double-quoted string at `lhs` with escapes or expansions; returns
/// its end (`$bashDouble`, `$bashDoubleBody`). Searching for the closing
/// quote, a backslash, and `$` in one scan finds what the WAT's two
/// scans find.
#[cold]
#[inline(never)]
fn double(src: Input<'_>, end: usize, mut out: Recs, lhs: usize) -> (usize, Recs) {
    let mut seg = lhs;
    let mut p = lhs + 1;
    loop {
        p = scan::find3(src.bytes(), p, end, b'"', b'\\', b'$');
        if p >= end {
            break;
        }
        // SAFETY: `p` lies inside the input, so `p + 1` lies at or before
        // its end.
        let c = unsafe { src.byte_unchecked(p) };
        if c == b'"' {
            p += 1;
            out.tok(tok::STRING, p);
            return (p, out);
        }
        if c == b'\\' {
            if !DOUBLE_ESCAPES[unsafe { src.byte_unchecked(p + 1) } as usize] {
                p += 1;
                continue;
            }
            out.emit(tok::STRING, seg, p);
            let e = scan::utf8_span_end(src.bytes(), p + 2, end);
            out.emit(tok::STRING_ESCAPE, p, e);
            p = e;
            seg = p;
            continue;
        }
        out.emit(tok::STRING, seg, p);
        p = dollar(src, end, &mut out, p, true).0;
        seg = p;
    }
    out.emit(tok::STRING, seg, p);
    (p, out)
}

/// A here-document body from `p`, the start of the line after its opener,
/// through the line holding the delimiter `src[delim..delim + n]`; returns
/// its end (`$bashHeredocBody`, `$bashRangeEq`).
#[cold]
#[inline(never)]
fn heredoc_body(
    src: Input<'_>,
    end: usize,
    mut out: Recs,
    mut p: usize,
    delim: usize,
    n: usize,
    strip: bool,
) -> (usize, Recs) {
    let body = p;
    while p < end {
        let mut line = p;
        if strip {
            while line < end && src.byte(line) == b'\t' {
                line += 1;
            }
        }
        if line + n <= end
            && src.bytes()[line..line + n] == src.bytes()[delim..delim + n]
            && (line + n == end || src.byte(line + n) == b'\n' || src.byte(line + n) == b'\r')
        {
            out.emit(tok::STRING, body, p);
            let lhs = p;
            p = scan::line_end(src.bytes(), p, end);
            if p < end {
                p += 1;
            }
            out.emit(tok::STRING, lhs, p);
            return (p, out);
        }
        p = scan::line_end(src.bytes(), p, end);
        if p < end {
            p += 1;
        }
    }
    out.emit(tok::STRING, body, p);
    (p, out)
}

/// A heredoc opener `<<` or `<<-` at `lhs`: the operator, blanks, and the
/// delimiter word; returns the end and the delimiter's start, length, and
/// tab stripping (the heredoc rule of `$hlBash`, `$bashIsWordEnd`).
#[cold]
#[inline(never)]
fn heredoc_open(
    src: Input<'_>,
    end: usize,
    mut out: Recs,
    lhs: usize,
) -> (usize, Recs, usize, usize, bool) {
    let mut p = lhs + 2;
    let strip = src.byte(p) == b'-';
    p += strip as usize;
    out.tok(tok::OPERATOR, p);
    let gap = p;
    p = skip_space_at(src, p);
    out.gap(gap, p);
    if p >= end {
        return (p, out, 0, 0, strip);
    }
    let lhs = p;
    let quote = src.byte(p);
    let rhs;
    let n;
    if quote == b'"' || quote == b'\'' {
        p += 1;
        rhs = p;
        p = scan::find3(src.bytes(), p, end, quote, b'\n', b'\r');
        n = p - rhs;
        if p < end && src.byte(p) == quote {
            p += 1;
        }
    } else {
        rhs = p;
        while p < end && !(is_space(src.byte(p)) || WORD_END[src.byte(p) as usize]) {
            p += 1;
        }
        n = p - rhs;
    }
    out.emit(tok::STRING, lhs, p);
    (p, out, rhs, n, strip)
}

/// The token of a `$bashWords` group (`$bashWordHl`).
#[inline(always)]
fn word_hl(group: u32) -> u32 {
    if group == 0 {
        tok::VARIABLE
    } else if group <= 6 {
        tok::KEYWORD_CONTROL
    } else if group <= 8 {
        tok::KEYWORD_DECLARATION
    } else {
        tok::KEYWORD
    }
}

/// Whether `c` (`-`, `.`, `/`, or `~`) then `c2` open a flag, path, or
/// home word (`$bashIsPunctWordStart`).
#[inline(always)]
fn is_punct_word_start(c: u8, c2: u8) -> bool {
    (is_ident_start(c2) && c2 != b'$')
        || if c == b'-' {
            c2 == b'-'
        } else {
            c2.wrapping_sub(b'.') <= 1
        }
}

/// Lex the Bash input of `len` bytes at `base` (`$hlBash`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: `base..base + len + SLACK` lies inside lexer memory, and this
    // lexer calls no translated function that could move it.
    let src = unsafe { Input::new(inst, base, len) };
    let out = lex(src, len, Recs::load(inst));
    out.store(inst);
}

/// The lexer loop (`$hlBash` with no streaming), with its inline rules:
/// line breaks in gaps (`$lexGapHasBreak`), comments (`$lexLineComment`),
/// single-quoted strings (`$lexRawString`, `$lexRawStringBody`), arrays
/// (`$bashIsArrayOpen`), operators (`$bashIsOp`), and bounded lookahead
/// (`$bashByte`, which the NUL after the input stands in for).
fn lex(src: Input<'_>, end: usize, mut out: Recs) -> Recs {
    // `$lexEmitLeadingContinuation`
    let lead = scan::utf8_span_end(src.bytes(), 0, end);
    out.gap(0, lead);
    let mut p = whitespace_end(src, lead);
    out.gap(lead, p);

    // At a command position: keywords apply.
    // (A leading UTF-8 continuation leaves the first line's command
    // position only when a line break follows it.)
    let mut cmd = lead == 0 || scan::line_end(src.bytes(), lead, p) < p;
    // Bits 0-1: 1 after `case`, 2 in a pattern, 3 in an arm body. Bit 2:
    // waiting for `in`. Bit 3: an assignment prefix waiting for its blank.
    let mut flow: i32 = 0;
    // Open parentheses of a `NAME=(` array.
    let mut array_open: i32 = 0;
    // `function` names the next word.
    let mut decl = false;
    // A heredoc opened on the current line: its delimiter, length (0 for
    // none), and whether `<<-` allows leading tabs.
    let mut hd_delim = 0usize;
    let mut hd_len = 0usize;
    let mut hd_strip = false;
    // Open `$((` and `((` arithmetic (`$bashArith`).
    let mut arith: i32 = 0;
    // Whitespace precedes the current token.
    let mut spaced = lead < p;

    // The word `[lhs, p)`: a keyword at a command position, a function
    // name, a command, or a plain word (the word rule of `$hlBash`).
    macro_rules! word {
        ($lhs:expr) => {{
            let lhs: usize = $lhs;
            let rhs = p;
            // keywords only where a command may start, or the awaited
            // `in`; among case patterns only `esac`
            let mut group = 0u32;
            if cmd || flow & 4 != 0 {
                group = word_group(src, lhs, rhs);
                if group != 0 && ((group == 4) != (flow & 4 != 0) || (flow & 3 == 2 && group != 3))
                {
                    group = 0;
                }
            }
            let mut hl = word_hl(group);
            if decl {
                hl = tok::FUNCTION_DEFINITION;
                decl = false;
            } else if hl == tok::VARIABLE {
                let q = skip_space_at(src, rhs);
                // SAFETY (each read here): the blanks after the word stop
                // at or before the NUL after the input, so `q + 1` lies
                // inside the slack.
                if unsafe { src.byte_unchecked(q) } == b'('
                    && unsafe { src.byte_unchecked(q + 1) } == b')'
                {
                    hl = tok::FUNCTION_DEFINITION;
                } else if cmd {
                    if unsafe { src.byte_unchecked(rhs) } == b'=' {
                        flow |= 8;
                    } else if flow & 3 != 2 {
                        // a case pattern is never a command
                        hl = tok::FUNCTION;
                    }
                }
            }
            out.tok(hl, rhs);
            // a command follows a command-list keyword
            cmd = (0x202u32 >> group) & 1 != 0;
            if group >= 3 {
                if group == 3 {
                    // `esac` closes the case
                    flow &= -4;
                }
                if group == 4 {
                    // `in` arrives; after `case WORD`, patterns follow
                    flow &= -5;
                    if flow & 3 == 1 {
                        flow += 1;
                    }
                }
                if group >= 5 {
                    // `for`, `select`, and `case` await an `in`
                    flow = (flow & -5) | if group <= 6 { 4 } else { 0 };
                    if group == 6 {
                        flow = (flow & -4) | 1;
                    }
                    // `function` names the next word
                    if hl == tok::KEYWORD_DECLARATION && group == 8 {
                        decl = true;
                    }
                }
            }
        }};
    }

    loop {
        let lhs = p;
        // SAFETY: every rule stops at or before the input end.
        let c = unsafe { src.byte_unchecked(p) };
        let class = CLASS[c as usize];
        // SAFETY: every class is below 16.
        unsafe { core::hint::assert_unchecked(class <= class::NUL) };
        match class {
            class::IDENT => {
                p = word_end(src, p + 1);
                word!(lhs);
            }
            class::DQUOTE => {
                // A literal without escapes or expansions is one token.
                let close = scan::find3(src.bytes(), p + 1, end, b'"', b'\\', b'$');
                // SAFETY: the scan stops at or before the input end.
                if unsafe { src.byte_unchecked(close) } == b'"' && close < end {
                    p = close + 1;
                    out.tok(tok::STRING, p);
                } else {
                    (p, out) = double(src, end, out, lhs);
                }
                cmd = false;
            }
            class::DOLLAR => {
                // SAFETY: the `$` lies inside the input.
                let c2 = unsafe { src.byte_unchecked(p + 1) };
                if c2 == b'\'' {
                    out.tok(tok::STRING, p + 1);
                    (p, out) = string(src, end, out, p + 1, b'\'', tok::STRING);
                    cmd = false;
                } else {
                    let opened;
                    (p, opened) = dollar(src, end, &mut out, lhs, false);
                    arith += opened as i32;
                    // an unquoted `$(` opens a command; `$((` opens
                    // arithmetic
                    cmd = c2 == b'(' && !opened;
                    if c2 == b'(' {
                        flow &= -9;
                        // both parens of `$((` close separately
                        if array_open != 0 {
                            array_open = array_open.wrapping_add(2 - cmd as i32);
                        }
                    }
                }
            }
            class::HASH if cmd || spaced => {
                p = scan::line_end(src.bytes(), p + 1, end);
                out.tok(tok::COMMENT, p);
            }
            class::SQUOTE => {
                p = scan::find3(src.bytes(), p + 1, end, b'\'', b'\'', b'\'');
                p += (p < end) as usize;
                out.tok(tok::STRING, p);
                cmd = false;
            }
            class::BACKTICK => {
                (p, out) = string(src, end, out, lhs, b'`', tok::STRING_SPECIAL);
                cmd = false;
            }
            // SAFETY: the `<` lies inside the input, so `p + 2` lies inside
            // the slack.
            class::LT
                if unsafe { src.byte_unchecked(p + 1) } == b'<'
                    && arith == 0
                    && unsafe { src.byte_unchecked(p + 2) } != b'<' =>
            {
                // `<<` opens a heredoc only as a redirection
                let (q, o, delim, n, strip) = heredoc_open(src, end, out, lhs);
                p = q;
                out = o;
                cmd = false;
                // The WAT tests this with a bitwise `i32.and` of a 0/1 flag
                // and the delimiter length, so only odd-length delimiters
                // register.
                if (hd_len == 0) as usize & n != 0 {
                    hd_delim = delim;
                    hd_len = n;
                    hd_strip = strip;
                }
            }
            class::DIGIT => {
                p = number_end(src, p);
                out.tok(tok::NUMBER, p);
                cmd = false;
            }
            // SAFETY (this rule and the next two): `p` lies inside the
            // input, so `p + 1` lies at or before its end.
            class::PUNCT if c == b'.' && is_digit(unsafe { src.byte_unchecked(p + 1) }) => {
                p = number_end(src, p);
                out.tok(tok::NUMBER, p);
                cmd = false;
            }
            class::PUNCT if is_punct_word_start(c, unsafe { src.byte_unchecked(p + 1) }) => {
                p = word_end(src, p + 1);
                word!(lhs);
            }
            class::TILDE if is_punct_word_start(c, unsafe { src.byte_unchecked(p + 1) }) => {
                p = word_end(src, p + 1);
                word!(lhs);
            }
            class::OPEN_PAREN => {
                p += 1;
                let mut was_cmd = cmd;
                flow &= -9;
                // SAFETY (each read in this rule): the `(` lies inside the
                // input, so `p` lies at or before its end, and `lhs - 2`
                // and `lhs - 1` lie before it.
                if (was_cmd || flow & 4 != 0) && unsafe { src.byte_unchecked(p) } == b'(' {
                    // `((` at command position, or the C-style header of a
                    // `for ((`, is arithmetic
                    p += 1;
                    arith += 1;
                    flow &= -5;
                    was_cmd = false;
                }
                if arith == 0
                    && lhs >= 2
                    && unsafe { src.byte_unchecked(lhs - 1) } == b'='
                    && (is_ident_continue(unsafe { src.byte_unchecked(lhs - 2) })
                        || unsafe { src.byte_unchecked(lhs - 2) } == b'+'
                        || unsafe { src.byte_unchecked(lhs - 2) } == b']')
                {
                    // `NAME=(` opens an array (`$bashIsArrayOpen`)
                    array_open = 1;
                    cmd = false;
                } else {
                    if array_open != 0 {
                        array_open = array_open.wrapping_add((p - lhs) as i32);
                    }
                    // a subshell, or the command of a `<(`/`>(`
                    // substitution
                    cmd =
                        was_cmd || (lhs > 0 && unsafe { src.byte_unchecked(lhs - 1) } | 2 == b'>');
                }
                out.tok(tok::PUNCTUATION_BRACKET, p);
            }
            class::CLOSE_PAREN => {
                p += 1;
                cmd = false;
                // `))` closes the innermost counted `$((` or `((`
                // SAFETY: the `)` lies inside the input, so `p` lies at or
                // before its end.
                if arith != 0 && unsafe { src.byte_unchecked(p) } == b')' && p < end {
                    arith -= 1;
                }
                if array_open != 0 {
                    array_open = array_open.wrapping_sub(1);
                }
                // a case pattern's `)` opens its arm
                if flow & 3 == 2 {
                    flow += 1;
                    cmd = true;
                }
                out.tok(tok::PUNCTUATION_BRACKET, p);
            }
            class::BRACKET => {
                p += 1;
                // SAFETY (each read in this rule): the bracket lies inside
                // the input, so `p` lies at or before its end, and stays
                // there after a second bracket, which is not the NUL.
                // `[[`/`]]`
                if unsafe { src.byte_unchecked(p) } == c && c <= b']' {
                    p += 1;
                }
                // a `{` group holds commands; `{a,b}` is a brace expansion
                cmd = c == b'{' && is_space(unsafe { src.byte_unchecked(p) })
                    || (c == b'{' && p >= end);
                out.tok(tok::PUNCTUATION_BRACKET, p);
            }
            class::OP | class::LT | class::TILDE => {
                // SAFETY (each read in this rule): the operator lies inside
                // the input, so `p + 1` lies at or before its end, and so
                // does the byte after a second operator byte, which is not
                // the NUL.
                let c2 = unsafe { src.byte_unchecked(p + 1) };
                p += 1;
                if c2 == b'=' || c == c2 {
                    p += 1;
                    if unsafe { src.byte_unchecked(p) } == c {
                        p += 1;
                    }
                }
                out.tok(tok::OPERATOR, p);
                // separators start a command, except inside `(( ))`
                if arith == 0 && (c == b';' || c == b'&' || c == b'|') {
                    cmd = true;
                    flow &= 3;
                    // `;;`, `;&`, and `;;&` end a case arm: a pattern
                    // follows
                    if flow == 3 && c == b';' && (c2 == b';' || c2 == b'&') {
                        flow = 2;
                    }
                }
            }
            class::NUL if p >= end => break,
            _ => {
                p += 1;
                out.tok(tok::NONE, p);
                cmd = false;
            }
        }

        // The gap to the next token.
        if hd_len != 0 {
            core::hint::cold_path();
            // the pending heredoc body starts after this line's break, so
            // skip blanks only and consume just the LF or CRLF
            let q = skip_space_at(src, p);
            let b = src.byte(q);
            if q < end && hd_delim + hd_len <= q && (b == b'\n' || b == b'\r') {
                p = q + 1;
                if b == b'\r' && src.byte(p) == b'\n' && p < end {
                    p += 1;
                }
                out.extend(p);
                (p, out) = heredoc_body(src, end, out, p, hd_delim, hd_len, hd_strip);
                hd_len = 0;
                cmd = true;
            }
        }
        let gap = p;
        // SAFETY: every rule stops at or before the input end, so `p + 1`
        // lies inside the slack.
        let c = unsafe { src.byte_unchecked(p) };
        if c == b' ' && !is_space(unsafe { src.byte_unchecked(p + 1) }) {
            // one space: no line break
            p += 1;
            // SAFETY: every rule above emits a token, so a record exists.
            unsafe { out.extend_unchecked(p) };
            spaced = true;
            // the blank after `VAR=x` starts the command it prefixes
            if flow >= 8 {
                cmd = true;
                flow &= -9;
            }
        } else if is_space(c) {
            p = whitespace_end(src, p + 1);
            // SAFETY: every rule above emits a token, so a record exists.
            unsafe { out.extend_unchecked(p) };
            spaced = true;
            if c == b'\n' || c == b'\r' || scan::line_end(src.bytes(), gap + 1, p) < p {
                cmd = array_open == 0;
                // `case WORD` and `for NAME` may put `in` on the next line
                flow &= 7;
                // a line break without a body drops the pending heredoc
                hd_len = 0;
            } else if flow >= 8 {
                cmd = true;
                flow &= -9;
            }
        } else {
            spaced = false;
        }
    }
    out
}
