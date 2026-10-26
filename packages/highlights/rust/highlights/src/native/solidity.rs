//! WAT sources: src/langs/solidity.wat src/common.wat src/scan.wat
//!
//! Native Solidity lexer. One pass over the input: each token is scanned
//! and colored in the same step, with the same rules, in the same order, as
//! the translated `$hlSolidity`. The records equal the translated lexer's
//! records.
//!
//! The WAT tests its rules in one long chain. Each rule matches its own
//! first bytes, so this lexer dispatches on the first byte's class and, for
//! each class, tests only the rules that can match it, in the WAT's order.

use super::Lexer;
use super::input::Input;
use super::recs::Recs;
use super::scan;
use crate::generated::Instance;
use crate::simd::V;
use crate::token_ids as tok;
use crate::wat_tables::SOLIDITY_WORDS;

/// The lexer for `name`, if this module handles it.
pub(crate) fn lexer(name: &str) -> Option<Lexer> {
    match name {
        "solidity" => Some(highlight),
        _ => None,
    }
}

/// `$solidityWords` and the two words `$hlSolidity` matches outside the
/// table, `constant` and `require`, with the same result as table entries,
/// as a perfect hash on a word's bytes. A word of up to 16 bytes is two
/// little-endian integers, `lo` (bytes 0-7) and `hi` (bytes 8-15), zero
/// past its end; identifiers hold no NUL, so equal integers mean equal
/// words. Each word has its own slot.
struct Words {
    keys: [(u64, u64); WORD_SLOTS],
    /// The word's `keyword-table.value`: its token in the low byte, the
    /// next-name capture in the high byte (1 = function, 2 = type).
    values: [i32; WORD_SLOTS],
    /// For each first byte, a bit per length of the words starting with it.
    lengths: [u32; 256],
    mul: u64,
}

const WORD_SLOTS: usize = 1024;

/// The longest word.
const WORD_MAX: usize = 15;

/// The words `$hlSolidity` matches outside the table.
const EXTRA_WORDS: [(&[u8], i32); 2] = [
    (b"constant", tok::KEYWORD as i32),
    (b"require", tok::FUNCTION as i32),
];

