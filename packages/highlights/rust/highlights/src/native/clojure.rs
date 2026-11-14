//! WAT sources: src/langs/clojure.wat src/common.wat src/scan.wat
//!
//! Native Clojure lexer. One pass over the input: each token is scanned and
//! colored in the same step, with the same rules, in the same order, as the
//! translated `$hlClojure`. The records equal the translated lexer's
//! records.
//!
//! The WAT tests its rules in one chain. Each rule matches one first byte,
//! so this lexer dispatches on the first byte and, for each byte, tests
//! only the rules that can match it, in the WAT's order. Bytes that only
//! the last rule (a symbol) can take go straight to it.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::CLOJURE_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "clojure" => Some(highlight),
        _ => None,
    }
}

/// The words `$cljWordHl` matches outside `$clojureWords`, with their
/// values: the table's hash can't hold them next to its own words.
const EXTRA_WORDS: [(&[u8], u32); 5] = [
    (b"if-let", tok::KEYWORD_CONTROL),
    (b"defonce", tok::KEYWORD_DECLARATION | 512),
    (b"declare", tok::KEYWORD_DECLARATION | 256),
    (b"when-let", tok::KEYWORD_CONTROL),
    (b"defrecord", tok::KEYWORD_DECLARATION | 768),
];

/// `$clojureWords` and [`EXTRA_WORDS`] as a perfect hash on a word's
/// bytes: the token in the low byte and the next-symbol capture in the
/// high byte (1 a function, 2 a variable, 3 a type, 4 a namespace). A word
/// of up to 16 bytes is two little-endian integers, `lo` (bytes 0-7) and
/// `hi` (bytes 8-15), zero past its end; symbols hold no NUL, so equal
/// integers mean equal words.
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    values: [u16; WORD_SLOTS],
    mul: u64,
}

const WORD_SLOTS: usize = 1024;

/// The longest word.
const WORD_MAX: usize = 16;

/// The slot of the word with integers `lo` and `hi`. No two words share a
/// slot, so a symbol is a word only when its integers equal the slot's.
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

/// The `i`th word and its value: the table's words, then [`EXTRA_WORDS`].
const fn word_entry(i: usize) -> (&'static [u8], u32) {
    if i < CLOJURE_WORDS.len() {
        (CLOJURE_WORDS[i].word, CLOJURE_WORDS[i].value as u32)
    } else {
        EXTRA_WORDS[i - CLOJURE_WORDS.len()]
    }
}

const WORD_COUNT: usize = CLOJURE_WORDS.len() + EXTRA_WORDS.len();

