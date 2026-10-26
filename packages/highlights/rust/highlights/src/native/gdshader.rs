//! WAT sources: src/langs/gdshader.wat src/langs/glsl.wat src/common.wat src/scan.wat
//!
//! Native Godot shader lexer: the GLSL lexer with Godot's words, hints, and
//! `render_mode` lists. One pass over the input: each token is scanned and
//! colored in the same step, with the same rules, in the same order, as the
//! translated `$hlGdshader` (`$hlGlslImpl` with `$godot` set). The records
//! equal the translated lexer's records.
//!
//! The WAT tests its rules in one chain. Most rules match one first byte,
//! so this lexer dispatches on a byte class and, for each class, tests only
//! the rules that can match it, in the WAT's order.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::{GD_SHADER_WORDS, GLSL_WORDS};

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "gdshader" => Some(highlight),
        _ => None,
    }
}

/// The words of `$gdShaderWords` and `$glslWords` in one perfect hash on a
/// word's bytes, each with its value in either table. `E` and
/// `hint_depth_texture`, which `$hlGlslImpl` matches outside
/// `$gdShaderWords` with the same result as a table entry, join that
/// table's words. A word of up to 32 bytes is four little-endian integers
/// (bytes 0-7, 8-15, 16-23, 24-31), zero past its end; identifiers hold no
/// NUL, so equal integers mean equal words.
struct Words {
    /// Entry number plus one for each hash slot, or 0 for no word.
    index: [u8; WORD_SLOTS],
    /// Each entry's integers; 256 entries, so an index byte needs no
    /// bounds check.
    keys: [[u64; 4]; 256],
    /// The word's `$gdShaderWords` value (its token, with 256 for a word
    /// that starts a mode list), or -1.
    gd: [i16; 256],
    /// The word's `$glslWords` value, or -1.
    glsl: [i16; 256],
    mul: u64,
}

const WORD_SLOTS: usize = 8192;

/// The `$gdShaderWords` words matched outside the table, and their values.
const GD_EXTRA_WORDS: [(&[u8], i32); 2] = [
    (b"E", tok::CONSTANT_BUILTIN as i32),
    (b"hint_depth_texture", tok::ATTRIBUTE as i32),
];

/// At most this many distinct words.
const WORD_COUNT: usize = GD_SHADER_WORDS.len() + GD_EXTRA_WORDS.len() + GLSL_WORDS.len();

/// The longest word.
const WORD_MAX: usize = 32;

/// The slot of the word with integers `k`.
#[inline(always)]
const fn word_slot(k: [u64; 4], mul: u64) -> usize {
    let h = k[0] ^ k[1].rotate_left(29) ^ k[2].rotate_left(13) ^ k[3].rotate_left(47);
    (h.wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros())) as usize
}

/// The integers of the word `w`.
const fn word_key(w: &[u8]) -> [u64; 4] {
    let mut k = [0u64; 4];
    let mut i = 0;
    while i < w.len() {
        k[i / 8] |= (w[i] as u64) << (8 * (i % 8));
        i += 1;
    }
    k
}

/// Whether two keys are equal, in a `const` context.
const fn same_key(a: [u64; 4], b: [u64; 4]) -> bool {
    a[0] == b[0] && a[1] == b[1] && a[2] == b[2] && a[3] == b[3]
}

/// Word `i`: the Godot words, then the GLSL words.
const fn word_entry(i: usize) -> (&'static [u8], i32, bool) {
    let mut i = i;
    if i < GD_SHADER_WORDS.len() {
        return (GD_SHADER_WORDS[i].word, GD_SHADER_WORDS[i].value, true);
    }
    i -= GD_SHADER_WORDS.len();
    if i < GD_EXTRA_WORDS.len() {
        return (GD_EXTRA_WORDS[i].0, GD_EXTRA_WORDS[i].1, true);
    }
    i -= GD_EXTRA_WORDS.len();
    (GLSL_WORDS[i].word, GLSL_WORDS[i].value, false)
}

/// For each first byte, a bit per length of the words in [`WORDS`]. A name
/// whose bit is clear is no word.
static WORD_LENGTHS: [u64; 256] = {
    let mut t = [0u64; 256];
    let mut i = 0;
    while i < WORD_COUNT {
        let w = word_entry(i).0;
        t[w[0] as usize] |= 1 << w.len();
        i += 1;
    }
    t
};