/// The slot of the word whose integers are `lo` and `hi`. Some words share
/// their first 8 bytes (`calldata`, `calldataload`, `calldatacopy`), so
/// `hi` counts too.
#[inline(always)]
const fn word_slot(lo: u64, hi: u64, mul: u64) -> usize {
    let h = lo ^ hi.rotate_left(29);
    (h.wrapping_mul(mul) >> (64 - WORD_SLOTS.trailing_zeros())) as usize
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
    let n = SOLIDITY_WORDS.len() + EXTRA_WORDS.len();
    let mut lengths = [0u32; 256];
    let mut i = 0;
    while i < n {
        let w = word_entry(i).0;
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
        while i < n {
            let (w, value) = word_entry(i);
            let (lo, hi) = word_key(w);
            let s = word_slot(lo, hi, mul);
            if keys[s].0 != 0 {
                mul = mul.wrapping_add(0x6a09_e667_f3bc_c909) | 1;
                attempt += 1;
                continue 'search;
            }
            keys[s] = (lo, hi);
            values[s] = value;
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

/// Word `i` of the table's words followed by [`EXTRA_WORDS`], with its
/// value.
const fn word_entry(i: usize) -> (&'static [u8], i32) {
    if i < SOLIDITY_WORDS.len() {
        (SOLIDITY_WORDS[i].word, SOLIDITY_WORDS[i].value)
    } else {
        EXTRA_WORDS[i - SOLIDITY_WORDS.len()]
    }
}

/// The value of the word `[lhs, rhs)`, or -1 when it is none
/// (`keyword-table.value $solidityWords` and the words `$hlSolidity` matches outside it).
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
    // (`n` is at most 15, so the shift stays below 64)
    // SAFETY: as above.
    let hi = unsafe { src.word_unchecked(lhs + 8) } & ((1 << (8 * n.saturating_sub(8))) - 1);
    let s = word_slot(lo, hi, WORDS.mul);
    if WORDS.keys[s] == (lo, hi) {
        WORDS.values[s]
    } else {
        -1
    }
}

/// Byte classes for the main dispatch.
mod class {
    /// An identifier start: a letter, `_`, `$`, or any byte from 0x80.
    pub const IDENT: u8 = 0;
    pub const DIGIT: u8 = 1;
    pub const SLASH: u8 = 2;
    /// `"` or `'`.
    pub const QUOTE: u8 = 3;
    pub const DOT: u8 = 4;
    /// NUL: the end of the input, or one byte colored `none` inside it.
    pub const NUL: u8 = 5;
    /// `(`, `)`, `[`, `]`, `{`, or `}`. This and the classes after it are
    /// always one-character tokens.
    pub const BRACKET: u8 = 6;
    /// `,`, `;`, or `:`.
    pub const DELIMITER: u8 = 7;
    /// An operator byte other than `/`.
    pub const OP: u8 = 8;
    /// Anything else: one character colored `none`.
    pub const OTHER: u8 = 9;
}

/// The [`class`] of each byte.
static CLASS: [u8; 256] = {
    let ops = super::tables::byteset(b"+-*%=!<>&|^~?");
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
                b'"' | b'\'' => class::QUOTE,
                b'(' | b')' | b'[' | b']' | b'{' | b'}' => class::BRACKET,
                b'.' => class::DOT,
                b',' | b';' | b':' => class::DELIMITER,
                _ if ops[c] => class::OP,
                _ => class::OTHER,
            }
        };
        c += 1;
    }
    t
};

