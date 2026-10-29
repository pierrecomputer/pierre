//! WAT sources: src/langs/go.wat src/common.wat src/scan.wat
//!
//! Native Go highlighter. One pass over the input: each token is scanned
//! and colored in the same step, with the same rules, in the same order, as
//! the translated `$hlGo`. The records equal the translated lexer's
//! records.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use super::tables::byteset;
use crate::generated::Instance;
use crate::simd::V;
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
fn whitespace_end(src: Input, mut p: usize) -> usize {
    loop {
        // SAFETY: `p` starts at or before the input end, and the NUL there
        // ends the run, so `p` never passes it; 8 bytes from there stay inside
        // the slack.
        let c = unsafe { src.byte_unchecked(p) };
        if c == b' ' {
            // Skip spaces 8 bytes at a time.
            // SAFETY: as above.
            let w = unsafe { src.word_unchecked(p) };
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
fn ident_end(src: Input, mut p: usize) -> usize {
    // Most names are short: test a few bytes one by one first.
    for _ in 0..4 {
        // SAFETY: `p` starts at or before the input end, and the NUL there
        // ends the run, so `p` never passes it; 16 bytes from there stay
        // inside the slack.
        if !IDENT_CONT[unsafe { src.byte_unchecked(p) } as usize] {
            return p;
        }
        p += 1;
    }
    loop {
        // SAFETY: as above.
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
    // SAFETY: `p` starts at or before the input end, and the NUL there ends
    // the run.
    while unsafe { src.byte_unchecked(p) } == b' ' || unsafe { src.byte_unchecked(p) } == b'\t' {
        p += 1;
    }
    p
}

/// The end of the number body from `p`: radix digits, separators,
/// exponents, and suffixes, with `.` only before a digit; `hex` keeps `e`
/// from taking a sign (`$lexScanNumberBody`).
#[inline(always)]
fn number_body_end(src: Input, mut p: usize, hex: bool) -> usize {
    let mut prev = 0u8;
    loop {
        // SAFETY: `p` starts at or before the input end, and the NUL there
        // ends the run.
        let c = unsafe { src.byte_unchecked(p) };
        if IDENT_CONT[c as usize] {
            prev = c;
            p += 1;
            continue;
        }
        if c == b'.' {
            // SAFETY: the `.` is an input byte, so `p + 1` is at most the
            // input end.
            let next = unsafe { src.byte_unchecked(p + 1) };
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
fn number_end(src: Input, lhs: usize) -> usize {
    // SAFETY: `lhs` is before the input end, every run below stops at the NUL
    // there, and each single step passes an input byte, so every read is at
    // most one byte past the input end.
    let hex = unsafe { src.byte_unchecked(lhs) } == b'0'
        && unsafe { src.byte_unchecked(lhs + 1) } | 0x20 == b'x';
    let p = number_body_end(src, lhs, hex);
    if hex && unsafe { src.byte_unchecked(p) } == b'.' {
        let next = unsafe { src.byte_unchecked(p + 1) };
        if is_hex(next) || next | 32 == b'p' {
            let mut q = p + 1;
            while is_hex(unsafe { src.byte_unchecked(q) })
                || unsafe { src.byte_unchecked(q) } == b'_'
            {
                q += 1;
            }
            if unsafe { src.byte_unchecked(q) } | 32 != b'p' {
                return p;
            }
            q += 1;
            if unsafe { src.byte_unchecked(q) } == b'+' || unsafe { src.byte_unchecked(q) } == b'-'
            {
                q += 1;
            }
            if !is_digit(unsafe { src.byte_unchecked(q) }) {
                return p;
            }
            return number_body_end(src, p + 1, true);
        }
    }
    p
}

/// SCREAMING_CASE: at least two bytes, one uppercase letter, and only
/// `[A-Z0-9_]` (`$lexIsConstCase`).
fn is_const_case(src: Input, lhs: usize, rhs: usize) -> bool {
    if rhs - lhs < 2 {
        return false;
    }
    let mut upper = false;
    for p in lhs..rhs {
        // SAFETY: `p` is inside the name, before the input end.
        let c = unsafe { src.byte_unchecked(p) };
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
fn word_at(src: Input, p: usize, n: u32) -> u64 {
    // SAFETY: every caller passes a position at or before the input end,
    // so the 8 bytes stay inside the slack.
    let w = unsafe { src.word_unchecked(p) };
    w & (u64::MAX >> (64 - 8 * n))
}

/// The color of the word `[lhs, rhs)` with the next-name capture in bits 8
/// and up (1 = function, 2 = type, 3 = namespace), or -1 for no word
/// (`$goWordHl`).
#[inline(always)]
fn word_hl(src: Input, lhs: usize, rhs: usize) -> i32 {
    let n = rhs - lhs;
    // SAFETY: `lhs` is inside the name, before the input end.
    if n > WORD_MAX || WORD_LENGTHS[unsafe { src.byte_unchecked(lhs) } as usize] >> n & 1 == 0 {
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

/// The one-line quoted literal whose `quote` is at `p`, with escapes as
/// their own tokens. Returns the end (`$lexString`, `$lexStringBody`).
#[inline(never)]
fn string(src: Input, mut recs: Recs, p: usize, end: usize, quote: u8) -> (Recs, usize) {
    let s = &src.bytes()[..end];
    let mut seg = p;
    let mut p = p + 1;
    loop {
        p = scan::string_special(src.bytes(), p, end, quote);
        if p >= end {
            break;
        }
        let c = s[p];
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
    // SAFETY: `base..base + len + SLACK` lies inside lexer memory, which
    // nothing moves while this lexer runs (it calls no translated code).
    let src = unsafe { Input::new(inst, base, len) };
    let end = len;
    let mut recs = Recs::load(inst);

    // `$lexEmitLeadingContinuation`
    let mut ptr = scan::utf8_span_end(src.bytes(), 0, end);
    recs.gap(0, ptr);
    // Leading whitespace (no type group is open yet); every later gap
    // follows a token's record.
    let first = whitespace_end(src, ptr);
    recs.gap(ptr, first);
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
            // right after a name (`fresh`), no merge is possible
            if $fresh {
                recs.push(tok::PUNCTUATION_BRACKET, ptr);
            } else {
                recs.tok(tok::PUNCTUATION_BRACKET, ptr);
            }
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
                // SAFETY: the spaces stop at or before the NUL.
                if is_ident_start(unsafe { src.byte_unchecked(skip_space_at(src, ptr)) }) {
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
            // right after a name (`fresh`), no merge is possible
            if $fresh {
                recs.push(tok::PUNCTUATION_DELIMITER, ptr);
            } else {
                recs.tok(tok::PUNCTUATION_DELIMITER, ptr);
            }
            member = c == b'.';
            if c == b';' {
                recv = false;
                expect = 0;
            }
        }};
    }

    // `ptr` never passes the input end: every scan stops at the NUL there.
    loop {
        let gap = ptr;
        // SAFETY: `ptr` is at or before the input end (see above).
        let s = unsafe { src.byte_unchecked(ptr) };
        // SAFETY: a space is an input byte, so `ptr + 1` is at most the
        // input end.
        if s == b' ' && !is_space(unsafe { src.byte_unchecked(ptr + 1) }) {
            // one space
            ptr += 1;
            recs.extend(ptr);
        } else if is_space(s) {
            ptr = whitespace_end(src, ptr + 1);
            // at depth 1 of a type group each line starts a new type spec
            if type_group == 1 && scan::line_end(src.bytes(), gap, ptr) < ptr {
                expect = 2;
            }
            recs.extend(ptr);
        }
        let lhs = ptr;
        // SAFETY: as above; whitespace runs stop at the NUL.
        let c = unsafe { src.byte_unchecked(ptr) };
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
                    // SAFETY: the spaces after the name stop at or before
                    // the NUL.
                    let next = unsafe { src.byte_unchecked(p) };
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
                recs.tok(hl, rhs);
                member = false;
                // A bracket or delimiter right after a name: its rule runs
                // here, without the gap and dispatch steps.
                // SAFETY: names end at or before the input end, and a `.` is
                // an input byte, so these reads are at most one byte past it.
                let n = unsafe { src.byte_unchecked(ptr) };
                match CLASS[n as usize] {
                    // (a name's color is never a bracket's or a delimiter's)
                    class::BRACKET => bracket!(n, true),
                    class::DELIMITER => delimiter!(n, true),
                    class::DOT if is_ident_start(unsafe { src.byte_unchecked(ptr + 1) }) => {
                        // a selector: the member name follows right away
                        delimiter!(n, true);
                        lhs = ptr;
                        c = unsafe { src.byte_unchecked(ptr) };
                        continue;
                    }
                    class::DOT if !is_digit(unsafe { src.byte_unchecked(ptr + 1) }) => {
                        delimiter!(n, true)
                    }
                    _ => {}
                }
                break;
            }
            continue;
        }
        match class {
            // SAFETY: `c` is an input byte here (the NUL has its own
            // class), so `ptr + 2` is at most one past the input end.
            class::SLASH if matches!(unsafe { src.byte_unchecked(ptr + 1) }, b'/' | b'*') => {
                // `//` (`$lexLineComment`, `$scanToLineEnd`) and `/*`
                // (`$lexBlockComment`, `$scanBlockCommentEnd`) comments;
                // `///`, `//!`, `/**`, and `/*!` are doc comments
                // SAFETY: as above.
                let (c2, c3) =
                    unsafe { (src.byte_unchecked(ptr + 1), src.byte_unchecked(ptr + 2)) };
                let hl = if c3 == c2 || c3 == b'!' {
                    tok::COMMENT_DOC
                } else {
                    tok::COMMENT
                };
                ptr = if c2 == b'/' {
                    scan::line_end(src.bytes(), ptr + 2, end)
                } else {
                    scan::block_comment_end(src.bytes(), ptr + 2, end)
                };
                recs.tok(hl, ptr);
            }
            class::QUOTE => {
                // A one-line literal without escapes is one token; anything
                // else takes the full rules.
                let close = scan::string_special(src.bytes(), ptr + 1, end, c);
                // SAFETY: the scan stops at most at `end`.
                if unsafe { src.byte_unchecked(close) } == c {
                    ptr = close + 1;
                    recs.tok(tok::STRING, ptr);
                } else {
                    // `string` takes the records through `inst`, so the
                    // loop's own `Recs` stays in registers.
                    recs.store(inst);
                    let r;
                    (r, ptr) = string(src, Recs::load(inst), ptr, end, c);
                    r.store(inst);
                    recs = Recs::load(inst);
                }
                member = false;
            }
            class::BACKTICK => {
                // a raw string (`$lexRawString`, `$lexRawStringBody`): the
                // closing backquote is consumed
                let close = scan::find3(src.bytes(), ptr + 1, end, b'`', b'`', b'`');
                ptr = if close < end { close + 1 } else { end };
                recs.tok(tok::STRING, ptr);
                member = false;
            }
            class::DIGIT => {
                ptr = number_end(src, ptr);
                recs.tok(tok::NUMBER, ptr);
                member = false;
            }
            // SAFETY: the `.` is an input byte.
            class::DOT if is_digit(unsafe { src.byte_unchecked(ptr + 1) }) => {
                ptr = number_end(src, ptr);
                recs.tok(tok::NUMBER, ptr);
                member = false;
            }
            class::BRACKET => bracket!(c, false),
            class::DELIMITER | class::DOT => delimiter!(c, false),
            class::OP | class::SLASH => {
                // SAFETY: `c` is an input byte, and `c2` is one too when
                // `ptr + 2` is read.
                let c2 = unsafe { src.byte_unchecked(ptr + 1) };
                ptr += 1;
                if c2 == b'=' || (c == c2 && DOUBLES[c as usize]) {
                    ptr += 1;
                    if (c == b'<' || c == b'>') && unsafe { src.byte_unchecked(ptr) } == b'=' {
                        ptr += 1;
                    }
                }
                recs.tok(tok::OPERATOR, ptr);
                member = false;
            }
            class::NUL if ptr >= end => break,
            _ => {
                ptr += 1;
                recs.tok(tok::NONE, ptr);
                member = false;
            }
        }
    }
    recs.store(inst);
}
