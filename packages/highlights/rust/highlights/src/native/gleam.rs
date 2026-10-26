//! WAT sources: src/langs/gleam.wat src/common.wat src/scan.wat
//!
//! Native Gleam lexer. One pass over the input: each token is scanned and
//! colored in the same step, with the same rules, in the same order, as the
//! translated `$hlGleam`. The records equal the translated lexer's records.
//!
//! The WAT tests its rules in one chain. Each rule matches one first byte,
//! so this lexer dispatches on the first byte and, for each byte, tests
//! only the rules that can match it, in the WAT's order.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::GLEAM_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "gleam" => Some(highlight),
        _ => None,
    }
}

/// `$gleamWords` as a perfect hash on a word's bytes: the token in the low
/// byte, and bit 8 for `fn`, bit 9 for `type`, which name what the next
/// name is. A word of up to 16 bytes is two
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
    while i < GLEAM_WORDS.len() {
        let w = GLEAM_WORDS[i].word;
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
        while i < GLEAM_WORDS.len() {
            let (w, value) = (GLEAM_WORDS[i].word, GLEAM_WORDS[i].value);
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
///
/// # Safety
/// `p` must lie inside the input.
#[inline(always)]
unsafe fn word_at(src: Input, p: usize, n: usize) -> u64 {
    // SAFETY: `p` lies before the input end, so `p + 8` lies inside the
    // slack.
    unsafe { src.word_unchecked(p) & (u64::MAX >> (64 - 8 * n)) }
}

/// The keyword value of the name `[lhs, rhs)`, or -1 when it is no word
/// (`$gleamWordHl`).
#[inline(always)]
fn word_value(src: Input, lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    // SAFETY: the name `[lhs, rhs)` lies inside the input.
    if n > WORD_MAX || WORD_LENGTHS[unsafe { src.byte_unchecked(lhs) } as usize] >> n & 1 == 0 {
        return -1;
    }
    // SAFETY: the name `[lhs, rhs)` lies inside the input, and so does
    // `lhs + 8` when the name is longer than 8 bytes.
    let (lo, hi) = unsafe {
        if n <= 8 {
            (word_at(src, lhs, n), 0)
        } else {
            (word_at(src, lhs, 8), word_at(src, lhs + 8, n - 8))
        }
    };
    let s = word_slot(lo, hi, WORDS.mul);
    if WORDS.keys[s] == (lo, hi) {
        WORDS.values[s] as i32
    } else {
        -1
    }
}

/// Operator bytes (`$gleamIsOp`).
static OP: [bool; 256] = byteset(b"!%&*+-/<=>|");

/// Bytes that continue an operator run: operators and `.`, which joins a
/// float operator such as `+.`.
static OP_RUN: [bool; 256] = byteset(b"!%&*+-/<=>|.");

/// Byte classes for the main dispatch.
mod class {
    /// Anything else: one character colored `none`.
    pub const OTHER: u8 = 0;
    /// An identifier start other than `$`: a letter, `_`, or a byte from
    /// 0x80.
    pub const IDENT: u8 = 1;
    pub const DIGIT: u8 = 2;
    pub const SLASH: u8 = 3;
    pub const QUOTE: u8 = 4;
    pub const AT: u8 = 5;
    /// `(`, `)`, `[`, `]`, `{`, or `}`.
    pub const BRACKET: u8 = 6;
    pub const COMMA: u8 = 7;
    pub const COLON: u8 = 8;
    pub const DOT: u8 = 9;
    pub const HASH: u8 = 10;
    /// Any other operator byte.
    pub const OP: u8 = 11;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 12;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let mut t = [class::OTHER; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = if is_ident_start(b) && b != b'$' {
            class::IDENT
        } else if is_digit(b) {
            class::DIGIT
        } else {
            match b {
                0 => class::NUL,
                b'/' => class::SLASH,
                b'"' => class::QUOTE,
                b'@' => class::AT,
                b'(' | b')' | b'[' | b']' | b'{' | b'}' => class::BRACKET,
                b',' => class::COMMA,
                b':' => class::COLON,
                b'.' => class::DOT,
                b'#' => class::HASH,
                _ if OP[c] => class::OP,
                _ => class::OTHER,
            }
        };
        c += 1;
    }
    t
};

/// Coarse byte kinds for the loop top: whitespace, a name start, or
/// anything else. The name test reads this table rather than [`CLASS`] so
/// it stays a branch of its own before the class dispatch.
mod kind {
    pub const OTHER: u8 = 0;
    /// ASCII whitespace (`$lexIsSpace`).
    pub const SPACE: u8 = 1;
    /// [`super::class::IDENT`].
    pub const NAME: u8 = 2;
}

/// The [`kind`] of each byte.
static KIND: [u8; 256] = {
    let mut t = [kind::OTHER; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = if is_space(c as u8) {
            kind::SPACE
        } else if CLASS[c] == class::IDENT {
            kind::NAME
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
        // SAFETY: `p` lies inside the 8 bytes just read.
        if !is_space(unsafe { src.byte_unchecked(p) }) {
            return p;
        }
        p += 1;
    }
}

/// The end of the name run from `p`: `[A-Za-z0-9_]` and bytes from 0x80
/// (`$scanIdentRun` with `_`). The NUL after the input ends every run.
#[inline(always)]
fn name_end(src: Input, mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..8 {
        // SAFETY: the run stops at the NUL after the input, so `p` stays
        // at or before it.
        if !NAME[unsafe { src.byte_unchecked(p) } as usize] {
            return p;
        }
        p += 1;
    }
    loop {
        // SAFETY: each load starts at or before the NUL after the input,
        // so its 16 bytes stay inside the slack.
        let v = unsafe { src.vec_unchecked(p) };
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

/// The end of the number at `p`: radix digits, separators, exponents, and
/// suffixes, with `.` only before a digit (`$lexScanNumber`,
/// `$lexScanNumberBody`).
#[inline(always)]
fn number_end(src: Input, mut p: usize) -> usize {
    // SAFETY: `p` lies at a digit inside the input, so `p + 1` is at most
    // the NUL.
    let hex = unsafe { src.byte_unchecked(p) == b'0' && src.byte_unchecked(p + 1) | 0x20 == b'x' };
    let mut prev = 0u8;
    loop {
        // SAFETY: the NUL at the input end stops the run.
        let c = unsafe { src.byte_unchecked(p) };
        if IDENT_CONT[c as usize] {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            // SAFETY: `p` lies before the NUL, so `p + 1` is at most the NUL.
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

/// The end of the escape at backslash `p`: one character, kept whole when
/// it is UTF-8, and CRLF as one (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(src: Input, p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(src.bytes(), p + 2, end);
    // SAFETY: the backslash at `p` lies inside the input, so `p + 1` is at
    // most the NUL, and `e` is read only below the end.
    if e == p + 2
        && unsafe { src.byte_unchecked(p + 1) } == b'\r'
        && e < end
        && unsafe { src.byte_unchecked(e) } == b'\n'
    {
        e += 1;
    }
    e
}

/// Skip spaces and tabs from `p` on the current line (`$lexSkipSpaceAt`).
#[inline(always)]
fn skip_space_at(src: Input, mut p: usize) -> usize {
    // SAFETY: the run stops at the NUL after the input at the latest.
    while unsafe { src.byte_unchecked(p) } == b' ' || unsafe { src.byte_unchecked(p) } == b'\t' {
        p += 1;
    }
    p
}

/// Lex the Gleam input of `len` bytes at `base` (`$hlGleam`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: the input and its slack lie inside lexer memory, and this
    // lexer calls no translated code, so memory stays in place.
    let src = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut recs = Recs::load(inst);

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src.bytes(), 0, end);
    recs.gap(0, ptr);
    // Leading whitespace. The state is already that of a line start, so
    // only the record changes; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    recs.gap(ptr, first);
    ptr = first;

    // the next capture: 1 after `fn`, 2 after `type`
    let mut expect = 0u32;
    // after `.`
    let mut member = false;
    // on an `import` line, where names are module paths
    let mut import_ctx = false;
    // after a `:` annotation or a return `->`, where an uppercase name
    // before `(` is a type rather than a constructor
    let mut type_ctx = false;
    // between `fn` and its body, where `->` opens the return type
    let mut fn_head = false;

    loop {
        let gap = ptr;
        // SAFETY: every token ends at or before the input end, so `ptr`
        // (and the byte after it, the NUL at most) lies inside the input
        // plus slack.
        let mut c = unsafe { src.byte_unchecked(ptr) };
        let mut byte_kind = KIND[c as usize];
        if byte_kind == kind::SPACE {
            // SAFETY: as above.
            if c == b' ' && KIND[unsafe { src.byte_unchecked(ptr + 1) } as usize] != kind::SPACE {
                // one space: no line break
                ptr += 1;
            } else {
                ptr = whitespace_end(src, ptr + 1);
                // an import line ends at its line break
                if c == b'\n' || c == b'\r' || scan::line_end(src.bytes(), gap + 1, ptr) < ptr {
                    import_ctx = false;
                }
            }
            recs.extend(ptr);
            // SAFETY: the whitespace run stops at the NUL at the latest.
            c = unsafe { src.byte_unchecked(ptr) };
            byte_kind = KIND[c as usize];
        }
        let lhs = ptr;
        // Names, the most common tokens, skip the jump table.
        if byte_kind == kind::NAME {
            let rhs = name_end(src, ptr + 1);
            ptr = rhs;
            // SAFETY: a name ends at or before the NUL.
            let next = unsafe { src.byte_unchecked(rhs) };
            let kind = if member || import_ctx {
                -1
            } else {
                word_value(src, lhs, rhs)
            };
            let hl;
            if kind >= 0 {
                hl = (kind & 255) as u32;
                expect = (kind >> 8) as u32;
                if expect == 1 {
                    fn_head = true;
                }
                if expect == 2 {
                    type_ctx = true;
                }
                // `import` starts a module path
                if hl == tok::KEYWORD_IMPORT && rhs - lhs == 6 {
                    import_ctx = true;
                }
            } else if import_ctx {
                hl = tok::NAMESPACE;
            } else if expect != 0 {
                hl = if expect == 1 {
                    tok::FUNCTION_DEFINITION
                } else {
                    tok::TYPE
                };
                expect = 0;
            } else if c.wrapping_sub(b'A') <= 25 {
                // a constructor applies outside type context
                hl = if next == b'(' && !type_ctx {
                    tok::CONSTRUCTOR
                } else {
                    tok::TYPE
                };
            } else if member {
                // SAFETY: the space run stops at the NUL at the latest.
                hl = if unsafe { src.byte_unchecked(skip_space_at(src, rhs)) } == b'(' {
                    tok::FUNCTION_METHOD
                } else {
                    tok::PROPERTY
                };
            } else if next == b'(' {
                hl = tok::FUNCTION;
            } else {
                // `name:` labels arguments and fields
                let p = skip_space_at(src, rhs);
                // SAFETY: the space run stops at the NUL at the latest, and
                // `p + 1` is read only past a `:`, before the NUL.
                hl = if unsafe { src.byte_unchecked(p) } == b':'
                    && unsafe { src.byte_unchecked(p + 1) } != b':'
                {
                    tok::VARIABLE_PARAMETER
                } else {
                    tok::VARIABLE
                };
            }
            recs.tok(hl, rhs);
            member = false;
            // `(`, `)`, `,`, or `.` right after a name: its rule runs here,
            // without the gap and dispatch steps
            if next == b'(' {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
                expect = 0;
            } else if next == b')' {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
                expect = 0;
                type_ctx = false;
            } else if next == b',' {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                type_ctx = false;
            // SAFETY: `ptr + 1` is read only past a `.`, before the NUL.
            } else if next == b'.' && unsafe { src.byte_unchecked(ptr + 1) } != b'.' {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                // SAFETY: `ptr` follows a `.`, so it is at most the NUL.
                member = is_ident_start(unsafe { src.byte_unchecked(ptr) });
                import_ctx = false;
            }
            continue;
        }
        // SAFETY: `ptr` lies at or before the input end, so the byte after
        // it lies inside the slack.
        let c2 = unsafe { src.byte_unchecked(ptr + 1) };
        match CLASS[c as usize] {
            class::SLASH if c2 == b'/' => {
                // `//` comments, `///` documents
                // SAFETY: `ptr + 1` holds `/`, inside the input, so `ptr + 2`
                // is at most the NUL.
                let hl = if unsafe { src.byte_unchecked(ptr + 2) } == b'/' {
                    tok::COMMENT_DOC
                } else {
                    tok::COMMENT
                };
                ptr = scan::line_end(src.bytes(), ptr + 2, end);
                recs.tok(hl, ptr);
            }
            class::QUOTE => {
                // `$lexString` with a multiline body
                let mut seg = lhs;
                ptr += 1;
                loop {
                    ptr = scan::find3(src.bytes(), ptr, end, b'"', b'\\', b'"');
                    if ptr >= end {
                        break;
                    }
                    // SAFETY: `ptr` is below the end.
                    if unsafe { src.byte_unchecked(ptr) } == b'"' {
                        ptr += 1;
                        break;
                    }
                    if seg < ptr {
                        recs.tok(tok::STRING, ptr);
                    }
                    let e = escape_end(src, ptr, end);
                    recs.tok(tok::STRING_ESCAPE, e);
                    ptr = e;
                    seg = ptr;
                }
                if seg < ptr {
                    recs.tok(tok::STRING, ptr);
                }
                member = false;
            }
            class::AT if is_ident_start(c2) => {
                ptr = name_end(src, ptr + 1);
                recs.tok(tok::ATTRIBUTE, ptr);
            }
            class::DIGIT => {
                ptr = number_end(src, ptr);
                recs.tok(tok::NUMBER, ptr);
                member = false;
            }
            class::BRACKET => {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
                member = false;
                // a bracket ends a pending head; braces, closers, and `]`
                // leave type context
                expect = 0;
                if c != b'(' {
                    type_ctx = false;
                }
                if c == b'{' || c == b'}' {
                    fn_head = false;
                    import_ctx = false;
                }
            }
            class::COMMA => {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                member = false;
                type_ctx = false;
            }
            class::COLON => {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                member = false;
                type_ctx = true;
            }
            class::DOT => {
                if c2 == b'.' {
                    ptr += 2;
                    recs.tok(tok::OPERATOR, ptr);
                } else {
                    ptr += 1;
                    recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                    member = is_ident_start(c2);
                    import_ctx = false;
                }
            }
            class::HASH => {
                ptr += 1;
                recs.tok(tok::PUNCTUATION_SPECIAL, ptr);
            }
            class::SLASH if import_ctx => {
                // `/` separates module path segments on an import line
                ptr += 1;
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
            }
            class::OP | class::SLASH => {
                // `.` joins a float operator such as `+.` or `<=.`; a
                // comment opener ends the run
                ptr += 1;
                // SAFETY: the run stops at the NUL at the latest, so `ptr`
                // and `ptr + 1` lie inside the input plus slack.
                while OP_RUN[unsafe { src.byte_unchecked(ptr) } as usize]
                    && !(unsafe { src.byte_unchecked(ptr) } == b'/'
                        && unsafe { src.byte_unchecked(ptr + 1) } == b'/')
                {
                    ptr += 1;
                }
                recs.tok(tok::OPERATOR, ptr);
                member = false;
                expect = 0;
                // `->` after a parameter list opens the return type; `=`
                // starts a value
                if ptr - lhs == 2 && c == b'-' && c2 == b'>' {
                    type_ctx = fn_head;
                }
                if c == b'=' {
                    type_ctx = false;
                }
            }
            class::NUL if ptr >= end => break,
            _ => {
                ptr = scan::utf8_span_end(src.bytes(), ptr + 1, end);
                recs.tok(tok::NONE, ptr);
                member = false;
            }
        }
    }
    recs.store(inst);
}