/// The color of a one-character token by its byte: a bracket, a
/// delimiter, an operator, or none (`$hlSolidity`'s last rule).
static PUNCT_HL: [u8; 256] = {
    let brackets = super::tables::byteset(b"()[]{}");
    let delimiters = super::tables::byteset(b".,;:");
    let ops = super::tables::byteset(b"+-*/%=!<>&|^~?");
    let mut t = [tok::NONE as u8; 256];
    let mut c = 0;
    while c < 256 {
        if brackets[c] {
            t[c] = tok::PUNCTUATION_BRACKET as u8;
        } else if delimiters[c] {
            t[c] = tok::PUNCTUATION_DELIMITER as u8;
        } else if ops[c] {
            t[c] = tok::OPERATOR as u8;
        }
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
    for _ in 0..12 {
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

/// The end of the number at `lhs`: radix digits, separators, exponents,
/// and suffixes, with `.` only before a digit (`$lexScanNumber`,
/// `$lexScanNumberBody`).
#[inline(always)]
fn number_end(src: Input, lhs: usize) -> usize {
    // SAFETY: `lhs` lies inside the input, and the number ends at or
    // before the NUL after it.
    let hex =
        unsafe { src.byte_unchecked(lhs) == b'0' && src.byte_unchecked(lhs + 1) | 32 == b'x' };
    let mut p = lhs;
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

/// The quoted literal at `lhs`, with `quote` its opening byte: escapes get
/// their own tokens, and a raw line break ends it unterminated. Returns its
/// end (`$lexString` with `$multiline` 0, `$lexStringBody`).
#[inline(always)]
fn string(src: Input, out: &mut Recs, lhs: usize, end: usize) -> usize {
    // SAFETY: the quote at `lhs` lies inside the input.
    let quote = unsafe { src.byte_unchecked(lhs) };
    // a one-line literal without escapes is one token
    let close = scan::string_special(src.bytes(), lhs + 1, end, quote);
    // SAFETY: the scan stops at most at `end`.
    if unsafe { src.byte_unchecked(close) } == quote {
        out.tok(tok::STRING, close + 1);
        return close + 1;
    }
    string_rest(src, out, lhs, close, end)
}

/// The first `n` bytes at `p` as a little-endian integer, for comparing
/// short words. Reads 8 bytes, which the input slack allows.
#[inline(always)]
fn word_at(src: Input, p: usize, n: u32) -> u64 {
    // SAFETY: every caller passes a position inside a name, before the
    // input end, so the 8 bytes stay inside the slack.
    let w = unsafe { src.word_unchecked(p) };
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

/// Whether the name `[lhs, rhs)` is a sized integer or byte type: `int` or
/// `uint` and a width of 8 to 256 in steps of eight, or `bytes` and a size
/// of 1 to 32, without a leading zero (`$hlSolidity`).
#[inline(always)]
fn is_sized_type(src: Input, lhs: usize, rhs: usize) -> bool {
    let n = rhs - lhs;
    let digits = if n > 5 && word_at(src, lhs, 5) == word(b"bytes") {
        5
    } else if n > 4 && word_at(src, lhs, 4) == word(b"uint") {
        4
    } else if n > 3 && word_at(src, lhs, 3) == word(b"int") {
        3
    } else {
        return false;
    };
    let s = &src.bytes()[..rhs];
    let mut p = lhs + digits;
    if rhs - p > 3 || s[p] == b'0' {
        return false;
    }
    let mut v = 0u32;
    while p < rhs && is_digit(s[p]) {
        v = v * 10 + (s[p] - b'0') as u32;
        p += 1;
    }
    p == rhs
        && if digits == 5 {
            v <= 32
        } else {
            v <= 256 && v & 7 == 0
        }
}

/// Lex the Solidity input of `len` bytes at `base` (`$hlSolidity`).
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

    // the pending next-name capture: 1 = function, 2 = type; it survives
    // comments and line breaks
    let mut expect = 0u32;
    // right after `.`
    let mut member = false;

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

    // Every token stops at or before the NUL after the input, so `ptr`
    // stays at most `end` and reads a few bytes past it stay inside the
    // slack.
    loop {
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
            let n = rhs - lhs;
            // prefixes belong to the following string, including Unicode
            // text
            // SAFETY: the name stopped at or before the NUL.
            let q = unsafe { src.byte_unchecked(rhs) };
            if (q == b'"' || q == b'\'')
                && ((n == 3 && word_at(src, lhs, 3) == word(b"hex"))
                    || (n == 7 && word_at(src, lhs, 7) == word(b"unicode")))
            {
                out.tok(tok::STRING, rhs);
                ptr = with_copy!(string(rhs, end));
                continue;
            }
            // Whether `(` follows the name's spaces, tested only by the rules
            // that need it.
            // SAFETY: the spaces after the name stop at or before the NUL.
            let paren_next = || unsafe { src.byte_unchecked(skip_space_at(src, rhs)) } == b'(';
            let hl;
            if member {
                // (a member name is never a keyword or sized type)
                hl = if paren_next() {
                    tok::FUNCTION_METHOD
                } else {
                    tok::PROPERTY
                };
            } else {
                let mut kind = word_value(src, lhs, rhs);
                // sized integer and byte types avoid dozens of keyword
                // entries
                // (no table word is one)
                if kind < 0 && matches!(c, b'i' | b'u' | b'b') && is_sized_type(src, lhs, rhs) {
                    kind = tok::TYPE_BUILTIN as i32;
                }
                if kind >= 0 {
                    hl = (kind & 255) as u32;
                    if kind >> 8 != 0 {
                        expect = kind as u32 >> 8;
                    }
                } else if expect != 0 {
                    hl = if expect == 1 {
                        tok::FUNCTION_DEFINITION
                    } else {
                        tok::TYPE
                    };
                    expect = 0;
                } else if paren_next() {
                    hl = tok::FUNCTION;
                } else if is_upper(c) {
                    hl = tok::TYPE;
                } else {
                    hl = tok::VARIABLE;
                }
            }
            out.tok(hl, rhs);
            member = false;
            // `(` or `)` right after a name: its rule runs here, without the
            // gap and dispatch steps
            // SAFETY: the name stopped at or before the NUL.
            if matches!(unsafe { src.byte_unchecked(ptr) }, b'(' | b')') {
                ptr += 1;
                // SAFETY: the bracket lies inside the input.
                if unsafe { src.byte_unchecked(ptr) } & 0xc0 == 0x80 {
                    ptr = scan::utf8_span_end(src.bytes(), ptr, end);
                }
                out.tok(tok::PUNCTUATION_BRACKET, ptr);
                expect = 0;
                // and the `;` after a `)`: `f(x);`
                // SAFETY: the bracket token ends at most at `end`.
                if unsafe { src.byte_unchecked(ptr) == b';' && src.byte_unchecked(ptr - 1) == b')' }
                {
                    ptr += 1;
                    // SAFETY: the `;` lies inside the input.
                    if unsafe { src.byte_unchecked(ptr) } & 0xc0 == 0x80 {
                        ptr = scan::utf8_span_end(src.bytes(), ptr, end);
                    }
                    out.tok(tok::PUNCTUATION_DELIMITER, ptr);
                }
            }
            continue;
        }

        // One-character tokens skip the jump table too.
        if class >= class::BRACKET {
            ptr += 1;
            // SAFETY: the one-byte token lies inside the input.
            if unsafe { src.byte_unchecked(ptr) } & 0xc0 == 0x80 {
                ptr = scan::utf8_span_end(src.bytes(), ptr, end);
            }
            if class == class::BRACKET {
                expect = 0;
            }
            member = false;
            out.tok(PUNCT_HL[c as usize] as u32, ptr);
            continue;
        }
        // SAFETY: `ptr` is at most `end`.
        let c2 = unsafe { src.byte_unchecked(ptr + 1) };
        match class {
            class::SLASH if c2 == b'/' => {
                // SAFETY: `ptr` is below `end`.
                let doc = unsafe { src.byte_unchecked(ptr + 2) } == b'/';
                ptr = scan::line_end(src.bytes(), ptr + 2, end);
                out.tok(if doc { tok::COMMENT_DOC } else { tok::COMMENT }, ptr);
            }
            class::SLASH if c2 == b'*' => {
                // SAFETY: `ptr` is below `end`.
                let doc = unsafe { src.byte_unchecked(ptr + 2) } == b'*';
                ptr = scan::block_comment_end(src.bytes(), ptr + 2, end);
                out.tok(if doc { tok::COMMENT_DOC } else { tok::COMMENT }, ptr);
            }
            class::QUOTE => ptr = with_copy!(string(ptr, end)),
            class::DOT | class::DIGIT if class == class::DIGIT || is_digit(c2) => {
                // (a lone digit - `0`, `1` - ends at once)
                ptr = if class == class::DIGIT && !IDENT_CONT[c2 as usize] && c2 != b'.' {
                    ptr + 1
                } else {
                    number_end(src, ptr)
                };
                out.tok(tok::NUMBER, ptr);
            }
            class::NUL if ptr >= end => break,
            _ => {
                // one character: a bracket, delimiter, operator, or other
                // (with the UTF-8 continuation bytes after it; the NUL at the
                // end is none)
                ptr += 1;
                // SAFETY: `ptr` is at most `end`: the byte before it lies
                // inside the input.
                if unsafe { src.byte_unchecked(ptr) } & 0xc0 == 0x80 {
                    ptr = scan::utf8_span_end(src.bytes(), ptr, end);
                }
                if class == class::BRACKET {
                    expect = 0;
                }
                member = c == b'.';
                out.tok(PUNCT_HL[c as usize] as u32, ptr);
            }
        }
    }
    out.store(inst);
}
