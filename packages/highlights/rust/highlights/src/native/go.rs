//! WAT sources: src/langs/go.wat src/common.wat src/scan.wat
//!
//! Native Go highlighter. One pass over the input: each token is scanned
//! and colored in the same step, with the same rules, in the same order, as
//! the translated `$hlGo`. The records equal the translated lexer's
//! records.

#[cfg(target_arch = "aarch64")]
use core::arch::aarch64::*;

use super::Lexer;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
use crate::Rec;
use crate::generated::Instance;
use crate::token_ids as tok;
use crate::wat_tables::GO_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "go" => Some(highlight),
        _ => None,
    }
}

/// `$goWords` as a perfect hash on a word's bytes. A word of up to 16 bytes
/// is two little-endian integers, `lo` (bytes 0-7) and `hi` (bytes 8-15),
/// zero past its end; identifiers hold no NUL, so equal integers mean equal
/// words.
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    /// The word's `keyword-table.value`.
    values: [u16; WORD_SLOTS],
    mul: u64,
}

const WORD_SLOTS: usize = 256;

/// The longest word.
const WORD_MAX: usize = 16;

/// The slot of the word whose first 8 bytes are `lo`. No two words share
/// a slot, so a name is a word only when its integers equal the slot's.
#[inline(always)]
const fn word_slot(lo: u64, mul: u64) -> usize {
    (lo.wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros())) as usize
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
    while i < GO_WORDS.len() {
        let w = GO_WORDS[i].word;
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
        while i < GO_WORDS.len() {
            let (w, value) = (GO_WORDS[i].word, GO_WORDS[i].value);
            assert!(w.len() <= WORD_MAX && value >= 0 && value < 0x10000);
            let (lo, hi) = word_key(w);
            let s = word_slot(lo, mul);
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

/// Operator bytes (`$goIsOp`).
const OPS: [bool; 256] = byteset(b"!%&*+-/<=>^|");

/// Operators that double (`&&`, `++`, `--`, `<<`, `>>`, `||`).
const DOUBLES: [bool; 256] = byteset(b"&+-<>|");

/// Byte classes for the main dispatch.
mod class {
    /// An identifier start.
    pub const IDENT: u8 = 0;
    pub const DIGIT: u8 = 1;
    pub const SLASH: u8 = 2;
    /// `"` or `'`.
    pub const QUOTE: u8 = 3;
    pub const BACKTICK: u8 = 4;
    pub const DOT: u8 = 5;
    /// `(`, `)`, `[`, `]`, `{`, `}`.
    pub const BRACKET: u8 = 6;
    /// `,`, `;`, `:`.
    pub const DELIMITER: u8 = 7;
    /// An operator byte other than `/` (`$goIsOp`).
    pub const OP: u8 = 8;
    /// Anything else: one byte colored `none`.
    pub const OTHER: u8 = 9;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 10;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    t[0] = class::NUL;
    let mut c = 1;
    while c < 256 {
        let b = c as u8;
        t[c] = if is_ident_start(b) {
            class::IDENT
        } else if is_digit(b) {
            class::DIGIT
        } else {
            match b {
                b'/' => class::SLASH,
                b'"' | b'\'' => class::QUOTE,
                b'`' => class::BACKTICK,
                b'.' => class::DOT,
                b'(' | b')' | b'[' | b']' | b'{' | b'}' => class::BRACKET,
                b',' | b';' | b':' => class::DELIMITER,
                _ if OPS[c] => class::OP,
                _ => class::OTHER,
            }
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
        t[c] = is_ident_continue(c as u8);
        c += 1;
    }
    t
};

/// The byte at `i`. Every caller reads at most 16 bytes past the input
/// end, which the 96-byte input slack covers. The byte at the input end is
/// NUL, which matches none of the bytes a lookahead tests, so a lookahead
/// one byte past a token needs no bounds check (`$goByte` returns 0 at and
/// past the end).
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

/// Whether `c` is an ASCII uppercase letter.
#[inline(always)]
const fn is_upper(c: u8) -> bool {
    c.wrapping_sub(b'A') <= 25
}

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run.
#[inline(always)]
fn whitespace_end(src: &[u8], mut p: usize) -> usize {
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
            // TAB through CR, one at a time: indentation tabs and line
            // breaks come in short runs
            p += 1;
        } else {
            return p;
        }
    }
}

/// The end of the identifier run from `p`: `[A-Za-z0-9_$]` and bytes from
/// 0x80 (`$lexScanIdent`, `$scanIdentRun`). The NUL after the input ends
/// every run.
#[inline(always)]
fn ident_end(src: &[u8], mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..4 {
        if !IDENT_CONT[at(src, p) as usize] {
            return p;
        }
        p += 1;
    }
    #[cfg(target_arch = "aarch64")]
    // SAFETY: each 16-byte load starts at or before the NUL after the
    // input, inside the slack.
    unsafe {
        loop {
            let v = vld1q_u8(src.as_ptr().add(p));
            let alpha = vcleq_u8(
                vsubq_u8(vorrq_u8(v, vdupq_n_u8(0x20)), vdupq_n_u8(b'a')),
                vdupq_n_u8(25),
            );
            let digit = vcleq_u8(vsubq_u8(v, vdupq_n_u8(b'0')), vdupq_n_u8(9));
            let extra = vorrq_u8(vceqq_u8(v, vdupq_n_u8(b'_')), vceqq_u8(v, vdupq_n_u8(b'$')));
            let high = vcltzq_s8(vreinterpretq_s8_u8(v));
            let ok = vorrq_u8(vorrq_u8(alpha, digit), vorrq_u8(extra, high));
            let nib = vget_lane_u64::<0>(vreinterpret_u64_u8(vshrn_n_u16::<4>(
                vreinterpretq_u16_u8(vmvnq_u8(ok)),
            )));
            if nib != 0 {
                return p + (nib.trailing_zeros() / 4) as usize;
            }
            p += 16;
        }
    }
    #[cfg(not(target_arch = "aarch64"))]
    {
        while is_ident_continue(at(src, p)) {
            p += 1;
        }
        p
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
/// exponents, and suffixes, with `.` only before a digit; `hex` keeps `e`
/// from taking a sign (`$lexScanNumberBody`).
#[inline(always)]
fn number_body_end(src: &[u8], mut p: usize, hex: bool) -> usize {
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

/// The end of the number at `p`, including a hexadecimal float whose
/// fraction starts with a hex letter when an exponent follows
/// (`$lexScanHexNumber` with an exponent required, `$lexScanNumber`).
fn number_end(src: &[u8], lhs: usize) -> usize {
    let hex = at(src, lhs) == b'0' && at(src, lhs + 1) | 0x20 == b'x';
    let p = number_body_end(src, lhs, hex);
    if hex && at(src, p) == b'.' {
        let next = at(src, p + 1);
        if is_hex(next) || next | 32 == b'p' {
            let mut q = p + 1;
            while is_hex(at(src, q)) || at(src, q) == b'_' {
                q += 1;
            }
            if at(src, q) | 32 != b'p' {
                return p;
            }
            q += 1;
            if at(src, q) == b'+' || at(src, q) == b'-' {
                q += 1;
            }
            if !is_digit(at(src, q)) {
                return p;
            }
            return number_body_end(src, p + 1, true);
        }
    }
    p
}

/// SCREAMING_CASE: at least two bytes, one uppercase letter, and only
/// `[A-Z0-9_]` (`$lexIsConstCase`).
fn is_const_case(src: &[u8], lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = false;
    for p in lhs..rhs {
        let c = at(src, p);
        if is_upper(c) {
            upper = true;
        } else if !(is_digit(c) || c == b'_') {
            return false;
        }
    }
    upper
}

/// The first `n` bytes at `p` as a little-endian integer, for comparing
/// short words. Reads 8 bytes, which the input slack allows.
#[inline(always)]
fn word_at(src: &[u8], p: usize, n: u32) -> u64 {
    debug_assert!(p + 8 <= src.len());
    // SAFETY: `p` lies before the input end, so `p + 8` lies inside the
    // slack.
    let w = unsafe { src.as_ptr().add(p).cast::<u64>().read_unaligned() };
    w & (u64::MAX >> (64 - 8 * n))
}

/// The color of the word `[lhs, rhs)` with the next-name capture in bits 8
/// and up (1 = function, 2 = type, 3 = namespace), or -1 for no word
/// (`$goWordHl`).
#[inline(always)]
fn word_hl(src: &[u8], lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    if n > WORD_MAX || WORD_LENGTHS[at(src, lhs) as usize] >> n & 1 == 0 {
        return -1;
    }
    let (lo, hi) = if n <= 8 {
        (word_at(src, lhs, n as u32), 0)
    } else {
        (word_at(src, lhs, 8), word_at(src, lhs + 8, n as u32 - 8))
    };
    let s = word_slot(lo, WORDS.mul);
    if WORDS.keys[s] == (lo, hi) {
        WORDS.values[s] as i32
    } else {
        -1
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

/// Lex the Go input of `len` bytes at `base` (`$hlGo`).
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
    // Append a token whose color differs from the last record's, so it
    // never merges (`$emitTok`).
    macro_rules! emit_fresh {
        ($hl:expr, $end:expr $(,)?) => {{
            let hl: u32 = $hl;
            debug_assert!(last != hl);
            // SAFETY: `cur` stays within `rp..limit`.
            unsafe {
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
    // Emit `hl` up to `end`: without the merge test when `fresh` says the
    // last record's color differs.
    macro_rules! emit_maybe_fresh {
        ($fresh:expr, $hl:expr, $end:expr) => {{
            if $fresh {
                emit_fresh!($hl, $end);
            } else {
                emit!($hl, $end);
            }
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
    // Leading whitespace (no type group is open yet); every later gap
    // follows a token's record.
    let first = whitespace_end(src, ptr);
    gap!(ptr, first);
    ptr = first;

    // The pending next-name capture: 1 = function, 2 = type, 3 = namespace,
    // 4 = the name after a receiver's `)`, a method only when its own
    // parameter list follows.
    let mut expect = 0u32;
    // after `.`: the next name is a member
    let mut member = false;
    // inside the paren right after `func`
    let mut recv = false;
    // bracket depth inside a grouped `type ( ... )` declaration
    let mut type_group = 0u32;

    // A bracket `c`: a paren right after `func` opens a receiver or a
    // literal's parameter list; its close re-arms the conditional capture
    // when a name follows on the same line. Braces end any capture.
    macro_rules! bracket {
        ($c:expr, $fresh:expr) => {{
            let c: u8 = $c;
            ptr += 1;
            emit_maybe_fresh!($fresh, tok::PUNCTUATION_BRACKET, ptr);
            member = false;
            if type_group != 0 {
                if c == b')' || c == b']' || c == b'}' {
                    type_group -= 1;
                    // the group's own `)` must not leave a capture armed by
                    // the line break before it
                    if type_group == 0 {
                        expect = 0;
                    }
                } else {
                    type_group += 1;
                }
            }
            if c == b'(' {
                if expect == 2 && type_group == 0 {
                    type_group = 1;
                }
                recv = expect == 1;
                expect = 0;
            }
            if c == b')' && recv {
                recv = false;
                if is_ident_start(at(src, skip_space_at(src, ptr))) {
                    expect = 4;
                }
            }
            if c == b'{' || c == b'}' {
                recv = false;
                expect = 0;
            }
        }};
    }
    // The `,`, `;`, `:`, or `.` delimiter `c`; `.` puts the next name in
    // member position.
    macro_rules! delimiter {
        ($c:expr, $fresh:expr) => {{
            let c: u8 = $c;
            ptr += 1;
            emit_maybe_fresh!($fresh, tok::PUNCTUATION_DELIMITER, ptr);
            member = c == b'.';
            if c == b';' {
                recv = false;
                expect = 0;
            }
        }};
    }

    loop {
        let gap = ptr;
        let s = at(src, ptr);
        if s == b' ' && !is_space(at(src, ptr + 1)) {
            // one space
            ptr += 1;
            extend!(ptr);
        } else if is_space(s) {
            ptr = whitespace_end(src, ptr + 1);
            // at depth 1 of a type group each line starts a new type spec
            if type_group == 1 && scan::line_end(src, gap, ptr) < ptr {
                expect = 2;
            }
            extend!(ptr);
        }
        let lhs = ptr;
        let c = at(src, ptr);
        let class = CLASS[c as usize];

        // Names, the most common tokens, skip the jump table.
        if class == class::IDENT {
            let mut lhs = lhs;
            let mut c = c;
            // one name, or a chain of selectors `a.b.c`
            loop {
                let rhs = ident_end(src, ptr + 1);
                ptr = rhs;
                let kind = word_hl(src, lhs, rhs);
                let hl;
                if kind >= 0 {
                    hl = kind as u32 & 255;
                    // a keyword after a receiver's `)` is a result type, not
                    // the method name
                    if expect == 4 {
                        expect = 0;
                    }
                    if kind >> 8 != 0 {
                        expect = (kind >> 8) as u32;
                    }
                } else {
                    let p = skip_space_at(src, rhs);
                    let next = at(src, p);
                    // after a receiver, only a name with its own parameter list
                    // is the method being defined
                    if expect == 4 && next != b'(' {
                        expect = 0;
                    }
                    if expect != 0 {
                        hl = if expect == 1 || expect == 4 {
                            tok::FUNCTION_DEFINITION
                        } else if expect == 3 {
                            tok::NAMESPACE
                        } else {
                            tok::TYPE
                        };
                        expect = 0;
                    } else if next == b'(' {
                        hl = if member {
                            tok::FUNCTION_METHOD
                        } else {
                            tok::FUNCTION
                        };
                    } else if member {
                        hl = tok::PROPERTY;
                    } else if (is_upper(c) || c == b'_') && is_const_case(src, lhs, rhs) {
                        // (only `[A-Z_]` can start a constant name)
                        hl = tok::CONSTANT;
                    } else if is_upper(c) {
                        hl = tok::TYPE;
                    } else {
                        hl = tok::VARIABLE;
                    }
                }
                emit!(hl, rhs);
                member = false;
                // A bracket or delimiter right after a name: its rule runs
                // here, without the gap and dispatch steps.
                let n = at(src, ptr);
                match CLASS[n as usize] {
                    // (a name's color is never a bracket's or a delimiter's)
                    class::BRACKET => bracket!(n, true),
                    class::DELIMITER => delimiter!(n, true),
                    class::DOT if is_ident_start(at(src, ptr + 1)) => {
                        // a selector: the member name follows right away
                        delimiter!(n, true);
                        lhs = ptr;
                        c = at(src, ptr);
                        continue;
                    }
                    class::DOT if !is_digit(at(src, ptr + 1)) => delimiter!(n, true),
                    _ => {}
                }
                break;
            }
            continue;
        }
        match class {
            class::SLASH if matches!(at(src, ptr + 1), b'/' | b'*') => {
                // `//` (`$lexLineComment`, `$scanToLineEnd`) and `/*`
                // (`$lexBlockComment`, `$scanBlockCommentEnd`) comments;
                // `///`, `//!`, `/**`, and `/*!` are doc comments
                let c2 = at(src, ptr + 1);
                let c3 = at(src, ptr + 2);
                let hl = if c3 == c2 || c3 == b'!' {
                    tok::COMMENT_DOC
                } else {
                    tok::COMMENT
                };
                ptr = if c2 == b'/' {
                    scan::line_end(src, ptr + 2, end)
                } else {
                    scan::block_comment_end(src, ptr + 2, end)
                };
                emit!(hl, ptr);
            }
            class::QUOTE => {
                // A one-line literal without escapes is one token; anything
                // else takes the full rules.
                let close = scan::string_special(src, ptr + 1, end, c);
                if at(src, close) == c {
                    ptr = close + 1;
                    emit!(tok::STRING, ptr);
                } else {
                    ptr = with_recs!(|recs| string(src, recs, ptr, end, c));
                }
                member = false;
            }
            class::BACKTICK => {
                // a raw string (`$lexRawString`, `$lexRawStringBody`): the
                // closing backquote is consumed
                let close = scan::find3(src, ptr + 1, end, b'`', b'`', b'`');
                ptr = if close < end { close + 1 } else { end };
                emit!(tok::STRING, ptr);
                member = false;
            }
            class::DIGIT => {
                ptr = number_end(src, ptr);
                emit!(tok::NUMBER, ptr);
                member = false;
            }
            class::DOT if is_digit(at(src, ptr + 1)) => {
                ptr = number_end(src, ptr);
                emit!(tok::NUMBER, ptr);
                member = false;
            }
            class::BRACKET => bracket!(c, false),
            class::DELIMITER | class::DOT => delimiter!(c, false),
            class::OP | class::SLASH => {
                let c2 = at(src, ptr + 1);
                ptr += 1;
                if c2 == b'=' || (c == c2 && DOUBLES[c as usize]) {
                    ptr += 1;
                    if (c == b'<' || c == b'>') && at(src, ptr) == b'=' {
                        ptr += 1;
                    }
                }
                emit!(tok::OPERATOR, ptr);
                member = false;
            }
            class::NUL if ptr >= end => break,
            _ => {
                ptr += 1;
                emit!(tok::NONE, ptr);
                member = false;
            }
        }
    }
    // SAFETY: the records before `cur` are written.
    unsafe { inst.ext.recs.set_len(cur.offset_from(rp) as usize) };
}
