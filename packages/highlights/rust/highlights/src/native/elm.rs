//! WAT sources: src/langs/elm.wat src/common.wat src/scan.wat
//!
//! Native Elm lexer. One pass over the input: each token is scanned and
//! colored in the same step, with the same rules, in the same order, as the
//! translated `$hlElm`. The records equal the translated lexer's records.
//!
//! The WAT tests its rules in one chain. Each rule matches one first byte,
//! so this lexer dispatches on the first byte and, for each byte, tests
//! only the rules that can match it, in the WAT's order. A string body
//! runs right after its opener, as the WAT runs it on its next loop pass.

use super::Lexer;
use super::scan;
use crate::Rec;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::ELM_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "elm" => Some(highlight),
        _ => None,
    }
}

/// `$elmWords` as a perfect hash on a word's bytes: the token in the low
/// byte, and bit 8 for `module`/`import`, bit 9 for `type`, which name what
/// the next capitalized name is. A word of up to 16 bytes is two
/// little-endian integers, `lo` (bytes 0-7) and `hi` (bytes 8-15), zero
/// past its end; names hold no NUL, so equal integers mean equal words.
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    /// The word's `keyword-table.value`.
    values: [u16; WORD_SLOTS],
    mul: u64,
}

const WORD_SLOTS: usize = 256;

/// The longest word.
const WORD_MAX: usize = 16;

/// The slot of the word with integers `lo` and `hi`. No two words share a
/// slot, so a name is a word only when its integers equal the slot's.
#[inline(always)]
const fn word_slot(lo: u64, hi: u64, mul: u64) -> usize {
    ((lo ^ hi.rotate_left(29)).wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros())) as usize
}

/// The integers of the word `w`.
const fn word_key(w: &[u8]) -> (u64, u64) {
    let mut lo = 0u64;
    let mut hi = 0u64;
    let mut i = 0;
    while i < w.len() {
        if i < 8 {
            lo |= (w[i] as u64) << (8 * i);
        } else {
            hi |= (w[i] as u64) << (8 * (i - 8));
        }
        i += 1;
    }
    (lo, hi)
}

/// For each first byte, a bit per length of the words in [`WORDS`]. A name
/// whose bit is clear is no word.
static WORD_LENGTHS: [u32; 256] = {
    let mut t = [0u32; 256];
    let mut i = 0;
    while i < ELM_WORDS.len() {
        let w = ELM_WORDS[i].word;
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
        let mut keys = [(0u64, 0u64); WORD_SLOTS];
        let mut values = [0u16; WORD_SLOTS];
        let mut i = 0;
        while i < ELM_WORDS.len() {
            let (w, value) = (ELM_WORDS[i].word, ELM_WORDS[i].value);
            assert!(w.len() <= WORD_MAX && value > 0 && value < 0x10000);
            let (lo, hi) = word_key(w);
            let s = word_slot(lo, hi, mul);
            if keys[s].0 != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            keys[s] = (lo, hi);
            values[s] = value as u16;
            i += 1;
        }
        break Words { keys, values, mul };
    }
};

/// The first `n` bytes at `p` as a little-endian integer, for comparing
/// short words. Reads 8 bytes, which the input slack allows.
#[inline(always)]
fn word_at(src: &[u8], p: usize, n: usize) -> u64 {
    debug_assert!(p + 8 <= src.len());
    // SAFETY: `p` lies before the input end, so `p + 8` lies inside the
    // slack.
    let w = unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() };
    w & (u64::MAX >> (64 - 8 * n))
}

/// The keyword value of the name `[lhs, rhs)`, or -1 when it is no word
/// (`keyword-table.value $elmWords`).
#[inline(always)]
fn word_value(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    if n > WORD_MAX || WORD_LENGTHS[at(src, lhs) as usize] >> n & 1 == 0 {
        return -1;
    }
    let (lo, hi) = if n <= 8 {
        (word_at(src, lhs, n), 0)
    } else {
        (word_at(src, lhs, 8), word_at(src, lhs + 8, n - 8))
    };
    let s = word_slot(lo, hi, WORDS.mul);
    if WORDS.keys[s] == (lo, hi) {
        WORDS.values[s] as i32
    } else {
        -1
    }
}

/// The token of a one-character token by its first byte: brackets,
/// delimiters, operators, or `none` (the last rule of `$hlElm`).
static OTHER_HL: [u32; 256] = {
    let mut t = [tok::NONE; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = match c as u8 {
            b'(' | b')' | b'[' | b']' | b'{' | b'}' => tok::PUNCTUATION_BRACKET,
            b'.' | b',' | b':' => tok::PUNCTUATION_DELIMITER,
            b'+' | b'-' | b'*' | b'/' | b'=' | b'<' | b'>' | b'|' | b'&' | b'^' | b'!' | b'%'
            | b'#' | b'?' | b'~' | b'\\' => tok::OPERATOR,
            _ => tok::NONE,
        };
        c += 1;
    }
    t
};