/// The words, placed by searching for a multiplier that gives each its own
/// slot.
static WORDS: Words = {
    let mut keys = [[0u64; 4]; 256];
    let mut gd = [-1i16; 256];
    let mut glsl = [-1i16; 256];
    let mut n = 0;
    let mut i = 0;
    while i < WORD_COUNT {
        let (w, value, is_gd) = word_entry(i);
        assert!(w.len() <= WORD_MAX && value > 0 && value < 0x8000);
        let k = word_key(w);
        let mut e = 0;
        while e < n && !same_key(keys[e], k) {
            e += 1;
        }
        if e == n {
            assert!(n < 255);
            keys[n] = k;
            n += 1;
        }
        if is_gd {
            gd[e] = value as i16;
        } else {
            glsl[e] = value as i16;
        }
        i += 1;
    }
    let mut mul: u64 = 0x2545_f491_4f6c_dd1d;
    let mut attempt = 0;
    'search: loop {
        assert!(attempt < 20_000, "no collision-free hash: use more slots");
        let mut index = [0u8; WORD_SLOTS];
        let mut e = 0;
        while e < n {
            let s = word_slot(keys[e], mul);
            if index[s] != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            index[s] = e as u8 + 1;
            e += 1;
        }
        break Words {
            index,
            keys,
            gd,
            glsl,
            mul,
        };
    }
};

/// Operator bytes (`$hlGlslImpl`'s operator rule).
const OPS: [bool; 256] = byteset(b"!%&*+-/<=>?\x5c^|~");

/// The first bytes of the names `$glslWordHl` matches outside its table:
/// sized scalars (`i`, `u`, `f`), `terminateRayEXT` (`t`), vectors and
/// matrices (`v`, `m`, `b`, `i`, `u`, `d`), and the opaque families (`s`,
/// `c`, `t`, `i`, `u`).
static FAMILY_START: [bool; 256] = byteset(b"bcdfimstuv");

/// The first bytes of the opaque sampler, image, texture, and
/// cooperative-matrix type names.
static OPAQUE_START: [bool; 256] = byteset(b"sctiu");

/// Bytes that double into a compound operator (`&&`, `++`, ...).
static DOUBLES: [bool; 256] = byteset(b"&+-<>|");

/// Byte classes for the main dispatch.
mod class {
    /// An identifier start (`$lexIsIdentStart`).
    pub const IDENT: u8 = 0;
    /// Anything else: a plain byte and any control bytes after it.
    pub const OTHER: u8 = 1;
    pub const DIGIT: u8 = 2;
    /// `"` or `'`.
    pub const QUOTE: u8 = 3;
    pub const HASH: u8 = 4;
    pub const SLASH: u8 = 5;
    pub const DOT: u8 = 6;
    /// A bracket, `,`, `;`, or `:`: one byte with its color in
    /// [`PUNCT_HL`](super::PUNCT_HL).
    pub const PUNCT: u8 = 7;
    /// An operator byte other than `/`.
    pub const OP: u8 = 8;
    /// ASCII whitespace.
    pub const SPACE: u8 = 9;
    /// NUL: the end of the input, or a plain byte inside it.
    pub const NUL: u8 = 10;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = if is_ident_start(b) {
            class::IDENT
        } else if is_digit(b) {
            class::DIGIT
        } else if is_space(b) {
            class::SPACE
        } else {
            match b {
                0 => class::NUL,
                b'"' | b'\'' => class::QUOTE,
                b'#' => class::HASH,
                b'/' => class::SLASH,
                b'.' => class::DOT,
                b'(' | b')' | b'[' | b']' | b'{' | b'}' | b',' | b';' | b':' => class::PUNCT,
                _ if OPS[c] => class::OP,
                _ => class::OTHER,
            }
        };
        c += 1;
    }
    t
};

