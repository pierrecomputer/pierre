//! WAT sources: src/langs/java.wat src/common.wat src/scan.wat
//!
//! Native Java lexer. One pass over the input: each token is scanned and
//! colored in the same step, with the same rules, in the same order, as the
//! translated `$hlJava`. The records equal the translated lexer's records.
//!
//! The WAT tests its rules in one long chain. Each rule matches its own
//! first bytes, so this lexer dispatches on the first byte's class and, for
//! each class, tests only the rules that can match it, in the WAT's order.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::JAVA_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "java" => Some(highlight),
        _ => None,
    }
}

/// `$javaWords` as a perfect hash on a word's bytes. A word of up to 16
/// bytes is two little-endian integers, `lo` (bytes 0-7) and `hi` (bytes
/// 8-15), zero past its end; identifiers hold no NUL, so equal integers
/// mean equal words. Each word has its own slot, found from `lo` alone.
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    /// The word's `keyword-table.value`: its token in the low byte, the
    /// next-name capture in bits 8-9 (1 = type, 2 = namespace), and bit 10
    /// for the contextual `record`.
    values: [i32; WORD_SLOTS],
    /// For each first byte, a bit per length of the words starting with it.
    lengths: [u32; 256],
    mul: u64,
}

const WORD_SLOTS: usize = 256;

/// The longest word.
const WORD_MAX: usize = 12;

/// The slot of the word whose first 8 bytes are `lo`.
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

/// The words, placed by searching for a multiplier that gives each its own
/// slot.
static WORDS: Words = {
    let mut lengths = [0u32; 256];
    let mut i = 0;
    while i < JAVA_WORDS.len() {
        let w = JAVA_WORDS[i].word;
        assert!(w.len() <= WORD_MAX);
        lengths[w[0] as usize] |= 1 << w.len();
        i += 1;
    }
    let mut mul: u64 = 0x2545_f491_4f6c_dd1d;
    let mut attempt = 0;
    'search: loop {
        assert!(attempt < 100_000, "no collision-free hash: use more slots");
        let mut keys = [(0u64, 0u64); WORD_SLOTS];
        let mut values = [-1i32; WORD_SLOTS];
        let mut i = 0;
        while i < JAVA_WORDS.len() {
            let (lo, hi) = word_key(JAVA_WORDS[i].word);
            let s = word_slot(lo, mul);
            if keys[s].0 != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            keys[s] = (lo, hi);
            values[s] = JAVA_WORDS[i].value;
            i += 1;
        }
        break Words {
            keys,
            values,
            lengths,
            mul,
        };
    }
};

/// The value of the word `[lhs, rhs)` in `$javaWords`, or -1 when it is
/// none (`$javaWordHl`).
#[inline(always)]
fn word_value(src: Input, lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    // SAFETY: `lhs` lies inside the input, so 16 bytes from it lie inside
    // the slack.
    if n > WORD_MAX || WORDS.lengths[unsafe { src.byte_unchecked(lhs) } as usize] >> n & 1 == 0 {
        return -1;
    }
    // SAFETY: as above.
    let lo =
        unsafe { src.word_unchecked(lhs) } & if n >= 8 { u64::MAX } else { (1 << (8 * n)) - 1 };
    // (`n` is at most 12, so the shift stays below 64)
    // SAFETY: as above.
    let hi = unsafe { src.word_unchecked(lhs + 8) } & ((1 << (8 * n.saturating_sub(8))) - 1);
    let s = word_slot(lo, WORDS.mul);
    if WORDS.keys[s] == (lo, hi) {
        WORDS.values[s]
    } else {
        -1
    }
}

/// Operator bytes that double: `&&`, `++`, `--`, `<<`, `>>`, `||`.
static DOUBLES: [bool; 256] = byteset(b"&+-<>|");