/// For each first byte, a bit per length of the words in [`WORDS`]. A
/// symbol whose bit is clear is no word.
static WORD_LENGTHS: [u32; 256] = {
    let mut t = [0u32; 256];
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
    let mut mul: u64 = 0x2545_f491_4f6c_dd1d;
    let mut attempt = 0;
    'search: loop {
        assert!(attempt < 20_000, "no collision-free hash: use more slots");
        let mut keys = [(0u64, 0u64); WORD_SLOTS];
        let mut values = [0u16; WORD_SLOTS];
        let mut i = 0;
        while i < WORD_COUNT {
            let (w, value) = word_entry(i);
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

/// The token for the symbol `[lhs, rhs)` with the next-symbol capture in
/// the high byte, or -1 for an ordinary symbol (`$cljWordHl`).
#[inline(always)]
fn word_hl(src: Input, lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    // SAFETY: the symbol `[lhs, rhs)` lies inside the input.
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

/// Bytes that end a symbol: whitespace, brackets, quotes, and the reader
/// characters that never join a name (`$cljIsDelim`).
static DELIM: [bool; 256] = byteset(b"\x00\x09\x0a\x0b\x0c\x0d \"()@[]^`{}~,;\\");

/// Reader macro bytes: quote, syntax-quote, unquote, deref, metadata.
static READER: [bool; 256] = byteset(b"'@^`~");

/// Coarse byte kinds for the loop top.
mod kind {
    /// A byte with rules of its own: comments, strings, keywords,
    /// brackets, reader macros, `#` forms, `,`, and NUL.
    pub const OTHER: u8 = 0;
    /// ASCII whitespace (`$lexIsSpace`).
    pub const SPACE: u8 = 1;
    /// A byte only the symbol rule takes, and none of the first bytes
    /// [`MARKED`] lists.
    pub const SYMBOL: u8 = 3;
    /// A digit, `+`, `-`, `%`, `&`, or `.`: a byte only the symbol rule
    /// takes, which can make a number, a `%` argument, a `&`, or interop.
    pub const MARKED: u8 = 4;
    /// `(`, `)`, `[`, `]`, `{`, or `}`.
    pub const BRACKET: u8 = 2;
}

/// The [`kind`] of each byte.
static KIND: [u8; 256] = {
    let mut t = [kind::OTHER; 256];
    let mut c = 0;
    while c < 256 {
        let b = c as u8;
        t[c] = if is_space(b) {
            kind::SPACE
        } else if matches!(b, b'(' | b')' | b'[' | b']' | b'{' | b'}') {
            kind::BRACKET
        } else if DELIM[c] || b == b':' || b == b'\'' || b == b'#' {
            kind::OTHER
        } else if is_digit(b) || matches!(b, b'+' | b'-' | b'%' | b'&' | b'.') {
            kind::MARKED
        } else {
            kind::SYMBOL
        };
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

/// The end of the symbol from `p`: up to the next delimiter
/// (`$cljScanSymbol`). Its UTF-8 steps skip only continuation bytes, which
/// are no delimiters, so a byte loop finds the same end; the NUL after the
/// input ends every symbol.
#[inline(always)]
fn symbol_end(src: Input, mut p: usize) -> usize {
    // SAFETY: the NUL after the input is a delimiter, so `p` stays at or
    // before it.
    while !DELIM[unsafe { src.byte_unchecked(p) } as usize] {
        p += 1;
    }
    p
}

/// Symbol-scan flags of each byte: [`SYM_DELIM`] for a delimiter
/// ([`DELIM`]), [`SYM_SLASH`] for `/`, [`SYM_DOT`] for `.`.
static SYM_FLAGS: [u8; 256] = {
    let mut t = [0u8; 256];
    let mut c = 0;
    while c < 256 {
        t[c] = if DELIM[c] {
            SYM_DELIM
        } else if c as u8 == b'/' {
            SYM_SLASH
        } else if c as u8 == b'.' {
            SYM_DOT
        } else {
            0
        };
        c += 1;
    }
    t
};

const SYM_DELIM: u8 = 1;
const SYM_SLASH: u8 = 2;
const SYM_DOT: u8 = 4;

/// [`DELIM`] as two 16-entry nibble tables: a byte is a delimiter when the
/// table entries of its high and low nibble share a bit. Each high nibble
/// of an ASCII delimiter has its own bit, and the low-nibble entry holds
/// the bits of the high nibbles it pairs with, so the test is exact.
static DELIM_NIBBLES: ([u8; 16], [u8; 16]) = {
    let mut hi = [0u8; 16];
    let mut lo = [0u8; 16];
    let mut c = 0;
    while c < 128 {
        if DELIM[c] {
            hi[c >> 4] = 1 << (c >> 4);
            lo[c & 15] |= 1 << (c >> 4);
        }
        c += 1;
    }
    (hi, lo)
};

/// [`symbol_end`], and the [`SYM_SLASH`] and [`SYM_DOT`] flags of the bytes
/// it passed, so a symbol without `/` or `.` skips the searches for them.
#[inline(always)]
fn symbol_end_flags(src: Input, mut p: usize) -> (usize, u8) {
    let mut seen = 0u8;
    // Most symbols are short: test a few bytes one by one first.
    for _ in 0..8 {
        // SAFETY: the symbol stops at the NUL after the input, so `p`
        // stays at or before it.
        let f = SYM_FLAGS[unsafe { src.byte_unchecked(p) } as usize];
        if f & SYM_DELIM != 0 {
            return (p, seen);
        }
        seen |= f;
        p += 1;
    }
    let hi_t = V::from_array(&DELIM_NIBBLES.0);
    let lo_t = V::from_array(&DELIM_NIBBLES.1);
    loop {
        // SAFETY: each load starts at or before the NUL after the input,
        // so its 16 bytes stay inside the slack.
        let v = unsafe { src.vec_unchecked(p) };
        let h = hi_t.lookup(v.shr::<4>());
        let l = lo_t.lookup(v.and(V::splat(15)));
        let delim = h.test(l).lanes();
        let slash = v.eq(V::splat(b'/')).lanes();
        let dot = v.eq(V::splat(b'.')).lanes();
        // the lanes before the first delimiter
        let before = delim.before_first();
        if slash.and(before).any() {
            seen |= SYM_SLASH;
        }
        if dot.and(before).any() {
            seen |= SYM_DOT;
        }
        if delim.any() {
            return (p + delim.first(), seen);
        }
        p += 16;
    }
}

/// The offset of the first `b` strictly inside the symbol `[lhs, rhs)`, or
/// 0 when there is none (`$cljFindInside`).
#[inline(always)]
fn find_inside(src: Input, lhs: usize, rhs: usize, b: u8) -> usize {
    let mut p = lhs + 1;
    while p + 1 < rhs {
        // SAFETY: `p < rhs`, inside the symbol.
        if unsafe { src.byte_unchecked(p) } == b {
            return p - lhs;
        }
        p += 1;
    }
    0
}

/// The end of the escape at backslash `p`: one character, kept whole when
/// it is UTF-8, and CRLF as one (`$lexEscapeEnd`).
#[inline(always)]
fn escape_end(src: Input, p: usize, end: usize) -> usize {
    let mut e = scan::utf8_span_end(src.bytes(), p + 2, end);
    // SAFETY: the backslash at `p` lies inside the input, so `p + 1` is at
    // most the NUL, and `e < end`.
    if e == p + 2
        && unsafe { src.byte_unchecked(p + 1) } == b'\r'
        && e < end
        && unsafe { src.byte_unchecked(e) } == b'\n'
    {
        e += 1;
    }
    e
}

/// Lex the Clojure input of `len` bytes at `base` (`$hlClojure`).
fn highlight(inst: &mut Instance, base: usize, len: usize) {
    // SAFETY: the input and its slack lie inside lexer memory, and this
    // lexer calls no translated code, so memory stays in place.
    let src = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut recs = Recs::load(inst);

    // A multiline string from `lhs` whose body starts at `p` (`$lexString`,
    // `$lexStringBody`), colored `hl` with escapes as their own tokens.
    // Returns the end.
    macro_rules! string {
        ($lhs:expr, $p:expr, $hl:expr) => {{
            let hl: u32 = $hl;
            let mut seg: usize = $lhs;
            let mut p: usize = $p;
            loop {
                p = scan::find3(src.bytes(), p, end, b'"', b'\\', b'"');
                if p >= end {
                    break;
                }
                // SAFETY: `p < end`.
                if unsafe { src.byte_unchecked(p) } == b'"' {
                    p += 1;
                    break;
                }
                if seg < p {
                    recs.tok(hl, p);
                }
                let e = escape_end(src, p, end);
                recs.tok(tok::STRING_ESCAPE, e);
                p = e;
                seg = p;
            }
            if seg < p {
                recs.tok(hl, p);
            }
            p
        }};
    }

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src.bytes(), 0, end);
    recs.gap(0, ptr);
    // Leading whitespace; every later gap follows a token's record.
    let first = whitespace_end(src, ptr);
    recs.gap(ptr, first);
    ptr = first;

    // the pending next-symbol capture of a definition form in the low three
    // bits, and above them the bracket depth inside `^{...}` metadata
    let mut expect = 0u32;
    // right after `(`, where the symbol is the operator of the form
    let mut head = false;

    loop {
        // SAFETY: every token ends at or before the input end, so `ptr`
        // (and the byte after it, the NUL at most) lies inside the input
        // plus slack.
        let mut c = unsafe { src.byte_unchecked(ptr) };
        let mut byte_kind = KIND[c as usize];
        if byte_kind == kind::SPACE {
            // SAFETY: as above.
            if c == b' ' && KIND[unsafe { src.byte_unchecked(ptr + 1) } as usize] != kind::SPACE {
                ptr += 1;
            } else {
                ptr = whitespace_end(src, ptr + 1);
            }
            recs.extend(ptr);
            // SAFETY: the NUL at the input end stops the whitespace.
            c = unsafe { src.byte_unchecked(ptr) };
            byte_kind = KIND[c as usize];
        }
        let lhs = ptr;
        // A bracket at `ptr`, whose byte is `c`.
        macro_rules! bracket {
            () => {{
                ptr += 1;
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
                head = c == b'(';
                if expect >= 8 {
                    // inside `^{...}` metadata only the nesting is
                    // tracked, so a definition name after the map is
                    // still pending
                    expect = if c == b'(' || c == b'[' || c == b'{' {
                        expect.wrapping_add(8)
                    } else {
                        expect.wrapping_sub(8)
                    };
                } else if c != b'(' {
                    // a definition names the symbol after its head; any
                    // bracket other than that `(` ends the capture
                    expect = 0;
                }
            }};
        }
        if byte_kind == kind::BRACKET {
            bracket!();
            continue;
        }
        // (symbols, the most common tokens, take one test here)
        if byte_kind < kind::SYMBOL {
            // SAFETY: `ptr` lies before the input end, so the byte after it
            // is at most the NUL.
            let c2 = unsafe { src.byte_unchecked(ptr + 1) };
            match c {
                b';' => {
                    // `$lexLineComment`
                    ptr = scan::line_end(src.bytes(), ptr + 1, end);
                    recs.tok(tok::COMMENT, ptr);
                    continue;
                }
                b'"' => {
                    ptr = string!(lhs, ptr + 1, tok::STRING);
                    head = false;
                    continue;
                }
                b'\\' if c2 > 32 => {
                    // `\a`, `\newline`, `é`: a character literal
                    ptr = symbol_end(src, scan::utf8_span_end(src.bytes(), ptr + 2, end));
                    recs.tok(tok::STRING_SPECIAL, ptr);
                    head = false;
                    continue;
                }
                b':' if !DELIM[c2 as usize] => {
                    // `:kw`, `::kw`, `:ns/kw`
                    ptr = symbol_end(src, ptr + 1);
                    recs.tok(tok::STRING_SPECIAL_SYMBOL, ptr);
                    head = false;
                    continue;
                }
                b'^' if c2 == b'{' => {
                    // `^{...}` metadata map, as in `(defn ^{:private true}
                    // name ...)`
                    ptr += 1;
                    recs.tok(tok::PUNCTUATION_SPECIAL, ptr);
                    ptr += 1;
                    recs.tok(tok::PUNCTUATION_BRACKET, ptr);
                    expect = expect.wrapping_add(8);
                    continue;
                }
                _ if READER[c as usize] => {
                    // reader macros: quote, syntax-quote, unquote, deref,
                    // metadata
                    ptr += if c == b'~' && c2 == b'@' { 2 } else { 1 };
                    recs.tok(tok::PUNCTUATION_SPECIAL, ptr);
                    continue;
                }
                b'#' => {
                    if c2 == b'"' {
                        // `#"regex"`
                        ptr += 1;
                        recs.tok(tok::STRING_REGEX, ptr);
                        ptr = string!(ptr, ptr + 1, tok::STRING_REGEX);
                        head = false;
                    } else if c2 == b'!' {
                        // `#!` shebang line
                        ptr = scan::line_end(src.bytes(), ptr + 2, end);
                        recs.tok(tok::COMMENT, ptr);
                    } else if c2 == b'#' {
                        // `##Inf`, `##NaN`
                        ptr = symbol_end(src, ptr + 2);
                        recs.tok(tok::CONSTANT_BUILTIN, ptr);
                        head = false;
                    } else if c2 == b':' {
                        // `#:ns{...}` and `#::{...}` namespaced maps
                        ptr = symbol_end(src, ptr + 1);
                        recs.tok(tok::STRING_SPECIAL_SYMBOL, ptr);
                    } else if c2 == b'\'' || c2 == b'_' || c2 == b'?' {
                        // `#'`, `#_`, `#?`, `#?@`
                        ptr += 2;
                        if c2 == b'?' && src.byte(ptr) == b'@' {
                            ptr += 1;
                        }
                        recs.tok(tok::PUNCTUATION_SPECIAL, ptr);
                    } else if is_ident_start(c2) && c2 != b'$' {
                        // `#inst "..."`, `#uuid "..."` tagged literals
                        ptr = symbol_end(src, ptr + 1);
                        recs.tok(tok::ATTRIBUTE, ptr);
                        head = false;
                    } else {
                        // `#(`, `#{`
                        ptr += 1;
                        recs.tok(tok::PUNCTUATION_SPECIAL, ptr);
                    }
                    continue;
                }
                b',' => {
                    // `,` is whitespace to the reader
                    ptr += 1;
                    recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
                    continue;
                }
                0 if ptr >= end => break,
                _ => {}
            }
        }

        // a symbol: number, keyword, definition name, operator, or plain
        let seen;
        (ptr, seen) = symbol_end_flags(src, ptr);
        if ptr == lhs {
            // a delimiter no rule took: one character
            ptr = scan::utf8_span_end(src.bytes(), ptr + 1, end);
        }
        let rhs = ptr;
        if byte_kind == kind::MARKED {
            // SAFETY: `lhs` lies inside the input, so the byte after it is
            // at most the NUL.
            let c2 = unsafe { src.byte_unchecked(lhs + 1) };
            // a symbol starting with a digit, or a sign and a digit, is a number
            if is_digit(c) || ((c == b'+' || c == b'-') && is_digit(c2)) {
                recs.tok(tok::NUMBER, rhs);
                head = false;
                continue;
            }
            // `%`, `%1`, `%&` inside `#(...)`
            if c == b'%' {
                recs.tok(tok::VARIABLE_SPECIAL, rhs);
                head = false;
                continue;
            }
            // `&` rest parameters
            if c == b'&' && rhs - lhs == 1 {
                recs.tok(tok::KEYWORD, rhs);
                head = false;
                continue;
            }
            // `.method` and `.-field` interop
            if c == b'.' && rhs - lhs > 1 {
                recs.tok(
                    if c2 == b'-' {
                        tok::PROPERTY
                    } else {
                        tok::FUNCTION_METHOD
                    },
                    rhs,
                );
                head = false;
                continue;
            }
        }
        let kind = word_hl(src, lhs, rhs);
        if kind >= 0 {
            if head && expect < 8 {
                expect = (kind >> 8) as u32;
            }
            recs.tok((kind & 255) as u32, rhs);
            head = false;
            continue;
        }
        if expect.wrapping_sub(1) <= 6 {
            let hl = match expect {
                2 => tok::VARIABLE,
                3 => tok::TYPE,
                4 => tok::NAMESPACE,
                _ => tok::FUNCTION_DEFINITION,
            };
            expect = 0;
            recs.tok(hl, rhs);
            head = false;
            continue;
        }
        // `ns/name`: the namespace or class, the slash, then the name
        let mut lhs = lhs;
        let q = if seen & SYM_SLASH != 0 {
            find_inside(src, lhs, rhs, b'/')
        } else {
            0
        };
        if q != 0 {
            let q = lhs + q;
            recs.tok(
                if c.wrapping_sub(b'A') <= 25 {
                    tok::TYPE
                } else {
                    tok::NAMESPACE
                },
                q,
            );
            recs.tok(tok::PUNCTUATION_DELIMITER, q + 1);
            lhs = q + 1;
            // SAFETY: `q` lies inside the symbol, so `q + 1` is at most its
            // end, at or before the NUL.
            c = unsafe { src.byte_unchecked(lhs) };
        }
        // `Foo` and `Foo.` name classes wherever they stand; a dotted
        // lowercase symbol such as `clojure.string` names a namespace
        let hl = if c.wrapping_sub(b'A') <= 25 {
            tok::TYPE
        } else if is_ident_start(c) && seen & SYM_DOT != 0 && find_inside(src, lhs, rhs, b'.') != 0
        {
            tok::NAMESPACE
        } else if head {
            tok::FUNCTION
        } else if c == b'*' && rhs - lhs > 2 && src.byte(rhs - 1) == b'*' {
            // `*dynamic*` by convention
            tok::VARIABLE_SPECIAL
        } else if is_ident_start(c) {
            tok::VARIABLE
        } else {
            tok::OPERATOR
        };
        recs.tok(hl, rhs);
        head = false;
        // a bracket right after a symbol: its rule runs here, without the
        // gap and dispatch steps
        // SAFETY: a symbol ends at or before the NUL.
        c = unsafe { src.byte_unchecked(ptr) };
        if KIND[c as usize] == kind::BRACKET {
            bracket!();
        }
    }
    recs.store(inst);
}
