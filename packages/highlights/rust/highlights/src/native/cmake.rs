//! WAT sources: src/langs/cmake.wat src/common.wat src/scan.wat
//!
//! Native CMake lexer. A word at parenthesis depth zero is a command,
//! colored by its case-insensitive name; deeper words are arguments, where
//! the uppercase condition operators of `if`/`elseif`/`while` and the
//! boolean constants apply. Quoted arguments carry escapes and `${...}`
//! references, and `[[ ... ]]` bracket arguments and `#[[ ... ]]` bracket
//! comments span lines. The records equal the translated `cmake` lexer's
//! records.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::{KeywordTable, byteset};
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::CMAKE_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "cmake" => Some(highlight),
        _ => None,
    }
}

/// `$cmakeWords`.
static WORDS: KeywordTable<2048> = KeywordTable::new(CMAKE_WORDS);

/// Word bytes: identifier bytes but `$`, and `+`, `-`, `.`, `/`, `:`
/// (`$cmakeIsWordByte`).
const WORD: [bool; 256] = {
    let extra = byteset(b"+-./:");
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = b != b'$' && (is_ident_continue(b) || extra[c]);
        c += 1;
    }
    t
};

/// Bytes that end a word: all but [`WORD`] bytes.
const WORD_STOP: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = !WORD[c];
        c += 1;
    }
    t
};
const WORD_STOP_NIB: ([u8; 16], [u8; 16]) = nibbles(&WORD_STOP);

/// Whitespace: space and TAB through CR (`$lexIsSpace`).
static SPACE: [bool; 256] = {
    let mut t = [false; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = is_space(c as u8);
        c += 1;
    }
    t
};

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

/// Whether `c` is ASCII whitespace: space or TAB through CR (`$lexIsSpace`).
#[inline(always)]
const fn is_space(c: u8) -> bool {
    c == b' ' || c.wrapping_sub(9) <= 4
}

/// A byte set as two nibble tables: byte `b` is in the set when
/// `hi[b >> 4] & lo[b & 15]` is nonzero. Each bit stands for a group of
/// high nibbles that admit the same low nibbles; building fails when the
/// set needs more than eight groups.
const fn nibbles(set: &[bool; 256]) -> ([u8; 16], [u8; 16]) {
    let mut rows = [0u16; 16];
    let mut h = 0;
    while h < 16 {
        let mut l = 0;
        while l < 16 {
            if set[h * 16 + l] {
                rows[h] |= 1 << l;
            }
            l += 1;
        }
        h += 1;
    }
    let mut hi = [0u8; 16];
    let mut lo = [0u8; 16];
    let mut groups = [0u16; 8];
    let mut n = 0;
    h = 0;
    while h < 16 {
        if rows[h] != 0 {
            let mut g = 0;
            while g < n && groups[g] != rows[h] {
                g += 1;
            }
            if g == n {
                assert!(n < 8, "too many nibble groups");
                groups[n] = rows[h];
                n += 1;
            }
            hi[h] = 1 << g;
            let mut l = 0;
            while l < 16 {
                if rows[h] >> l & 1 != 0 {
                    lo[l] |= 1 << g;
                }
                l += 1;
            }
        }
        h += 1;
    }
    (hi, lo)
}

/// The first byte from `p` in the set of the nibble tables `nib` (see
/// [`nibbles`]), 16 bytes per step. The caller makes sure a set byte lies
/// within 16 bytes past the input end, or stops the scan itself.
#[inline(always)]
fn find_set(inp: Input, mut p: usize, nib: &([u8; 16], [u8; 16])) -> usize {
    let hi_t = V::from_array(&nib.0);
    let lo_t = V::from_array(&nib.1);
    loop {
        // SAFETY: each 16-byte load starts at or before a set byte that
        // lies at most 16 bytes past the input end, inside the slack.
        let v = unsafe { inp.vec_unchecked(p) };
        let k = hi_t
            .lookup(v.shr::<4>())
            .test(lo_t.lookup(v.and(V::splat(15))))
            .first();
        if k < 16 {
            return p + k;
        }
        p += 16;
    }
}

/// The end of the escape at backslash `p` (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(inp: Input, p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(inp.bytes(), p + 2, end);
    // SAFETY: the backslash at `p` lies inside the input, so `p + 1` lies
    // at or before its end, and `e` is below the end.
    if e == p + 2
        && unsafe { inp.byte_unchecked(p + 1) } == b'\r'
        && e < end
        && unsafe { inp.byte_unchecked(e) } == b'\n'
    {
        e += 1;
    }
    e
}