/// Byte classes for the main dispatch.
mod class {
    /// An identifier start: a letter, `_`, `$`, or any byte from 0x80.
    pub const IDENT: u8 = 0;
    /// Anything else: one byte colored `none`.
    pub const OTHER: u8 = 1;
    pub const DIGIT: u8 = 2;
    pub const SLASH: u8 = 3;
    pub const DQUOTE: u8 = 4;
    pub const SQUOTE: u8 = 5;
    pub const AT: u8 = 6;
    /// `(`, `)`, `{`, or `}`: brackets that end a pending type.
    pub const BRACKET: u8 = 7;
    /// `[` or `]`: array brackets, which keep a type pending.
    pub const SQUARE: u8 = 8;
    pub const COMMA: u8 = 9;
    pub const SEMICOLON: u8 = 10;
    pub const COLON: u8 = 11;
    pub const DOT: u8 = 12;
    /// An operator byte other than `/` (`$javaIsOp`).
    pub const OP: u8 = 13;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 14;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let ops = byteset(b"!%&*+-<=>?^|~");
    let mut t = [class::OTHER; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = if is_ident_start(b) {
            class::IDENT
        } else if is_digit(b) {
            class::DIGIT
        } else {
            match b {
                0 => class::NUL,
                b'/' => class::SLASH,
                b'"' => class::DQUOTE,
                b'\'' => class::SQUOTE,
                b'@' => class::AT,
                b'(' | b')' | b'{' | b'}' => class::BRACKET,
                b'[' | b']' => class::SQUARE,
                b',' => class::COMMA,
                b';' => class::SEMICOLON,
                b':' => class::COLON,
                b'.' => class::DOT,
                _ if ops[c] => class::OP,
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

/// Whether `c` is an ASCII capital letter.
#[inline(always)]
const fn is_upper(c: u8) -> bool {
    c.wrapping_sub(b'A') <= 25
}

/// The end of the whitespace run from `p` (`$scanWhitespace`). The NUL
/// after the input ends every run.
#[inline(always)]
fn whitespace_end(src: Input, mut p: usize) -> usize {
    loop {
        // Skip spaces 8 bytes at a time, then step over one other
        // whitespace byte (TAB to CR) and go on.
        // SAFETY: `p` lies at or before the NUL after the input, which
        // ends every run, so 8 bytes from it lie inside the slack.
        let w = unsafe { src.word_unchecked(p) };
        let x = w ^ 0x2020_2020_2020_2020;
        let other =
            (((x & 0x7f7f_7f7f_7f7f_7f7f) + 0x7f7f_7f7f_7f7f_7f7f) | x) & 0x8080_8080_8080_8080;
        if other == 0 {
            p += 8;
            continue;
        }
        p += (other.trailing_zeros() / 8) as usize;
        // SAFETY: as above.
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
        // SAFETY: `p` starts at or before the NUL after the input, and the
        // NUL ends the run, so `p` never passes it.
        if !IDENT_CONT[unsafe { src.byte_unchecked(p) } as usize] {
            return p;
        }
        p += 1;
    }
    loop {
        // SAFETY: as above, `p` lies at or before the NUL, so 16 bytes
        // from it lie inside the slack.
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
    // SAFETY: `p` starts at or before the NUL after the input, which ends
    // the run, so `p` never passes it.
    while unsafe { src.byte_unchecked(p) } == b' ' || unsafe { src.byte_unchecked(p) } == b'\t' {
        p += 1;
    }
    p
}

/// SCREAMING_CASE: at least two bytes, one uppercase letter, and only
/// `[A-Z0-9_]` (`$lexIsConstCase`).
#[inline(always)]
fn is_const_case(src: Input, lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = false;
    for p in lhs..rhs {
        // SAFETY: the name `[lhs, rhs)` lies inside the input.
        let c = unsafe { src.byte_unchecked(p) };
        if is_upper(c) {
            upper = true;
        } else if !(is_digit(c) || c == b'_') {
            return false;
        }
    }
    upper
}

/// Whether the operator `[lhs, rhs)` is made only of `<`, `>`, and `?`
/// (`$lexIsTypeGlue`).
#[inline(always)]
fn is_type_glue(src: Input, lhs: usize, rhs: usize) -> bool {
    // SAFETY: the operator `[lhs, rhs)` lies inside the input.
    (lhs..rhs).all(|p| matches!(unsafe { src.byte_unchecked(p) }, b'<' | b'>' | b'?'))
}

/// The end of the number body from `p`: radix digits, separators,
/// exponents, and suffixes, with `.` only before a digit
/// (`$lexScanNumberBody`).
#[inline(always)]
fn number_body_end(src: Input, mut p: usize, hex: bool) -> usize {
    let mut prev = 0u8;
    loop {
        // SAFETY: `p` starts inside the input and the NUL after it ends the
        // number, so `p` never passes the NUL.
        let c = unsafe { src.byte_unchecked(p) };
        if IDENT_CONT[c as usize] {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            // SAFETY: `p` is below `end`.
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

/// The end of the number at `lhs`, with hexadecimal floats requiring an
/// exponent (`$lexScanHexNumber` with `$requireExponent` 1,
/// `$lexScanNumber`).
#[inline(always)]
fn number_end(src: Input, lhs: usize) -> usize {
    // SAFETY: `lhs` lies inside the input, and the number ends at or
    // before the NUL after it.
    let hex =
        unsafe { src.byte_unchecked(lhs) == b'0' && src.byte_unchecked(lhs + 1) | 32 == b'x' };
    let ptr = number_body_end(src, lhs, hex);
    // SAFETY: as above.
    if hex && unsafe { src.byte_unchecked(ptr) } == b'.' {
        core::hint::cold_path();
        return hex_fraction_end(src, ptr);
    }
    ptr
}

/// The end of a hexadecimal number whose run stopped at the `.` at `ptr`:
/// the fraction counts only with a binary exponent (`$lexScanHexNumber`).
#[cold]
#[inline(never)]
fn hex_fraction_end(src: Input, ptr: usize) -> usize {
    let next = src.byte(ptr + 1);
    if !(is_hex(next) || next | 32 == b'p') {
        return ptr;
    }
    let mut p = ptr + 1;
    while is_hex(src.byte(p)) || src.byte(p) == b'_' {
        p += 1;
    }
    if src.byte(p) | 32 != b'p' {
        return ptr;
    }
    p += 1;
    if src.byte(p) == b'+' || src.byte(p) == b'-' {
        p += 1;
    }
    if !is_digit(src.byte(p)) {
        return ptr;
    }
    number_body_end(src, ptr + 1, true)
}

/// The end of the escape at backslash `p`: one character, kept whole when
/// it is UTF-8, and CRLF as one (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(src: Input, p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(src.bytes(), p + 2, end);
    // SAFETY: the backslash at `p` is an input byte, and `e` is below `end`.
    if e == p + 2
        && unsafe { src.byte_unchecked(p + 1) } == b'\r'
        && e < end
        && unsafe { src.byte_unchecked(e) } == b'\n'
    {
        e += 1;
    }
    e
}

/// Emit the string bytes `[seg, p)`, then the escape at backslash `p`.
/// Returns the escape's end (`$stringEscapeAt`).
#[inline(always)]
fn string_escape_at(src: Input, out: &mut Recs, seg: usize, p: usize, end: usize) -> usize {
    out.emit(tok::STRING, seg, p);
    let e = escape_end(src, p, end);
    out.tok(tok::STRING_ESCAPE, e);
    e
}

/// The rest of the quoted literal opened at `seg`, from `p`, where the
/// first quote, backslash, or line break after the opening quote is: escapes
/// get their own tokens, and a raw line break ends it unterminated. Returns
/// its end (`$lexString` with `$multiline` 0, `$lexStringBody`).
#[cold]
#[inline(never)]
fn string_rest(src: Input, out: &mut Recs, mut seg: usize, mut p: usize, end: usize) -> usize {
    let s = &src.bytes()[..end];
    let quote = s[seg];
    loop {
        if p >= end {
            break;
        }
        let c = s[p];
        if c == quote {
            p += 1;
            break;
        }
        if c != b'\\' {
            break;
        }
        p = string_escape_at(src, out, seg, p, end);
        seg = p;
        p = scan::string_special(src.bytes(), p, end, quote);
    }
    out.emit(tok::STRING, seg, p);
    p
}

/// A text block body from `p` through the closing `"""`, or to the end;
/// escapes get their own tokens (`$javaTextBlockBody`). Returns its end.
#[inline(never)]
fn text_block_body(src: Input, out: &mut Recs, mut p: usize, end: usize) -> usize {
    let mut seg = p;
    loop {
        p = scan::find3(src.bytes(), p, end, b'"', b'\\', b'"');
        if p >= end {
            break;
        }
        // SAFETY: `p` is below `end`, so `p + 2` is at most one past the
        // input end.
        if unsafe { src.byte_unchecked(p) } == b'"' {
            // SAFETY: as above.
            if unsafe { src.byte_unchecked(p + 1) == b'"' && src.byte_unchecked(p + 2) == b'"' } {
                p += 3;
                out.tok(tok::STRING, p);
                return p;
            }
            p += 1;
            continue;
        }
        p = string_escape_at(src, out, seg, p, end);
        seg = p;
    }
    out.emit(tok::STRING, seg, p);
    p
}

/// Lex the Java input of `len` bytes at `base` (`$hlJava`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: `base..base + len + SLACK` lies inside lexer memory, which
    // stays in place while this lexer runs: it calls no translated code.
    let src = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut out = Recs::load(inst);

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src.bytes(), 0, end);
    out.gap(0, ptr);
    // Leading whitespace; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    out.gap(ptr, first);
    ptr = first;

    // the pending next-name capture: 1 = type, 2 = namespace
    let mut expect = 0u32;
    // right after `.` or `::`
    let mut member = false;
    // right after a type, through the glue of a generic or array type
    let mut after_type = false;

    // Call the out-of-line helper `f(src, out, args…)` on a copy of `out`,
    // then take the copy back, so `out` itself never leaves registers.
    macro_rules! with_copy {
        ($f:ident($($a:expr),*)) => {{
            let mut copy = out;
            let r = $f(src, &mut copy, $($a),*);
            out = copy;
            r
        }};
    }

    // The `(`, `)`, `{`, or `}` token.
    macro_rules! bracket {
        () => {{
            ptr += 1;
            out.tok(tok::PUNCTUATION_BRACKET, ptr);
            member = false;
            after_type = false;
            expect = 0;
        }};
    }
    // The operator at `ptr`, whose first two bytes are `c` and `c2`;
    // `spaced` when whitespace precedes it.
    macro_rules! op {
        ($c:expr, $c2:expr, $spaced:expr) => {{
            let (c, c2, spaced): (u8, u8, bool) = ($c, $c2, $spaced);
            let lhs = ptr;
            ptr += 1;
            if c == b'-' && c2 == b'>' {
                ptr += 1;
            } else if c2 == b'=' || (c == c2 && DOUBLES[c as usize]) {
                // two bytes in, so the third is `c3`
                // SAFETY: the two operator bytes lie inside the input, so
                // `ptr + 1` is at most `end`.
                let c3 = unsafe { src.byte_unchecked(ptr + 1) };
                ptr += 1;
                if c == b'>' && (c3 == b'>' || c3 == b'=') {
                    ptr += 1;
                    // SAFETY: three operator bytes lie inside the input.
                    if unsafe { src.byte_unchecked(ptr) } == b'=' {
                        ptr += 1;
                    }
                }
                if c == b'<' && c3 == b'=' {
                    ptr += 1;
                }
            }
            out.tok(tok::OPERATOR, ptr);
            member = false;
            // the angles of a generic - `>>` closes two - and a nullable
            // `?` keep the type pending; any other operator ends it, and
            // so do a spaced one and a `>` directly before a name: the
            // explicit type arguments of `Collections.<T>emptyList()`
            // SAFETY: the operator lies inside the input, so `ptr` is at
            // most `end`.
            if !is_type_glue(src, lhs, ptr)
                || spaced
                || (c == b'>' && is_ident_start(unsafe { src.byte_unchecked(ptr) }))
            {
                after_type = false;
            }
        }};
    }
    // The `,` or `;` token.
    macro_rules! delimiter {
        ($semicolon:expr) => {{
            ptr += 1;
            out.tok(tok::PUNCTUATION_DELIMITER, ptr);
            member = false;
            expect = 0;
            // a comma separates the type arguments of a pending type
            if $semicolon {
                after_type = false;
            }
        }};
    }
    // The `.` or `...` token, when no digit follows.
    macro_rules! dot {
        ($c2:expr) => {{
            let c2: u8 = $c2;
            if c2 == b'.' {
                // SAFETY: `..` lies inside the input.
                ptr += if unsafe { src.byte_unchecked(ptr + 2) } == b'.' {
                    3
                } else {
                    1
                };
                out.tok(tok::OPERATOR, ptr);
                member = false;
                after_type = false;
            } else {
                ptr += 1;
                out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                member = true;
            }
        }};
    }

    // Every token stops at or before the NUL after the input, so `ptr`
    // stays at most `end` and reads a few bytes past it stay inside the
    // slack.
    loop {
        let gap = ptr;
        // SAFETY: `ptr` is at most `end` (see above).
        let mut c = unsafe { src.byte_unchecked(ptr) };
        // SAFETY: as above.
        if c == b' ' && !is_space(unsafe { src.byte_unchecked(ptr + 1) }) {
            ptr += 1;
            // SAFETY: the leading gap and every token before this one
            // wrote a record.
            unsafe { out.extend_unchecked(ptr) };
            // SAFETY: `ptr` is at most `end`.
            c = unsafe { src.byte_unchecked(ptr) };
        } else if is_space(c) {
            ptr = whitespace_end(src, ptr + 1);
            // SAFETY: as above.
            unsafe { out.extend_unchecked(ptr) };
            // SAFETY: `ptr` is at most `end`.
            c = unsafe { src.byte_unchecked(ptr) };
        }
        let lhs = ptr;
        let class = CLASS[c as usize];

        // Names, the most common tokens, skip the jump table.
        if class == class::IDENT {
            let rhs = ident_end(src, ptr + 1);
            ptr = rhs;
            let mut kind = word_value(src, lhs, rhs);
            // `record` heads a declaration only before a name - `record
            // Point(` - so `record : records` and `record.key()` keep it a
            // variable that arms no type capture
            if kind > 1023 {
                let p = skip_space_at(src, rhs);
                // SAFETY: the spaces stop at or before the NUL.
                kind = if !member && p > rhs && is_ident_start(unsafe { src.byte_unchecked(p) }) {
                    kind & 1023
                } else {
                    -1
                };
            }
            let hl;
            if kind >= 0 {
                hl = (kind & 255) as u32;
                // a bare keyword either arms the next-name capture or ends
                // it; `Foo.class` names no type
                if !member {
                    expect = (kind as u32) >> 8;
                }
                after_type = hl == tok::TYPE_BUILTIN;
            } else {
                let p = skip_space_at(src, rhs);
                // The byte after the name's spaces, read only by the rules
                // that test it.
                // SAFETY: the spaces stop at or before the NUL, so `p` is at
                // most `end`.
                let after = || unsafe { src.byte_unchecked(p) };
                if expect != 0 {
                    hl = if expect == 1 {
                        tok::TYPE
                    } else {
                        tok::NAMESPACE
                    };
                    after_type = expect == 1;
                    // a dotted package keeps its capture: `demo.app`
                    if expect == 1 || after() != b'.' {
                        expect = 0;
                    }
                } else if member {
                    // `Map.Entry` is a nested type, `obj.field` a field,
                    // `obj.call(` a method
                    if after() == b'(' {
                        hl = tok::FUNCTION_METHOD;
                        after_type = false;
                    } else {
                        after_type = is_upper(c);
                        hl = if after_type { tok::TYPE } else { tok::PROPERTY };
                    }
                } else if after() == b'(' {
                    // `Foo(` is a constructor; a lowercase name after a
                    // type is the method being declared
                    hl = if is_upper(c) {
                        tok::TYPE
                    } else if after_type {
                        tok::FUNCTION_DEFINITION
                    } else {
                        tok::FUNCTION
                    };
                    after_type = false;
                } else if (is_upper(c) || c == b'_') && is_const_case(src, lhs, rhs) {
                    // (only `[A-Z_]` can start a constant name)
                    hl = tok::CONSTANT;
                    after_type = false;
                } else {
                    after_type = is_upper(c);
                    hl = if after_type { tok::TYPE } else { tok::VARIABLE };
                }
            }
            out.tok(hl, rhs);
            member = false;
            // `(`, `)`, `.`, `,`, or `;` right after a name: its rule runs
            // here, without the gap and dispatch steps
            // SAFETY: the name stopped at or before the NUL.
            let next = unsafe { src.byte_unchecked(ptr) };
            match next {
                b'(' | b')' => bracket!(),
                b'.' => {
                    // SAFETY: `ptr` is below `end`.
                    let c2 = unsafe { src.byte_unchecked(ptr + 1) };
                    if !is_digit(c2) {
                        dot!(c2);
                    }
                }
                b',' => delimiter!(false),
                b';' => delimiter!(true),
                // SAFETY: `ptr` is below `end`.
                b'<' | b'>' => op!(next, unsafe { src.byte_unchecked(ptr + 1) }, false),
                _ => {}
            }
            continue;
        }

        // Brackets, the next most common tokens, skip the jump table too.
        if class == class::BRACKET {
            bracket!();
            continue;
        }
        // SAFETY: `ptr` is at most `end`.
        let c2 = unsafe { src.byte_unchecked(ptr + 1) };
        match class {
            class::SQUARE => {
                // array brackets keep a type pending - `int[] read(`
                ptr += 1;
                out.tok(tok::PUNCTUATION_BRACKET, ptr);
                member = false;
            }
            class::SEMICOLON => delimiter!(true),
            class::COMMA => delimiter!(false),
            class::DOT if !is_digit(c2) => dot!(c2),
            class::DOT | class::DIGIT => {
                ptr = number_end(src, ptr);
                out.tok(tok::NUMBER, ptr);
                member = false;
                after_type = false;
            }
            class::DQUOTE | class::SQUOTE => {
                // SAFETY: `ptr` is below `end`.
                if c2 == b'"' && c == b'"' && unsafe { src.byte_unchecked(ptr + 2) } == b'"' {
                    // a text block opener is emitted at once, then its body
                    ptr += 3;
                    out.tok(tok::STRING, ptr);
                    ptr = with_copy!(text_block_body(ptr, end));
                } else {
                    // a one-line literal without escapes is one token
                    let close = scan::string_special(src.bytes(), ptr + 1, end, c);
                    // SAFETY: the scan stops at most at `end`.
                    if unsafe { src.byte_unchecked(close) } == c {
                        ptr = close + 1;
                        out.tok(tok::STRING, ptr);
                    } else {
                        ptr = with_copy!(string_rest(lhs, close, end));
                    }
                }
                member = false;
                after_type = false;
            }
            class::SLASH if c2 == b'/' => {
                // SAFETY: `ptr` is below `end`.
                let doc = unsafe { src.byte_unchecked(ptr + 2) } == b'/';
                ptr = scan::line_end(src.bytes(), ptr + 2, end);
                out.tok(if doc { tok::COMMENT_DOC } else { tok::COMMENT }, ptr);
            }
            class::SLASH if c2 == b'*' => {
                // `/**` opens Javadoc, but `/**/` is an empty plain comment
                // SAFETY: `ptr` is below `end`.
                let doc = unsafe {
                    src.byte_unchecked(ptr + 2) == b'*' && src.byte_unchecked(ptr + 3) != b'/'
                };
                ptr = scan::block_comment_end(src.bytes(), ptr + 2, end);
                out.tok(if doc { tok::COMMENT_DOC } else { tok::COMMENT }, ptr);
            }
            class::COLON => {
                ptr += if c2 == b':' { 2 } else { 1 };
                out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                // `Type::method` references a member
                member = c2 == b':';
                after_type = false;
                // a stale capture never crosses `:` onto the name after it
                expect = 0;
            }
            class::AT if is_ident_start(c2) => {
                // annotations, including `@interface`
                ptr = ident_end(src, ptr + 1);
                out.tok(tok::ATTRIBUTE, ptr);
                member = false;
            }
            class::OP | class::SLASH => op!(c, c2, gap != lhs),
            class::NUL if ptr >= end => break,
            _ => {
                ptr += 1;
                out.tok(tok::NONE, ptr);
                member = false;
                after_type = false;
            }
        }
    }
    out.store(inst);
}