/// Bytes that always lex as one-character tokens: brackets, delimiters,
/// and operators other than `-` and `{`, which can open comments.
static PLAIN: [bool; 256] = super::tables::byteset(b"()[]}.,:+*/=<>|&^!%#?~\\");

/// Coarse byte kinds for the loop top.
mod kind {
    /// Anything else: a one-character token, a comment, or a string.
    pub const OTHER: u8 = 0;
    /// ASCII whitespace (`$lexIsSpace`).
    pub const SPACE: u8 = 1;
    /// An identifier start other than `$`: a letter, `_`, or a byte from
    /// 0x80.
    pub const NAME: u8 = 2;
    pub const DIGIT: u8 = 3;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 4;
    /// A byte of [`super::PLAIN`]: always a one-character token.
    pub const PLAIN: u8 = 5;
}

/// The [`kind`] of each byte.
static KIND: [u8; 256] = {
    let mut t = [kind::OTHER; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = if is_space(b) {
            kind::SPACE
        } else if is_ident_start(b) && b != b'$' {
            kind::NAME
        } else if is_digit(b) {
            kind::DIGIT
        } else if b == 0 {
            kind::NUL
        } else if PLAIN[c] {
            kind::PLAIN
        } else {
            kind::OTHER
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
        let b = c as u8;
        t[c] = is_ident_start(b) || is_digit(b);
        c += 1;
    }
    t
};

/// Name bytes: `[A-Za-z0-9_]` and bytes from 0x80 (`$scanIdentRun` with
/// `_`).
static NAME: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = b >= 0x80 || (b | 32).wrapping_sub(b'a') <= 25 || is_digit(b) || b == b'_';
        c += 1;
    }
    t
};

/// The byte at `i`. Every caller reads at most 16 bytes past the input
/// end, which the 96-byte input slack covers. The byte at the input end is
/// NUL, which matches none of the bytes a lookahead tests, so a lookahead
/// one byte past a token needs no bounds check.
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

/// Whether `c` is an ASCII hex digit.
#[inline(always)]
const fn is_hex(c: u8) -> bool {
    is_digit(c) || (c | 32).wrapping_sub(b'a') <= 5
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

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run.
#[inline(always)]
fn whitespace_end(src: &[u8], mut p: usize) -> usize {
    loop {
        // Skip spaces 8 bytes at a time, then step over one other
        // whitespace byte (TAB to CR) and go on.
        // SAFETY: `p` lies at or before the NUL after the input, so the
        // 8-byte read stays inside the slack.
        let w = unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() };
        let x = w ^ 0x2020_2020_2020_2020;
        let other =
            (((x & 0x7f7f_7f7f_7f7f_7f7f) + 0x7f7f_7f7f_7f7f_7f7f) | x) & 0x8080_8080_8080_8080;
        if other == 0 {
            p += 8;
            continue;
        }
        p += (other.trailing_zeros() / 8) as usize;
        if !is_space(at(src, p)) {
            return p;
        }
        p += 1;
    }
}

/// The end of the name run from `p`: `[A-Za-z0-9_]` and bytes from 0x80
/// (`$scanIdentRun` with `_`). The NUL after the input ends every run.
#[inline(always)]
fn name_end(src: &[u8], mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..8 {
        if !NAME[at(src, p) as usize] {
            return p;
        }
        p += 1;
    }
    // SAFETY: each 16-byte load starts at or before the NUL after the
    // input, inside the slack.
    unsafe {
        loop {
            let v = V::load(src.as_ptr().add(p));
            let alpha = v.or(V::splat(0x20)).sub(V::splat(b'a')).le(V::splat(25));
            let digit = v.sub(V::splat(b'0')).le(V::splat(9));
            let extra = v.eq(V::splat(b'_'));
            let high = v.high();
            let ok = alpha.or(digit).or(extra.or(high));
            let k = ok.not().first();
            if k < 16 {
                return p + k;
            }
            p += 16;
        }
    }
}