/// The end of the number at `p` (`$lexScanNumber`, `$lexScanNumberBody`).
/// The NUL after the input stops it.
fn number_end(inp: Input, mut p: usize) -> usize {
    // SAFETY (the reads here): `p` starts inside the input, the NUL at its
    // end stops the number, and `p + 1` stays inside the slack.
    let hex = unsafe { inp.byte_unchecked(p) } == b'0'
        && unsafe { inp.byte_unchecked(p + 1) } | 0x20 == b'x';
    let mut prev = 0u8;
    loop {
        let c = unsafe { inp.byte_unchecked(p) };
        if is_ident_continue(c) {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            if !is_digit(unsafe { inp.byte_unchecked(p + 1) }) {
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

/// The command word `[lhs, rhs)` lowercased for its case-insensitive table
/// group, as the WAT's lowercase scratch copy (`$lexLowerCopy`): bytes
/// 0-31 as four little-endian integers, `A-Z` lowered. Only its first
/// `rhs - lhs` bytes are meaningful.
#[inline(always)]
fn lower_word(inp: Input, lhs: usize) -> [u8; 32] {
    // Lowercase 8 bytes at a time: a byte is uppercase when its low 7 bits
    // are at least `A`, not above `Z`, and its top bit is clear.
    let lower = |w: u64| {
        let h = w & 0x7f7f_7f7f_7f7f_7f7f;
        let ge_a = h + 0x3f3f_3f3f_3f3f_3f3f;
        let gt_z = h + 0x2525_2525_2525_2525;
        let upper = ge_a & !gt_z & !w & 0x8080_8080_8080_8080;
        w | upper >> 2
    };
    let mut buf = [0u8; 32];
    let mut i = 0;
    while i < 32 {
        // SAFETY: `lhs` lies at or before the input end, so 32 bytes from
        // it lie inside the slack.
        let w = unsafe { inp.word_unchecked(lhs + i) };
        buf[i..i + 8].copy_from_slice(&lower(w).to_le_bytes());
        i += 8;
    }
    buf
}

/// Whether the `n`-byte lowercased command `low` is `if`, `elseif`, or
/// `while`, whose arguments carry the operator words
/// (`$cmakeIsCondition`).
#[inline(always)]
fn is_condition(low: &[u8; 32], n: usize) -> bool {
    match n {
        2 => low[..2] == *b"if",
        5 => low[..5] == *b"while",
        6 => low[..6] == *b"elseif",
        _ => false,
    }
}

/// SCREAMING_CASE: at least two bytes, one uppercase letter, and only
/// `[A-Z0-9_]` (`$lexIsConstCase`).
#[inline(always)]
fn is_const_case(inp: Input, lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = false;
    for p in lhs..rhs {
        // SAFETY: the name lies inside the input.
        let c = unsafe { inp.byte_unchecked(p) };
        if c.wrapping_sub(b'A') <= 25 {
            upper = true;
        } else if !(is_digit(c) || c == b'_') {
            return false;
        }
    }
    upper
}

/// The number of `=` between the brackets of a `[=*[` opener at `p`, or
/// `None` when the bytes there open no bracket comment or argument
/// (`$cmakeBracketEquals`).
#[inline(always)]
fn bracket_equals(inp: Input, p: usize) -> Option<usize> {
    let mut p = p + 1;
    let mut n = 0;
    // SAFETY: `p` starts inside the input, and the NUL at its end stops the
    // run of `=`.
    while unsafe { inp.byte_unchecked(p) } == b'=' {
        p += 1;
        n += 1;
    }
    if unsafe { inp.byte_unchecked(p) } != b'[' || n > 30 {
        return None;
    }
    Some(n)
}

/// The bracket body whose `[=*[` opener with `n` equals signs sits at
/// `ptr`, through its `]=*]` closer or the input end, as `hl`; a closer
/// right after the byte `escape` (the WAT's `$streamB`, when nonzero)
/// does not count. Returns the end (`$cmakeBracketBody`,
/// `$streamResumeFixed`).
#[inline(never)]
fn bracket_body(
    inp: Input,
    end: usize,
    ptr: usize,
    n: usize,
    hl: u32,
    escape: i32,
    o: &mut Recs,
) -> usize {
    let lhs = ptr + n + 2;
    o.emit(hl, ptr, lhs);
    let len = n + 2;
    let mut p = lhs;
    loop {
        p = scan::find3(inp.bytes(), p, end, b']', b']', b']');
        if p + len > end {
            break;
        }
        let mut matched = inp.bytes()[p + 1..p + len - 1].iter().all(|&b| b == b'=')
            && inp.bytes()[p + len - 1] == b']';
        if escape != 0 && p > lhs && inp.bytes()[p - 1] as i32 == escape {
            matched = false;
        }
        if matched {
            o.emit(hl, lhs, p + len);
            return p + len;
        }
        p += 1;
    }
    o.emit(hl, lhs, end);
    end
}

/// Whether the `$` at `p` opens a `${name}`, `$ENV{name}`, or
/// `$CACHE{name}` reference or a `$<...>` generator expression
/// (`$cmakeIsRefOpen`).
#[inline(always)]
fn is_ref_open(inp: Input, p: usize) -> bool {
    let mut p = p + 1;
    // SAFETY: the `$` at `p` lies inside the input, and the NUL at its end
    // stops the run of letters.
    while unsafe { inp.byte_unchecked(p) }.wrapping_sub(b'A') <= 25 {
        p += 1;
    }
    let c = unsafe { inp.byte_unchecked(p) };
    c == b'{' || c == b'<'
}

/// The reference opening at `ptr` (see [`is_ref_open`]): a variable
/// through the brace balancing its opener, or a generator expression as
/// `string.special` through the balancing `>`, ending at a line break
/// when unbalanced. Returns the end (`$cmakeReference`).
#[inline(always)]
fn reference(inp: Input, end: usize, ptr: usize, o: &mut Recs) -> usize {
    let lhs = ptr;
    let mut ptr = ptr + 1;
    // SAFETY (the reads up to the loop's end check): `ptr` starts at or
    // before the input end, the NUL there stops the run, and the loop
    // reads only below `end`.
    while unsafe { inp.byte_unchecked(ptr) }.wrapping_sub(b'A') <= 25 {
        ptr += 1;
    }
    let open = unsafe { inp.byte_unchecked(ptr) };
    let (close, hl) = if open == b'<' {
        (b'>', tok::STRING_SPECIAL)
    } else {
        (b'}', tok::VARIABLE)
    };
    let mut depth = 0u32;
    while ptr < end {
        let c = unsafe { inp.byte_unchecked(ptr) };
        if c == b'\n' || c == b'\r' {
            break;
        }
        ptr += 1;
        if c == open {
            depth = depth.wrapping_add(1);
        }
        if c == close {
            depth = depth.wrapping_sub(1);
            if depth == 0 {
                break;
            }
        }
    }
    o.emit(hl, lhs, ptr);
    ptr
}

/// The quoted argument whose opening quote sits at `seg`, with escapes and
/// references emitted separately; it may span lines. Returns the end
/// (`$cmakeQuotedBody`).
#[inline(never)]
fn quoted(inp: Input, end: usize, seg: usize, out: &mut Recs) -> usize {
    let mut o = *out;
    let mut seg = seg;
    let mut ptr = seg + 1;
    loop {
        let p = scan::find3(inp.bytes(), ptr, end, b'"', b'\\', b'$');
        if p >= end {
            ptr = end;
            break;
        }
        // SAFETY: `p` is below the input end.
        let c = unsafe { inp.byte_unchecked(p) };
        if c == b'"' {
            ptr = p + 1;
            break;
        }
        if c == b'\\' {
            o.emit(tok::STRING, seg, p);
            let e = escape_end(inp, p, end);
            o.emit(tok::STRING_ESCAPE, p, e);
            ptr = e;
            seg = e;
            continue;
        }
        if is_ref_open(inp, p) {
            o.emit(tok::STRING, seg, p);
            ptr = reference(inp, end, p, &mut o);
            seg = ptr;
            continue;
        }
        ptr = p + 1;
    }
    o.emit(tok::STRING, seg, ptr);
    *out = o;
    ptr
}

/// Lex the CMake input of `len` bytes at `base` (`$hlCmake`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: the input and its slack lie inside lexer memory, and this
    // lexer calls no translated code that could move it.
    let inp = unsafe { Input::new(inst, base, len) };
    let end = len;
    // A bracket body's closer does not count right after this byte, when it
    // is nonzero: the WAT reads `$streamB` there without setting it.
    let escape = inst.g_streamB;
    let mut o = Recs::load(inst);
    // Call an out-of-line helper that writes records through a copy of the
    // writer, so the loop's writer stays in registers.
    macro_rules! call {
        ($f:ident($($arg:expr),*)) => {{
            let mut t = o;
            let r = $f(inp, end, $($arg,)* &mut t);
            o = t;
            r
        }};
    }

    // open parentheses: a word at depth zero is a command
    let mut depth = 0u32;
    // inside the arguments of `if`, `elseif`, or `while`
    let mut cond = false;
    // right after `set(`, `unset(`, or `option(`
    let mut set_var = false;

    // `$lexEmitLeadingContinuation` and the leading whitespace: one gap,
    // which writes the first record when there is none yet.
    let mut ptr = scan::utf8_span_end(inp.bytes(), 0, end);
    while SPACE[inp.byte(ptr) as usize] {
        ptr += 1;
    }
    o.gap(0, ptr);
    // A word from `lhs`: a command at depth zero, an argument deeper.
    macro_rules! word {
        ($lhs:expr) => {{
            let lhs: usize = $lhs;
            // (NUL ends the word, so the scan stops at the input end)
            ptr = find_set(inp, ptr + 1, &WORD_STOP_NIB);
            let rhs = ptr;
            let hl;
            if depth == 0 {
                let n = rhs - lhs;
                let low = lower_word(inp, lhs);
                let g = if n <= 31 { WORDS.group(&low, 0, n) } else { 0 };
                cond = is_condition(&low, n);
                set_var = g == 3;
                hl = if g == 1 {
                    tok::KEYWORD_CONTROL
                } else if g == 2 {
                    tok::KEYWORD_IMPORT
                } else {
                    tok::FUNCTION
                };
            } else {
                let g = WORDS.group(inp.bytes(), lhs, rhs);
                let mut h = if is_const_case(inp, lhs, rhs) {
                    tok::CONSTANT
                } else {
                    tok::NONE
                };
                if set_var {
                    h = tok::VARIABLE;
                }
                if g == 4 && cond {
                    h = tok::KEYWORD_OPERATOR;
                }
                if g == 5 {
                    h = tok::BOOLEAN;
                }
                set_var = false;
                hl = h;
            }
            o.tok(hl, rhs);
        }};
    }

    loop {
        let gap = ptr;
        // SAFETY (the reads at `ptr`): `ptr` lies at or before the input
        // end, and the NUL there stops the run.
        while SPACE[unsafe { inp.byte_unchecked(ptr) } as usize] {
            ptr += 1;
        }
        if gap < ptr {
            o.extend(ptr)
        }
        if ptr >= end {
            break;
        }
        let lhs = ptr;
        let c = unsafe { inp.byte_unchecked(ptr) };

        // Words, the most common tokens, skip the rule chain: no earlier
        // rule matches a word byte but a digit.
        if WORD[c as usize] && !is_digit(c) {
            word!(lhs);
            continue;
        }

        match c {
            // `#[[ ... ]]` bracket comments span lines; any other `#`
            // comments out the rest of the line
            b'#' => {
                // SAFETY: `ptr` is below the input end.
                let n = if unsafe { inp.byte_unchecked(ptr + 1) } == b'[' {
                    bracket_equals(inp, ptr + 1)
                } else {
                    None
                };
                if let Some(n) = n {
                    ptr += 1;
                    o.tok(tok::COMMENT, ptr);
                    ptr = call!(bracket_body(ptr, n, tok::COMMENT, escape));
                } else {
                    ptr = scan::line_end(inp.bytes(), ptr + 1, end);
                    o.tok(tok::COMMENT, ptr);
                }
                continue;
            }
            // `[[ ... ]]` bracket arguments are verbatim strings
            b'[' => {
                if let Some(n) = bracket_equals(inp, ptr) {
                    ptr = call!(bracket_body(ptr, n, tok::STRING, escape));
                    set_var = false;
                    continue;
                }
            }
            b'"' => {
                ptr = call!(quoted(ptr));
                set_var = false;
                continue;
            }
            b'$' => {
                if is_ref_open(inp, ptr) {
                    ptr = reference(inp, end, ptr, &mut o);
                    set_var = false;
                    continue;
                }
            }
            // unquoted arguments take escapes too
            b'\\' => {
                ptr = escape_end(inp, ptr, end);
                o.tok(tok::STRING_ESCAPE, ptr);
                continue;
            }
            b'(' => {
                ptr += 1;
                o.tok(tok::PUNCTUATION_BRACKET, ptr);
                depth = depth.wrapping_add(1);
                continue;
            }
            b')' => {
                ptr += 1;
                o.tok(tok::PUNCTUATION_BRACKET, ptr);
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    cond = false;
                    set_var = false;
                }
                continue;
            }
            b';' => {
                ptr += 1;
                o.tok(tok::PUNCTUATION_DELIMITER, ptr);
                continue;
            }
            _ => {}
        }

        // a number stands alone: `3.16`, `17`; digits that lead into a
        // name such as `2d.cpp` belong to the word
        if is_digit(c) {
            let e = number_end(inp, ptr);
            // SAFETY: the number ends at or before the input end.
            if !WORD[unsafe { inp.byte_unchecked(e) } as usize] {
                ptr = e;
                o.tok(tok::NUMBER, ptr);
                set_var = false;
                continue;
            }
        }
        if WORD[c as usize] {
            word!(lhs);
            continue;
        }

        ptr = scan::utf8_span_end(inp.bytes(), ptr + 1, end);
        o.tok(tok::NONE, ptr);
    }
    o.store(inst);
}