/// The color of each [`class::PUNCT`] byte.
static PUNCT_HL: [u8; 256] = {
    let mut t = [0u8; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = match c as u8 {
            b',' | b';' | b':' => tok::PUNCTUATION_DELIMITER as u8,
            b'(' | b')' | b'[' | b']' | b'{' | b'}' => tok::PUNCTUATION_BRACKET as u8,
            _ => 0,
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

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run.
#[inline(always)]
fn whitespace_end(src: Input, mut p: usize) -> usize {
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
        // SAFETY: as above, `p` lies at or before the NUL.
        if !is_space(unsafe { src.byte_unchecked(p) }) {
            return p;
        }
        p += 1;
    }
}

/// The end of the identifier run from `p`: `[A-Za-z0-9_$]` and bytes from
/// 0x80 (`$lexScanIdent`, `$scanIdentRun`). The NUL after the input ends
/// every run.
#[inline(always)]
fn ident_end(src: Input, mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..8 {
        // SAFETY: `p` lies at or before the NUL after the input.
        if !IDENT_CONT[unsafe { src.byte_unchecked(p) } as usize] {
            return p;
        }
        p += 1;
    }
    loop {
        // SAFETY: each 16-byte load starts at or before the NUL after the
        // input, inside the slack.
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

/// The position just past the next `*/` from `p`, or `end`
/// (`$scanBlockCommentEnd`): each step tests 16 star positions against the
/// bytes after them.
#[inline(always)]
fn block_comment_end(src: Input, mut p: usize, end: usize) -> usize {
    while p < end {
        // SAFETY: `p` lies before `end`, the input end, so the 17 bytes
        // these loads read stay inside the slack.
        let (a, b) = unsafe { (src.vec_unchecked(p), src.vec_unchecked(p + 1)) };
        let k = a.eq(V::splat(b'*')).and(b.eq(V::splat(b'/'))).first();
        if k < 16 {
            return (p + k + 2).min(end);
        }
        p += 16;
    }
    end
}

/// Skip spaces and tabs from `p` on the current line (`$lexSkipSpaceAt`).
/// The NUL after the input ends every run.
#[inline(always)]
fn skip_space_at(src: Input, mut p: usize) -> usize {
    loop {
        // SAFETY: `p` starts at or before the NUL after the input, which
        // ends the run.
        let c = unsafe { src.byte_unchecked(p) };
        if c != b' ' && c != b'\t' {
            return p;
        }
        p += 1;
    }
}

/// SCREAMING_CASE: at least two bytes, one uppercase letter, and only
/// `[A-Z0-9_]` (`$lexIsConstCase`).
fn is_const_case(src: Input, lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = false;
    for p in lhs..rhs {
        // SAFETY: the name lies inside the input.
        let c = unsafe { src.byte_unchecked(p) };
        if c.wrapping_sub(b'A') <= 25 {
            upper = true;
        } else if !(is_digit(c) || c == b'_') {
            return false;
        }
    }
    upper
}

/// The first `n` bytes at `p` as a little-endian integer. Reads 8 bytes,
/// which the input slack allows.
///
/// # Safety
/// `p` must be at most the input end.
#[inline(always)]
unsafe fn word_at(src: Input, p: usize, n: u32) -> u64 {
    // SAFETY: `p` is at most the input end, so its 8 bytes lie inside the
    // slack.
    low_bytes(unsafe { src.word_unchecked(p) }, n)
}

/// The first `n` bytes of the little-endian integer `w`.
#[inline(always)]
const fn low_bytes(w: u64, n: u32) -> u64 {
    w & (u64::MAX >> (64 - 8 * n))
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

/// The number at `p`: radix digits, separators, exponents, and suffixes,
/// with `.` only before a digit (`$lexScanNumber`, `$lexScanNumberBody`).
/// The NUL after the input ends every number.
#[inline(always)]
fn number_body(src: Input, mut p: usize, hex: bool) -> usize {
    let mut prev = 0u8;
    loop {
        // SAFETY: the number starts inside the input and the NUL after it
        // ends the run, so `p` stays at or before the NUL.
        let c = unsafe { src.byte_unchecked(p) };
        if IDENT_CONT[c as usize] {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            // SAFETY: `p` lies before the NUL, at `.`.
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

/// The end of the number at `lhs`, with hexadecimal floats whose fraction
/// may start with an a-f digit or be empty (`$lexScanHexNumber` with no
/// required exponent).
#[inline(always)]
fn hex_number_end(src: Input, lhs: usize) -> usize {
    // SAFETY: the number starts inside the input, so `lhs + 1` is at most
    // the NUL after it, and the number ends at or before that NUL.
    let hex =
        unsafe { src.byte_unchecked(lhs) == b'0' && src.byte_unchecked(lhs + 1) | 0x20 == b'x' };
    let p = number_body(src, lhs, hex);
    if hex && unsafe { src.byte_unchecked(p) } == b'.' {
        hex_fraction(src, p)
    } else {
        p
    }
}

/// The rest of a hexadecimal number from its `.` at `p`: the fraction and
/// exponent when they form a hexadecimal float, or `p` (the tail of
/// `$lexScanHexNumber`).
#[cold]
#[inline(never)]
fn hex_fraction(src: Input, p: usize) -> usize {
    let next = src.byte(p + 1);
    if !(is_hex(next) || next | 32 == b'p') {
        return p;
    }
    if next | 32 == b'p' {
        let mut q = p + 1;
        while is_hex(src.byte(q)) || src.byte(q) == b'_' {
            q += 1;
        }
        if src.byte(q) | 32 != b'p' {
            return p;
        }
        q += 1;
        if src.byte(q) == b'+' || src.byte(q) == b'-' {
            q += 1;
        }
        if !is_digit(src.byte(q)) {
            return p;
        }
    }
    number_body(src, p + 1, true)
}

/// The end of at most `max` hex digits from `p` (`$scanHexRun`).
fn hex_run(src: Input, mut p: usize, max: usize, end: usize) -> usize {
    let stop = (p + max).min(end);
    // SAFETY: `p` is below `stop`, at most the input end.
    while p < stop && is_hex(unsafe { src.byte_unchecked(p) }) {
        p += 1;
    }
    p
}

/// The end of the escape at backslash `p`: one character, kept whole when
/// it is UTF-8, and CRLF as one (`$lexEscapeEnd`).
fn escape_end(src: Input, p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(src.bytes(), p + 2, end);
    // SAFETY: the backslash at `p` lies inside the input, so `p + 1` is at
    // most the NUL after it, and `e` is below the input end (tested first).
    if e == p + 2
        && unsafe { src.byte_unchecked(p + 1) } == b'\r'
        && e < end
        && unsafe { src.byte_unchecked(e) } == b'\n'
    {
        e += 1;
    }
    e
}

/// The end of the C escape at backslash `p` (`$lexCEscapeEnd`).
fn c_escape_end(src: Input, p: usize, end: usize) -> usize {
    // SAFETY (the reads in this function): each is below the input end
    // (tested before it).
    let c = if p + 1 < end {
        unsafe { src.byte_unchecked(p + 1) }
    } else {
        0
    };
    let mut e = p + 2;
    if c == b'u' {
        e = hex_run(src, e, 4, end);
    } else if c == b'U' {
        e = hex_run(src, e, 8, end);
    } else if c == b'x' {
        e = hex_run(src, e, 64, end);
    } else if c == b'N' && e < end && unsafe { src.byte_unchecked(e) } == b'{' {
        e += 1;
        while e < end {
            let c = unsafe { src.byte_unchecked(e) };
            if c == b'\n' || c == b'\r' || c == b'"' || c == b'\'' || c == b'\\' {
                break;
            }
            e += 1;
            if c == b'}' {
                break;
            }
        }
    } else if c.wrapping_sub(b'0') <= 7 {
        // the first digit is already in; take up to two more
        while e < end && e - p < 4 && unsafe { src.byte_unchecked(e) }.wrapping_sub(b'0') <= 7 {
            e += 1;
        }
    } else {
        e = escape_end(src, p, end);
    }
    scan::utf8_span_end(src.bytes(), e, end)
}

/// The rest of a C literal from the backslash at `p`, with quote `q`; the
/// pending string token starts at `seg`. Emits the body as a string, with
/// escapes as `string.escape`, and returns its end (the escape loop of
/// `$lexCStringBody`, without a suffix).
#[inline(never)]
fn c_string_escapes(
    src: Input,
    mut out: Recs,
    mut p: usize,
    end: usize,
    q: u8,
    mut seg: usize,
) -> (Recs, usize) {
    loop {
        // `p` is at a backslash
        if seg < p {
            out.tok(tok::STRING, p);
        }
        let e = c_escape_end(src, p, end);
        out.tok(tok::STRING_ESCAPE, e);
        p = e;
        seg = e;
        // an escaped line break that ends the input leaves the literal open
        // SAFETY: `p - 1` is the escape's last byte, inside the input.
        if p == end
            && (unsafe { src.byte_unchecked(p - 1) } == b'\n'
                || unsafe { src.byte_unchecked(p - 1) } == b'\r')
        {
            break;
        }
        if p < end {
            p = scan::string_special(src.bytes(), p, end, q);
        }
        if p >= end {
            break;
        }
        // SAFETY: `p` is below the input end (tested above).
        let c = unsafe { src.byte_unchecked(p) };
        if c == q {
            p += 1;
            break;
        }
        // a raw line break: unterminated, left unconsumed
        if c != b'\\' {
            break;
        }
    }
    if seg < p {
        out.tok(tok::STRING, p);
    }
    (out, p)
}

/// The C literal from the opening quote at `lhs`, without a suffix: its
/// body as a string, with escapes as `string.escape`. Returns its end
/// (`$lexCString`, `$lexCStringBody`).
#[inline(always)]
fn c_string(src: Input, out: Recs, lhs: usize, end: usize) -> (Recs, usize) {
    let mut out = out;
    // SAFETY: the quote at `lhs` lies inside the input, and the body ends
    // at or before the input end.
    let q = unsafe { src.byte_unchecked(lhs) };
    let p = scan::string_special(src.bytes(), lhs + 1, end, q);
    let c = unsafe { src.byte_unchecked(p) };
    if p < end && c == b'\\' {
        return c_string_escapes(src, out, p, end, q, lhs);
    }
    // closed, or ended by a raw line break or the input end
    let p = p + (p < end && c == q) as usize;
    out.tok(tok::STRING, p);
    (out, p)
}

/// The entry of the name `[lhs, rhs)`, whose first byte is `c`, in
/// [`WORDS`], if it is a word of either table.
#[inline(always)]
fn lookup(src: Input, lhs: usize, rhs: usize, c: u8) -> Option<usize> {
    let n = rhs - lhs;
    if n > WORD_MAX || WORD_LENGTHS[c as usize] >> (n & 63) & 1 == 0 {
        return None;
    }
    // The first `m` bytes at `p`.
    // SAFETY: every read below starts inside the name, which ends at or
    // before the input end, so its 8 bytes stay inside the slack.
    let at = |p: usize, m: u32| low_bytes(unsafe { src.word_unchecked(p) }, m);
    let k = if n <= 8 {
        // most words: one integer
        [at(lhs, n as u32), 0, 0, 0]
    } else {
        let part = |i: usize| {
            if n > 8 * i {
                at(lhs + 8 * i, (n - 8 * i).min(8) as u32)
            } else {
                0
            }
        };
        [at(lhs, 8), part(1), part(2), part(3)]
    };
    let e = WORDS.index[word_slot(k, WORDS.mul)] as usize;
    let key = &WORDS.keys[e.wrapping_sub(1) & 255];
    if e != 0 && (key[0] ^ k[0]) | (key[1] ^ k[1]) | (key[2] ^ k[2]) | (key[3] ^ k[3]) == 0 {
        Some(e - 1)
    } else {
        None
    }
}

/// Whether the name `[lhs, rhs)` is a `$gdShaderWords` attribute with an
/// `_anisotropic` suffix, such as `filter_linear_mipmap_anisotropic`, which
/// the table cannot hold (`$hlGlslImpl`'s Godot word rule). `c` is its
/// first byte.
#[inline(always)]
fn anisotropic(src: Input, lhs: usize, rhs: usize, c: u8) -> bool {
    (rhs - lhs).wrapping_sub(32) <= 1
        // SAFETY: both reads start inside the name, which has 32 or 33 bytes.
        && unsafe { word_at(src, rhs - 12, 8) } == word(b"_anisotr")
        && unsafe { word_at(src, rhs - 4, 4) } == word(b"opic")
        && lookup(src, lhs, rhs - 12, c).is_some_and(|e| WORDS.gd[e] == tok::ATTRIBUTE as i16)
}

/// The built-in color of the name `[lhs, rhs)`, or `tok::NONE`: the table
/// words, the sized scalar types, `terminateRayEXT`, the vector and matrix
/// types, and the opaque sampler, image, texture, and cooperative-matrix
/// families (`$glslWordHl`); `entry` is the name's [`lookup`] and `c` its
/// first byte.
#[inline(always)]
fn glsl_word_hl(src: Input, entry: Option<usize>, lhs: usize, rhs: usize, c: u8) -> u32 {
    if let Some(e) = entry
        && WORDS.glsl[e] >= 0
    {
        return WORDS.glsl[e] as u32;
    }
    let len = rhs - lhs;
    // The first `n` bytes at `p`.
    // SAFETY: every read below starts inside the name, which lies inside
    // the input, so its 8 bytes stay inside the slack.
    let at = |p: usize, n: u32| low_bytes(unsafe { src.word_unchecked(p) }, n);
    let word32 = |p: usize| at(p, 4) as u32;
    // (every family below starts with one of these bytes)
    if !FAMILY_START[c as usize] {
        return tok::NONE;
    }

    // intN_t, uintN_t, and floatN_t for N of 16, 32, 64
    if len >= 7 {
        let w = word32(rhs - 4);
        if (w == word(b"16_t") as u32 || w == word(b"32_t") as u32 || w == word(b"64_t") as u32)
            && ((len == 7 && at(lhs, 3) == word(b"int"))
                || (len == 8 && word32(lhs) == word(b"uint") as u32)
                || (len == 9 && at(lhs, 5) == word(b"float")))
        {
            return tok::TYPE_BUILTIN;
        }
    }

    if len == 15 && at(lhs, 8) == word(b"terminat") && at(lhs + 7, 8) == word(b"teRayEXT") {
        return tok::KEYWORD_CONTROL;
    }

    // vecN/matN, their typed forms, and rectangular matrices
    // SAFETY: the name's bytes lie inside the input.
    let last = unsafe { src.byte_unchecked(rhs - 1) };
    if last.wrapping_sub(b'2') <= 2 {
        if len == 4 {
            let w = at(lhs, 3);
            if w == word(b"vec") || w == word(b"mat") {
                return tok::TYPE_BUILTIN;
            }
        }
        if len == 5 {
            let w = word32(lhs);
            if w == word(b"bvec") as u32
                || w == word(b"ivec") as u32
                || w == word(b"uvec") as u32
                || w == word(b"dvec") as u32
                || w == word(b"dmat") as u32
            {
                return tok::TYPE_BUILTIN;
            }
        }
        if len == 6
            && at(lhs, 3) == word(b"mat")
            // SAFETY: inside the name of 6 bytes.
            && unsafe { src.byte_unchecked(lhs + 3) }.wrapping_sub(b'2') <= 2
            && unsafe { src.byte_unchecked(lhs + 4) } == b'x'
        {
            return tok::TYPE_BUILTIN;
        }
        if len == 7
            && word32(lhs) == word(b"dmat") as u32
            // SAFETY: inside the name of 7 bytes.
            && unsafe { src.byte_unchecked(lhs + 4) }.wrapping_sub(b'2') <= 2
            && unsafe { src.byte_unchecked(lhs + 5) } == b'x'
        {
            return tok::TYPE_BUILTIN;
        }
    }

    // The opaque families, with an optional `i`/`u` element prefix of `w`
    // bytes and `x` the next seven bytes. Bare `texture` is a function.
    // (each family starts with `s`, `c`, `t`, or the `i`/`u` prefix)
    if !OPAQUE_START[c as usize] {
        return tok::NONE;
    }
    let w = (c == b'i' || c == b'u') as usize;
    let x = at(lhs + w, 7);
    if (len - w >= 7 && (x == word(b"sampler") || (w == 0 && x == word(b"coopmat"))))
        || (len >= 8 && x == word(b"texture"))
        // `image` itself starts with the `i` taken for a prefix
        || (w != 0
            && ((len >= 5 && at(lhs, 5) == word(b"image"))
                || (len >= 6 && x & 0xff_ffff_ffff == word(b"image"))))
    {
        return tok::TYPE_BUILTIN;
    }
    tok::NONE
}

/// The end of the operator at `p`, whose first byte is `c`: at most three
/// bytes (`$hlGlslImpl`'s operator rule).
#[inline(always)]
fn operator_end(src: Input, p: usize, c: u8) -> usize {
    // SAFETY: the operator byte at `p` lies inside the input, so the two
    // bytes after it lie at most one past the NUL.
    let n = unsafe { src.byte_unchecked(p + 1) };
    let mut p = p + 1;
    if n == b'=' || (n == c && DOUBLES[c as usize]) {
        p += 1;
        // SAFETY: as above.
        if (c == b'<' || c == b'>') && unsafe { src.byte_unchecked(p) } == b'=' {
            p += 1;
        }
    }
    p
}

/// Lex the Godot shader input of `len` bytes at `base` (`$hlGdshader`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: `base..base + len` plus the slack lies inside lexer memory,
    // and this lexer calls no translated code, so memory stays in place.
    let src = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut out = Recs::load(inst);

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src.bytes(), 0, end);
    out.gap(0, ptr);
    // after a `.`: a name is a member
    let mut after_dot = false;
    // after `struct`: a name is a type
    let mut want_type = false;
    // after `#include`: `<` opens a header path
    let mut include = false;
    // inside a `shader_type` or `render_mode` list: names are keywords
    let mut modes = false;
    // Leading whitespace; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    out.gap(ptr, first);
    ptr = first;

    // Every token ends at or before the input end, so `ptr` stays at or
    // before the NUL and its lookahead bytes inside the slack.
    loop {
        // SAFETY: `ptr` lies at or before the NUL (above).
        let mut c = unsafe { src.byte_unchecked(ptr) };
        let mut class = CLASS[c as usize];
        if class == class::SPACE {
            // whitespace gaps
            // SAFETY: `ptr` lies before the NUL, at whitespace.
            let next = unsafe { src.byte_unchecked(ptr + 1) };
            let next_class = CLASS[next as usize];
            if c == b' ' && next_class != class::SPACE {
                // one space
                ptr += 1;
                c = next;
                class = next_class;
            } else {
                ptr = whitespace_end(src, ptr + 1);
                // SAFETY: the NUL after the input ends the whitespace.
                c = unsafe { src.byte_unchecked(ptr) };
                class = CLASS[c as usize];
            }
            // SAFETY: the leading gap and every token before this one
            // wrote a record.
            unsafe { out.extend_unchecked(ptr) };
        }
        let lhs = ptr;
        // a mode list runs through names and commas; comments and an
        // include path keep it as it was
        let modes_before = modes;
        modes &= class == class::IDENT || c == b',';
        match class {
            class::IDENT => {
                ptr = ident_end(src, ptr + 1);
                let entry = lookup(src, lhs, ptr, c);
                let mut hl = tok::NONE;
                if modes {
                    hl = tok::KEYWORD;
                } else {
                    let g = entry.map_or(-1, |e| WORDS.gd[e]);
                    if g >= 0 {
                        hl = g as u32 & 255;
                        modes = g >> 8 != 0;
                    } else if anisotropic(src, lhs, ptr, c) {
                        hl = tok::ATTRIBUTE;
                    }
                }
                if hl == tok::NONE {
                    hl = glsl_word_hl(src, entry, lhs, ptr, c);
                }
                if hl == tok::NONE {
                    hl = if want_type {
                        tok::TYPE
                    // SAFETY: the name starts inside the input.
                    } else if ptr - lhs >= 3 && unsafe { word_at(src, lhs, 3) } == word(b"gl_") {
                        tok::VARIABLE_SPECIAL
                    // SAFETY: the run of blanks after the name ends at or
                    // before the NUL after the input.
                    } else if unsafe { src.byte_unchecked(skip_space_at(src, ptr)) } == b'(' {
                        if after_dot {
                            tok::FUNCTION_METHOD
                        } else {
                            tok::FUNCTION
                        }
                    } else if after_dot {
                        tok::PROPERTY
                    } else if (c.wrapping_sub(b'A') <= 25 || c == b'_')
                        && is_const_case(src, lhs, ptr)
                    {
                        // (only `[A-Z_]` can start a constant name)
                        tok::CONSTANT
                    } else if c.wrapping_sub(b'A') <= 25 {
                        tok::TYPE
                    } else {
                        tok::VARIABLE
                    };
                }
                out.tok(hl, ptr);
                want_type = hl == tok::KEYWORD_DECLARATION;
                after_dot = false;
                include = false;
                // a bracket or delimiter right after a name: its rule runs
                // here, without the gap and dispatch steps
                // SAFETY: the name ends at or before the NUL.
                let next = unsafe { src.byte_unchecked(ptr) };
                if CLASS[next as usize] == class::PUNCT {
                    ptr += 1;
                    out.tok(PUNCT_HL[next as usize] as u32, ptr);
                    want_type = false;
                    modes &= next == b',';
                }
            }
            class::HASH => {
                // `#directive`, with the blanks before its name, is one
                // preproc token
                ptr = skip_space_at(src, ptr + 1);
                let word_start = ptr;
                // SAFETY: the blanks end at or before the NUL after the input.
                if IDENT_CONT[unsafe { src.byte_unchecked(ptr) } as usize] {
                    ptr = ident_end(src, ptr);
                }
                // SAFETY: `word_start` is at most the input end (above).
                include = ptr - word_start == 7
                    && unsafe { word_at(src, word_start, 7) } == word(b"include");
                out.tok(tok::PREPROC, ptr);
                after_dot = false;
                want_type = false;
                modes = false;
            }
            class::OP if include && c == b'<' => {
                // an angle-bracket include path is a string
                ptr += 1;
                loop {
                    // SAFETY: the loop stops at the input end, so `ptr` is at
                    // most the NUL after it.
                    let c = unsafe { src.byte_unchecked(ptr) };
                    if ptr >= end || c == b'\n' || c == b'\r' {
                        break;
                    }
                    ptr += 1;
                    if c == b'>' {
                        break;
                    }
                }
                out.tok(tok::STRING, ptr);
                include = false;
                after_dot = false;
                want_type = false;
                modes = modes_before;
            }
            // SAFETY (the lookaheads of the comment and number rules): the
            // byte at `ptr` lies inside the input, so `ptr + 2` is at most one
            // past the NUL after it.
            class::SLASH if unsafe { src.byte_unchecked(ptr + 1) } == b'/' => {
                // Doxygen `///` and `//!` are doc comments
                let n = unsafe { src.byte_unchecked(ptr + 2) };
                let hl = if n == b'/' || n == b'!' {
                    tok::COMMENT_DOC
                } else {
                    tok::COMMENT
                };
                ptr = scan::line_end(src.bytes(), ptr + 2, end);
                out.tok(hl, ptr);
                modes = modes_before;
            }
            class::SLASH if unsafe { src.byte_unchecked(ptr + 1) } == b'*' => {
                let n = unsafe { src.byte_unchecked(ptr + 2) };
                let hl = if n == b'*' || n == b'!' {
                    tok::COMMENT_DOC
                } else {
                    tok::COMMENT
                };
                ptr = block_comment_end(src, ptr + 2, end);
                out.tok(hl, ptr);
                modes = modes_before;
            }
            class::QUOTE => {
                (out, ptr) = c_string(src, out, lhs, end);
                include = false;
                after_dot = false;
                want_type = false;
            }
            class::DIGIT => {
                ptr = hex_number_end(src, ptr);
                out.tok(tok::NUMBER, ptr);
                include = false;
                after_dot = false;
                want_type = false;
            }
            class::DOT if is_digit(unsafe { src.byte_unchecked(ptr + 1) }) => {
                ptr = hex_number_end(src, ptr);
                out.tok(tok::NUMBER, ptr);
                include = false;
                after_dot = false;
                want_type = false;
            }
            class::PUNCT => {
                ptr += 1;
                out.tok(PUNCT_HL[c as usize] as u32, ptr);
                include = false;
                after_dot = false;
                want_type = false;
            }
            class::DOT => {
                ptr += 1;
                out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                include = false;
                after_dot = true;
                want_type = false;
            }
            class::OP | class::SLASH => {
                ptr = operator_end(src, ptr, c);
                out.tok(tok::OPERATOR, ptr);
                include = false;
                after_dot = false;
                want_type = false;
            }
            class::NUL if ptr >= end => break,
            _ => {
                // a plain byte, and the control bytes after it
                ptr += 1;
                loop {
                    // SAFETY: the loop stops at the input end, so `ptr` is at
                    // most the NUL after it.
                    let c = unsafe { src.byte_unchecked(ptr) };
                    if ptr >= end || c >= 32 || c.wrapping_sub(9) <= 4 {
                        break;
                    }
                    ptr += 1;
                }
                out.tok(tok::NONE, ptr);
                include = false;
                after_dot = false;
                want_type = false;
            }
        }
    }
    out.store(inst);
}