/// The end of the number at `p`: radix digits, separators, exponents, and
/// suffixes, with `.` only before a digit (`$lexScanNumber`,
/// `$lexScanNumberBody`).
#[inline(always)]
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
            if !is_digit(at(src, p + 1)) {
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

/// The end of the escape at backslash `p`: one character, kept whole when
/// it is UTF-8, and CRLF as one (`$lexEscapeEnd`), or the whole `\u{...}`
/// with its braced hex code point (`$hlElm`, `$scanHexRun`).
#[inline(always)]
fn escape_end(src: &[u8], p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(src, p + 2, end);
    if e == p + 2 && at(src, p + 1) == b'\r' && e < end && at(src, e) == b'\n' {
        e += 1;
    }
    if at(src, p + 1) == b'u' && at(src, p + 2) == b'{' {
        // `$scanHexRun` of at most 6 digits
        let stop = (p + 9).min(end);
        let mut r = p + 3;
        while r < stop && is_hex(at(src, r)) {
            r += 1;
        }
        if r > p + 3 && at(src, r) == b'}' {
            e = r + 1;
        }
    }
    e
}

/// The first position from `p` where `{-` or `-}` starts, or a position at
/// or past `end` (the search loop of `$lexNestedScan`).
#[inline(always)]
fn find_nest_pair(src: &[u8], mut p: usize, end: usize) -> usize {
    while p < end {
        // SAFETY: `p < end`, so both 16-byte loads end inside the slack.
        let k = unsafe {
            let w = V::load(src.as_ptr().add(p));
            let w1 = V::load(src.as_ptr().add(p + 1));
            let open = w.eq(V::splat(b'{')).and(w1.eq(V::splat(b'-')));
            let close = w.eq(V::splat(b'-')).and(w1.eq(V::splat(b'}')));
            open.or(close).first()
        };
        if k < 16 {
            return p + k;
        }
        p += 16;
    }
    p
}

/// The end of the nested `{- -}` comment whose body starts at `p`, or
/// `end` when it doesn't close (`$lexNestedScan` from depth 1).
#[cold]
#[inline(never)]
fn nested_comment_end(src: &[u8], mut p: usize, end: usize) -> usize {
    let mut depth = 1u32;
    loop {
        p = find_nest_pair(src, p, end);
        // a pair whose second byte is at or past the end doesn't count
        if p + 1 >= end {
            return end;
        }
        if at(src, p) == b'{' {
            depth = depth.wrapping_add(1);
            p += 2;
            continue;
        }
        depth = depth.wrapping_sub(1);
        p += 2;
        if depth == 0 {
            return p;
        }
    }
}

/// Lex the Elm input of `len` bytes at `base` (`$hlElm`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    let mem_ptr = inst.mem.bytes().as_ptr();
    // SAFETY: `base..base + len + 96` lies inside lexer memory, which is not
    // reallocated while this lexer runs.
    let src: &[u8] = unsafe { core::slice::from_raw_parts(mem_ptr.add(base), len + 96) };
    let end = len;

    // Records are written through `cur`, which moves along
    // `inst.ext.recs`'s buffer from `rp` to at most `limit`; `last` is the
    // last record's token, or `u32::MAX`.
    let rp = inst.ext.recs.as_mut_ptr();
    // SAFETY: `len` records are written.
    let mut cur = unsafe { rp.add(inst.ext.recs.len()) };
    // SAFETY: one past the allocation.
    let limit = unsafe { rp.add(inst.ext.recs.capacity()) };
    let mut last = inst.ext.recs.last().map_or(u32::MAX, |r| r.token);
    // Append a non-empty token ending at `end`, merging it into the last
    // record when the token matches (`$emitTok`). Running out of room
    // means a lexer bug, which traps.
    macro_rules! emit {
        ($hl:expr, $end:expr) => {{
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

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src, 0, end);
    gap!(0, ptr);
    // Leading whitespace. The state is already that of a line start, so
    // only the record changes; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    gap!(ptr, first);
    ptr = first;
    // Whitespace up to `rhs` extends the last record, which exists.
    macro_rules! extend {
        ($rhs:expr) => {{
            debug_assert!(cur > rp);
            // SAFETY: a record precedes every gap after the first token.
            unsafe { (*cur.sub(1)).end = $rhs as u32 };
        }};
    }

    // what the next capitalized name is: 1 a module (after `module`,
    // `import`, or an import's `as`), 2 a type (after `type`)
    let mut expect = 0u32;
    // on an import line
    let mut import = false;
    // after `.`
    let mut member = false;
    // a token precedes on this line
    let mut mid_line = false;

    loop {
        let gap = ptr;
        let mut c = at(src, ptr);
        let mut byte_kind = KIND[c as usize];
        if byte_kind == kind::SPACE {
            if c == b' ' && KIND[at(src, ptr + 1) as usize] != kind::SPACE {
                // one space: no line break
                ptr += 1;
            } else {
                ptr = whitespace_end(src, ptr + 1);
                // the gap crossed a line break when a CR/LF sits in it
                if c == b'\n' || c == b'\r' || scan::line_end(src, gap + 1, ptr) < ptr {
                    mid_line = false;
                    member = false;
                }
            }
            extend!(ptr);
            c = at(src, ptr);
            byte_kind = KIND[c as usize];
        }
        let lhs = ptr;
        // Names, the most common tokens, skip the dispatch.
        if byte_kind == kind::NAME {
            let rhs = name_end(src, ptr + 1);
            ptr = rhs;
            let upper = c.wrapping_sub(b'A') <= 25;
            let mut kind = word_value(src, lhs, rhs);
            // module and declared type names can also name builtin types.
            // The WAT tests `expect` with a bitwise `i32.and` against the
            // 0/1 capital test, so only an odd `expect` (a module name)
            // applies.
            if expect & upper as u32 != 0 {
                kind = -1;
            }
            if kind == tok::KEYWORD_IMPORT as i32 + 256 {
                import = true;
            } else if import {
                if rhs - lhs == 2 && at(src, lhs) == b'a' && at(src, lhs + 1) == b's' {
                    expect = 1;
                } else if kind >= 0 || !upper {
                    import = false;
                }
            }
            let hl;
            if kind < 0 && expect == 0 && !upper && !member {
                hl = if mid_line {
                    tok::VARIABLE
                } else {
                    tok::FUNCTION_DEFINITION
                };
            } else if kind >= 0 {
                hl = (kind & 255) as u32;
                if kind >> 8 != 0 {
                    expect = (kind >> 8) as u32;
                }
            } else if expect != 0 {
                hl = if expect == 1 {
                    tok::NAMESPACE
                } else {
                    tok::TYPE
                };
                if at(src, rhs) != b'.' {
                    expect = 0;
                }
            } else if upper {
                hl = if at(src, rhs) == b'.' {
                    tok::NAMESPACE
                } else {
                    tok::TYPE
                };
            } else if member {
                hl = tok::PROPERTY;
            } else if !mid_line {
                hl = tok::FUNCTION_DEFINITION;
            } else {
                hl = tok::VARIABLE;
            }
            emit!(hl, rhs);
            member = false;
            mid_line = true;
            continue;
        }
        if byte_kind == kind::DIGIT {
            ptr = number_end(src, ptr);
            emit!(tok::NUMBER, ptr);
            mid_line = true;
            continue;
        }
        // One character: a bracket, delimiter, operator, or none; a run of
        // such characters (`->`, `[]`) is lexed here one by one, without
        // the gap and dispatch steps.
        macro_rules! one_chars {
            () => {{
                mid_line = true;
                loop {
                    // (`$utf8SpanEnd`: the NUL at the input end stops the
                    // run)
                    ptr += 1;
                    while at(src, ptr) & 0xc0 == 0x80 {
                        ptr += 1;
                    }
                    member = c == b'.';
                    emit!(OTHER_HL[c as usize], ptr);
                    c = at(src, ptr);
                    if KIND[c as usize] != kind::PLAIN {
                        break;
                    }
                }
            }};
        }
        if byte_kind == kind::PLAIN {
            one_chars!();
            continue;
        }
        if byte_kind == kind::NUL && ptr >= end {
            break;
        }
        let c2 = at(src, ptr + 1);
        if c == b'-' && c2 == b'-' {
            // `$lexLineComment`
            ptr = scan::line_end(src, ptr + 2, end);
            emit!(tok::COMMENT, ptr);
            continue;
        }
        if c == b'{' && c2 == b'-' {
            let hl = if at(src, ptr + 2) == b'|' {
                tok::COMMENT_DOC
            } else {
                tok::COMMENT
            };
            ptr = nested_comment_end(src, ptr + 2, end);
            emit!(hl, ptr);
            continue;
        }
        if c == b'"' || c == b'\'' {
            mid_line = true;
            let triple = c == b'"' && c2 == b'"' && at(src, ptr + 2) == b'"';
            ptr += if triple { 3 } else { 1 };
            emit!(tok::STRING, ptr);
            // The string body: escapes get their own tokens; a one-line
            // string stops before a line break, unterminated.
            let mut seg = ptr;
            loop {
                ptr = if triple {
                    scan::find3(src, ptr, end, c, b'\\', c)
                } else {
                    scan::string_special(src, ptr, end, c)
                };
                if ptr >= end {
                    break;
                }
                let d = at(src, ptr);
                if !triple && (d == b'\n' || d == b'\r') {
                    break;
                }
                if d == b'\\' {
                    if seg < ptr {
                        emit!(tok::STRING, ptr);
                    }
                    ptr = escape_end(src, ptr, end);
                    emit!(tok::STRING_ESCAPE, ptr);
                    seg = ptr;
                } else if !triple || (at(src, ptr + 1) == b'"' && at(src, ptr + 2) == b'"') {
                    ptr += if triple { 3 } else { 1 };
                    break;
                } else {
                    ptr += 1;
                }
            }
            if seg < ptr {
                emit!(tok::STRING, ptr);
            }
            continue;
        }
        one_chars!();
    }
    // SAFETY: the records before `cur` are written.
    unsafe { inst.ext.recs.set_len(cur.offset_from(rp) as usize) };
}
